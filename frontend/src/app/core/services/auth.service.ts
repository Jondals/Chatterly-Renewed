/**
 * src/app/core/services/auth.service.ts
 * The person's session: registration, sign in and sign out, the unlocked identity and the access tokens.
 * Accounts are zero-knowledge: the password never leaves the browser.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { KDF_ITERATIONS, MIN_ACCEPTED_KDF_ITERATIONS } from '../config';
import { randomBytes, toB64, toB64Url } from '../crypto/bytes';
import {
  createIdentity,
  rewrapIdentity,
  unlockIdentity,
  type Identity,
  type WrappedKeys,
} from '../crypto/identity';
import { deriveSecrets } from '../crypto/kdf';
import type { Tokens, User } from '../models';
import { ApiError, ApiService } from './api.service';
import { forgetVault, openText, sealText } from '../session-vault';
import { claimDevice, rememberOwner, wipeDeviceData, wipeSession } from '../device-wipe';
import { resetPersisted } from './persisted';
import { KEY_STORE } from './key-store';

/** Tokens plus the moment the access token expires. */
interface Session extends Tokens {
  /** Epoch ms at which the access token expires. */
  accessExp: number;
  /**
   * The retry key of the renewal in progress (32 random bytes, base64url). It is saved with the refresh token BEFORE
   * asking, so if the answer is lost the next try proves it is the same request and gets the same new token.
   */
  retryKey?: string;
}

/** Key under which the session is saved in localStorage. */
const SESSION_KEY = 'chatterly.session';
/** An access token that expires in less than this many milliseconds is renewed before use. */
const RENEW_MARGIN = 30_000;

type AuthResponse = { user: User } & Tokens;
type LoginResponse = AuthResponse & { wrappedKeys: WrappedKeys };

/** Where this device keeps the random id it made for itself. */
const DEVICE_ID_KEY = 'chatterly.deviceId';

/**
 * A random id that this device makes once for itself (22 characters, nothing of the device in it). The server keeps only a
 * hash of it, so signing in again on the same device replaces its old session instead of leaving one more open.
 */
function deviceId(): string | undefined {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{22,64}$/.test(id)) {
      id = toB64(randomBytes(16)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

/**
 * ! Zero-knowledge account handling. The password never leaves the browser: it is stretched with PBKDF2 and
 * split into an auth secret (sent over TLS, hashed again by the server) and a wrapping key (kept here) that
 * decrypts the identity private keys stored on the server.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly keyStore = inject(KEY_STORE);

  readonly user = signal<User | null>(null);
  private readonly unlockedIdentity = signal<Identity | null>(null);
  readonly isAuthenticated = computed(this.hasIdentityAndUser.bind(this));

  private session: Session | null = null;
  private refreshing: Promise<string | null> | null = null;

  /** Plugs the token logic into the API client. */
  constructor() {
    this.api.tokenProvider = this.getAccessToken.bind(this);
    this.api.onSessionExpired = this.onSessionExpired.bind(this);
  }

  /** True when there is a person and an unlocked identity. */
  private hasIdentityAndUser(): boolean {
    return !!this.user() && !!this.unlockedIdentity();
  }

  /** True while the account is being erased (see `deleteAccount`). */
  private erasing = false;

  /**
   * True once this page handed its session over to another page of the same app (Android: a page kept alive for a call after
   * the app was swiped away, see CallKeeper.java). ! It never renews the session or writes it again from then on: the new page
   * owns it, and two pages renewing the same session would look like a stolen token to the server (it closes every session).
   */
  private frozen = false;

  /** Stops renewing and writing the session (another page of this device owns it now). */
  freeze(): void {
    this.frozen = true;
  }

  /**
   * The server refused to renew the session: sign out on this device only. What the person made here (stickers, sounds,
   * presets, preferences) stays for their next sign in; only the session and the keys go (see device-wipe.ts).
   */
  private onSessionExpired(): void {
    // ? While the account is being erased the server refuses the session on purpose: the page is about to be loaded again.
    if (this.erasing || this.frozen) {
      return;
    }
    void this.logout(false, true).then(function reload() {
      // Nothing of the account stays in memory either: the sign-in page is loaded from scratch.
      window.location.assign('/login');
    });
  }

  /** The unlocked identity (it throws when nobody is signed in). */
  get identity(): Identity {
    const identity = this.unlockedIdentity();
    if (!identity) {
      throw new Error('Not signed in');
    }
    return identity;
  }

  /** Id of the person who is signed in. */
  get userId(): string {
    return this.user()!.id;
  }

  /** Restores the previous session (tokens in localStorage, keys in IndexedDB). */
  async init(): Promise<void> {
    try {
      const sealed = localStorage.getItem(SESSION_KEY);
      // A session saved by an older version is plain JSON: it is read once and written again encrypted.
      const raw =
        sealed && sealed.startsWith('{') ? sealed : sealed ? await openText(sealed) : null;
      const stored = await this.keyStore.load();
      if (raw && stored) {
        const saved = JSON.parse(raw) as { session: Session; user: User };
        if (saved.user.id === stored.userId) {
          // An install from before the owner was noted: what it keeps is of the account that is signed in.
          rememberOwner(saved.user.id);
          this.session = saved.session;
          this.user.set(saved.user);
          if (sealed && sealed.startsWith('{')) void this.persist();
          this.unlockedIdentity.set({
            ecdhPrivate: stored.ecdhPrivate,
            ecdsaPrivate: stored.ecdsaPrivate,
            publicKeys: stored.publicKeys,
          });
          // Refresh the profile in the background; a failure here only means the session is dead.
          this.api
            .get<{ user: User }>('/api/me')
            .then(this.onProfileLoaded.bind(this), this.ignore);
        }
      }
    } catch {
      // ! A session that cannot be read (damaged, or from a version that sealed it otherwise) is not a reason to lose the
      //   stickers and presets of the person: only the session goes.
      await this.clearLocal(true);
    }
  }

  /** The fresh profile arrived: keep it. */
  private onProfileLoaded(response: { user: User }): void {
    this.setUser(response.user);
  }

  /** Does nothing: used where a failure is expected and harmless. */
  private ignore(): void {
    return;
  }

  /** Creates an account: keys are generated here and only encrypted material is sent. */
  async register(
    username: string,
    password: string,
    displayName?: string,
    guest = false,
  ): Promise<void> {
    const kdfSalt = toB64(randomBytes(16));
    const { authSecret, wrappingKey } = await deriveSecrets(password, kdfSalt, KDF_ITERATIONS);
    const { identity, publicKeys, wrappedKeys } = await createIdentity(wrappingKey);
    const response = await this.api.post<AuthResponse>(
      '/api/auth/register',
      {
        username,
        displayName: displayName || undefined,
        authSecret,
        deviceId: deviceId(),
        guest: guest || undefined,
        kdfSalt,
        kdfIterations: KDF_ITERATIONS,
        publicKeys,
        wrappedKeys,
      },
      false,
    );
    await this.startSession(response, identity);
  }

  /**
   * Enters as a guest (the web only): an account with a random name and a random password that nobody ever sees, made to try
   * the app. Nothing of it is kept: it is erased when the guest leaves (or closes the page) and, if that never happens, by the
   * server after a few hours.
   */
  async enterAsGuest(): Promise<void> {
    const letters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let name = 'guest-';
    for (const byte of randomBytes(8)) name += letters[byte % letters.length];
    const password = toB64(randomBytes(24));
    await this.register(name, password, 'Guest', true);
    this.watchGuest();
  }

  /** Whether the person in is a guest. */
  readonly isGuest = computed(
    function (this: AuthService) {
      return this.user()?.guest === true;
    }.bind(this),
  );

  private guestWatched = false;

  /** A guest who closes the page (or leaves it for good) takes their account with them: the request goes on after the page. */
  private watchGuest(): void {
    if (this.guestWatched) return;
    this.guestWatched = true;
    window.addEventListener('pagehide', this.leaveGuestNow.bind(this));
  }

  private leaveGuestNow(event: PageTransitionEvent): void {
    if (event.persisted || !this.isGuest() || !this.session) return;
    void this.api.post('/api/me/guest/leave', undefined, true, true).catch(this.ignore);
  }

  /**
   * ! The password stretching of an account, as the server tells it. Every flow that derives from the password asks
   * through here, so a server that asks for fewer rounds than this client accepts is refused with a clear message (and
   * deriveSecrets refuses it again, in case a new flow forgets this).
   */
  private async accountKdf(username: string): Promise<{ salt: string; iterations: number }> {
    const kdf = await this.api.get<{ salt: string; iterations: number }>(
      '/api/auth/kdf?username=' + encodeURIComponent(username),
    );
    if (!Number.isSafeInteger(kdf.iterations) || kdf.iterations < MIN_ACCEPTED_KDF_ITERATIONS) {
      throw new ApiError(0, 'kdf_downgrade');
    }
    return kdf;
  }

  /** Signs in: derives the secrets with the parameters of the account and unlocks the identity. */
  async login(username: string, password: string): Promise<void> {
    const kdf = await this.accountKdf(username);
    const { authSecret, wrappingKey } = await deriveSecrets(password, kdf.salt, kdf.iterations);
    const response = await this.api.post<LoginResponse>(
      '/api/auth/login',
      { username, authSecret, deviceId: deviceId() },
      false,
    );
    const identity = await unlockIdentity(
      response.wrappedKeys,
      wrappingKey,
      response.user.publicKeys,
    );
    await this.startSession(response, identity);
  }

  /** Changes the password: the private keys are encrypted again with the new one. */
  async changePassword(username: string, oldPassword: string, newPassword: string): Promise<void> {
    const kdf = await this.accountKdf(username);
    const oldSecrets = await deriveSecrets(oldPassword, kdf.salt, kdf.iterations);
    // The wrapped keys are fetched again through a verified sign in.
    const login = await this.api.post<LoginResponse>(
      '/api/auth/login',
      { username, authSecret: oldSecrets.authSecret, verifyOnly: true },
      false,
    );
    const newSalt = toB64(randomBytes(16));
    const newSecrets = await deriveSecrets(newPassword, newSalt, KDF_ITERATIONS);
    const wrappedKeys = await rewrapIdentity(
      login.wrappedKeys,
      oldSecrets.wrappingKey,
      newSecrets.wrappingKey,
    );
    const tokens = await this.api.post<Tokens>('/api/me/password', {
      oldAuthSecret: oldSecrets.authSecret,
      newAuthSecret: newSecrets.authSecret,
      kdfSalt: newSalt,
      kdfIterations: KDF_ITERATIONS,
      wrappedKeys,
    });
    await this.storeSession(tokens);
  }

  /**
   * Erases the account for good: the server removes everything of the person after checking the proof of the password,
   * and then everything kept on this device goes too (keys, session, preferences, stickers, sounds, fonts).
   */
  async deleteAccount(username: string, password: string): Promise<void> {
    const kdf = await this.accountKdf(username);
    const secrets = await deriveSecrets(password, kdf.salt, kdf.iterations);
    // ! The password is checked through a sign in first: a wrong one must not look like an expired session (which signs out).
    await this.api.post(
      '/api/auth/login',
      { username, authSecret: secrets.authSecret, verifyOnly: true },
      false,
    );
    this.erasing = true;
    try {
      await this.api.post('/api/me/delete', { authSecret: secrets.authSecret });
    } catch (error) {
      this.erasing = false;
      throw error;
    }
    // Everything kept on this device goes, without touching the state in memory: the page is loaded again right after.
    await wipeDeviceData();
  }

  /**
   * Signs out; the server is told too unless the session was already refused. `keepPersonal`: what the person made on this
   * device (stickers, sounds, presets, fonts, preferences) stays; only the session and the keys go.
   */
  async logout(callServer = true, keepPersonal = false): Promise<void> {
    const refresh = this.session?.refreshToken;
    const retryKey = this.session?.retryKey;
    // A guest takes the account with them: it is erased now, and nothing of it stays on this device either.
    if (callServer && this.isGuest()) {
      await this.api.post('/api/me/guest/leave').catch(this.ignore);
      keepPersonal = false;
      callServer = false; // its session went with the account
    }
    if (callServer && refresh) {
      await this.api
        .post(
          '/api/auth/logout',
          retryKey ? { refreshToken: refresh, retryKey } : { refreshToken: refresh },
          false,
        )
        .catch(this.ignore);
    }
    await this.clearLocal(keepPersonal);
  }

  /** Stores a new version of the profile of the person. */
  setUser(user: User): void {
    this.user.set(user);
    void this.persist();
  }

  /** Returns a valid access token, renewing it (and rotating the refresh token) when it is about to expire. */
  async getAccessToken(forceRefresh = false): Promise<string | null> {
    if (!this.session) {
      return null;
    }
    if (this.frozen) {
      return this.session.accessToken;
    }
    if (!forceRefresh && this.session.accessExp - Date.now() > RENEW_MARGIN) {
      return this.session.accessToken;
    }
    this.refreshing ??= this.refresh().finally(this.finishRefresh.bind(this));
    return this.refreshing;
  }

  /** The renewal is over: the next call may start a new one. */
  private finishRefresh(): void {
    this.refreshing = null;
  }

  /**
   * Exchanges the refresh token for new tokens; a refusal means the session is gone.
   * ! The retry key is written to storage together with the old token BEFORE the request, and the new tokens are written
   * before they are used. If the answer is lost (no network, the system kills the app), the next try sends the same key
   * and the server answers with the same new token instead of taking the old one for a stolen copy.
   */
  private async refresh(): Promise<string | null> {
    if (!this.session) {
      return null;
    }
    try {
      if (!this.session.retryKey) {
        this.session = { ...this.session, retryKey: toB64Url(randomBytes(32)) };
        await this.persist();
      }
      const tokens = await this.api.post<Tokens>(
        '/api/auth/refresh',
        { refreshToken: this.session.refreshToken, retryKey: this.session.retryKey },
        false,
      );
      await this.storeSession(tokens);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.clearLocal(true);
      }
      return null;
    }
  }

  /**
   * Saves the identity on this device and starts the session. ! If what this device keeps belongs to another account, it is
   * all erased first (and the preferences go back to their defaults), so nobody inherits the stickers or settings of the
   * person who used it before.
   */
  private async startSession(response: AuthResponse, identity: Identity): Promise<void> {
    if (await claimDevice(response.user.id)) {
      resetPersisted();
    }
    await this.keyStore.save({
      userId: response.user.id,
      ecdhPrivate: identity.ecdhPrivate,
      ecdsaPrivate: identity.ecdsaPrivate,
      publicKeys: identity.publicKeys,
    });
    this.unlockedIdentity.set(identity);
    this.user.set(response.user);
    await this.storeSession(response);
  }

  /** Remembers new tokens; the promise ends when they are written to storage. */
  private storeSession(tokens: Tokens): Promise<void> {
    this.session = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      accessExp: Date.now() + tokens.expiresIn * 1000,
    };
    return this.persist();
  }

  /** The writes of the session, one after the other (an older one can never finish after a newer one). */
  private writing: Promise<void> = Promise.resolve();

  /** Writes the session to localStorage, encrypted; the promise ends when the latest version is written. */
  private persist(): Promise<void> {
    if (this.frozen) {
      return Promise.resolve();
    }
    const write = this.writeSession.bind(this);
    this.writing = this.writing.then(write, write);
    return this.writing;
  }

  /** Seals the session as it is now and writes it (unless the person signed out meanwhile). */
  private async writeSession(): Promise<void> {
    if (!this.session || !this.user()) {
      return;
    }
    const sealed = await sealText(JSON.stringify({ session: this.session, user: this.user() }));
    if (this.session) {
      localStorage.setItem(SESSION_KEY, sealed);
    }
  }

  /**
   * Forgets the account on this device (see device-wipe.ts for the list): everything, or with `keepPersonal` only the session
   * and the keys. The caller loads the page again afterwards, so nothing that was read into memory survives either.
   */
  private async clearLocal(keepPersonal = false): Promise<void> {
    this.session = null;
    this.user.set(null);
    this.unlockedIdentity.set(null);
    localStorage.removeItem(SESSION_KEY);
    await forgetVault();
    await this.keyStore.clear();
    await (keepPersonal ? wipeSession() : wipeDeviceData());
  }
}
