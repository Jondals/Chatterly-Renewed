/**
 * src/app/core/services/library-sync.service.ts
 * Keeps a copy of the sticker packs and the presets of the person in their account, so they are on every device they sign in
 * on and are not lost with one (an update, a phone that is reset, a browser that clears its data).
 *
 * * Every pack and every preset is one item of the personal library of the account (VaultService): END-TO-END ENCRYPTED with
 *   a key that comes from the identity of the person, so the server keeps something it cannot read and cannot tell from a
 *   camera background. The description (what it is, its id, its name and a SHA-256 of the bytes) is sealed too.
 * * Settings > Sync > "Stickers and presets in my account" turns it on or off on each device (on by default).
 * * How two devices agree, without a clock: this device remembers, for each pack and preset, the copy it last saw in the
 *   account (the id of the item and the hash). Comparing the account, this device and that memory tells what happened:
 *     - only here and never synced: it is new here, it goes up;
 *     - only here, synced before, and its copy is gone from the account: it was deleted on another device, it goes here too;
 *     - only in the account: it is new from another device, it comes down (or it was deleted here, and it goes from the account);
 *     - in both: whoever changed it since the last sync wins (here changed: up; the account changed: down).
 * ! Nothing is deleted from this device unless its copy was in the account before and another device removed it. A copy that
 *   cannot be read is left alone, never "fixed" by deleting.
 * ? The account has limits (items and megabytes, see backend routes/vault.ts): what does not fit stays on this device and the
 *   status says so. A pack or a preset bigger than 11 MB stays on this device.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { packPreset, unpackPreset, type Preset } from '../preset';
import { AuthService } from './auth.service';
import { persisted } from './persisted';
import { PresetService } from './preset.service';
import { SoundboardStore, type CustomSound } from './soundboard.store';
import { StickerStore, type Sticker, type StickerPack } from './sticker.store';
import { VaultService, type BackupItem, type BackupMeta } from './vault.service';

/** The biggest copy kept in the account (the encrypted item may weigh 12 MB). */
const MAX_COPY_BYTES = 11 * 1024 * 1024;
/** How long after the last change the copies are compared (a burst of changes is one comparison). */
const AFTER_CHANGE_MS = 4000;
/** Where this device remembers the copies it last saw in the account. */
const MEMORY_KEY = 'chatterly.library.synced';
/** The beginning of a packed sticker pack. */
const PACK_MAGIC = 'CHATTERLY-STICKERS';
/** The most stickers, and the biggest sticker, a copy may bring back. */
const MAX_PACK_ITEMS = 300;
const MAX_STICKER_BYTES = 1024 * 1024;

/** What this device knows about the copy of one pack or preset. */
interface Remembered {
  id: string;
  hash: string;
}

/** One pack or preset of this device, ready to compare. */
interface LocalThing {
  kind: BackupMeta['kind'];
  ref: string;
  name: string;
  createdAt: number;
  bytes: Uint8Array<ArrayBuffer>;
  hash: string;
}

/** How the copies are going, for Settings. */
export type LibrarySyncStatus = 'off' | 'idle' | 'working' | 'synced' | 'full' | 'error';

/** The SHA-256 of some bytes, in hex. */
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, function hex(byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

/** Packs a sticker pack into bytes: the magic, the length of a header, the header (JSON) and the pictures one after another. */
async function packStickers(pack: StickerPack): Promise<Uint8Array<ArrayBuffer>> {
  const header = {
    v: 1,
    name: pack.name,
    items: pack.items.map(function describe(item) {
      return { id: item.id, type: item.blob.type, size: item.blob.size, move: item.move };
    }),
  };
  const head = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, head.length);
  const blob = new Blob([
    PACK_MAGIC,
    length,
    head,
    ...pack.items.map(function bytesOf(item) {
      return item.blob;
    }),
  ]);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Reads a packed sticker pack (null when it is not one, or it is damaged). Every value is checked again. */
function unpackStickers(
  bytes: Uint8Array<ArrayBuffer>,
  ref: string,
  createdAt: number,
): StickerPack | null {
  try {
    const magic = new TextEncoder().encode(PACK_MAGIC);
    if (bytes.length < magic.length + 4) return null;
    if (new TextDecoder().decode(bytes.subarray(0, magic.length)) !== PACK_MAGIC) return null;
    const headLength = new DataView(bytes.buffer, bytes.byteOffset + magic.length, 4).getUint32(0);
    const start = magic.length + 4;
    if (headLength > 200_000 || start + headLength > bytes.length) return null;
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + headLength)));
    if (header?.v !== 1 || !Array.isArray(header.items)) return null;
    const items: Sticker[] = [];
    let at = start + headLength;
    for (const piece of header.items.slice(0, MAX_PACK_ITEMS)) {
      const size = Number(piece?.size);
      if (!Number.isInteger(size) || size < 0 || at + size > bytes.length) return null;
      const type = String(piece.type ?? '');
      if (size <= MAX_STICKER_BYTES && /^image\/(webp|png|jpeg|gif)$/.test(type)) {
        const move = Number(piece.move);
        items.push({
          id: /^[\w-]{1,80}$/.test(String(piece.id)) ? String(piece.id) : crypto.randomUUID(),
          blob: new Blob([bytes.slice(at, at + size)], { type }),
          ...(Number.isInteger(move) && move >= 0 && move <= 5 ? { move } : {}),
        });
      }
      at += size;
    }
    if (items.length === 0) return null;
    return {
      id: ref,
      name: String(header.name ?? '').slice(0, 60) || 'Stickers',
      createdAt,
      items,
    };
  } catch {
    return null;
  }
}

/** The beginning of a packed sound, and the biggest sound a copy may bring back. */
const SOUND_MAGIC = 'CHATTERLY-SOUND';
const MAX_SOUND_BYTES = 11 * 1024 * 1024;

/** Packs a sound: the magic, the length of a header, the header (JSON), the sound and, when it fits, the whole file it was cut from. */
async function packSound(clip: CustomSound): Promise<Uint8Array<ArrayBuffer>> {
  const keepOriginal = !!clip.original && clip.blob.size + clip.original.size < MAX_SOUND_BYTES - 4096;
  const header = {
    v: 1,
    name: clip.name,
    emoji: clip.emoji,
    category: clip.category,
    start: clip.start,
    end: clip.end,
    duration: clip.duration,
    type: clip.blob.type,
    size: clip.blob.size,
    originalType: keepOriginal ? clip.original!.type : undefined,
    originalSize: keepOriginal ? clip.original!.size : undefined,
  };
  const head = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, head.length);
  const parts: BlobPart[] = [SOUND_MAGIC, length, head, clip.blob];
  if (keepOriginal) parts.push(clip.original!);
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

/** Reads a packed sound (null when it is not one, or it is damaged). Every value is checked again. */
function unpackSound(
  bytes: Uint8Array<ArrayBuffer>,
  ref: string,
  createdAt: number,
): CustomSound | null {
  try {
    const magic = new TextEncoder().encode(SOUND_MAGIC);
    if (bytes.length < magic.length + 4) return null;
    if (new TextDecoder().decode(bytes.subarray(0, magic.length)) !== SOUND_MAGIC) return null;
    const headLength = new DataView(bytes.buffer, bytes.byteOffset + magic.length, 4).getUint32(0);
    const start = magic.length + 4;
    if (headLength > 20_000 || start + headLength > bytes.length) return null;
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + headLength)));
    if (header?.v !== 1) return null;
    const size = Number(header.size);
    const type = String(header.type ?? '');
    const at = start + headLength;
    if (!Number.isInteger(size) || size <= 0 || at + size > bytes.length) return null;
    if (!/^audio\/[\w.+-]{1,40}$/.test(type)) return null;
    const number = function number(value: unknown): number | undefined {
      const n = Number(value);
      return value !== undefined && value !== null && Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const clip: CustomSound = {
      id: ref,
      name: String(header.name ?? '').slice(0, 60) || 'Sound',
      blob: new Blob([bytes.slice(at, at + size)], { type }),
      start: number(header.start),
      end: number(header.end),
      duration: number(header.duration),
      createdAt,
    };
    if (typeof header.emoji === 'string' && header.emoji.length <= 16) clip.emoji = header.emoji;
    if (typeof header.category === 'string' && /^[\w-]{1,80}$/.test(header.category)) {
      clip.category = header.category;
    }
    const originalSize = Number(header.originalSize);
    const originalType = String(header.originalType ?? '');
    if (
      Number.isInteger(originalSize) &&
      originalSize > 0 &&
      at + size + originalSize <= bytes.length &&
      /^audio\/[\w.+-]{1,40}$/.test(originalType)
    ) {
      clip.original = new Blob([bytes.slice(at + size, at + size + originalSize)], {
        type: originalType,
      });
    }
    return clip;
  } catch {
    return null;
  }
}

/** Keeps the copies of the packs, presets and sounds in the account. */
@Injectable({ providedIn: 'root' })
export class LibrarySyncService {
  private readonly auth = inject(AuthService);
  private readonly vault = inject(VaultService);
  private readonly stickers = inject(StickerStore);
  private readonly presets = inject(PresetService);
  private readonly sounds = inject(SoundboardStore);

  /** On this device: keep a copy of the packs, presets and sounds in the account. */
  readonly enabled = persisted<boolean>('sync.library', true);
  readonly status = signal<LibrarySyncStatus>('idle');

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;
  /** Changes made by the comparison itself (a copy that came down) do not start another one. */
  private quiet = false;

  constructor() {
    effect(this.follow.bind(this));
    effect(this.watch.bind(this));
  }

  /** Starts comparing once the account list is read, while the person wants copies. */
  private follow(): void {
    const ready = this.auth.isAuthenticated() && this.vault.accountRead();
    const on = this.enabled();
    untracked(this.onReady.bind(this, ready, on));
  }

  private onReady(ready: boolean, on: boolean): void {
    if (!on) {
      clearTimeout(this.timer);
      this.status.set('off');
      return;
    }
    if (this.status() === 'off') {
      this.status.set('idle');
    }
    if (ready) {
      this.schedule(500);
    }
  }

  /** A pack or a preset changed on this device: compare a moment later. */
  private watch(): void {
    this.stickers.packs();
    this.presets.presets();
    this.sounds.clips();
    if (!this.quiet) {
      untracked(this.schedule.bind(this, AFTER_CHANGE_MS));
    }
  }

  /** Compares after `wait` milliseconds (a new call moves the time). */
  private schedule(wait: number): void {
    if (!this.enabled() || !this.auth.isAuthenticated() || !this.vault.accountRead()) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(this.run.bind(this), wait);
  }

  /** Compares now (Settings has a button for it). */
  syncNow(): void {
    this.schedule(0);
  }

  /** One comparison at a time; a change during one starts another one at the end. */
  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.status.set('working');
    try {
      const full = await this.compare();
      this.status.set(full ? 'full' : 'synced');
    } catch {
      this.status.set('error');
    } finally {
      this.running = false;
    }
    if (this.again) {
      this.again = false;
      this.schedule(AFTER_CHANGE_MS);
    }
  }

  /** What this device remembers of the account. */
  private remembered(): Record<string, Remembered> {
    try {
      const raw = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') as Record<
        string,
        Remembered
      >;
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  private remember(memory: Record<string, Remembered>): void {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    } catch {
      /* storage full: the next comparison works it out again from the account */
    }
  }

  /** The packs and presets of this device, packed and hashed. */
  private async localThings(): Promise<Map<string, LocalThing>> {
    await Promise.all([this.stickers.load(), this.presets.load(), this.sounds.load()]);
    const out = new Map<string, LocalThing>();
    for (const clip of this.sounds.clips()) {
      out.set('sound:' + clip.id, await this.soundThing(clip));
    }
    for (const pack of this.stickers.packs()) {
      out.set('stickers:' + pack.id, await this.packThing(pack));
    }
    for (const preset of this.presets.presets()) {
      out.set('preset:' + preset.id, await this.presetThing(preset));
    }
    return out;
  }

  /** A sticker pack, packed and hashed. */
  private async packThing(pack: StickerPack): Promise<LocalThing> {
    const bytes = await packStickers(pack);
    return {
      kind: 'stickers',
      ref: pack.id,
      name: pack.name,
      createdAt: pack.createdAt,
      bytes,
      hash: await sha256(bytes),
    };
  }

  /** A sound, packed and hashed. */
  private async soundThing(clip: CustomSound): Promise<LocalThing> {
    const bytes = await packSound(clip);
    return {
      kind: 'sound',
      ref: clip.id,
      name: clip.name,
      createdAt: clip.createdAt,
      bytes,
      hash: await sha256(bytes),
    };
  }

  /** A preset, packed and hashed. */
  private async presetThing(preset: Preset): Promise<LocalThing> {
    const { file } = await packPreset(preset);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      kind: 'preset',
      ref: preset.id,
      name: preset.name,
      createdAt: preset.createdAt,
      bytes,
      hash: await sha256(bytes),
    };
  }

  /** The newest copy of each pack and preset in the account (older duplicates are removed). */
  private async accountThings(): Promise<Map<string, BackupItem>> {
    const out = new Map<string, BackupItem>();
    for (const item of this.vault.backups()) {
      const key = item.meta.kind + ':' + item.meta.ref;
      const known = out.get(key);
      if (!known || item.savedAt > known.savedAt) {
        if (known) await this.vault.removeBackup(known.id);
        out.set(key, item);
      } else {
        await this.vault.removeBackup(item.id);
      }
    }
    return out;
  }

  /** Compares this device with the account and moves what changed. Returns true when the account had no room for something. */
  private async compare(): Promise<boolean> {
    await this.vault.reloadAccount();
    const memory = this.remembered();
    const local = await this.localThings();
    const account = await this.accountThings();
    let full = false;

    for (const [key, thing] of local) {
      const copy = account.get(key);
      const known = memory[key];
      if (!copy) {
        if (known) {
          // Synced before and gone from the account: another device deleted it.
          await this.deleteHere(thing);
          delete memory[key];
        } else if (!(await this.upload(thing, memory, key))) {
          full = true;
        }
        continue;
      }
      // The same, or nothing changed on either side since the last sync (the copy this device saw, and the bytes it had then).
      if (
        copy.meta.hash === thing.hash ||
        (known && known.id === copy.id && known.hash === thing.hash)
      ) {
        memory[key] = { id: copy.id, hash: thing.hash };
        continue;
      }
      if (known && known.id !== copy.id) {
        // Another device saved a newer copy since this one last looked: it comes down (it wins over a change here too).
        await this.download(copy, memory, key);
      } else if (await this.upload(thing, memory, key)) {
        // Only this device changed it (or it never saw the copy): this one goes up and replaces it.
        await this.vault.removeBackup(copy.id);
      } else {
        full = true;
      }
    }

    for (const [key, copy] of account) {
      if (local.has(key)) continue;
      const known = memory[key];
      if (known && known.id === copy.id) {
        // It was here, synced, and the person deleted it here: it goes from the account too.
        await this.vault.removeBackup(copy.id);
        delete memory[key];
      } else {
        await this.download(copy, memory, key);
      }
    }

    // What this device remembers of things that exist nowhere any more is forgotten.
    for (const key of Object.keys(memory)) {
      if (!local.has(key) && !account.has(key)) delete memory[key];
    }
    this.remember(memory);
    return full;
  }

  /** Sends a copy of one pack or preset. False when the account has no room for it (or it is too big). */
  private async upload(
    thing: LocalThing,
    memory: Record<string, Remembered>,
    key: string,
  ): Promise<boolean> {
    if (thing.bytes.length > MAX_COPY_BYTES) {
      return false;
    }
    try {
      const id = await this.vault.addBackup(
        {
          kind: thing.kind,
          ref: thing.ref,
          name: thing.name,
          createdAt: thing.createdAt,
          hash: thing.hash,
        },
        thing.bytes,
      );
      memory[key] = { id, hash: thing.hash };
      return true;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 413 || status === 429) {
        return false;
      }
      throw error;
    }
  }

  /** Brings a copy of the account to this device (a copy that cannot be read is left as it is). */
  private async download(
    copy: BackupItem,
    memory: Record<string, Remembered>,
    key: string,
  ): Promise<void> {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await this.vault.openBackup(copy);
    } catch {
      return;
    }
    this.quiet = true;
    try {
      // What came down is remembered with the hash this device makes of it, so it is not sent back up as a change.
      let hash: string;
      if (copy.meta.kind === 'stickers') {
        const pack = unpackStickers(bytes, copy.meta.ref, copy.meta.createdAt);
        if (!pack) return;
        await this.stickers.restore(pack);
        hash = (await this.packThing(pack)).hash;
      } else if (copy.meta.kind === 'sound') {
        const clip = unpackSound(bytes, copy.meta.ref, copy.meta.createdAt);
        if (!clip) return;
        await this.sounds.restore(clip);
        hash = (await this.soundThing(clip)).hash;
      } else {
        const read = await unpackPreset(new Blob([bytes]));
        if (!read) return;
        const preset: Preset = { ...read, id: copy.meta.ref, createdAt: copy.meta.createdAt };
        await this.presets.save(preset);
        hash = (await this.presetThing(preset)).hash;
      }
      memory[key] = { id: copy.id, hash };
    } finally {
      // The signals of the stores change in this task: the effect that follows them has run by the next one.
      setTimeout(this.endQuiet.bind(this), 0);
    }
  }

  private endQuiet(): void {
    this.quiet = false;
  }

  /** Deletes here a pack or preset that another device deleted. */
  private async deleteHere(thing: LocalThing): Promise<void> {
    this.quiet = true;
    try {
      if (thing.kind === 'stickers') await this.stickers.removePack(thing.ref);
      else if (thing.kind === 'sound') await this.sounds.remove(thing.ref);
      else await this.presets.remove(thing.ref);
    } finally {
      setTimeout(this.endQuiet.bind(this), 0);
    }
  }
}
