/**
 * src/app/features/spinly/spinly-composer.component.ts
 * The window where a wheel or a tournament is made (or edited). The wheel is shown live while it is built, every
 * option has its own color, and the look (theme, pointer and lights) can be changed like in Spinly. When a Spinly
 * account is linked, its presets and themes are offered here too.
 */
import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  type OnInit,
} from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { SpinlyService } from '../../core/services/spinly.service';
import { ColorPickerComponent } from '../../shared/components/color-picker.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { BUILT_IN_THEMES, freshSeed } from './spinly-engine';
import {
  DEFAULT_TOURNAMENT_CONFIG,
  MAX_OPTIONS,
  MAX_OPTION_NAME,
  MAX_PARTICIPANTS,
  MAX_PARTICIPANT_NAME,
  MAX_TITLE,
  MIN_OPTIONS,
  PALETTE,
  PALETTE_NAMES,
  cleanText,
  type SpecOption,
  type SpinlyActivity,
  type SpinlyPreset,
  type SpinlyTheme,
  type TournamentConfig,
} from './spinly-model';
import { SpinlyWheelComponent, type WheelSector } from './spinly-wheel.component';

/** The ready-made rules of a tournament. */
const RULE_PRESETS: {
  id: string;
  name: string;
  hint: string;
  icon: string;
  tone: string;
  rules: Partial<TournamentConfig>;
}[] = [
  {
    id: 'fast',
    name: 'Fast',
    hint: '1 spin per duel',
    icon: 'zap',
    tone: 'bg-sky/15 text-sky',
    rules: { bestOf: 1, finalBestOf: 1, thirdPlace: false },
  },
  {
    id: 'classic',
    name: 'Classic',
    hint: 'Best of 3 · final 5',
    icon: 'trophy',
    tone: 'bg-amber/15 text-amber',
    rules: { bestOf: 3, finalBestOf: 5, thirdPlace: false },
  },
  {
    id: 'epic',
    name: 'Epic',
    hint: 'Best of 5 · final 7 · 3rd',
    icon: 'crown',
    tone: 'bg-pink/15 text-pink',
    rules: { bestOf: 5, finalBestOf: 7, thirdPlace: true },
  },
];
/** The palette as hex colors, offered in every color picker. */
const PALETTE_HEX = PALETTE_NAMES.map(function toHex(name) {
  return PALETTE[name];
});
/** The pointer and lights of a wheel without a theme. */
const DEFAULT_LOOK = '#fbbf24';

/** One row of the list of options or participants. */
interface Entry {
  id: number;
  name: string;
  /** Always a hex color. */
  color: string;
}

/** The window to make or edit a wheel or a tournament. */
@Component({
  selector: 'app-spinly-composer',
  standalone: true,
  imports: [
    ColorPickerComponent,
    IconComponent,
    ModalComponent,
    SpinlyWheelComponent,
    TranslatePipe,
  ],
  template: `
    <app-modal
      [title]="'Spinly' | t"
      [subtitle]="subtitle() | t"
      [width]="900"
      (closed)="closed.emit()"
    >
      <div
        class="relative mb-5 grid grid-cols-2 rounded-ui border border-white/8 bg-black/25 p-1"
        role="tablist"
      >
        <span
          class="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-[calc(var(--r)*.75)] bg-accent/20 shadow-[0_0_0_1px_var(--accent)] transition-transform duration-300 ease-out"
          [style.transform]="kind() === 'tournament' ? 'translateX(100%)' : 'none'"
        ></span>
        <button
          type="button"
          role="tab"
          class="relative z-10 flex h-9 items-center justify-center gap-2 text-sm font-semibold transition-colors"
          [class]="kind() === 'wheel' ? 'text-accent' : 'text-muted hover:text-fg'"
          (click)="setKind('wheel')"
        >
          <app-icon name="wheel" [size]="16" /> {{ 'Wheel' | t }}
        </button>
        <button
          type="button"
          role="tab"
          class="relative z-10 flex h-9 items-center justify-center gap-2 text-sm font-semibold transition-colors"
          [class]="kind() === 'tournament' ? 'text-accent' : 'text-muted hover:text-fg'"
          (click)="setKind('tournament')"
        >
          <app-icon name="trophy" [size]="16" /> {{ 'Tournament' | t }}
        </button>
      </div>

      <div class="sp-glow grid gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
        <!-- The wheel as it is being made, and how it looks -->
        <div class="min-w-0 max-md:contents md:self-start">
          @if (kind() === 'tournament') {
            <div
              class="relative mx-auto flex w-full flex-col items-center gap-3 rounded-ui-lg border border-white/8 bg-black/20 px-5 pb-5 pt-6 text-center max-md:order-1"
            >
              <span class="tp-trophy"><app-icon name="trophy" [size]="30" /></span>
              <b class="text-sm">{{ 'Knockout tournament' | t }}</b>
              <div class="grid w-full grid-cols-3 gap-2">
                <span class="tp-stat"
                  ><b>{{ filled() }}</b
                  >{{ 'players' | t }}</span
                >
                <span class="tp-stat"
                  ><b>{{ duels() }}</b
                  >{{ 'duels' | t }}</span
                >
                <span class="tp-stat"
                  ><b>{{ rounds() }}</b
                  >{{ 'rounds' | t }}</span
                >
              </div>
              <ol class="tp-list">
                @for (entry of entries(); track entry.id; let i = $index) {
                  @if (entry.name.trim()) {
                    <li class="anim-fade-in">
                      <i [style.background]="entry.color"></i>
                      <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
                      <b>{{ i + 1 }}</b>
                    </li>
                  }
                }
              </ol>
              <p class="text-[0.6875rem] leading-snug text-muted">
                {{
                  'Every duel is a spin of a wheel with the two of them: the winner goes on.' | t
                }}
              </p>
            </div>
          } @else {
            <div
              class="relative mx-auto w-full rounded-ui-lg border border-white/8 px-5 pb-4 pt-8 max-md:order-1 max-md:pb-3 max-md:pt-6"
              [style.background]="glow()"
            >
              <div
                class="mx-auto w-full max-w-[16rem] max-md:max-w-[11rem]"
                data-keep-click
                (pointerdown)="rememberPress($event)"
              >
                <app-spinly-wheel
                  [sectors]="sectors()"
                  [theme]="theme()"
                  [interactive]="true"
                  [selected]="target() === 'slice' ? selected() : null"
                  [highlight]="target() === 'slice' ? selected() : null"
                  (sectorClick)="selectSlice($event)"
                  (pointerClick)="edit('pointer')"
                  (lightsClick)="edit('light')"
                />
              </div>
              <p
                class="mt-3 border-t border-white/8 pt-3 text-center text-xs leading-snug text-muted"
              >
                {{
                  'Click a slice, the arrow or the lights of the wheel to change their color.' | t
                }}
              </p>
              <app-color-picker
                #editorPicker
                class="pointer-events-none fixed left-0 top-0 h-0 w-0 opacity-0"
                label="Color"
                [value]="editorColor()"
                (valueChange)="setEditorColor($event)"
                (closed)="closeEditor()"
              />
            </div>
          }
          <div class="mt-4 space-y-2 max-md:order-3 max-md:mt-0">
            <div class="fold" [class.is-open]="lookOpen()">
              <button
                type="button"
                class="fold-head"
                [attr.aria-expanded]="lookOpen()"
                (click)="lookOpen.set(!lookOpen())"
              >
                <span class="label">{{ 'Look' | t }}</span>
                <span class="min-w-0 flex-1 truncate text-right text-xs text-muted">{{
                  themeName() || 'Default' | t
                }}</span>
                <app-icon name="chevron-down" [size]="15" class="fold-chevron text-muted" />
              </button>
              <div class="fold-body">
                <div>
                  <div class="grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto p-3 pt-1">
                    <button
                      type="button"
                      class="theme-card"
                      [class.is-on]="!themeName()"
                      (click)="pickTheme(null)"
                    >
                      <span class="theme-strip">
                        @for (color of defaultStrip; track $index) {
                          <span [style.background]="color"></span>
                        }
                      </span>
                      <span class="truncate">{{ 'Default' | t }}</span>
                    </button>
                    @for (option of themeChoices(); track $index) {
                      <button
                        type="button"
                        class="theme-card"
                        [class.is-on]="isTheme(option)"
                        [attr.title]="option.name"
                        (click)="pickTheme(option)"
                      >
                        <span class="theme-strip">
                          @for (color of option.segments.slice(0, 6); track $index) {
                            <span [style.background]="color"></span>
                          }
                        </span>
                        <span class="truncate">{{ option.name }}</span>
                      </button>
                    }
                  </div>
                </div>
              </div>
            </div>

            @if (spinly.profile(); as profile) {
              @if (profile.presets.length) {
                <div class="fold" [class.is-open]="presetsOpen()">
                  <button
                    type="button"
                    class="fold-head"
                    [attr.aria-expanded]="presetsOpen()"
                    (click)="presetsOpen.set(!presetsOpen())"
                  >
                    <span class="label">{{ 'Your Spinly presets' | t }}</span>
                    <span class="count-pill ml-auto">{{ profile.presets.length }}</span>
                    <app-icon name="chevron-down" [size]="15" class="fold-chevron text-muted" />
                  </button>
                  <div class="fold-body">
                    <div>
                      <div class="max-h-52 space-y-1.5 overflow-y-auto p-3 pt-1">
                        @for (preset of profile.presets; track $index) {
                          <button
                            type="button"
                            class="theme-card w-full !flex-row !items-center !gap-2.5"
                            (click)="usePreset($index)"
                          >
                            <span class="flex shrink-0">
                              @for (color of presetColors(preset); track $index) {
                                <span
                                  class="-ml-1 h-3.5 w-3.5 rounded-full border border-black/40 first:ml-0"
                                  [style.background]="color"
                                ></span>
                              }
                            </span>
                            <span class="min-w-0 flex-1 truncate">{{ preset.name }}</span>
                            <span class="font-normal text-muted">{{ preset.options.length }}</span>
                          </button>
                        }
                      </div>
                    </div>
                  </div>
                </div>
              }
            }
          </div>
        </div>

        <!-- What is being made -->
        <div
          class="min-w-0 space-y-4 max-md:order-2 md:max-h-[calc(92dvh-12rem)] md:overflow-y-auto md:pr-2"
        >
          <div class="contents">
            <div>
              <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span class="label"
                  >{{ (kind() === 'wheel' ? 'Options' : 'Participants') | t }}
                  <span class="ml-1 normal-case tracking-normal text-muted"
                    >{{ filled() }}/{{ limit() }}</span
                  ></span
                >
                <span class="flex gap-1">
                  <button
                    type="button"
                    class="btn btn-sm"
                    [disabled]="entries().length >= limit()"
                    (click)="add(true)"
                  >
                    <app-icon name="plus" [size]="13" />
                    {{ (kind() === 'wheel' ? 'Add option' : 'Add participant') | t }}
                  </button>
                  <button type="button" class="btn btn-sm btn-ghost" (click)="recolor()">
                    <app-icon name="shuffle" [size]="13" /> {{ 'Recolor' | t }}
                  </button>
                </span>
              </div>

              <div class="max-h-[min(21rem,42dvh)] space-y-1.5 overflow-y-auto pr-1">
                @for (entry of entries(); track entry.id; let i = $index) {
                  <div class="anim-fade-up flex items-center gap-2" style="--d: 0ms">
                    <span class="w-5 shrink-0 text-right font-mono text-[0.6875rem] text-dim">{{
                      i + 1
                    }}</span>
                    <input
                      class="input min-w-0 flex-1 !py-1.5"
                      data-entry
                      [value]="entry.name"
                      [attr.maxlength]="maxName()"
                      [attr.aria-label]="'Name' | t"
                      (input)="setName(entry.id, $any($event.target).value)"
                      (keydown.enter)="$event.preventDefault(); add(true)"
                    />
                    <button
                      type="button"
                      class="btn btn-icon btn-sm btn-ghost opacity-60 hover:opacity-100"
                      [disabled]="entries().length <= minimum"
                      [attr.aria-label]="'Remove' | t"
                      (click)="remove(entry.id)"
                    >
                      <app-icon name="trash" [size]="14" />
                    </button>
                  </div>
                }
              </div>
            </div>
          </div>

          @if (kind() === 'tournament') {
            <div class="!mt-5">
              <span class="label">{{ 'Mode' | t }}</span>
              <div class="mt-1.5 grid gap-2 sm:grid-cols-3">
                @for (p of rulePresets; track p.id) {
                  <button
                    type="button"
                    class="rule-preset"
                    [class.is-on]="activePreset() === p.id"
                    (click)="applyRulePreset(p.id)"
                  >
                    <span class="rule-preset-icon" [class]="p.tone"
                      ><app-icon [name]="p.icon" [size]="16"
                    /></span>
                    <span class="min-w-0 text-left">
                      <b class="block text-sm">{{ p.name | t }}</b>
                      <span class="block text-[0.6875rem] leading-tight text-muted">{{
                        p.hint | t
                      }}</span>
                    </span>
                  </button>
                }
              </div>
              <p class="mt-2 text-center text-xs text-muted">
                {{
                  '{n} participants · {d} duels · final best of {f}'
                    | t: { n: filled(), d: duels(), f: config().finalBestOf }
                }}
              </p>
            </div>
          }
        </div>
      </div>

      <div class="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-white/8 pt-4">
        <button type="button" class="btn" (click)="closed.emit()">{{ 'Cancel' | t }}</button>
        <button type="button" class="btn btn-primary" [disabled]="!valid()" (click)="confirm()">
          <app-icon name="send" [size]="15" /> {{ confirmLabel() | t }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .tp-trophy {
      display: grid;
      width: 3.6rem;
      height: 3.6rem;
      place-items: center;
      border-radius: 50%;
      color: #fbbf24;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.22), transparent 70%);
      filter: drop-shadow(0 0 12px rgba(251, 191, 36, 0.45));
    }
    .tp-stat {
      display: grid;
      gap: 0.1rem;
      padding: 0.5rem 0.2rem;
      border-radius: var(--r);
      background: rgba(255, 255, 255, 0.05);
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .tp-stat b {
      font-size: 1.15rem;
      letter-spacing: 0;
      color: var(--fg);
    }
    .tp-list {
      display: grid;
      width: 100%;
      max-height: 11rem;
      gap: 0.25rem;
      overflow-y: auto;
      text-align: left;
      font-size: 0.78rem;
    }
    .tp-list li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0.55rem;
      border-radius: calc(var(--r) * 0.8);
      background: rgba(255, 255, 255, 0.04);
    }
    .tp-list i {
      width: 0.55rem;
      height: 0.55rem;
      flex-shrink: 0;
      border-radius: 50%;
    }
    .tp-list b {
      font-size: 0.625rem;
      color: var(--dim);
    }
    .rule-preset {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.5rem 0.6rem;
      border-radius: var(--r);
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.03);
      transition:
        transform 0.3s var(--ease),
        border-color 0.3s var(--ease-suave),
        background-color 0.3s var(--ease-suave);
    }
    .rule-preset:hover {
      border-color: rgba(255, 255, 255, 0.28);
    }
    .rule-preset.is-on {
      border-color: var(--accent);
      background: color-mix(in oklab, var(--accent) 12%, transparent);
    }
    .rule-preset-icon {
      display: flex;
      width: 2rem;
      height: 2rem;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      border-radius: calc(var(--r) * 0.8);
    }
  `,
})
export class SpinlyComposerComponent implements OnInit {
  protected readonly spinly = inject(SpinlyService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** What to start from (editing), or null for a new one. */
  readonly initial = input<SpinlyActivity | null>(null);
  /** The text of the confirm button. */
  readonly confirmLabel = input('Send to the chat');
  /** Line under the title. */
  readonly subtitle = input('Let the wheel decide');
  /** The finished wheel or tournament. */
  readonly confirmed = output<SpinlyActivity>();
  /** The window was closed. */
  readonly closed = output<void>();

  protected readonly kind = signal<'wheel' | 'tournament'>('wheel');
  protected readonly title = signal('');
  protected readonly entries = signal<Entry[]>([]);
  protected readonly theme = signal<SpinlyTheme | undefined>(undefined);
  protected readonly config = signal<TournamentConfig>({ ...DEFAULT_TOURNAMENT_CONFIG });
  /** The slice of the wheel being edited. */
  protected readonly selected = signal<number | null>(null);
  /** What the color editor under the wheel is changing: a slice, the pointer or the lights. */
  protected readonly editing = signal<'slice' | 'pointer' | 'light'>('slice');
  protected readonly lookOpen = signal(false);
  protected readonly presetsOpen = signal(false);
  /** What is being edited right now, or null when nothing is. */
  protected readonly target = computed(this.pickTarget.bind(this));
  /** The color the editor shows. */
  protected readonly editorColor = computed(this.pickEditorColor.bind(this));
  /** The theme the person started from, offered in the list of themes. */
  private readonly extraTheme = signal<SpinlyTheme | undefined>(undefined);

  protected readonly minimum = MIN_OPTIONS;
  protected readonly rulePresets = RULE_PRESETS;
  protected readonly activePreset = computed(this.findActivePreset.bind(this));
  /** The row of the slice being edited. */
  protected readonly chosen = computed(this.pickChosen.bind(this));
  /** How many duels the tournament will have. */
  protected readonly duels = computed(this.countDuels.bind(this));
  /** How many rounds the tournament will have. */
  protected readonly rounds = computed(this.countRounds.bind(this));
  protected readonly palette = PALETTE_HEX;
  protected readonly limit = computed(this.pickLimit.bind(this));
  protected readonly maxName = computed(this.pickMaxName.bind(this));
  /** How many rows have a name. */
  protected readonly filled = computed(this.countFilled.bind(this));
  protected readonly valid = computed(this.isValid.bind(this));
  protected readonly themeName = computed(this.pickThemeName.bind(this));
  protected readonly themeChoices = computed(this.buildThemeChoices.bind(this));
  protected readonly sectors = computed(this.buildSectors.bind(this));
  protected readonly glow = computed(this.buildGlow.bind(this));
  protected readonly defaultStrip = PALETTE_HEX.slice(0, 6);
  protected readonly pointerColor = computed(this.pickPointer.bind(this));
  protected readonly lightColor = computed(this.pickLight.bind(this));

  private readonly i18n = inject(I18nService);
  private nextId = 1;

  /** Fills the form from the starting point. */
  ngOnInit(): void {
    const start = this.initial();
    if (!start) {
      // it starts with values (the person changes them): three options, so that it can be sent as it is
      const option = this.i18n.t('Option');
      this.entries.set([0, 1, 2].map(this.defaultRow.bind(this, option)));
      return;
    }
    this.kind.set(start.kind);
    const spec = start.kind === 'wheel' ? start.wheel : start.tournament;
    const options = start.kind === 'wheel' ? start.wheel.options : start.tournament.participants;
    this.title.set(spec.title);
    this.entries.set(
      options.map(
        function toRow(this: SpinlyComposerComponent, option: SpecOption): Entry {
          return { id: this.nextId++, name: option.name, color: this.hex(option.color) };
        }.bind(this),
      ),
    );
    if (start.kind === 'tournament') {
      this.config.set({ ...start.tournament.config });
    }
    this.theme.set(spec.theme);
    this.extraTheme.set(spec.theme);
  }

  /** A color as hex (palette names become their color). */
  protected hex(color: string): string {
    return PALETTE[color] ?? color;
  }

  /** The color a new row gets: the next one of the theme, or of the palette. */
  private autoColor(index: number): string {
    const theme = this.theme();
    if (theme && theme.segments.length > 0) {
      return theme.segments[index % theme.segments.length];
    }
    return PALETTE_HEX[index % PALETTE_HEX.length];
  }

  /** A row with a default name ("Option 1"). */
  private defaultRow(option: string, index: number): Entry {
    return this.row(option + ' ' + (index + 1), index);
  }

  /** A row with a name and the color that belongs to its place. */
  private row(name: string, index: number): Entry {
    return { id: this.nextId++, name, color: this.autoColor(index) };
  }

  /** Most rows for the kind being made. */
  private pickLimit(): number {
    return this.kind() === 'wheel' ? MAX_OPTIONS : MAX_PARTICIPANTS;
  }

  /** Longest name for the kind being made. */
  private pickMaxName(): number {
    return this.kind() === 'wheel' ? MAX_OPTION_NAME : MAX_PARTICIPANT_NAME;
  }

  /** Rows that have a name. */
  private countFilled(): number {
    let count = 0;
    for (const entry of this.entries()) {
      if (cleanText(entry.name, 99)) {
        count += 1;
      }
    }
    return count;
  }

  /** Whether there are enough (and not too many) names. */
  private isValid(): boolean {
    return this.filled() >= MIN_OPTIONS && this.entries().length <= this.limit();
  }

  /** Whether a theme is the one in use (same name and colors; the pointer and lights may differ). */
  protected isTheme(option: SpinlyTheme): boolean {
    const current = this.theme();
    return (
      !!current &&
      current.name === option.name &&
      current.segments.join() === option.segments.join()
    );
  }

  /** Name of the theme in use. */
  private pickThemeName(): string | null {
    return this.theme()?.name || null;
  }

  /** The themes to pick from: the starting one, Spinly's two and the ones of the linked account, each only once. */
  private buildThemeChoices(): SpinlyTheme[] {
    const choices: SpinlyTheme[] = [];
    const seen = new Set<string>();
    const sources: (SpinlyTheme | undefined)[] = [
      this.extraTheme(),
      ...BUILT_IN_THEMES,
      ...(this.spinly.profile()?.themes ?? []),
    ];
    for (const theme of sources) {
      if (!theme) {
        continue;
      }
      const key = theme.name + '|' + theme.segments.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        choices.push(theme);
      }
    }
    return choices;
  }

  /** The wheel drawn next to the form. */
  private buildSectors(): WheelSector[] {
    const sectors: WheelSector[] = [];
    for (const entry of this.entries()) {
      sectors.push({ label: cleanText(entry.name, 99) || '…', color: entry.color, weight: 1 });
    }
    while (sectors.length < MIN_OPTIONS) {
      sectors.push({ label: '…', color: this.autoColor(sectors.length), weight: 1 });
    }
    return sectors;
  }

  /** A soft light behind the wheel made from the colors of its first sectors. */
  private buildGlow(): string {
    const rows = this.entries();
    const first = rows[0]?.color ?? PALETTE_HEX[0];
    const second = rows[1]?.color ?? PALETTE_HEX[1];
    return (
      'radial-gradient(circle at 50% 55%, color-mix(in srgb, ' +
      first +
      ' 28%, transparent), transparent 62%), radial-gradient(circle at 80% 20%, color-mix(in srgb, ' +
      second +
      ' 18%, transparent), transparent 55%), rgba(0,0,0,.25)'
    );
  }

  /** The pointer color in use. */
  private pickPointer(): string {
    return this.theme()?.pointer ?? DEFAULT_LOOK;
  }

  /** The lights color in use. */
  private pickLight(): string {
    return this.theme()?.light ?? DEFAULT_LOOK;
  }

  /** Switches between wheel and tournament, keeping what was written (the limits may cut it). */
  protected setKind(kind: 'wheel' | 'tournament'): void {
    this.kind.set(kind);
    const limit = this.pickLimit();
    this.entries.update(function cut(rows) {
      return rows.slice(0, limit);
    });
  }

  /** Applies a theme (or none): its colors go to every row, and its pointer and lights are used. */
  protected pickTheme(theme: SpinlyTheme | null): void {
    this.theme.set(theme ?? undefined);
    this.recolor();
  }

  /** Changes the pointer or the lights. */
  protected setLook(field: 'pointer' | 'light', color: string): void {
    this.theme.update(function change(current) {
      const base = current ?? { name: '', segments: PALETTE_HEX.slice() };
      return { ...base, [field]: color };
    });
  }

  /** Gives the rows a new random order of the colors of the theme (or the palette). */
  protected recolor(): void {
    const theme = this.theme();
    const source = theme && theme.segments.length > 0 ? theme.segments : PALETTE_HEX;
    const rows = this.entries();
    const before = rows
      .map(function colorOf(entry) {
        return entry.color;
      })
      .join();
    let colors: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      colors = [];
      const bag = source.slice();
      for (let i = 0; i < rows.length; i++) {
        if (bag.length === 0) {
          bag.push(...source);
        }
        colors.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
      }
      if (colors.join() !== before) {
        break;
      }
    }
    this.entries.set(
      rows.map(function paint(entry, index) {
        return { ...entry, color: colors[index] };
      }),
    );
  }

  /** Loads a preset of the linked account: its options with the colors of its theme. */
  protected usePreset(index: number): void {
    const preset = this.spinly.profile()?.presets[index];
    if (!preset) {
      return;
    }
    this.title.set(preset.name);
    this.theme.set(preset.theme);
    this.extraTheme.set(preset.theme);
    const limit = this.pickLimit();
    this.entries.set(
      preset.options.slice(0, limit).map(
        function toRow(this: SpinlyComposerComponent, option: SpecOption, at: number): Entry {
          const segments = preset.theme?.segments ?? [];
          const themed = segments.length ? segments[at % segments.length] : null;
          return { id: this.nextId++, name: option.name, color: themed ?? this.hex(option.color) };
        }.bind(this),
      ),
    );
  }

  /** Changes the name of a row. */
  protected setName(id: number, name: string): void {
    this.entries.update(function rename(rows) {
      return rows.map(function pick(entry) {
        return entry.id === id ? { ...entry, name } : entry;
      });
    });
  }

  /** Changes the color of a row. */
  protected setColor(id: number, color: string): void {
    this.entries.update(function recolorOne(rows) {
      return rows.map(function pick(entry) {
        return entry.id === id ? { ...entry, color } : entry;
      });
    });
  }

  /** Adds an empty row (and puts the cursor in it). */
  protected add(focus: boolean): void {
    if (this.entries().length >= this.limit()) {
      return;
    }
    const index = this.entries().length;
    this.entries.update(
      function append(this: SpinlyComposerComponent, rows: Entry[]) {
        return [...rows, this.row('', index)];
      }.bind(this),
    );
    if (focus) {
      setTimeout(this.focusLast.bind(this), 30);
    }
  }

  /** Puts the cursor in the last row. */
  private focusLast(): void {
    const inputs = this.host.nativeElement.querySelectorAll<HTMLInputElement>('input[data-entry]');
    inputs[inputs.length - 1]?.focus();
  }

  /** Removes a row. */
  protected remove(id: number): void {
    if (this.entries().length <= MIN_OPTIONS) {
      return;
    }
    this.entries.update(function drop(rows) {
      return rows.filter(function keep(entry) {
        return entry.id !== id;
      });
    });
  }

  /** The row that goes with the slice marked on the wheel, if it still exists. */
  private pickChosen(): Entry | null {
    const index = this.selected();
    return index === null ? null : (this.entries()[index] ?? null);
  }

  /** The picker of the color of what is being edited (it is opened where the wheel was pressed). */
  private readonly editorPicker = viewChild<ColorPickerComponent>('editorPicker');
  private press = { x: 0, y: 0 };

  /** Remembers where the wheel was pressed, to open the color picker there. */
  protected rememberPress(event: PointerEvent): void {
    this.press = { x: event.clientX + 14, y: event.clientY + 14 };
  }

  /** Opens the picker for what is marked, once the new color has reached it. */
  private openEditor(): void {
    setTimeout(this.showEditor.bind(this), 0);
  }

  /** Shows the picker where the wheel was pressed. */
  private showEditor(): void {
    if (this.target()) {
      this.editorPicker()?.openAt(this.press.x, this.press.y);
    }
  }

  /** A slice of the wheel was clicked: it is marked and its color is edited with the picker. */
  protected selectSlice(index: number): void {
    const same = this.editing() === 'slice' && this.selected() === index;
    this.editing.set('slice');
    this.selected.set(same ? null : index);
    this.openEditor();
  }

  /** The arrow or the lights of the wheel were clicked: their color is edited under the wheel. */
  protected edit(what: 'pointer' | 'light'): void {
    this.selected.set(null);
    this.editing.set(this.editing() === what ? 'slice' : what);
    this.openEditor();
  }

  /** Closes the color editor. */
  protected closeEditor(): void {
    this.selected.set(null);
    this.editing.set('slice');
  }

  /** What the editor works on: the marked slice, the pointer, the lights, or nothing. */
  private pickTarget(): 'slice' | 'pointer' | 'light' | null {
    if (this.editing() === 'slice') {
      return this.chosen() ? 'slice' : null;
    }
    return this.editing();
  }

  /** The color of what is being edited. */
  private pickEditorColor(): string {
    switch (this.target()) {
      case 'pointer':
        return this.pointerColor();
      case 'light':
        return this.lightColor();
      default:
        return this.chosen()?.color ?? '#ffffff';
    }
  }

  /** A new color from the editor goes to the slice, the pointer or the lights. */
  protected setEditorColor(color: string): void {
    const target = this.target();
    if (target === 'pointer') {
      this.setLook('pointer', color);
    } else if (target === 'light') {
      this.setLook('light', color);
    } else {
      const entry = this.chosen();
      if (entry) {
        this.setColor(entry.id, color);
      }
    }
  }

  /** The ready-made rules that match what is set, if any. */
  private findActivePreset(): string | null {
    const config = this.config();
    for (const preset of RULE_PRESETS) {
      const rules = preset.rules;
      if (
        rules.bestOf === config.bestOf &&
        rules.finalBestOf === config.finalBestOf &&
        rules.thirdPlace === config.thirdPlace
      ) {
        return preset.id;
      }
    }
    return null;
  }

  /** Applies one of the ready-made rules. */
  protected applyRulePreset(id: string): void {
    const preset = RULE_PRESETS.find(function byId(candidate) {
      return candidate.id === id;
    });
    if (preset) {
      this.patch(preset.rules);
    }
  }

  /** The number of duels: one less than the participants, plus the one for third place. */
  private countRounds(): number {
    return Math.max(1, Math.ceil(Math.log2(Math.max(2, this.filled()))));
  }

  /** How many duels the tournament will have. */
  private countDuels(): number {
    const count = this.filled();
    const third = this.config().thirdPlace && count >= 4 ? 1 : 0;
    return Math.max(0, count - 1) + third;
  }

  /** The colors a preset chip shows: its theme's, or those of its first options. */
  protected presetColors(preset: SpinlyPreset): string[] {
    const segments = preset.theme?.segments ?? [];
    if (segments.length) {
      return segments.slice(0, 4);
    }
    const colors: string[] = [];
    for (const option of preset.options.slice(0, 4)) {
      colors.push(this.hex(option.color));
    }
    return colors;
  }

  /** Changes some of the tournament rules. */
  protected patch(change: Partial<TournamentConfig>): void {
    this.config.update(function merge(current) {
      return { ...current, ...change };
    });
  }

  /** Hands over what was made. */
  protected confirm(): void {
    if (!this.valid()) {
      return;
    }
    const max = this.maxName();
    const options: SpecOption[] = [];
    for (const entry of this.entries()) {
      const name = cleanText(entry.name, max);
      if (name) {
        options.push({ name, color: entry.color });
      }
    }
    const title = cleanText(this.title(), MAX_TITLE);
    const theme = this.theme();
    if (this.kind() === 'wheel') {
      this.confirmed.emit({ kind: 'wheel', wheel: { title, options, theme } });
    } else {
      this.confirmed.emit({
        kind: 'tournament',
        tournament: {
          title,
          config: this.config(),
          participants: options,
          drawSeed: freshSeed(),
          theme,
        },
      });
    }
  }
}
