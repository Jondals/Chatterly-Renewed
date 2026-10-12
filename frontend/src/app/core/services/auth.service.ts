/**
 * src/app/core/services/auth.service.ts
 * The person's session: registration, sign in and sign out, the unlocked identity and the access tokens.
 * Accounts are zero-knowledge: the password never leaves the browser.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { KDF_ITERATIONS, MIN_ACCEPTED_KDF_ITERATIONS } from '../config';
import { randomBytes, toB64 } from '../crypto/bytes';
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
import { KEY_STORE } from './key-store';

/** Tokens plus the moment the access token expires. */
interface Session extends Tokens {
  /** Epoch ms at which the access token expires. */
  accessExp: number;
}

/** Key under which the session is saved in localStorage. */
const SESSION_KEY = 'chatterly.session';
/** An access token that expires in less than this many milliseconds is renewed before use. */
const RENEW_MARGIN = 30_000;

type AuthResponse = { user: User } & Tokens;
type LoginResponse = AuthResponse & { wrappedKeys: WrappedKeys };

/**
 * ! Zero-knowledge account handling. The password never leaves the browser: it is stretched with PBKDF2 and
 * split into an auth secret (sent over TLS, hashed again by the server) and a wrapping key (kept here) that
 * decrypts the identity private keys stored on the server.
 */
/** The databases of this device where the keys and the person's own files are kept (the ones that exist are erased). */
const LOCAL_DATABASES = [
  'chatterly-renewed-keys',
  'chatterly-renewed-vault',
  'chatterly-renewed-library',
  'chatterly-renewed-stickers',
  'chatterly-renewed-sounds',
  'chatterly-renewed-fonts',
  'chatterly-renewed-click',
  'chatterly-renewed-ringtone',
  'chatterly-renewed-wallpaper',
];

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

  /** The server refused to renew the session: sign out on this device only. */
  private onSessionExpired(): void {
    // ? While the account is being erased the server refuses the session on purpose: the page is about to be loaded again.
    if (this.erasing) {
      return;
    }
    void this.logout(false);
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
          this.session = saved.session;
          this.user.set(saved.user);
          if (sealed && sealed.startsWith('{')) this.persist();
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
      await this.clearLocal();
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
  async register(username: string, password: string, displayName?: string): Promise<void> {
    const kdfSalt = toB64(randomBytes(16));
    const { authSecret, wrappingKey } = await deriveSecrets(password, kdfSalt, KDF_ITERATIONS);
    const { identity, publicKeys, wrappedKeys } = await createIdentity(wrappingKey);
    const response = await this.api.post<AuthResponse>(
      '/api/auth/register',
      {
        username,
        displayName: displayName || undefined,
        authSecret,
        kdfSalt,
        kdfIterations: KDF_ITERATIONS,
        publicKeys,
        wrappedKeys,
      },
      false,
    );
    await this.startSession(response, identity);
  }

  /** Signs in: derives the secrets with the parameters of the account and unlocks the identity. */
  async login(username: string, password: string): Promise<void> {
    const kdf = await this.api.get<{ salt: string; iterations: number }>(
      '/api/auth/kdf?username=' + encodeURIComponent(username),
    );
    if (kdf.iterations < MIN_ACCEPTED_KDF_ITERATIONS) {
      throw new ApiError(0, 'kdf_downgrade');
    }
    const { authSecret, wrappingKey } = await deriveSecrets(password, kdf.salt, kdf.iterations);
    const response = await this.api.post<LoginResponse>(
      '/api/auth/login',
      { username, authSecret },
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
    const kdf = await this.api.get<{ salt: string; iterations: number }>(
      '/api/auth/kdf?username=' + encodeURIComponent(username),
    );
    const oldSecrets = await deriveSecrets(oldPassword, kdf.salt, kdf.iterations);
    // The wrapped keys are fetched again through a verified sign in.
    const login = await this.api.post<LoginResponse>(
      '/api/auth/login',
      { username, authSecret: oldSecrets.authSecret },
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
    this.storeSession(tokens);
  }

  /**
   * Erases the account for good: the server removes everything of the person after checking the proof of the password,
   * and then everything kept on this device goes too (keys, session, preferences, stickers, sounds, fonts).
   */
  async deleteAccount(username: string, password: string): Promise<void> {
    const kdf = await this.api.get<{ salt: string; iterations: number }>(
      '/api/auth/kdf?username=' + encodeURIComponent(username),
    );
    const secrets = await deriveSecrets(password, kdf.salt, kdf.iterations);
    // ! The password is checked through a sign in first: a wrong one must not look like an expired session (which signs out).
    await this.api.post('/api/auth/login', { username, authSecret: secrets.authSecret }, false);
    this.erasing = true;
    try {
      await this.api.post('/api/me/delete', { authSecret: secrets.authSecret });
    } catch (error) {
      this.erasing = false;
      throw error;
    }
    // Everything kept on this device goes, without touching the state in memory: the page is loaded again right after.
    const names = new Set(LOCAL_DATABASES);
    for (const database of (await indexedDB.databases?.()) ?? []) {
      if (database.name) {
        names.add(database.name);
      }
    }
    for (const name of names) {
      indexedDB.deleteDatabase(name);
    }
    localStorage.clear();
    sessionStorage.clear();
  }

  /** Signs out; the server is told too unless the session was already refused. */
  async logout(callServer = true): Promise<void> {
    const refresh = this.session?.refreshToken;
    if (callServer && refresh) {
      await this.api.post('/api/auth/logout', { refreshToken: refresh }, false).catch(this.ignore);
    }
    await this.clearLocal();
  }

  /** Stores a new version of the profile of the person. */
  setUser(user: User): void {
    this.user.set(user);
    this.persist();
  }

  /** Returns a valid access token, renewing it (and rotating the refresh token) when it is about to expire. */
  async getAccessToken(forceRefresh = false): Promise<string | null> {
    if (!this.session) {
      return null;
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

  /** Exchanges the refresh token for new tokens; a refusal means the session is gone. */
  private async refresh(): Promise<string | null> {
    if (!this.session) {
      return null;
    }
    try {
      const tokens = await this.api.post<Tokens>(
        '/api/auth/refresh',
        { refreshToken: this.session.refreshToken },
        false,
      );
      this.storeSession(tokens);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.clearLocal();
      }
      return null;
    }
  }

  /** Saves the identity on this device and starts the session. */
  private async startSession(response: AuthResponse, identity: Identity): Promise<void> {
    await this.keyStore.save({
      userId: response.user.id,
      ecdhPrivate: identity.ecdhPrivate,
      ecdsaPrivate: identity.ecdsaPrivate,
      publicKeys: identity.publicKeys,
    });
    this.unlockedIdentity.set(identity);
    this.user.set(response.user);
    this.storeSession(response);
  }

  /** Remembers new tokens. */
  private storeSession(tokens: Tokens): void {
    this.session = { ...tokens, accessExp: Date.now() + tokens.expiresIn * 1000 };
    this.persist();
  }

  /** Writes the session to localStorage. */
  private persist(): void {
    if (!this.session || !this.user()) {
      return;
    }
    // The tokens are written encrypted; the write is not awaited (the page does not wait for the disk).
    void sealText(JSON.stringify({ session: this.session, user: this.user() })).then(
      this.writeSealed.bind(this),
    );
  }

  /** Writes the encrypted session to localStorage (unless the person signed out meanwhile). */
  private writeSealed(sealed: string): void {
    if (this.session) {
      localStorage.setItem(SESSION_KEY, sealed);
    }
  }

  /** Forgets everything about the session on this device. */
  private async clearLocal(): Promise<void> {
    this.session = null;
    this.user.set(null);
    this.unlockedIdentity.set(null);
    localStorage.removeItem(SESSION_KEY);
    await forgetVault();
    await this.keyStore.clear();
  }
}
