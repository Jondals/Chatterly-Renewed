/**
 * src/app/features/spinly/spinly-message.component.ts
 * A wheel or a tournament inside a chat message, like a poll: anyone in the conversation can run it, only once. The
 * run is a hidden reaction on the message, so it reaches everybody at the same moment and the server's random id of
 * it decides the result for all. After that the result stays in the message and nothing can be spun again.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { DirectoryService } from '../../core/services/directory.service';
import { ToastService } from '../../core/services/toast.service';
import { IconComponent } from '../../shared/components/icon.component';
import { describeError } from '../../shared/util/errors';
import { MessageStore, type ViewMessage } from '../../store/message.store';
import { RUN_MARK } from './spinly-model';
import { autoSpins, hashSeed, type TournamentSpin } from './spinly-engine';
import { SpinlyTournamentCardComponent } from './spinly-tournament-card.component';
import { SpinlyWheelCardComponent, type WheelRun } from './spinly-wheel-card.component';

/** The card of a wheel or tournament message. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-spinly-message',
  standalone: true,
  imports: [IconComponent, SpinlyTournamentCardComponent, SpinlyWheelCardComponent, TranslatePipe],
  template: `
    @if (message().activity; as activity) {
      <div
        class="anim-fade-up mt-1 w-[min(24rem,calc(100vw-7rem))] overflow-hidden rounded-ui-lg border border-accent/25 bg-ink-850/80 shadow-[0_10px_30px_-14px_var(--accent)]"
      >
        <div
          class="sp-head flex items-center gap-2 border-b border-accent/20 px-3 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-accent"
        >
          <app-icon [name]="activity.kind === 'wheel' ? 'wheel' : 'trophy'" [size]="14" />
          {{ (activity.kind === 'wheel' ? 'Spinly wheel' : 'Spinly tournament') | t }}
          @if (title()) {
            <span class="truncate normal-case tracking-normal text-muted">· {{ title() }}</span>
          }
        </div>
        <div class="p-3">
          @if (activity.kind === 'wheel') {
            <app-spinly-wheel-card
              [spec]="activity.wheel"
              [run]="wheelRun()"
              [canSpin]="canRun()"
              (spinRequested)="run()"
            />
          } @else {
            <app-spinly-tournament-card
              [spec]="activity.tournament"
              [spins]="spins()"
              mode="chat"
              (startRequested)="run()"
            />
          }
          @if (runner(); as name) {
            <div class="mt-2 text-center text-[0.6875rem] text-muted">
              {{ 'Spun by {name}' | t: { name } }}
            </div>
          } @else if (!canRun() && !message().pending) {
            <div class="mt-2 text-center text-[0.6875rem] text-muted">
              {{ 'Starting…' | t }}
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class SpinlyMessageComponent {
  private readonly store = inject(MessageStore);
  private readonly directory = inject(DirectoryService);
  private readonly toast = inject(ToastService);

  /** The message that carries the wheel or tournament. */
  readonly message = input.required<ViewMessage>();

  /** True from the press until the run reaches the message. */
  private readonly busy = signal(false);

  /** The hidden reaction that ran it, if somebody did. */
  private readonly runReaction = computed(this.findRun.bind(this));
  protected readonly title = computed(this.pickTitle.bind(this));
  protected readonly wheelRun = computed(this.buildWheelRun.bind(this));
  protected readonly spins = computed(this.buildSpins.bind(this));
  protected readonly runner = computed(this.pickRunner.bind(this));
  protected readonly canRun = computed(this.isRunnable.bind(this));

  /** The first run of the message. */
  private findRun(): { id: string; userId: string } | null {
    const found = this.message().reactionItems.find(function isRun(item) {
      return item.emoji === RUN_MARK;
    });
    return found ? { id: found.id, userId: found.userId } : null;
  }

  /** Seed of the run: it comes from the id the server gave the reaction, which nobody can choose beforehand. */
  private seedOf(run: { id: string }): number {
    return hashSeed(run.id + ':' + this.message().id);
  }

  /** The title of the wheel or tournament. */
  private pickTitle(): string {
    const activity = this.message().activity;
    if (!activity) {
      return '';
    }
    return activity.kind === 'wheel' ? activity.wheel.title : activity.tournament.title;
  }

  /** The spin of the wheel, once run. */
  private buildWheelRun(): WheelRun | null {
    const run = this.runReaction();
    return run ? { key: run.id, seed: this.seedOf(run) } : null;
  }

  /** Every spin of the tournament, once run. */
  private buildSpins(): TournamentSpin[] {
    const run = this.runReaction();
    const activity = this.message().activity;
    if (!run || activity?.kind !== 'tournament') {
      return [];
    }
    return autoSpins(activity.tournament, this.seedOf(run));
  }

  /** Name of whoever ran it. */
  private pickRunner(): string | null {
    const run = this.runReaction();
    return run ? (this.directory.get(run.userId)?.displayName ?? '…') : null;
  }

  /** Whether it can still be run from here. */
  private isRunnable(): boolean {
    const message = this.message();
    return !this.runReaction() && !this.busy() && !message.pending && !message.failed;
  }

  /** Runs it, for everybody in the conversation. */
  protected run(): void {
    if (!this.isRunnable()) {
      return;
    }
    this.busy.set(true);
    this.store.runSpinly(this.message()).catch(this.onFailed.bind(this));
  }

  /** The run could not be sent. */
  private onFailed(error: unknown): void {
    this.busy.set(false);
    this.toast.error('Could not send the result', describeError(error));
  }
}
