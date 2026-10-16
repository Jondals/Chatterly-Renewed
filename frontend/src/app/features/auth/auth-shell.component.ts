/**
 * src/app/features/auth/auth-shell.component.ts
 * Frame of the sign-in and register pages: particle background, brand and card. It stays alive when switching between both forms.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/components/icon.component';
import { BackgroundSceneComponent } from '../../shared/components/mesh-background.component';
import { ParticleNetworkComponent } from '../../shared/components/particle-network.component';
import { APP_NAME, APP_LABEL } from '../../version';

/** Shared frame for login/register: brand on the left and the form card on the right. It stays alive while you switch between both forms, so nothing reloads. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-auth-shell',
  standalone: true,
  imports: [
    BackgroundSceneComponent,
    IconComponent,
    ParticleNetworkComponent,
    RouterOutlet,
    TranslatePipe,
  ],
  template: `
    <div
      class="relative flex h-[var(--app-h,100dvh)] items-center justify-center overflow-y-auto p-5"
    >
      <!-- Own background of the sign-in pages: dark, with a faint glow and an animated particle network -->
      <div class="pointer-events-none fixed inset-0 -z-0 bg-[#030409]" aria-hidden="true">
        <div
          class="absolute inset-0"
          style="background: radial-gradient(ellipse 60% 55% at 12% 12%, color-mix(in oklab, var(--accent) 3.5%, transparent), transparent 70%), radial-gradient(ellipse 55% 50% at 92% 95%, color-mix(in oklab, var(--accent-2) 3%, transparent), transparent 70%)"
        ></div>
        @defer (on idle) {
          <app-bg-scene kind="aurora" class="absolute inset-0 block opacity-[.14]" />
          <app-particle-network estilo="flow" [velocidad]="1" />
        }
      </div>
      <div
        class="relative z-10 grid w-full max-w-5xl items-center gap-14 py-6 lg:grid-cols-[1fr_25rem]"
      >
        <section class="hidden lg:block">
          <div class="mb-9 flex items-center gap-3">
            <img src="favicon.svg" alt="" class="h-12 w-12 rounded-xl" />
            <div>
              <div class="text-xl font-bold leading-tight tracking-tight">{{ appName }}</div>
              <span class="chip chip-accent !text-[0.625rem] uppercase tracking-wide"
                >v{{ version }}</span
              >
            </div>
          </div>
          <h1 class="text-6xl font-bold leading-[1.38] tracking-tight">
            {{ 'Talk freely.' | t }}<br /><span class="text-gradient">{{
              'Nobody is listening.' | t
            }}</span>
          </h1>
          <p class="mt-6 max-w-lg text-base text-muted">
            {{
              'Chat, groups and voice calls where only the people in the conversation can read or hear anything.'
                | t
            }}
          </p>
          <ul class="mt-9 space-y-3">
            @for (f of features; track f.title) {
              <li
                class="flex items-center gap-4 rounded-ui-lg border border-white/8 bg-black/25 p-3.5"
              >
                <span
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui bg-accent/12 text-accent"
                  ><app-icon [name]="f.icon" [size]="20"
                /></span>
                <span class="min-w-0">
                  <span class="block text-sm font-bold">{{ f.title | t }}</span>
                  <span class="block text-xs text-muted">{{ f.text | t }}</span>
                </span>
              </li>
            }
          </ul>
        </section>

        <main class="mx-auto w-full max-w-sm">
          <div class="panel p-7">
            <div class="mb-6 flex items-center gap-3 lg:hidden">
              <img src="favicon.svg" alt="" class="h-9 w-9" />
              <div class="text-lg font-bold">{{ appName }}</div>
            </div>
            <router-outlet />
          </div>
          <p
            class="mt-4 flex items-center justify-center gap-1.5 whitespace-nowrap text-center text-[0.6875rem] text-dim"
          >
            <app-icon name="lock" [size]="11" /> {{ 'End-to-end encrypted' | t }} · v{{ version }}
          </p>
        </main>
      </div>
    </div>
  `,
})
export class AuthShellComponent {
  protected readonly appName = APP_NAME;
  protected readonly version = APP_LABEL;
  protected readonly features = [
    {
      icon: 'lock',
      title: 'Zero-knowledge accounts',
      text: 'Your password never reaches the server — only a derived proof does.',
    },
    {
      icon: 'shield-check',
      title: 'Signed & encrypted messages',
      text: 'Every message is AES-256-GCM sealed and ECDSA-signed.',
    },
    {
      icon: 'phone',
      title: 'Peer-to-peer calls',
      text: 'WebRTC media goes straight between you; signaling is encrypted too.',
    },
  ];
}
