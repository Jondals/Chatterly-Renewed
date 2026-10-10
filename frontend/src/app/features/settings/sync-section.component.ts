/**
 * src/app/features/settings/sync-section.component.ts
 * Settings - Sync: the settings of the person on their account (see settings-sync.service.ts). On this device they can follow
 * the account or stay only here, and they can keep several sets of settings and choose which one this device follows.
 */
import { Component, inject } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { DialogService } from '../../core/services/dialog.service';
import { SettingsSyncService, type SyncMode } from '../../core/services/settings-sync.service';
import { IconComponent } from '../../shared/components/icon.component';
import {
  SegmentedComponent,
  SettingRowComponent,
} from '../../shared/components/controls.component';

/** The settings of the account. */
@Component({
  selector: 'app-sync-section',
  standalone: true,
  imports: [IconComponent, SegmentedComponent, SettingRowComponent, TranslatePipe],
  template: `
    <div class="mb-6 flex gap-3 rounded-ui border border-accent/25 bg-accent/8 p-4 text-sm">
      <app-icon name="lock" class="mt-0.5 shrink-0 text-accent" />
      <p class="text-muted">
        <b class="text-fg">{{
          'Your settings are encrypted before they leave this device.' | t
        }}</b>
        {{
          'They are sealed with a key that comes from your identity: the server only keeps something it cannot read. The microphone, the speakers, the camera and the files you uploaded (fonts, cursors) stay on each device.'
            | t
        }}
      </p>
    </div>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'This device' | t }}</h2>
      <app-setting-row
        title="Settings of this device"
        hint="Follow your account, and everything you change here is saved there; or keep this device on its own."
      >
        <app-segmented
          [options]="modes"
          [value]="sync.mode()"
          (valueChange)="setMode($any($event))"
        />
      </app-setting-row>
      <p class="pb-3 text-xs text-muted">
        @switch (sync.status()) {
          @case ('saving') {
            {{ 'Saving…' | t }}
          }
          @case ('saved') {
            {{ 'Saved in your account.' | t }}
          }
          @case ('error') {
            {{
              'Could not reach your account. The settings stay on this device and are tried again.'
                | t
            }}
          }
        }
      </p>
    </section>

    @if (sync.mode() === 'account') {
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'Your sets of settings' | t }}</h2>
        <p class="pb-2 text-xs text-muted">
          {{
            'Keep different settings (one for the computer, one for the phone...) and choose the one each device follows.'
              | t
          }}
        </p>
        <div class="space-y-2 pb-3">
          @for (p of sync.profiles(); track p.id) {
            <div
              class="flex items-center gap-2 rounded-ui border px-3 py-2.5"
              [class]="
                sync.active() === p.id
                  ? 'border-accent bg-accent/10'
                  : 'border-white/10 bg-white/[.03]'
              "
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 text-left"
                (click)="sync.switchTo(p.id)"
              >
                <span
                  class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                  [class]="sync.active() === p.id ? 'border-accent' : 'border-white/30'"
                >
                  @if (sync.active() === p.id) {
                    <span class="h-2 w-2 rounded-full bg-accent"></span>
                  }
                </span>
                <span class="min-w-0 truncate text-sm font-semibold">{{ p.name }}</span>
                @if (sync.active() === p.id) {
                  <span class="chip chip-accent">{{ 'This device' | t }}</span>
                }
              </button>
              <button
                type="button"
                class="btn btn-icon btn-sm btn-ghost"
                [attr.aria-label]="'Rename' | t"
                [attr.title]="'Rename' | t"
                (click)="rename(p.id, p.name)"
              >
                <app-icon name="edit" [size]="13" />
              </button>
              @if (sync.active() !== p.id) {
                <button
                  type="button"
                  class="btn btn-icon btn-sm btn-ghost btn-soft-danger"
                  [attr.aria-label]="'Delete' | t"
                  [attr.title]="'Delete' | t"
                  (click)="sync.remove(p.id)"
                >
                  <app-icon name="trash" [size]="13" />
                </button>
              }
            </div>
          }
          <button type="button" class="btn btn-sm gap-1.5" (click)="create()">
            <app-icon name="plus" [size]="14" /> {{ 'New set from these settings' | t }}
          </button>
        </div>
      </section>
    }
  `,
})
export class SyncSectionComponent {
  protected readonly sync = inject(SettingsSyncService);
  private readonly dialog = inject(DialogService);
  private readonly i18n = inject(I18nService);
  protected readonly modes = [
    { id: 'account', label: 'My account' },
    { id: 'device', label: 'Only this device' },
  ];

  /** Chooses whether this device follows the account. */
  protected setMode(mode: SyncMode): void {
    void this.sync.setMode(mode);
  }

  /** Asks for a name and makes a new set from the settings of this device. */
  protected async create(): Promise<void> {
    const name = await this.dialog.prompt(
      this.i18n.t('New set of settings'),
      this.i18n.t('It starts with the settings this device has now, and this device follows it.'),
      '',
      this.i18n.t('Name'),
    );
    if (name) {
      await this.sync.create(name);
    }
  }

  /** Asks for a new name for a set. */
  protected async rename(id: string, current: string): Promise<void> {
    const name = await this.dialog.prompt(
      this.i18n.t('Rename'),
      this.i18n.t('The name of this set of settings.'),
      current,
      this.i18n.t('Name'),
    );
    if (name) {
      await this.sync.rename(id, name);
    }
  }
}
