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
/** Biggest sticker kept as it is (1 MB) and longest side of the others (512 px). */
const MAX_STICKER_BYTES = 1024 * 1024;
const MAX_STICKER_SIDE = 512;
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

/** Whether a real picture was drawn on the canvas. */
function hasPicture(canvas: HTMLCanvasElement): boolean {
  return readCanvas(canvas) === 'picture';
}

/** The movements of an animated sticker (the keyframes go inside the picture, so it moves wherever it is shown). */
const MOVES: string[] = [
  '0%,100%{transform:translateY(0)}50%{transform:translateY(-22px)}',
  '0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}',
  '0%,100%{transform:scale(1)}50%{transform:scale(1.14)}',
  '0%,100%{transform:translateX(-10px)}50%{transform:translateX(10px)}',
  '0%,40%,100%{transform:rotate(0)}10%{transform:rotate(-14deg)}20%{transform:rotate(12deg)}30%{transform:rotate(-8deg)}',
  '0%,100%{transform:scale(1,1)}25%{transform:scale(1.1,0.9)}50%{transform:scale(0.92,1.1)}75%{transform:scale(1.05,0.96)}',
];

/**
 * An emoji as an ANIMATED vector picture (it moves in its own way, forever): it does not go through a canvas, so it works
 * where the canvas is protected, and it stays light (about 1 KB).
 */
function emojiSvg(emoji: string, move = 0): Blob {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><style>@keyframes m{' +
    MOVES[move % MOVES.length] +
    '}</style><g style="transform-origin:128px 150px;animation:m 1.8s ease-in-out infinite"><text x="128" y="132" font-size="190" text-anchor="middle" ' +
    'dominant-baseline="central" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, Twemoji Mozilla, sans-serif">' +
    emoji +
    '</text></g></svg>';
  return new Blob([svg], { type: 'image/svg+xml' });
}

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
    } catch {
      this.packs.set([]);
    }
    this.loaded.set(true);
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

  /** Turns any image into a sticker (at most 512 px; WebP and GIF are kept as they are to keep the animation). */
  private async normalize(blob: Blob): Promise<Blob | null> {
    if (blob.type === 'image/svg+xml') {
      return blob;
    }
    if (
      (blob.type === 'image/webp' || blob.type === 'image/gif') &&
      blob.size <= MAX_STICKER_BYTES
    ) {
      return blob;
    }
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, MAX_STICKER_SIDE / Math.max(bitmap.width, bitmap.height));
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
  async addImages(files: Blob[], pack?: { id?: string; name: string }): Promise<number> {
    const items: Sticker[] = [];
    for (const file of files) {
      const normalized = await this.normalize(file);
      if (normalized) {
        items.push({ id: crypto.randomUUID(), blob: normalized });
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

  /** A font that cannot be loaded is not an error here: the system emoji font is used instead. */
  private ignoreFont(): void {
    return;
  }

  /**
   * Draws one emoji on a canvas: first with the emoji font of the system (the web font of the emoji does not draw on the
   * canvas of some browsers, it leaves it blank), and with the web font only when the system has none.
   * @returns Whether something was drawn.
   */
  private async drawEmoji(canvas: HTMLCanvasElement, emoji: string): Promise<boolean> {
    const stacks = [
      '"Apple Color Emoji", "Segoe UI Emoji", "Twemoji Mozilla", sans-serif',
      '"Noto Color Emoji", sans-serif',
    ];
    for (const stack of stacks) {
      if (stack.startsWith('"Noto')) {
        // The emoji font arrives in pieces, only when a text needs them: ask for the piece of this emoji first.
        await Promise.race([
          document.fonts.load('200px "Noto Color Emoji"', emoji).catch(this.ignoreFont),
          new Promise<void>(function wait(resolve) {
            setTimeout(resolve, 1500);
          }),
        ]);
      }
      const context = canvas.getContext('2d')!;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = '200px ' + stack;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(emoji, 128, 140);
      if (hasPicture(canvas)) {
        return true;
      }
    }
    return false;
  }

  /** Makes 24 animated emoji as stickers, so the tab is useful from the first click. Returns how many were made. */
  async addStarterPack(): Promise<number> {
    const blobs = STARTER.map(function animated(emoji, index): Blob {
      return emojiSvg(emoji, index);
    });
    return this.addImages(blobs, { name: 'Emoji starter' });
  }

  /** Opens the file chooser and imports what the person picks. */
  async pickAndImport(): Promise<{ packs: number; stickers: number }> {
    const files = await pickFiles('.wastickers,.zip,.webp,.png,.jpg,.jpeg,.gif,image/*', true);
    return this.importFiles(files);
  }
}
