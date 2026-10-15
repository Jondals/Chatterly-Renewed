/**
 * src/app/features/settings/android-updates-section.component.ts
 * Settings - Updates in the Android app: the installed version, look for a new one, download it and open the installer
 * of Android, and the update channel (Release or Beta) for testers. Nothing is downloaded or installed without a press.
 */
import { Component, computed, inject } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import {
  AndroidUpdateService,
  type AndroidUpdateStatus,
} from '../../core/services/android-update.service';
import { BetaService } from '../../core/services/beta.service';
import { SettingRowComponent } from '../../shared/components/controls.component';
import { IconComponent } from '../../shared/components/icon.component';
import { SelectComponent, type SelectOption } from '../../shared/components/select.component';
import { APP_LABEL } from '../../version';

/** What the card says for each state. */
const HEADLINES: Record<AndroidUpdateStatus, string> = {
  idle: 'Updates',
  checking: 'Looking for updates…',
  none: 'Chatterly is up to date',
  available: 'A new version is available',
  downloading: 'Downloading the update…',
  ready: 'The update is ready to install',
  error: 'The update could not be completed',
};

/** Settings > Updates (Android app). */
@Component({
  selector: 'app-android-updates-section',
  standalone: true,
  imports: [IconComponent, SelectComponent, SettingRowComponent, TranslatePipe],
  template: `
    <section class="settings-card">
      <div class="flex items-center gap-4">
        <span
          class="grid h-12 w-12 shrink-0 place-items-center rounded-ui bg-accent/15 text-accent"
        >
          <app-icon
            [name]="status() === 'available' || status() === 'ready' ? 'download' : 'info'"
            [size]="22"
          />
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-base font-bold">{{ headline() | t }}</div>
          <div class="text-xs text-muted">
            Chatterly v{{ version }}
            @if (update.found() && (status() === 'available' || status() === 'ready')) {
              → v{{ update.found() }}
            }
          </div>
        </div>
      </div>
      <!-- On the phone the button goes under the text, the whole width (easy to press, the title is not squeezed). -->
      <div class="mt-4 flex">
        @switch (status()) {
          @case ('available') {
            <button
              type="button"
              class="btn btn-primary w-full justify-center"
              (click)="update.download()"
            >
              <app-icon name="download" [size]="16" /> {{ 'Download' | t }}
            </button>
          }
          @case ('ready') {
            <button
              type="button"
              class="btn btn-primary w-full justify-center"
              (click)="update.install()"
            >
              <app-icon name="download" [size]="16" /> {{ 'Install' | t }}
            </button>
          }
          @default {
            <button
              type="button"
              class="btn w-full justify-center"
              [disabled]="status() === 'checking' || status() === 'downloading'"
              (click)="update.check()"
            >
              <app-icon name="spin" [size]="16" /> {{ 'Check for updates' | t }}
            </button>
          }
        }
      </div>
      @if (update.problem()) {
        <p class="mt-3 text-sm text-muted">{{ update.problem() | t }}</p>
      }
      @if (status() === 'ready') {
        <p class="mt-3 text-xs text-muted">
          {{
            'Android will ask you to confirm. The first time, it asks to allow Chatterly to install apps.'
              | t
          }}
        </p>
      }
    </section>

    @if (showChannel()) {
      <section class="settings-card mt-4">
        <h2 class="settings-card-title">{{ 'Preferences' | t }}</h2>
        <app-setting-row
          title="Update channel"
          hint="Release is the version everybody gets. Beta also gives you the versions that are still being tried: they can have mistakes, tell the administrator what breaks."
        >
          <app-select
            class="w-48 max-w-full"
            label="Update channel"
            [options]="channelOptions()"
            [value]="update.beta() ? 'beta' : 'release'"
            (valueChange)="setChannel($event)"
          />
        </app-setting-row>
      </section>
    }

    <p class="mt-4 text-xs text-dim">
      {{
        'Before it is installed, the app checks that the new version is Chatterly, newer, and signed by the same author; Android checks it again.'
          | t
      }}
    </p>
  `,
})
export class AndroidUpdatesSectionComponent {
  protected readonly update = inject(AndroidUpdateService);
  private readonly beta = inject(BetaService);
  private readonly i18n = inject(I18nService);
  protected readonly version = APP_LABEL;
  protected readonly status = this.update.status;
  /** What the card says now. */
  protected readonly headline = computed(
    function (this: AndroidUpdatesSectionComponent): string {
      return HEADLINES[this.status()];
    }.bind(this),
  );
  /** The channel choice: for a tester or administrator, or for somebody who runs a beta (to go back to Release). */
  protected readonly showChannel = computed(
    function (this: AndroidUpdatesSectionComponent): boolean {
      return this.beta.canUseBeta() || this.update.beta() || APP_LABEL.includes('-b');
    }.bind(this),
  );
  /** Release or Beta, in the language of the person. */
  protected readonly channelOptions = computed(
    function (this: AndroidUpdatesSectionComponent): SelectOption[] {
      return [
        { value: 'release', label: this.i18n.t('Release') },
        { value: 'beta', label: this.i18n.t('Beta') },
      ];
    }.bind(this),
  );

  /** Changes the channel and looks again in the new one. */
  protected setChannel(value: string): void {
    this.update.beta.set(value === 'beta');
    void this.update.check();
  }
}
