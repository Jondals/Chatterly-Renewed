/**
 * src/app/core/services/beta.service.ts
 * The beta program: whether the account is a tester or an administrator, and (for an administrator) the list of testers.
 * Testers can ask the desktop app for the beta versions (Settings > Updates); administrators manage the list in
 * Settings > Administration. The server decides everything: the page only shows what it is told.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

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

  /** Follows the account: nothing is known while nobody is signed in. */
  private onUser(): void {
    const user = this.auth.user();
    untracked(this.refresh.bind(this, user !== null));
  }

  /** Reads the state of the account (or forgets it when nobody is signed in). */
  private refresh(signedIn: boolean): void {
    if (!signedIn) {
      this.beta.set(false);
      this.admin.set(false);
      this.known.set(false);
      this.testers.set([]);
      this.admins.set([]);
      return;
    }
    this.api
      .get<{ beta: boolean; admin: boolean }>('/api/beta/me')
      .then(this.onState.bind(this), this.forget.bind(this));
  }

  /** Keeps the answer, and loads the list for an administrator. */
  private onState(state: { beta: boolean; admin: boolean }): void {
    this.beta.set(state.beta);
    this.admin.set(state.admin);
    this.known.set(true);
    if (state.admin) {
      this.loadTesters().catch(this.forget.bind(this));
      this.loadAdmins().catch(this.forget.bind(this));
    }
  }

  /** The server did not answer (offline, an older server): the beta features simply stay hidden. */
  private forget(): void {
    this.beta.set(false);
    this.admin.set(false);
  }
}
