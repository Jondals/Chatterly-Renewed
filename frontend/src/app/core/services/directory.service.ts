/**
 * src/app/core/services/directory.service.ts
 * Directory of people: keeps the public profiles, pins the identity key of every contact the first time it is
 * seen (trust on first use), tracks which contacts were verified, and applies the nicknames the person gave
 * to friends.
 */
import { Injectable, effect, inject, signal } from '@angular/core';
import { fingerprint } from '../crypto/fingerprint';
import type { User } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DialogService } from './dialog.service';
import { SettingsService } from './settings.service';
import { SettingsSyncService } from './settings-sync.service';

/** Fingerprints by user id. */
type PinMap = Record<string, string>;

/** Storage keys of the pinned and the verified fingerprints. */
const PINS_KEY = 'chatterly.pins';
const VERIFIED_KEY = 'chatterly.verified';
/** Most profiles asked for in one request. */
const BATCH_SIZE = 50;
/** Longest nickname. */
const MAX_NICKNAME = 32;

/** Reads a map of fingerprints from storage ({} when there is none or it is damaged). */
function readMap(key: string): PinMap {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as PinMap;
  } catch {
    return {};
  }
}

/** Saves a map of fingerprints. */
function writeMap(key: string, map: PinMap): void {
  localStorage.setItem(key, JSON.stringify(map));
}

/**
 * Cache of public profiles plus trust-on-first-use pinning: the first identity fingerprint seen for a
 * contact is remembered, and a later change raises a visible warning (a changed key can mean a new device,
 * or a malicious server swapping keys).
 */
@Injectable({ providedIn: 'root' })
export class DirectoryService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);
  private readonly dialog = inject(DialogService);
  private readonly sync = inject(SettingsSyncService);

  /** Profiles by user id, with the nickname already applied as display name. */
  readonly users = signal<ReadonlyMap<string, User>>(new Map());
  /** Contacts whose identity key differs from the one pinned earlier. */
  readonly keyChanges = signal<ReadonlySet<string>>(new Set());
  /** Contacts whose safety number the person confirmed (the confirmed fingerprint of each). */
  readonly verified = signal<PinMap>(readMap(VERIFIED_KEY));
  /** Current fingerprint of every known person. */
  readonly fingerprints = signal<PinMap>({});

  /** Requests that are in flight, so concurrent callers share them. */
  private readonly inflight = new Map<string, Promise<void>>();
  /** Profiles as the server sent them, without nicknames. */
  private readonly rawUsers = new Map<string, User>();

  /** Starts applying nicknames whenever they change. */
  constructor() {
    // When a nickname changes, every name in the app updates at once.
    effect(this.reapplyNicknames.bind(this));
    // A contact verified on another device of the account is verified here too (and the other way round).
    effect(this.takeAccountVerified.bind(this));
  }

  /**
   * Merges the contacts verified on the account with the ones of this device. For a contact in both, the fingerprint
   * that matches their current key wins (a verification of an old key is not a verification of the new one). Contacts
   * verified only here (before verification followed the account) are sent to the account.
   */
  private takeAccountVerified(): void {
    const account = this.sync.accountVerified();
    const local = this.verified();
    const current = this.fingerprints();
    const merged: PinMap = { ...account };
    let localOnly = false;
    for (const [id, print] of Object.entries(local)) {
      if (!merged[id] || (print === current[id] && merged[id] !== print)) {
        merged[id] = print;
        localOnly = true;
      }
    }
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      this.verified.set(merged);
      writeMap(VERIFIED_KEY, merged);
    }
    if (localOnly && Object.keys(account).length + Object.keys(local).length > 0) {
      void this.sync.shareVerified(merged);
    }
  }

  /** Returns the user with the nickname as display name (and the real name kept in `realName`). */
  private withNickname(user: User): User {
    const nickname = this.settings.aliases()[user.id];
    return nickname
      ? { ...user, displayName: nickname, realName: user.displayName }
      : { ...user, realName: undefined };
  }

  /** Rebuilds every profile with the current nicknames. */
  private reapplyNicknames(): void {
    this.settings.aliases();
    if (this.rawUsers.size === 0) {
      return;
    }
    const next = new Map<string, User>();
    for (const [id, user] of this.rawUsers) {
      next.set(id, this.withNickname(user));
    }
    this.users.set(next);
  }

  /** Asks for a nickname that only the person sees (empty removes it); the one place that asks it, for every menu. */
  async askNickname(user: User): Promise<void> {
    const name = await this.dialog.prompt(
      'Set nickname',
      'Only you see this nickname. Leave it empty to remove it.',
      user.realName ? user.displayName : '',
      user.realName ?? user.displayName,
    );
    if (name !== null) {
      this.setAlias(user.id, name);
    }
  }

  /** Sets the nickname of a contact, or removes it when the text is empty. */
  setAlias(id: string, nickname: string): void {
    const clean = nickname.trim().slice(0, MAX_NICKNAME);
    const aliases = { ...this.settings.aliases() };
    if (clean) {
      aliases[id] = clean;
    } else {
      delete aliases[id];
    }
    this.settings.aliases.set(aliases);
  }

  /** The profile of a person, if it is already known. */
  get(id: string): User | undefined {
    return this.users().get(id);
  }

  /** Adds or updates profiles (and pins the key of the people seen for the first time). */
  merge(list: User[]): void {
    if (list.length === 0) {
      return;
    }
    const next = new Map(this.users());
    for (const user of list) {
      this.rawUsers.set(user.id, user);
      next.set(user.id, this.withNickname(user));
    }
    this.users.set(next);
    for (const user of list) {
      void this.checkPin(user);
    }
  }

  /** Makes sure the profiles of some people are known; concurrent callers asking for the same id share one request. */
  async ensure(ids: Iterable<string>): Promise<void> {
    const wanted = Array.from(new Set(ids));
    const waits: Promise<void>[] = [];
    const missing: string[] = [];
    for (const id of wanted) {
      if (this.users().has(id)) {
        continue;
      }
      const running = this.inflight.get(id);
      if (running) {
        waits.push(running);
      } else {
        missing.push(id);
      }
    }
    if (missing.length > 0) {
      const batch = this.fetchProfiles(missing);
      for (const id of missing) {
        this.inflight.set(id, batch);
      }
      waits.push(batch);
    }
    await Promise.all(waits);
  }

  /** Downloads some profiles (in groups of BATCH_SIZE) and forgets the pending requests when done. */
  private async fetchProfiles(ids: string[]): Promise<void> {
    try {
      for (let index = 0; index < ids.length; index += BATCH_SIZE) {
        const chunk = ids.slice(index, index + BATCH_SIZE);
        const response = await this.api.get<{ users: User[] }>('/api/users?ids=' + chunk.join(','));
        this.merge(response.users);
      }
    } finally {
      for (const id of ids) {
        this.inflight.delete(id);
      }
    }
  }

  /** The profile of a person; asks the server when it is not known yet. */
  async require(id: string): Promise<User> {
    await this.ensure([id]);
    const user = this.get(id);
    if (!user) {
      throw new Error('Unknown user ' + id);
    }
    return user;
  }

  /**
   * ! Whether the identity key the server currently publishes for a person is the one pinned the first time they were
   * seen (or no key was pinned yet). A calling session must not be set up with a key that changed: the server could
   * have swapped it to read the call, and only the person at the other end can say that the change is legitimate.
   * This reads the pins directly instead of the `keyChanges` signal, because that one is filled in a moment later.
   */
  async isIdentityTrusted(userId: string): Promise<boolean> {
    const user = await this.require(userId);
    const pinned = readMap(PINS_KEY)[userId];
    return !pinned || pinned === (await fingerprint(user.publicKeys));
  }

  /** True when the person confirmed the safety number of this contact and their key has not changed since. */
  isVerified(userId: string): boolean {
    const current = this.fingerprints()[userId];
    return !!current && this.verified()[userId] === current;
  }

  /** Remembers that the person verified the safety number of a contact. */
  async markVerified(userId: string): Promise<void> {
    const user = await this.require(userId);
    const verified = { ...this.verified(), [userId]: await fingerprint(user.publicKeys) };
    this.verified.set(verified);
    writeMap(VERIFIED_KEY, verified);
    // Once for the account: the other devices of the person see the contact as verified too.
    await this.sync.shareVerified({ [userId]: verified[userId]! });
  }

  /** Trusts the new key of a contact after the person acknowledged the warning. */
  async acceptKeyChange(userId: string): Promise<void> {
    const user = await this.require(userId);
    const pins = readMap(PINS_KEY);
    pins[userId] = await fingerprint(user.publicKeys);
    writeMap(PINS_KEY, pins);
    const changes = new Set(this.keyChanges());
    changes.delete(userId);
    this.keyChanges.set(changes);
  }

  /** Pins the key of a contact the first time it is seen and raises a warning when it later differs. */
  private async checkPin(user: User): Promise<void> {
    const current = await fingerprint(user.publicKeys);
    this.fingerprints.set({ ...this.fingerprints(), [user.id]: current });
    if (user.id === this.auth.user()?.id) {
      return;
    }
    const pins = readMap(PINS_KEY);
    if (!pins[user.id]) {
      // ! A contact verified on the account is pinned to the key that was checked, not to whatever the server shows this
      //   device the first time: a key swapped before this device ever saw the contact is still caught.
      pins[user.id] = this.verified()[user.id] ?? current;
      writeMap(PINS_KEY, pins);
      if (pins[user.id] !== current) {
        this.keyChanges.set(new Set(this.keyChanges()).add(user.id));
      }
    } else if (pins[user.id] !== current) {
      this.keyChanges.set(new Set(this.keyChanges()).add(user.id));
    }
  }
}
