/**
 * src/app/features/settings/presets.component.ts
 * The presets of the theme (the look of the app) or of the profile: save what the person has now with a name, apply a preset
 * in one press, update it, rename it, share it in the chat that is open (a friend gets it with one button) or delete it.
 */
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { MAX_PRESETS, PresetService } from '../../core/services/preset.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { ImageService } from '../../core/services/image.service';
import {
  PRESET_NAME_MAX,
  THUMB_SIZE,
  type AssetName,
  type Preset,
  type PresetKind,
} from '../../core/preset';
import { IconComponent } from '../../shared/components/icon.component';
import { PresetThumbComponent } from './preset-thumb.component';
import { describeError } from '../../shared/util/errors';

/** The label of each custom piece a preset can carry. */
const ASSET_LABELS: Record<AssetName, string> = {
  wallpaper: 'Wallpaper',
  fontUi: 'Font',
  fontName: 'Name font',
  avatar: 'Picture',
  banner: 'Banner',
  thumb: 'Picture',
};

/** The list of presets of one kind. */
@Component({
  selector: 'app-presets',
  standalone: true,
  imports: [IconComponent, PresetThumbComponent, TranslatePipe],
  template: `
    <p class="mb-3 text-xs text-muted">
      {{
        kind() === 'theme'
          ? ('Save how the app looks now (colors, fonts, wallpaper, cursor...) with a name, and bring it back in one press. You can share it in a chat: a friend gets it with one button.'
            | t)
          : ('Save how your profile looks now (colors, effect, name animation, About me, pictures...) with a name, and bring it back in one press. You can share it in a chat.'
            | t)
      }}
    </p>
    <form class="mb-3 flex gap-2" (submit)="saveNew($event)">
      <input
        class="input min-w-0 flex-1"
        [maxLength]="nameMax"
        [value]="name()"
        [placeholder]="'Name of the preset' | t"
        [attr.aria-label]="'Name of the preset' | t"
        (input)="name.set($any($event.target).value)"
      />
      <button
        class="btn btn-primary shrink-0 gap-1.5"
        type="submit"
        [disabled]="!name().trim() || busy() || full()"
      >
        <app-icon name="plus" [size]="14" /> {{ 'Save what I have now' | t }}
      </button>
    </form>
    @if (list().length === 0) {
      <p class="rounded-ui border border-dashed border-white/10 p-4 text-center text-xs text-dim">
        {{ 'You have no presets of this kind yet.' | t }}
      </p>
    } @else {
      <div class="space-y-2">
        @for (p of list(); track p.id) {
          <div class="rounded-ui border border-white/8 bg-white/[.03] p-3">
            <div class="flex items-center gap-3">
              <app-preset-thumb [preset]="p" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold">{{ p.name }}</span>
                <span class="block truncate text-[0.6875rem] text-muted">
                  {{ pieces(p) }}
                </span>
              </span>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                [disabled]="busy()"
                (click)="apply(p)"
              >
                {{ 'Apply' | t }}
              </button>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                class="btn btn-sm btn-ghost gap-1"
                [disabled]="busy()"
                (click)="update(p)"
              >
                <app-icon name="refresh" [size]="13" /> {{ 'Update with what I have now' | t }}
              </button>
              <button type="button" class="btn btn-sm btn-ghost gap-1" (click)="rename(p)">
                <app-icon name="edit" [size]="13" /> {{ 'Rename' | t }}
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost gap-1"
                [disabled]="busy()"
                (click)="pickPicture(p)"
              >
                <app-icon name="image" [size]="13" /> {{ 'Change picture' | t }}
              </button>
              @if (p.assets.thumb) {
                <button type="button" class="btn btn-sm btn-ghost gap-1" (click)="dropPicture(p)">
                  <app-icon name="x" [size]="13" /> {{ 'Default picture' | t }}
                </button>
              }
              <button
                type="button"
                class="btn btn-sm btn-ghost btn-soft-danger gap-1"
                (click)="remove(p)"
              >
                <app-icon name="trash" [size]="13" /> {{ 'Delete' | t }}
              </button>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class PresetsComponent {
  readonly kind = input.required<PresetKind>();
  /** A profile preset was applied: its fields go to the form (the person saves them). */
  readonly profileApplied = output<Record<string, unknown>>();

  private readonly presets = inject(PresetService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly images = inject(ImageService);
  private readonly i18n = inject(I18nService);

  protected readonly nameMax = PRESET_NAME_MAX;
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly list = computed(this.listOfKind.bind(this));
  protected readonly full = computed(this.isFull.bind(this));

  constructor() {
    void this.presets.load();
  }

  /** The presets of this kind. */
  private listOfKind(): Preset[] {
    const kind = this.kind();
    return this.presets.presets().filter(function same(preset) {
      return preset.kind === kind;
    });
  }

  /** Whether there is no room for another one. */
  private isFull(): boolean {
    return this.list().length >= MAX_PRESETS;
  }

  /** What a preset carries besides its settings, in words. */
  protected pieces(preset: Preset): string {
    const labels: string[] = [];
    for (const asset of Object.keys(preset.assets) as AssetName[]) {
      labels.push(this.i18n.t(ASSET_LABELS[asset]));
    }
    const names = labels;
    const date = new Date(preset.createdAt).toLocaleDateString();
    return names.length ? date + ' · ' + names.join(', ') : date;
  }

  /** Runs an action that may fail, showing the problem. */
  private async guarded(failure: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      this.toast.error(this.i18n.t(failure), describeError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Saves what the person has now as a new preset. */
  protected async saveNew(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.name().trim();
    if (!name) {
      return;
    }
    await this.guarded('Could not save the preset', async () => {
      await this.presets.capture(this.kind(), name);
      this.name.set('');
      this.toast.success(this.i18n.t('Preset saved'));
    });
  }

  /** Puts a preset on. */
  protected async apply(preset: Preset): Promise<void> {
    await this.guarded('Could not apply the preset', async () => {
      if (preset.kind === 'theme') {
        await this.presets.applyTheme(preset);
        this.toast.success(this.i18n.t('Preset applied'), preset.name);
      } else {
        const fields = await this.presets.applyProfile(preset);
        this.profileApplied.emit(fields);
        this.toast.success(
          this.i18n.t('Preset applied'),
          this.i18n.t('Press Save to keep the changes of your profile.'),
        );
      }
    });
  }

  /** Makes the preset be what the person has now. */
  protected async update(preset: Preset): Promise<void> {
    const ok = await this.dialog.confirm(
      this.i18n.t('Update "{name}"?', { name: preset.name }),
      this.i18n.t('The preset will keep what you have now, in place of what it had.'),
      { confirmLabel: this.i18n.t('Update') },
    );
    if (!ok) {
      return;
    }
    await this.guarded('Could not save the preset', async () => {
      await this.presets.capture(preset.kind, preset.name, preset.id);
      this.toast.success(this.i18n.t('Preset updated'));
    });
  }

  /** Asks for a new name. */
  protected async rename(preset: Preset): Promise<void> {
    const name = await this.dialog.prompt(
      this.i18n.t('Rename'),
      this.i18n.t('The name of this preset.'),
      preset.name,
      this.i18n.t('Name'),
    );
    if (name) {
      await this.presets.rename(preset.id, name);
    }
  }

  /** Lets the person choose the picture of the preset (it is cut to the size of the picture and made light). */
  protected async pickPicture(preset: Preset): Promise<void> {
    await this.guarded('Could not use that picture', async () => {
      const file = await this.images.pickFile();
      if (file) {
        await this.presets.setThumb(preset.id, await this.images.process(file, THUMB_SIZE));
      }
    });
  }

  /** Goes back to the picture drawn from the preset. */
  protected async dropPicture(preset: Preset): Promise<void> {
    await this.presets.setThumb(preset.id, null);
  }

  /** Deletes a preset after asking. */
  protected async remove(preset: Preset): Promise<void> {
    const ok = await this.dialog.confirm(
      this.i18n.t('Delete "{name}"?', { name: preset.name }),
      this.i18n.t(
        'The preset is deleted from this device. Whoever you shared it with keeps theirs.',
      ),
      { danger: true, confirmLabel: this.i18n.t('Delete') },
    );
    if (ok) {
      await this.presets.remove(preset.id);
    }
  }
}
