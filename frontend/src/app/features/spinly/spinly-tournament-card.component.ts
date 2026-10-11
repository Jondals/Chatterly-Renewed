/**
 * src/app/features/spinly/spinly-tournament-card.component.ts
 * A knockout tournament decided by wheel duels: the duel being played, the bracket and the champion. Like the
 * prize wheel card it only shows what it is given: the list of spins decides everything, and a spin that arrives
 * after the card appeared is played on the duel wheel while the ones that were already there are just shown.
 */
import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  type OnInit,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { SoundService } from '../../core/services/sound.service';
import { IconComponent } from '../../shared/components/icon.component';
import { type TournamentSpec } from './spinly-model';
import {
  podium,
  resolveTournament,
  roundName,
  sectorColor,
  type Match,
  type TournamentSpin,
} from './spinly-engine';
import { SpinlyWheelComponent, type WheelOrder, type WheelSector } from './spinly-wheel.component';
import { isTypingOrBlocked } from './spinly-wheel-card.component';

/** Pause after a spin stops before the next one starts (ms). */
const PAUSE_MS = 900;

/** The tournament of a chat message or of the call. */
@Component({
  selector: 'app-spinly-tournament-card',
  standalone: true,
  imports: [IconComponent, SpinlyWheelComponent, TranslatePipe],
  styles: `
    .tour-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
    }
    .tour-round {
      padding: 0.1rem 0 0.1rem 0.7rem;
      border-left: 2px solid var(--accent);
      font-size: 0.7rem;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--fg);
    }
    .tour-bo {
      font-size: 0.7rem;
      color: var(--muted);
    }
    .tour-progress {
      display: flex;
      flex: 1;
      gap: 3px;
      min-width: 4rem;
    }
    .tour-progress i {
      height: 2px;
      flex: 1;
      background: rgba(255, 255, 255, 0.14);
      transition: background-color 0.4s var(--ease-suave);
    }
    .tour-progress i.is-done {
      background: var(--accent);
    }
    .tour-progress i.is-now {
      background: color-mix(in oklab, var(--accent) 45%, transparent);
    }
    .tour-versus {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 0;
    }
    .tour-side {
      position: relative;
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 0.6rem;
      padding: 0.7rem 1.6rem 0.7rem 0.8rem;
      overflow: hidden;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-top: 2px solid var(--side);
      background: linear-gradient(
        180deg,
        color-mix(in oklab, var(--side) 9%, var(--ink-850)),
        color-mix(in oklab, var(--ink-900) 96%, transparent)
      );
      transition:
        border-color 0.4s var(--ease-suave),
        box-shadow 0.4s var(--ease-suave);
    }
    .tour-side.right {
      flex-direction: row-reverse;
      padding: 0.7rem 0.8rem 0.7rem 1.6rem;
      text-align: right;
    }
    .tour-side.is-lead {
      border-color: color-mix(in oklab, var(--side) 45%, transparent);
      border-top-width: 3px;
      box-shadow: 0 10px 24px -16px var(--side);
    }
    .tour-disc {
      display: grid;
      width: 2.4rem;
      height: 2.4rem;
      flex-shrink: 0;
      place-items: center;
      border-radius: 3px;
      background: var(--side);
      color: #07090f;
      font-size: 1.05rem;
      font-weight: 900;
    }
    .tour-info {
      display: flex;
      min-width: 0;
      flex: 1;
      flex-direction: column;
      gap: 0.3rem;
    }
    .tour-side.right .tour-info {
      align-items: flex-end;
    }
    .tour-name {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .tour-pips {
      display: flex;
      gap: 4px;
    }
    .tour-pips i {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 1px;
      transform: rotate(45deg);
      border: 1.5px solid color-mix(in oklab, var(--side) 70%, transparent);
      transition:
        background-color 0.3s var(--ease-suave),
        transform 0.3s var(--ease);
    }
    .tour-pips i.is-on {
      background: var(--side);
      transform: rotate(45deg) scale(1.1);
    }
    /* the score sits between the two sides, a little over both */
    .tour-score {
      z-index: 1;
      display: grid;
      min-width: 4.4rem;
      margin: 0 -1.1rem;
      padding: 0.5rem 0.8rem;
      place-items: center;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: var(--ink-900);
      box-shadow: 0 10px 24px -12px #000;
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      font-variant-numeric: tabular-nums;
    }
    /* in a narrow card (the chat) the score goes on top and the two sides below it, one at each side */
    @container (max-width: 27rem) {
      .tour-versus {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.5rem;
      }
      .tour-score {
        grid-column: 1 / -1;
        grid-row: 1;
        margin: 0 auto;
      }
      .tour-side,
      .tour-side.right {
        grid-row: 2;
        flex-direction: column;
        padding: 0.65rem 0.5rem;
        text-align: center;
      }
      .tour-info,
      .tour-side.right .tour-info {
        align-items: center;
      }
    }
    .tour-match {
      position: relative;
      border-radius: 3px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      background: color-mix(in oklab, var(--ink-850) 85%, transparent);
      font-size: 0.75rem;
    }
    /* Lines that join a match to the next round, so the bracket reads from left to right. */
    .bracket-col:not(:last-child) .tour-match::after {
      content: '';
      position: absolute;
      top: 50%;
      right: -0.8rem;
      width: 0.8rem;
      border-top: 1px solid rgba(255, 255, 255, 0.22);
    }
    .bracket-col:not(:first-child) .tour-match::before {
      content: '';
      position: absolute;
      top: 50%;
      left: -0.8rem;
      width: 0.8rem;
      border-top: 1px solid rgba(255, 255, 255, 0.22);
    }
    .bracket-title {
      align-self: center;
      padding: 0.15rem 0.1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.22);
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .tour-match.is-now {
      border-color: color-mix(in oklab, var(--accent) 55%, transparent);
      border-left: 2px solid var(--accent);
      background: color-mix(in oklab, var(--accent) 8%, transparent);
    }
    .tour-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.3rem 0.5rem;
    }
    .tour-row:first-child {
      border-radius: 3px 3px 0 0;
    }
    .tour-row:last-child {
      border-radius: 0 0 3px 3px;
    }
    .tour-row + .tour-row {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .tour-row.is-win {
      font-weight: 800;
      color: var(--accent);
      background: color-mix(in oklab, var(--accent) 10%, transparent);
    }
    .tour-row.is-win::after {
      content: '✓';
      font-size: 0.7rem;
    }
    .tour-row.is-out {
      color: var(--muted);
      opacity: 0.6;
    }
    .tour-row-dot {
      width: 0.45rem;
      height: 0.45rem;
      flex-shrink: 0;
      border-radius: 1px;
    }
    .tour-champion {
      position: relative;
      overflow: hidden;
      padding: 1.4rem 1rem 1.1rem;
      text-align: center;
      border-radius: 5px;
      border: 1px solid color-mix(in oklab, var(--side) 45%, transparent);
      background:
        radial-gradient(
          ellipse at 50% 0%,
          color-mix(in oklab, var(--side) 30%, transparent),
          transparent 70%
        ),
        rgba(0, 0, 0, 0.25);
    }
    .tour-trophy {
      display: inline-grid;
      width: 4.2rem;
      height: 4.2rem;
      place-items: center;
      border-radius: 50%;
      color: #fbbf24;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.25), transparent 70%);
      filter: drop-shadow(0 0 14px rgba(251, 191, 36, 0.55));
    }
    .tour-badge {
      margin-top: 0.3rem;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .tour-champion-name {
      margin-top: 0.15rem;
      overflow-wrap: anywhere;
      font-size: 1.9rem;
      font-weight: 900;
      line-height: 1.1;
      color: var(--side);
      text-shadow: 0 0 28px color-mix(in oklab, var(--side) 55%, transparent);
    }
    .tour-podium {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.4rem;
      margin-top: 0.8rem;
      font-size: 0.78rem;
    }
    .tour-podium li {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.2rem 0.65rem 0.2rem 0.25rem;
      border-radius: 3px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(0, 0, 0, 0.25);
    }
    .tour-podium b {
      display: grid;
      width: 1.3rem;
      height: 1.3rem;
      place-items: center;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.14);
      font-size: 0.7rem;
    }
    .tour-confetti {
      pointer-events: none;
      position: absolute;
      inset: 0;
      overflow: hidden;
    }
    .tour-confetti i {
      position: absolute;
      top: -10%;
      width: 6px;
      height: 10px;
      border-radius: 1px;
      opacity: 0;
      animation: tour-fall 2.6s ease-in forwards;
    }
    @keyframes tour-fall {
      0% {
        opacity: 1;
        transform: translate3d(0, 0, 0) rotate(0);
      }
      100% {
        opacity: 0;
        transform: translate3d(var(--drift), 280px, 0) rotate(540deg);
      }
    }
  `,
  template: `
    <div class="@container">
      <div
        class="space-y-3"
        [class]="
          view().bracket.champion || mode() === 'chat'
            ? 'mx-auto max-w-md'
            : '@3xl:grid @3xl:grid-cols-2 @3xl:items-center @3xl:gap-8 @3xl:space-y-0'
        "
      >
        <div class="min-w-0 space-y-3">
          @if (view().bracket.champion) {
            <div class="tour-champion anim-pop" [style.--side]="championColor()">
              <span class="tour-confetti" aria-hidden="true">
                @for (piece of confetti; track $index) {
                  <i
                    [style.left]="piece.left"
                    [style.animation-delay]="piece.delay"
                    [style.--drift]="piece.drift"
                    [style.background]="piece.color"
                  ></i>
                }
              </span>
              <span class="tour-trophy"><app-icon name="trophy" [size]="40" /></span>
              <div class="tour-badge">{{ 'Champion' | t }}</div>
              <div class="tour-champion-name">{{ names()[0] }}</div>
              <div class="mt-1 text-[0.6875rem] text-muted">
                {{
                  '{n} participants · {d} duels'
                    | t: { n: view().participants.length, d: playedDuels() }
                }}
              </div>
              @if (names().length > 1) {
                <ol class="tour-podium">
                  @for (name of names().slice(1); track $index) {
                    <li>
                      <b>{{ $index + 2 }}</b
                      >{{ name }}
                    </li>
                  }
                </ol>
              }
            </div>
          } @else if (view().bracket.current; as match) {
            <div class="tour-bar">
              <span class="tour-round">{{ roundLabel(match) | t }}</span>
              <span class="tour-bo">{{ 'Best of {n}' | t: { n: match.bestOf } }}</span>
              <span class="tour-progress" aria-hidden="true">
                @for (segment of progress(); track $index) {
                  <i [class.is-done]="segment === 'done'" [class.is-now]="segment === 'now'"></i>
                }
              </span>
            </div>
            <div class="tour-versus">
              <div
                class="tour-side"
                [style.--side]="colorOf(match.a)"
                [class.is-lead]="match.winsA > match.winsB"
              >
                <span class="tour-disc">{{ initialOf(match.a) }}</span>
                <span class="tour-info">
                  <span class="tour-name">{{ nameOf(match.a) }}</span>
                  <span class="tour-pips">
                    @for (on of pips(match, 'a'); track $index) {
                      <i [class.is-on]="on"></i>
                    }
                  </span>
                </span>
              </div>
              <div class="tour-score">{{ match.winsA }} : {{ match.winsB }}</div>
              <div
                class="tour-side right"
                [style.--side]="colorOf(match.b)"
                [class.is-lead]="match.winsB > match.winsA"
              >
                <span class="tour-disc">{{ initialOf(match.b) }}</span>
                <span class="tour-info">
                  <span class="tour-name">{{ nameOf(match.b) }}</span>
                  <span class="tour-pips">
                    @for (on of pips(match, 'b'); track $index) {
                      <i [class.is-on]="on"></i>
                    }
                  </span>
                </span>
              </div>
            </div>
            @if (view().bracket.current) {
              <div
                class="mx-auto w-full"
                [style.max-width]="
                  'min(' + (compact() ? '11rem' : '16rem') + ', max(7rem, 100cqh - 13.5rem))'
                "
              >
                <app-spinly-wheel
                  [sectors]="duelSectors()"
                  [theme]="spec().theme"
                  [order]="duelOrder()"
                  (stopped)="onDuelStopped($event)"
                />
              </div>
            }
          }

          @if (view().bracket.champion) {
            <button
              type="button"
              class="btn btn-sm w-full"
              [attr.aria-expanded]="bracketOpen()"
              (click)="bracketOpen.set(!bracketOpen())"
            >
              <app-icon name="layout" [size]="14" />
              {{ (bracketOpen() ? 'Hide the bracket' : 'See the bracket') | t }}
            </button>
          }
          @if (mode() === 'chat') {
            @if (!started()) {
              <button type="button" class="btn btn-primary w-full" (click)="startRequested.emit()">
                <app-icon name="trophy" [size]="16" /> {{ 'Start the tournament' | t }}
              </button>
            } @else if (playing()) {
              <button type="button" class="btn btn-sm w-full" (click)="skip()">
                {{ 'Skip to the result' | t }}
              </button>
            }
          } @else {
            <div class="flex flex-wrap justify-center gap-2">
              @if (!view().bracket.champion) {
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  [disabled]="playing()"
                  (click)="spinRequested.emit()"
                >
                  <app-icon name="spin" [size]="14" /> {{ 'Spin' | t }}
                </button>
              }
              @if (started()) {
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  (click)="restartRequested.emit()"
                >
                  <app-icon name="refresh" [size]="14" /> {{ 'Start over' | t }}
                </button>
              }
            </div>
          }
        </div>

        <div class="bracket-fold" [class.is-open]="!view().bracket.champion || bracketOpen()">
          <div class="min-h-0 overflow-hidden">
            <div class="flex min-w-0 gap-[1.6rem] overflow-x-auto px-1 pb-1">
              @for (round of rounds(); track round.title) {
                <div class="bracket-col flex min-w-[9rem] flex-1 flex-col justify-around gap-2">
                  <div class="bracket-title">{{ round.title | t }}</div>
                  @for (m of round.matches; track m.id) {
                    <div class="tour-match" [class.is-now]="m.id === view().bracket.current?.id">
                      @for (id of [m.a, m.b]; track $index) {
                        <div
                          class="tour-row"
                          [class.is-win]="!!m.winner && m.winner === id"
                          [class.is-out]="!id || (!!m.winner && m.winner !== id)"
                        >
                          <span
                            class="tour-row-dot"
                            [style.background]="id ? colorOf(id) : '#555'"
                          ></span>
                          <span class="min-w-0 flex-1 truncate">{{ id ? nameOf(id) : '—' }}</span>
                          @if (m.bye && id) {
                            <span class="text-[0.5625rem] uppercase">bye</span>
                          } @else if (id && (m.winner || m.id === view().bracket.current?.id)) {
                            <span class="font-mono tabular-nums">{{
                              id === m.a ? m.winsA : m.winsB
                            }}</span>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SpinlyTournamentCardComponent implements OnInit {
  private readonly sound = inject(SoundService);
  private readonly destroyRef = inject(DestroyRef);

  /** The tournament to play. */
  readonly spec = input.required<TournamentSpec>();
  /** Every spin so far (the card plays the ones it has not shown yet). */
  readonly spins = input<TournamentSpin[]>([]);
  /** chat: one start button that plays everything. call: manual spins, play them all, start over. */
  readonly mode = input<'chat' | 'call'>('chat');
  /** A smaller card (the call). */
  readonly compact = input(false);
  /** True when the space bar spins the next duel (the tournament of the call). */
  readonly spaceSpins = input(false);
  /** Asks to play the whole tournament (chat). */
  readonly startRequested = output<void>();
  /** Asks for one more spin of the current duel (call). */
  readonly spinRequested = output<void>();
  /** Asks to start the tournament over (call). */
  readonly restartRequested = output<void>();
  /** Emits the podium when a played tournament ends. */
  readonly finished = output<string[]>();

  /** How many spins are shown so far. */
  private readonly shown = signal(0);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private played = false;

  /** The whole tournament as far as the spins go. */
  private readonly full = computed(this.resolveAll.bind(this));
  /** The tournament as far as it has been shown. */
  protected readonly view = computed(this.resolveShown.bind(this));
  /** True once a spin was ever made. */
  protected readonly started = computed(this.hasStarted.bind(this));
  /** True while a spin is being played or waiting to be. */
  protected readonly playing = computed(this.isPlaying.bind(this));
  /** The podium of the finished tournament. */
  protected readonly names = computed(this.buildPodium.bind(this));
  /** The rounds of the bracket for drawing. */
  protected readonly rounds = computed(this.buildRounds.bind(this));
  /** The two sides of the duel wheel. */
  protected readonly duelSectors = computed(this.buildDuelSectors.bind(this));
  /** The order for the duel wheel. */
  protected readonly duelOrder = computed(this.buildDuelOrder.bind(this));

  /** Keeps the shown count within the spins and clears timers when the card goes away. */
  constructor() {
    effect(this.keepWithin.bind(this));
    this.destroyRef.onDestroy(this.clearTimer.bind(this));
  }

  /** What was already there is shown, not played. */
  ngOnInit(): void {
    this.shown.set(this.spins().length);
  }

  /** After a restart there are fewer spins than were shown. */
  private keepWithin(): void {
    const count = this.spins().length;
    untracked(this.clampShown.bind(this, count));
  }

  /** Brings the shown count down to the number of spins. */
  private clampShown(count: number): void {
    if (this.shown() > count) {
      this.shown.set(count);
      this.clearTimer();
    }
  }

  /** Plays the spins of the list. */
  private resolveAll(): ReturnType<typeof resolveTournament> {
    return resolveTournament(this.spec(), this.spins());
  }

  /** Plays the spins that have been shown. */
  private resolveShown(): ReturnType<typeof resolveTournament> {
    return resolveTournament(this.spec(), this.spins().slice(0, this.shown()));
  }

  /** Whether any spin exists. */
  private hasStarted(): boolean {
    return this.spins().length > 0;
  }

  /** Whether some spin has not been shown yet. */
  private isPlaying(): boolean {
    return this.shown() < this.full().spins.length;
  }

  /** The podium once the shown tournament has a champion. */
  private buildPodium(): string[] {
    return podium(this.view());
  }

  /** The rounds, each with its title and matches. */
  private buildRounds(): { title: string; matches: Match[] }[] {
    const bracket = this.view().bracket;
    const count = bracket.rounds.length;
    const rounds: { title: string; matches: Match[] }[] = [];
    for (let i = 0; i < count; i++) {
      const matches = bracket.rounds[i].slice();
      if (i === count - 1 && bracket.third) {
        matches.push(bracket.third);
      }
      rounds.push({ title: roundName(i, count, false), matches });
    }
    return rounds;
  }

  /** Confetti of the champion: where each piece starts, when, and how far it drifts. */
  protected readonly confetti = Array.from({ length: 30 }, function piece(_, i) {
    return {
      left: ((i * 37) % 100) + '%',
      delay: (((i * 0.13) % 1.4) + 0.1).toFixed(2) + 's',
      drift: ((i % 7) - 3) * 14 + 'px',
      color: ['#fbbf24', '#f472b6', '#38bdf8', '#34d399', '#a78bfa'][i % 5],
    };
  });
  /** Whether the bracket is shown under the champion. */
  protected readonly bracketOpen = signal(false);
  /** How many duels were played to get to the champion. */
  protected readonly playedDuels = computed(this.countPlayed.bind(this));

  /** The duels that have a winner and were not a free pass. */
  private countPlayed(): number {
    let count = 0;
    for (const round of this.rounds()) {
      for (const match of round.matches) {
        if (match.winner && !match.bye) {
          count++;
        }
      }
    }
    return count;
  }

  /** One segment per duel: played, being played, or waiting. */
  protected readonly progress = computed(this.buildProgress.bind(this));
  /** The color of the champion. */
  protected readonly championColor = computed(this.pickChampionColor.bind(this));

  /** The color a participant has in the wheel of the duel. */
  protected colorOf(id: string | null): string {
    const participant = this.view().participants.find(function byId(p) {
      return p.id === id;
    });
    return sectorColor(
      participant ? { name: participant.name, color: participant.color } : undefined,
      participant ? participant.seed - 1 : 0,
      this.spec().theme,
    );
  }

  /** The dots of a side of a duel: as many as the points needed to win it, the won ones lit. */
  protected pips(match: Match, side: 'a' | 'b'): boolean[] {
    const needed = Math.floor(match.bestOf / 2) + 1;
    const wins = side === 'a' ? match.winsA : match.winsB;
    return Array.from({ length: needed }, function lit(_, i) {
      return i < wins;
    });
  }

  /** The segments of the progress bar. */
  private buildProgress(): ('done' | 'now' | 'wait')[] {
    const bracket = this.view().bracket;
    const matches: Match[] = [];
    for (const round of this.rounds()) {
      for (const match of round.matches) {
        if (!match.bye) {
          matches.push(match);
        }
      }
    }
    return matches.map(function state(match): 'done' | 'now' | 'wait' {
      if (match.winner) {
        return 'done';
      }
      return match.id === bracket.current?.id ? 'now' : 'wait';
    });
  }

  /** The color of the champion of the tournament. */
  private pickChampionColor(): string {
    return this.colorOf(this.view().bracket.champion);
  }

  /** The first letter of the name of a participant (for the disc of its side). */
  protected initialOf(id: string | null): string {
    return this.nameOf(id).trim().charAt(0).toUpperCase() || '?';
  }

  /** The name of a participant by id. */
  protected nameOf(id: string | null): string {
    return (
      this.view().participants.find(function byId(p) {
        return p.id === id;
      })?.name ?? ''
    );
  }

  /** The title of the round of a match. */
  protected roundLabel(match: Match): string {
    return roundName(match.round, this.view().bracket.rounds.length, match.third);
  }

  /** The two sides of the duel wheel: B first, then A, as big as their chances. */
  private buildDuelSectors(): WheelSector[] {
    const view = this.view();
    const match = view.bracket.current;
    if (!match) {
      return [];
    }
    const spec = this.spec();
    const upcoming = this.full().spins[this.shown()];
    const probability = upcoming ? upcoming.probability : this.chanceOf(match);
    const sides: WheelSector[] = [];
    for (const side of ['b', 'a'] as const) {
      const id = side === 'a' ? match.a : match.b;
      const participant = view.participants.find(function byId(p) {
        return p.id === id;
      });
      sides.push({
        label: participant?.name ?? '',
        color: sectorColor(
          participant ? { name: participant.name, color: participant.color } : undefined,
          participant ? participant.seed - 1 : 0,
          spec.theme,
        ),
        weight: side === 'a' ? probability : 1 - probability,
      });
    }
    return sides;
  }

  /** The chance of side A in the current duel, from the participants' seeds. */
  private chanceOf(match: Match): number {
    if (this.spec().config.odds === 'equal' || !match.a || !match.b) {
      return 0.5;
    }
    const participants = this.view().participants;
    const total = participants.length;
    const a = match.a;
    const b = match.b;
    /** How strong a participant is: the better the seed, the more. */
    function strength(id: string): number {
      const found = participants.find(function byId(p) {
        return p.id === id;
      });
      return total + 1 - (found ? found.seed : total);
    }
    return strength(a) / (strength(a) + strength(b));
  }

  /** The turn of the spin that is being played, if any. */
  private buildDuelOrder(): WheelOrder | null {
    const spin = this.full().spins[this.shown()];
    if (!spin || spin.forced) {
      return null;
    }
    const config = this.spec().config;
    const ms = this.mode() === 'chat' ? 2600 : config.quickSpin ? 1400 : 3600;
    return { key: this.duelKey(), land: spin.land, turns: spin.turns, ms, animate: true };
  }

  /** Identity of the spin being played (its place and its seed, so a restart never repeats a key). */
  private duelKey(): string {
    return 'duel-' + this.shown() + '-' + (this.spins()[this.shown()]?.seed ?? 0);
  }

  /** A duel wheel stopped: show the spin, then go on with the next one. */
  protected onDuelStopped(key: string): void {
    if (key !== this.duelKey()) {
      return;
    }
    this.sound.play('toggle');
    this.timer = setTimeout(this.advance.bind(this), PAUSE_MS);
  }

  /** Shows the spin that just stopped and starts what comes next. */
  private advance(): void {
    this.shown.update(function next(n) {
      return n + 1;
    });
    this.afterShown();
  }

  /** After a spin is shown: more spins to play, or a champion to celebrate. */
  private afterShown(): void {
    if (this.playing()) {
      return;
    }
    if (this.view().bracket.champion) {
      this.celebrate();
    }
  }

  /** Celebrates a champion that was played in front of the person. */
  private celebrate(): void {
    this.played = true;
    this.sound.play('success');
    this.finished.emit(this.names());
  }

  /** The space bar spins the next duel, unless the person is typing or a window is open. */
  @HostListener('window:keydown', ['$event'])
  protected onSpace(event: KeyboardEvent): void {
    if (event.code !== 'Space') {
      return;
    }
    if (
      !this.spaceSpins() ||
      this.playing() ||
      this.view().bracket.champion ||
      isTypingOrBlocked(event)
    ) {
      return;
    }
    event.preventDefault();
    (event.target as HTMLElement | null)?.blur?.();
    this.spinRequested.emit();
  }

  /** Jumps to the final result. */
  protected skip(): void {
    this.clearTimer();
    this.shown.set(this.full().spins.length);
    if (this.view().bracket.champion && !this.played) {
      this.celebrate();
    }
  }

  /** Forgets the pending step. */
  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
