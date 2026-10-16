/**
 * src/app/features/spinly/spinly-call-panel.component.ts
 * The wheel or tournament of a call, shown right in the call screen. Everybody sees the same one, everybody can spin
 * it as many times as they like, edit it, start the tournament over or send the result to the chat, and every change
 * reaches everybody at once (end-to-end encrypted like the rest of the call).
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { DirectoryService } from '../../core/services/directory.service';
import { SpinlyService } from '../../core/services/spinly.service';
import { SpinlyLogoComponent } from '../../shared/components/spinly-logo.component';
import { IconComponent } from '../../shared/components/icon.component';
import { type TournamentSpec } from './spinly-model';
import { planWheel, podium, resolveTournament, type CallSpinState } from './spinly-engine';
import type { SpinlyResult } from './spinly-result';
import { SpinlyTournamentCardComponent } from './spinly-tournament-card.component';
import { SpinlyWheelCardComponent, type WheelRun } from './spinly-wheel-card.component';

/** The shared wheel or tournament of the call. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-spinly-call-panel',
  standalone: true,
  imports: [
    SpinlyLogoComponent,
    IconComponent,
    SpinlyTournamentCardComponent,
    SpinlyWheelCardComponent,
    TranslatePipe,
  ],
  template: `
    @if (state(); as current) {
      @if (current.activity; as activity) {
        <div
          class="sp-glow flex flex-col overflow-hidden"
          [class]="
            embedded()
              ? 'h-full'
              : 'anim-fade-up mx-3 mt-3 shrink-0 rounded-ui-lg border border-white/8 bg-black/25 md:mx-4'
          "
        >
          <div class="sp-head flex flex-wrap items-center gap-2 border-b border-white/8 px-3 py-2">
            <app-spinly-logo [size]="32" />
            <div class="min-w-0 flex-1 leading-tight">
              <div class="truncate text-sm font-semibold">
                {{ (activity.kind === 'wheel' ? 'Spinly wheel' : 'Spinly tournament') | t }}
                @if (title()) {
                  <span class="font-normal text-muted">· {{ title() }}</span>
                }
              </div>
              <div class="truncate text-[0.6875rem] text-muted">
                {{ 'Everybody in the call can spin, edit and play it.' | t }}
                @if (author(); as name) {
                  · {{ 'Last change by {name}' | t: { name } }}
                }
              </div>
            </div>
            @if (result(); as r) {
              <button type="button" class="btn btn-sm anim-pop" (click)="sendResult(r)">
                <app-icon name="send" [size]="14" /> {{ 'Send the result to the chat' | t }}
              </button>
            }
            <ng-content select="[actions]" />
            <button type="button" class="btn btn-sm" (click)="spinly.composeForCall()">
              <app-icon name="edit" [size]="14" /> {{ 'Edit' | t }}
            </button>
            <button
              type="button"
              class="btn btn-icon btn-sm"
              [attr.aria-label]="'Close' | t"
              (click)="spinly.closeInCall()"
            >
              <app-icon name="x" [size]="15" />
            </button>
          </div>
          <div
            class="flex flex-col overflow-y-auto p-3"
            [class]="embedded() ? 'min-h-0 flex-1' : 'max-h-[58dvh]'"
            [style.container-type]="embedded() ? 'size' : null"
          >
            <div class="m-auto w-full">
              @if (activity.kind === 'wheel') {
                <app-spinly-wheel-card
                  [spec]="activity.wheel"
                  [run]="wheelRun()"
                  [compact]="!embedded() || tight()"
                  [spaceSpins]="true"
                  (spinRequested)="spinly.spinInCall()"
                  (finished)="markReady()"
                />
              } @else {
                <app-spinly-tournament-card
                  [spec]="activity.tournament"
                  [spins]="current.spins"
                  [compact]="!embedded() || tight()"
                  [spaceSpins]="true"
                  mode="call"
                  (spinRequested)="spinly.spinInCall()"
                  (restartRequested)="spinly.restartInCall()"
                  (finished)="markReady()"
                />
              }
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class SpinlyCallPanelComponent implements OnInit {
  protected readonly spinly = inject(SpinlyService);
  private readonly directory = inject(DirectoryService);

  /** True when the panel fills a tile of the call instead of being a card of its own. */
  readonly embedded = input(false);
  /** True when the tile is short (a phone): the wheel is drawn smaller so it fits with its button. */
  readonly tight = input(false);
  /** What the call is spinning. */
  protected readonly state = this.spinly.callState;
  /** The spin shown, as the wheel card wants it. */
  protected readonly wheelRun = computed(this.buildWheelRun.bind(this));
  protected readonly title = computed(this.pickTitle.bind(this));
  protected readonly author = computed(this.pickAuthor.bind(this));
  /** The result that can be sent to the chat (only once it has been shown). */
  protected readonly result = computed(this.buildResult.bind(this));

  /** The identity of the spin that is on screen and finished. */
  private readonly readyKey = signal('');

  /** What was already there when the panel appeared counts as shown. */
  ngOnInit(): void {
    this.readyKey.set(this.currentKey());
  }

  /** Identity of what the call has now: it changes with every spin. */
  private currentKey(): string {
    const state = this.state();
    if (!state?.activity) {
      return '';
    }
    const last = state.spins[state.spins.length - 1];
    return state.activity.kind === 'wheel'
      ? 'w' + state.spinSeq + ':' + state.seed
      : 't' + state.spins.length + ':' + (last ? last.seed : 0) + ':' + state.rev;
  }

  /** A spin or tournament finished in front of the person. */
  protected markReady(): void {
    this.readyKey.set(this.currentKey());
  }

  /** The spin of the wheel, once spun. */
  private buildWheelRun(): WheelRun | null {
    const state = this.state();
    return state && state.spinSeq > 0
      ? { key: 'w' + state.spinSeq + ':' + state.seed, seed: state.seed }
      : null;
  }

  /** The title of the wheel or tournament. */
  private pickTitle(): string {
    const activity = this.state()?.activity;
    if (!activity) {
      return '';
    }
    return activity.kind === 'wheel' ? activity.wheel.title : activity.tournament.title;
  }

  /** Name of whoever changed it last (when it was not the person). */
  private pickAuthor(): string | null {
    const state = this.state();
    return state ? (this.directory.get(state.by)?.displayName ?? null) : null;
  }

  /** The result of the wheel or tournament, as a chat card, once it is on screen. */
  private buildResult(): SpinlyResult | null {
    const state: CallSpinState | null = this.state();
    const activity = state?.activity;
    if (!state || !activity || this.readyKey() !== this.currentKey()) {
      return null;
    }
    if (activity.kind === 'wheel') {
      if (state.spinSeq === 0) {
        return null;
      }
      const names = activity.wheel.options.map(function nameOf(option) {
        return option.name;
      });
      const winner = names[planWheel(names.length, state.seed).index];
      return { kind: 'wheel', title: activity.wheel.title, names, winner };
    }
    const spec: TournamentSpec = activity.tournament;
    const names = podium(resolveTournament(spec, state.spins));
    return names.length ? { kind: 'tournament', title: spec.title, names, winner: names[0] } : null;
  }

  /** Posts the result in the chat of the call. */
  protected sendResult(result: SpinlyResult): void {
    this.spinly.sendCallResult(result);
    this.readyKey.set('');
  }
}
