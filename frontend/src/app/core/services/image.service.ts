/**
 * src/app/core/services/image.service.ts
 * Picking, cropping, re-encoding and uploading of profile pictures, banners and group icons, and loading
 * them back as blob URLs.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { fromB64, randomBytes } from '../crypto/bytes';
import { derivePairKey, openBytes, sealBytes } from '../crypto/pairwise';
import { pickFile as pickSingleFile } from '../file-picker';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export type ImageKind = 'avatar' | 'banner' | 'group';
/** What can be sealed and shown to friends: pictures and the font file of a name. */
export type SharedKind = 'avatar' | 'banner' | 'font';

/** Final size of each kind of picture, in pixels. */
export const IMAGE_PRESETS: Record<ImageKind, { width: number; height: number }> = {
  avatar: { width: 256, height: 256 },
  group: { width: 256, height: 256 },
  banner: { width: 1200, height: 400 },
};

/** Whether the bytes of a picture are an animation (a GIF, or a WebP that says it has frames). */
function isAnimated(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.slice(0, 4));
  if (head === 'GIF8') {
    return true;
  }
  const form = String.fromCharCode(...bytes.slice(8, 16));
  return head === 'RIFF' && form === 'WEBPVP8X' && (bytes[20]! & 0x02) !== 0;
}

/** A new random key for a picture. */
function newPictureKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** A picture as the server keeps it: a 12-byte nonce, then the ciphertext. */
async function encryptPicture(
  plain: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plain),
  );
  const bytes = new Uint8Array(iv.length + cipher.length);
  bytes.set(iv);
  bytes.set(cipher, iv.length);
  return bytes;
}

/** Opens a picture made by `encryptPicture`. */
async function decryptPicture(bytes: Uint8Array<ArrayBuffer>, key: CryptoKey): Promise<Blob> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), tagLength: 128 },
    key,
    bytes.slice(12),
  );
  return new Blob([plain], { type: 'image/webp' });
}

/** How often the keys of the own pictures are offered to the people who arrived since (while the page is open). */
const SHARE_EVERY_MS = 5 * 60 * 1000;
/** A picture that was offered less than this long ago is not offered again (the page may have been reloaded). */
const SHARE_AGAIN_AFTER_MS = 4 * 60 * 1000;

/**
 * Profile pictures, banners and group icons. Pictures are center-cropped and re-encoded to WebP in the
 * browser before upload (which also strips EXIF/location metadata), then fetched back through the
 * authenticated API as blob URLs so the strict CSP never has to allow remote images.
 *
 * * Profile pictures and banners are END-TO-END ENCRYPTED. Each picture gets a random AES-256-GCM key; the server stores
 * only the ciphertext; the key is sealed for each person who may see it with the pair key between the owner and that
 * person (the same ECDH identity the direct messages use). Only the owner's browser seals keys, so a new friend sees the
 * picture the next time the owner is online (see `shareMine`).
 *
 * * A group icon is encrypted the same way, but its key travels with the group: the owner seals it with the key of the group
 * (see GuildStore) and every member opens it from there. The server hands the icon only to the members.
 */
@Injectable({ providedIn: 'root' })
export class ImageService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly urls = signal<Record<string, string>>({});
  /** The first frame of each picture that moves. */
  private readonly stills = signal<Record<string, string>>({});
  private readonly inflight = new Set<string>();
  /** The key of each encrypted picture this browser already has (by picture id). */
  private readonly pictureKeys = new Map<string, CryptoKey>();
  /** The key of each encrypted group icon this browser has opened (by picture id). */
  private readonly groupIconKeys = new Map<string, CryptoKey>();
  /** The encrypted pictures that are being opened or were opened, by id (one request each). */
  private readonly opened = new Map<string, Promise<Blob>>();
  /** The own pictures that were already offered to the people around in this session. */
  private readonly offered = new Set<string>();
  /** Pictures whose key is not for this person yet: asked again later, a few times. */
  private readonly retries = new Map<string, number>();

  constructor() {
    effect(this.shareOwnPictures.bind(this, false));
    setInterval(this.shareOwnPictures.bind(this, true), SHARE_EVERY_MS);
  }

  /** Seals the keys of the person's own picture and banner for whoever can see them and does not have them yet. */
  private shareOwnPictures(everyone: boolean): void {
    if (!this.auth.isAuthenticated()) {
      return;
    }
    const user = this.auth.user();
    for (const id of [user?.avatarImage, user?.bannerImage, user?.nameFontImage]) {
      // A change of the profile (a status, a name) runs this too: a picture is offered once, then on the timer only.
      if (!id || (!everyone && this.offered.has(id))) {
        continue;
      }
      this.offered.add(id);
      untracked(this.shareOwn.bind(this, id));
    }
  }

  /** Reactive: the blob URL of an image once it has loaded (null before). Call `ensure` to start loading. */
  url(id: string | null | undefined): string | null {
    return id ? (this.urls()[id] ?? null) : null;
  }

  /**
   * Starts downloading a picture if it is not loaded or loading yet. `sealed` says it is a profile picture or a banner
   * (encrypted); group icons are plain.
   */
  ensure(id: string | null | undefined, sealed = true): void {
    if (!id || this.urls()[id] || this.inflight.has(id)) {
      return;
    }
    this.inflight.add(id);
    this.fetchPicture(id, sealed)
      .then(this.storeImage.bind(this, id), this.retryLater.bind(this, id, sealed))
      .finally(this.inflight.delete.bind(this.inflight, id));
  }

  /** The file of a profile picture or banner (a preset keeps it). */
  openPicture(id: string): Promise<Blob> {
    return this.fetchPicture(id, true);
  }

  /** Downloads a picture and opens it when it is encrypted. */
  private fetchPicture(id: string, sealed: boolean): Promise<Blob> {
    if (!sealed) {
      return this.api.download('/api/images/' + id).then(this.openGroupIcon.bind(this, id));
    }
    return this.loadSealed(id);
  }

  /** Opens the bytes of a group icon with its key (an old icon that is not encrypted yet is shown as it is). */
  private async openGroupIcon(id: string, bytes: ArrayBuffer): Promise<Blob> {
    const key = this.groupIconKeys.get(id);
    return key ? decryptPicture(new Uint8Array(bytes), key) : new Blob([bytes]);
  }

  /** Learns the key of a group icon (the groups store opens it from the sealed key that comes with the group). */
  async learnGroupIcon(id: string, raw: Uint8Array<ArrayBuffer>): Promise<void> {
    this.groupIconKeys.set(
      id,
      await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']),
    );
  }

  /** Encrypts a group icon and uploads it for a group of the person; returns its id and the key that opens it. */
  async uploadGroupIcon(
    guildId: string,
    blob: Blob,
  ): Promise<{ id: string; raw: Uint8Array<ArrayBuffer> }> {
    const key = await newPictureKey();
    const response = await this.api.upload<{ id: string }>(
      '/api/images?kind=group&guild=' + guildId,
      await encryptPicture(new Uint8Array(await blob.arrayBuffer()), key),
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    await this.learnGroupIcon(response.id, raw);
    return { id: response.id, raw };
  }

  /**
   * Opens an encrypted picture: one request brings the ciphertext and the key sealed for this person; the key is opened
   * with the pair key between the owner and this person, and the picture is decrypted. The key is kept (the owner needs it
   * to seal it for others).
   */
  private loadSealed(id: string): Promise<Blob> {
    let promise = this.opened.get(id);
    if (!promise) {
      promise = this.openSealed(id);
      this.opened.set(id, promise);
      promise.catch(this.opened.delete.bind(this.opened, id));
    }
    return promise;
  }

  /** The work of `loadSealed`. */
  private async openSealed(id: string): Promise<Blob> {
    const answer = await this.api.get<{
      iv: string;
      ciphertext: string;
      ownerEcdh: string;
      data: string;
    }>('/api/images/' + id + '/open');
    let key = this.pictureKeys.get(id);
    if (!key) {
      const identity = this.auth.identity;
      const pair = await derivePairKey(
        identity.ecdhPrivate,
        identity.publicKeys.ecdh,
        answer.ownerEcdh,
        'profile-picture|' + id,
      );
      const raw = await openBytes(
        pair,
        { iv: answer.iv, ciphertext: answer.ciphertext },
        'profile-picture|' + id + '|' + this.auth.userId,
      );
      key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
      this.pictureKeys.set(id, key);
    }
    return decryptPicture(fromB64(answer.data), key);
  }

  /** Keeps a downloaded picture as a blob URL (and, when it moves, its first frame: it moves only under the pointer). */
  private storeImage(id: string, blob: Blob): void {
    this.retries.delete(id);
    this.urls.set({ ...this.urls(), [id]: URL.createObjectURL(blob) });
    void this.makeStill(id, blob);
  }

  /** The first frame of an animated picture, as a still picture. */
  private async makeStill(id: string, blob: Blob): Promise<void> {
    try {
      if (!isAnimated(new Uint8Array(await blob.slice(0, 32).arrayBuffer()))) {
        return;
      }
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(bitmap.width, 256);
      canvas.height = Math.round((canvas.width / bitmap.width) * bitmap.height);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const still = await new Promise<Blob | null>(function encode(resolve) {
        canvas.toBlob(resolve, 'image/webp', 0.85);
      });
      if (still) {
        this.stills.set({ ...this.stills(), [id]: URL.createObjectURL(still) });
      }
    } catch {
      /* without a still the picture just moves all the time */
    }
  }

  /** Reactive: the still first frame of a picture that moves (null when it does not move, or before it is made). */
  still(id: string | null | undefined): string | null {
    return id ? (this.stills()[id] ?? null) : null;
  }

  /**
   * ? The picture could not be opened (usually its owner has not sealed the key for this person yet because they have
   * not been online since): it is asked for again after a while, up to forty times (every few minutes at the end).
   */
  private retryLater(id: string, sealed: boolean): void {
    const tries = (this.retries.get(id) ?? 0) + 1;
    this.retries.set(id, tries);
    if (tries <= 40) {
      setTimeout(this.ensure.bind(this, id, sealed), 15_000 * Math.min(tries, 12));
    }
  }

  /** Opens the system file picker; resolves to null when the person cancels. */
  pickFile(accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif'): Promise<File | null> {
    return pickSingleFile(accept);
  }

  /** Crops the center to the target proportions and re-encodes (strips metadata and bounds the size). */
  async process(
    file: Blob,
    target: { width: number; height: number },
    options: { mime?: 'image/webp' | 'image/jpeg'; quality?: number } = {},
  ): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.max(target.width / bitmap.width, target.height / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext('2d')!;
      context.imageSmoothingQuality = 'high';
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(
        bitmap,
        (target.width - width) / 2,
        (target.height - height) / 2,
        width,
        height,
      );
      const blob = await new Promise<Blob | null>(function encode(resolve) {
        canvas.toBlob(resolve, options.mime ?? 'image/webp', options.quality ?? 0.86);
      });
      if (!blob) {
        throw new Error('Could not encode the image');
      }
      return blob;
    } finally {
      bitmap.close();
    }
  }

  /**
   * Uploads a processed profile picture or banner and returns its id. It is encrypted first, and its key is sealed for
   * everybody who may see it before the id is returned.
   */
  async upload(kind: SharedKind, blob: Blob): Promise<string> {
    const key = await newPictureKey();
    const bytes = await encryptPicture(new Uint8Array(await blob.arrayBuffer()), key);
    const response = await this.api.upload<{ id: string }>('/api/images?kind=' + kind, bytes);
    this.pictureKeys.set(response.id, key);
    await this.shareMine(response.id);
    return response.id;
  }

  /**
   * Seals the key of one of the person's own pictures for everybody who may see it and does not have it yet (friends,
   * people who share a server, direct conversations). It runs after an upload and again now and then while the person is
   * online, so the people who arrive later get the picture too.
   */
  async shareMine(id: string | null | undefined): Promise<void> {
    const key = id ? this.pictureKeys.get(id) : undefined;
    if (!id || !key) {
      return;
    }
    const audience = await this.api.get<{ missing: { id: string; ecdh: string }[] }>(
      '/api/images/' + id + '/audience',
    );
    if (audience.missing.length === 0) {
      return;
    }
    const identity = this.auth.identity;
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    const keys: { viewerId: string; iv: string; ciphertext: string }[] = [];
    for (const viewer of audience.missing) {
      const pair = await derivePairKey(
        identity.ecdhPrivate,
        identity.publicKeys.ecdh,
        viewer.ecdh,
        'profile-picture|' + id,
      );
      const sealed = await sealBytes(pair, raw, 'profile-picture|' + id + '|' + viewer.id);
      keys.push({ viewerId: viewer.id, iv: sealed.iv, ciphertext: sealed.ciphertext });
    }
    await this.api.put('/api/images/' + id + '/keys', { keys });
  }

  /** Opens the key of one of the person's own pictures (after a reload), then shares it with whoever is missing. */
  async shareOwn(id: string | null | undefined): Promise<void> {
    if (!id) {
      return;
    }
    try {
      const last = Number(sessionStorage.getItem('chatterly.shared.' + id) ?? 0);
      if (Date.now() - last < SHARE_AGAIN_AFTER_MS) {
        return;
      }
      await this.loadSealed(id);
      await this.shareMine(id);
      sessionStorage.setItem('chatterly.shared.' + id, String(Date.now()));
    } catch {
      /* the picture has no key for this person (an old one): nothing to share */
    }
  }
}
