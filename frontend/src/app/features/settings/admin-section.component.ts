/**
 * src/app/features/settings/admin-section.component.ts
 * Settings - Administration (administrators only), in four tabs:
 *   - Overview: how the server is doing (accounts, people online, calls, messages, the disk) at a glance;
 *   - People: find an account, see its role and sessions, and suspend, restore or sign it out everywhere; make it a beta
 *     tester (that is where the testers are made) or (owners only) an administrator or erase it;
 *   - Server: open or close the sign-up, and the announcement every person sees on top of the app;
 *   - Record: what the administrators did, who and when.
 * The server decides everything (backend routes/admin.ts and routes/beta.ts) and refuses these calls to anybody who is not
 * an administrator. ! Nothing here can show a message, a file or a key: the server only has them sealed.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal, type OnInit } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import {
  AdminService,
  type AdminFilter,
  type AdminSession,
  type AdminUser,
  type AuditEntry,
} from '../../core/services/admin.service';
import { AuthService } from '../../core/services/auth.service';
import { BetaService } from '../../core/services/beta.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { describeError } from '../../shared/util/errors';
import { IconComponent } from '../../shared/components/icon.component';
import { SettingRowComponent, ToggleComponent } from '../../shared/components/controls.component';

/** The tabs of the administration. */
type AdminTab = 'overview' | 'people' | 'server' | 'record';

/** How each action of the record is read. */
const ACTIONS: Record<string, string> = {
  suspend: 'Suspended {target}',
  restore: 'Restored {target}',
  'sign-out': 'Signed {target} out everywhere',
  'reset-password': 'Reset the password of {target}',
  'delete-account': 'Deleted the account of {detail}',
  'audit-clear': 'Emptied the record',
  'close-session': 'Closed one session of {target}',
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-admin-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe, SettingRowComponent, ToggleComponent],
  styles: `
    .ad-tabs {
      position: sticky;
      top: 0;
      z-index: 2;
      padding-bottom: 0.75rem;
    }
    .ad-stats {
      display: grid;
      gap: 0 1.5rem;
      grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    }
    .ad-stat {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      column-gap: 0.75rem;
      padding: 0.8rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ad-stat b {
      font-size: 1.25rem;
      font-weight: 700;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
    }
    .ad-stat span {
      grid-column: 2;
      font-size: 0.6875rem;
      color: var(--muted);
    }
    .ad-stat .ad-icon {
      grid-row: 1 / span 2;
      grid-column: 1;
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: var(--accent);
    }
    .ad-person {
      display: grid;
      gap: 0.6rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ad-person:last-child {
      border-bottom: 0;
    }
    .ad-head {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      width: 100%;
      min-width: 0;
      text-align: left;
    }
    .ad-avatar {
      display: grid;
      place-items: center;
      width: 2.4rem;
      height: 2.4rem;
      flex-shrink: 0;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      color: var(--accent);
      font-size: 0.875rem;
      font-weight: 700;
    }
    .ad-actions {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
      gap: 0.4rem;
      padding-left: 3.1rem;
    }
    .ad-actions .btn {
      min-width: 0;
      height: auto;
      min-height: 2rem;
      justify-content: center;
      padding-block: 0.4rem;
      text-align: center;
      white-space: normal;
      line-height: 1.2;
    }
    .ad-sessions {
      display: grid;
      padding-left: 3.1rem;
    }
    /* The sessions and the actions unfold with a smooth change of height (the same easing as the other folds of the app). */
    .ad-fold {
      display: grid;
      animation: ad-open 0.42s var(--ease) both;
    }
    .ad-fold-inner {
      display: grid;
      gap: 0.5rem;
      min-height: 0;
      overflow: hidden;
    }
    @keyframes ad-open {
      from {
        grid-template-rows: 0fr;
        opacity: 0;
      }
      to {
        grid-template-rows: 1fr;
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ad-fold {
        animation: none;
      }
    }
    .ad-session {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.45rem 0;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    @media (max-width: 639px) {
      .ad-actions,
      .ad-sessions {
        padding-left: 0;
      }
      .ad-actions {
        grid-template-columns: 1fr 1fr;
      }
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
      <div class="grid grid-cols-4 gap-1 rounded-ui bg-black/30 p-1" role="tablist">
        @for (t of tabs; track t.id) {
          <button
            type="button"
            role="tab"
            class="btn btn-sm min-w-0 justify-center !px-1"
            [class.btn-primary]="tab() === t.id"
            [class.btn-ghost]="tab() !== t.id"
            [attr.aria-selected]="tab() === t.id"
            (click)="open(t.id)"
          >
            <span class="truncate">{{ t.label | t }}</span>
          </button>
        }
      </div>
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
          <section class="settings-card">
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
          </section>
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
            <div class="grid grid-cols-2 gap-1 rounded-ui bg-black/30 p-1 sm:grid-cols-4" role="radiogroup">
              @for (f of filters; track f.id) {
                <button
                  type="button"
                  role="radio"
                  class="btn btn-sm min-w-0 justify-center !px-2"
                  [class.btn-primary]="filter() === f.id"
                  [class.btn-ghost]="filter() !== f.id"
                  [attr.aria-checked]="filter() === f.id"
                  (click)="setFilter(f.id)"
                >
                  <span class="truncate">{{ f.label | t }}</span>
                </button>
              }
            </div>
          </div>
        </section>
        <section class="settings-card">
          @for (person of people(); track person.id) {
            <div class="ad-person">
              <button
                type="button"
                class="ad-head"
                [attr.aria-expanded]="expanded() === person.id"
                (click)="toggle(person)"
              >
                <span class="ad-avatar">{{ initials(person) }}</span>
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-1.5">
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
                    @if (person.recoveryAt) {
                      <span class="chip chip-amber">{{ 'Cannot sign in' | t }}</span>
                    }
                  </span>
                  <span class="mt-0.5 block truncate text-xs text-muted"
                    >&#64;{{ person.username }}</span
                  >
                  <span class="block text-xs text-dim"
                    >{{ joined(person) }} · {{ sessionsText(person) }}</span
                  >
                </span>
                <app-icon
                  name="chevron-down"
                  [size]="16"
                  class="shrink-0 text-muted transition-transform"
                  [class.rotate-180]="expanded() === person.id"
                />
              </button>
              @if (person.suspended && person.reason) {
                <p class="rounded-ui bg-red/10 px-3 py-2 text-xs text-muted">“{{ person.reason }}”</p>
              }
              @if (expanded() === person.id) {
                <div class="ad-fold"><div class="ad-fold-inner">
                <div class="ad-sessions">
                  <div class="label">{{ 'Open sessions' | t }}</div>
                  @if (sessionList(); as list) {
                    @for (item of list; track item.id) {
                      <div class="ad-session">
                        <app-icon name="smartphone" [size]="15" class="shrink-0 text-muted" />
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-xs font-semibold">
                            {{ 'Session' | t }} · {{ shortId(item) }}
                            @if (item.online) {
                              <span class="chip chip-accent ml-1">{{ 'Connected now' | t }}</span>
                            }
                          </span>
                          <span class="block text-[0.6875rem] text-dim">{{ sessionDates(item) }}</span>
                        </span>
                        @if (canAct(person)) {
                          <button
                            type="button"
                            class="btn btn-sm btn-soft-danger"
                            [disabled]="busy()"
                            (click)="closeSession(person, item)"
                          >
                            {{ 'Close' | t }}
                          </button>
                        }
                      </div>
                    } @empty {
                      <p class="text-xs text-muted">{{ 'No open sessions.' | t }}</p>
                    }
                    <p class="flex items-start gap-1.5 text-[0.6875rem] text-dim">
                      <app-icon name="lock" [size]="12" class="mt-0.5 shrink-0 text-accent" />
                      {{
                        'Only the day each one opened. The server keeps no address, device or place.'
                          | t
                      }}
                    </p>
                  } @else {
                    <p class="text-xs text-muted">{{ 'Loading…' | t }}</p>
                  }
                </div>
              <div class="ad-actions">
                @if (!person.owner) {
                  <button
                    type="button"
                    class="btn btn-sm"
                    [disabled]="busy()"
                    (click)="toggleTester(person)"
                  >
                    {{ (person.tester ? 'Remove from beta' : 'Make tester') | t }}
                  </button>
                }
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
                    [class.btn-primary]="person.recoveryAt > 0"
                    [disabled]="busy()"
                    (click)="resetPassword(person)"
                  >
                    <app-icon name="key" [size]="13" /> {{ 'Reset password' | t }}
                  </button>
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
                  @if (beta.owner()) {
                    <button
                      type="button"
                      class="btn btn-sm btn-soft-danger"
                      [disabled]="busy()"
                      (click)="deleteAccount(person)"
                    >
                      <app-icon name="trash" [size]="13" /> {{ 'Delete account' | t }}
                    </button>
                  }
                }
              </div>
              </div></div>
              }
            </div>
          } @empty {
            <p class="py-4 text-sm text-muted">{{ 'Nobody matches.' | t }}</p>
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
          <div class="mt-1 flex items-center justify-between gap-2 text-[0.6875rem] text-dim">
            <span>{{ 'Tone' | t }}</span>
            <span class="font-mono">{{ announcement().length }}/300</span>
          </div>
          <div class="mt-1.5 grid grid-cols-2 gap-1 rounded-ui bg-black/30 p-1" role="radiogroup">
            @for (t of tones; track t.id) {
              <button
                type="button"
                role="radio"
                class="btn btn-sm min-w-0 justify-center"
                [class.btn-primary]="tone() === t.id"
                [class.btn-ghost]="tone() !== t.id"
                [attr.aria-checked]="tone() === t.id"
                (click)="setTone(t.id)"
              >
                {{ t.label | t }}
              </button>
            }
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2 py-3">
            @if (admin.overview()?.announcement) {
              <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="publish('')">
                {{ 'Remove it' | t }}
              </button>
            }
            <button
              type="button"
              class="btn btn-sm btn-primary max-sm:flex-1"
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
      }

      @case ('record') {
        <section class="settings-card">
          @if (beta.owner() && admin.audit().length > 0) {
            <div class="flex justify-end pb-2 pt-3">
              <button
                type="button"
                class="btn btn-sm btn-soft-danger gap-1.5"
                [disabled]="busy()"
                (click)="clearRecord()"
              >
                <app-icon name="trash" [size]="13" /> {{ 'Clear the record' | t }}
              </button>
            </div>
          }
          @for (entry of admin.audit(); track $index) {
            <div class="ad-entry">
              <span class="font-mono text-[0.6875rem] text-dim">{{ when(entry) }}</span>
              <span class="min-w-0 text-sm">
                <b>&#64;{{ entry.actor || '—' }}</b> {{ describe(entry) }}
                @if (entry.detail && entry.action !== 'announce-clear' && entry.action !== 'delete-account') {
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
  protected readonly announcement = signal('');
  protected readonly tone = signal<'info' | 'warning'>('info');
  protected readonly busy = signal(false);
  /** The person whose sessions are open on screen, and their sessions (null while they load). */
  protected readonly expanded = signal<string | null>(null);
  protected readonly sessionList = signal<AdminSession[] | null>(null);
  /** The accounts as a list: the person looking first, then the rest in the order they were made (the newest last). */
  protected readonly people = computed(this.sortPeople.bind(this));
  /** The id of the person looking (they cannot act on themselves). */
  private readonly myself = computed(this.readMyself.bind(this));

  ngOnInit(): void {
    void this.refresh();
  }

  private sortPeople(): AdminUser[] {
    const me = this.myself();
    return [...this.admin.users()].sort(function order(a, b) {
      if (a.id === me) return b.id === me ? 0 : -1;
      if (b.id === me) return 1;
      return a.createdAt - b.createdAt;
    });
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
          // Whether this account is an owner decides which buttons a person has (the answer comes with the administrators).
          await Promise.all([this.admin.search(this.query(), this.filter()), this.beta.loadAdmins()]);
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

  /** Opens or closes the sessions of a person (they are read when opened). */
  protected async toggle(person: AdminUser): Promise<void> {
    if (this.expanded() === person.id) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(person.id);
    await this.loadSessions(person);
  }

  private async loadSessions(person: AdminUser): Promise<void> {
    this.sessionList.set(null);
    try {
      const list = await this.admin.sessionsOf(person.id);
      if (this.expanded() === person.id) this.sessionList.set(list);
    } catch (e) {
      this.sessionList.set([]);
      this.toast.error(this.i18n.t('Could not load it'), this.i18n.t(describeError(e)));
    }
  }

  /** Closes one session of a person; the others stay open. */
  protected async closeSession(person: AdminUser, item: AdminSession): Promise<void> {
    const sure = await this.dialog.confirm(
      this.i18n.t('Close this session'),
      this.i18n.t(
        'That device of @{name} has to sign in again. Their other devices stay signed in.',
        { name: person.username },
      ),
      { confirmLabel: this.i18n.t('Close'), danger: true },
    );
    if (!sure) return;
    await this.act(this.admin.closeSession.bind(this.admin, person.id, item.id), 'Session closed');
    await this.loadSessions(person);
  }

  protected shortId(item: AdminSession): string {
    return item.id.slice(0, 4);
  }

  protected sessionDates(item: AdminSession): string {
    return this.i18n.t('Opened {date} · ends {end}', {
      date: new Date(item.createdAt).toLocaleDateString(),
      end: new Date(item.expiresAt).toLocaleDateString(),
    });
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

  /** Empties the record (owners only, and it asks first). */
  protected async clearRecord(): Promise<void> {
    const sure = await this.dialog.confirm(
      this.i18n.t('Clear the record'),
      this.i18n.t('Every line of what the administrators did is erased. One line will say who did it.'),
      { confirmLabel: this.i18n.t('Clear the record'), danger: true },
    );
    if (!sure) return;
    await this.act(this.admin.clearAudit.bind(this.admin), 'The record is empty');
  }

  /** Erases an account for good (owners only, and it asks first). */
  protected async deleteAccount(person: AdminUser): Promise<void> {
    const sure = await this.dialog.confirm(
      this.i18n.t('Delete the account of @{name}', { name: person.username }),
      this.i18n.t(
        'Everything of this account is erased now: its messages, files, keys and sessions. It cannot be undone.',
      ),
      { confirmLabel: this.i18n.t('Delete the account'), danger: true },
    );
    if (!sure) return;
    this.expanded.set(null);
    await this.act(this.admin.deleteAccount.bind(this.admin, person.id), 'Account deleted');
  }

  /** Sets a temporary password for a person who cannot sign in; they choose their own when they use it. */
  protected async resetPassword(person: AdminUser): Promise<void> {
    const password = await this.dialog.prompt(
      this.i18n.t('Reset the password of @{name}', { name: person.username }),
      this.i18n.t(
        'Write a temporary password (10 characters or more) and give it to them by another way. They choose their own when they sign in. Their old encrypted messages cannot be recovered, and their sessions end now.',
      ),
      '',
      this.i18n.t('Temporary password'),
    );
    if (password === null) return;
    if (password.length < 10) {
      this.toast.error(this.i18n.t('Could not do it'), this.i18n.t('Use 10 characters or more.'));
      return;
    }
    await this.act(this.admin.resetPassword.bind(this.admin, person.id, password), 'Password reset');
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
    return this.i18n.t(text, {
      target: entry.target ? '@' + entry.target : '—',
      detail: '@' + entry.detail,
    });
  }
}
