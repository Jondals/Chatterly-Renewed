/**
 * src/app/features/spinly/spinly-wheel.component.ts
 * The wheel itself, drawn like the one in Spinly: a disc of colored sectors with their names across them, a fixed
 * rim with a wave of little lights, a hub and the pointer on top. It does not decide anything: it is told where to
 * stop (the angle that must end under the pointer) and turns there, with a tick for every sector that goes by.
 * The same component draws the prize wheel and the two-sided wheel of a tournament duel.
 */
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SoundService } from '../../core/services/sound.service';
import { isLightColor } from './spinly-engine';
import type { SpinlyTheme } from './spinly-model';

/** One sector of the wheel. */
export interface WheelSector {
  label: string;
  /** Any CSS color. */
  color: string;
  /** Share of the wheel (equal weights make equal sectors). */
  weight: number;
}

/** An order to turn: where the wheel must stop and how. */
export interface WheelOrder {
  /** Changes with every order, so the same order is never obeyed twice. */
  key: string;
  /** Angle of the wheel (clockwise from the top) that must end under the pointer. */
  land: number;
  /** Full extra turns before stopping. */
  turns: number;
  /** How long the turn lasts (ms). */
  ms: number;
  /** False to jump to the final position without turning (a result that is shown, not played). */
  animate: boolean;
}

/** The wheel is drawn in a box of 100 units; the disc fills it and the pointer sticks out above. */
const CENTER = 50;
const RADIUS = 50;
const RIM = 48.6;
const CYCLE = 2.4;
const RIM_LIGHTS = 24;
const HUB_LIGHTS = 8;
const RIM_TOP = '#34344a';
const RIM_BOTTOM = '#14141b';
/** Shape of the pointer (the one of Spinly, drawn in a box of 36 x 40). */
const POINTER_BODY =
  'M6 3h24c3.2 0 5.1 3.5 3.4 6.2L20.7 34.7a3.1 3.1 0 0 1-5.4 0L2.6 9.2C.9 6.5 2.8 3 6 3Z';
const POINTER_SHINE = 'M9.5 7h17L18 23.5Z';

/** Counter that gives every wheel its own gradient id. */
let wheelCount = 0;

/** A point at an angle (0 = top, clockwise) and a distance from the centre. */
function polar(radius: number, degrees: number): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

/** SVG path of a sector between two angles. */
function sectorPath(start: number, end: number): string {
  if (end - start >= 359.99) {
    const side = RADIUS * 2;
    return (
      'M ' +
      (CENTER - RADIUS) +
      ' ' +
      CENTER +
      ' a ' +
      RADIUS +
      ' ' +
      RADIUS +
      ' 0 1 0 ' +
      side +
      ' 0' +
      ' a ' +
      RADIUS +
      ' ' +
      RADIUS +
      ' 0 1 0 ' +
      -side +
      ' 0 Z'
    );
  }
  const from = polar(RADIUS, end);
  const to = polar(RADIUS, start);
  const large = end - start > 180 ? 1 : 0;
  return (
    'M ' +
    CENTER +
    ' ' +
    CENTER +
    ' L ' +
    from.x +
    ' ' +
    from.y +
    ' A ' +
    RADIUS +
    ' ' +
    RADIUS +
    ' 0 ' +
    large +
    ' 0 ' +
    to.x +
    ' ' +
    to.y +
    ' Z'
  );
}

/** What the template draws for one sector. */
interface Shape {
  path: string;
  color: string;
  label: string;
  mid: number;
  text: string;
  size: number;
}

/** A little light of the rim or the hub. */
interface Light {
  x: number;
  y: number;
  delay: string;
}

/** Lights on a circle; the staggered delay makes the wave run around it. */
function ringOfLights(count: number, radius: number): Light[] {
  const lights: Light[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    lights.push({
      x: CENTER + radius * Math.sin(angle),
      y: CENTER - radius * Math.cos(angle),
      delay: (-(i / count) * CYCLE).toFixed(2) + 's',
    });
  }
  return lights;
}

/** A wheel that turns where it is told to. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-spinly-wheel',
  standalone: true,
  template: `
    <svg
      class="spinly-wheel block h-auto w-full select-none"
      [class.is-spinning]="spinning()"
      viewBox="-4 -11 108 115"
      role="img"
      aria-label="Spinly wheel"
    >
      <defs>
        <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" [attr.stop-color]="rimTop" />
          <stop offset="1" [attr.stop-color]="rimBottom" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill="#202026" />
      <g
        class="disc"
        [style.transform]="'rotate(' + rotation() + 'deg)'"
        [style.transition]="transition()"
      >
        @for (shape of shapes(); track $index) {
          <g
            [style.opacity]="highlight() === null || highlight() === $index ? 1 : 0.4"
            style="transition: opacity 0.5s"
          >
            <path
              [attr.d]="shape.path"
              [attr.fill]="shape.color"
              [attr.stroke]="selected() === $index ? '#ffffff' : shape.color"
              [attr.stroke-width]="selected() === $index ? 1.1 : 0.3"
              [class.slice]="interactive()"
              (click)="onSlice($index)"
            />
            <text
              [attr.transform]="'rotate(' + shape.mid + ' 50 50)'"
              x="50"
              y="17.5"
              dy="0.34em"
              text-anchor="middle"
              font-weight="700"
              letter-spacing="0.33"
              [attr.font-size]="shape.size"
              [attr.fill]="shape.text"
              style="pointer-events: none"
            >
              {{ shape.label }}
            </text>
          </g>
        }
      </g>
      <circle
        cx="50"
        cy="50"
        r="48.6"
        fill="none"
        [attr.stroke]="'url(#' + gradientId + ')'"
        stroke-width="3"
      />
      <circle
        cx="50"
        cy="50"
        r="47.1"
        fill="none"
        stroke="rgba(255,255,255,.12)"
        stroke-width="0.35"
      />
      @for (light of rimLights; track $index) {
        <circle
          class="light"
          [attr.cx]="light.x"
          [attr.cy]="light.y"
          r="0.75"
          [attr.fill]="lightColor()"
          [style.animation-delay]="light.delay"
        />
      }
      <circle cx="50" cy="50" r="5" fill="#121214" [attr.stroke]="rimBottom" stroke-width="1.8" />
      @for (light of hubLights; track $index) {
        <circle
          class="light"
          [attr.cx]="light.x"
          [attr.cy]="light.y"
          r="0.6"
          [attr.fill]="lightColor()"
          [style.animation-delay]="light.delay"
        />
      }
      @if (interactive()) {
        <circle
          class="rim-hit"
          cx="50"
          cy="50"
          r="48.6"
          fill="none"
          stroke="transparent"
          stroke-width="3.4"
          (click)="lightsClick.emit()"
        />
      }
      <g
        class="pointer"
        [class.hit]="interactive()"
        transform="translate(46.1 -4.6) scale(0.2083)"
        (click)="onPointer()"
      >
        @if (interactive()) {
          <rect x="-4" y="-4" width="44" height="48" fill="transparent" />
        }
        <path
          [attr.d]="pointerBody"
          [attr.fill]="pointerColor()"
          stroke="#ffffff"
          stroke-width="2.5"
          stroke-linejoin="round"
        />
        <path [attr.d]="pointerShine" fill="#ffffff" opacity="0.3" />
      </g>
    </svg>
  `,
  styles: `
    .spinly-wheel {
      filter: drop-shadow(0 14px 18px rgba(0, 0, 0, 0.45));
    }
    .disc {
      transform-box: fill-box;
      transform-origin: center;
    }
    .slice {
      cursor: var(--cur-pointer, pointer);
      transition: filter 0.2s;
    }
    .slice:hover {
      filter: brightness(1.18);
    }
    .light {
      animation: spinly-light 2.4s ease-in-out infinite;
    }
    .is-spinning .light {
      animation-duration: 0.6s;
    }
    .pointer {
      filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.5));
    }
    .pointer.hit,
    .rim-hit {
      cursor: var(--cur-pointer, pointer);
    }
    .pointer.hit {
      transition: filter 0.2s;
    }
    .pointer.hit:hover {
      filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.5)) brightness(1.25);
    }
    .rim-hit:hover {
      stroke: rgba(255, 255, 255, 0.12);
    }
    @keyframes spinly-light {
      0%,
      100% {
        opacity: 0.3;
      }
      50% {
        opacity: 1;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .light {
        animation: none;
      }
    }
  `,
})
export class SpinlyWheelComponent {
  private readonly sound = inject(SoundService);
  private readonly destroyRef = inject(DestroyRef);

  /** The sectors, in order, starting at the top and going clockwise. */
  readonly sectors = input.required<WheelSector[]>();
  /** The look of the pointer and the lights (amber when missing). */
  readonly theme = input<SpinlyTheme | undefined>(undefined);
  /** The latest order to turn. */
  readonly order = input<WheelOrder | null>(null);
  /** Index of the sector marked with a white outline (the one being edited), or null. */
  readonly selected = input<number | null>(null);
  /** True when the sectors can be clicked. */
  readonly interactive = input(false);
  /** A sector was clicked. */
  readonly sectorClick = output<number>();
  /** The arrow was clicked. */
  readonly pointerClick = output<void>();
  /** The rim with its lights was clicked. */
  readonly lightsClick = output<void>();
  /** Index of the sector to light up (the winner), or null. */
  readonly highlight = input<number | null>(null);
  /** Emits when the wheel stops after an animated order. */
  readonly stopped = output<string>();

  protected readonly gradientId = 'spinly-rim-' + ++wheelCount;
  protected readonly rimTop = RIM_TOP;
  protected readonly rimBottom = RIM_BOTTOM;
  protected readonly pointerBody = POINTER_BODY;
  protected readonly pointerShine = POINTER_SHINE;
  protected readonly rimLights = ringOfLights(RIM_LIGHTS, RIM);
  protected readonly hubLights = ringOfLights(HUB_LIGHTS, 5);
  protected readonly rotation = signal(0);
  protected readonly ms = signal(0);
  protected readonly spinning = signal(false);
  protected readonly pointerColor = computed(this.pickPointer.bind(this));
  protected readonly lightColor = computed(this.pickLight.bind(this));
  protected readonly shapes = computed(this.buildShapes.bind(this));
  protected readonly transition = computed(this.buildTransition.bind(this));

  private turned = 0;
  private lastKey = '';
  private timers: ReturnType<typeof setTimeout>[] = [];

  /** Starts obeying orders and stops everything when the wheel goes away. */
  constructor() {
    effect(this.followOrder.bind(this));
    this.destroyRef.onDestroy(this.clearTimers.bind(this));
  }

  /** The arrow was clicked (only when the wheel is interactive). */
  protected onPointer(): void {
    if (this.interactive()) {
      this.pointerClick.emit();
    }
  }

  /** A click on a sector (only when the wheel is interactive). */
  protected onSlice(index: number): void {
    if (this.interactive()) {
      this.sectorClick.emit(index);
    }
  }

  /** The pointer color of the theme (or amber). */
  private pickPointer(): string {
    return this.theme()?.pointer ?? '#fbbf24';
  }

  /** The color of the rim lights (or amber). */
  private pickLight(): string {
    return this.theme()?.light ?? '#fbbf24';
  }

  /** The CSS transition of the disc. */
  private buildTransition(): string {
    return this.ms() ? 'transform ' + this.ms() + 'ms cubic-bezier(0.165, 0.84, 0.44, 1)' : 'none';
  }

  /** Draws the sectors from their weights. */
  private buildShapes(): Shape[] {
    const sectors = this.sectors();
    let total = 0;
    for (const sector of sectors) {
      total += sector.weight;
    }
    const shapes: Shape[] = [];
    let angle = 0;
    const size = Math.min(4.6, Math.max(2.7, 5 - sectors.length * 0.2));
    for (const sector of sectors) {
      const span = (sector.weight / total) * 360;
      const chord = 2 * 36 * Math.sin((span * Math.PI) / 360) * 0.72 - 1.3;
      const letters = Math.max(3, Math.floor(chord / (size * 0.66 + 0.33)));
      const upper = sector.label.toUpperCase();
      shapes.push({
        path: sectorPath(angle, angle + span),
        color: sector.color,
        label: upper.length > letters ? upper.slice(0, letters - 1) + '…' : upper,
        mid: angle + span / 2,
        text: isLightColor(sector.color) ? '#14141a' : '#ffffff',
        size,
      });
      angle += span;
    }
    return shapes;
  }

  /** Reacts to a new order. */
  private followOrder(): void {
    const order = this.order();
    if (!order || order.key === this.lastKey) {
      return;
    }
    untracked(this.obey.bind(this, order));
  }

  /** Turns (or jumps) to where the order says. */
  private obey(order: WheelOrder): void {
    this.lastKey = order.key;
    this.clearTimers();
    const wanted = 360 - order.land;
    const delta = (((wanted - this.turned) % 360) + 360) % 360;
    const travel = delta + (order.animate ? order.turns * 360 : 0);
    this.turned += travel;
    this.rotation.set(this.turned);
    if (!order.animate) {
      this.ms.set(0);
      this.spinning.set(false);
      return;
    }
    this.ms.set(order.ms);
    this.spinning.set(true);
    this.scheduleTicks(travel, order.ms);
    this.timers.push(setTimeout(this.finish.bind(this, order.key), order.ms));
  }

  /** One soft tick for every sector that goes by, slowing down like the wheel does. */
  private scheduleTicks(travel: number, ms: number): void {
    const step = 360 / Math.max(2, this.sectors().length);
    const count = Math.min(240, Math.floor(travel / step));
    for (let k = 1; k <= count; k++) {
      const fraction = (k * step) / travel;
      const at = ms * (1 - Math.pow(1 - fraction, 0.25));
      this.timers.push(setTimeout(this.tick.bind(this), at));
    }
  }

  /** One tick of the wheel. */
  private tick(): void {
    this.sound.slide(0.5);
  }

  /** The wheel stopped. */
  private finish(key: string): void {
    this.spinning.set(false);
    this.stopped.emit(key);
  }

  /** Forgets every pending tick and the end of the turn. */
  private clearTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
  }
}
