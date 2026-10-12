/**
 * src/app/core/services/name-font-share.service.ts
 * The font a person uploads for their name, seen by their friends.
 *
 * * The OWNER side: the font file stays on the device (FontService), and here it is also sent, ENCRYPTED like a profile
 *   picture (the server only stores ciphertext, the key is sealed for each person who may see it), and the profile points to
 *   it. It is sent again only when the font changes.
 * * The VIEWER side: a name whose font is "custom:<id>" gets the font file opened (decrypted with the key sealed for this
 *   person), registered with the browser under its own name and given a class, `font-name-cf-<id>`, that every place
 *   that draws names already uses (see fontClassOf).
 * ! A font file made by somebody else is parsed by the browser. It is small (1.5 MB at most), the browser checks it before
 *   using it (and refuses what is damaged), and it is only opened for the people whose profile this person may see. The
 *   person can turn it off in Settings > Privacy & security ("Show the fonts of other people").
 */
import { Injectable, effect, inject, untracked } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DirectoryService } from './directory.service';
import { FontService } from './font.service';
import { ImageService } from './image.service';
import { SettingsService } from './settings.service';
import { ToastService } from './toast.service';
import type { User } from '../models';

/** The biggest font file that is shared (bytes): the same limit as the server. */
const MAX_SHARED_BYTES = 1536 * 1024;
/** What this browser remembers of the font it sent: which file (a hash of its bytes) and the id it got. */
const SENT_KEY = 'chatterly.nameFontSent';
/** Matches the name of a shared font and gives its id. */
const SHARED = /^custom:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Keeps the own font shared and the fonts of other people drawn. */
@Injectable({ providedIn: 'root' })
export class NameFontShareService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly directory = inject(DirectoryService);
  private readonly fonts = inject(FontService);
  private readonly images = inject(ImageService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  /** The fonts that were registered or are being opened (by id of the file). */
  private readonly started = new Set<string>();
  /** The rules of the classes of the shared fonts. */
  private sheet: CSSStyleSheet | null = null;
  private sending = false;
  private warnedTooBig = false;

  constructor() {
    effect(this.syncOwn.bind(this));
    effect(this.openFonts.bind(this));
  }

  /** Sends the own font when there is one that the profile does not point to yet (or that changed). */
  private syncOwn(): void {
    // Read here so the effect runs again when a font is uploaded or removed.
    this.fonts.nameFontVersion();
    const name = this.settings.customNameFontName();
    const user = this.auth.user();
    if (!this.auth.isAuthenticated() || !user || !name) {
      return;
    }
    untracked(this.sendOwn.bind(this, user));
  }

  /** The work of `syncOwn`: sends the font file if it is new. */
  private async sendOwn(user: User): Promise<void> {
    if (this.sending) {
      return;
    }
    this.sending = true;
    try {
      const bytes = await this.fonts.read('name');
      if (!bytes) {
        return;
      }
      if (bytes.byteLength > MAX_SHARED_BYTES) {
        if (!this.warnedTooBig) {
          this.warnedTooBig = true;
          this.toast.info(
            this.i18n.t('Your font is too big to share'),
            this.i18n.t('Friends see the default font instead. Use a font of up to 1.5 MB.'),
          );
        }
        return;
      }
      const hash = await digest(bytes);
      const sent = readSent(user.id);
      const pointed = (user as User & { nameFontImage?: string | null }).nameFontImage ?? null;
      if (pointed && sent?.hash === hash && sent.id === pointed) {
        return;
      }
      const id = await this.images.upload('font', new Blob([bytes]));
      const response = await this.api.patch<{ user: User }>('/api/me', { nameFontImage: id });
      this.auth.setUser(response.user);
      this.directory.merge([response.user]);
      localStorage.setItem(SENT_KEY, JSON.stringify({ user: user.id, id, hash }));
    } catch {
      // The font could not be sent now: it is tried again the next time the profile or the font changes.
    } finally {
      this.sending = false;
    }
  }

  /** Opens the font of every name on screen that has a shared one (and of the own name). */
  private openFonts(): void {
    const wanted = new Set<string>();
    const users = this.directory.users();
    const own = this.auth.user();
    for (const user of [...users.values(), ...(own ? [own] : [])]) {
      const match = SHARED.exec(user.nameFont ?? '');
      if (match) {
        wanted.add(match[1]!);
      }
    }
    if (wanted.size === 0 || !this.settings.showSharedFonts()) {
      return;
    }
    untracked(this.start.bind(this, wanted, own?.id ?? ''));
  }

  private start(wanted: Set<string>, ownId: string): void {
    for (const id of wanted) {
      if (this.started.has(id)) {
        continue;
      }
      this.started.add(id);
      void this.register(id, ownId).catch(this.forget.bind(this, id));
    }
  }

  /** The font could not be opened (its key is not for this person yet): it will be tried again when the list changes. */
  private forget(id: string): void {
    this.started.delete(id);
    setTimeout(this.retry.bind(this), 60_000);
  }

  private retry(): void {
    // Touching the setting runs the effect again without changing anything.
    this.openFonts();
  }

  /** Opens one font file, checks it and makes the class of its name. */
  private async register(id: string, ownId: string): Promise<void> {
    const mine = this.auth.user();
    const own =
      mine && ownId && (mine as User & { nameFontImage?: string | null }).nameFontImage === id;
    // The own font is on this device already; the others are opened from the server (decrypted with the key sealed for us).
    let bytes: ArrayBuffer | null = own ? await this.fonts.read('name') : null;
    if (!bytes) {
      bytes = await (await this.images.openPicture(id)).arrayBuffer();
    }
    if (bytes.byteLength > MAX_SHARED_BYTES) {
      return;
    }
    const family = 'CF ' + id;
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    this.rule(
      '.font-name-cf-' + id + " { font-family: '" + family + "', var(--font-ui), sans-serif; }",
    );
  }

  /** Adds a rule to the stylesheet of the shared fonts (made the first time). */
  private rule(css: string): void {
    if (!this.sheet) {
      this.sheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
    }
    this.sheet.insertRule(css, this.sheet.cssRules.length);
  }
}

/** A hash of the bytes of a font (to know whether the one that was sent is still the one on the device). */
async function digest(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, function hex(byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

/** What was remembered of the font sent by this person (null when it was another person's or nothing). */
function readSent(userId: string): { id: string; hash: string } | null {
  try {
    const value = JSON.parse(localStorage.getItem(SENT_KEY) ?? 'null') as {
      user?: string;
      id?: string;
      hash?: string;
    } | null;
    return value && value.user === userId && value.id && value.hash
      ? { id: value.id, hash: value.hash }
      : null;
  } catch {
    return null;
  }
}
