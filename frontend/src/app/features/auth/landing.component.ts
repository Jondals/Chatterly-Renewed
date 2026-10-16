/**
 * src/app/features/auth/landing.component.ts
 * The first page of the web (people who are not signed in, in a browser): what Chatterly is, the download of the app that fits
 * the device that opened it (with the others one click away), and the way into the web app itself ("Open in your browser" goes
 * to the sign-in, as always). The apps never show it: they open straight into the sign-in.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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
    RouterLink,
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

      <div class="relative z-10 mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 pb-10">
        <header class="flex items-center justify-between gap-3 py-5">
          <a routerLink="/" class="flex items-center gap-3" [attr.aria-label]="name">
            <img src="favicon.svg" alt="" class="h-10 w-10 rounded-xl" />
            <span class="text-lg font-bold tracking-tight">{{ name }}</span>
            <span class="chip chip-accent !text-[0.625rem]">v{{ version }}</span>
          </a>
          <nav class="flex items-center gap-2">
            @if (auth.isAuthenticated()) {
              <span class="truncate text-sm text-muted max-sm:hidden">{{ me() }}</span>
              <button type="button" class="btn" (click)="signOut()">{{ 'Sign out' | t }}</button>
            } @else {
              <a routerLink="/login" [queryParams]="{ from: 'welcome' }" class="btn">{{
                'Sign in' | t
              }}</a>
              <a routerLink="/register" class="btn btn-primary max-sm:hidden">{{
                'Create account' | t
              }}</a>
            }
          </nav>
        </header>

        <main class="flex flex-1 flex-col justify-center py-8">
          @if (auth.isAuthenticated()) {
            <h1 class="text-5xl font-bold leading-[1.2] tracking-tight sm:text-6xl">
              {{ 'Welcome back' | t }}<br /><span class="text-gradient">{{ me() }}</span>
            </h1>
          } @else {
            <h1 class="text-5xl font-bold leading-[1.2] tracking-tight sm:text-6xl">
              {{ 'Talk freely.' | t }}<br /><span class="text-gradient">{{
                'Nobody is listening.' | t
              }}</span>
            </h1>
          }
          <p class="mt-6 max-w-xl text-base text-muted sm:text-lg">
            {{
              'Chat, groups and voice calls where only the people in the conversation can read or hear anything.'
                | t
            }}
          </p>

          <div class="mt-9 flex flex-wrap items-center gap-3">
            @if (selected(); as app) {
              <a
                class="btn btn-primary !h-12 w-80 max-w-full justify-center gap-2 !px-6 text-base"
                [href]="url(app)"
                rel="noopener noreferrer"
              >
                <app-icon name="download" [size]="18" />
                {{ 'Download for {device}' | t: { device: app.label } }}
              </a>
            } @else {
              <a
                class="btn btn-primary !h-12 w-80 max-w-full justify-center gap-2 !px-6 text-base"
                [href]="releases"
                rel="noopener noreferrer"
              >
                <app-icon name="download" [size]="18" /> {{ 'Download the app' | t }}
              </a>
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
          @if (!auth.isAuthenticated()) {
          <p class="mt-4 text-sm text-muted">
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
          <!-- The line always has its room (it only fades): choosing another system must not move anything. -->
          <p
            class="mt-3 h-9 overflow-hidden text-xs text-dim transition-opacity duration-300"
            [class.opacity-0]="!selected()?.note"
            aria-live="polite"
          >
            {{ selected()?.note ?? '' | t }}
          </p>

          <section class="mt-14" [attr.aria-label]="'Choose your system' | t">
            <h2 class="label mb-3">{{ 'Choose your system' | t }}</h2>
            <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              @for (app of apps; track app.id) {
                <button
                  type="button"
                  class="choice-card !flex-row !items-center gap-3 text-left"
                  [class.is-on]="selected()?.id === app.id"
                  [attr.aria-pressed]="selected()?.id === app.id"
                  (click)="selected.set(app)"
                >
                  <app-icon [name]="app.icon" [size]="20" class="text-accent" />
                  <span class="min-w-0 flex-1 text-sm font-semibold">{{ app.label }}</span>
                  @if (selected()?.id === app.id) {
                    <app-icon name="check" [size]="16" class="text-accent" />
                  }
                </button>
              }
            </div>
          </section>

          <section class="mt-12 grid gap-4 sm:grid-cols-3">
            @for (item of features; track item.title) {
              <div class="rounded-ui-lg border border-white/10 bg-black/20 p-5">
                <app-icon [name]="item.icon" [size]="20" class="text-accent" />
                <h3 class="mt-3 text-sm font-bold">{{ item.title | t }}</h3>
                <p class="mt-1 text-xs text-muted">{{ item.text | t }}</p>
              </div>
            }
          </section>
        </main>
      </div>
    </div>
  `,
})
export class LandingComponent {
  protected readonly name = APP_NAME;
  protected readonly version = APP_LABEL;
  protected readonly apps = APPS;
  protected readonly releases = RELEASES_URL;
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
      await this.arrival.play('login', this.auth.user()?.displayName ?? '');
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
        await this.arrival.play('login', this.me());
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
    await this.auth.logout(true);
  }

  protected url(app: AppTarget): string {
    return downloadUrl(app);
  }
}
