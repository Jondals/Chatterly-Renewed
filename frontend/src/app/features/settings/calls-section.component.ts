/**
 * src/app/features/settings/calls-section.component.ts
 * Settings - Calls: everything about calls in one place - what rings, how a shared screen starts, and (Android) how calls reach
 * the phone. The devices, the microphone and the camera stay in Voice & video.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { ANDROID_APP } from '../../core/config';
import { NativeCallService } from '../../core/services/native-call.service';
import { SettingsService } from '../../core/services/settings.service';
import {
  SettingRowComponent,
  ToggleComponent,
} from '../../shared/components/controls.component';
import { screenQualities, screenQuality } from '../../core/screen-quality';
import { SelectComponent, type SelectOption } from '../../shared/components/select.component';
import { GeneralSectionComponent } from './general-section.component';

/** The settings of calls. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-calls-section',
  standalone: true,
  imports: [
    TranslatePipe,
    SelectComponent,
    SettingRowComponent,
    ToggleComponent,
    GeneralSectionComponent,
  ],
  template: `
    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Sharing the screen' | t }}</h2>
      <app-setting-row
        title="Quality"
        hint="The size and the pictures per second of the screen you share. More is sharper and smoother, and uses more data."
      >
        <app-select
          class="w-40 max-w-full"
          label="Quality"
          [options]="qualities"
          [value]="current()"
          (valueChange)="setQuality($any($event))"
        />
      </app-setting-row>
      <app-setting-row title="Share the sound too" hint="The sound of what you share, when it can be captured.">
        <app-toggle
          [checked]="s.screenShare().audio"
          (checkedChange)="setAudio($event)"
          [label]="'Share the sound too' | t"
        />
      </app-setting-row>
    </section>

    <app-general-section mode="calls" />

    @if (android) {
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'On this phone' | t }}</h2>
        <app-setting-row
          title="Calls in the background"
          hint="Keeps Chatterly connected with a fixed notification, so calls ring with the app minimized or the screen off. Off: no notification, and calls ring only with the app open."
        >
          <app-toggle
            [checked]="s.backgroundCalls()"
            (checkedChange)="s.backgroundCalls.set($event)"
            [label]="'Calls in the background' | t"
          />
        </app-setting-row>
        @if (!nativeCall.fullScreenAllowed()) {
          <app-setting-row
            title="Calls over the lock screen"
            hint="Android asks you to allow it: then a call that rings fills the screen, like a phone call, even with the phone locked."
          >
            <button
              type="button"
              class="btn btn-sm btn-primary"
              (click)="nativeCall.openFullScreenSettings()"
            >
              {{ 'Allow' | t }}
            </button>
          </app-setting-row>
        }
      </section>
    }
  `,
})
export class CallsSectionComponent {
  protected readonly s = inject(SettingsService);
  protected readonly nativeCall = inject(NativeCallService);
  protected readonly android = ANDROID_APP;
  protected readonly qualities: SelectOption[] = screenQualities(ANDROID_APP).map(
    function option(entry): SelectOption {
      return { value: entry.id, label: entry.label };
    },
  );

  /** The quality chosen, whatever an older version saved. */
  protected current(): string {
    return screenQuality(this.s.screenShare().quality, ANDROID_APP).id;
  }

  /** Chooses the quality the menu of sharing starts with. */
  protected setQuality(id: string): void {
    this.s.screenShare.update(function merge(current) {
      return { ...current, quality: id };
    });
  }

  /** Chooses whether the sound is shared by default. */
  protected setAudio(audio: boolean): void {
    this.s.screenShare.update(function merge(current) {
      return { ...current, audio };
    });
  }
}
