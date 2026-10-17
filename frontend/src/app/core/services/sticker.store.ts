/**
 * src/app/core/services/sticker.store.ts
 * The person's sticker packs (WhatsApp import included), kept in IndexedDB on this device only.
 */
import { Injectable, signal } from '@angular/core';
import { pickFiles } from '../file-picker';
import { packBlobs, runInStore, unpackBlobs, type StoreLocation } from '../indexed-db';
import { readZip } from '../zip';

/** One sticker: an image. */
export interface Sticker {
  id: string;
  blob: Blob;
  /** How it moves (0 to 5, see `stk` in styles/keyframes.css): the picture itself is still, the page moves it. */
  move?: number;
}

/** A pack of stickers. */
export interface StickerPack {
  id: string;
  name: string;
  createdAt: number;
  items: Sticker[];
}

const LOCATION: StoreLocation = {
  database: 'chatterly-renewed-stickers',
  store: 'packs',
  keyPath: 'id',
};
/** Biggest sticker kept as it is (1 MB) and longest side of the others (320 px). */
const MAX_STICKER_BYTES = 1024 * 1024;
// ? A sticker is drawn at 144 px (a bit more on a sharp screen): 320 px is plenty, and 512 px pictures made the conversation lag on a PC.
const MAX_STICKER_SIDE = 320;
/** Emoji turned into stickers by the starter pack. */
const STARTER = [
  '😀',
  '😂',
  '😍',
  '🥳',
  '😎',
  '🤔',
  '😭',
  '😡',
  '🙏',
  '👍',
  '👏',
  '🔥',
  '❤️',
  '🎉',
  '💀',
  '👀',
  '🚀',
  '🍕',
  '☕️',
  '🌈',
  '🐱',
  '🦊',
  '👻',
  '💯',
  '🥰',
  '😴',
  '🤯',
  '🥺',
  '😅',
  '🤣',
  '😇',
  '🤩',
  '😤',
  '🤗',
  '🫡',
  '🙄',
  '😏',
  '🤝',
  '💪',
  '🙌',
  '💔',
  '✨',
  '🎶',
  '🎮',
  '🍻',
  '🍩',
  '🐶',
  '🦄',
  '🌙',
  '⚡',
];
const IMAGE_EXTENSION = /\.(webp|png|jpe?g|gif)$/i;

/** Reads every pack. */
function readAll(store: IDBObjectStore): IDBRequest {
  return store.getAll();
}

/** Stores a pack. */
function writePack(pack: StickerPack, store: IDBObjectStore): IDBRequest {
  return store.put(pack);
}

/** Deletes a pack by id. */
function deletePack(id: string, store: IDBObjectStore): IDBRequest {
  return store.delete(id);
}

/** Orders packs from the oldest to the newest. */
function byCreation(first: StickerPack, second: StickerPack): number {
  return first.createdAt - second.createdAt;
}

/** Image type from a file name. */
function mimeOf(name: string): string {
  const extension = name.split('.').pop()!.toLowerCase();
  return extension === 'jpg' ? 'image/jpeg' : 'image/' + extension;
}

/** Renders a canvas as a WebP blob (PNG where the browser cannot encode WebP, and when it gives nothing the other way). */
async function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const encode = function (type: string): Promise<Blob | null> {
    return new Promise<Blob | null>(function run(resolve) {
      try {
        canvas.toBlob(resolve, type, quality);
      } catch {
        resolve(null);
      }
    });
  };
  return (await encode('image/webp')) ?? (await encode('image/png'));
}

/**
 * What the canvas gives back: 'blank' (nothing drawn), 'flat' (one single color all over: what browsers that protect
 * against fingerprinting, like Opera or Brave, return instead of the real picture) or 'picture'.
 */
function readCanvas(canvas: HTMLCanvasElement): 'blank' | 'flat' | 'picture' {
  try {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let drawn = false;
    let flat = true;
    for (let i = 0; i < data.length; i += 4 * 61) {
      drawn = drawn || data[i + 3]! > 0;
      flat =
        flat &&
        data[i] === data[0] &&
        data[i + 1] === data[1] &&
        data[i + 2] === data[2] &&
        data[i + 3] === data[3];
    }
    return !drawn ? 'blank' : flat ? 'flat' : 'picture';
  } catch {
    return 'blank';
  }
}

/** How many movements a sticker can have (the keyframes `stk-0`... are in styles/keyframes.css). */
const MOVE_COUNT = 6;

/**
 * An emoji as a STILL vector picture: it does not go through a canvas, so it works where the canvas is protected, and it
 * stays light (about 0.4 KB). The movement is not inside the picture (a picture that moves inside is drawn again every frame
 * and made the page lag): the page moves it with a transform, which the graphics chip does by itself.
 */
function emojiSvg(emoji: string): Blob {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><text x="128" y="132" font-size="190" text-anchor="middle" ' +
    'dominant-baseline="central" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, Twemoji Mozilla, sans-serif">' +
    emoji +
    '</text></svg>';
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** An old sticker whose picture moved inside: its picture is made still and the movement is kept apart. */
async function stillSticker(sticker: Sticker): Promise<Sticker | null> {
  if (sticker.blob.type !== 'image/svg+xml' || sticker.blob.size > 4096) {
    return null;
  }
  const text = await sticker.blob.text();
  if (!text.includes('@keyframes m{')) {
    return null;
  }
  const still = text.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<g style="[^"]*">/, '<g>');
  const guess = OLD_MOVES.findIndex(function same(move) {
    return text.includes(move);
  });
  return {
    ...sticker,
    blob: new Blob([still], { type: 'image/svg+xml' }),
    move: Math.max(0, guess),
  };
}

/** The keyframes the old emoji pictures carried, to know which movement each had. */
const OLD_MOVES: string[] = [
  '0%,100%{transform:translateY(0)}50%{transform:translateY(-22px)}',
  '0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}',
  '0%,100%{transform:scale(1)}50%{transform:scale(1.14)}',
  '0%,100%{transform:translateX(-10px)}50%{transform:translateX(10px)}',
  '0%,40%,100%{transform:rotate(0)}10%{transform:rotate(-14deg)}20%{transform:rotate(12deg)}30%{transform:rotate(-8deg)}',
  '0%,100%{transform:scale(1,1)}25%{transform:scale(1.1,0.9)}50%{transform:scale(0.92,1.1)}75%{transform:scale(1.05,0.96)}',
];

/**
 * Personal sticker packs, stored on this device only (IndexedDB). A sticker is just an image: when you send
 * one it is encrypted and uploaded like any other attachment, so the server never sees it. Import WhatsApp
 * packs (`.wastickers`, `.zip`) or individual `.webp`/`.png` files.
 */
@Injectable({ providedIn: 'root' })
export class StickerStore {
  readonly packs = signal<StickerPack[]>([]);
  readonly loaded = signal(false);
  private readonly urls = new Map<string, string>();

  /** Loads the packs from IndexedDB (only the first time it is called). */
  async load(): Promise<void> {
    if (this.loaded()) {
      return;
    }
    try {
      const packs = await runInStore<StickerPack[]>(LOCATION, 'readonly', readAll);
      this.packs.set(unpackBlobs(packs).sort(byCreation));
      await this.stopOldMotion();
    } catch {
      this.packs.set([]);
    }
    this.loaded.set(true);
  }

  /** The emoji stickers made before the movement moved out of the picture are made still, keeping how each one moves. */
  private async stopOldMotion(): Promise<void> {
    for (const pack of this.packs()) {
      const items: Sticker[] = [];
      let changed = false;
      for (const item of pack.items) {
        const still = await stillSticker(item);
        items.push(still ?? item);
        changed = changed || !!still;
      }
      if (changed) {
        await this.save({ ...pack, items });
      }
    }
  }

  /** Blob URL of a sticker (cached). */
  url(sticker: Sticker): string {
    let url = this.urls.get(sticker.id);
    if (!url) {
      url = URL.createObjectURL(sticker.blob);
      this.urls.set(sticker.id, url);
    }
    return url;
  }

  /** Finds a pack by id. */
  private findPack(id: string): StickerPack | undefined {
    for (const pack of this.packs()) {
      if (pack.id === id) {
        return pack;
      }
    }
    return undefined;
  }

  /** Saves a pack (new or changed) and updates the list. */
  private async save(pack: StickerPack): Promise<void> {
    await runInStore(LOCATION, 'readwrite', writePack.bind(null, await packBlobs(pack)));
    const others = this.packs().filter(function isOther(item: StickerPack) {
      return item.id !== pack.id;
    });
    this.packs.set([...others, pack].sort(byCreation));
  }

  /** Puts back a pack that came from the copy in the account (same id; it replaces the one of this device). */
  async restore(pack: StickerPack): Promise<void> {
    await this.load();
    await this.save(pack);
  }

  /** Deletes a whole pack. */
  async removePack(id: string): Promise<void> {
    await runInStore(LOCATION, 'readwrite', deletePack.bind(null, id));
    this.packs.set(
      this.packs().filter(function isOther(item: StickerPack) {
        return item.id !== id;
      }),
    );
  }

  /** Deletes one sticker; the pack goes with it when it was the last one. */
  async removeSticker(packId: string, stickerId: string): Promise<void> {
    const pack = this.findPack(packId);
    if (!pack) {
      return;
    }
    const items = pack.items.filter(function isOther(item: Sticker) {
      return item.id !== stickerId;
    });
    if (items.length === 0) {
      await this.removePack(packId);
    } else {
      await this.save({ ...pack, items });
    }
  }

  /** Renames a pack. */
  async rename(packId: string, name: string): Promise<void> {
    const pack = this.findPack(packId);
    if (pack && name.trim()) {
      await this.save({ ...pack, name: name.trim().slice(0, 40) });
    }
  }

  /** True for a WebP that is animated (its header says so); only those must be kept as they are. */
  private async isAnimatedWebp(blob: Blob): Promise<boolean> {
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const tag = String.fromCharCode(...head.slice(8, 16));
    // RIFF....WEBPVP8X: the flags byte comes after the chunk size; bit 1 is "animation".
    return tag === 'WEBPVP8X' && ((head[20] ?? 0) & 0x02) !== 0;
  }

  /** Turns any image into a sticker (at most 320 px; a GIF or an animated WebP is kept as it is to keep the animation). */
  private async normalize(blob: Blob): Promise<Blob | null> {
    if (blob.type === 'image/svg+xml') {
      return blob;
    }
    const isKept =
      blob.type === 'image/gif' || (blob.type === 'image/webp' && (await this.isAnimatedWebp(blob)));
    if (isKept && blob.size <= MAX_STICKER_BYTES) {
      return blob;
    }
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, MAX_STICKER_SIDE / Math.max(bitmap.width, bitmap.height));
      // ? A still picture that is already small enough is kept as it is (it would only be encoded again for nothing).
      if (scale === 1 && blob.type === 'image/webp' && blob.size <= MAX_STICKER_BYTES) {
        bitmap.close();
        return blob;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      // ? A browser that protects against fingerprinting gives back one flat color instead of the picture: then the
      // ! picture is kept as it was chosen (when it is small), never as a flat square.
      if (readCanvas(canvas) !== 'picture') {
        return blob.type.startsWith('image/') && blob.size <= MAX_STICKER_BYTES ? blob : null;
      }
      return await canvasToBlob(canvas, 0.9);
    } catch {
      return null;
    }
  }

  /** Adds images to an existing pack or creates a new one. Returns how many stickers were added. */
  async addImages(
    files: Blob[],
    pack?: { id?: string; name: string },
    moves: number[] = [],
  ): Promise<number> {
    const items: Sticker[] = [];
    for (const [at, file] of files.entries()) {
      const normalized = await this.normalize(file);
      if (normalized) {
        items.push({ id: crypto.randomUUID(), blob: normalized, move: moves[at] });
      }
    }
    if (items.length === 0) {
      return 0;
    }
    const existing = pack?.id ? this.findPack(pack.id) : undefined;
    if (existing) {
      await this.save({ ...existing, items: [...existing.items, ...items] });
    } else {
      await this.save({
        id: crypto.randomUUID(),
        name: (pack?.name ?? 'My stickers').slice(0, 40),
        createdAt: Date.now(),
        items,
      });
    }
    return items.length;
  }

  /**
   * Imports files: WhatsApp `.wastickers` / `.zip` packs (title.txt becomes the pack name) and loose
   * `.webp` / `.png` / `.jpg` / `.gif` files. Returns a summary for the interface.
   */
  async importFiles(files: File[]): Promise<{ packs: number; stickers: number }> {
    let packs = 0;
    let stickers = 0;
    const loose: File[] = [];
    for (const file of files) {
      if (/\.(wastickers|zip)$/i.test(file.name)) {
        const added = await this.importArchive(file);
        if (added > 0) {
          packs++;
          stickers += added;
        }
      } else if (file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name)) {
        loose.push(file);
      }
    }
    if (loose.length > 0) {
      const existing = this.findImportedPack();
      stickers += await this.addImages(loose, { id: existing?.id, name: 'Imported' });
      if (!existing) {
        packs++;
      }
    }
    return { packs, stickers };
  }

  /** The pack that receives loose imported images, if it already exists. */
  private findImportedPack(): StickerPack | undefined {
    for (const pack of this.packs()) {
      if (pack.name === 'Imported') {
        return pack;
      }
    }
    return undefined;
  }

  /** Imports a WhatsApp sticker archive as a new pack; returns how many stickers it had. */
  private async importArchive(file: File): Promise<number> {
    const entries = await readZip(await file.arrayBuffer());
    let name = file.name.replace(/\.[^.]+$/, '');
    const images: { name: string; blob: Blob }[] = [];
    for (const entry of entries) {
      if (/(^|\/)title\.txt$/i.test(entry.name)) {
        name = new TextDecoder().decode(entry.data).trim() || name;
      } else if (IMAGE_EXTENSION.test(entry.name) && !/tray|icon/i.test(entry.name)) {
        images.push({
          name: entry.name,
          blob: new Blob([entry.data], { type: mimeOf(entry.name) }),
        });
      }
    }
    images.sort(function byName(first, second) {
      return first.name.localeCompare(second.name, undefined, { numeric: true });
    });
    const blobs: Blob[] = [];
    for (const image of images) {
      blobs.push(image.blob);
    }
    return this.addImages(blobs, { name: name || 'WhatsApp pack' });
  }

  /** Makes 50 animated emoji as stickers, so the tab is useful from the first click. Returns how many were made. */
  async addStarterPack(): Promise<number> {
    const blobs = STARTER.map(emojiSvg);
    const moves = STARTER.map(function move(_emoji, index): number {
      return index % MOVE_COUNT;
    });
    return this.addImages(blobs, { name: 'Emoji starter' }, moves);
  }

  /** Opens the file chooser and imports what the person picks. */
  async pickAndImport(): Promise<{ packs: number; stickers: number }> {
    const files = await pickFiles('.wastickers,.zip,.webp,.png,.jpg,.jpeg,.gif,image/*', true);
    return this.importFiles(files);
  }
}
