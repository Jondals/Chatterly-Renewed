/**
 * src/app/core/services/settings-sync.service.ts
 * The settings of the person on their account: sign in on a phone and everything is as on the computer. The person can also
 * keep several sets of settings ("profiles": for example one for the computer and one for the phone) and choose, on each
 * device, which one that device follows, or not follow any (settings that stay on that device only).
 *
 * * The server only gets a sealed blob (see backend routes/settings-sync.ts): the settings are encrypted here with a key that
 * comes from the identity of the person, so the server cannot read them. What belongs to one device (the chosen microphone,
 * the cursor files, the fonts that were uploaded) is never sent.
 * * Live: a change is saved a moment after it is made (and at once when the page is hidden or closed), the server tells the
 *   other devices of the person (`settings.changed` on the socket) and they load it at once; a device that comes back to
 *   the front also looks for a newer copy. So a setting changed on the phone shows on the computer within a second.
 * ! The same sealed blob also carries the contacts the person verified (`trust`). That is not a preference: it belongs to
 *   the account whatever profile or mode a device follows, so a contact verified on the phone is verified on the computer
 *   too. Sealed with the key of the identity, the server can neither read it nor add a contact to it.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { toB64 } from '../crypto/bytes';
import { derivePairKey, openBytes, sealBytes } from '../crypto/pairwise';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { applyPersisted, persisted, snapshotPersisted } from './persisted';
import { SocketService, type ServerEvent } from './socket.service';

/** Settings that belong to one device (never copied to the account). */
const DEVICE_ONLY = new Set([
  'pref.inputDevice',
  'pref.outputDevice',
  'pref.cameraDevice',
  'pref.customCursors',
  'pref.customFontName',
  'pref.customNameFontName',
  'pref.ringtoneName',
  'pref.clickName',
  'pref.powerMode',
  'pref.keepConnected',
]);

/** The most a single setting may weigh when it is JSON (a big one is a file and stays where it is). */
const MAX_SETTING_CHARS = 20_000;
/** How long after the last change the settings are saved (a slider that is being dragged saves once, at the end). */
const SAVE_AFTER_MS = 700;
/** How often contacts verified while offline are tried again. */
const RETRY_EVERY_MS = 30_000;
/** A little name for the first set of settings. */
const FIRST_PROFILE = 'main';

/** One set of settings. */
interface Profile {
  name: string;
  prefs: Record<string, unknown>;
}

/** What is sealed and stored. */
interface SettingsBlob {
  v: 1;
  profiles: Record<string, Profile>;
  /** The contacts the person verified, for every device of the account: user id to the fingerprint that was checked. */
  trust?: { verified?: Record<string, string> };
}

/** The most verified contacts kept on the account. */
const MAX_VERIFIED = 5000;

/** The verified contacts of a blob, keeping only well-formed entries (a damaged copy gives an empty list). */
export function cleanVerified(raw: unknown): Record<string, string> {
  const clean: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return clean;
  }
  for (const [id, print] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_VERIFIED)) {
    if (
      /^[\w-]{1,64}$/.test(id) &&
      typeof print === 'string' &&
      print.length > 0 &&
      print.length <= 200
    ) {
      clean[id] = print;
    }
  }
  return clean;
}

/** Whether the settings of this device follow the account. */
export type SyncMode = 'account' | 'device';

/** Keeps the settings of the person on their account. */
@Injectable({ providedIn: 'root' })
export class SettingsSyncService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly socket = inject(SocketService);

  /** Whether this device follows the account or keeps its own settings. */
  readonly mode = persisted<SyncMode>('sync.mode', 'account');
  /** The set of settings this device follows. */
  readonly active = persisted<string>('sync.profile', FIRST_PROFILE);
  /** The sets of settings of the account (id and name). */
  readonly profiles = signal<{ id: string; name: string }[]>([]);
  /** What is happening: nothing, saving, saved, or a problem. */
  readonly status = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** The contacts verified on the account (from any device), as last read from it. */
  readonly accountVerified = signal<Record<string, string>>({});

  private blob: SettingsBlob = { v: 1, profiles: {} };
  /** The version of the account that this device has seen (0: none yet). */
  private base = 0;
  private lastSent = '';
  private timer: ReturnType<typeof setInterval> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private working = false;
  /** A newer copy was announced while this device was busy: it is loaded when it is free. */
  private pullWanted = false;

  constructor() {
    effect(this.follow.bind(this));
    // Any persisted setting that changes schedules a save (the snapshot reads them all, so the effect follows them all).
    effect(this.watchChanges.bind(this));
    this.socket.events$.subscribe(this.onServerEvent.bind(this));
    document.addEventListener('visibilitychange', this.onVisibility.bind(this));
    window.addEventListener('pagehide', this.flush.bind(this));
  }

  /** A setting changed: save it a moment later (one save for a burst of changes). */
  private watchChanges(): void {
    const now = JSON.stringify(this.snapshot());
    if (!this.ready || now === this.lastSent) {
      return;
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(this.check.bind(this), SAVE_AFTER_MS);
  }

  /** Another device saved the settings of the account: load them now. */
  private onServerEvent(event: ServerEvent): void {
    const e = event as unknown as { t: string; updatedAt?: number };
    if (e.t === 'settings.changed' && e.updatedAt !== this.base) {
      void this.pull();
    }
  }

  /** Hidden (minimized, another tab, closing): save what changed at once; back in front: look for a newer copy. */
  private onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      this.flush();
    } else {
      void this.pull();
    }
  }

  /** Saves at once what changed and was not saved yet (the request goes on even if the page closes). */
  private flush(): void {
    clearTimeout(this.saveTimer);
    if (this.ready && !this.working && this.mode() === 'account') {
      if (JSON.stringify(this.snapshot()) !== this.lastSent) {
        void this.save(true);
      }
    }
  }

  /**
   * Loads the copy of the account when it is newer than the one this device has, and puts the settings of the set it
   * follows on this device. If this device has changes that were not saved yet, they are saved first (on top).
   */
  private async pull(): Promise<void> {
    if (!this.ready) {
      return;
    }
    if (this.working) {
      this.pullWanted = true;
      return;
    }
    this.working = true;
    let dirty = false;
    try {
      const found = await this.download();
      if (!found || found.version === this.base) {
        return;
      }
      dirty = this.mode() === 'account' && JSON.stringify(this.snapshot()) !== this.lastSent;
      if (!dirty) {
        this.blob = found.blob;
        this.base = found.version;
        this.accountVerified.set(cleanVerified(this.blob.trust?.verified));
        this.listProfiles();
        const mine = this.blob.profiles[this.active()];
        if (this.mode() === 'account' && mine) {
          this.applyProfile(mine);
        }
      }
    } catch {
      // No connection: the next announcement or the next return to the front tries again.
    } finally {
      this.working = false;
    }
    if (dirty) {
      await this.save();
    }
    if (this.pullWanted) {
      this.pullWanted = false;
      void this.pull();
    }
  }

  /** Starts when a person is signed in and stops when not. */
  private follow(): void {
    if (this.auth.isAuthenticated()) {
      untracked(this.start.bind(this));
    } else {
      untracked(this.stop.bind(this));
    }
  }

  /** The settings that go to the account: the persisted ones, except the ones of this device and the big ones. */
  private snapshot(): Record<string, unknown> {
    const values = snapshotPersisted(function wanted(key) {
      return !key.startsWith('sync.') && !DEVICE_ONLY.has(key);
    });
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(value).length > MAX_SETTING_CHARS) {
        delete values[key];
      }
    }
    return values;
  }

  /** The key that seals the settings: it comes from the identity of the person (the pair key of the person with themselves). */
  private async key(): Promise<CryptoKey> {
    const identity = this.auth.identity;
    return derivePairKey(
      identity.ecdhPrivate,
      identity.publicKeys.ecdh,
      identity.publicKeys.ecdh,
      'settings',
    );
  }

  /** Reads the sealed settings of the account (null when there are none). */
  private async download(): Promise<{ blob: SettingsBlob; version: number } | null> {
    const answer = await this.api.get<{
      empty?: boolean;
      iv: string;
      ciphertext: string;
      updatedAt: number;
    }>('/api/me/settings');
    if (answer.empty) {
      return null;
    }
    const plain = await openBytes(
      await this.key(),
      { iv: answer.iv, ciphertext: answer.ciphertext },
      'settings',
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as SettingsBlob;
    if (parsed?.v !== 1 || typeof parsed.profiles !== 'object') {
      throw new Error('unknown settings');
    }
    return { blob: parsed, version: answer.updatedAt };
  }

  /** Seals the settings and saves them. Returns the new version, or null when another device saved first. */
  private async upload(blob: SettingsBlob, keepalive = false): Promise<number | null> {
    const plain = new TextEncoder().encode(JSON.stringify(blob));
    const sealed = await sealBytes(await this.key(), plain, 'settings');
    try {
      const answer = await this.api.put<{ updatedAt: number }>(
        '/api/me/settings',
        {
          iv: sealed.iv,
          ciphertext: sealed.ciphertext,
          base: this.base,
        },
        keepalive,
      );
      return answer.updatedAt;
    } catch (error) {
      if ((error as { status?: number }).status === 409) {
        return null;
      }
      throw error;
    }
  }

  /** Loads the settings of the account when the person signs in, and starts to keep them. */
  private async start(): Promise<void> {
    if (this.ready || this.working) {
      return;
    }
    this.working = true;
    try {
      const found = await this.download();
      if (found) {
        this.blob = found.blob;
        this.base = found.version;
      }
      this.accountVerified.set(cleanVerified(this.blob.trust?.verified));
      this.listProfiles();
      if (this.mode() === 'account') {
        const mine = this.blob.profiles[this.active()];
        if (mine) {
          this.applyProfile(mine);
        } else {
          await this.save();
        }
      }
      this.lastSent = JSON.stringify(this.snapshot());
      this.ready = true;
      clearInterval(this.timer);
      this.timer = setInterval(this.check.bind(this), RETRY_EVERY_MS);
    } catch {
      // No connection or a copy that cannot be read: the device keeps working with its own settings, and it tries at the next sign in.
      this.status.set('error');
    } finally {
      this.working = false;
    }
  }

  /** Stops (the person signed out). */
  private stop(): void {
    clearInterval(this.timer);
    clearTimeout(this.saveTimer);
    this.ready = false;
    this.base = 0;
    this.blob = { v: 1, profiles: {} };
    this.profiles.set([]);
    this.accountVerified.set({});
    this.status.set('idle');
  }

  /**
   * Puts the verified contacts of this device on the account (merged with what is already there), whatever the mode of
   * the device. Called by the directory when a contact is verified.
   */
  async shareVerified(verified: Record<string, string>): Promise<void> {
    if (!this.ready || this.working) {
      this.pendingVerified = { ...this.pendingVerified, ...verified };
      return;
    }
    this.working = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const merged = { ...cleanVerified(this.blob.trust?.verified), ...verified };
        this.blob.trust = { verified: merged };
        const version = await this.upload(this.blob);
        if (version !== null) {
          this.base = version;
          this.accountVerified.set(merged);
          return;
        }
        // Another device saved first: its copy is taken and the contacts of this device go on top.
        const found = await this.download();
        if (found) {
          const mine = this.blob.profiles[this.active()];
          this.blob = found.blob;
          this.base = found.version;
          if (mine && this.mode() === 'account') {
            this.blob.profiles[this.active()] = mine;
          }
        }
      }
    } catch {
      // No connection: the contact stays verified on this device and goes to the account the next time.
      this.pendingVerified = { ...this.pendingVerified, ...verified };
    } finally {
      this.working = false;
    }
  }

  /** Verified contacts that could not be put on the account yet (sent at the next check). */
  private pendingVerified: Record<string, string> | null = null;

  /** Makes the list of the sets of settings of the account. */
  private listProfiles(): void {
    this.profiles.set(
      Object.entries(this.blob.profiles).map(function entry([id, profile]) {
        return { id, name: profile.name };
      }),
    );
  }

  /** Puts the settings of a set on this device. */
  private applyProfile(profile: Profile): void {
    applyPersisted(profile.prefs);
    this.lastSent = JSON.stringify(this.snapshot());
  }

  /** Saves when something changed since the last time. */
  private async check(): Promise<void> {
    if (this.ready && !this.working && this.pendingVerified) {
      const pending = this.pendingVerified;
      this.pendingVerified = null;
      await this.shareVerified(pending);
    }
    if (!this.ready || this.mode() !== 'account') {
      return;
    }
    if (this.working) {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(this.check.bind(this), SAVE_AFTER_MS);
      return;
    }
    const now = JSON.stringify(this.snapshot());
    if (now !== this.lastSent) {
      await this.save();
    }
  }

  /**
   * Saves the settings of this device in the set it follows (loading the account again first if another device saved).
   * `leaving`: the page is being hidden or closed, so the request must outlive it.
   */
  async save(leaving = false): Promise<void> {
    if (this.mode() !== 'account') {
      return;
    }
    if (this.working) {
      // A save or a load is running: this change is saved right after it.
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(this.check.bind(this), SAVE_AFTER_MS);
      return;
    }
    this.working = true;
    this.status.set('saving');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const name = this.blob.profiles[this.active()]?.name ?? this.nameFor(this.active());
        this.blob.profiles[this.active()] = { name, prefs: this.snapshot() };
        const version = await this.upload(this.blob, leaving);
        if (version !== null) {
          this.base = version;
          this.lastSent = JSON.stringify(this.snapshot());
          this.listProfiles();
          this.status.set('saved');
          return;
        }
        // Another device saved first: its sets are taken, and this device's own set goes on top (the verified contacts
        // of both are kept).
        const found = await this.download();
        if (found) {
          const mine = this.blob.profiles[this.active()];
          const trusted = {
            ...cleanVerified(found.blob.trust?.verified),
            ...cleanVerified(this.blob.trust?.verified),
          };
          this.blob = found.blob;
          this.blob.trust = { verified: trusted };
          this.accountVerified.set(trusted);
          this.base = found.version;
          if (mine) {
            this.blob.profiles[this.active()] = mine;
          }
        }
      }
      this.status.set('error');
    } catch {
      this.status.set('error');
    } finally {
      this.working = false;
    }
  }

  /** A name for a set that has none yet. */
  private nameFor(id: string): string {
    return id === FIRST_PROFILE ? 'Main' : id.slice(0, 20);
  }

  /** The device follows the account (and saves to it now) or keeps its own settings. */
  async setMode(mode: SyncMode): Promise<void> {
    this.mode.set(mode);
    if (mode === 'account' && this.ready) {
      const mine = this.blob.profiles[this.active()];
      if (mine) {
        this.applyProfile(mine);
      } else {
        await this.save();
      }
    }
  }

  /** The device follows another set of settings: its settings become that set's. */
  async switchTo(id: string): Promise<void> {
    const profile = this.blob.profiles[id];
    if (!profile) {
      return;
    }
    // what was changed on this device and not saved yet goes to the set it was following
    await this.save();
    this.active.set(id);
    this.applyProfile(profile);
  }

  /** Makes a new set with the settings this device has now, and follows it. */
  async create(name: string): Promise<void> {
    const clean = name.trim().slice(0, 20);
    if (!clean || Object.keys(this.blob.profiles).length >= 8) {
      return;
    }
    await this.save();
    const id = toB64(crypto.getRandomValues(new Uint8Array(6))).replace(/[^A-Za-z0-9]/g, 'x');
    this.blob.profiles[id] = { name: clean, prefs: this.snapshot() };
    this.active.set(id);
    await this.save();
  }

  /** Changes the name of a set. */
  async rename(id: string, name: string): Promise<void> {
    const profile = this.blob.profiles[id];
    const clean = name.trim().slice(0, 20);
    if (profile && clean) {
      profile.name = clean;
      await this.save();
    }
  }

  /** Deletes a set (the one this device follows cannot be deleted, and there is always one). */
  async remove(id: string): Promise<void> {
    if (id === this.active() || !this.blob.profiles[id]) {
      return;
    }
    delete this.blob.profiles[id];
    await this.save();
  }
}
