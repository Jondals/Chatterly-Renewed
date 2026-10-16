/**
 * src/app/features/settings/admin-section.component.ts
 * Settings - Administration (administrators only), in five tabs:
 *   - Overview: how the server is doing (accounts, people online, calls, messages, the disk) at a glance;
 *   - People: find an account, see its role and sessions, and suspend, restore or sign it out everywhere; make it a beta
 *     tester or (owners only) an administrator;
 *   - Beta program: who receives the beta versions of the apps;
 *   - Server: open or close the sign-up, and the announcement every person sees on top of the app;
 *   - Record: what the administrators did, who and when.
 * The server decides everything (backend routes/admin.ts and routes/beta.ts) and refuses these calls to anybody who is not
 * an administrator. ! Nothing here can show a message, a file or a key: the server only has them sealed.
 */
import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import {
  AdminService,
  type AdminFilter,
  type AdminUser,
  type AuditEntry,
} from '../../core/services/admin.service';
import { AuthService } from '../../core/services/auth.service';
import { BetaService, type BetaTester } from '../../core/services/beta.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { describeError } from '../../shared/util/errors';
import { IconComponent } from '../../shared/components/icon.component';
import {
  SegmentedComponent,
  SettingRowComponent,
  ToggleComponent,
} from '../../shared/components/controls.component';

/** The tabs of the administration. */
type AdminTab = 'overview' | 'people' | 'beta' | 'server' | 'record';

/** How each action of the record is read. */
const ACTIONS: Record<string, string> = {
  suspend: 'Suspended {target}',
  restore: 'Restored {target}',
  'sign-out': 'Signed {target} out everywhere',
  'registrations-open': 'Opened the sign-up',
  'registrations-close': 'Closed the sign-up',
  announce: 'Published an announcement',
  'announce-clear': 'Removed the announcement',
  'admin-add': 'Made {target} an administrator',
  'admin-remove': 'Took the administration from {target}',
  'tester-add': 'Made {target} a beta tester',
  'tester-remove': 'Took {target} out of the beta program',
};

@Component({
  selector: 'app-admin-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe, SegmentedComponent, SettingRowComponent, ToggleComponent],
  styles: `
    .ad-tabs {
      position: sticky;
      top: 0;
      z-index: 2;
      padding-bottom: 0.75rem;
    }
    .ad-stats {
      display: grid;
      gap: 0.6rem;
      grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
    }
    .ad-stat {
      display: grid;
      gap: 0.15rem;
      padding: 0.85rem 0.95rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--r-lg);
      background: rgba(0, 0, 0, 0.2);
    }
    .ad-stat b {
      font-size: 1.35rem;
      font-weight: 700;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
    }
    .ad-stat span {
      font-size: 0.6875rem;
      color: var(--muted);
    }
    .ad-stat .ad-icon {
      display: grid;
      place-items: center;
      width: 1.9rem;
      height: 1.9rem;
      margin-bottom: 0.35rem;
      border-radius: calc(var(--r) * 0.7);
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: var(--accent);
    }
    .ad-person {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
      padding: 0.7rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ad-person:last-child {
      border-bottom: 0;
    }
    .ad-avatar {
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      flex-shrink: 0;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      color: var(--accent);
      font-size: 0.8125rem;
      font-weight: 700;
    }
    .ad-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .ad-entry {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0.15rem 0.75rem;
      padding: 0.6rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ad-entry:last-child {
      border-bottom: 0;
    }
  `,
  template: `
    <div class="ad-tabs">
      <app-segmented [options]="tabs" [value]="tab()" (valueChange)="open($event)" />
    </div>

    @if (admin.unavailable()) {
      <section class="settings-card">
        <p class="py-3 text-sm text-muted">
          {{
            'The server runs an older version without these tools. They appear when it is updated.'
              | t
          }}
        </p>
      </section>
    }

    @switch (tab()) {
      @case ('overview') {
        @if (admin.overview(); as o) {
          <div class="ad-stats">
            <div class="ad-stat">
              <span class="ad-icon"><app-icon name="users" [size]="16" /></span>
              <b>{{ o.users.total }}</b
              ><span>{{ 'Accounts' | t }} · +{{ o.users.new7d }} {{ 'this week' | t }}</span>
            </div>
            <div class="ad-stat">
              <span class="ad-icon"><app-icon name="activity" [size]="16" /></span>
              <b>{{ o.users.online }}</b
              ><span>{{ 'Online now' | t }} · {{ o.connections }} {{ 'connections' | t }}</span>
            </div>
            <div class="ad-stat">
              <span class="ad-icon"><app-icon name="phone" [size]="16" /></span>
              <b>{{ o.calls.calls }}</b
              ><span>{{ 'Calls now' | t }} · {{ o.calls.people }} {{ 'people' | t }}</span>
            </div>
            <div class="ad-stat">
              <span class="ad-icon"><app-icon name="send" [size]="16" /></span>
              <b>{{ o.messages.last24h }}</b
              ><span>{{ 'Messages in 24 h' | t }} · {{ o.messages.total }} {{ 'in all' | t }}</span>
            </div>
            <div class="ad-stat">
              <span class="ad-icon"><app-icon name="hash" [size]="16" /></span>
              <b>{{ o.guilds }}</b
              ><span>{{ 'Groups' | t }}</span>
            </div>
            <div class="ad-stat">
              <span class="ad-icon"><app-icon name="cpu" [size]="16" /></span>
              <b>{{ megabytes(o.storage.uploads + o.storage.database) }}</b
              ><span
                >{{ 'MB on the disk' | t }} · {{ megabytes(o.storage.vault) }} MB
                {{ 'of libraries' | t }}</span
              >
            </div>
          </div>
          <section class="settings-card">
            <app-setting-row title="Version of the server">
              <span class="chip font-mono">{{ o.version }}</span>
            </app-setting-row>
            <app-setting-row title="Running for">
              <span class="chip font-mono">{{ uptime(o.uptimeSec) }}</span>
            </app-setting-row>
            <app-setting-row title="Sign-up">
              <span
                class="chip"
                [class.chip-accent]="o.registrations === 'open'"
                [class.chip-amber]="o.registrations === 'closed'"
                >{{ (o.registrations === 'open' ? 'Open' : 'Closed') | t }}</span
              >
            </app-setting-row>
            <app-setting-row title="Suspended accounts">
              <span class="chip" [class.chip-red]="o.users.suspended > 0">{{
                o.users.suspended
              }}</span>
            </app-setting-row>
          </section>
          <p class="mt-3 flex items-start gap-2 text-xs text-dim">
            <app-icon name="lock" [size]="13" class="mt-0.5 shrink-0 text-accent" />
            {{
              'These are the only things the server knows in clear: names, dates and totals. Messages, files, calls and keys are encrypted on the devices, and nobody here can read them.'
                | t
            }}
          </p>
        } @else if (!admin.unavailable()) {
          <p class="py-6 text-center text-sm text-muted">{{ 'Loading…' | t }}</p>
        }
      }

      @case ('people') {
        <section class="settings-card">
          <form class="flex flex-wrap gap-2 py-3" (submit)="find($event)">
            <input
              class="input min-w-0 flex-1"
              type="search"
              maxlength="40"
              autocomplete="off"
              [placeholder]="'Search by name' | t"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />
            <button type="submit" class="btn btn-primary">
              <app-icon name="search" [size]="15" /> {{ 'Search' | t }}
            </button>
          </form>
          <div class="pb-3">
            <app-segmented
              [options]="filters"
              [value]="filter()"
              (valueChange)="setFilter($event)"
            />
          </div>
        </section>
        <section class="settings-card">
          @for (person of admin.users(); track person.id) {
            <div class="ad-person">
              <span class="ad-avatar">{{ initials(person) }}</span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <b class="truncate text-sm">{{ person.displayName }}</b>
                  @if (person.owner) {
                    <span class="chip chip-violet">{{ 'Owner' | t }}</span>
                  } @else if (person.admin) {
                    <span class="chip chip-violet">{{ 'Administrator' | t }}</span>
                  }
                  @if (person.tester) {
                    <span class="chip chip-accent">{{ 'Beta' | t }}</span>
                  }
                  @if (person.suspended) {
                    <span class="chip chip-red">{{ 'Suspended' | t }}</span>
                  }
                </div>
                <div class="truncate text-xs text-muted">
                  &#64;{{ person.username }} · {{ joined(person) }} · {{ sessionsText(person) }}
                  @if (person.suspended && person.reason) {
                    · “{{ person.reason }}”
                  }
                </div>
              </div>
              <div class="ad-actions">
                <button
                  type="button"
                  class="btn btn-sm"
                  [disabled]="busy()"
                  (click)="toggleTester(person)"
                >
                  {{ (person.tester ? 'Remove from beta' : 'Make tester') | t }}
                </button>
                @if (beta.owner() && !person.owner) {
                  <button
                    type="button"
                    class="btn btn-sm"
                    [disabled]="busy()"
                    (click)="toggleAdmin(person)"
                  >
                    {{ (person.admin ? 'Remove administrator' : 'Make administrator') | t }}
                  </button>
                }
                @if (canAct(person)) {
                  <button
                    type="button"
                    class="btn btn-sm"
                    [disabled]="busy() || person.sessions === 0"
                    (click)="signOut(person)"
                  >
                    <app-icon name="logout" [size]="13" /> {{ 'Sign out everywhere' | t }}
                  </button>
                  @if (person.suspended) {
                    <button
                      type="button"
                      class="btn btn-sm"
                      [disabled]="busy()"
                      (click)="restore(person)"
                    >
                      {{ 'Restore' | t }}
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="btn btn-sm btn-soft-danger"
                      [disabled]="busy()"
                      (click)="suspend(person)"
                    >
                      {{ 'Suspend' | t }}
                    </button>
                  }
                }
              </div>
            </div>
          } @empty {
            <p class="py-4 text-sm text-muted">{{ 'Nobody matches.' | t }}</p>
          }
        </section>
      }

      @case ('beta') {
        <section class="settings-card">
          <h2 class="settings-card-title">{{ 'Beta testers' | t }}</h2>
          <p class="mb-4 text-sm text-muted">
            {{
              'People who receive the beta versions of the apps before everybody else, and tell you what breaks. They choose in Settings > Updates whether to use them.'
                | t
            }}
          </p>
          <form class="flex flex-wrap gap-2 pb-3" (submit)="addTester($event)">
            <input
              class="input min-w-0 flex-1"
              type="text"
              maxlength="24"
              autocomplete="off"
              [placeholder]="'Username' | t"
              [value]="name()"
              (input)="name.set($any($event.target).value)"
            />
            <button type="submit" class="btn btn-primary" [disabled]="busy() || !name().trim()">
              <app-icon name="user-plus" [size]="16" /> {{ 'Add tester' | t }}
            </button>
          </form>
        </section>
        <section class="settings-card">
          @for (tester of beta.testers(); track tester.id) {
            <div class="ad-person">
              <span class="ad-avatar">{{ initialsOf(tester.displayName) }}</span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold">{{ tester.displayName }}</div>
                <div class="truncate text-xs text-muted">
                  &#64;{{ tester.username }} · {{ since(tester) }}
                </div>
              </div>
              <button
                type="button"
                class="btn btn-icon btn-sm btn-ghost"
                [attr.aria-label]="'Remove' | t"
                (click)="removeTester(tester.id)"
              >
                <app-icon name="x" [size]="16" />
              </button>
            </div>
          } @empty {
            <p class="py-4 text-sm text-muted">{{ 'Nobody is a beta tester yet.' | t }}</p>
          }
        </section>
      }

      @case ('server') {
        <section class="settings-card">
          <h2 class="settings-card-title">{{ 'Sign-up' | t }}</h2>
          <app-setting-row
            title="New accounts can be made"
            hint="Closed, nobody can make an account on this server (the owners still can). The people who have one keep it."
          >
            <app-toggle
              [checked]="admin.overview()?.registrations !== 'closed'"
              (checkedChange)="setRegistrations($event)"
              [label]="'New accounts can be made' | t"
            />
          </app-setting-row>
        </section>
        <section class="settings-card">
          <h2 class="settings-card-title">{{ 'Announcement' | t }}</h2>
          <p class="mb-3 text-xs text-muted">
            {{
              'A short text every person sees on top of the app at once (a maintenance, a new version). Each person can hide it.'
                | t
            }}
          </p>
          <textarea
            class="input min-h-24 w-full resize-y py-2.5"
            maxlength="300"
            [placeholder]="'For example: the server restarts at 22:00 for a few minutes.' | t"
            [value]="announcement()"
            (input)="announcement.set($any($event.target).value)"
          ></textarea>
          <div class="flex flex-wrap items-center gap-2 py-3">
            <app-segmented [options]="tones" [value]="tone()" (valueChange)="setTone($event)" />
            <span class="flex-1"></span>
            <span class="font-mono text-[0.6875rem] text-dim">{{ announcement().length }}/300</span>
            @if (admin.overview()?.announcement) {
              <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="publish('')">
                {{ 'Remove it' | t }}
              </button>
            }
            <button
              type="button"
              class="btn btn-sm btn-primary"
              [disabled]="busy() || !announcement().trim()"
              (click)="publish(announcement())"
            >
              <app-icon name="bell" [size]="13" /> {{ 'Publish' | t }}
            </button>
          </div>
          @if (admin.overview()?.announcement; as now) {
            <p class="pb-3 text-xs text-muted">
              {{ 'In force:' | t }} <span class="text-fg">{{ now.text }}</span>
            </p>
          }
        </section>
        <section class="settings-card">
          <h2 class="settings-card-title">{{ 'Administrators' | t }}</h2>
          <p class="mb-3 text-xs text-muted">
            {{
              'Only an owner (set in the server) makes or removes administrators. Administrators manage the beta program, the accounts and the announcements.'
                | t
            }}
          </p>
          @if (beta.owner()) {
            <form class="flex flex-wrap gap-2 pb-3" (submit)="addAdmin($event)">
              <input
                class="input min-w-0 flex-1"
                type="text"
                maxlength="24"
                autocomplete="off"
                [placeholder]="'Username' | t"
                [value]="adminName()"
                (input)="adminName.set($any($event.target).value)"
              />
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="busy() || !adminName().trim()"
              >
                <app-icon name="user-plus" [size]="16" /> {{ 'Add administrator' | t }}
              </button>
            </form>
          }
          @for (a of beta.admins(); track a.id) {
            <div class="ad-person">
              <span class="ad-avatar">{{ initialsOf(a.displayName) }}</span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold">{{ a.displayName }}</div>
                <div class="truncate text-xs text-muted">
                  &#64;{{ a.username }}
                  @if (a.fixed) {
                    · {{ 'Owner' | t }}
                  }
                </div>
              </div>
              @if (!a.fixed && beta.owner()) {
                <button
                  type="button"
                  class="btn btn-icon btn-sm btn-ghost"
                  [attr.aria-label]="'Remove' | t"
                  (click)="removeAdmin(a.id)"
                >
                  <app-icon name="x" [size]="16" />
                </button>
              }
            </div>
          }
        </section>
      }

      @case ('record') {
        <section class="settings-card">
          @for (entry of admin.audit(); track $index) {
            <div class="ad-entry">
              <span class="font-mono text-[0.6875rem] text-dim">{{ when(entry) }}</span>
              <span class="min-w-0 text-sm">
                <b>&#64;{{ entry.actor || '—' }}</b> {{ describe(entry) }}
                @if (entry.detail && entry.action !== 'announce-clear') {
                  <span class="block truncate text-xs text-muted">“{{ entry.detail }}”</span>
                }
              </span>
            </div>
          } @empty {
            <p class="py-4 text-sm text-muted">{{ 'Nothing has been done yet.' | t }}</p>
          }
        </section>
      }
    }
  `,
})
export class AdminSectionComponent implements OnInit {
  protected readonly admin = inject(AdminService);
  protected readonly beta = inject(BetaService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);

  protected readonly tab = signal<AdminTab>('overview');
  protected readonly tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'people', label: 'People' },
    { id: 'beta', label: 'Beta program' },
    { id: 'server', label: 'Server' },
    { id: 'record', label: 'Record' },
  ];
  protected readonly filters = [
    { id: 'all', label: 'Everybody' },
    { id: 'suspended', label: 'Suspended' },
    { id: 'admins', label: 'Administrators' },
    { id: 'testers', label: 'Testers' },
  ];
  protected readonly tones = [
    { id: 'info', label: 'Information' },
    { id: 'warning', label: 'Warning' },
  ];
  protected readonly query = signal('');
  protected readonly filter = signal<AdminFilter>('all');
  protected readonly name = signal('');
  protected readonly adminName = signal('');
  protected readonly announcement = signal('');
  protected readonly tone = signal<'info' | 'warning'>('info');
  protected readonly busy = signal(false);
  /** The id of the person looking (they cannot act on themselves). */
  private readonly myself = computed(this.readMyself.bind(this));

  ngOnInit(): void {
    void this.refresh();
  }

  private readMyself(): string {
    return this.auth.user()?.id ?? '';
  }

  /** Shows a tab and reads what it needs. */
  protected open(id: string): void {
    this.tab.set(id as AdminTab);
    void this.refresh();
  }

  /** Reads what the tab in view shows. */
  private async refresh(): Promise<void> {
    try {
      switch (this.tab()) {
        case 'overview':
        case 'server':
          await this.admin.loadOverview();
          this.announcement.set(this.admin.overview()?.announcement?.text ?? '');
          this.tone.set(this.admin.overview()?.announcement?.tone ?? 'info');
          if (this.tab() === 'server') await this.beta.loadAdmins();
          break;
        case 'people':
          await this.admin.search(this.query(), this.filter());
          break;
        case 'beta':
          await this.beta.loadTesters();
          break;
        case 'record':
          await this.admin.loadAudit();
          break;
      }
    } catch (e) {
      if (!this.admin.unavailable()) {
        this.toast.error(this.i18n.t('Could not load it'), this.i18n.t(describeError(e)));
      }
    }
  }

  // ── People ────────────────────────────────────────────────────────────────────────────────────

  protected find(event: Event): void {
    event.preventDefault();
    void this.refresh();
  }

  protected setFilter(id: string): void {
    this.filter.set(id as AdminFilter);
    void this.refresh();
  }

  /** Owners are never acted on; only an owner acts on another administrator (the server checks it again). */
  protected canAct(person: AdminUser): boolean {
    return !person.owner && (!person.admin || this.beta.owner()) && person.id !== this.myself();
  }

  /** Runs an action, says when it fails and reads the list again. */
  private async act(action: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.toast.success(this.i18n.t(done));
    } catch (e) {
      this.toast.error(this.i18n.t('Could not do it'), this.i18n.t(describeError(e)));
    } finally {
      this.busy.set(false);
    }
    await this.refresh();
  }

  protected async suspend(person: AdminUser): Promise<void> {
    const reason = await this.dialog.prompt(
      this.i18n.t('Suspend {name}', { name: '@' + person.username }),
      this.i18n.t(
        'Their sessions end now and they cannot sign in until you restore the account. Nothing of it is deleted. The reason is what they are told (optional).',
      ),
      '',
      this.i18n.t('Reason'),
    );
    if (reason === null) return;
    await this.act(this.admin.suspend.bind(this.admin, person.id, reason), 'Account suspended');
  }

  protected async restore(person: AdminUser): Promise<void> {
    await this.act(this.admin.restore.bind(this.admin, person.id), 'Account restored');
  }

  protected async signOut(person: AdminUser): Promise<void> {
    const sure = await this.dialog.confirm(
      this.i18n.t('Sign out everywhere'),
      this.i18n.t('Every session of @{name} ends now, on every device. They can sign in again.', {
        name: person.username,
      }),
      { confirmLabel: this.i18n.t('Sign out everywhere'), danger: true },
    );
    if (!sure) return;
    await this.act(this.admin.signOut.bind(this.admin, person.id), 'Signed out everywhere');
  }

  protected async toggleTester(person: AdminUser): Promise<void> {
    await this.act(
      person.tester
        ? this.beta.remove.bind(this.beta, person.id)
        : this.beta.add.bind(this.beta, person.username),
      person.tester ? 'Taken out of the beta program' : 'Added to the beta program',
    );
  }

  protected async toggleAdmin(person: AdminUser): Promise<void> {
    await this.act(
      person.admin
        ? this.beta.removeAdmin.bind(this.beta, person.id)
        : this.beta.addAdmin.bind(this.beta, person.username),
      person.admin ? 'Administration taken away' : 'Administrator added',
    );
  }

  // ── Beta program ──────────────────────────────────────────────────────────────────────────────

  protected async addTester(event: Event): Promise<void> {
    event.preventDefault();
    const username = this.name().trim().replace(/^@/, '');
    if (!username) return;
    this.busy.set(true);
    try {
      await this.beta.add(username);
      this.name.set('');
    } catch (e) {
      this.toast.error(this.i18n.t('Could not add the tester'), this.i18n.t(describeError(e)));
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeTester(id: string): Promise<void> {
    try {
      await this.beta.remove(id);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not remove it'), this.i18n.t(describeError(e)));
    }
  }

  // ── Server ────────────────────────────────────────────────────────────────────────────────────

  protected async setRegistrations(open: boolean): Promise<void> {
    await this.act(
      this.admin.setRegistrations.bind(this.admin, open),
      open ? 'The sign-up is open' : 'The sign-up is closed',
    );
  }

  protected setTone(id: string): void {
    this.tone.set(id === 'warning' ? 'warning' : 'info');
  }

  protected async publish(text: string): Promise<void> {
    await this.act(
      this.admin.announce.bind(this.admin, text, this.tone()),
      text.trim() ? 'Announcement published' : 'Announcement removed',
    );
  }

  protected async addAdmin(event: Event): Promise<void> {
    event.preventDefault();
    const username = this.adminName().trim().replace(/^@/, '');
    if (!username) return;
    this.busy.set(true);
    try {
      await this.beta.addAdmin(username);
      this.adminName.set('');
    } catch (e) {
      this.toast.error(
        this.i18n.t('Could not add the administrator'),
        this.i18n.t(describeError(e)),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeAdmin(id: string): Promise<void> {
    try {
      await this.beta.removeAdmin(id);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not remove it'), this.i18n.t(describeError(e)));
    }
  }

  // ── Texts ─────────────────────────────────────────────────────────────────────────────────────

  protected megabytes(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1);
  }

  /** "3 d 4 h", "5 h 12 min" or "8 min". */
  protected uptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return days + ' d ' + hours + ' h';
    if (hours > 0) return hours + ' h ' + minutes + ' min';
    return minutes + ' min';
  }

  protected initials(person: AdminUser): string {
    return this.initialsOf(person.displayName || person.username);
  }

  protected initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return (
      (parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')
    ).toUpperCase();
  }

  protected joined(person: AdminUser): string {
    return this.i18n.t('Joined {date}', { date: new Date(person.createdAt).toLocaleDateString() });
  }

  protected sessionsText(person: AdminUser): string {
    return person.sessions === 1
      ? this.i18n.t('1 session')
      : this.i18n.t('{n} sessions', { n: String(person.sessions) });
  }

  /** "Added 3/4/2026". */
  protected since(tester: BetaTester): string {
    return this.i18n.t('Added {date}', { date: new Date(tester.addedAt).toLocaleDateString() });
  }

  protected when(entry: AuditEntry): string {
    return new Date(entry.at).toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected describe(entry: AuditEntry): string {
    const text = ACTIONS[entry.action] ?? entry.action;
    return this.i18n.t(text, { target: entry.target ? '@' + entry.target : '—' });
  }
}
