/**
 * src/app/core/services/beta.service.ts
 * The beta program: whether the account is a tester or an administrator, and (for an administrator) the list of testers.
 * Testers can ask the desktop app for the beta versions (Settings > Updates); administrators manage the list in
 * Settings > Administration. The server decides everything: the page only shows what it is told.
 */
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/** How long to wait before asking the server again when it did not answer. */
const RETRY_MS = 30_000;

/** One person who can try the beta versions. */
export interface BetaTester {
  id: string;
  username: string;
  displayName: string;
  addedAt: number;
}

/** One administrator; `fixed` ones are named in the server environment and cannot be removed here. */
export interface BetaAdmin extends BetaTester {
  fixed: boolean;
}

/** What the page knows about the beta program. */
@Injectable({ providedIn: 'root' })
export class BetaService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  /** The account can try the beta versions. */
  readonly beta = signal(false);
  /** The account administers the program. */
  readonly admin = signal(false);
  /** The account is an owner of the server (ADMIN_USERS): only owners make or unmake administrators. */
  readonly owner = signal(false);
  /** The beta channel is open to this account: a tester, or an administrator (who can always try what they publish). */
  readonly canUseBeta = computed(this.readCanUse.bind(this));
  /** The server has answered for this account (before that, "not a tester" only means "not known yet"). */
  readonly known = signal(false);
  /** The testers (filled for an administrator only). */
  readonly testers = signal<BetaTester[]>([]);
  /** The administrators (filled for an administrator only). */
  readonly admins = signal<BetaAdmin[]>([]);

  /** Asks the server who the account is each time somebody signs in. */
  constructor() {
    effect(this.onUser.bind(this));
  }

  private readCanUse(): boolean {
    return this.beta() || this.admin();
  }

  /** Adds a tester by username. Throws the error of the server (for example when the name does not exist). */
  async add(username: string): Promise<void> {
    await this.api.post('/api/beta/testers', { username });
    await this.loadTesters();
  }

  /** Takes a tester out of the program. */
  async remove(userId: string): Promise<void> {
    await this.api.delete('/api/beta/testers/' + encodeURIComponent(userId));
    await this.loadTesters();
  }

  /** Makes a person an administrator, by username. */
  async addAdmin(username: string): Promise<void> {
    await this.api.post('/api/beta/admins', { username });
    await this.loadAdmins();
  }

  /** Takes the administration away from a person. */
  async removeAdmin(userId: string): Promise<void> {
    await this.api.delete('/api/beta/admins/' + encodeURIComponent(userId));
    await this.loadAdmins();
  }

  /** The token the desktop app uses to download the beta versions (testers and administrators; it lasts two hours). */
  feedToken(): Promise<{ token: string; expiresAt: number }> {
    return this.api.get<{ token: string; expiresAt: number }>('/api/beta/feed');
  }

  /** Reads the list of administrators (administrators only). */
  async loadAdmins(): Promise<void> {
    const answer = await this.api.get<{ admins: BetaAdmin[] }>('/api/beta/admins');
    this.admins.set(answer.admins);
  }

  /** Reads the list of testers (administrators only). */
  async loadTesters(): Promise<void> {
    const answer = await this.api.get<{ testers: BetaTester[] }>('/api/beta/testers');
    this.testers.set(answer.testers);
  }

  /**
   * Follows the account: nothing is known while nobody is signed in. Only a change of the person asks again (the profile
   * object changes every time the person edits their name or picture, and that is not a reason to ask).
   */
  private onUser(): void {
    const id = this.auth.user()?.id ?? null;
    if (id === this.userId) {
      return;
    }
    this.userId = id;
    untracked(this.refresh.bind(this, id !== null));
  }

  /** The account the state belongs to. */
  private userId: string | null = null;

  /** Reads the state of the account (or forgets it when nobody is signed in). */
  private refresh(signedIn: boolean): void {
    if (!signedIn) {
      clearTimeout(this.retryTimer);
      this.beta.set(false);
      this.admin.set(false);
      this.owner.set(false);
      this.known.set(false);
      this.testers.set([]);
      this.admins.set([]);
      return;
    }
    this.api
      .get<{ beta: boolean; admin: boolean; owner?: boolean }>('/api/beta/me')
      .then(this.onState.bind(this), this.forget.bind(this));
  }

  /** Keeps the answer, and loads the list for an administrator. */
  private onState(state: { beta: boolean; admin: boolean; owner?: boolean }): void {
    this.beta.set(state.beta);
    this.admin.set(state.admin);
    this.owner.set(state.owner === true);
    this.known.set(true);
    if (state.admin) {
      this.loadTesters().catch(this.forget.bind(this));
      this.loadAdmins().catch(this.forget.bind(this));
    }
  }

  /**
   * The server did not answer (offline, a renewal of the session in the middle, an older server). What was known stays as it
   * was, and the answer is asked for again in a while.
   * ! It must never look like "not a tester any more": the desktop app leaves the beta channel when the account is KNOWN not to
   *   be in the program, and a single failed request used to say exactly that, so the channel went back to Release by itself.
   */
  private forget(): void {
    if (!this.known()) {
      this.beta.set(false);
      this.admin.set(false);
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(this.retry.bind(this), RETRY_MS);
  }

  /** Asks again after a failure, if somebody is still signed in. */
  private retry(): void {
    if (this.auth.user() !== null) {
      this.refresh(true);
    }
  }

  private retryTimer: ReturnType<typeof setTimeout> | undefined;
}
