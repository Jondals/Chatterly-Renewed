/**
 * src/app/features/settings/about-section.component.ts
 * Settings - About: the animated signature, the version and a summary of how data is protected.
 */
import { Component, inject } from '@angular/core';
import { linkCrypto, type TextPart } from '../../core/crypto-docs';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { UiService } from '../../core/services/ui.service';
import { IconComponent } from '../../shared/components/icon.component';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { TECHNOLOGIES } from '../../shared/util/tech-logos';
import { APP_NAME, APP_VERSION } from '../../version';

/**
 * About: the animated "Developed by Jondals" signature on top and, below, cards with what protects the account,
 * the version data and the technology used, in the same style as the rest of the settings.
 */
@Component({
  selector: 'app-about-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <div
      class="relative overflow-hidden rounded-ui-lg border border-white/8 bg-black/25 p-5 sm:p-6"
    >
      <div
        class="pointer-events-none absolute inset-0 opacity-60"
        style="background: radial-gradient(ellipse at 0% 0%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 60%), radial-gradient(ellipse at 100% 100%, color-mix(in oklab, var(--accent-2) 16%, transparent), transparent 60%)"
      ></div>
      <div class="relative flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
        <div class="jd-logo shrink-0">
          <svg viewBox="0 190 1080 700" role="img" aria-label="Jondals" class="h-auto w-40 sm:w-44">
            <defs>
              <linearGradient id="jd-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="var(--accent)" />
                <stop offset="1" stop-color="var(--accent-2)" />
              </linearGradient>
              <linearGradient id="jd-shine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#fff" stop-opacity="0" />
                <stop offset=".5" stop-color="#fff" stop-opacity=".85" />
                <stop offset="1" stop-color="#fff" stop-opacity="0" />
              </linearGradient>
              <clipPath id="jd-clip">
                <path d="M402.81,246.65l-212.63,586.69H23L236.41,246.65h166.39Z" />
                <path
                  d="M674.98,274.12l52.59,94.97-87.12,28.25,87.12,26.69-57.29,99.68-68.28-67.5,21.98,91.83h-109.1l21.98-91.83-66.71,68.28-58.86-101.25,87.12-28.25-85.55-25.12,52.59-94.97,72.21,65.14-24.33-93.4h111.45l-22.76,93.4,72.99-65.93Z"
                />
                <path
                  d="M1056.43,246.65l-148.47,367.32c-28.43,73.64-41.66,126.56-85.88,163.68-44.21,37.13-79.84,55.69-147.86,55.69-62.92,0-112.38-15.16-148.37-45.49-36-30.32-53.99-74.96-53.99-133.92,0-17.56,1.87-37.22,5.27-57.62h186.21c-1.7,10.2-2.72,19.65-2.72,27.01,0,26.65,4.01,39.96,27.26,39.96,17.32,0,25.22-23.02,35.51-48.35l145.14-368.29h187.91Z"
                />
              </clipPath>
            </defs>
            <circle class="jd-ripple" cx="595" cy="395" r="150" />
            <circle class="jd-ripple jd-ripple-2" cx="595" cy="395" r="150" />
            <path
              class="jd-stroke"
              pathLength="1"
              d="M402.81,246.65l-212.63,586.69H23L236.41,246.65h166.39Z"
            />
            <path
              class="jd-stroke jd-stroke-2"
              pathLength="1"
              d="M1056.43,246.65l-148.47,367.32c-28.43,73.64-41.66,126.56-85.88,163.68-44.21,37.13-79.84,55.69-147.86,55.69-62.92,0-112.38-15.16-148.37-45.49-36-30.32-53.99-74.96-53.99-133.92,0-17.56,1.87-37.22,5.27-57.62h186.21c-1.7,10.2-2.72,19.65-2.72,27.01,0,26.65,4.01,39.96,27.26,39.96,17.32,0,25.22-23.02,35.51-48.35l145.14-368.29h187.91Z"
            />
            <g class="jd-star">
              <path
                class="jd-stroke jd-stroke-star"
                pathLength="1"
                d="M674.98,274.12l52.59,94.97-87.12,28.25,87.12,26.69-57.29,99.68-68.28-67.5,21.98,91.83h-109.1l21.98-91.83-66.71,68.28-58.86-101.25,87.12-28.25-85.55-25.12,52.59-94.97,72.21,65.14-24.33-93.4h111.45l-22.76,93.4,72.99-65.93Z"
              />
            </g>
            <g class="jd-sparks">
              <circle cx="595" cy="150" r="9" />
              <circle cx="595" cy="640" r="6" />
              <circle cx="360" cy="395" r="5" />
              <circle cx="830" cy="395" r="7" />
            </g>
            <g clip-path="url(#jd-clip)">
              <rect
                class="jd-shine"
                x="-300"
                y="190"
                width="260"
                height="700"
                fill="url(#jd-shine)"
              />
            </g>
          </svg>
        </div>
        <div class="min-w-0">
          <p class="anim-fade-up text-xs font-semibold uppercase tracking-[.35em] text-muted">
            {{ 'Developed by' | t }}
          </p>
          <h2
            class="mt-1 select-none text-3xl font-black tracking-tight sm:text-4xl"
            aria-label="Jondals"
          >
            @for (letter of letters; track $index) {
              <span
                class="signature inline-block"
                [style.animation-delay]="300 + $index * 90 + 'ms'"
                >{{ letter }}</span
              >
            }
          </h2>
          <a
            class="gh-link anim-fade-up mt-5"
            style="--d: 1100ms"
            href="https://github.com/Jondals/ChatterlyRenewed"
            target="_blank"
            rel="noopener noreferrer"
            [attr.aria-label]="'Open the project on GitHub' | t"
          >
            <span class="gh-lock" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path class="gh-arco" d="M8 11V8a4 4 0 0 1 8 0v3" />
                <rect x="5" y="11" width="14" height="10" rx="2.5" />
                <circle cx="12" cy="16" r="1.3" fill="currentColor" />
              </svg>
            </span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path
                d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"
              />
            </svg>
            <span>{{ 'Source code on GitHub' | t }}</span>
            <span class="gh-flecha" aria-hidden="true">&#8599;</span>
          </a>
        </div>
      </div>
    </div>

    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <section class="rounded-ui-lg border border-white/8 bg-black/10 p-5">
        <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold">
          <app-icon name="info" [size]="16" class="text-accent" /> {{ 'This version' | t }}
        </h3>
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between gap-3">
            <dt class="text-muted">{{ 'App' | t }}</dt>
            <dd class="font-medium">{{ appName }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">{{ 'Version' | t }}</dt>
            <dd class="font-mono">v{{ version }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">{{ 'License' | t }}</dt>
            <dd>ISC</dd>
          </div>
          @for (link of links; track link.label) {
            <div class="flex justify-between gap-3">
              <dt class="text-muted">{{ link.label | t }}</dt>
              <dd>
                <a
                  class="text-accent hover:underline"
                  [href]="link.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ link.name }}</a
                >
              </dd>
            </div>
          }
        </dl>
      </section>

      <section class="rounded-ui-lg border border-white/8 bg-black/10 p-5">
        <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold">
          <app-icon name="shield-check" [size]="16" class="text-accent" />
          {{ 'How your data is protected' | t }}
        </h3>
        <ul class="space-y-3 text-sm">
          @for (line of protections; track line.t) {
            <li class="flex items-start gap-3">
              <app-icon [name]="line.i" [size]="16" class="mt-0.5 shrink-0 text-accent" /><span
                class="min-w-0"
                ><b class="block font-semibold">{{ line.t | t }}</b
                ><span class="block text-xs leading-relaxed text-muted">
                  @for (part of parts(line.d); track $index) {
                    @if (part.url) {
                      <a
                        class="crypto-inline"
                        [href]="part.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ part.text }}</a
                      >
                    } @else {
                      {{ part.text }}
                    }
                  }
                </span></span
              >
            </li>
          }
        </ul>
      </section>
    </div>

    <div class="mt-4 grid gap-4 sm:grid-cols-3">
      @for (p of principles; track p.title) {
        @if (p.url) {
          <a
            class="principle"
            [href]="p.url"
            target="_blank"
            rel="noopener noreferrer"
            [attr.aria-label]="p.title | t"
          >
            <span class="principle-icon"><app-icon [name]="p.icon" [size]="20" /></span>
            <h3 class="text-sm font-semibold">{{ p.title | t }}</h3>
            <p class="mt-1 text-xs leading-relaxed text-muted">{{ p.text | t }}</p>
            <span class="principle-go" aria-hidden="true">&#8599;</span>
          </a>
        } @else {
          <button type="button" class="principle text-left" (click)="goTo(p.section!)">
            <span class="principle-icon"><app-icon [name]="p.icon" [size]="20" /></span>
            <h3 class="text-sm font-semibold">{{ p.title | t }}</h3>
            <p class="mt-1 text-xs leading-relaxed text-muted">{{ p.text | t }}</p>
            <span class="principle-go" aria-hidden="true">&#8594;</span>
          </button>
        }
      }
    </div>

    <section class="mt-4 rounded-ui-lg border border-white/8 bg-black/10 p-5">
      <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold">
        <app-icon name="cpu" [size]="16" class="text-accent" /> {{ 'Built with' | t }}
      </h3>
      <div class="flex flex-wrap gap-2 text-xs">
        @for (t of technologies; track t.name) {
          <a
            class="inline-flex items-center gap-2 rounded-ui border border-white/8 bg-white/[.04] px-3 py-1.5 text-sm font-medium transition hover:-translate-y-0.5 hover:border-accent/40 hover:bg-white/[.08]"
            [href]="t.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
              [innerHTML]="t.svg"
            ></svg
            >{{ t.name }}
          </a>
        }
      </div>
    </section>
  `,
  styles: `
    .principle {
      position: relative;
      display: block;
      width: 100%;
      overflow: hidden;
      border-radius: var(--r-lg);
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(0, 0, 0, 0.1);
      padding: 1.1rem;
      transition:
        transform 0.3s var(--ease),
        border-color 0.3s var(--ease-suave),
        box-shadow 0.3s var(--ease-suave);
    }
    .principle:hover {
      border-color: color-mix(in oklab, var(--accent) 45%, transparent);
      box-shadow: 0 14px 30px -18px var(--accent);
    }
    .principle-icon {
      display: flex;
      width: 2.5rem;
      height: 2.5rem;
      margin-bottom: 0.7rem;
      align-items: center;
      justify-content: center;
      border-radius: var(--r);
      background: color-mix(in oklab, var(--accent) 12%, transparent);
      color: var(--accent);
      transition:
        background-color 0.3s var(--ease-suave),
        color 0.3s var(--ease-suave);
    }
    .principle:hover .principle-icon {
      background: var(--accent);
      color: var(--accent-ink);
    }
    .principle-go {
      position: absolute;
      right: 0.9rem;
      top: 0.8rem;
      color: var(--muted);
      opacity: 0;
      transform: translate(-4px, 4px);
      transition:
        opacity 0.3s var(--ease-suave),
        transform 0.3s var(--ease);
    }
    .principle:hover .principle-go {
      opacity: 1;
      transform: none;
      color: var(--accent);
    }
    .jd-logo {
      filter: drop-shadow(0 8px 26px color-mix(in oklab, var(--accent) 35%, transparent));
    }
    .jd-stroke {
      fill: url(#jd-grad);
      fill-opacity: 0;
      stroke: url(#jd-grad);
      stroke-width: 9;
      stroke-linejoin: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation:
        jd-draw 1.5s cubic-bezier(0.65, 0, 0.35, 1) forwards,
        jd-fill 0.9s ease 1.3s forwards;
    }
    .jd-stroke-2 {
      animation-delay: 0.25s, 1.5s;
    }
    .jd-stroke-star {
      animation-delay: 0.5s, 1.7s;
    }
    .jd-star {
      transform-box: fill-box;
      transform-origin: center;
      animation: jd-spin 18s linear 2.6s infinite;
    }
    .jd-sparks {
      transform-origin: 595px 395px;
      animation:
        jd-pop 0.8s ease 2s both,
        jd-spin 9s linear 2.2s infinite;
    }
    .jd-sparks circle {
      fill: var(--accent);
    }
    .jd-ripple {
      fill: none;
      stroke: var(--accent);
      stroke-width: 4;
      transform-origin: 595px 395px;
      opacity: 0;
      animation: jd-ripple 3.4s ease-out 2.2s infinite;
    }
    .jd-ripple-2 {
      animation-delay: 3.3s;
    }
    .jd-shine {
      animation: jd-sweep 4.5s ease-in-out 2.4s infinite;
    }
    @keyframes jd-draw {
      to {
        stroke-dashoffset: 0;
      }
    }
    @keyframes jd-fill {
      to {
        fill-opacity: 1;
        stroke-width: 0;
      }
    }
    @keyframes jd-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes jd-pop {
      from {
        opacity: 0;
        scale: 0.3;
      }
      to {
        opacity: 1;
        scale: 1;
      }
    }
    @keyframes jd-ripple {
      0% {
        transform: scale(0.5);
        opacity: 0.7;
      }
      100% {
        transform: scale(2.2);
        opacity: 0;
      }
    }
    @keyframes jd-sweep {
      0%,
      35% {
        transform: translateX(0);
      }
      100% {
        transform: translateX(1700px);
      }
    }
    .signature {
      opacity: 0;
      background: linear-gradient(
        100deg,
        var(--fg) 0%,
        var(--fg) 38%,
        var(--accent) 50%,
        var(--fg) 62%,
        var(--fg) 100%
      );
      background-size: 250% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation:
        letter-in 0.9s var(--ease) forwards,
        shine 5s ease-in-out 1.6s infinite;
    }
  `,
})
export class AboutSectionComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly ui = inject(UiService);

  protected readonly letters = 'Jondals'.split('');
  protected readonly appName = APP_NAME;
  protected readonly version = APP_VERSION;
  protected readonly links = [
    { label: 'Source', name: 'GitHub', url: 'https://github.com/Jondals/ChatterlyRenewed' },
    {
      label: 'What is new',
      name: 'Changelog',
      url: 'https://github.com/Jondals/ChatterlyRenewed/blob/HEAD/CHANGELOG.md',
    },
    {
      label: 'Contribute',
      name: 'CONTRIBUTING',
      url: 'https://github.com/Jondals/ChatterlyRenewed/blob/HEAD/.github/CONTRIBUTING.md',
    },
  ];
  /** A text with the names of the encryption systems as links to their documents. */
  protected parts(text: string): TextPart[] {
    return linkCrypto(text);
  }

  protected readonly protections = [
    { i: 'lock', t: 'Messages', d: 'AES-256-GCM + ECDSA' },
    { i: 'phone', t: 'Calls', d: 'DTLS-SRTP + AES-256-GCM / ECDH' },
    { i: 'key', t: 'Password', d: 'PBKDF2 600k + HKDF + scrypt' },
    { i: 'shield', t: 'Contacts', d: 'Trust on first use + safety numbers' },
  ];
  protected readonly principles: {
    icon: string;
    title: string;
    text: string;
    url?: string;
    section?: string;
  }[] = [
    {
      icon: 'key',
      title: 'Zero knowledge',
      text: 'Your password and your keys never leave your device.',
      section: 'security',
    },
    {
      icon: 'code',
      title: 'Open source',
      text: 'The whole code is public, so anyone can check how it protects you.',
      url: 'https://github.com/Jondals/ChatterlyRenewed',
    },
    {
      icon: 'shield-check',
      title: 'No tracking',
      text: 'No ads, no analytics, no profile of you. Messages are unreadable for the server.',
      url: 'https://github.com/Jondals/ChatterlyRenewed/blob/HEAD/SECURITY.md',
    },
  ];
  /** The logos as trusted HTML: they are constants of this code (see tech-logos.ts). */
  protected readonly technologies = this.trustLogos();

  /** Opens another section of the settings. */
  protected goTo(section: string): void {
    this.ui.openSettings(section);
  }

  /** Marks the SVG of every technology logo as safe to insert (they never contain user input). */
  private trustLogos(): { name: string; url: string; svg: SafeHtml }[] {
    const trusted: { name: string; url: string; svg: SafeHtml }[] = [];
    for (const technology of TECHNOLOGIES) {
      trusted.push({
        name: technology.name,
        url: technology.url,
        svg: this.sanitizer.bypassSecurityTrustHtml(technology.svg),
      });
    }
    return trusted;
  }
}
