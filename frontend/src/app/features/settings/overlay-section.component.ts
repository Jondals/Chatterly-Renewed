/**
 * src/app/features/settings/overlay-section.component.ts
 * Settings - Overlay (desktop app only): your call drawn over the game you are playing, in widgets like the overlay of
 * Discord (the call controls, the people, the cameras, the activity, the streams and the messages). Here the person turns it
 * on, chooses the shortcut that unlocks it, what it shows and how it looks.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import type { OverlaySettings, OverlaySize } from '../../core/desktop-bridge';
import { OverlayService } from '../../core/services/overlay.service';
import { SettingRowComponent, ToggleComponent } from '../../shared/components/controls.component';
import { IconComponent } from '../../shared/components/icon.component';
import { SelectComponent, type SelectOption } from '../../shared/components/select.component';

const SIZES: { id: OverlaySize; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
];

const DISPLAYS: { id: OverlaySettings['display']; label: string }[] = [
  { id: 'primary', label: 'The main screen' },
  { id: 'app', label: 'The screen where Chatterly is' },
];

/** A key that can end a shortcut: a letter, a digit or F1 to F12. */
const SHORTCUT_KEY = /^(?:[A-Z0-9]|F[1-9]|F1[0-2])$/;

/** Settings > Overlay. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-overlay-section',
  standalone: true,
  imports: [IconComponent, SelectComponent, SettingRowComponent, ToggleComponent, TranslatePipe],
  template: `
    <section class="settings-card">
      <app-setting-row
        title="Turn on the overlay"
        hint="Press the shortcut at any time to open it over whatever you are doing. In a call it also shows who is in it and who is talking, the cameras, the screens they share, the messages you get and the buttons of the call. It never reads or changes the game."
      >
        <app-toggle
          [checked]="settings().enabled"
          (checkedChange)="overlay.set({ enabled: $event })"
          [label]="'Turn on the overlay' | t"
        />
      </app-setting-row>
      <div class="my-3 grid gap-2 rounded-ui bg-white/[.04] p-3 text-xs text-muted sm:grid-cols-2">
        @for (w of widgetHelp; track w.title) {
          <span class="flex items-start gap-2"
            ><app-icon [name]="w.icon" [size]="14" class="mt-0.5 shrink-0 text-accent" />
            <span
              ><b class="text-fg">{{ w.title | t }}</b> · {{ w.text | t }}</span
            ></span
          >
        }
      </div>
      <p class="text-xs text-muted">
        {{
          'Press the shortcut to unlock it: drag every widget where you want it and pin the ones that must stay while you play. A click outside, Esc or the cross give the mouse back to the game.'
            | t
        }}
      </p>
      <p class="mt-3 text-xs text-dim">
        {{
          'It appears over games in window or borderless mode. A game in exclusive full screen owns the monitor and nothing can be drawn over it: choose borderless in its video options.'
            | t
        }}
      </p>
    </section>

    <section class="settings-card mt-4">
      <h2 class="settings-card-title">{{ 'Games' | t }}</h2>
      <app-setting-row
        title="When to show it"
        hint="In every call, or only while one of the games you register below is open. A small notice tells you which keys open it."
      >
        <app-select
          class="w-72 max-w-full"
          label="When to show it"
          [options]="modeOptions()"
          [value]="settings().mode"
          (valueChange)="overlay.set({ mode: $event === 'games' ? 'games' : 'always' })"
        />
      </app-setting-row>
      @for (game of settings().games; track game) {
        <div class="mt-2 flex items-center gap-3">
          <span class="min-w-0 flex-1 truncate text-sm">{{ game }}</span>
          <button
            type="button"
            class="btn btn-icon btn-sm btn-ghost"
            [attr.aria-label]="'Remove' | t"
            (click)="overlay.removeGame(game)"
          >
            <app-icon name="x" [size]="16" />
          </button>
        </div>
      } @empty {
        <p class="mt-2 text-xs text-dim">
          {{ 'No games yet: add the window of a game you play.' | t }}
        </p>
      }
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm" (click)="loadWindows()">
          <app-icon name="monitor" [size]="14" /> {{ 'Add from the open windows' | t }}
        </button>
      </div>
      @if (windows() !== null) {
        <div class="mt-3 max-h-56 overflow-y-auto rounded-ui border border-white/10 p-1">
          @for (name of windows(); track name) {
            <button
              type="button"
              class="block w-full truncate rounded-ui px-2 py-1.5 text-left text-sm hover:bg-white/10"
              (click)="addFromList(name)"
            >
              {{ name }}
            </button>
          } @empty {
            <p class="p-2 text-xs text-dim">{{ 'No other windows are open.' | t }}</p>
          }
        </div>
      }
      <form class="mt-3 flex flex-wrap gap-2" (submit)="addTyped($event)">
        <input
          class="input min-w-0 flex-1"
          type="text"
          maxlength="80"
          autocomplete="off"
          [placeholder]="'Or type part of the name of its window' | t"
          [value]="typed()"
          (input)="typed.set($any($event.target).value)"
        />
        <button type="submit" class="btn btn-sm" [disabled]="!typed().trim()">
          {{ 'Add' | t }}
        </button>
      </form>
    </section>

    <section class="settings-card mt-4">
      <h2 class="settings-card-title">{{ 'Position' | t }}</h2>
      <app-setting-row
        title="Move and resize shortcut"
        hint="Press it during a call to grab the panel with the mouse: drag it where you want, pull the corner to resize it, and press Esc (or the shortcut again) to give the game back its mouse."
      >
        <button
          type="button"
          class="btn btn-sm min-w-40 font-mono"
          (click)="listening.set(true)"
          (keydown)="onKey($event)"
          (blur)="listening.set(false)"
        >
          {{ listening() ? ('Press the keys…' | t) : shortcutLabel() }}
        </button>
      </app-setting-row>
      @if (!overlay.state().hotkeyOk && settings().enabled) {
        <p class="mt-2 text-xs text-red-300">
          {{ 'Another program is using that shortcut. Choose a different one.' | t }}
        </p>
      }
      <app-setting-row title="Screen" hint="Which screen the overlay covers.">
        <app-select
          class="w-64 max-w-full"
          label="Screen"
          [options]="displayOptions()"
          [value]="settings().display"
          (valueChange)="overlay.set({ display: $event === 'app' ? 'app' : 'primary' })"
        />
      </app-setting-row>
    </section>

    <section class="settings-card mt-4">
      <h2 class="settings-card-title">{{ 'Look' | t }}</h2>
      <app-setting-row
        title="Size of each person"
        hint="You can also resize the whole panel with the mouse."
      >
        <app-select
          class="w-48 max-w-full"
          label="Size of each person"
          [options]="sizeOptions()"
          [value]="settings().size"
          (valueChange)="setSize($event)"
        />
      </app-setting-row>
      <app-setting-row title="Transparency" hint="Lower it to see more of the game behind.">
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="30"
            max="100"
            class="w-44 accent-[var(--accent)]"
            [value]="settings().opacity"
            (change)="overlay.set({ opacity: +$any($event.target).value })"
            [attr.aria-label]="'Transparency' | t"
          /><span class="w-10 text-right font-mono text-xs text-muted"
            >{{ settings().opacity }}%</span
          >
        </div>
      </app-setting-row>
      <app-setting-row title="Show names" hint="The name under each person.">
        <app-toggle
          [checked]="settings().showNames"
          (checkedChange)="overlay.set({ showNames: $event })"
          [label]="'Show names' | t"
        />
      </app-setting-row>
      <app-setting-row
        title="Only the people who are talking"
        hint="Everybody else disappears until they speak. Cameras and pictures keep the game clear."
      >
        <app-toggle
          [checked]="settings().onlySpeaking"
          (checkedChange)="overlay.set({ onlySpeaking: $event })"
          [label]="'Only the people who are talking' | t"
        />
      </app-setting-row>
      <app-setting-row
        title="The text of the messages"
        hint="The notifications show what the message says. Off: only who wrote it and where."
      >
        <app-toggle
          [checked]="settings().notifyText"
          (checkedChange)="overlay.set({ notifyText: $event })"
          [label]="'The text of the messages' | t"
        />
      </app-setting-row>
      <app-setting-row title="Show myself" hint="Adds your own camera or picture to the panel.">
        <app-toggle
          [checked]="settings().showSelf"
          (checkedChange)="overlay.set({ showSelf: $event })"
          [label]="'Show myself' | t"
        />
      </app-setting-row>
    </section>

    <section class="settings-card mt-4">
      <h2 class="settings-card-title">{{ 'Privacy' | t }}</h2>
      <app-setting-row
        title="Hide it from recordings and shared screens"
        hint="Your friends' cameras do not appear if you record your game or share your screen. On some computers Windows then hides the overlay from your own screen too: if you do not see it, turn this off."
      >
        <app-toggle
          [checked]="settings().hideFromCapture"
          (checkedChange)="overlay.set({ hideFromCapture: $event })"
          [label]="'Hide it from recordings and shared screens' | t"
        />
      </app-setting-row>
    </section>

    <p class="mt-4 text-xs text-dim">
      {{
        'The video goes to the overlay inside your computer only: it is never sent anywhere. The overlay is a window of Chatterly; it does not touch the game, so there is nothing for an anti-cheat to flag, but not every game can be promised.'
          | t
      }}
    </p>
  `,
})
export class OverlaySectionComponent {
  protected readonly overlay = inject(OverlayService);
  /** What each widget of the overlay is. */
  protected readonly widgetHelp = [
    { icon: 'phone', title: 'Call', text: 'Mute, deafen, camera, screen and hang up.' },
    { icon: 'volume', title: 'Voice', text: 'Who is in the call, who talks and who is live.' },
    { icon: 'video', title: 'Video', text: 'The cameras, yours too.' },
    { icon: 'activity', title: 'Activity', text: 'The game you registered and for how long.' },
    { icon: 'monitor', title: 'Streams', text: 'The screens they share, with their volume.' },
    { icon: 'bell', title: 'Notifications', text: 'The messages you get, to open them.' },
  ];
  private readonly i18n = inject(I18nService);

  /** The windows that are open, once the person asked to see them (null until then). */
  protected readonly windows = signal<string[] | null>(null);
  /** The name of a game being typed. */
  protected readonly typed = signal('');
  protected readonly modeOptions = computed(this.buildModes.bind(this));

  /** True while the button waits for the keys of a new shortcut. */
  protected readonly listening = signal(false);
  protected readonly settings = computed(this.readSettings.bind(this));

  protected readonly sizeOptions = computed(this.buildSizes.bind(this));
  protected readonly displayOptions = computed(this.buildDisplays.bind(this));

  /** The shortcut as the person reads it ("Ctrl+Shift+O"). */
  protected readonly shortcutLabel = computed(this.readLabel.bind(this));

  private buildModes(): SelectOption[] {
    return [
      { value: 'always', label: this.i18n.t('In every call') },
      { value: 'games', label: this.i18n.t('Only while one of my games is open') },
    ];
  }

  /** Reads the windows that are open now. */
  protected async loadWindows(): Promise<void> {
    const known = this.settings().games.map(function lower(game) {
      return game.toLowerCase();
    });
    const names = await this.overlay.openWindows();
    this.windows.set(
      names.filter(function isNew(name) {
        return !known.includes(name.toLowerCase());
      }),
    );
  }

  /** Registers the window chosen from the list. */
  protected addFromList(name: string): void {
    this.overlay.addGame(name);
    this.windows.set(null);
  }

  /** Registers the name that was typed. */
  protected addTyped(event: Event): void {
    event.preventDefault();
    const name = this.typed().trim();
    if (name) {
      this.overlay.addGame(name);
      this.typed.set('');
    }
  }

  private readSettings(): OverlaySettings {
    return this.overlay.state().settings;
  }

  private readLabel(): string {
    return this.settings().hotkey.replace('CommandOrControl', 'Ctrl');
  }

  private buildSizes(): SelectOption[] {
    return SIZES.map(this.toOption.bind(this));
  }

  private buildDisplays(): SelectOption[] {
    return DISPLAYS.map(this.toOption.bind(this));
  }

  private toOption(entry: { id: string; label: string }): SelectOption {
    return { value: entry.id, label: this.i18n.t(entry.label) };
  }

  /** Chooses the size of each tile. */
  protected setSize(value: string): void {
    const found = SIZES.find(function byId(entry) {
      return entry.id === value;
    });
    if (found) {
      this.overlay.set({ size: found.id });
    }
  }

  /** Builds the shortcut from the keys the person presses (at least one of Ctrl, Alt or Shift, and a letter, digit or F key). */
  protected onKey(event: KeyboardEvent): void {
    if (!this.listening()) {
      return;
    }
    event.preventDefault();
    if (event.key === 'Escape') {
      this.listening.set(false);
      return;
    }
    const key = event.key.toUpperCase();
    const modifiers: string[] = [];
    if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (modifiers.length === 0 || !SHORTCUT_KEY.test(key)) {
      return;
    }
    this.listening.set(false);
    this.overlay.set({ hotkey: [...modifiers, key].join('+') });
  }
}
