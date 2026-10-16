/**
 * src/app/shared/components/mesh-background.component.ts
 * Animated backgrounds (CSS scenes) and the shuffle mode that keeps changing them.
 */
import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, input, signal, untracked } from '@angular/core';
import { SettingsService, type BackgroundId } from '../../core/services/settings.service';
import { WallpaperStore } from '../../core/services/wallpaper.store';
import { ParticleNetworkComponent } from './particle-network.component';

/**
 * One animated scene (aurora, stars, bubbles…). Everything is plain gradients moved with transforms, so it
 * stays on the GPU: no CSS blur or backdrop filters (those made menus stutter). The "blur" setting softens
 * the edge of the shapes instead. Used full-screen by the app and small as the picker preview in Settings.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-bg-scene',
  standalone: true,
  imports: [ParticleNetworkComponent],
  template: `
    <div
      class="scene absolute inset-0 overflow-hidden bg-ink-950"
      style="contain: strict; isolation: isolate"
      [style.filter]="kind() === 'grid' ? null : 'brightness(1.55) saturate(1.4) contrast(1.08)'"
      aria-hidden="true"
    >
      @switch (kind()) {
        @case ('aurora') {
          <div
            class="blob"
            style="left:-14%;top:-22%;width:70%;aspect-ratio:1;--c:var(--accent);--o:.6;animation:drift-a calc(var(--bg-speed,1) * 18s) ease-in-out infinite"
          ></div>
          <div
            class="blob"
            style="right:-16%;top:2%;width:76%;aspect-ratio:1;--c:var(--accent-2);--o:.55;animation:drift-b calc(var(--bg-speed,1) * 22s) ease-in-out infinite"
          ></div>
          <div
            class="blob"
            style="left:14%;bottom:-34%;width:84%;aspect-ratio:1;--c:color-mix(in oklab, var(--accent) 50%, var(--accent-2));--o:.45;animation:drift-c calc(var(--bg-speed,1) * 26s) ease-in-out infinite"
          ></div>
          <div
            class="blob"
            style="right:6%;bottom:2%;width:42%;aspect-ratio:1;--c:#7c3aed;--o:.4;animation:drift-d calc(var(--bg-speed,1) * 20s) ease-in-out infinite"
          ></div>
        }
        @case ('waves') {
          <div
            class="absolute inset-x-0 top-0 h-[55%]"
            style="background: radial-gradient(ellipse 60% 80% at 50% 0%, color-mix(in oklab, var(--accent-2) 22%, transparent), transparent 70%)"
          ></div>
          <div class="absolute inset-x-0 bottom-0 h-[72%]">
            @for (w of waves; track w.i) {
              <div
                class="absolute inset-0"
                [style.animation]="'wave-bob ' + w.b + 's ease-in-out infinite alternate'"
              >
                <svg
                  class="wave absolute bottom-0 h-full w-[200%]"
                  viewBox="0 0 2880 600"
                  preserveAspectRatio="none"
                  [style.animation]="
                    'wave-slide calc(var(--bg-speed,1) * ' + w.s + 's) linear infinite'
                  "
                  [style.opacity]="w.o"
                >
                  <defs>
                    <linearGradient [attr.id]="'ola' + w.i" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" [style.stop-color]="w.c" stop-opacity=".62" />
                      <stop offset="1" [style.stop-color]="w.c" stop-opacity="0" />
                    </linearGradient>
                  </defs>
                  <path [attr.d]="w.d" [attr.fill]="'url(#ola' + w.i + ')'" />
                  <path
                    [attr.d]="crest(w.d)"
                    fill="none"
                    stroke="rgba(255,255,255,.4)"
                    stroke-width="2.2"
                    stroke-linejoin="round"
                  />
                </svg>
              </div>
            }
          </div>
        }
        @case ('grid') {
          <div class="grid-lines absolute inset-0"></div>
          <div class="grid-lines grid-lit absolute inset-0"></div>
          <div class="grid-lines grid-lit grid-lit-2 absolute inset-0"></div>
        }
        @case ('stars') {
          <div
            class="stars"
            style="--tile:260px;--dur:calc(var(--bg-speed,1) * 60s);opacity:.55;background-image:radial-gradient(1px 1px at 20px 30px,#fff,transparent),radial-gradient(1px 1px at 130px 90px,#fff,transparent),radial-gradient(1.5px 1.5px at 210px 200px,#fff,transparent),radial-gradient(1px 1px at 80px 220px,#cde,transparent)"
          ></div>
          <div
            class="stars"
            style="--tile:340px;--dur:calc(var(--bg-speed,1) * 36s);opacity:.8;background-image:radial-gradient(1.6px 1.6px at 60px 80px,var(--accent),transparent),radial-gradient(2px 2px at 250px 160px,#fff,transparent),radial-gradient(1.4px 1.4px at 170px 300px,var(--accent-2),transparent)"
          ></div>
          <div
            class="blob"
            style="left:20%;top:30%;width:60%;aspect-ratio:1;--c:var(--accent-2);--o:.22;animation:drift-b calc(var(--bg-speed,1) * 30s) ease-in-out infinite"
          ></div>
        }
        @case ('bubbles') {
          @for (b of bubbles; track b.l) {
            <span
              class="bubble"
              [style.left.%]="b.l"
              [style.width.px]="b.s"
              [style.height.px]="b.s"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + b.d + 's)'"
              [style.animation-delay.s]="-b.o"
            ></span>
          }
        }
        @case ('beams') {
          @for (b of beams; track b.l) {
            <span
              class="beam"
              [style.left.%]="b.l"
              [style.width.%]="b.w"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + b.d + 's)'"
              [style.animation-delay.s]="-b.o"
            ></span>
          }
        }
        @case ('nebula') {
          <div
            class="stars"
            style="--tile:300px;--dur:calc(var(--bg-speed,1) * 140s);opacity:.7;background-image:radial-gradient(1px 1px at 30px 40px,#fff,transparent),radial-gradient(1.2px 1.2px at 150px 120px,#dfe9ff,transparent),radial-gradient(1px 1px at 230px 250px,#fff,transparent),radial-gradient(1.6px 1.6px at 90px 210px,#ffe9d6,transparent)"
          ></div>
          <div
            class="cloud"
            style="left:-20%;top:-25%;width:90%;--c:var(--accent);--o:.5;animation:cloud-spin calc(var(--bg-speed,1) * 110s) linear infinite"
          ></div>
          <div
            class="cloud"
            style="right:-25%;top:5%;width:95%;--c:var(--accent-2);--o:.55;animation:cloud-spin calc(var(--bg-speed,1) * 140s) linear infinite reverse"
          ></div>
          <div
            class="cloud"
            style="left:5%;bottom:-40%;width:100%;--c:#c026d3;--o:.38;animation:cloud-spin calc(var(--bg-speed,1) * 170s) linear infinite"
          ></div>
          <div
            class="cloud"
            style="left:35%;top:25%;width:60%;--c:#38bdf8;--o:.28;animation:cloud-spin calc(var(--bg-speed,1) * 120s) linear infinite reverse"
          ></div>
          <div
            class="absolute inset-0"
            style="background: radial-gradient(ellipse 45% 35% at 30% 65%, rgba(0,0,0,.55), transparent 70%), radial-gradient(ellipse 40% 30% at 75% 35%, rgba(0,0,0,.45), transparent 70%)"
          ></div>
        }
        @case ('cosmos') {
          <div
            class="absolute inset-0"
            style="background: linear-gradient(115deg, transparent 28%, color-mix(in oklab, var(--accent-2) 16%, transparent) 46%, color-mix(in oklab, var(--accent) 14%, transparent) 54%, transparent 72%)"
          ></div>
          <div
            class="stars twinkle"
            style="--tile:240px;--dur:calc(var(--bg-speed,1) * 220s);opacity:.8;background-image:radial-gradient(1px 1px at 20px 30px,#fff,transparent),radial-gradient(1px 1px at 130px 90px,#cfe,transparent),radial-gradient(1.4px 1.4px at 190px 190px,#fff,transparent),radial-gradient(1px 1px at 80px 160px,#fed,transparent)"
          ></div>
          <div
            class="stars twinkle"
            style="--tile:410px;--dur:calc(var(--bg-speed,1) * 150s);opacity:.9;animation-delay:-2s;background-image:radial-gradient(1.8px 1.8px at 60px 80px,#fff,transparent),radial-gradient(2.2px 2.2px at 300px 200px,var(--accent),transparent),radial-gradient(1.6px 1.6px at 170px 330px,var(--accent-2),transparent)"
          ></div>
          @for (m of meteors; track m.i) {
            <span
              class="meteor"
              [style.left.%]="m.x"
              [style.top.%]="m.y"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + m.d + 's)'"
              [style.animation-delay.s]="-m.o"
            ></span>
          }
        }
        @case ('prism') {
          <div
            class="absolute left-1/2 top-1/2 aspect-square w-[150%] -translate-x-1/2 -translate-y-1/2 opacity-45"
            style="background: conic-gradient(from 0deg, var(--accent), var(--accent-2), #f472b6, #38bdf8, var(--accent)); border-radius: 50%; mask-image: radial-gradient(circle, #000 0%, transparent 58%); -webkit-mask-image: radial-gradient(circle, #000 0%, transparent 58%); animation: spin calc(var(--bg-speed,1) * 60s) linear infinite"
          ></div>
          <div
            class="absolute left-1/2 top-1/2 aspect-square w-[110%] -translate-x-1/2 -translate-y-1/2 opacity-35"
            style="background: conic-gradient(from 90deg, transparent, var(--accent-2), transparent 40%, var(--accent), transparent 80%); border-radius: 50%; mask-image: radial-gradient(circle, #000 0%, transparent 55%); -webkit-mask-image: radial-gradient(circle, #000 0%, transparent 55%); animation: spin calc(var(--bg-speed,1) * 45s) linear infinite reverse"
          ></div>
        }
        @case ('orbs') {
          @for (o of orbs; track o.i) {
            <span
              class="orb"
              [style.left.%]="o.x"
              [style.top.%]="o.y"
              [style.width.vmin]="o.s"
              [style.--c]="o.c"
              [style.animation]="
                'drift-' + o.k + ' calc(var(--bg-speed,1) * ' + o.d + 's) ease-in-out infinite'
              "
            ></span>
          }
        }
        @case ('mist') {
          @for (m of fogs; track m.i) {
            <div
              class="fog"
              [style.top.%]="m.y"
              [style.height.%]="m.h"
              [style.--c]="m.c"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + m.d + 's)'"
              [style.animation-delay.s]="-m.o"
            ></div>
          }
        }
        @case ('topography') {
          <svg
            class="topo absolute inset-0 h-full w-full"
            viewBox="0 0 1600 900"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            @for (g of topo; track g.i) {
              <g
                class="topo-g"
                [style.transform-origin]="g.cx + 'px ' + g.cy + 'px'"
                [style.animation]="
                  'topo-breathe calc(var(--bg-speed,1) * ' +
                  g.s +
                  's) ease-in-out infinite alternate'
                "
              >
                @for (r of g.rings; track r.i) {
                  <path
                    [attr.d]="r.d"
                    fill="none"
                    [attr.stroke]="g.c"
                    [attr.stroke-opacity]="r.o"
                    [attr.stroke-width]="r.i % 5 === 0 ? 2 : 1.1"
                    stroke-linejoin="round"
                  />
                }
              </g>
            }
          </svg>
        }
        @case ('sunset') {
          <div class="sunset-sky absolute inset-0"></div>
          <div class="sunset-sun"></div>
          <div class="sunset-hills"></div>
        }
        @case ('ripples') {
          @for (r of ripples; track r.x) {
            <span
              class="ripple"
              [style.left.%]="r.x"
              [style.top.%]="r.y"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + r.d + 's)'"
              [style.animation-delay.s]="-r.o"
            ></span>
          }
        }
        @case ('network') {
          <div
            class="blob"
            style="left:-10%;top:-20%;width:62%;aspect-ratio:1;--c:var(--accent);--o:.22"
          ></div>
          <div
            class="blob"
            style="right:-12%;bottom:-24%;width:58%;aspect-ratio:1;--c:var(--accent-2);--o:.2"
          ></div>
          <app-particle-network
            [velocidad]="
              settings.bgMotion() === 'lively' ? 1.8 : settings.bgMotion() === 'calm' ? 0.5 : 1
            "
          />
        }
        @case ('fireflies') {
          @for (f of fireflies; track f.i) {
            <span
              class="firefly"
              [style.left.%]="f.x"
              [style.top.%]="f.y"
              [style.--dx]="f.dx + 'vw'"
              [style.--dy]="f.dy + 'vh'"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + f.d + 's)'"
              [style.animation-delay.s]="-f.o"
            ></span>
          }
        }
        @case ('rain') {
          @for (r of drops; track r.i) {
            <span
              class="drop"
              [style.left.%]="r.x"
              [style.height.px]="r.h"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + r.d + 's)'"
              [style.animation-delay.s]="-r.o"
            ></span>
          }
        }
        @case ('snow') {
          @for (f of flakes; track f.i) {
            <span
              class="flake"
              [style.left.%]="f.x"
              [style.width.px]="f.s"
              [style.height.px]="f.s"
              [style.--sway]="f.sw + 'vw'"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + f.d + 's)'"
              [style.animation-delay.s]="-f.o"
            ></span>
          }
        }
        @case ('synthwave') {
          <div
            class="absolute inset-x-0 top-0 h-[62%]"
            style="background: linear-gradient(to bottom, color-mix(in oklab, var(--accent-2) 30%, var(--ink-950)), var(--ink-950))"
          ></div>
          <div
            class="absolute left-1/2 top-[22%] aspect-square w-[34vmin] -translate-x-1/2 rounded-full"
            style="background: linear-gradient(to bottom, var(--accent), var(--accent-2)); -webkit-mask-image: repeating-linear-gradient(to bottom, #000 0 11%, transparent 11% 14%); mask-image: repeating-linear-gradient(to bottom, #000 0 11%, transparent 11% 14%); opacity: .85"
          ></div>
          <div
            class="absolute inset-x-0 bottom-0 h-[42%] overflow-hidden"
            style="perspective: 360px"
          >
            <div class="grid-floor"></div>
          </div>
        }
        @case ('curtains') {
          @for (c of curtains; track c.i) {
            <span
              class="curtain"
              [style.left.%]="c.x"
              [style.width.%]="c.w"
              [style.--c]="c.alt ? 'var(--accent-2)' : 'var(--accent)'"
              [style.animation-duration]="'calc(var(--bg-speed,1) * ' + c.d + 's)'"
              [style.animation-delay.s]="-c.o"
            ></span>
          }
        }
        @case ('lavalamp') {
          @for (b of lava; track b.i) {
            <div
              class="blob"
              [style.left.%]="b.x"
              [style.top.%]="b.y"
              [style.width.%]="b.s"
              style="aspect-ratio:1;--o:.7"
              [style.--c]="b.c"
              [style.animation]="
                'drift-' + b.k + ' calc(var(--bg-speed,1) * ' + b.d + 's) ease-in-out infinite'
              "
            ></div>
          }
        }
        @case ('solid') {
          <div class="absolute inset-0" [style.background]="settings.bgSolidColor()"></div>
        }
        @case ('shuffle') {
          <div
            class="blob"
            style="left:-14%;top:-22%;width:70%;aspect-ratio:1;--c:var(--accent);--o:.5;animation:drift-a calc(var(--bg-speed,1) * 18s) ease-in-out infinite"
          ></div>
          <div
            class="blob"
            style="right:-16%;top:2%;width:76%;aspect-ratio:1;--c:var(--accent-2);--o:.45;animation:drift-b calc(var(--bg-speed,1) * 22s) ease-in-out infinite"
          ></div>
        }
        @case ('image') {
          @if (wallpaper.url(); as wp) {
            @if (wallpaper.kind() === 'video') {
              <video
                class="absolute inset-[-3%] h-[106%] w-[106%] object-cover"
                style="filter: blur(calc(var(--bg-blur) * 0.25))"
                [src]="wp"
                autoplay
                muted
                loop
                playsinline
                disablepictureinpicture
              ></video>
            } @else {
              <img
                class="absolute inset-[-3%] h-[106%] w-[106%] object-cover"
                style="filter: blur(calc(var(--bg-blur) * 0.25))"
                [src]="wp"
                alt=""
                decoding="async"
              />
            }
          } @else if (settings.wallpaper(); as old) {
            <div
              class="absolute inset-[-3%] bg-cover bg-center"
              style="filter: blur(calc(var(--bg-blur) * 0.25))"
              [style.background-image]="'url(' + old + ')'"
            ></div>
          } @else {
            <div
              class="blob"
              style="left:-14%;top:-22%;width:70%;aspect-ratio:1;--c:var(--accent);--o:.5"
            ></div>
          }
        }
      }
      <div
        class="absolute inset-0"
        style="background: radial-gradient(ellipse at 50% -10%, transparent 0%, color-mix(in oklab, var(--ink-950) 55%, transparent) 75%, var(--ink-950) 130%)"
      ></div>
    </div>
  `,
  styles: `
    .blob {
      position: absolute;
      border-radius: 50%;
      opacity: var(--o, 0.5);
      will-change: transform;
      background: radial-gradient(
        circle,
        var(--c) 0,
        var(--c) var(--bg-core, 20%),
        transparent 70%
      );
    }
    .stars {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: calc(100% + var(--tile));
      background-size: var(--tile) var(--tile);
      animation: stars-fall var(--dur) linear infinite;
      will-change: transform;
    }
    .bubble {
      position: absolute;
      bottom: -12%;
      border-radius: 50%;
      border: 1px solid color-mix(in oklab, var(--accent) 50%, transparent);
      background: radial-gradient(
        circle at 30% 30%,
        color-mix(in oklab, var(--accent) 30%, transparent),
        color-mix(in oklab, var(--accent-2) 10%, transparent)
      );
      animation: bubble-up 20s linear infinite;
      will-change: transform;
    }
    .beam {
      position: absolute;
      top: -30%;
      height: 160%;
      transform: rotate(18deg);
      background: linear-gradient(
        90deg,
        transparent,
        color-mix(in oklab, var(--accent) 38%, transparent),
        transparent
      );
      animation: beam-sweep 16s ease-in-out infinite alternate;
      will-change: transform;
    }
    .ripple {
      position: absolute;
      width: 60vmin;
      height: 60vmin;
      margin: -30vmin 0 0 -30vmin;
      border-radius: 50%;
      border: 2px solid color-mix(in oklab, var(--accent) 55%, transparent);
      animation: ring-out 8s ease-out infinite;
      will-change: transform;
    }
    .cloud {
      position: absolute;
      aspect-ratio: 1.5;
      opacity: var(--o, 0.5);
      will-change: transform;
      background: radial-gradient(
        ellipse at 50% 50%,
        var(--c) 0%,
        color-mix(in oklab, var(--c) 40%, transparent) 38%,
        transparent 68%
      );
    }
    .twinkle {
      animation-name: stars-fall, twinkle;
      animation-duration: var(--dur), 5s;
      animation-timing-function: linear, ease-in-out;
      animation-iteration-count: infinite, infinite;
      animation-direction: normal, alternate;
    }
    .meteor {
      position: absolute;
      width: 140px;
      height: 2px;
      border-radius: 2px;
      transform: rotate(32deg);
      opacity: 0;
      background: linear-gradient(90deg, transparent, #fff);
      animation: meteor 7s linear infinite;
      will-change: transform, opacity;
    }
    .orb {
      position: absolute;
      aspect-ratio: 1;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.12);
      will-change: transform;
      background: radial-gradient(
        circle at 30% 28%,
        rgba(255, 255, 255, 0.35),
        color-mix(in oklab, var(--c) 35%, transparent) 38%,
        color-mix(in oklab, var(--c) 8%, transparent) 72%,
        transparent
      );
    }
    .fog {
      position: absolute;
      left: -30%;
      width: 160%;
      border-radius: 50%;
      opacity: 0.4;
      will-change: transform;
      background: radial-gradient(
        ellipse at 50% 50%,
        color-mix(in oklab, var(--c) 60%, transparent),
        transparent 70%
      );
      animation: fog-drift 40s ease-in-out infinite alternate;
    }
    .firefly {
      position: absolute;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #fff7c2;
      box-shadow: 0 0 10px 3px color-mix(in oklab, var(--accent) 70%, #fff7c2);
      animation: firefly 18s ease-in-out infinite;
      will-change: transform, opacity;
    }
    .drop {
      position: absolute;
      top: -12%;
      width: 1px;
      background: linear-gradient(
        to bottom,
        transparent,
        color-mix(in oklab, var(--accent) 55%, transparent)
      );
      animation: rain-fall 1.4s linear infinite;
      will-change: transform;
    }
    .flake {
      position: absolute;
      top: -4%;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.75);
      animation: snow-fall 14s linear infinite;
      will-change: transform;
    }
    .grid-floor {
      position: absolute;
      left: -50%;
      right: -50%;
      top: 0;
      height: 300%;
      transform-origin: 50% 0;
      transform: rotateX(62deg);
      animation: grid-run calc(var(--bg-speed, 1) * 4s) linear infinite;
      background-image:
        linear-gradient(color-mix(in oklab, var(--accent) 70%, transparent) 2px, transparent 2px),
        linear-gradient(
          90deg,
          color-mix(in oklab, var(--accent) 70%, transparent) 2px,
          transparent 2px
        );
      background-size: 70px 70px;
    }
    .curtain {
      position: absolute;
      top: -10%;
      height: 120%;
      opacity: 0.5;
      transform-origin: 50% 0;
      background: linear-gradient(
        to bottom,
        transparent 0%,
        color-mix(in oklab, var(--c) 55%, transparent) 45%,
        transparent 100%
      );
      animation: curtain-sway 14s ease-in-out infinite alternate;
      will-change: transform;
    }
  `,
})
export class BackgroundSceneComponent {
  protected readonly settings = inject(SettingsService);
  protected readonly wallpaper = inject(WallpaperStore);
  readonly kind = input.required<BackgroundId>();
  protected readonly waves = [
    { i: 0, s: 52, b: 7, o: 0.55, c: 'var(--accent-2)', d: BackgroundSceneComponent.ola(46, 3, 0) },
    { i: 1, s: 38, b: 9, o: 0.6, c: 'var(--accent)', d: BackgroundSceneComponent.ola(38, 4, 1.7) },
    {
      i: 2,
      s: 28,
      b: 6,
      o: 0.7,
      c: 'color-mix(in oklab, var(--accent) 55%, var(--accent-2))',
      d: BackgroundSceneComponent.ola(30, 5, 3.1),
    },
    {
      i: 3,
      s: 20,
      b: 8,
      o: 0.85,
      c: 'color-mix(in oklab, var(--accent-2) 40%, #0b0d12)',
      d: BackgroundSceneComponent.ola(22, 7, 4.6),
    },
  ];

  /** SVG path of a soft wave (sine) that repeats without seams over a width of 2880. */
  private static ola(amplitud: number, ondas: number, fase: number): string {
    let d = 'M0,600 L0,' + (260 + Math.sin(fase) * amplitud).toFixed(1);
    for (let x = 0; x <= 2880; x += 24) {
      const y = 260 + Math.sin((x / 2880) * Math.PI * 2 * ondas + fase) * amplitud;
      d += ' L' + x + ',' + y.toFixed(1);
    }
    return d + ' L2880,600 Z';
  }
  /** The line of the crest of a wave (its outline without the closing edges). */
  protected crest(d: string): string {
    return 'M' + d.slice(d.indexOf('L0,') + 1).replace(/ L2880,600 Z$/, '');
  }

  /** A closed, soft curve around a point, like one line of the height of a hill. */
  private static contour(cx: number, cy: number, r: number, k: number): string {
    let d = '';
    for (let step = 0; step <= 96; step++) {
      const a = (step / 96) * Math.PI * 2;
      const wobble =
        1 +
        0.11 * Math.sin(2 * a + k * 0.21) +
        0.07 * Math.sin(3 * a + 1.7 + k * 0.33) +
        0.04 * Math.sin(5 * a + 0.6 + k * 0.5);
      const x = cx + Math.cos(a) * r * wobble * 1.25;
      const y = cy + Math.sin(a) * r * wobble;
      d += (step ? ' L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    return d + ' Z';
  }

  /** The two hills of the topography scene, each one a set of lines. */
  protected readonly topo = [
    { i: 0, cx: 460, cy: 400, s: 34, c: 'var(--accent)', o: 0.5 },
    { i: 1, cx: 1130, cy: 540, s: 46, c: 'var(--accent-2)', o: 0.42 },
  ].map(function hill(h) {
    const rings = Array.from({ length: 15 }, function ring(_, n) {
      return {
        i: n,
        d: BackgroundSceneComponent.contour(h.cx, h.cy, 36 + n * 30, n + h.i * 7),
        o: +(h.o * (1 - n / 19)).toFixed(2),
      };
    });
    return { ...h, rings };
  });
  protected readonly bubbles = Array.from({ length: 16 }, function (_, i) {
    return { l: (i * 61) % 96, s: 18 + ((i * 37) % 70), d: 14 + ((i * 7) % 14), o: (i * 3.1) % 14 };
  });

  /** Pseudo-random but fixed values, so the scene does not change on every render. */
  private static azar(i: number, n: number): number {
    const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return v - Math.floor(v);
  }

  protected readonly fireflies = this.crear(26, function (i, a) {
    return {
      i,
      x: a(i, 1) * 100,
      y: a(i, 2) * 100,
      dx: (a(i, 3) - 0.5) * 24,
      dy: (a(i, 4) - 0.5) * 24,
      d: 12 + a(i, 5) * 14,
      o: a(i, 6) * 20,
    };
  });
  protected readonly drops = this.crear(70, function (i, a) {
    return { i, x: a(i, 1) * 100, h: 40 + a(i, 2) * 70, d: 0.9 + a(i, 3) * 0.9, o: a(i, 4) * 3 };
  });
  protected readonly flakes = this.crear(55, function (i, a) {
    return {
      i,
      x: a(i, 1) * 100,
      s: 2 + a(i, 2) * 5,
      sw: (a(i, 3) - 0.5) * 8,
      d: 9 + a(i, 4) * 10,
      o: a(i, 5) * 20,
    };
  });
  protected readonly curtains = this.crear(9, function (i, a) {
    return {
      i,
      x: i * 11 - 4 + a(i, 1) * 4,
      w: 10 + a(i, 2) * 8,
      alt: i % 2 === 1,
      d: 10 + a(i, 3) * 10,
      o: a(i, 4) * 14,
    };
  });
  protected readonly lava = this.crear(6, function (i, a) {
    const colores = [
      'var(--accent)',
      'var(--accent-2)',
      '#fb7185',
      'color-mix(in oklab, var(--accent) 50%, var(--accent-2))',
      '#7c3aed',
      '#fbbf24',
    ];
    return {
      i,
      x: a(i, 1) * 70,
      y: a(i, 2) * 60,
      s: 32 + a(i, 3) * 26,
      c: colores[i % colores.length]!,
      k: 'abcd'[i % 4]!,
      d: 11 + a(i, 4) * 10,
    };
  });

  private crear<T>(
    cantidad: number,
    fabrica: (i: number, azar: (i: number, n: number) => number) => T,
  ): T[] {
    const list: T[] = [];
    for (let i = 0; i < cantidad; i++) list.push(fabrica(i, BackgroundSceneComponent.azar));
    return list;
  }

  protected readonly meteors = this.crear(5, function (i, a) {
    return { i, x: 10 + a(i, 1) * 70, y: a(i, 2) * 45, d: 5 + a(i, 3) * 6, o: a(i, 4) * 12 };
  });
  protected readonly orbs = this.crear(9, function (i, a) {
    const colores = [
      'var(--accent)',
      'var(--accent-2)',
      '#f472b6',
      '#38bdf8',
      'color-mix(in oklab, var(--accent) 50%, var(--accent-2))',
    ];
    return {
      i,
      x: a(i, 1) * 85,
      y: a(i, 2) * 80,
      s: 10 + a(i, 3) * 22,
      c: colores[i % colores.length]!,
      k: 'abcd'[i % 4]!,
      d: 16 + a(i, 4) * 16,
    };
  });
  protected readonly fogs = this.crear(5, function (i, a) {
    const colores = ['var(--accent)', 'var(--accent-2)', '#7c3aed'];
    return {
      i,
      y: i * 18 - 6,
      h: 34 + a(i, 1) * 14,
      c: colores[i % colores.length]!,
      d: 36 + a(i, 2) * 30,
      o: a(i, 3) * 30,
    };
  });
  protected readonly beams = [
    { l: -5, w: 14, d: 15, o: 0 },
    { l: 22, w: 22, d: 19, o: 5 },
    { l: 50, w: 12, d: 13, o: 9 },
    { l: 72, w: 20, d: 21, o: 3 },
  ];
  protected readonly ripples = [
    { x: 22, y: 30, d: 9, o: 0 },
    { x: 22, y: 30, d: 9, o: 4.5 },
    { x: 74, y: 62, d: 11, o: 2 },
    { x: 74, y: 62, d: 11, o: 7.5 },
    { x: 48, y: 88, d: 10, o: 5 },
  ];
}

/** Backgrounds the shuffle mode can pick (the solid one, the own image and the shuffle mode itself are left out). */
const BARAJA: BackgroundId[] = [
  'aurora',
  'nebula',
  'cosmos',
  'stars',
  'network',
  'fireflies',
  'lavalamp',
  'prism',
  'orbs',
  'mist',
  'topography',
  'curtains',
  'synthwave',
  'waves',
  'rain',
  'snow',
  'bubbles',
  'beams',
  'ripples',
  'sunset',
  'grid',
];

/**
 * The full-screen background of the whole app. With the "shuffle" mode it picks a background from the deck when
 * load the page and, when asked, changes it every few minutes with a soft fade.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-mesh-background',
  standalone: true,
  imports: [BackgroundSceneComponent],
  template: `<div
    class="pointer-events-none fixed inset-0 -z-10 transition-opacity duration-700"
    [class.opacity-0]="!visible()"
  >
    <app-bg-scene [kind]="actual()" />
  </div>`,
})
export class MeshBackgroundComponent implements OnDestroy {
  protected readonly settings = inject(SettingsService);
  private readonly wallpaper = inject(WallpaperStore);
  protected readonly actual = signal<BackgroundId>('aurora');
  protected readonly visible = signal(true);
  private shuffleTimer: number | undefined;

  constructor() {
    void this.wallpaper.load();
    effect(this.alCambiarAjustes.bind(this));
  }

  /** Reacts to the background settings: a fixed background, or shuffle with its mode and interval. */
  private alCambiarAjustes(): void {
    const fondo = this.settings.background();
    const modo = this.settings.bgShuffleMode();
    const minutos = Math.max(1, this.settings.bgShuffleMinutes());
    untracked(
      function (this: MeshBackgroundComponent) {
        window.clearInterval(this.shuffleTimer);
        if (fondo !== 'shuffle') {
          this.actual.set(fondo);
          return;
        }
        this.actual.set(this.pick());
        if (modo === 'interval')
          this.shuffleTimer = window.setInterval(this.rotar.bind(this), minutos * 60000);
      }.bind(this),
    );
  }

  /** Elige un fondo distinto del actual. */
  private pick(): BackgroundId {
    const otros = BARAJA;
    let next = otros[Math.floor(Math.random() * otros.length)]!;
    if (next === this.actual() && otros.length > 1)
      next = otros[(otros.indexOf(next) + 1) % otros.length]!;
    return next;
  }

  /** Change with a fade: it fades out, the scene changes and it fades in again. */
  private rotar(): void {
    this.visible.set(false);
    window.setTimeout(this.changeScene.bind(this), 750);
  }

  /** Changes to the next background (the shuffle). */
  private changeScene(): void {
    this.actual.set(this.pick());
    this.visible.set(true);
  }

  /** Stops the timer of the shuffle. */
  ngOnDestroy(): void {
    window.clearInterval(this.shuffleTimer);
  }
}
