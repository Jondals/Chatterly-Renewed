/**
 * src/app/core/services/preset.service.ts
 * The presets of the person (see core/preset.ts): they are kept on this device (IndexedDB, with their wallpapers, fonts and
 * pictures), applied in one press, updated from what the person has now, and shared in a chat so that a friend gets them
 * with one button.
 */
import { Injectable, inject, signal } from '@angular/core';
import { packBlobs, runInStore, unpackBlobs, type StoreLocation } from '../indexed-db';
import {
  PROFILE_FIELDS,
  THEME_KEYS,
  cleanName,
  cleanProfileData,
  cleanThemeData,
  packPreset,
  unpackPreset,
  SHARE_LIMIT,
  type AssetName,
  type Preset,
  type PresetKind,
} from '../preset';
import { presetCardPicture } from '../preset-card';
import { applyPersisted, snapshotPersisted } from './persisted';
import type { User } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DirectoryService } from './directory.service';
import { FontService } from './font.service';
import { WallpaperStore } from './wallpaper.store';
import { MessageStore, type ViewAttachment } from '../../store/message.store';

const LOCATION: StoreLocation = {
  database: 'chatterly-renewed-presets',
  store: 'presets',
  keyPath: 'id',
};
/** How many presets of each kind a person keeps. */
export const MAX_PRESETS = 12;
/** The kinds of picture a wallpaper preset may bring. */
const WALLPAPER_TYPE = /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm))$/;

/** Saves, applies and shares presets. */
@Injectable({ providedIn: 'root' })
export class PresetService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly directory = inject(DirectoryService);
  private readonly fonts = inject(FontService);
  private readonly wallpaper = inject(WallpaperStore);
  private readonly messages = inject(MessageStore);

  /** The theme being tried (it is on the app now; the person keeps it or goes back). */
  readonly trying = signal<{ preset: Preset; before: Preset } | null>(null);
  /** The preset of a profile that is being looked at. */
  readonly previewing = signal<Preset | null>(null);

  /** Every preset, the newest first. */
  readonly presets = signal<Preset[]>([]);
  private loaded = false;

  /** Reads the presets (the first time). */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const all = await runInStore<Preset[]>(LOCATION, 'readonly', function readAll(store) {
        return store.getAll();
      });
      this.presets.set(this.sorted(unpackBlobs(all)));
    } catch {
      this.presets.set([]);
    }
  }

  /** The presets of a kind. */
  ofKind(kind: PresetKind): Preset[] {
    return this.presets().filter(function same(preset) {
      return preset.kind === kind;
    });
  }

  /** Newest first. */
  private sorted(list: Preset[]): Preset[] {
    return [...list].sort(function byDate(a, b) {
      return b.createdAt - a.createdAt;
    });
  }

  /** Keeps a preset (new or changed). */
  async save(preset: Preset): Promise<void> {
    const packed = await packBlobs(preset);
    await runInStore(LOCATION, 'readwrite', function put(store) {
      return store.put(packed);
    }).catch(function failed() {
      /* the same preset stays in memory for this visit */
    });
    this.presets.set(
      this.sorted([
        ...this.presets().filter(function other(item) {
          return item.id !== preset.id;
        }),
        preset,
      ]),
    );
  }

  /** Deletes a preset. */
  async remove(id: string): Promise<void> {
    await runInStore(LOCATION, 'readwrite', function del(store) {
      return store.delete(id);
    }).catch(function failed() {
      /* it goes from the list anyway */
    });
    this.presets.set(
      this.presets().filter(function other(item) {
        return item.id !== id;
      }),
    );
  }

  /** Gives a preset a picture of its own (or takes it away with null). */
  async setThumb(id: string, picture: Blob | null): Promise<void> {
    const found = this.presets().find(function same(item) {
      return item.id === id;
    });
    if (!found) {
      return;
    }
    const assets = { ...found.assets };
    if (picture) {
      assets.thumb = picture;
    } else {
      delete assets.thumb;
    }
    await this.save({ ...found, assets });
  }

  /** Changes the name of a preset. */
  async rename(id: string, name: string): Promise<void> {
    const found = this.presets().find(function same(item) {
      return item.id === id;
    });
    const clean = cleanName(name);
    if (found && clean) {
      await this.save({ ...found, name: clean });
    }
  }

  /** Makes a preset of a kind with what the person has now. */
  async capture(kind: PresetKind, name: string, id?: string): Promise<Preset> {
    const old = id
      ? this.presets().find(function same(item) {
          return item.id === id;
        })
      : undefined;
    const preset: Preset = {
      id: old?.id ?? crypto.randomUUID(),
      kind,
      name: cleanName(name) || old?.name || (kind === 'theme' ? 'Theme' : 'Profile'),
      createdAt: old?.createdAt ?? Date.now(),
      data: kind === 'theme' ? this.currentTheme() : this.currentProfile(),
      assets: kind === 'theme' ? await this.themeAssets() : await this.profileAssets(),
    };
    // the picture the person gave to the preset stays when it is updated
    if (old?.assets.thumb) {
      preset.assets.thumb = old.assets.thumb;
    }
    await this.save(preset);
    return preset;
  }

  /** The settings that make the look of the app now. */
  private currentTheme(): Record<string, unknown> {
    const wanted = new Set(THEME_KEYS);
    return snapshotPersisted(function pick(key) {
      return wanted.has(key);
    });
  }

  /** The fields of the profile now. */
  private currentProfile(): Record<string, unknown> {
    const user = this.auth.user() as unknown as Record<string, unknown> | null;
    const data: Record<string, unknown> = {};
    for (const field of PROFILE_FIELDS) {
      data[field] = user?.[field] ?? '';
    }
    return data;
  }

  /** The custom pieces of the theme now. */
  private async themeAssets(): Promise<Preset['assets']> {
    const assets: Preset['assets'] = {};
    const wallpaper = await this.wallpaper.read();
    if (wallpaper) {
      assets.wallpaper = wallpaper;
    }
    const font = await this.fonts.read('ui');
    if (font) {
      assets.fontUi = new Blob([font], { type: 'font/ttf' });
    }
    return assets;
  }

  /** The custom pieces of the profile now (the pictures are opened to be kept: they are the person's own). */
  private async profileAssets(): Promise<Preset['assets']> {
    const assets: Preset['assets'] = {};
    // (the pictures of the profile, the photo and the banner image, are the person's own: a preset never takes them or changes
    // them; the banner color or gradient is a field and goes with it)
    const font = await this.fonts.read('name');
    if (font) {
      assets.fontName = new Blob([font], { type: 'font/ttf' });
    }
    return assets;
  }

  /** Puts a theme on the app: its settings and its custom pieces. */
  async applyTheme(preset: Preset): Promise<void> {
    const wallpaper = preset.assets.wallpaper;
    if (wallpaper && WALLPAPER_TYPE.test(wallpaper.type)) {
      await this.wallpaper.set(wallpaper);
    } else {
      await this.wallpaper.remove();
    }
    const font = preset.assets.fontUi;
    if (font) {
      await this.fonts.set('ui', await font.arrayBuffer(), preset.name);
    }
    applyPersisted(cleanThemeData(preset.data));
  }

  /**
   * What a profile preset changes: the fields go back to the caller (they are put in the draft, and the person saves them);
   * the font of the name is applied at once.
   */
  async applyProfile(preset: Preset): Promise<Record<string, unknown>> {
    const font = preset.assets.fontName;
    if (font) {
      await this.fonts.set('name', await font.arrayBuffer(), preset.name);
    }
    return cleanProfileData(preset.data);
  }

  /** Reads the preset of a message (checked piece by piece). Throws a readable message when it is not one. */
  private async read(att: ViewAttachment): Promise<Preset> {
    if (att.size > SHARE_LIMIT + 1024) {
      throw new Error('That preset is too big.');
    }
    const preset = await unpackPreset(await this.messages.attachmentBlob(att));
    if (!preset) {
      throw new Error('That is not a preset.');
    }
    return preset;
  }

  /** Keeps a preset of a message in the library. Throws a readable message when there is no room. */
  private async keep(preset: Preset): Promise<void> {
    await this.load();
    if (this.ofKind(preset.kind).length >= MAX_PRESETS) {
      throw new Error('You have too many presets of this kind. Delete one first.');
    }
    await this.save(preset);
  }

  /**
   * Takes a preset that arrived in a chat and keeps it; `use` also puts it on (a theme goes on the app, a profile goes to
   * the profile of the person).
   */
  async importFrom(att: ViewAttachment, use: boolean): Promise<Preset> {
    const preset = await this.read(att);
    await this.keep(preset);
    if (use) {
      await this.use(preset);
    }
    return preset;
  }

  /** Keeps a preset that was already read (and uses it when asked). */
  async keepOwned(preset: Preset, use: boolean): Promise<void> {
    await this.keep(preset);
    if (use) {
      await this.use(preset);
    }
  }

  /** Puts a preset on: a theme on the app, a profile on the profile of the person (saved at once). */
  async use(preset: Preset): Promise<void> {
    if (preset.kind === 'theme') {
      await this.applyTheme(preset);
      return;
    }
    const fields = await this.applyProfile(preset);
    const res = await this.api.patch<{ user: User }>('/api/me', fields);
    this.auth.setUser(res.user);
    this.directory.merge([res.user]);
  }

  /**
   * Lets the person try a preset of a message before keeping it: a theme goes on the app until they keep it or go back, a
   * profile opens in a window to look at.
   */
  async tryFrom(att: ViewAttachment): Promise<void> {
    const preset = await this.read(att);
    if (preset.kind === 'profile') {
      this.previewing.set(preset);
      return;
    }
    if (!this.trying()) {
      const before: Preset = {
        id: 'before',
        kind: 'theme',
        name: '',
        createdAt: 0,
        data: this.currentTheme(),
        assets: await this.themeAssets(),
      };
      this.trying.set({ preset, before });
    } else {
      this.trying.set({ preset, before: this.trying()!.before });
    }
    await this.applyTheme(preset);
  }

  /** The person keeps the theme they tried (it goes to the library) or goes back to the one they had. */
  async finishTrying(keep: boolean): Promise<void> {
    const state = this.trying();
    if (!state) {
      return;
    }
    this.trying.set(null);
    if (keep) {
      await this.keep(state.preset);
    } else {
      await this.applyTheme(state.before);
    }
  }

  /** Sends a preset to a chat: whoever gets it has a button to import it. Returns the pieces that did not fit. */
  async share(preset: Preset, channelId: string): Promise<AssetName[]> {
    const { file, left } = await packPreset(preset);
    await this.messages.send(channelId, {
      text: '',
      files: [
        {
          data: file,
          name: preset.name.replace(/[^\w .-]/g, '').trim() + '.chpreset',
          mime: file.type,
          preset: { kind: preset.kind, name: preset.name, thumb: await presetCardPicture(preset) },
        },
      ],
    });
    return left;
  }
}
