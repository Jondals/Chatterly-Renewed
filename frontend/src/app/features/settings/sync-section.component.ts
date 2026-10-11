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

/** The settings of the account. */
@Component({
  selector: 'app-sync-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <!-- what this is, in two lines, and how it is going -->
    <div class="mb-6 flex gap-3 rounded-ui border border-accent/25 bg-accent/8 p-4 text-sm">
      <app-icon name="lock" class="mt-0.5 shrink-0 text-accent" />
      <div class="min-w-0 flex-1">
        <b class="block text-fg">{{ 'Take your settings everywhere' | t }}</b>
        <p class="mt-1 text-muted">
          {{
            'Sign in on your phone and it looks and sounds like on your computer. Your settings are encrypted before they leave this device: the server only keeps something it cannot read.'
              | t
          }}
        </p>
        <p class="mt-2 flex items-center gap-2 text-xs font-semibold">
          @switch (sync.status()) {
            @case ('saving') {
              <span class="chip">{{ 'Saving…' | t }}</span>
            }
            @case ('saved') {
              <span class="chip chip-accent">{{ 'Saved in your account.' | t }}</span>
            }
            @case ('error') {
              <span class="chip chip-amber">{{
                'Could not reach your account. The settings stay on this device and are tried again.'
                  | t
              }}</span>
            }
            @default {
              <span class="chip">{{ 'Up to date' | t }}</span>
            }
          }
        </p>
      </div>
    </div>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'On this device' | t }}</h2>
      <div class="grid gap-2 pb-3 sm:grid-cols-2">
        @for (mode of modes; track mode.id) {
          <button
            type="button"
            class="choice-card !items-start text-left"
            [class.is-on]="sync.mode() === mode.id"
            (click)="setMode(mode.id)"
          >
            <span class="flex items-center gap-2 text-sm font-semibold">
              <app-icon [name]="mode.icon" [size]="15" /> {{ mode.label | t }}
            </span>
            <span class="text-xs font-normal text-muted">{{ mode.hint | t }}</span>
          </button>
        }
      </div>
      <p class="pb-3 text-xs text-dim">
        {{
          'Never copied: the microphone, the speakers, the camera and the files you uploaded (fonts, cursors). They stay on each device.'
            | t
        }}
      </p>
    </section>

    @if (sync.mode() === 'account') {
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'Configurations' | t }}</h2>
        <p class="pb-2 text-xs text-muted">
          {{
            'A configuration is a full copy of your settings with a name, for example "Computer" and "Phone". Each device uses one: what you change here changes that one. Press another to make this device use it.'
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
                  <span class="chip chip-accent shrink-0">{{ 'In use on this device' | t }}</span>
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
          <button type="button" class="btn btn-sm mt-4 gap-1.5" (click)="create()">
            <app-icon name="plus" [size]="14" /> {{ 'New configuration from these settings' | t }}
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
  protected readonly modes: { id: SyncMode; label: string; hint: string; icon: string }[] = [
    {
      id: 'account',
      label: 'Follow my account',
      hint: 'What you change here is saved in your account and reaches your other devices.',
      icon: 'refresh',
    },
    {
      id: 'device',
      label: 'Only this device',
      hint: 'Nothing is sent or received: this device keeps its own settings.',
      icon: 'monitor',
    },
  ];

  /** Chooses whether this device follows the account. */
  protected setMode(mode: SyncMode): void {
    void this.sync.setMode(mode);
  }

  /** Asks for a name and makes a new set from the settings of this device. */
  protected async create(): Promise<void> {
    const name = await this.dialog.prompt(
      this.i18n.t('New configuration'),
      this.i18n.t('It starts with the settings this device has now, and this device uses it.'),
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
      this.i18n.t('The name of this configuration.'),
      current,
      this.i18n.t('Name'),
    );
    if (name) {
      await this.sync.rename(id, name);
    }
  }
}
