/**
 * src/app/core/services/font.service.ts
 * Fonts the person uploads (one for the interface and one for their display name). The files stay on this device
 * (IndexedDB) and are registered with the browser's FontFace API, so nothing is sent anywhere.
 */
import { Injectable, inject, signal } from '@angular/core';
import { pickFile } from '../file-picker';
import { runInStore, type StoreLocation } from '../indexed-db';
import { SettingsService } from './settings.service';

/** Which font is meant: the one of the whole interface or the one of the display name. */
export type CustomFontKind = 'ui' | 'name';

const LOCATION: StoreLocation = { database: 'chatterly-renewed-fonts', store: 'fonts' };
/** The font family each kind is registered under (the stylesheet refers to these names). */
const FAMILIES: Record<CustomFontKind, string> = Object.fromEntries([
  ['ui', 'Chatterly Custom UI'],
  ['name', 'Chatterly Custom Name'],
]) as Record<CustomFontKind, string>;
/** Biggest font file accepted (5 MB): the fonts stay on this device, so the only limit is a sensible one. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Adds one to a counter. */
function bump(value: number): number {
  return value + 1;
}

/** Keeps and registers the uploaded fonts. */
@Injectable({ providedIn: 'root' })
export class FontService {
  private readonly settings = inject(SettingsService);
  private readonly faces = new Map<CustomFontKind, FontFace>();
  /** Changes each time the font of the name is uploaded, replaced or deleted (so it can be shared with friends again). */
  readonly nameFontVersion = signal(0);

  /** Registers the fonts that were uploaded on a previous visit. */
  constructor() {
    void this.restore('ui');
    void this.restore('name');
  }

  /** Lets the person pick a font file; it is checked, kept and applied. Throws a readable message when it fails. */
  async upload(kind: CustomFontKind): Promise<void> {
    const file = await pickFile('.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2');
    if (!file) {
      return;
    }
    if (file.size > MAX_BYTES) {
      throw new Error('Fonts can be up to 5 MB.');
    }
    const buffer = await file.arrayBuffer();
    await this.register(kind, buffer);
    await runInStore(LOCATION, 'readwrite', function put(store: IDBObjectStore) {
      return store.put(buffer, kind);
    });
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 30);
    if (kind === 'ui') {
      this.settings.customFontName.set(name);
    } else {
      this.settings.customNameFontName.set(name);
      this.nameFontVersion.update(bump);
    }
  }

  /** The bytes of the font of a kind (null when there is none): a preset keeps them. */
  async read(kind: CustomFontKind): Promise<ArrayBuffer | null> {
    const name =
      kind === 'ui' ? this.settings.customFontName() : this.settings.customNameFontName();
    if (!name) {
      return null;
    }
    try {
      return (
        (await runInStore<ArrayBuffer | undefined>(LOCATION, 'readonly', function get(store) {
          return store.get(kind);
        })) ?? null
      );
    } catch {
      return null;
    }
  }

  /** Puts a font on the app from its bytes (a preset brings them). Throws a readable message when it is not a font. */
  async set(kind: CustomFontKind, buffer: ArrayBuffer, name: string): Promise<void> {
    if (buffer.byteLength > MAX_BYTES) {
      throw new Error('Fonts can be up to 5 MB.');
    }
    await this.register(kind, buffer);
    await runInStore(LOCATION, 'readwrite', function put(store: IDBObjectStore) {
      return store.put(buffer, kind);
    });
    const label = name.slice(0, 30);
    if (kind === 'ui') {
      this.settings.customFontName.set(label);
    } else {
      this.settings.customNameFontName.set(label);
      this.nameFontVersion.update(bump);
    }
  }

  /** Deletes an uploaded font. */
  async remove(kind: CustomFontKind): Promise<void> {
    const face = this.faces.get(kind);
    if (face) {
      document.fonts.delete(face);
      this.faces.delete(kind);
    }
    await runInStore(LOCATION, 'readwrite', function remove(store: IDBObjectStore) {
      return store.delete(kind);
    });
    if (kind === 'ui') {
      this.settings.customFontName.set('');
      if (this.settings.font() === 'custom') {
        this.settings.font.set('inter');
      }
    } else {
      this.settings.customNameFontName.set('');
      this.nameFontVersion.update(bump);
    }
  }

  /** Loads a stored font file (if any) and registers it. */
  private async restore(kind: CustomFontKind): Promise<void> {
    try {
      const buffer = await runInStore<ArrayBuffer | undefined>(
        LOCATION,
        'readonly',
        function get(store: IDBObjectStore) {
          return store.get(kind);
        },
      );
      if (buffer) {
        await this.register(kind, buffer);
      }
    } catch {
      // No stored font, or storage is not available: the normal fonts are used.
    }
  }

  /** Parses the font data (throws when it is not a usable font) and adds it to the page. */
  private async register(kind: CustomFontKind, buffer: ArrayBuffer): Promise<void> {
    const face = new FontFace(FAMILIES[kind], buffer);
    try {
      await face.load();
    } catch {
      throw new Error('That file is not a usable font.');
    }
    const previous = this.faces.get(kind);
    if (previous) {
      document.fonts.delete(previous);
    }
    document.fonts.add(face);
    this.faces.set(kind, face);
  }
}
