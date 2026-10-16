/**
 * src/app/features/settings/sync-section.component.ts
 * Settings - Sync: the settings of the person on their account (see settings-sync.service.ts). On this device they can follow
 * the account or stay only here, and they can keep several sets of settings and choose which one this device follows.
 */
import { Component, inject } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { DialogService } from '../../core/services/dialog.service';
import { SettingsSyncService, type SyncMode } from '../../core/services/settings-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { VaultService } from '../../core/services/vault.service';
import { LibrarySyncService } from '../../core/services/library-sync.service';
import { SettingsService } from '../../core/services/settings.service';
import { IconComponent } from '../../shared/components/icon.component';
import { SettingRowComponent, ToggleComponent } from '../../shared/components/controls.component';

/** The settings of the account. */
@Component({
  selector: 'app-sync-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe, SettingRowComponent, ToggleComponent],
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
          'Never copied: the microphone, the speakers, the camera, fonts and cursors. They stay on each device.'
            | t
        }}
      </p>
    </section>

    @if (sync.mode() === 'account') {
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'What is synced' | t }}</h2>
        <p class="pb-3 text-xs text-muted">
          {{
            'Settings, stickers, presets, your sounds and camera backgrounds. Encrypted on this device first: the server only keeps something it cannot read.'
              | t
          }}
        </p>
        <div class="flex flex-wrap items-center gap-2 pb-3 text-xs">
          @switch (library.status()) {
            @case ('working') {
              <span class="chip">{{ 'Syncing…' | t }}</span>
            }
            @case ('synced') {
              <span class="chip chip-accent">{{ 'Everything is in your account.' | t }}</span>
            }
            @case ('full') {
              <span class="chip chip-amber">{{
                'Your account is full: what does not fit stays on this device.' | t
              }}</span>
            }
            @case ('error') {
              <span class="chip chip-amber">{{
                'Could not reach your account. It is tried again with the next change.' | t
              }}</span>
            }
            @default {
              <span class="chip">{{ 'Waiting for your account…' | t }}</span>
            }
          }
          <button type="button" class="btn btn-sm gap-1.5" (click)="library.syncNow()">
            <app-icon name="refresh" [size]="13" /> {{ 'Sync now' | t }}
          </button>
        </div>
        <div class="pb-3">
          <div class="mb-1 flex justify-between text-xs text-muted">
            <span>{{ 'In your account' | t }}</span>
            <span class="font-mono">{{ usedText() }}</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              class="h-full rounded-full bg-accent transition-[width] duration-500"
              [style.width.%]="usedPercent()"
            ></div>
          </div>
        </div>
        @if (deviceCount() > 0) {
          <div
            class="mb-3 flex flex-wrap items-center gap-2 rounded-ui bg-white/[.04] px-3 py-2 text-xs text-muted"
          >
            <span class="min-w-0 flex-1">{{ 'Some backgrounds are only on this device.' | t }}</span>
            <button type="button" class="btn btn-sm" (click)="moveToAccount()">
              {{ 'Move them to my account' | t }}
            </button>
          </div>
        }
        <app-setting-row
          title="Keep them on this device when I sign out"
          hint="Signing out then erases only your session and your keys. If another account signs in here, everything is erased first."
        >
          <app-toggle
            [checked]="settings.keepOnSignOut()"
            (checkedChange)="settings.keepOnSignOut.set($event)"
            [label]="'Keep them on this device when I sign out' | t"
          />
        </app-setting-row>
        <button
          type="button"
          class="btn btn-sm btn-soft-danger mt-3 gap-1.5"
          [disabled]="accountCount() === 0"
          (click)="removeAll()"
        >
          <app-icon name="trash" [size]="13" /> {{ 'Remove everything from my account' | t }}
        </button>
      </section>
    }

    @if (sync.mode() === 'account') {
      <details class="settings-card">
        <summary class="settings-card-title cursor-pointer">{{ 'Configurations' | t }}</summary>
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
      </details>
    }
  `,
})
export class SyncSectionComponent {
  protected readonly sync = inject(SettingsSyncService);
  protected readonly vault = inject(VaultService);
  protected readonly library = inject(LibrarySyncService);
  protected readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
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

  /** How many items are only on this device. */
  protected deviceCount(): number {
    return this.vault.items().filter(function onDevice(item) {
      return item.where === 'device';
    }).length;
  }

  /** How many items are in the account. */
  protected accountCount(): number {
    return this.vault.items().length - this.deviceCount();
  }

  /** What the account uses, in words. */
  protected usedText(): string {
    const limits = this.vault.limits();
    const mb = function megabytes(bytes: number): string {
      return (bytes / (1024 * 1024)).toFixed(1);
    };
    return (
      mb(this.vault.used()) +
      ' / ' +
      mb(limits.totalBytes) +
      ' MB · ' +
      this.accountCount() +
      ' / ' +
      limits.items
    );
  }

  /** What the account uses, as a share of what it allows. */
  protected usedPercent(): number {
    return Math.min(100, (this.vault.used() / this.vault.limits().totalBytes) * 100);
  }

  /** Moves what is only on this device to the account. */
  protected async moveToAccount(): Promise<void> {
    const moved = await this.vault.moveDeviceToAccount();
    this.toast.success(this.i18n.t('Moved to your account'), String(moved));
  }

  /** Asks and removes everything of the library from the account. */
  protected async removeAll(): Promise<void> {
    const sure = await this.dialog.confirm(
      this.i18n.t('Remove everything from my account'),
      this.i18n.t(
        'Every picture and GIF of your library that is in your account will be deleted. This cannot be undone.',
      ),
      { confirmLabel: this.i18n.t('Remove'), danger: true },
    );
    if (!sure) {
      return;
    }
    try {
      await this.vault.removeAllFromAccount();
    } catch {
      this.toast.error(this.i18n.t('Could not remove it'), this.i18n.t('Try again.'));
    }
  }

  /** Chooses whether this device follows the account, for everything at once. */
  protected setMode(mode: SyncMode): void {
    // One choice for everything: the settings, the stickers, presets and sounds, and the camera backgrounds.
    this.library.enabled.set(mode === 'account');
    this.vault.inAccount.set(mode === 'account');
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
