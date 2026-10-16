/**
 * src/app/features/spinly/spinly-wheel-card.component.ts
 * A prize wheel with its spin button and its result. It does not know where the spin comes from: whoever uses it
 * (a chat message or the call) hands it the spin to show, and it turns the same way for everybody because the
 * landing point comes from the shared seed. A spin that was already there when the card appeared is shown as a
 * finished result; one that arrives afterwards is played.
 */
import { Component, computed, inject, input, output, signal, type OnInit } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { SoundService } from '../../core/services/sound.service';
import { IconComponent } from '../../shared/components/icon.component';
import { type WheelSpec } from './spinly-model';
import { planWheel, sectorColor } from './spinly-engine';
import { SpinlyWheelComponent, type WheelOrder, type WheelSector } from './spinly-wheel.component';
import { listenWhile } from '../../shared/util/listen-while';

/** How long a spin of the wheel lasts (ms). */
const SPIN_MS = 4200;

/** True when the key press belongs to a text field, a button or a window, not to the wheel. */
export function isTypingOrBlocked(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (target && target.closest('input, textarea, select, [contenteditable="true"]')) {
    return true;
  }
  // A window that is open blocks the key, unless the wheel or the tournament lives in that very window.
  for (const dialog of Array.from(
    document.querySelectorAll('[role=dialog], [popover]:popover-open'),
  )) {
    if (dialog.classList.contains('cursor-overlay') || dialog.tagName === 'CANVAS') {
      continue;
    }
    if (!dialog.querySelector('app-spinly-wheel-card, app-spinly-tournament-card')) {
      return true;
    }
  }
  return false;
}

/** A spin to show: its identity and the seed that decides it. */
export interface WheelRun {
  key: string;
  seed: number;
}

/** The wheel of a chat message or of the call. */
@Component({
  selector: 'app-spinly-wheel-card',
  standalone: true,
  imports: [IconComponent, SpinlyWheelComponent, TranslatePipe],
  template: `
    <div
      class="mx-auto w-full pt-2"
      [style.max-width]="'min(' + (compact() ? '17rem' : '21rem') + ', max(8rem, 100cqh - 7.5rem))'"
    >
      <app-spinly-wheel
        [sectors]="sectors()"
        [theme]="spec().theme"
        [order]="order()"
        [highlight]="shownWinner()"
        (stopped)="onStopped($event)"
      />
      <div class="mt-1 flex min-h-[4.75rem] flex-col items-center justify-center gap-1.5">
        @if (shownWinner() !== null) {
          <div class="anim-pop text-center">
            <div class="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
              {{ 'The wheel says' | t }}
            </div>
            <div class="break-words text-xl font-black leading-tight text-accent">
              {{ winnerName() }}
            </div>
          </div>
        }
        @if (canSpin() && !spinning()) {
          <button type="button" class="btn btn-primary w-full" (click)="spinRequested.emit()">
            <app-icon name="spin" [size]="16" />
            {{ (shownWinner() === null ? 'Spin the wheel' : 'Spin again') | t }}
          </button>
        } @else if (spinning()) {
          <div class="text-sm font-semibold text-muted">{{ 'Spinning…' | t }}</div>
        }
      </div>
    </div>
  `,
})
export class SpinlyWheelCardComponent implements OnInit {
  private readonly sound = inject(SoundService);

  /** The wheel to draw. */
  readonly spec = input.required<WheelSpec>();
  /** The spin to show, or null when nobody has spun yet. */
  readonly run = input<WheelRun | null>(null);
  /** Whether the person may start a spin from here. */
  readonly canSpin = input(true);
  /** A smaller wheel (the call). */
  readonly compact = input(false);
  /** True when the space bar spins this wheel (the one of the call). */
  readonly spaceSpins = input(false);
  /** Asks for a spin. */
  readonly spinRequested = output<void>();
  /** Emits the winner when a played spin stops. */
  readonly finished = output<string>();

  /** The spin that was there when the card appeared (shown as a result, not played). */
  private initialKey: string | null = null;
  /** The last played spin that stopped. */
  private readonly stoppedKey = signal<string | null>(null);

  protected readonly sectors = computed(this.buildSectors.bind(this));
  private readonly plan = computed(this.buildPlan.bind(this));
  protected readonly order = computed(this.buildOrder.bind(this));
  protected readonly spinning = computed(this.isSpinning.bind(this));
  /** Index of the winning sector once the wheel has stopped. */
  protected readonly shownWinner = computed(this.pickShownWinner.bind(this));
  protected readonly winnerName = computed(this.pickWinnerName.bind(this));

  /** The space bar asks for a spin, unless the person is typing or a window is open. */
  /** Only the cards that can be spun with the space bar listen to the keyboard (not every card of the history). */
  private readonly spaceKey = listenWhile(
    this.listensForSpace.bind(this),
    window,
    'keydown',
    this.onSpace.bind(this) as (event: Event) => void,
  );

  /** Whether this card spins with the space bar now. */
  private listensForSpace(): boolean {
    return this.spaceSpins() && this.canSpin();
  }

  protected onSpace(event: KeyboardEvent): void {
    if (event.code !== 'Space') {
      return;
    }
    if (!this.spaceSpins() || !this.canSpin() || this.spinning() || isTypingOrBlocked(event)) {
      return;
    }
    event.preventDefault();
    (event.target as HTMLElement | null)?.blur?.();
    this.spinRequested.emit();
  }

  /** Remembers the spin that was already there (inputs are not set yet when the card is built). */
  ngOnInit(): void {
    this.initialKey = this.run()?.key ?? null;
  }

  /** The sectors of the wheel, all the same size. */
  private buildSectors(): WheelSector[] {
    const spec = this.spec();
    return spec.options.map(function toSector(option, index): WheelSector {
      return { label: option.name, color: sectorColor(option, index, spec.theme), weight: 1 };
    });
  }

  /** Where the current spin ends. */
  private buildPlan(): ReturnType<typeof planWheel> | null {
    const run = this.run();
    return run ? planWheel(this.spec().options.length, run.seed) : null;
  }

  /** The order the wheel obeys: turn for a new spin, just sit at the result for an old one. */
  private buildOrder(): WheelOrder | null {
    const run = this.run();
    const plan = this.plan();
    if (!run || !plan) {
      return null;
    }
    return {
      key: run.key,
      land: plan.land,
      turns: plan.turns,
      ms: SPIN_MS,
      animate: run.key !== this.initialKey,
    };
  }

  /** True while a played spin has not stopped yet. */
  private isSpinning(): boolean {
    const run = this.run();
    return !!run && run.key !== this.initialKey && this.stoppedKey() !== run.key;
  }

  /** The winning sector, once the wheel has stopped (at once for a spin that was already there). */
  private pickShownWinner(): number | null {
    const plan = this.plan();
    return plan && !this.spinning() ? plan.index : null;
  }

  /** The name of the winner. */
  private pickWinnerName(): string {
    const index = this.shownWinner();
    return index === null ? '' : (this.spec().options[index]?.name ?? '');
  }

  /** The wheel stopped: celebrate and tell the owner. */
  protected onStopped(key: string): void {
    if (this.run()?.key !== key) {
      return;
    }
    this.stoppedKey.set(key);
    this.sound.play('success');
    this.finished.emit(this.winnerName());
  }
}
