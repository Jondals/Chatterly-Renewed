/**
 * src/app/core/services/wallpaper.store.ts
 * The wallpaper of the person, kept on this device only (IndexedDB). It can be a picture, an animated one (GIF,
 * animated WebP or APNG, which the browser animates by itself) or a short video (MP4 or WebM, played muted in a
 * loop). It is kept as it was picked, so animations are not lost.
 */
import { Injectable, signal } from '@angular/core';
import { pickFile } from '../file-picker';
import { runInStore, type StoreLocation } from '../indexed-db';

const LOCATION: StoreLocation = { database: 'chatterly-renewed-wallpaper', store: 'bg' };
const KEY = 'current';
/** The biggest picture (GIFs included) and video accepted, in bytes. */
export const WALLPAPER_MAX_IMAGE = 12 * 1024 * 1024;
export const WALLPAPER_MAX_VIDEO = 25 * 1024 * 1024;
/** What the file chooser offers. */
export const WALLPAPER_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm';

/** The wallpaper kept on the device. */
@Injectable({ providedIn: 'root' })
export class WallpaperStore {
  /** Address of the wallpaper for the page ('' when there is none). */
  readonly url = signal('');
  /** Whether it is a video or a picture. */
  readonly kind = signal<'image' | 'video'>('image');
  private loaded = false;

  /** Reads the saved wallpaper (only the first time). */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const saved = await runInStore<Blob | undefined>(LOCATION, 'readonly', function get(store) {
        return store.get(KEY);
      });
      if (saved) {
        this.show(saved);
      }
    } catch {
      // No storage: no wallpaper of this kind.
    }
  }

  /** Lets the person choose a file and keeps it. Throws a readable message when it is not valid. */
  async choose(): Promise<boolean> {
    const file = await pickFile(WALLPAPER_ACCEPT);
    if (!file) {
      return false;
    }
    const video = file.type.startsWith('video/');
    if (!video && !file.type.startsWith('image/')) {
      throw new Error('That is not a picture or a video.');
    }
    if (file.size > (video ? WALLPAPER_MAX_VIDEO : WALLPAPER_MAX_IMAGE)) {
      throw new Error(
        video ? 'The video is bigger than 25 MB.' : 'The picture is bigger than 12 MB.',
      );
    }
    await runInStore(LOCATION, 'readwrite', function put(store) {
      return store.put(file, KEY);
    });
    this.show(file);
    return true;
  }

  /** The saved wallpaper as a file (null when there is none): a preset keeps it. */
  async read(): Promise<Blob | null> {
    try {
      const saved = await runInStore<Blob | undefined>(LOCATION, 'readonly', function get(store) {
        return store.get(KEY);
      });
      // ! A copy in memory: a file that IndexedDB hands out stops being valid when its record is replaced or deleted (and
      // putting it back then fails with "the operation failed for reasons unrelated to the database state").
      return saved ? new Blob([await saved.arrayBuffer()], { type: saved.type }) : null;
    } catch {
      return null;
    }
  }

  /** Puts a file as the wallpaper (a preset brings it). Throws a readable message when it is too big. */
  async set(file: Blob): Promise<void> {
    const video = file.type.startsWith('video/');
    if (file.size > (video ? WALLPAPER_MAX_VIDEO : WALLPAPER_MAX_IMAGE)) {
      throw new Error(
        video ? 'The video is bigger than 25 MB.' : 'The picture is bigger than 12 MB.',
      );
    }
    await runInStore(LOCATION, 'readwrite', function put(store) {
      return store.put(file, KEY);
    });
    this.show(file);
  }

  /** Forgets the wallpaper. */
  async remove(): Promise<void> {
    await runInStore(LOCATION, 'readwrite', function del(store) {
      return store.delete(KEY);
    });
    const old = this.url();
    this.url.set('');
    if (old) {
      URL.revokeObjectURL(old);
    }
  }

  /** Puts a file on screen. */
  private show(blob: Blob): void {
    const old = this.url();
    this.kind.set(blob.type.startsWith('video/') ? 'video' : 'image');
    this.url.set(URL.createObjectURL(blob));
    if (old) {
      URL.revokeObjectURL(old);
    }
  }
}
