/**
 * src/app/features/settings/updates-section.component.ts
 * Settings - Updates (desktop app only): the state of the update with the buttons to check, download and restart, how
 * often the app looks for a new version, and whether it should tell the person.
 */
import { Component, computed, inject } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { BetaService } from '../../core/services/beta.service';
import {
  DesktopUpdateService,
  type DesktopUpdateStatus,
  type UpdateInterval,
} from '../../core/services/desktop-update.service';
import { SettingRowComponent, ToggleComponent } from '../../shared/components/controls.component';
import { IconComponent } from '../../shared/components/icon.component';
import { SelectComponent, type SelectOption } from '../../shared/components/select.component';
import { APP_VERSION } from '../../version';

/** The ways to choose how often to look. */
const INTERVALS: { id: UpdateInterval; label: string }[] = [
  { id: '1h', label: 'Every hour' },
  { id: '6h', label: 'Every 6 hours' },
  { id: '12h', label: 'Every 12 hours' },
  { id: '24h', label: 'Every day' },
  { id: 'start', label: 'Only when it starts' },
  { id: 'never', label: 'Only when I ask' },
];

/** Settings > Updates. Nothing here downloads or installs without the person pressing a button. */
@Component({
  selector: 'app-updates-section',
  standalone: true,
  imports: [IconComponent, SelectComponent, SettingRowComponent, ToggleComponent, TranslatePipe],
  template: `
    <section class="settings-card">
      <div class="flex flex-wrap items-center gap-4">
        <span
          class="grid h-12 w-12 shrink-0 place-items-center rounded-ui bg-accent/15 text-accent"
        >
          <app-icon [name]="icon()" [size]="22" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-base font-bold">{{ headline() }}</div>
          <div class="text-xs text-muted">Chatterly v{{ version }} · {{ lastChecked() }}</div>
        </div>
        @switch (status()) {
          @case ('available') {
            <button type="button" class="btn btn-primary" (click)="update.download()">
              <app-icon name="download" [size]="16" /> {{ 'Download' | t }}
              @if (update.state().total > 0) {
                ({{ update.megabytes(update.state().total) }})
              }
            </button>
          }
          @case ('ready') {
            <button type="button" class="btn btn-primary" (click)="update.install()">
              <app-icon name="spin" [size]="16" /> {{ 'Restart and update' | t }}
            </button>
          }
          @case ('downloading') {
            <span class="text-sm text-muted">{{ update.state().percent }}%</span>
          }
          @default {
            <button
              type="button"
              class="btn"
              [disabled]="status() === 'checking'"
              (click)="update.check()"
            >
              <app-icon name="spin" [size]="16" /> {{ 'Check for updates' | t }}
            </button>
          }
        }
      </div>
      @if (status() === 'downloading') {
        <div
          class="mt-4 h-2 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          [attr.aria-valuenow]="update.state().percent"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full rounded-full bg-accent transition-all"
            [style.width.%]="update.state().percent"
          ></div>
        </div>
        @if (update.state().total > 0) {
          <div class="mt-1.5 text-xs text-muted">
            {{ update.megabytes(update.state().transferred) }} /
            {{ update.megabytes(update.state().total) }}
          </div>
        }
      }
      @if (status() === 'error') {
        <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span class="text-muted">{{ 'The update could not be downloaded' | t }}</span>
          <button type="button" class="btn btn-sm" (click)="update.download()">
            {{ 'Try again' | t }}
          </button>
        </div>
      }
      @if (status() === 'ready') {
        <p class="mt-3 text-xs text-muted">
          {{
            (update.state().settings.auto
              ? 'It will be installed when you close Chatterly, or now if you restart.'
              : 'Chatterly will close and open again with the new version.'
            ) | t
          }}
        </p>
      }
    </section>

    <section class="settings-card mt-4">
      <h2 class="settings-card-title">{{ 'Preferences' | t }}</h2>
      <app-setting-row
        title="Look for updates"
        hint="How often Chatterly checks if there is a new version. Unless you turn on Update by itself, it only looks."
      >
        <app-select
          class="w-56 max-w-full"
          label="Look for updates"
          [options]="intervalOptions()"
          [value]="update.state().settings.interval"
          (valueChange)="setInterval($event)"
        />
      </app-setting-row>
      <app-setting-row
        title="Update by itself"
        hint="Downloads a new version as soon as it appears and installs it when you close Chatterly. It never restarts the app on its own, so a call is never cut."
      >
        <app-toggle
          [checked]="update.state().settings.auto"
          (checkedChange)="update.setSettings({ auto: $event })"
          [label]="'Update by itself' | t"
        />
      </app-setting-row>
      <app-setting-row
        title="Tell me about new versions"
        hint="Shows a notice and a card in the notifications of the bell. If you turn it off, you can still update from here."
      >
        <app-toggle
          [checked]="update.state().settings.notify"
          (checkedChange)="update.setSettings({ notify: $event })"
          [label]="'Tell me about new versions' | t"
        />
      </app-setting-row>
      @if (beta.beta() || update.state().settings.beta) {
        <app-setting-row
          title="Beta versions"
          hint="You are a beta tester: also receive the versions that are still being tried. They can have mistakes; tell the administrator what breaks."
        >
          <app-toggle
            [checked]="update.state().settings.beta"
            (checkedChange)="update.setSettings({ beta: $event })"
            [label]="'Beta versions' | t"
          />
        </app-setting-row>
      }
    </section>

    <p class="mt-4 text-xs text-dim">
      {{
        'Updates come from the releases of the project and are checked before they are used.' | t
      }}
    </p>
  `,
})
export class UpdatesSectionComponent {
  protected readonly update = inject(DesktopUpdateService);
  protected readonly beta = inject(BetaService);
  private readonly i18n = inject(I18nService);
  /** The ways to choose how often to look, in the language of the person. */
  protected readonly intervalOptions = computed(
    function (this: UpdatesSectionComponent): SelectOption[] {
      return INTERVALS.map(
        function toOption(
          this: UpdatesSectionComponent,
          entry: { id: UpdateInterval; label: string },
        ): SelectOption {
          return { value: entry.id, label: this.i18n.t(entry.label) };
        }.bind(this),
      );
    }.bind(this),
  );
  protected readonly version = APP_VERSION;
  protected readonly status = computed(
    function (this: UpdatesSectionComponent): DesktopUpdateStatus {
      return this.update.state().status;
    }.bind(this),
  );

  /** The icon that goes with the state. */
  protected readonly icon = computed(
    function (this: UpdatesSectionComponent): string {
      switch (this.status()) {
        case 'available':
        case 'downloading':
          return 'download';
        case 'ready':
          return 'spin';
        case 'error':
          return 'info';
        default:
          return 'check';
      }
    }.bind(this),
  );

  /** The state in words. */
  protected readonly headline = computed(
    function (this: UpdatesSectionComponent): string {
      const state = this.update.state();
      switch (state.status) {
        case 'checking':
          return this.i18n.t('Checking…');
        case 'available':
          return this.i18n.t('Chatterly {v} is available', { v: state.version });
        case 'downloading':
          return this.i18n.t('Downloading… {n}%', { n: state.percent });
        case 'ready':
          return this.i18n.t('Chatterly {v} is ready to install', { v: state.version });
        case 'error':
          return this.i18n.t('The update could not be downloaded');
        default:
          return this.i18n.t('You have the latest version');
      }
    }.bind(this),
  );

  /** When it last looked. */
  protected readonly lastChecked = computed(
    function (this: UpdatesSectionComponent): string {
      const when = this.update.state().lastCheck;
      return when > 0
        ? this.i18n.t('Last checked {time}', { time: new Date(when).toLocaleString() })
        : this.i18n.t('Not checked yet');
    }.bind(this),
  );

  /** Chooses how often to look. */
  protected setInterval(value: string): void {
    const found = INTERVALS.find(function byId(entry) {
      return entry.id === value;
    });
    if (found) {
      this.update.setSettings({ interval: found.id });
    }
  }
}
