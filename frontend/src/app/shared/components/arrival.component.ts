/**
 * src/app/shared/components/arrival.component.ts
 * The animations of arriving in the app, drawn over everything: the introduction of the first visit (an aurora and a
 * glowing floor, lights that spiral into the logo, a lock that snaps shut and a shockwave), the iris that opens the
 * app after signing in and the fireworks after creating an account. It is loaded only when one plays; the shapes are
 * CSS and SVG and the lights are drawn on a canvas by `arrival-fx.ts`, so nothing is downloaded but code.
 */
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { ArrivalService, type ArrivalKind } from '../../core/services/arrival.service';
import { SettingsService } from '../../core/services/settings.service';
import { SoundService } from '../../core/services/sound.service';
import { playArrivalSounds } from '../util/arrival-sounds';
import { startFx, type Fx } from '../util/arrival-fx';

/** For each kind: when the page underneath may change, when the animation starts to leave and when it is gone (ms). */
const TIMELINE: Record<ArrivalKind, { reveal: number; leave: number; end: number }> = {
  intro: { reveal: 0, leave: 3900, end: 4600 },
  login: { reveal: 1000, leave: 1700, end: 2300 },
  register: { reveal: 2200, leave: 3500, end: 4100 },
  logout: { reveal: 1100, leave: 1900, end: 2500 },
};

/** Whether an animation belongs to the given part (::before or ::after) of the dark layer of the HTML. */
function isCoverPart(part: string, animation: Animation): boolean {
  const effect = animation.effect as KeyframeEffect | null;
  return (
    effect?.target instanceof Element &&
    effect.target.id === 'boot-cover' &&
    effect.pseudoElement === part
  );
}

/** Puts the animations of an element at the same point as the ones of a part of the dark layer (they are the same, in the same order). */
function followCover(part: string, element: Element | null): void {
  const source = document.getAnimations().filter(isCoverPart.bind(null, part));
  const mine = element?.getAnimations() ?? [];
  for (let i = 0; i < mine.length && i < source.length; i++) {
    mine[i]!.currentTime = source[i]!.currentTime;
  }
}

/** The animation of an arrival. */
@Component({
  selector: 'app-arrival',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div
      class="arr"
      [class]="'arr-' + kind()"
      [class.is-leaving]="leaving()"
      [class.arr-warm]="warm"
      role="status"
      aria-live="polite"
      (click)="skip()"
    >
      <div class="arr-aurora"></div>
      <div class="arr-floor"></div>
      <canvas #fx class="arr-fx"></canvas>
      <span class="arr-flash"></span>
      <div class="arr-stage">
        <span class="arr-ripple"></span><span class="arr-ripple r2"></span
        ><span class="arr-ripple r3"></span> <span class="arr-glow"></span
        ><span class="arr-orbit"></span><span class="arr-orbit o2"></span>
        <span class="arr-wave"></span><span class="arr-wave w2"></span>
        <div class="arr-mark">
          @if (kind() === 'register') {
            <svg class="arr-logo" viewBox="0 0 64 64" aria-hidden="true">
              <circle class="ring" cx="32" cy="32" r="29" pathLength="1" />
              <path class="tick" pathLength="1" d="M19 33l9 9 17-19" />
            </svg>
          } @else {
            <svg class="arr-logo" viewBox="12 10 40 44" aria-hidden="true">
              <path
                class="draw"
                pathLength="1"
                d="M16 22a8 8 0 0 1 8-8h16a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8h-9l-9 8v-8a8 8 0 0 1-6-8z"
              />
              <path
                class="fill"
                d="M16 22a8 8 0 0 1 8-8h16a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8h-9l-9 8v-8a8 8 0 0 1-6-8z"
              />
              <circle class="eye" cx="26" cy="28" r="2.6" />
              <circle class="eye e2" cx="38" cy="28" r="2.6" />
            </svg>
            <svg class="arr-badge" viewBox="0 0 32 32" aria-hidden="true">
              <circle class="disc" cx="16" cy="16" r="15" />
              <path class="shackle" d="M11 15v-3a5 5 0 0 1 10 0v3" />
              <rect class="body" x="9" y="15" width="14" height="10" rx="3" />
              <path class="key" d="M16 18.6v3" />
            </svg>
          }
        </div>
        <svg width="0" height="0" aria-hidden="true">
          <defs>
            <linearGradient id="arr-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style="stop-color: var(--a)" />
              <stop offset="0.5" style="stop-color: var(--m)" />
              <stop offset="1" style="stop-color: var(--b)" />
            </linearGradient>
          </defs>
        </svg>
        @switch (kind()) {
          @case ('intro') {
            <h1 class="arr-title" aria-label="Chatterly-Renewed">
              @for (letter of letters; track $index) {
                <span [style.--i]="$index">{{ letter }}</span>
              }
            </h1>
          }
          @case ('login') {
            <p class="arr-line a">{{ 'Unlocking your keys…' | t }}</p>
            <p class="arr-line b">{{ 'Welcome back, {name}' | t: { name: name() } }}</p>
          }
          @case ('logout') {
            <p class="arr-line a">{{ 'Locking your keys…' | t }}</p>
            <p class="arr-line b">{{ 'See you soon, {name}' | t: { name: name() } }}</p>
          }
          @case ('register') {
            <p class="arr-line a">{{ 'Your account is ready' | t }}</p>
            <p class="arr-line b">{{ 'Welcome, {name}' | t: { name: name() } }}</p>
            <p class="arr-note">
              {{ 'Your keys were made on this device and never left it.' | t }}
            </p>
          }
        }
      </div>
      @if (kind() === 'intro') {
        <span class="arr-skip">{{ 'Click to skip' | t }}</span>
      }
    </div>
  `,
  styles: `
    .arr {
      /* The colors of the animation are the ones of the chosen theme (the second one and the mix of both). */
      --a: var(--accent, #2ef2b0);
      --b: var(--accent-2, #a78bfa);
      --m: color-mix(in oklab, var(--a), var(--b));
      --g: linear-gradient(120deg, var(--a), var(--m) 50%, var(--b));
      position: fixed;
      inset: 0;
      z-index: 300;
      display: grid;
      place-items: center;
      overflow: hidden;
      color: #fff;
      background: #04070d;
      perspective: 900px;
      transition:
        opacity 0.7s var(--ease-suave),
        transform 0.7s var(--ease-suave);
    }
    .arr-login,
    .arr-logout,
    .arr-register {
      animation: iris 0.8s var(--ease) both;
    }
    @keyframes iris {
      from {
        clip-path: circle(0% at 50% 50%);
      }
      to {
        clip-path: circle(150% at 50% 50%);
      }
    }
    .arr.is-leaving {
      opacity: 0;
      transform: scale(1.35);
      pointer-events: none;
    }
    .arr-intro {
      cursor: pointer;
    }
    .arr-aurora {
      position: absolute;
      inset: -30%;
      background:
        radial-gradient(
          40% 35% at 25% 30%,
          color-mix(in oklab, var(--a) 33%, transparent),
          transparent 70%
        ),
        radial-gradient(
          35% 40% at 78% 35%,
          color-mix(in oklab, var(--b) 33%, transparent),
          transparent 70%
        ),
        radial-gradient(
          45% 35% at 55% 80%,
          color-mix(in oklab, var(--m) 27%, transparent),
          transparent 70%
        );
      will-change: transform;
      animation:
        fade 0.5s forwards,
        sway 10s ease-in-out infinite alternate;
      opacity: 0;
    }
    @keyframes sway {
      from {
        transform: translate(-4%, -3%);
      }
      to {
        transform: translate(4%, 3%) scale(1.08);
      }
    }
    @keyframes drift {
      to {
        transform: rotate(360deg);
      }
    }
    .arr-floor {
      position: absolute;
      left: -50%;
      right: -50%;
      bottom: -10%;
      height: 55%;
      overflow: hidden;
      transform: rotateX(68deg);
      transform-origin: 50% 100%;
      mask-image: linear-gradient(to top, #000, transparent 85%);
      opacity: 0;
      animation: fade 1.6s 0.6s forwards;
    }
    /* The lines of the floor move by sliding one taller layer (the compositor does it), not by repainting a background. */
    .arr-floor::before {
      content: '';
      position: absolute;
      inset: -48px 0 0;
      background:
        linear-gradient(color-mix(in oklab, var(--a) 20%, transparent) 1px, transparent 1px) 0 0 /
          100% 48px,
        linear-gradient(90deg, color-mix(in oklab, var(--a) 20%, transparent) 1px, transparent 1px)
          0 0 / 48px 100%;
      animation: scroll 1.2s linear infinite;
    }
    .arr-login .arr-floor,
    .arr-logout .arr-floor,
    .arr-register .arr-floor {
      display: none;
    }
    @keyframes scroll {
      to {
        transform: translateY(48px);
      }
    }
    .arr-fx {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      animation: fade 0.8s forwards;
    }
    .arr-flash {
      position: absolute;
      inset: 0;
      background: radial-gradient(
        circle at 50% 45%,
        #fff,
        color-mix(in oklab, var(--a) 40%, transparent) 35%,
        transparent 65%
      );
      opacity: 0;
    }
    .arr-intro .arr-flash {
      animation: flash 0.9s ease-out 1.55s;
    }
    .arr-register .arr-flash {
      animation: flash 0.8s ease-out 1.1s;
    }
    @keyframes flash {
      0% {
        opacity: 0;
      }
      30% {
        opacity: 0.8;
      }
      100% {
        opacity: 0;
      }
    }
    .arr-stage {
      position: absolute;
      left: 50%;
      top: 44%;
      width: max-content;
      max-width: 100%;
      transform: translate(-50%, -6rem);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      text-align: center;
      padding: 1.5rem;
      transform-style: preserve-3d;
    }
    .arr-ripple {
      position: absolute;
      top: 6rem;
      width: 9rem;
      height: 9rem;
      margin-top: -4.5rem;
      border-radius: 50%;
      border: 1px solid var(--a);
      opacity: 0;
      will-change: transform, opacity;
      animation: ripple 3.6s ease-out 0.8s infinite;
    }
    .arr-ripple.r2 {
      animation-delay: 2s;
      border-color: var(--m);
    }
    .arr-ripple.r3 {
      animation-delay: 3.2s;
      border-color: var(--b);
    }
    .arr-register .arr-ripple {
      display: none;
    }
    @keyframes ripple {
      from {
        transform: scale(0.7);
        opacity: 0.55;
      }
      to {
        transform: scale(4.2);
        opacity: 0;
      }
    }
    .arr-wave {
      position: absolute;
      top: 6rem;
      width: 9rem;
      height: 9rem;
      margin: -4.5rem 0 0;
      border-radius: 50%;
      border: 2px solid var(--a);
      background: radial-gradient(
        circle closest-side,
        transparent 82%,
        color-mix(in oklab, var(--a) 45%, transparent) 97%,
        transparent
      );
      opacity: 0;
      /* it is drawn once and the compositor only scales that picture */
      will-change: transform, opacity;
    }
    .arr-intro .arr-wave {
      animation: wave 1.3s ease-out 1.55s;
    }
    .arr-intro .arr-wave.w2 {
      animation-delay: 1.8s;
      border-color: var(--b);
      background: radial-gradient(
        circle closest-side,
        transparent 82%,
        color-mix(in oklab, var(--b) 45%, transparent) 97%,
        transparent
      );
    }
    .arr-login .arr-wave,
    .arr-logout .arr-wave {
      animation: wave 1s ease-out 0.8s;
    }
    .arr-register .arr-wave {
      animation: wave 1.2s ease-out 1.1s;
    }
    .arr-login .w2,
    .arr-logout .w2,
    .arr-register .w2 {
      display: none;
    }
    @keyframes wave {
      from {
        transform: scale(0.3);
        opacity: 0;
      }
      12% {
        opacity: 1;
      }
      to {
        transform: scale(9);
        opacity: 0;
      }
    }
    .arr-mark {
      position: relative;
      margin-bottom: 1.4rem;
      width: 9rem;
      height: 9rem;
      opacity: 0;
      animation: spin-in 1.3s var(--ease) 0.05s forwards;
    }
    .arr-login .arr-mark,
    .arr-logout .arr-mark,
    .arr-register .arr-mark {
      animation: spin-in 0.9s var(--ease) 0.1s forwards;
    }
    .arr-logo {
      width: 100%;
      height: 100%;
      overflow: visible;
      fill: none;
      stroke: url(#arr-g);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .fill {
      fill: url(#arr-g);
      stroke: none;
      opacity: 0;
      animation: fade 0.5s 0.9s forwards;
    }
    .eye {
      fill: #04070d;
      stroke: none;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      animation:
        fade 0.2s 1.1s forwards,
        blink 3s 2s infinite;
    }
    .arr-login .fill,
    .arr-logout .fill {
      animation-delay: 0.5s;
    }
    .arr-login .eye,
    .arr-logout .eye {
      animation-delay: 0.7s, 1.6s;
    }
    @keyframes blink {
      0%,
      92%,
      100% {
        transform: none;
      }
      96% {
        transform: scaleY(0.1);
      }
    }
    .arr-badge {
      position: absolute;
      right: -0.9rem;
      bottom: -0.7rem;
      width: 4.2rem;
      height: 4.2rem;
      overflow: visible;
      fill: none;
      stroke: url(#arr-g);
      stroke-width: 2.4;
      stroke-linecap: round;
      transform: scale(0);
      animation: pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) 0.9s forwards;
    }
    .arr-login .arr-badge,
    .arr-logout .arr-badge {
      animation-delay: 0.2s;
    }
    .disc {
      fill: #04070d;
      stroke: url(#arr-g);
      stroke-width: 1.4;
    }
    @keyframes pop {
      to {
        transform: none;
      }
    }
    @keyframes spin-in {
      from {
        opacity: 0;
        transform: rotateY(-200deg) scale(0.3);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .arr-glow {
      will-change: transform, opacity;
      position: absolute;
      top: 6rem;
      width: 18rem;
      height: 18rem;
      margin-top: -9rem;
      border-radius: 50%;
      background: radial-gradient(
        circle closest-side,
        color-mix(in oklab, var(--a) 33%, transparent),
        color-mix(in oklab, var(--b) 13%, transparent) 55%,
        transparent
      );
      opacity: 0;
      animation:
        fade 0.6s 0.2s forwards,
        glow 2.4s ease-in-out infinite;
    }
    @keyframes glow {
      50% {
        transform: scale(1.18);
      }
    }
    .draw,
    .ring,
    .tick {
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: draw 1s var(--ease) 0.2s forwards;
    }
    .ring {
      animation-duration: 0.8s;
    }
    .tick {
      stroke-width: 3.6;
      animation: draw 0.7s var(--ease) 1s forwards;
    }
    @keyframes draw {
      to {
        stroke-dashoffset: 0;
      }
    }
    .body {
      fill: url(#arr-g);
      stroke: none;
    }
    .shackle {
      transform-origin: 21px 15px;
      animation: snap 0.35s cubic-bezier(0.6, 0, 0.3, 1.6) 1.45s backwards;
    }
    .arr-login .shackle {
      animation: unlock 0.5s var(--ease) 0.9s forwards;
    }
    .arr-logout .shackle {
      transform: translate(2px, -3px) rotate(22deg);
      animation: snap 0.4s cubic-bezier(0.6, 0, 0.3, 1.6) 0.55s forwards;
    }
    .key {
      stroke: #04070d;
      stroke-width: 2.2;
    }
    .arr-orbit {
      position: absolute;
      top: 6rem;
      width: 13rem;
      height: 13rem;
      margin-top: -6.5rem;
      border-radius: 50%;
      border: 2px dashed color-mix(in oklab, var(--a) 40%, transparent);
      border-top-color: var(--a);
      opacity: 0;
      animation:
        fade 0.6s 0.3s forwards,
        drift 6s linear infinite;
    }
    .arr-orbit.o2 {
      width: 16rem;
      height: 16rem;
      margin-top: -8rem;
      border-color: color-mix(in oklab, var(--b) 27%, transparent);
      border-bottom-color: var(--b);
      animation-direction: normal, reverse;
    }
    .arr-register .arr-orbit {
      display: none;
    }
    @keyframes snap {
      from {
        transform: translate(2px, -3px) rotate(22deg);
      }
      to {
        transform: none;
      }
    }
    @keyframes unlock {
      to {
        transform: translate(2px, -3px) rotate(22deg);
      }
    }
    @keyframes fade {
      to {
        opacity: 1;
      }
    }
    .arr-title {
      display: flex;
      margin: 1rem 0 0;
      font-size: clamp(2rem, 7vw, 3.6rem);
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .arr-title span {
      display: inline-block;
      background: linear-gradient(100deg, #fff 35%, var(--a) 45%, #fff 55%) 150% 0 / 300% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      opacity: 0;
      transform: translateY(0.7em) rotateX(-80deg) scale(0.8);
      animation:
        rise 0.8s var(--ease) calc(1.7s + var(--i) * 55ms) forwards,
        shine 1.1s ease-in-out 2.9s;
    }
    @keyframes rise {
      to {
        opacity: 1;
        transform: none;
      }
    }
    @keyframes shine {
      to {
        background-position: -50% 0;
      }
    }
    .arr-line,
    .arr-note {
      margin: 0;
      opacity: 0;
      animation: fade 0.6s var(--ease-suave) forwards;
    }
    .arr-skip {
      position: absolute;
      bottom: 1.4rem;
      font-size: 0.75rem;
      color: #94a3b8;
      opacity: 0;
      animation: fade 0.6s 1.5s forwards;
    }
    .arr-line {
      font-size: 1.25rem;
      font-weight: 700;
      animation-delay: 0.5s;
    }
    .arr-login .arr-line.a,
    .arr-logout .arr-line.a {
      animation:
        fade 0.3s 0.4s forwards,
        gone 0.3s 0.95s forwards;
    }
    .arr-login .arr-line.b,
    .arr-logout .arr-line.b {
      position: absolute;
      bottom: 0.6rem;
      color: var(--a);
      animation-delay: 1.1s;
    }
    .arr-register .arr-line.a {
      font-size: 0.95rem;
      color: #94a3b8;
      animation-delay: 1.5s;
    }
    .arr-register .arr-line.b {
      font-size: 2rem;
      background: var(--g);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation-delay: 1.7s;
    }
    .arr-note {
      font-size: 0.8rem;
      color: #94a3b8;
      animation-delay: 2.1s;
    }
    @keyframes gone {
      to {
        opacity: 0;
      }
    }
    /* A phone, or a device that is already slow: the parts that cost the most to draw are left out (the floor with its mask and its
       3D, the light that sweeps over every letter, the extra rings), so the rest runs at the speed of the screen. */
    @media (pointer: coarse), (max-width: 820px) {
      .arr-floor,
      .arr-ripple.r2,
      .arr-ripple.r3,
      .arr-orbit.o2 {
        display: none;
      }
      .arr-title span {
        background: none;
        -webkit-text-fill-color: #fff;
        animation: rise 0.8s var(--ease) calc(1.7s + var(--i) * 55ms) forwards;
      }
    }
    :root[data-perf='low'] .arr-floor,
    :root[data-perf='low'] .arr-ripple.r2,
    :root[data-perf='low'] .arr-ripple.r3,
    :root[data-perf='low'] .arr-orbit.o2 {
      display: none;
    }
    :root[data-perf='low'] .arr-title span {
      background: none;
      -webkit-text-fill-color: #fff;
      animation: rise 0.8s var(--ease) calc(1.7s + var(--i) * 55ms) forwards;
    }
  `,
})
export class ArrivalComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly arrival = inject(ArrivalService);
  private readonly sound = inject(SoundService);
  private readonly settings = inject(SettingsService);
  private silence: (() => void) | null = null;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('fx');
  readonly kind = input.required<ArrivalKind>();
  readonly name = input('');
  protected readonly leaving = signal(false);
  /** The dark layer of the HTML already shows the aurora: this one continues it (same turn, no fade) instead of starting over. */
  protected readonly warm = !!document.getElementById('boot-cover');
  protected readonly letters = Array.from('Chatterly-Renewed');
  private fx: Fx | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  /** Schedules the reveal of the page underneath, the exit and the end. */
  ngOnInit(): void {
    const line = TIMELINE[this.kind()];
    this.timers.push(
      setTimeout(this.arrival.dropCover, 60),
      setTimeout(this.arrival.reveal.bind(this.arrival), line.reveal),
      setTimeout(this.startLeaving.bind(this), line.leave),
      setTimeout(this.arrival.finish.bind(this.arrival), line.end),
    );
  }

  /** Starts the lights once the canvas exists, and times the explosions to the shapes (the lock, the check). */
  ngAfterViewInit(): void {
    const kind = this.kind();
    if (this.warm) {
      const host = this.host.nativeElement;
      followCover('::before', host.querySelector('.arr-aurora'));
      followCover('::after', host.querySelector('.arr-glow'));
    }
    // The sounds (the padlock, the lights, the fireworks) follow the interface sounds, and wait for the first press of the
    // person: before it the browser does not allow any sound.
    if (this.settings.sounds() && (navigator.userActivation?.hasBeenActive ?? true)) {
      this.silence = playArrivalSounds(this.sound.context, this.sound.output, kind);
    }
    this.fx = startFx(this.canvas().nativeElement, kind === 'logout' ? 'login' : kind);
    if (kind === 'intro') {
      this.at(1550, this.blast.bind(this, 0.5, 0.42, 40));
    } else if (kind === 'login' || kind === 'logout') {
      this.at(kind === 'login' ? 800 : 1000, this.blast.bind(this, 0.5, 0.45, 0));
    } else {
      this.at(1100, this.blast.bind(this, 0.5, 0.45, 70));
      this.at(1500, this.firework.bind(this, 0.25, 0.35));
      this.at(1850, this.firework.bind(this, 0.75, 0.3));
      this.at(2250, this.firework.bind(this, 0.5, 0.2));
      this.at(2650, this.firework.bind(this, 0.18, 0.55));
      this.at(2900, this.firework.bind(this, 0.82, 0.5));
    }
  }

  /** Runs a step after some time and remembers it so it can be cancelled. */
  private at(ms: number, step: () => void): void {
    this.timers.push(setTimeout(step, ms));
  }

  /** The ring of lights explodes, plus an extra burst of sparks from the logo. */
  private blast(x: number, y: number, extra: number): void {
    this.fx?.explode();
    if (extra) {
      this.fx?.burst(x, y, extra, this.kind() === 'register' ? 0.12 : 0);
    }
  }

  /** A firework: a round burst of sparks that then fall. */
  private firework(x: number, y: number): void {
    this.fx?.burst(x, y, 60, 0.07);
  }

  /** The animation starts to fade away. */
  private startLeaving(): void {
    this.leaving.set(true);
  }

  /** A press on the introduction skips it. */
  protected skip(): void {
    if (this.kind() !== 'intro' || this.leaving()) {
      return;
    }
    this.leaving.set(true);
    this.silence?.();
    this.clear();
    this.timers.push(setTimeout(this.arrival.finish.bind(this.arrival), 650));
  }

  /** Cancels the pending steps. */
  private clear(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
  }

  /** Cancels the steps and stops the lights when the component goes away. */
  ngOnDestroy(): void {
    this.clear();
    this.silence?.();
    this.fx?.stop();
  }
}
