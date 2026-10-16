/**
 * src/app/shared/components/step-slider.component.ts
 * A slider whose steps have names written under it. Each name sits exactly under the place where the thumb stops (the
 * thumb never reaches the very edge of the bar, so the names are inset by half of it), and the first and the last name
 * line up with the edges instead of hanging out of the box.
 */
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';

/** A name under the slider, at the place of one value. */
export interface StepLabel {
  at: number;
  text: string;
}

/** A range input with labels under its steps. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-step-slider',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <input
      type="range"
      class="step-slider-input w-full accent-[var(--accent)]"
      [min]="min()"
      [max]="max()"
      [step]="step()"
      [value]="value()"
      [attr.aria-label]="label() | t"
      (input)="valueChange.emit(+$any($event.target).value)"
      (change)="committed.emit(+$any($event.target).value)"
    />
    <div class="step-slider-labels" aria-hidden="true">
      @for (item of labels(); track item.at) {
        <span
          class="step-slider-label"
          [class.is-on]="item.at === value()"
          [class.is-first]="item.at === min()"
          [class.is-last]="item.at === max()"
          [style.--p]="(item.at - min()) / (max() - min())"
          >{{ item.text | t }}</span
        >
      }
    </div>
  `,
  host: { class: 'block w-72 max-w-full' },
  styles: `
    .step-slider-labels {
      position: relative;
      height: 1.1rem;
      margin-top: 0.15rem;
    }
    .step-slider-label {
      position: absolute;
      top: 0;
      left: calc(8px + (100% - 16px) * var(--p));
      transform: translateX(-50%);
      font-size: 0.65625rem;
      line-height: 1;
      color: var(--dim);
      white-space: nowrap;
      transition: color 0.25s var(--ease-suave);
    }
    .step-slider-label.is-first {
      transform: translateX(-8px);
    }
    .step-slider-label.is-last {
      transform: translateX(calc(-100% + 8px));
    }
    .step-slider-label.is-on {
      color: var(--accent);
      font-weight: 700;
    }
  `,
})
export class StepSliderComponent {
  readonly min = input(0);
  readonly max = input.required<number>();
  readonly step = input(1);
  readonly value = input.required<number>();
  readonly labels = input<StepLabel[]>([]);
  /** The name of the slider for screen readers. */
  readonly label = input.required<string>();
  /** The value moves while the thumb is dragged. */
  readonly valueChange = output<number>();
  /** The thumb is let go (or a key makes a final change). */
  readonly committed = output<number>();
}
