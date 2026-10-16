/**
 * src/app/shared/components/preset-try.component.ts
 * What goes with trying a preset of a message: while a theme is on the app as a try, a bar asks to keep it or go back; a profile
 * is looked at in a window (with a button to keep it, or to keep it and use it).
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { PresetService } from '../../core/services/preset.service';
import { ToastService } from '../../core/services/toast.service';
import { PresetThumbComponent } from '../../features/settings/preset-thumb.component';
import { BannerComponent } from './banner.component';
import { ModalComponent } from './modal.component';
import { NameColorDirective } from '../util/name-color.directive';
import { NameFxDirective } from '../util/name-fx.directive';
import { UserFontDirective } from '../util/user-font.directive';
import { describeError } from '../util/errors';
import { parseRichText } from '../util/rich-text';
import { RichTextComponent } from './rich-text.component';

/** The bar of a theme that is being tried, and the window of a profile that is being looked at. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-preset-try',
  standalone: true,
  imports: [
    BannerComponent,
    ModalComponent,
    NameColorDirective,
    NameFxDirective,
    PresetThumbComponent,
    RichTextComponent,
    TranslatePipe,
    UserFontDirective,
  ],
  template: `
    @if (presets.trying(); as state) {
      <div class="pointer-events-none fixed inset-x-0 bottom-5 z-[90] flex justify-center px-3">
        <div
          class="anim-pop pointer-events-auto flex max-w-full items-center gap-3 rounded-ui-lg border border-white/12 bg-ink-800 p-2.5 pr-3 shadow-2xl"
        >
          <app-preset-thumb [preset]="state.preset" />
          <span class="min-w-0 leading-tight">
            <span class="block text-[0.6875rem] text-muted">{{ 'You are trying' | t }}</span>
            <b class="block max-w-44 truncate text-sm">{{ state.preset.name }}</b>
          </span>
          <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="finish(false)">
            {{ 'Go back' | t }}
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            [disabled]="busy()"
            (click)="finish(true)"
          >
            {{ 'Keep it' | t }}
          </button>
        </div>
      </div>
    }
    @if (presets.previewing(); as preset) {
      <app-modal
        [title]="preset.name"
        [subtitle]="'Profile preset' | t"
        [width]="420"
        (closed)="presets.previewing.set(null)"
      >
        <div class="overflow-hidden rounded-ui-lg border border-white/10 bg-ink-900">
          <app-banner class="h-28" [color]="text('bannerColor')" />
          <div class="relative px-4 pb-4">
            <span
              class="-mt-9 flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-full border-4 border-ink-900 bg-ink-700 text-xl font-bold"
            >
              {{ preset.name.charAt(0).toUpperCase() }}
            </span>
            <h3
              class="mt-2 text-lg font-bold leading-tight"
              [appNameColor]="text('profileColor')"
              [appUserFont]="text('nameFont')"
              [nameFx]="text('nameFx')"
              fallback="var(--fg)"
            >
              {{ preset.name }}
            </h3>
            @if (text('pronouns')) {
              <p class="text-xs text-muted">{{ text('pronouns') }}</p>
            }
            @if (text('statusText')) {
              <p class="mt-1 text-sm text-muted">{{ text('statusText') }}</p>
            }
            @if (text('bio')) {
              <div class="mt-3 border-t border-white/8 pt-3 text-sm">
                <app-rich-text [segments]="bio()" />
              </div>
            }
          </div>
        </div>
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" class="btn btn-outline" (click)="presets.previewing.set(null)">
            {{ 'Close' | t }}
          </button>
          <button
            type="button"
            class="btn btn-soft-accent"
            [disabled]="busy()"
            (click)="keepProfile(false)"
          >
            {{ 'Import' | t }}
          </button>
          <button
            type="button"
            class="btn btn-accent-strong"
            [disabled]="busy()"
            (click)="keepProfile(true)"
          >
            {{ 'Import and use' | t }}
          </button>
        </div>
      </app-modal>
    }
  `,
})
export class PresetTryComponent {
  protected readonly presets = inject(PresetService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  protected readonly busy = signal(false);
  protected readonly bio = computed(
    function (this: PresetTryComponent) {
      return parseRichText(this.text('bio'));
    }.bind(this),
  );

  /** A text field of the profile that is looked at. */
  protected text(field: string): string {
    const value = this.presets.previewing()?.data[field];
    return typeof value === 'string' ? value : '';
  }

  /** The person keeps the theme they tried, or goes back. */
  protected async finish(keep: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await this.presets.finishTrying(keep);
      if (keep) {
        this.toast.success(this.i18n.t('Preset imported'));
      }
    } catch (e) {
      this.toast.error(this.i18n.t('Could not import the preset'), describeError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** The profile that was looked at is kept (and, when asked, put on the profile of the person). */
  protected async keepProfile(use: boolean): Promise<void> {
    const preset = this.presets.previewing();
    if (!preset) {
      return;
    }
    this.busy.set(true);
    try {
      await this.presets.keepOwned(preset, use);
      this.presets.previewing.set(null);
      this.toast.success(this.i18n.t(use ? 'Preset imported and applied' : 'Preset imported'));
    } catch (e) {
      this.toast.error(this.i18n.t('Could not import the preset'), describeError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
