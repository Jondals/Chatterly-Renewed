/**
 * src/app/features/auth/landing.component.ts
 * The first page of the web (people who are not signed in, in a browser): what Chatterly is, the download of the app that fits
 * the device that opened it (with the others one click away), and the way into the web app itself ("Open in your browser" goes
 * to the sign-in, as always). The apps never show it: they open straight into the sign-in.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { describeError } from '../../shared/util/errors';
import { ArrivalService } from '../../core/services/arrival.service';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';
import { BackgroundSceneComponent } from '../../shared/components/mesh-background.component';
import { ParticleNetworkComponent } from '../../shared/components/particle-network.component';
import {
  APPS,
  RELEASES_URL,
  REPOSITORY_URL,
  detectApp,
  downloadUrl,
  type AppTarget,
} from '../../shared/util/download-target';
import { APP_LABEL, APP_NAME } from '../../version';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-landing',
  standalone: true,
  imports: [
    BackgroundSceneComponent,
    IconComponent,
    ParticleNetworkComponent,
    TranslatePipe,
  ],
  template: `
    <div class="relative h-[var(--app-h,100dvh)] overflow-y-auto">
      <div
        class="pointer-events-none fixed inset-0"
        style="background: var(--ink-950, #030409)"
        aria-hidden="true"
      >
        <div
          class="absolute inset-0"
          style="background: radial-gradient(ellipse 60% 55% at 12% 12%, color-mix(in oklab, var(--accent) 3.5%, transparent), transparent 70%), radial-gradient(ellipse 55% 50% at 92% 95%, color-mix(in oklab, var(--accent-2) 3%, transparent), transparent 70%)"
        ></div>
        @defer (on idle) {
          <app-bg-scene kind="aurora" class="absolute inset-0 block opacity-[.14]" />
          <app-particle-network estilo="flow" [velocidad]="1" />
        }
      </div>

      <div class="relative z-10 mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 pb-2">
        <header class="flex items-center justify-between gap-3 py-4">
          <div class="flex items-center gap-3">
            <img src="favicon.svg" alt="" class="h-10 w-10 rounded-xl" />
            <span class="text-lg font-bold tracking-tight">{{ name }}</span>
            <span class="chip chip-accent !text-[0.625rem]">v{{ version }}</span>
          </div>
          <nav class="flex items-center gap-2">
            @if (auth.isAuthenticated()) {
              <span class="truncate text-sm text-muted max-sm:hidden">{{ me() }}</span>
              <button type="button" class="btn" (click)="signOut()">{{ 'Sign out' | t }}</button>
            } @else {
              <button type="button" class="btn" (click)="go('/login', { from: 'welcome' })">
                {{ 'Sign in' | t }}
              </button>
              <button type="button" class="btn btn-primary max-sm:hidden" (click)="go('/register')">
                {{ 'Create account' | t }}
              </button>
            }
          </nav>
        </header>

        <main class="flex flex-1 flex-col justify-center gap-8 py-4">
          <div>
            @if (auth.isAuthenticated()) {
              <h1 class="text-5xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
                {{ 'Welcome back' | t }}<br /><span class="text-gradient">{{ me() }}</span>
              </h1>
            } @else {
              <h1 class="text-5xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
                {{ 'Talk freely.' | t }}<br /><span class="text-gradient">{{
                  'Nobody is listening.' | t
                }}</span>
              </h1>
            }
            <p class="mt-5 max-w-xl text-base text-muted sm:text-lg">
              {{
                'Chat, groups and voice calls where only the people in the conversation can read or hear anything.'
                  | t
              }}
            </p>

            <div class="mt-8 flex flex-wrap items-center gap-3">
              @if (selected(); as app) {
                <button
                  type="button"
                  class="btn btn-primary !h-12 w-72 max-w-full justify-center gap-2 !px-6 text-base"
                  [attr.data-download]="app.id"
                  (click)="main(app)"
                >
                  <app-icon [name]="app.id === 'ios' ? 'smartphone' : 'download'" [size]="18" />
                  @if (app.id === 'ios') {
                    {{ 'Install on iOS' | t }}
                  } @else {
                    {{ 'Download for {device}' | t: { device: app.label } }}
                  }
                </button>
              } @else {
                <button
                  type="button"
                  class="btn btn-primary !h-12 w-72 max-w-full justify-center gap-2 !px-6 text-base"
                  (click)="open(releases)"
                >
                  <app-icon name="download" [size]="18" /> {{ 'Download the app' | t }}
                </button>
              }
              <button
                type="button"
                class="btn !h-12 gap-2 !px-6 text-base"
                [disabled]="busy()"
                (click)="openInBrowser()"
              >
                <app-icon name="globe" [size]="18" /> {{ 'Open in your browser' | t }}
              </button>
            </div>

            <div
              class="mt-4 flex flex-wrap items-center gap-2"
              role="group"
              [attr.aria-label]="'Choose your system' | t"
            >
              @for (app of apps; track app.id) {
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-ui border px-3 py-1.5 text-xs font-semibold transition-colors duration-200"
                  [class]="
                    selected()?.id === app.id
                      ? 'border-accent/60 bg-accent/15 text-fg'
                      : 'border-white/10 bg-white/[.03] text-muted hover:border-white/25 hover:text-fg'
                  "
                  [attr.aria-pressed]="selected()?.id === app.id"
                  (click)="selected.set(app)"
                >
                  <app-icon [name]="app.icon" [size]="13" [class.text-accent]="selected()?.id === app.id" />
                  {{ app.label }}
                </button>
              }
            </div>
            <!-- The line always has its room (it only fades): choosing another system must not move anything. -->
            <p
              class="mt-3 h-9 overflow-hidden text-xs text-dim transition-opacity duration-300 sm:h-5"
              [class.opacity-0]="!selected()?.note"
              aria-live="polite"
            >
              {{ selected()?.note ?? '' | t }}
            </p>

            @if (!auth.isAuthenticated()) {
              <p class="text-sm text-muted">
                <button
                  type="button"
                  class="font-semibold text-accent hover:brightness-125 disabled:opacity-50"
                  [disabled]="busy()"
                  (click)="tryAsGuest()"
                >
                  {{ (busy() ? 'Preparing…' : 'Try it as a guest') | t }}
                </button>
                · {{ 'Nothing you do is saved.' | t }}
              </p>
            }
            @if (error()) {
              <p class="mt-2 text-xs text-amber" role="alert">{{ error() }}</p>
            }
          </div>

          <section class="grid gap-3 sm:grid-cols-3">
            @for (item of features; track item.title) {
              <div class="flex items-start gap-3 rounded-ui-lg border border-white/8 bg-black/20 p-4">
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ui bg-accent/12 text-accent"
                >
                  <app-icon [name]="item.icon" [size]="17" />
                </span>
                <div class="min-w-0">
                  <h2 class="text-sm font-bold">{{ item.title | t }}</h2>
                  <p class="mt-0.5 text-xs leading-snug text-muted">{{ item.text | t }}</p>
                </div>
              </div>
            }
          </section>
        </main>

        @if (guide()) {
          <div
            class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="'Install on iOS' | t"
            (click)="guide.set(false)"
          >
            <div
              class="anim-pop w-full max-w-sm rounded-ui-lg border border-white/10 bg-ink-850 p-5 shadow-2xl"
              (click)="$event.stopPropagation()"
            >
              <h2 class="text-base font-bold">{{ 'Install Chatterly on your iPhone' | t }}</h2>
              <ol class="mt-3 space-y-2.5 text-sm text-muted">
                <li class="flex gap-3">
                  <b class="text-accent">1</b><span>{{ 'Open this page in Safari.' | t }}</span>
                </li>
                <li class="flex gap-3">
                  <b class="text-accent">2</b
                  ><span>{{ 'Tap Share, the square with an arrow.' | t }}</span>
                </li>
                <li class="flex gap-3">
                  <b class="text-accent">3</b
                  ><span>{{ 'Choose "Add to Home Screen" and tap Add.' | t }}</span>
                </li>
              </ol>
              <p class="mt-3 text-xs text-dim">
                {{ 'It opens like any app, full screen. No store and nothing else to install.' | t }}
              </p>
              <div class="mt-4 flex items-center justify-between gap-2">
                <button type="button" class="text-xs text-dim hover:text-fg" (click)="open(ipa())">
                  {{ 'I prefer the file (IPA, for advanced users)' | t }}
                </button>
                <button type="button" class="btn btn-primary btn-sm" (click)="guide.set(false)">
                  {{ 'Got it' | t }}
                </button>
              </div>
            </div>
          </div>
        }

        <footer class="mt-2">
          <div class="h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent"></div>
          <div
            class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 text-xs text-dim"
          >
            <div class="flex items-center gap-2 text-muted">
              <img src="favicon.svg" alt="" class="h-5 w-5 rounded-md" />
              <span class="font-semibold text-fg">{{ name }}</span>
              <span>© {{ year }}</span>
            </div>
            <nav class="flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <button type="button" class="transition-colors hover:text-accent" (click)="open(releases)">
                {{ 'Releases' | t }}
              </button>
              <button type="button" class="transition-colors hover:text-accent" (click)="open(repository)">
                {{ 'Source code' | t }}
              </button>
              <button type="button" class="transition-colors hover:text-accent" (click)="open(security)">
                {{ 'Security' | t }}
              </button>
            </nav>
            <span class="flex items-center gap-1.5">
              <app-icon name="shield-check" [size]="13" class="text-accent" />
              {{ 'Open source (ISC licence) · No tracking' | t }}
            </span>
          </div>
        </footer>
      </div>
    </div>
  `,
})
export class LandingComponent {
  protected readonly name = APP_NAME;
  protected readonly version = APP_LABEL;
  protected readonly apps = APPS;
  protected readonly releases = RELEASES_URL;
  protected readonly repository = REPOSITORY_URL;
  protected readonly security = REPOSITORY_URL + '/blob/master/SECURITY.md';
  protected readonly year = new Date().getFullYear();
  /** The app chosen below (at first, the one that fits this device): the button on top downloads it. */
  protected readonly selected = signal<AppTarget | null>(detectApp());
  protected readonly features = [
    {
      icon: 'lock',
      title: 'Private by design',
      text: 'Messages, files and calls are encrypted on your device. The server only keeps what it cannot read.',
    },
    {
      icon: 'video',
      title: 'Calls with camera and screen',
      text: 'Voice, video and screen sharing straight between you and your friends.',
    },
    {
      icon: 'refresh',
      title: 'Everywhere you are',
      text: 'Web, Windows, macOS, Linux, Android and iOS, with your settings, stickers and sounds on all of them.',
    },
  ];

  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly arrival = inject(ArrivalService);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  /** Enters as a guest: an account that is erased when the person leaves (see AuthService.enterAsGuest). */
  protected async tryAsGuest(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.enterAsGuest();
      await this.arrival.play('enter', this.auth.user()?.displayName ?? '');
      await this.router.navigateByUrl('/direct');
    } catch (error) {
      this.error.set(this.i18n.t(describeError(error)));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Opens the web app. Not with a cut: whoever is signed in gets the same animation as when they sign in, and a person who
   * is not goes to the sign-in with a fade (the browser's own transition between two pages, where it has one).
   */
  protected async openInBrowser(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (this.auth.isAuthenticated()) {
        await this.arrival.play('enter', this.me());
        await this.router.navigateByUrl('/direct');
        return;
      }
      const go = (): Promise<boolean> => this.router.navigateByUrl('/login');
      const doc = document as Document & {
        startViewTransition?: (update: () => Promise<unknown>) => unknown;
      };
      if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        doc.startViewTransition(go);
      } else {
        await go();
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** The name of the person who is in. */
  protected me(): string {
    return this.auth.user()?.displayName ?? '';
  }

  /** Signs out and stays on this page. */
  protected async signOut(): Promise<void> {
    // The session ends first, so the animation (and the page after it) has the default colors, not the theme of who left.
    await this.auth.logout(true);
    await this.arrival.play('leave');
  }

  /** The guide to install on iOS is open. */
  protected readonly guide = signal(false);

  protected url(app: AppTarget): string {
    return downloadUrl(app);
  }

  /** The file of the iOS app (for whoever prefers it to the installation from Safari). */
  protected ipa(): string {
    return downloadUrl(APPS.find(function ios(app) {
      return app.id === 'ios';
    })!);
  }

  /** The main button: a download, or (iOS) the guide to install it from Safari, which needs nothing else. */
  protected main(app: AppTarget): void {
    if (app.id === 'ios') this.guide.set(true);
    else this.open(this.url(app));
  }

  /**
   * ! Buttons that navigate, not links: a link shows its address at the bottom of the window when the pointer goes over it, and
   * this page must not show addresses.
   */
  protected open(address: string): void {
    window.open(address, '_blank', 'noopener,noreferrer');
  }

  protected go(path: string, query?: Record<string, string>): void {
    void this.router.navigate([path], { queryParams: query });
  }
}
