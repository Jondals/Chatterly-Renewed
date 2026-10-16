/**
 * src/app/core/services/vault.service.ts
 * The personal library of the person: the pictures and animations they keep (for now, the backgrounds of their camera
 * in calls). Each item lives on the account, so every device they sign in on has it, or only on this device when they
 * turn off "keep my library in my account" (Settings > Sync).
 *
 * * On the account everything is END-TO-END ENCRYPTED (see backend routes/vault.ts): a file gets a random AES-256-GCM key;
 * that key and the description of the file (name, type, size and a small thumbnail) are sealed with a key that comes from
 * the identity of the person, so the server only holds ciphertext. The id of the item is made here and bound into every
 * encryption (additional data), so the server cannot swap the parts of two items.
 * * On this device the files are kept as they are in IndexedDB (like the wallpaper), never sent anywhere.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { randomBytes } from '../crypto/bytes';
import { derivePairKey, open as openJson, openBytes, seal, sealBytes } from '../crypto/pairwise';
import { runInStore, type StoreLocation } from '../indexed-db';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { persisted } from './persisted';

/** What the library says about one file (sealed on the account). */
export interface VaultMeta {
  name: string;
  mime: string;
  width: number;
  height: number;
  /** A GIF or animated WebP. */
  animated: boolean;
  /** Where it came from. */
  source: 'file' | 'gif';
  /** A small picture (a data: address) to show it in a list without opening the file. */
  thumb: string;
}

/** One item of the library. */
export interface VaultItem {
  id: string;
  size: number;
  createdAt: number;
  meta: VaultMeta;
  /** Where it is kept. */
  where: 'account' | 'device';
}

/**
 * A copy of something the person made on a device (a sticker pack, a preset), kept in the account so it is on every device
 * and is not lost with one (see library-sync.service.ts). Its description is sealed like the one of a background; the server
 * cannot tell a copy from a background.
 */
export interface BackupMeta {
  kind: 'stickers' | 'preset';
  /** The id of the pack or preset on the devices. */
  ref: string;
  name: string;
  /** When the pack or preset was made (kept as it was on every device). */
  createdAt: number;
  /** SHA-256 of the packed bytes, in hex: two devices with the same copy see the same one. */
  hash: string;
}

/** One copy in the account. */
export interface BackupItem {
  id: string;
  size: number;
  /** When this copy was uploaded. */
  savedAt: number;
  meta: BackupMeta;
}

/** The limits the server enforces (shown in Settings). */
export interface VaultLimits {
  items: number;
  itemBytes: number;
  totalBytes: number;
}

/** The biggest file kept as it is (the encrypted item may weigh 12 MB). */
const VAULT_MAX_FILE_BYTES = 11 * 1024 * 1024;
/** The longest side of a still picture that is kept (a bigger one is reduced). */
const STILL_MAX_SIDE = 1920;
/** The thumbnail: size in pixels. */
const THUMB = { width: 192, height: 108 };
/** Items kept on this device only. */
const DEVICE_STORE: StoreLocation = { database: 'chatterly-renewed-library', store: 'items' };

/** What the server returns for one item. */
interface AccountItem {
  id: string;
  size: number;
  createdAt: number;
  key: { iv: string; ciphertext: string };
  meta: { iv: string; ciphertext: string };
}

/** What is kept on this device for one item. */
interface DeviceItem {
  id: string;
  /** The person it belongs to (another person who signs in on this device does not see it). */
  owner: string;
  createdAt: number;
  meta: VaultMeta;
  bytes: ArrayBuffer;
}

/** The additional data of each encrypted part (it binds the part to its item and to what it is). */
function aad(id: string, part: 'file' | 'key' | 'meta'): string {
  return 'vault|' + id + '|' + part;
}

/** True for a GIF or an animated WebP. */
async function isAnimatedImage(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const text = String.fromCharCode(...head);
  if (text.startsWith('GIF8')) {
    return true;
  }
  return text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP' && text.includes('ANIM');
}

/** The library of the person. */
@Injectable({ providedIn: 'root' })
export class VaultService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  /** Whether the library is kept in the account (true) or only on this device. It is a choice of each device. */
  readonly inAccount = persisted<boolean>('sync.vault', true);
  /** Every item the person can use on this device. */
  readonly items = signal<VaultItem[]>([]);
  /** The copies of sticker packs and presets in the account (not backgrounds: they are not in `items`). */
  readonly backups = signal<BackupItem[]>([]);
  /** True once the account list was read in this session (the copies can be compared with this device). */
  readonly accountRead = signal(false);
  /** Bytes used on the account (encrypted size). */
  readonly used = signal(0);
  /** What the account allows. */
  readonly limits = signal<VaultLimits>({
    items: 40,
    itemBytes: 12 * 1024 * 1024,
    totalBytes: 160 * 1024 * 1024,
  });
  /** True while the list is being read. */
  readonly loading = signal(false);

  private accountKey: Promise<CryptoKey> | null = null;
  /** The sealed key of each item of the account, as the last list brought it (opening an item does not need the list again). */
  private readonly sealedKeys = new Map<string, { iv: string; ciphertext: string }>();
  /** The files that were opened in this session (so a background that is used again is not downloaded again). */
  private readonly opened = new Map<string, Promise<Blob>>();
  private started = false;

  constructor() {
    effect(this.follow.bind(this));
  }

  /** Reads the library when a person signs in and forgets it when they sign out. */
  private follow(): void {
    if (this.auth.isAuthenticated()) {
      untracked(this.start.bind(this));
    } else {
      untracked(this.stop.bind(this));
    }
  }

  /** The person signed out: nothing of their library stays in memory. */
  private stop(): void {
    this.started = false;
    this.accountKey = null;
    this.sealedKeys.clear();
    this.opened.clear();
    this.items.set([]);
    this.backups.set([]);
    this.accountRead.set(false);
    this.used.set(0);
  }

  /** Reads the library once per session. */
  private async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await this.refresh();
  }

  /** The key that seals the library: it comes from the identity of the person (their pair key with themselves). */
  private key(): Promise<CryptoKey> {
    if (!this.accountKey) {
      const identity = this.auth.identity;
      this.accountKey = derivePairKey(
        identity.ecdhPrivate,
        identity.publicKeys.ecdh,
        identity.publicKeys.ecdh,
        'vault',
      );
    }
    return this.accountKey;
  }

  /** Reads the account list and the device list and joins them (the newest first). */
  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [account, device] = await Promise.all([this.readAccount(), this.readDevice()]);
      this.items.set(
        [...account, ...device].sort(function newest(a, b) {
          return b.createdAt - a.createdAt;
        }),
      );
    } finally {
      this.loading.set(false);
    }
  }

  /** The items of the account (an item that cannot be opened is left out, never shown wrong). */
  private async readAccount(): Promise<VaultItem[]> {
    try {
      const answer = await this.api.get<{
        items: AccountItem[];
        used: number;
        limits: VaultLimits;
      }>('/api/vault');
      this.used.set(answer.used);
      this.limits.set(answer.limits);
      const key = await this.key();
      const out: VaultItem[] = [];
      const backups: BackupItem[] = [];
      this.sealedKeys.clear();
      for (const item of answer.items) {
        this.sealedKeys.set(item.id, item.key);
        try {
          const meta = await openJson<VaultMeta | BackupMeta>(key, item.meta, aad(item.id, 'meta'));
          const backup = this.cleanBackup(meta);
          if (backup) {
            backups.push({ id: item.id, size: item.size, savedAt: item.createdAt, meta: backup });
            continue;
          }
          out.push({
            id: item.id,
            size: item.size,
            createdAt: item.createdAt,
            meta: this.cleanMeta(meta as VaultMeta),
            where: 'account',
          });
        } catch {
          // Damaged or not made for this identity: it is not shown.
        }
      }
      this.backups.set(backups);
      this.accountRead.set(true);
      return out;
    } catch {
      return [];
    }
  }

  /** The description of a copy of a pack or a preset, cleaned (null when the item is a background, or damaged). */
  private cleanBackup(meta: VaultMeta | BackupMeta): BackupMeta | null {
    const raw = meta as Partial<BackupMeta>;
    if (raw.kind !== 'stickers' && raw.kind !== 'preset') {
      return null;
    }
    const ref = String(raw.ref ?? '');
    const hash = String(raw.hash ?? '');
    if (!/^[\w-]{1,80}$/.test(ref) || !/^[0-9a-f]{64}$/.test(hash)) {
      return null;
    }
    return {
      kind: raw.kind,
      ref,
      name: String(raw.name ?? '').slice(0, 80),
      createdAt: Math.max(0, Number(raw.createdAt) || 0),
      hash,
    };
  }

  /** Keeps a copy of a pack or a preset in the account. Returns the id of the new item. */
  async addBackup(meta: BackupMeta, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const id = crypto.randomUUID();
    await this.addToAccount(id, bytes, meta);
    return id;
  }

  /** The bytes of a copy in the account (downloaded and decrypted). */
  async openBackup(item: BackupItem): Promise<Uint8Array<ArrayBuffer>> {
    const sealedKey = this.sealedKeys.get(item.id);
    if (!sealedKey) {
      throw new Error('That copy is not in your account any more.');
    }
    const vault = await this.key();
    const rawKey = await openBytes(vault, sealedKey, aad(item.id, 'key'));
    const fileKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    rawKey.fill(0);
    const bytes = new Uint8Array(await this.api.download('/api/vault/' + item.id));
    return new Uint8Array(await openWithKey(fileKey, bytes, aad(item.id, 'file')));
  }

  /** Removes a copy from the account (one that is already gone counts as removed). */
  async removeBackup(id: string): Promise<void> {
    try {
      await this.api.delete('/api/vault/' + id);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) {
        throw error;
      }
    }
  }

  /** Reads the list of the account again (the copies too). */
  async reloadAccount(): Promise<void> {
    await this.refresh();
  }

  /** The items kept on this device. */
  private async readDevice(): Promise<VaultItem[]> {
    try {
      const rows = await runInStore<DeviceItem[]>(DEVICE_STORE, 'readonly', function all(store) {
        return store.getAll();
      });
      const me = this.auth.user()?.id;
      return rows
        .filter(function mine(row) {
          return row.owner === me;
        })
        .map(function describe(row): VaultItem {
          return {
            id: row.id,
            size: row.bytes.byteLength,
            createdAt: row.createdAt,
            meta: row.meta,
            where: 'device',
          };
        });
    } catch {
      return [];
    }
  }

  /** Keeps only what a description may hold, whatever came out of the decryption. */
  private cleanMeta(meta: VaultMeta): VaultMeta {
    // ! Only a plain base64 picture goes into a style: nothing in it can close the url() and add more CSS.
    const thumb =
      typeof meta.thumb === 'string' &&
      /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(meta.thumb)
        ? meta.thumb
        : '';
    return {
      name: String(meta.name ?? '').slice(0, 80),
      mime: /^image\/[a-z0-9.+-]{1,30}$/.test(String(meta.mime)) ? meta.mime : 'image/webp',
      width: Math.max(0, Math.min(10000, Number(meta.width) || 0)),
      height: Math.max(0, Math.min(10000, Number(meta.height) || 0)),
      animated: meta.animated === true,
      source: meta.source === 'gif' ? 'gif' : 'file',
      thumb,
    };
  }

  /**
   * Adds a picture or an animation. A still picture is reduced (and its metadata, like the place it was taken, is
   * removed by the new encoding); an animation is kept as it is. Throws a readable message when it cannot be kept.
   */
  async add(file: Blob, name: string, source: 'file' | 'gif'): Promise<VaultItem> {
    if (!file.type.startsWith('image/')) {
      throw new Error('That is not a picture.');
    }
    const animated = await isAnimatedImage(file);
    const ready = animated ? file : await this.reduce(file);
    if (ready.size > VAULT_MAX_FILE_BYTES) {
      throw new Error('That file is bigger than 11 MB.');
    }
    const bitmap = await createImageBitmap(ready);
    const meta: VaultMeta = {
      name: name.replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 80) || 'Background',
      mime: ready.type || 'image/webp',
      width: bitmap.width,
      height: bitmap.height,
      animated,
      source,
      thumb: this.thumbnail(bitmap),
    };
    bitmap.close();
    const id = crypto.randomUUID();
    const bytes = new Uint8Array(await ready.arrayBuffer());
    const createdAt = Date.now();
    const owner = this.auth.user()?.id ?? '';
    if (this.inAccount()) {
      await this.addToAccount(id, bytes, meta);
    } else {
      await runInStore(DEVICE_STORE, 'readwrite', function put(store) {
        return store.put(
          { id, owner, createdAt, meta, bytes: bytes.buffer } satisfies DeviceItem,
          id,
        );
      });
    }
    this.opened.set(id, Promise.resolve(new Blob([bytes], { type: meta.mime })));
    await this.refresh();
    return this.items().find(function mine(item) {
      return item.id === id;
    })!;
  }

  /** Encrypts and sends one item to the account. */
  private async addToAccount(
    id: string,
    bytes: Uint8Array<ArrayBuffer>,
    meta: VaultMeta | BackupMeta,
  ): Promise<void> {
    const fileKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const sealedFile = await sealWithKey(fileKey, bytes, aad(id, 'file'));
    const vault = await this.key();
    const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', fileKey));
    const sealedKey = await sealBytes(vault, rawKey, aad(id, 'key'));
    const sealedMeta = await seal(vault, meta, aad(id, 'meta'));
    rawKey.fill(0);
    const query = new URLSearchParams({
      id,
      ki: sealedKey.iv,
      kc: sealedKey.ciphertext,
      mi: sealedMeta.iv,
      mc: sealedMeta.ciphertext,
    });
    await this.api.upload('/api/vault?' + query, sealedFile);
  }

  /** A still picture, reduced to a sensible size and re-encoded (WebP). */
  private async reduce(file: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, STILL_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      throw new Error('This browser cannot read that picture.');
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(function encode(resolve) {
      canvas.toBlob(resolve, 'image/webp', 0.88);
    });
    if (!blob) {
      throw new Error('This browser cannot read that picture.');
    }
    return blob;
  }

  /** The small picture of a list: the image cut to the size of the thumbnail. */
  private thumbnail(bitmap: ImageBitmap): string {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB.width;
    canvas.height = THUMB.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return '';
    }
    const scale = Math.max(THUMB.width / bitmap.width, THUMB.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (THUMB.width - width) / 2,
      (THUMB.height - height) / 2,
      width,
      height,
    );
    return canvas.toDataURL('image/webp', 0.7);
  }

  /** The file of an item (downloaded and decrypted once per session). */
  open(item: VaultItem): Promise<Blob> {
    let promise = this.opened.get(item.id);
    if (!promise) {
      promise = item.where === 'device' ? this.openDevice(item) : this.openAccount(item);
      this.opened.set(item.id, promise);
      promise.catch(this.opened.delete.bind(this.opened, item.id));
    }
    return promise;
  }

  /** Reads an item of this device. */
  private async openDevice(item: VaultItem): Promise<Blob> {
    const row = await runInStore<DeviceItem | undefined>(
      DEVICE_STORE,
      'readonly',
      function get(store) {
        return store.get(item.id);
      },
    );
    if (!row) {
      throw new Error('That background is not on this device any more.');
    }
    return new Blob([row.bytes], { type: item.meta.mime });
  }

  /** Downloads and decrypts an item of the account. */
  private async openAccount(item: VaultItem): Promise<Blob> {
    const sealedKey = this.sealedKeys.get(item.id);
    if (!sealedKey) {
      throw new Error('That background is not in your account any more.');
    }
    const vault = await this.key();
    const rawKey = await openBytes(vault, sealedKey, aad(item.id, 'key'));
    const fileKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    rawKey.fill(0);
    const bytes = new Uint8Array(await this.api.download('/api/vault/' + item.id));
    const plain = await openWithKey(fileKey, bytes, aad(item.id, 'file'));
    return new Blob([plain], { type: item.meta.mime });
  }

  /** Removes one item from where it is kept. */
  async remove(item: VaultItem): Promise<void> {
    if (item.where === 'device') {
      await runInStore(DEVICE_STORE, 'readwrite', function del(store) {
        return store.delete(item.id);
      });
    } else {
      await this.api.delete('/api/vault/' + item.id);
    }
    this.opened.delete(item.id);
    await this.refresh();
  }

  /**
   * Removes every background that is on the account (what is only on this device stays, and so do the copies of the sticker
   * packs and presets: they have their own switch).
   */
  async removeAllFromAccount(): Promise<void> {
    for (const item of this.items()) {
      if (item.where === 'account') {
        await this.api.delete('/api/vault/' + item.id);
        this.opened.delete(item.id);
      }
    }
    await this.refresh();
  }

  /** Moves what is on this device to the account (used when the person turns the sync on). */
  async moveDeviceToAccount(): Promise<number> {
    let moved = 0;
    for (const item of this.items()) {
      if (item.where !== 'device') {
        continue;
      }
      try {
        const blob = await this.open(item);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await this.addToAccount(crypto.randomUUID(), bytes, item.meta);
        await runInStore(DEVICE_STORE, 'readwrite', function del(store) {
          return store.delete(item.id);
        });
        this.opened.delete(item.id);
        moved++;
      } catch {
        // The ones that do not fit stay on the device.
      }
    }
    await this.refresh();
    return moved;
  }
}

/** Encrypts bytes with a key: a 12-byte nonce, then the ciphertext (the same shape as the pictures of the profile). */
async function sealWithKey(
  key: CryptoKey,
  plain: Uint8Array<ArrayBuffer>,
  additional: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(additional), tagLength: 128 },
      key,
      plain,
    ),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return out;
}

/** Opens what `sealWithKey` made; it fails when the bytes, the key or the item they belong to differ. */
async function openWithKey(
  key: CryptoKey,
  bytes: Uint8Array<ArrayBuffer>,
  additional: string,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes.slice(0, 12),
      additionalData: new TextEncoder().encode(additional),
      tagLength: 128,
    },
    key,
    bytes.slice(12),
  );
}
