/**
 * src/app/features/settings/settings.component.ts
 * The settings window with its list of sections and its opening and closing animation.
 */
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { ArrivalService } from '../../core/services/arrival.service';
import { CallService } from '../../core/services/call.service';
import { SocketService } from '../../core/services/socket.service';
import { UiService } from '../../core/services/ui.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/components/icon.component';
import { GuildStore } from '../../store/guild.store';
import { MessageStore } from '../../store/message.store';
import { SocialStore } from '../../store/social.store';
import { AboutSectionComponent } from './about-section.component';
import { AdminSectionComponent } from './admin-section.component';
import { OverlaySectionComponent } from './overlay-section.component';
import { AppearanceSectionComponent } from './appearance-section.component';
import { AudioSectionComponent } from './audio-section.component';
import { CallsSectionComponent } from './calls-section.component';
import { GeneralSectionComponent } from './general-section.component';
import { SyncSectionComponent } from './sync-section.component';
import { IntegrationsSectionComponent } from './integrations-section.component';
import { ProfileSectionComponent } from './profile-section.component';
import { SecuritySectionComponent } from './security-section.component';
import { PermissionsSectionComponent } from './permissions-section.component';
import { ShortcutsSectionComponent } from './shortcuts-section.component';
import { StickersSectionComponent } from './stickers-section.component';
import { UpdatesSectionComponent } from './updates-section.component';
import { AndroidUpdatesSectionComponent } from './android-updates-section.component';
import { ANDROID_APP } from '../../core/config';
import { alwaysOpen, closeOnBack } from '../../core/services/back.service';
import { BetaService } from '../../core/services/beta.service';
import { DesktopUpdateService } from '../../core/services/desktop-update.service';
import { OverlayService } from '../../core/services/overlay.service';

/** One entry of the section list: its icon, and the color classes of the small tile behind the icon. */
interface SectionEntry {
  id: string;
  label: string;
  icon: string;
  tone: string;
}

/** The sections, in the order the person asked for, in four clusters separated by a thin line. */
const GROUPS: SectionEntry[][] = [
  [{ id: 'profile', label: 'My profile', icon: 'user', tone: 'bg-accent/15 text-accent' }],
  [
    { id: 'appearance', label: 'Appearance', icon: 'palette', tone: 'bg-violet/15 text-violet' },
    {
      id: 'sounds',
      label: 'Sounds & notifications',
      icon: 'volume-2',
      tone: 'bg-amber/15 text-amber',
    },
    { id: 'audio', label: 'Voice & video', icon: 'mic', tone: 'bg-coral/15 text-coral' },
    { id: 'calls', label: 'Calls', icon: 'phone', tone: 'bg-emerald/15 text-emerald' },
    { id: 'stickers', label: 'Stickers', icon: 'sticker', tone: 'bg-sky/15 text-sky' },
    { id: 'language', label: 'Language', icon: 'globe', tone: 'bg-emerald/15 text-emerald' },
    { id: 'sync', label: 'Sync', icon: 'refresh', tone: 'bg-sky/15 text-sky' },
  ],
  [
    { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard', tone: 'bg-violet/15 text-violet' },
    { id: 'integrations', label: 'Integrations', icon: 'link', tone: 'bg-sky/15 text-sky' },
    {
      id: 'security',
      label: 'Privacy & security',
      icon: 'shield-check',
      tone: 'bg-accent/15 text-accent',
    },
  ],
  [{ id: 'about', label: 'About', icon: 'info', tone: 'bg-white/10 text-muted' }],
];

/** The Android app asks the phone for permissions: this section lists them (it sits before Privacy & security). */
const PERMISSIONS_ENTRY: SectionEntry = {
  id: 'permissions',
  label: 'Permissions',
  icon: 'key',
  tone: 'bg-amber/15 text-amber',
};

/** Only the desktop app can update itself, so only it has this section (it sits just before About). */
const UPDATES_ENTRY: SectionEntry = {
  id: 'updates',
  label: 'Updates',
  icon: 'download',
  tone: 'bg-emerald/15 text-emerald',
};

/** Only the desktop app can show the overlay over a game, so only it has this section. */
const OVERLAY_ENTRY: SectionEntry = {
  id: 'overlay',
  label: 'Overlay',
  icon: 'monitor',
  tone: 'bg-violet/15 text-violet',
};

/** Only the administrators of the server see this section (the beta testers). */
const ADMIN_ENTRY: SectionEntry = {
  id: 'admin',
  label: 'Administration',
  icon: 'shield',
  tone: 'bg-amber/15 text-amber',
};

/** Full-screen settings with a section list on the left. Closes with Esc or the ✕ button. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-settings',
  standalone: true,
  imports: [
    IconComponent,
    TranslatePipe,
    ProfileSectionComponent,
    AppearanceSectionComponent,
    GeneralSectionComponent,
    AudioSectionComponent,
    CallsSectionComponent,
    PermissionsSectionComponent,
    StickersSectionComponent,
    ShortcutsSectionComponent,
    SecuritySectionComponent,
    IntegrationsSectionComponent,
    SyncSectionComponent,
    AboutSectionComponent,
    UpdatesSectionComponent,
    AndroidUpdatesSectionComponent,
    OverlaySectionComponent,
    AdminSectionComponent,
  ],
  template: `
    <div
      class="settings-overlay fixed inset-0 z-[60] flex bg-ink-950 sm:bg-ink-950/85"
      [class.settings-out]="closing()"
      (mousedown)="closeOnBackdrop($event)"
    >
      <div
        class="mx-auto flex h-full w-full max-w-6xl flex-col gap-2 p-2 md:flex-row md:gap-4 md:p-6"
        (mousedown)="closeOnBackdrop($event)"
      >
        <nav
          class="anim-slide-left flex shrink-0 gap-1 overflow-x-auto rounded-ui-lg bg-ink-900/95 border border-white/6 p-2 max-md:flex-1 max-md:flex-col max-md:overflow-x-visible max-md:overflow-y-auto md:w-64 md:flex-col md:overflow-y-auto md:p-3"
          [class]="listView() ? '' : 'max-md:hidden'"
        >
          <div class="flex items-center justify-between px-1.5 pb-1 pt-0.5 md:hidden">
            <span class="text-lg font-bold">{{ 'Settings' | t }}</span>
            <button
              class="btn btn-icon btn-ghost"
              type="button"
              (click)="close()"
              [attr.aria-label]="'Close' | t"
            >
              <app-icon name="x" />
            </button>
          </div>
          @for (group of groups(); track $index) {
            @if ($index > 0) {
              <span class="nav-sep shrink-0"></span>
            }
            @for (s of group; track s.id) {
              <a
                role="link"
                tabindex="0"
                class="nav-item shrink-0 cursor-pointer max-md:min-h-12"
                [class.active]="section() === s.id"
                (click)="changeSection(s.id)"
                (keydown.enter)="changeSection(s.id)"
                ><span class="nav-tile" [class]="s.tone"
                  ><app-icon [name]="s.icon" [size]="16"
                /></span>
                <span class="whitespace-nowrap">{{ s.label | t }}</span></a
              >
            }
          }
          <span class="hidden flex-1 md:block"></span>
          <button
            type="button"
            class="nav-item shrink-0 !text-red-300 hover:!bg-red-500/10"
            (click)="logout()"
          >
            <app-icon name="logout" [size]="17" />
            <span class="whitespace-nowrap">{{ 'Sign out' | t }}</span>
          </button>
        </nav>

        <main
          class="panel relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
          [class]="listView() ? 'max-md:hidden' : ''"
        >
          <!-- ! Not a float: a grid next to a float is made narrower by it, and the sticky float moved down over the page while it was scrolled (the profile narrowed). This box has no height, so nothing gives way to it. -->
          <div class="pointer-events-none sticky top-0 z-10 flex h-0 justify-end">
            <button
              class="btn btn-icon btn-ghost tip pointer-events-auto mr-3 mt-3"
              data-tip-pos="left"
              [attr.data-tip]="'Close (Esc)' | t"
              type="button"
              (click)="close()"
              [attr.aria-label]="'Close' | t"
            >
              <app-icon name="x" />
            </button>
          </div>
          <div
            class="mx-auto w-full px-5 pb-10 pt-6 md:px-8"
            [class.max-w-3xl]="section() !== 'profile'"
            [class.max-w-5xl]="section() === 'profile'"
          >
            <button
              type="button"
              class="btn btn-sm btn-ghost -ml-2 mb-3 md:hidden"
              (click)="listView.set(true)"
            >
              <app-icon name="arrow-left" [size]="16" /> {{ 'Settings' | t }}
            </button>
            <h1 class="anim-fade-up mb-6 text-2xl font-bold tracking-tight">{{ title() | t }}</h1>
            @switch (section()) {
              @case ('profile') {
                <app-profile-section class="anim-fade-up block" />
              }
              @case ('appearance') {
                <app-appearance-section class="anim-fade-up block" />
              }
              @case ('language') {
                <app-general-section mode="language" class="anim-fade-up block" />
              }
              @case ('sounds') {
                <app-general-section mode="sounds" class="anim-fade-up block" />
              }
              @case ('audio') {
                <app-audio-section class="anim-fade-up block" />
              }
              @case ('calls') {
                <app-calls-section class="anim-fade-up block" />
              }
              @case ('permissions') {
                <app-permissions-section class="anim-fade-up block" />
              }
              @case ('shortcuts') {
                <app-shortcuts-section class="anim-fade-up block" />
              }
              @case ('stickers') {
                <app-stickers-section class="anim-fade-up block" />
              }
              @case ('security') {
                <app-security-section class="anim-fade-up block" />
              }
              @case ('sync') {
                <app-sync-section class="anim-fade-up block" />
              }
              @case ('integrations') {
                <app-integrations-section class="anim-fade-up block" />
              }
              @case ('overlay') {
                <app-overlay-section class="anim-fade-up block" />
              }
              @case ('admin') {
                <app-admin-section class="anim-fade-up block" />
              }
              @case ('updates') {
                @if (android) {
                  <app-android-updates-section class="anim-fade-up block" />
                } @else {
                  <app-updates-section class="anim-fade-up block" />
                }
              }
              @case ('about') {
                <app-about-section class="block" />
              }
            }
          </div>
        </main>
      </div>
    </div>
  `,
})
export class SettingsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(UiService);
  private readonly auth = inject(AuthService);
  private readonly arrival = inject(ArrivalService);
  private readonly socket = inject(SocketService);
  private readonly social = inject(SocialStore);
  private readonly guilds = inject(GuildStore);
  private readonly messages = inject(MessageStore);
  private readonly call = inject(CallService);
  private readonly settingsService = inject(SettingsService);

  protected readonly closing = signal(false);
  /** On a phone: the list of sections is showing instead of a section. */
  protected readonly listView = signal(
    this.ui.settingsList && window.matchMedia('(max-width: 767px)').matches,
  );
  private readonly desktopUpdate = inject(DesktopUpdateService);
  private readonly overlay = inject(OverlayService);
  private readonly beta = inject(BetaService);
  /** The Android app: it has its own Updates section and no overlay. */
  protected readonly android = ANDROID_APP;
  /** The sections, with the ones that only some people have: the overlay and updates (desktop app), administration. */
  protected readonly groups = computed(this.buildGroups.bind(this));
  protected readonly section = toSignal(
    this.route.paramMap.pipe(
      map(function (p) {
        return p.get('section') ?? 'profile';
      }),
    ),
    { initialValue: 'profile' },
  );
  protected readonly title = computed(this.findTitle.bind(this));
  /** The list of sections for this person. */
  private buildGroups(): SectionEntry[][] {
    const extra: SectionEntry[] = [];
    if (this.overlay.supported) extra.push(OVERLAY_ENTRY);
    if (this.android) extra.push(PERMISSIONS_ENTRY);
    // Updates: the desktop app (electron-updater) and the Android app (its own plugin). The overlay stays desktop only.
    if (this.desktopUpdate.supported || this.android) extra.push(UPDATES_ENTRY);
    if (this.beta.admin()) extra.push(ADMIN_ENTRY);
    // The Android app has no keyboard, so no shortcuts section.
    const base = this.android
      ? GROUPS.map(function withoutShortcuts(group) {
          return group.filter(function keep(entry) {
            return entry.id !== 'shortcuts';
          });
        })
      : GROUPS;
    return [...base.slice(0, -1), [...extra, ...base[base.length - 1]]];
  }
  /** The label of the open section (the window title). */
  private findTitle(): string {
    for (const group of this.groups()) {
      for (const entry of group) {
        if (entry.id === this.section()) {
          return entry.label;
        }
      }
    }
    return 'Settings';
  }

  @HostListener('document:keydown.escape') onEscape() {
    this.close();
  }

  /** The back key of the phone closes Settings (see BackService). */
  private readonly backKey = closeOnBack(alwaysOpen, this.onBack.bind(this));

  /** The back key: on a phone, a section goes back to the list of sections; the list (or a computer) closes Settings. */
  private onBack(): void {
    if (!this.listView() && window.matchMedia('(max-width: 767px)').matches) {
      this.listView.set(true);
      return;
    }
    this.close();
  }

  /** Clicking the dark area around the panels (and not the panels themselves) closes the settings. */
  protected closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  /** Closes the settings with a short fade and goes back to where you were. */
  protected close(): void {
    if (this.closing()) return;
    this.closing.set(true);
    setTimeout(this.ui.closeSettings.bind(this.ui), 190);
  }

  /** Changes the section without touching the screen underneath. */
  protected changeSection(id: string): void {
    this.listView.set(false);
    this.ui.openSettings(id);
  }

  /**
   * Signs out: leaves the call, disconnects, erases everything of the account on this device and loads the sign-in page
   * from scratch (a navigation inside the app would keep in memory what was already read: pictures, messages).
   */
  protected async logout(): Promise<void> {
    await this.call.leave().catch(function () {
      return undefined;
    });
    await this.arrival.play('logout', this.auth.user()?.displayName ?? '');
    this.socket.disconnect();
    this.social.reset();
    this.guilds.reset();
    this.messages.reset();
    await this.auth.logout(true, this.settingsService.keepOnSignOut());
    window.location.assign('/login');
  }
}
