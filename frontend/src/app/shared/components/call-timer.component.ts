/**
 * src/app/shared/components/call-timer.component.ts
 * How long the call has lasted, as a small indicator whose color follows the time: green at first, yellow after a quarter of an
 * hour, orange after an hour and red after two (the notification of the Android app uses the same steps). The color moves
 * smoothly between steps, so a long call can be felt at a glance.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CallService } from '../../core/services/call.service';

/** Where each color starts, in minutes, and its hue (HSL): green, yellow, orange, red. */
const STEPS: [number, number][] = [
  [0, 160],
  [15, 48],
  [60, 28],
  [120, 2],
];

/** The hue for a time (it moves in a straight line between the steps). */
export function timerHue(minutes: number): number {
  for (let i = STEPS.length - 1; i >= 0; i--) {
    const [from, hue] = STEPS[i]!;
    if (minutes >= from) {
      const next = STEPS[i + 1];
      if (!next) return hue;
      const share = (minutes - from) / (next[0] - from);
      return hue + (next[1] - hue) * share;
    }
  }
  return STEPS[0]![1];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-call-timer',
  standalone: true,
  host: {
    class: 'inline-flex items-center gap-1.5 font-mono text-xs font-semibold tabular-nums',
    '[style.color]': 'color()',
    '[attr.aria-label]': 'text()',
  },
  template: `<span class="h-1.5 w-1.5 rounded-full bg-current"></span>{{ text() }}`,
})
export class CallTimerComponent {
  private readonly call = inject(CallService);
  private readonly now = signal(Date.now());

  constructor() {
    const tick = setInterval(this.tick.bind(this), 1000);
    inject(DestroyRef).onDestroy(clearInterval.bind(null, tick));
  }

  private tick(): void {
    this.now.set(Date.now());
  }

  private readonly seconds = computed(
    function (this: CallTimerComponent) {
      const since = this.call.connectedSince();
      return since ? Math.max(0, Math.floor((this.now() - since) / 1000)) : 0;
    }.bind(this),
  );

  protected readonly text = computed(
    function (this: CallTimerComponent) {
      const total = this.seconds();
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const two = function pad(n: number): string {
        return String(n).padStart(2, '0');
      };
      return h > 0 ? h + ':' + two(m) + ':' + two(s) : two(m) + ':' + two(s);
    }.bind(this),
  );

  protected readonly color = computed(
    function (this: CallTimerComponent) {
      return 'hsl(' + Math.round(timerHue(this.seconds() / 60)) + ' 85% 62%)';
    }.bind(this),
  );
}
