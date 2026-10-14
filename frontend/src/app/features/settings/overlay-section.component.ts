/**
 * src/app/features/settings/overlay-section.component.ts
 * Settings - Game overlay (desktop app only): the people of your call drawn over the game you are playing. Here the person
 * turns it on, chooses the shortcut that lets them move and resize the panel, what it shows and how it looks.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import type { OverlaySettings, OverlaySize } from '../../core/desktop-bridge';
import { OverlayService } from '../../core/services/overlay.service';
import { SettingRowComponent, ToggleComponent } from '../../shared/components/controls.component';
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

/** Settings > Game overlay. */
@Component({
  selector: 'app-overlay-section',
  standalone: true,
  imports: [SelectComponent, SettingRowComponent, ToggleComponent, TranslatePipe],
  template: `
    <section class="settings-card">
      <app-setting-row
        title="Show my call over my game"
        hint="Draws the cameras and the pictures of the people in your call, and who is talking, over the games you play. It never reads or changes the game."
      >
        <app-toggle
          [checked]="settings().enabled"
          (checkedChange)="overlay.set({ enabled: $event })"
          [label]="'Show my call over my game' | t"
        />
      </app-setting-row>
      <p class="mt-3 text-xs text-dim">
        {{
          'It appears over games in window or borderless mode. A game in exclusive full screen owns the monitor and nothing can be drawn over it: choose borderless in its video options.'
            | t
        }}
      </p>
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
        hint="Your friends' cameras do not appear if you record your game or share your screen."
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
  private readonly i18n = inject(I18nService);

  /** True while the button waits for the keys of a new shortcut. */
  protected readonly listening = signal(false);
  protected readonly settings = computed(this.readSettings.bind(this));

  protected readonly sizeOptions = computed(this.buildSizes.bind(this));
  protected readonly displayOptions = computed(this.buildDisplays.bind(this));

  /** The shortcut as the person reads it ("Ctrl+Shift+O"). */
  protected readonly shortcutLabel = computed(this.readLabel.bind(this));

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
