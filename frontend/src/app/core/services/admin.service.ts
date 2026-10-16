/**
 * src/app/core/services/admin.service.ts
 * The administration of the server (Settings > Administration, administrators only): the numbers of the server, the
 * accounts (suspend, restore, close their sessions), the sign-up, the announcement for everybody and the record of what the
 * administrators did. The server decides who may do what (backend routes/admin.ts); the page only shows what it is told.
 * ! Nothing here can show a message, a file or a key: the server only knows them sealed.
 */
import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import type { Announcement } from './announcement.service';

/** The numbers of the server. */
export interface AdminOverview {
  version: string;
  uptimeSec: number;
  users: { total: number; new7d: number; suspended: number; online: number };
  guilds: number;
  messages: { total: number; last24h: number };
  calls: { calls: number; people: number };
  connections: number;
  storage: { uploads: number; database: number; vault: number };
  registrations: 'open' | 'closed';
  announcement: Announcement | null;
  /** The person looking is an owner of the server (ADMIN_USERS). */
  owner: boolean;
}

/** One account as the administration sees it. */
export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  suspended: boolean;
  suspendedAt: number;
  reason: string;
  sessions: number;
  tester: boolean;
  admin: boolean;
  owner: boolean;
}

/** One line of the record. */
export interface AuditEntry {
  at: number;
  action: string;
  detail: string;
  actor: string;
  target: string;
}

/** Which accounts the list shows. */
export type AdminFilter = 'all' | 'suspended' | 'admins' | 'testers';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly api = inject(ApiService);

  readonly overview = signal<AdminOverview | null>(null);
  readonly users = signal<AdminUser[]>([]);
  readonly audit = signal<AuditEntry[]>([]);
  /** The server is older than this app and has no administration yet (404 to everything). */
  readonly unavailable = signal(false);

  /** Reads the numbers of the server. */
  async loadOverview(): Promise<void> {
    try {
      this.overview.set(await this.api.get<AdminOverview>('/api/admin/overview'));
      this.unavailable.set(false);
    } catch (error) {
      if ((error as { status?: number }).status === 404) this.unavailable.set(true);
      throw error;
    }
  }

  /** Finds accounts by their name (the newest when the search is empty). */
  async search(query: string, filter: AdminFilter): Promise<void> {
    const params = new URLSearchParams({ q: query.trim().slice(0, 40), filter });
    const answer = await this.api.get<{ users: AdminUser[] }>('/api/admin/users?' + params);
    this.users.set(answer.users);
  }

  /** Reads the record of the administration. */
  async loadAudit(): Promise<void> {
    const answer = await this.api.get<{ entries: AuditEntry[] }>('/api/admin/audit');
    this.audit.set(answer.entries);
  }

  /** Suspends an account (its sessions end now and it cannot sign in). */
  async suspend(userId: string, reason: string): Promise<void> {
    await this.api.post('/api/admin/users/' + encodeURIComponent(userId) + '/suspend', {
      reason: reason.trim().slice(0, 200),
    });
  }

  /** Gives a suspended account its access back. */
  async restore(userId: string): Promise<void> {
    await this.api.post('/api/admin/users/' + encodeURIComponent(userId) + '/restore', {});
  }

  /** Closes every session of an account. */
  async signOut(userId: string): Promise<void> {
    await this.api.post('/api/admin/users/' + encodeURIComponent(userId) + '/sign-out', {});
  }

  /** Opens or closes the sign-up. */
  async setRegistrations(open: boolean): Promise<void> {
    await this.api.put('/api/admin/registrations', { open });
    await this.loadOverview();
  }

  /** Puts the announcement for everybody (an empty text takes it away). */
  async announce(text: string, tone: 'info' | 'warning'): Promise<void> {
    await this.api.put('/api/admin/announcement', { text: text.trim().slice(0, 300), tone });
    await this.loadOverview();
  }
}
