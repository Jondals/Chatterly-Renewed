/**
 * src/app/shared/components/gradient-controls.component.ts
 * The controls of a gradient: ONE bar that shows the gradient and, when the person asks for more options, becomes the
 * editor (a marker for each color, up to five, which can be chosen and dragged along it), with the color of the chosen
 * marker, its place, the buttons to add or remove colors, and the angle.
 */
import { Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { gradientCss, sortedStops, type GradientParts, type Stop } from '../util/gradient';
import { ColorPickerComponent } from './color-picker.component';
import { IconComponent } from './icon.component';

/** Edits the colors and the angle of a gradient and reports every change. */
@Component({
  selector: 'app-gradient-controls',
  standalone: true,
  imports: [ColorPickerComponent, IconComponent, TranslatePipe],
  template: `
    <div [class]="compact() ? 'flex items-center gap-2' : 'space-y-3'">
      <div [class]="compact() ? 'contents' : 'flex items-center gap-3'">
        <!-- The only bar: it shows the gradient, and with more options open its markers can be moved -->
        <div
          #bar
          class="gbar min-w-0 flex-1"
          [class.is-editing]="open() || compact()"
          [style.background]="css()"
          (pointermove)="drag($event, bar)"
          (pointerup)="drop($event)"
          (pointercancel)="drop($event)"
        >
          @if (open() || compact()) {
            @for (stop of parts().stops; track $index) {
              <button
                type="button"
                class="gstop anim-fade-in"
                [class.is-on]="selected() === $index"
                [style.left.%]="stop.pos"
                [style.background]="stop.color"
                [attr.aria-label]="stop.color"
                (pointerdown)="grab($event, $index)"
              ></button>
            }
          }
        </div>
        @if (!compact()) {
          <button
            type="button"
            class="btn btn-sm shrink-0"
            [attr.aria-expanded]="open()"
            (click)="open.set(!open())"
          >
            <app-icon name="settings" [size]="13" />
            {{ (open() ? 'Fewer options' : 'More options') | t }}
          </button>
        }
      </div>
      @if (compact()) {
        <app-color-picker
          [value]="current().color"
          [size]="24"
          shape="round"
          label="Color"
          (valueChange)="setColor($event)"
        />
        <button
          type="button"
          class="btn btn-icon btn-sm btn-soft-danger gbtn"
          [class.is-off]="parts().stops.length <= 2"
          [disabled]="parts().stops.length <= 2"
          [attr.aria-label]="'Remove this color' | t"
          [attr.title]="'Remove this color' | t"
          (click)="remove()"
        >
          <app-icon name="minus" [size]="13" />
        </button>
        <button
          type="button"
          class="btn btn-icon btn-sm gbtn"
          [class.is-off]="parts().stops.length >= 5"
          [disabled]="parts().stops.length >= 5"
          [attr.aria-label]="'Add a color' | t"
          [attr.title]="'Add a color' | t"
          (click)="add()"
        >
          <app-icon name="plus" [size]="13" />
        </button>
      }
      @if (!compact()) {
        <div class="gfold" [class.open]="open()" [attr.inert]="open() ? null : ''">
          <div class="gfold-inner">
            <div class="gpanel">
              <div class="flex items-center gap-2.5">
                <app-color-picker
                  [value]="current().color"
                  [size]="34"
                  label="Color"
                  (valueChange)="setColor($event)"
                />
                <span class="gchip font-mono">{{ current().color }}</span>
                @if (showPosition()) {
                  <span class="gchip font-mono">{{ current().pos }}%</span>
                }
                <span class="flex-1"></span>
                <button
                  type="button"
                  class="btn btn-sm btn-icon btn-soft-danger gbtn"
                  [class.is-off]="parts().stops.length <= 2"
                  [disabled]="parts().stops.length <= 2"
                  [attr.aria-label]="'Remove this color' | t"
                  [attr.title]="'Remove this color' | t"
                  (click)="remove()"
                >
                  <app-icon name="minus" [size]="14" />
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-icon gbtn"
                  [class.is-off]="parts().stops.length >= 5"
                  [disabled]="parts().stops.length >= 5"
                  [attr.aria-label]="'Add a color' | t"
                  [attr.title]="'Add a color' | t"
                  (click)="add()"
                >
                  <app-icon name="plus" [size]="14" />
                </button>
              </div>
              @if (showAngle()) {
                <label class="block text-xs text-muted"
                  >{{ 'Angle' | t }} <b class="float-right text-fg">{{ parts().angle }}°</b>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    class="mt-1.5 w-full accent-[var(--accent)]"
                    [value]="parts().angle"
                    (input)="changed.emit({ angle: +$any($event.target).value })"
                /></label>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .gbar {
      position: relative;
      height: 0.5rem;
      margin: 0.7rem 1rem;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
      touch-action: none;
      transition: height 0.18s ease;
    }
    .gbar.is-editing {
      height: 0.625rem;
    }
    .gstop {
      position: absolute;
      top: 50%;
      width: 1.15rem;
      height: 1.15rem;
      margin: -0.575rem 0 0 -0.575rem;
      border-radius: 999px;
      border: 3px solid #fff;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.55),
        0 2px 6px rgba(0, 0, 0, 0.45);
      cursor: var(--cur-grab, grab);
    }
    .gstop.is-on {
      width: 1.45rem;
      height: 1.45rem;
      margin: -0.725rem 0 0 -0.725rem;
      border-color: var(--accent);
      z-index: 1;
    }
    .gfold {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.4s var(--ease, cubic-bezier(0.22, 1, 0.36, 1));
    }
    .gfold.open {
      grid-template-rows: 1fr;
    }
    .gfold-inner {
      min-height: 0;
      overflow: hidden;
      opacity: 0;
      transition: opacity 0.28s ease;
    }
    .open > .gfold-inner {
      opacity: 1;
      transition-delay: 0.08s;
    }
    .gpanel {
      display: grid;
      gap: 0.85rem;
      padding-top: 0.85rem;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    /* The add and remove buttons keep their place: when one does not apply it is dimmed and cannot be pressed. */
    .gbtn {
      transition:
        opacity 0.3s var(--ease),
        transform 0.3s var(--ease),
        background-color 0.2s var(--ease-suave);
    }
    .gbtn.is-off {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .gchip {
      padding: 0.25rem 0.55rem;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.06);
      font-size: 0.72rem;
      color: var(--muted, #9aa3b5);
    }
  `,
})
export class GradientControlsComponent {
  readonly parts = input.required<GradientParts>();
  /** Show the angle slider (a gradient on text has no angle). */
  readonly showAngle = input(true);
  /** Show the place of the chosen color (where colors have no place of their own, only their order counts). */
  readonly showPosition = input(true);
  /** One single row: the bar with its markers, the color of the marker, and the buttons to add or remove one. */
  readonly compact = input(false);
  readonly changed = output<Partial<GradientParts>>();
  protected readonly open = signal(false);
  protected readonly selected = signal(0);
  private dragging = -1;

  /** The gradient as CSS (a straight bar for the preview). */
  protected css(): string {
    return gradientCss({ angle: 90, stops: this.parts().stops });
  }

  /** The chosen color. */
  protected current(): Stop {
    const stops = this.parts().stops;
    return stops[Math.min(this.selected(), stops.length - 1)]!;
  }

  /** The press on a marker chooses it and starts moving it. */
  protected grab(event: PointerEvent, index: number): void {
    this.selected.set(index);
    this.dragging = index;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  /** The marker follows the pointer along the bar. */
  protected drag(event: PointerEvent, bar: HTMLElement): void {
    if (this.dragging < 0) {
      return;
    }
    const box = bar.getBoundingClientRect();
    const pos = Math.round(
      Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)),
    );
    this.update(this.dragging, { pos });
  }

  /** The marker is let go. */
  protected drop(event: PointerEvent): void {
    this.dragging = -1;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /** Changes the color of the chosen marker. */
  protected setColor(color: string): void {
    this.update(this.selected(), { color });
  }

  /** Adds a color in the widest gap of the line. */
  protected add(): void {
    const sorted = sortedStops(this.parts().stops);
    let at = 50;
    let color = sorted[0]!.color;
    let widest = -1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1]!.pos - sorted[i]!.pos;
      if (gap > widest) {
        widest = gap;
        at = Math.round((sorted[i + 1]!.pos + sorted[i]!.pos) / 2);
        color = sorted[i]!.color;
      }
    }
    const stops = [...this.parts().stops, { color, pos: at }];
    this.selected.set(stops.length - 1);
    this.changed.emit({ stops });
  }

  /** Removes the chosen color (there are always at least two). */
  protected remove(): void {
    const stops = this.parts().stops.filter(this.keep.bind(this));
    this.selected.set(0);
    this.changed.emit({ stops });
  }

  /** Every marker but the chosen one stays. */
  private keep(_stop: Stop, index: number): boolean {
    return index !== this.selected();
  }

  /** Replaces part of one stop. */
  private update(index: number, change: Partial<Stop>): void {
    const stops = this.parts().stops.map(function edit(stop, i) {
      return i === index ? { ...stop, ...change } : stop;
    });
    this.changed.emit({ stops });
  }
}
