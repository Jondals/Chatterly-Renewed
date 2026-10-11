/**
 * src/app/features/settings/profile-section.component.ts
 * Settings - My profile: pictures, banner, name style, avatar ring and personal details.
 */
import {
  Component,
  ElementRef,
  EnvironmentInjector,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ServerTagPickerComponent } from './server-tag-picker.component';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { DeleteAccountComponent } from './delete-account.component';
import type { AuraId, NameFont, User } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { DirectoryService } from '../../core/services/directory.service';
import { FontService } from '../../core/services/font.service';
import { SettingsService } from '../../core/services/settings.service';
import { ImageService } from '../../core/services/image.service';
import { ProfileDraftStore, type ProfileDraft } from '../../core/services/profile-draft.store';
import { ToastService } from '../../core/services/toast.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { BannerComponent } from '../../shared/components/banner.component';
import { CollapseComponent } from '../../shared/components/collapse.component';
import { ColorPickerComponent } from '../../shared/components/color-picker.component';
import { IconComponent } from '../../shared/components/icon.component';
import { QUICK_GRADIENTS } from '../../shared/util/rich-text';
import { ExpressionPickerComponent } from '../../shared/components/expression-picker.component';
import { ProfileCardComponent } from '../../shared/components/profile-card.component';
import { sortedStops, type GradientParts } from '../../shared/util/gradient';
import { GradientControlsComponent } from '../../shared/components/gradient-controls.component';
import { encodeBanner, parseBanner, type BannerColor } from '../../shared/util/banner';
import {
  encodeNameColor,
  NameColorDirective,
  parseNameColor,
  type NameColorParts,
} from '../../shared/util/name-color.directive';
import { describeError } from '../../shared/util/errors';

/** A CSS color value when it is a hex color, otherwise the given fallback. */
function themeColor(value: string, fallback: string): string {
  const color = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

type Draft = ProfileDraft;

const FONTS: { id: NameFont; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'display', label: 'Display' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'script', label: 'Script' },
];
/** The profile effects. `colors` marks the ones whose two colors can be chosen. */
const AURAS: { id: AuraId; label: string; colors: boolean }[] = [
  { id: 'void', label: 'None', colors: false },
  { id: 'prism', label: 'Spin', colors: true },
  { id: 'pulse', label: 'Pulse', colors: true },
  { id: 'orbit', label: 'Orbit', colors: true },
  { id: 'dashed', label: 'Dashed', colors: true },
  { id: 'double', label: 'Double', colors: true },
  { id: 'glow', label: 'Glow', colors: true },
  { id: 'ticks', label: 'Ticks', colors: true },
  { id: 'glitch', label: 'Glitch', colors: true },
  { id: 'rainbow', label: 'Rainbow', colors: false },
  { id: 'comet', label: 'Comet', colors: true },
  { id: 'nebula', label: 'Nebula', colors: true },
];

import { UserFontDirective } from '../../shared/util/user-font.directive';
import { NAME_FX, NameFxDirective } from '../../shared/util/name-fx.directive';
import { PresetsComponent } from './presets.component';
@Component({
  selector: 'app-profile-section',
  standalone: true,
  host: { class: 'block' },
  imports: [
    PresetsComponent,
    ServerTagPickerComponent,
    GradientControlsComponent,
    UserFontDirective,
    NameFxDirective,
    AvatarComponent,
    BannerComponent,
    NameColorDirective,
    CollapseComponent,
    ColorPickerComponent,
    IconComponent,
    ProfileCardComponent,
    ExpressionPickerComponent,
    DeleteAccountComponent,
    TranslatePipe,
  ],
  template: `
    <div class="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div class="min-w-0 space-y-8">
        <!-- Pictures -->
        <section>
          <h2 class="mb-3 text-sm font-semibold">{{ 'Profile picture & banner' | t }}</h2>
          <div class="overflow-hidden rounded-ui-lg border border-white/8">
            <div
              class="group relative h-28 cursor-pointer"
              (click)="uploadBanner()"
              role="button"
              tabindex="0"
              (keydown.enter)="uploadBanner()"
              [attr.aria-label]="'Change banner' | t"
            >
              <app-banner class="h-full" [image]="bannerUrl()" [color]="draft().bannerColor" />
              <div
                class="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-sm font-semibold opacity-0 group-hover:opacity-100"
              >
                <app-icon name="upload" [size]="17" /> {{ 'Upload banner' | t }}
                <span class="text-xs font-normal opacity-80">{{ 'Up to 8 MB' | t }}</span>
              </div>
            </div>
            <div class="flex items-end gap-4 px-4 pb-4">
              <button
                type="button"
                class="group relative -mt-10 rounded-full ring-4 ring-ink-850"
                (click)="uploadAvatar()"
                [attr.aria-label]="'Change picture' | t"
              >
                <app-avatar [user]="preview()" [size]="72" />
                <span
                  class="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100"
                  ><app-icon name="upload" [size]="22"
                /></span>
              </button>
              <div class="flex flex-1 flex-wrap items-center gap-2 pt-3">
                @if (me()?.avatarImage) {
                  <button class="btn btn-sm" type="button" (click)="removeImage('avatarImage')">
                    {{ 'Remove photo' | t }}
                  </button>
                }
                @if (me()?.bannerImage) {
                  <button class="btn btn-sm" type="button" (click)="removeImage('bannerImage')">
                    {{ 'Remove banner' | t }}
                  </button>
                }
              </div>
            </div>
          </div>

          @if (!me()?.bannerImage) {
            <div class="mt-3 rounded-ui-lg border border-white/8 bg-black/10 p-3">
              <div class="flex flex-wrap items-center gap-3">
                <span class="text-xs font-semibold text-muted">{{ 'Banner color' | t }}</span>
                @if (!bannerState()?.gradient) {
                  <app-color-picker
                    [value]="bannerState()?.from ?? ''"
                    [size]="26"
                    label="Banner color"
                    (valueChange)="setBanner({ from: $event })"
                  />
                }
                <label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    class="accent-[var(--accent)]"
                    [checked]="!!bannerState()?.gradient"
                    (change)="toggleGradient($any($event.target).checked)"
                  />
                  {{ 'Gradient' | t }}
                </label>
                <span class="flex-1"></span>
                @if (draft().bannerColor) {
                  <button
                    type="button"
                    class="text-xs text-muted underline hover:text-fg"
                    (click)="patch({ bannerColor: '' })"
                  >
                    {{ 'Reset' | t }}
                  </button>
                }
              </div>
              @if (bannerState(); as b) {
                @if (b.gradient) {
                  <div class="mt-3">
                    <app-gradient-controls [parts]="b" (changed)="setBanner($event)" />
                  </div>
                }
              }
            </div>
          }
        </section>

        <!-- Style -->
        <section>
          <h2 class="mb-3 text-sm font-semibold">{{ 'Name style' | t }}</h2>
          <div
            class="collapse-flat overflow-hidden rounded-ui-lg border border-white/8 bg-black/10"
          >
            <div
              class="flex items-center justify-center border-b border-white/8 px-4 py-7"
              style="background: radial-gradient(ellipse at 50% 0%, color-mix(in oklab, var(--accent) 10%, transparent), transparent 70%)"
            >
              <span
                class="max-w-full truncate text-3xl font-bold leading-tight"
                [class]="draft().nameFont === 'default' ? '' : 'font-name-' + draft().nameFont"
                [appNameColor]="draft().profileColor"
                [appUserFont]="draft().nameFont"
                [nameFx]="draft().nameFx"
                [fxLive]="true"
                fallback="var(--fg)"
                >{{ draft().displayName || 'Name' }}</span
              >
            </div>
            <div class="divide-y divide-white/6">
              <label class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <span class="w-32 shrink-0"
                  ><span class="block text-sm font-medium">{{ 'Display name' | t }}</span
                  ><span class="block text-xs text-muted">{{
                    'How others see you' | t
                  }}</span></span
                >
                <input
                  class="input min-w-0 flex-1 !text-base !font-semibold"
                  maxlength="32"
                  [value]="draft().displayName"
                  (input)="patch({ displayName: $any($event.target).value })"
                  [attr.aria-label]="'Display name' | t"
                />
                <span class="font-mono text-[0.6875rem] text-dim"
                  >{{ draft().displayName.length }} / 32</span
                >
              </label>
              <div>
                <app-collapse title="Name font" [summary]="currentFont()">
                  <span
                    preview
                    class="max-w-28 truncate text-base"
                    [class]="draft().nameFont === 'default' ? '' : 'font-name-' + draft().nameFont"
                    >{{ draft().displayName || 'Name' }}</span
                  >
                  <div class="grid grid-cols-3 gap-2.5">
                    @for (f of fonts; track f.id) {
                      <button
                        type="button"
                        class="choice-card"
                        [class.is-on]="draft().nameFont === f.id"
                        (click)="patch({ nameFont: f.id })"
                      >
                        <span
                          class="max-w-full truncate text-lg leading-tight"
                          [class]="f.id === 'default' ? '' : 'font-name-' + f.id"
                          [appNameColor]="draft().profileColor"
                          >{{ draft().displayName || 'Name' }}</span
                        >
                        <span class="text-[0.6875rem] text-muted">{{ f.label | t }}</span>
                      </button>
                    }
                    <button
                      type="button"
                      class="choice-card"
                      [class.is-on]="draft().nameFont === 'custom'"
                      [class.is-dashed]="!settings.customNameFontName()"
                      (click)="chooseCustomNameFont()"
                    >
                      @if (settings.customNameFontName()) {
                        <span
                          class="font-name-custom max-w-full truncate text-lg leading-tight"
                          [appNameColor]="draft().profileColor"
                          >{{ draft().displayName || 'Name' }}</span
                        >
                        <span
                          class="flex w-full items-center justify-between gap-2 text-[0.6875rem] text-muted"
                          ><span class="truncate">{{ settings.customNameFontName() }}</span
                          ><span
                            class="cursor-pointer underline hover:text-fg"
                            role="button"
                            tabindex="0"
                            (click)="removeCustomNameFont($event)"
                            (keydown.enter)="removeCustomNameFont($event)"
                            >{{ 'Remove' | t }}</span
                          ></span
                        >
                      } @else {
                        <span class="flex items-center gap-2 text-sm font-medium text-muted"
                          ><app-icon name="upload" [size]="16" /> {{ 'Upload font' | t }}</span
                        >
                        <span class="text-[0.6875rem] text-dim"
                          >.ttf .otf .woff2 · {{ 'Up to 5 MB' | t }}</span
                        >
                      }
                    </button>
                  </div>
                  <p class="mt-3 text-xs text-muted">
                    {{
                      'An uploaded font stays on this device: only you see it, others see the default one.'
                        | t
                    }}
                  </p>
                </app-collapse>
              </div>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
                <span class="w-32 text-sm font-medium">{{ 'Name color' | t }}</span>
                @if (!nameState()?.gradient) {
                  <app-color-picker
                    [value]="nameState()?.from ?? '#ffffff'"
                    [size]="34"
                    label="Name color"
                    (valueChange)="setName({ from: $event })"
                  />
                }
                <label class="flex cursor-pointer items-center gap-2 text-sm text-muted"
                  ><input
                    type="checkbox"
                    class="accent-[var(--accent)]"
                    [checked]="!!nameState()?.gradient"
                    (change)="setName({ gradient: $any($event.target).checked })"
                  />
                  {{ 'Gradient' | t }}</label
                >
                <span class="flex-1"></span>
                @if (draft().profileColor) {
                  <button
                    type="button"
                    class="text-xs text-muted underline hover:text-fg"
                    (click)="patch({ profileColor: '' })"
                  >
                    {{ 'Reset' | t }}
                  </button>
                }
              </div>
              @if (nameState(); as n) {
                @if (n.gradient) {
                  <div class="px-4 py-3.5">
                    <app-gradient-controls [parts]="n" (changed)="setName($event)" />
                  </div>
                }
              }
              <div>
                <app-collapse title="Name animation" [summary]="currentNameFx()">
                  <p class="mb-3 text-xs text-muted">
                    {{ 'It plays when the pointer is over your name.' | t }}
                  </p>
                  <div class="grid grid-cols-3 gap-2.5">
                    @for (fx of nameEffects; track fx.id) {
                      <button
                        type="button"
                        class="choice-card !items-center !gap-2 !px-1.5 !py-4 text-center"
                        [class.is-on]="draft().nameFx === fx.id"
                        [attr.title]="fx.hint | t"
                        (click)="patch({ nameFx: fx.id })"
                      >
                        <span
                          class="max-w-full truncate text-base font-semibold"
                          [class]="
                            draft().nameFont === 'default' ? '' : 'font-name-' + draft().nameFont
                          "
                          [appNameColor]="draft().profileColor"
                          [nameFx]="fx.id"
                          [fxLive]="true"
                          >{{ draft().displayName || 'Name' }}</span
                        >
                        <span class="text-[0.6875rem] text-muted">{{ fx.label | t }}</span>
                      </button>
                    }
                  </div>
                </app-collapse>
              </div>
              <div>
                <app-collapse title="Profile effect" [summary]="currentAura()">
                  <span preview
                    ><app-avatar [user]="preview()" [size]="30" [aura]="draft().aura !== 'void'"
                  /></span>
                  <div class="grid grid-cols-3 gap-2.5">
                    @for (a of auras; track a.id) {
                      <button
                        type="button"
                        class="choice-card !items-center !gap-2.5 !px-1.5 !py-4 text-center"
                        [class.is-on]="draft().aura === a.id"
                        (click)="patch({ aura: a.id })"
                      >
                        <app-avatar
                          [user]="auraPreview(a.id)"
                          [size]="40"
                          [aura]="a.id !== 'void'"
                        />
                        <span class="text-xs font-medium">{{ a.label | t }}</span>
                      </button>
                    }
                  </div>
                  @if (auraHasColors()) {
                    <div
                      class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-ui border border-white/8 bg-black/15 px-4 py-3.5"
                    >
                      <span class="text-sm font-medium">{{ 'Effect colors' | t }}</span>
                      <span class="flex items-center gap-3">
                        <app-color-picker
                          [value]="auraColors()[0]"
                          [size]="32"
                          shape="round"
                          label="First color"
                          (valueChange)="setAuraColor(0, $event)"
                        />
                        <app-color-picker
                          [value]="auraColors()[1]"
                          [size]="32"
                          shape="round"
                          label="Second color"
                          (valueChange)="setAuraColor(1, $event)"
                        />
                      </span>
                      <span class="flex-1"></span>
                      @if (draft().auraColor) {
                        <button
                          type="button"
                          class="text-xs text-muted underline hover:text-fg"
                          (click)="patch({ auraColor: '' })"
                        >
                          {{ 'Use theme colors' | t }}
                        </button>
                      }
                    </div>
                  }
                </app-collapse>
              </div>
            </div>
          </div>
        </section>
        <!-- About you -->
        <section>
          <h2 class="mb-3 text-sm font-semibold">{{ 'About you' | t }}</h2>
          <div class="space-y-4">
            <div class="rounded-ui-lg border border-white/8 bg-black/10 p-5">
              <div class="mb-2 flex items-center justify-between">
                <span class="label">{{ 'Status' | t }}</span>
                <span class="font-mono text-[0.6875rem] text-dim"
                  >{{ draft().statusText.length }} / 80</span
                >
              </div>
              <div class="relative flex items-center gap-2">
                <input
                  #status
                  class="input min-w-0 flex-1"
                  maxlength="80"
                  [placeholder]="'What are you up to?' | t"
                  [value]="draft().statusText"
                  (input)="patch({ statusText: $any($event.target).value })"
                />
                <button
                  type="button"
                  class="btn btn-icon tip"
                  [class.btn-active]="statusEmojiOpen()"
                  [attr.data-tip]="'Add emoji' | t"
                  [attr.aria-label]="'Add emoji' | t"
                  (mousedown)="$event.stopPropagation()"
                  (click)="statusEmojiOpen.set(!statusEmojiOpen())"
                >
                  <app-icon name="smile" [size]="18" />
                </button>
                @if (statusEmojiOpen()) {
                  <div class="absolute right-0 top-full z-30 mt-2">
                    <app-expression-picker
                      [tabs]="['emoji']"
                      (emoji)="insertStatusEmoji($event)"
                      (closed)="statusEmojiOpen.set(false)"
                    />
                  </div>
                }
              </div>
            </div>

            <div class="rounded-ui-lg border border-white/8 bg-black/10 p-5">
              <div class="mb-3 flex items-end justify-between gap-3">
                <div>
                  <span class="label">{{ 'About me' | t }}</span>
                  <p class="mt-0.5 text-[0.6875rem] text-dim">
                    {{ 'Shown on your profile card. Make it yours with styles and colors.' | t }}
                  </p>
                </div>
                <span
                  class="shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[0.6875rem] tabular-nums"
                  [class]="
                    draft().bio.length > 900
                      ? 'border-amber/50 text-amber'
                      : 'border-white/10 text-dim'
                  "
                  >{{ draft().bio.length }} / 1000</span
                >
              </div>
              <div
                class="relative rounded-ui border border-white/10 bg-black/25 transition-colors focus-within:border-accent/60"
                (mousedown)="$event.stopPropagation()"
              >
                <div
                  class="flex flex-wrap items-center gap-1 border-b border-white/8 bg-white/[.03] px-2 py-1.5"
                >
                  <button
                    type="button"
                    class="btn btn-icon btn-sm btn-ghost tip"
                    [attr.data-tip]="'Bold' | t"
                    (mousedown)="$event.preventDefault()"
                    (click)="wrapBio('**', '**')"
                  >
                    <app-icon name="bold" [size]="14" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-icon btn-sm btn-ghost tip"
                    [attr.data-tip]="'Italic' | t"
                    (mousedown)="$event.preventDefault()"
                    (click)="wrapBio('_', '_')"
                  >
                    <app-icon name="italic" [size]="14" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-icon btn-sm btn-ghost tip"
                    [attr.data-tip]="'Strikethrough' | t"
                    (mousedown)="$event.preventDefault()"
                    (click)="wrapBio('~~', '~~')"
                  >
                    <app-icon name="strike" [size]="14" />
                  </button>
                  <span class="mx-1 h-5 w-px bg-white/10"></span>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost gap-1.5"
                    [class.btn-active]="bioPanel() === 'color'"
                    (mousedown)="$event.preventDefault()"
                    (click)="toggleBioPanel('color')"
                  >
                    <span
                      class="h-3.5 w-3.5 rounded-full ring-1 ring-white/30"
                      [style.background]="bioA()"
                    ></span>
                    {{ 'Color' | t }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost gap-1.5"
                    [class.btn-active]="bioPanel() === 'gradient'"
                    (mousedown)="$event.preventDefault()"
                    (click)="toggleBioPanel('gradient')"
                  >
                    <span
                      class="h-3.5 w-6 rounded-full ring-1 ring-white/30"
                      [style.background]="'linear-gradient(90deg,' + bioA() + ',' + bioB() + ')'"
                    ></span>
                    {{ 'Gradient' | t }}
                  </button>
                </div>

                @if (bioPanel() === 'color') {
                  <div class="anim-fade-up m-2 rounded-ui border border-white/10 bg-ink-900/60 p-3">
                    <div class="label mb-2">{{ 'Pick a color for the selected text' | t }}</div>
                    <div class="grid grid-cols-8 gap-2">
                      @for (c of bioPalette; track c) {
                        <button
                          class="h-6 w-6 rounded-full ring-1 ring-white/20 transition-transform hover:scale-125"
                          [style.background]="c"
                          type="button"
                          (mousedown)="$event.preventDefault()"
                          (click)="wrapBio('[c=' + c + ']', '[/c]'); bioPanel.set(null)"
                          [attr.aria-label]="c"
                        ></button>
                      }
                    </div>
                    <div
                      class="mt-3 flex items-center gap-2 border-t border-white/8 pt-3 text-xs text-muted"
                    >
                      <app-color-picker
                        [value]="bioA()"
                        [size]="24"
                        shape="round"
                        label="First color"
                        (valueChange)="bioA.set($event)"
                      />
                      <span class="flex-1">{{ 'Your own color' | t }}</span>
                      <button
                        type="button"
                        class="btn btn-sm btn-primary"
                        (mousedown)="$event.preventDefault()"
                        (click)="wrapBio('[c=' + bioA() + ']', '[/c]'); bioPanel.set(null)"
                      >
                        {{ 'Apply' | t }}
                      </button>
                    </div>
                  </div>
                }
                @if (bioPanel() === 'gradient') {
                  <div
                    class="anim-fade-up m-2 flex flex-wrap items-center gap-2 rounded-ui border border-white/10 bg-ink-900/60 px-2.5 py-2"
                  >
                    @for (g of quickGradients; track g.name) {
                      <button
                        class="h-5 w-8 rounded-full ring-1 ring-white/20 transition-transform hover:scale-110"
                        [style.background]="'linear-gradient(90deg,' + g.colors.join(',') + ')'"
                        type="button"
                        (mousedown)="$event.preventDefault()"
                        (click)="
                          wrapBio('[g=' + g.colors.join(',') + ']', '[/g]'); bioPanel.set(null)
                        "
                        [attr.title]="g.name | t"
                        [attr.aria-label]="g.name | t"
                      ></button>
                    }
                    <span class="mx-0.5 h-5 w-px bg-white/10"></span>
                    <div class="min-w-[11rem] flex-1">
                      <app-gradient-controls
                        [compact]="true"
                        [parts]="bioGradient()"
                        [showAngle]="false"
                        [showPosition]="false"
                        (changed)="setBioGradient($event)"
                      />
                    </div>
                    <button
                      type="button"
                      class="btn btn-sm btn-primary"
                      (mousedown)="$event.preventDefault()"
                      (click)="applyBioGradient()"
                    >
                      {{ 'Apply' | t }}
                    </button>
                  </div>
                }

                <textarea
                  #bio
                  class="selectable block min-h-36 max-h-80 w-full resize-none bg-transparent px-3.5 py-3 text-sm leading-relaxed outline-none [field-sizing:content]"
                  rows="5"
                  maxlength="1000"
                  [placeholder]="'Tell people about yourself…' | t"
                  [value]="draft().bio"
                  (input)="patch({ bio: $any($event.target).value }); recordBio(false)"
                  (keydown)="onBioKey($event)"
                  (focus)="bioPanel.set(null)"
                ></textarea>
              </div>
              <p class="mt-2 text-[0.6875rem] text-dim">
                {{
                  'Select some text and pick a style. With nothing selected, the style applies to what you type next.'
                    | t
                }}
              </p>
            </div>
          </div>
        </section>
        <app-collapse title="Profile presets" summary="Save, apply and share your profile">
          <app-presets kind="profile" (profileApplied)="applyPreset($event)" />
        </app-collapse>
      </div>

      <aside class="xl:sticky xl:top-6 xl:self-start">
        <div class="label mb-2">{{ 'Preview' | t }}</div>
        <app-profile-card [user]="preview()" status="online" />
        <app-server-tag-picker />
        <app-delete-account class="block" />
      </aside>
    </div>

    @if (dirty()) {
      <div class="anim-pop pointer-events-none sticky bottom-4 z-[70] mt-8 flex justify-center">
        <div
          class="pointer-events-auto flex max-w-xl flex-1 flex-wrap items-center justify-between gap-3 rounded-ui-lg border border-white/10 bg-ink-800 px-4 py-3 shadow-2xl"
        >
          <span class="text-sm font-medium">{{ 'You have unsaved changes' | t }}</span>
          <span class="flex items-center gap-2">
            <button
              class="btn btn-sm btn-primary"
              type="button"
              (click)="save()"
              [disabled]="saving()"
            >
              @if (saving()) {
                {{ 'Saving…' | t }}
              } @else {
                {{ 'Save changes' | t }}
              }
            </button>
            <button class="btn btn-sm" type="button" (click)="discard()">{{ 'Reset' | t }}</button>
          </span>
        </div>
      </div>
    }
  `,
})
export class ProfileSectionComponent {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly images = inject(ImageService);
  private readonly injector = inject(EnvironmentInjector);
  private readonly directory = inject(DirectoryService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  protected readonly settings = inject(SettingsService);
  private readonly fontFiles = inject(FontService);
  private readonly kept = inject(ProfileDraftStore);

  protected readonly fonts = FONTS;
  protected readonly nameEffects = NAME_FX;
  /** The label of the animation of the name that is chosen. */
  protected readonly currentNameFx = computed(this.findNameFx.bind(this));
  protected readonly auras = AURAS;
  protected readonly me = this.auth.user;
  protected readonly draft = signal<Draft>(this.fromUser(this.auth.user()));
  protected readonly bannerState = computed(
    function (this: ProfileSectionComponent) {
      return parseBanner(this.draft().bannerColor);
    }.bind(this),
  );
  protected readonly nameState = computed(this.readNameColor.bind(this));
  protected readonly currentFont = computed(this.findFontLabel.bind(this));
  protected readonly currentAura = computed(this.findAuraLabel.bind(this));
  protected readonly auraHasColors = computed(this.hasAuraColors.bind(this));
  protected readonly auraColors = computed(this.readAuraColors.bind(this));
  protected readonly saving = signal(false);
  private readonly bio = viewChild<ElementRef<HTMLTextAreaElement>>('bio');
  protected readonly busy = signal(false);
  /** Colors offered in the color panel of About me. */
  protected readonly bioPalette = [
    '#ff5d6c',
    '#ff9f43',
    '#ffd23f',
    '#4ade80',
    '#2dd4bf',
    '#38bdf8',
    '#818cf8',
    '#c084fc',
    '#f472b6',
    '#ffffff',
    '#9ca3af',
    '#fb923c',
  ];
  protected readonly quickGradients = QUICK_GRADIENTS;
  /** Which style panel of About me is open. */
  protected readonly bioPanel = signal<'color' | 'gradient' | null>(null);
  protected readonly bioA = signal('#ff512f');
  protected readonly bioB = signal('#7f5af0');
  /** The colours of the gradient that is being made for About me (two to five; their order is what counts). */
  protected readonly bioGradient = signal<GradientParts>({
    angle: 90,
    stops: [
      { color: '#ff512f', pos: 0 },
      { color: '#7f5af0', pos: 100 },
    ],
  });

  /** A change in the editor of the gradient of About me. */
  protected setBioGradient(change: Partial<GradientParts>): void {
    this.bioGradient.set({ ...this.bioGradient(), ...change });
  }

  /** Wraps the selected text with the gradient, using the colours in the order of the bar. */
  protected applyBioGradient(): void {
    const colors = sortedStops(this.bioGradient().stops).map(function colour(stop) {
      return stop.color;
    });
    this.wrapBio('[g=' + colors.join(',') + ']', '[/g]');
    this.bioPanel.set(null);
  }
  protected readonly statusEmojiOpen = signal(false);
  private readonly status = viewChild<ElementRef<HTMLInputElement>>('status');

  protected readonly dirty = computed(
    function (this: ProfileSectionComponent) {
      const user = this.me();
      return !!user && JSON.stringify(this.draft()) !== JSON.stringify(this.fromUser(user));
    }.bind(this),
  );
  protected readonly preview = computed<User | undefined>(
    function (this: ProfileSectionComponent) {
      const user = this.me();
      return user ? { ...user, ...this.draft() } : undefined;
    }.bind(this),
  );
  protected readonly bannerUrl = computed(
    function (this: ProfileSectionComponent) {
      const url = this.images.url(this.me()?.bannerImage);
      return url ? `url(${url})` : null;
    }.bind(this),
  );

  constructor() {
    this.images.ensure(this.auth.user()?.bannerImage);
    // What was written and not saved before the settings were closed is still here.
    const waiting = this.kept.pending();
    if (waiting && waiting.userId === this.auth.user()?.id) {
      this.draft.set(waiting.draft);
    }
    // Every change is kept outside of the page, until it is saved or thrown away.
    effect(
      function keep(this: ProfileSectionComponent) {
        const draft = this.draft();
        const dirty = this.dirty();
        const userId = this.auth.user()?.id;
        untracked(
          function store(this: ProfileSectionComponent) {
            this.kept.pending.set(dirty && userId ? { userId, draft } : null);
          }.bind(this),
        );
      }.bind(this),
    );
  }

  /** The draft of the profile (what the forms edit) from the saved user. */
  private fromUser(user: User | null): Draft {
    return {
      displayName: user?.displayName ?? '',
      pronouns: user?.pronouns ?? '',
      statusText: user?.statusText ?? '',
      bio: user?.bio ?? '',
      nameFont: user?.nameFont ?? 'default',
      nameFx: user?.nameFx ?? 'none',
      profileColor: user?.profileColor ?? '',
      bannerColor: user?.bannerColor ?? '',
      aura: user?.aura ?? 'prism',
      auraColor: user?.auraColor ?? '',
    };
  }

  /** Label of the chosen animation of the name. */
  private findNameFx(): string {
    const id = this.draft().nameFx;
    return (
      NAME_FX.find(function same(fx) {
        return fx.id === id;
      })?.label ?? 'None'
    );
  }

  /** Label of the chosen name font. */
  private findFontLabel(): string {
    if (this.draft().nameFont === 'custom') {
      return 'Your own';
    }
    for (const font of FONTS) {
      if (font.id === this.draft().nameFont) {
        return font.label;
      }
    }
    return 'Default';
  }

  /** Label of the chosen profile effect. */
  private findAuraLabel(): string {
    for (const aura of AURAS) {
      if (aura.id === this.draft().aura) {
        return aura.label;
      }
    }
    return 'Spin';
  }

  /** True when the chosen effect lets the person pick its colors. */
  private hasAuraColors(): boolean {
    for (const aura of AURAS) {
      if (aura.id === this.draft().aura) {
        return aura.colors;
      }
    }
    return true;
  }

  /** The two colors of the effect: the chosen ones, or the theme colors. */
  private readAuraColors(): string[] {
    const parts = this.draft().auraColor.split(',');
    if (parts.length === 2) {
      return parts;
    }
    const style = getComputedStyle(document.documentElement);
    return [
      themeColor(style.getPropertyValue('--accent'), '#2ef2b0'),
      themeColor(style.getPropertyValue('--accent-2'), '#38e8ff'),
    ];
  }

  /** Changes one of the two colors of the effect. */
  protected setAuraColor(index: number, color: string): void {
    const colors = this.auraColors().slice();
    colors[index] = color;
    this.patch({ auraColor: colors.join(',') });
  }

  /** Uses the uploaded name font, or asks for the file first when there is none. */
  protected async chooseCustomNameFont(): Promise<void> {
    if (this.settings.customNameFontName()) {
      this.patch({ nameFont: 'custom' });
      return;
    }
    try {
      await this.fontFiles.upload('name');
      if (this.settings.customNameFontName()) {
        this.patch({ nameFont: 'custom' });
      }
    } catch (e) {
      this.toast.error(
        this.i18n.t('Could not load the font'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    }
  }

  /** Deletes the uploaded name font (the name goes back to the default font). */
  protected async removeCustomNameFont(event: Event): Promise<void> {
    event.stopPropagation();
    await this.fontFiles.remove('name');
    if (this.draft().nameFont === 'custom') {
      this.patch({ nameFont: 'default' });
    }
  }

  /** A copy of the user with another effect, to preview it. */
  protected auraPreview(aura: AuraId): User | undefined {
    const user = this.preview();
    return user ? { ...user, aura } : undefined;
  }

  /** Changes part of the draft. */
  protected patch(change: Partial<Draft>): void {
    this.draft.update(function (d) {
      return { ...d, ...change };
    });
  }

  /** Changes one part of the banner colour; the first change starts from a sensible default. */
  protected setBanner(change: Partial<BannerColor>): void {
    const base = this.bannerState() ?? {
      from: '#7c3aed',
      to: '#2ef2b0',
      angle: 135,
      opacity: 100,
      stops: [
        { color: '#7c3aed', pos: 0 },
        { color: '#2ef2b0', pos: 100 },
      ],
      gradient: false,
    };
    this.patch({ bannerColor: encodeBanner({ ...base, ...change }) });
  }

  /** The parts of the color of the name. */
  private readNameColor(): ReturnType<typeof parseNameColor> {
    return parseNameColor(this.draft().profileColor);
  }

  /** Changes one part of the name color (solid or gradient). */
  protected setName(change: Partial<NameColorParts>): void {
    const base: NameColorParts = this.nameState() ?? {
      from: '#ffffff',
      angle: 90,
      stops: [
        { color: '#ffffff', pos: 0 },
        { color: '#2ef2b0', pos: 100 },
      ],
      gradient: false,
    };
    const next = { ...base, ...change };
    if (change.from !== undefined && !next.gradient) {
      next.stops = [
        { color: next.from, pos: 0 },
        { color: next.from, pos: 100 },
      ];
    }
    if (change.gradient && next.stops[0]!.color === next.stops[next.stops.length - 1]!.color) {
      next.stops = [
        { color: next.from, pos: 0 },
        { color: '#2ef2b0', pos: 100 },
      ];
    }
    if (next.gradient && change.from !== undefined) {
      next.stops = next.stops.map(function first(stop, i) {
        return i === 0 ? { ...stop, color: next.from } : stop;
      });
    }
    this.patch({ profileColor: encodeNameColor(next) });
  }

  /** Opens one of the style panels of About me (or closes it when it is already open). */
  protected toggleBioPanel(panel: 'color' | 'gradient'): void {
    this.bioPanel.set(this.bioPanel() === panel ? null : panel);
  }

  /** A press anywhere else closes the style panels. */
  @HostListener('document:mousedown')
  protected closeBioPanel(): void {
    if (this.bioPanel()) {
      this.bioPanel.set(null);
    }
  }

  // ---- undo and redo of About me ------------------------------------------------------------

  private bioHistory: { text: string; caret: number }[] = [];
  private bioIndex = -1;
  private bioRecorded = 0;

  /** Saves the text of About me in its history; changes typed close in time are grouped as one step. */
  protected recordBio(force: boolean): void {
    const box = this.bio()?.nativeElement;
    const text = this.draft().bio;
    if (this.bioIndex < 0) {
      this.bioHistory = [{ text: this.lastSavedBio, caret: 0 }];
      this.bioIndex = 0;
    }
    if (text === this.bioHistory[this.bioIndex]?.text) {
      return;
    }
    const entry = { text, caret: box?.selectionStart ?? text.length };
    const now = Date.now();
    this.bioHistory = this.bioHistory.slice(0, this.bioIndex + 1);
    if (!force && now - this.bioRecorded < 600 && this.bioIndex > 0) {
      this.bioHistory[this.bioIndex] = entry;
    } else {
      this.bioHistory.push(entry);
      this.bioIndex = this.bioHistory.length - 1;
    }
    this.bioRecorded = now;
    if (this.bioHistory.length > 200) {
      this.bioHistory.shift();
      this.bioIndex = this.bioHistory.length - 1;
    }
  }

  /** What About me had when the person began to edit it (the first step of the history). */
  private get lastSavedBio(): string {
    return this.me()?.bio ?? '';
  }

  /** Control+Z undoes and Control+Y (or Control+Shift+Z) redoes in About me. */
  protected onBioKey(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.stepBio(-1);
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      this.stepBio(1);
    }
  }

  /** Goes one step back or forward in the history of About me. */
  private stepBio(direction: number): void {
    this.recordBio(false);
    const target = this.bioIndex + direction;
    if (target < 0 || target >= this.bioHistory.length) {
      return;
    }
    this.bioIndex = target;
    const entry = this.bioHistory[target]!;
    this.patch({ bio: entry.text });
    const box = this.bio()?.nativeElement;
    if (box) {
      box.value = entry.text;
      box.focus();
      box.setSelectionRange(entry.caret, entry.caret);
    }
  }

  /** Wraps the selected text of "About me" with format marks (bold, italic, color...). */
  protected wrapBio(open: string, close: string): void {
    const box = this.bio()?.nativeElement;
    if (!box) {
      return;
    }
    const text = this.draft().bio;
    const start = box.selectionStart ?? text.length;
    const end = box.selectionEnd ?? text.length;
    const next = text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end);
    if (next.length > 1000) {
      return;
    }
    this.recordBio(true);
    this.patch({ bio: next });
    // With nothing selected the caret stays between the marks, so typing goes straight into that color or format.
    const caret = start === end ? start + open.length : end + open.length + close.length;
    box.value = next;
    box.focus();
    box.setSelectionRange(caret, caret);
    this.recordBio(true);
  }

  /** Inserts an emoji in the status at the position of the caret (respecting the limit of 80 characters). */
  protected insertStatusEmoji(emoji: string): void {
    const box = this.status()?.nativeElement;
    const text = this.draft().statusText;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    if (next.length > 80) {
      return;
    }
    this.patch({ statusText: next });
    if (box) {
      box.value = next;
      box.focus();
      box.setSelectionRange(start + emoji.length, start + emoji.length);
    }
  }

  /** Turns the gradient of the banner on or off. */
  protected toggleGradient(on: boolean): void {
    const base = this.bannerState() ?? {
      from: '#7c3aed',
      to: '#2ef2b0',
      angle: 135,
      opacity: 100,
      stops: [
        { color: '#7c3aed', pos: 0 },
        { color: '#2ef2b0', pos: 100 },
      ],
      gradient: false,
    };
    this.setBanner({ gradient: on, to: on && base.to === base.from ? '#2ef2b0' : base.to });
  }

  /** The fields of a profile preset go to the form: the person looks at them and saves them. */
  protected applyPreset(fields: Record<string, unknown>): void {
    this.draft.set({ ...this.draft(), ...(fields as Partial<Draft>) });
  }

  /** Throws away the changes and goes back to the saved profile. */
  protected discard(): void {
    this.draft.set(this.fromUser(this.me()));
  }

  /** Sends changes of the profile to the server and updates the copies on screen. */
  private async send(body: Record<string, unknown>): Promise<void> {
    const res = await this.api.patch<{ user: User }>('/api/me', body);
    this.auth.setUser(res.user);
    this.directory.merge([res.user]);
  }

  /** Saves the draft of the profile. */
  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      const d = this.draft();
      await this.send({ ...d, displayName: d.displayName.trim() || this.me()!.username });
      this.draft.set(this.fromUser(this.me()));
      this.toast.success(this.i18n.t('Profile saved'));
    } catch (e) {
      this.toast.error(this.i18n.t('Could not save'), describeError(e));
    } finally {
      this.saving.set(false);
    }
  }

  /** Chooses the profile picture. */
  protected async uploadAvatar(): Promise<void> {
    await this.upload('avatar', 'avatarImage');
  }

  /** Chooses the banner. */
  protected async uploadBanner(): Promise<void> {
    await this.upload('banner', 'bannerImage');
  }

  private async upload(
    kind: 'avatar' | 'banner',
    field: 'avatarImage' | 'bannerImage',
  ): Promise<void> {
    this.busy.set(true);
    try {
      const adjuster = await import('../../shared/components/image-adjust.component');
      const id = await adjuster.pickAndUploadImage(this.images, this.injector, kind);
      if (id) {
        await this.send({ [field]: id });
        this.images.ensure(id);
        this.toast.success(this.i18n.t(kind === 'avatar' ? 'Picture updated' : 'Banner updated'));
      }
    } catch (e) {
      this.toast.error(this.i18n.t('Could not upload the image'), describeError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Removes the profile picture or the banner. */
  protected async removeImage(field: 'avatarImage' | 'bannerImage'): Promise<void> {
    try {
      await this.send({ [field]: null });
    } catch (e) {
      this.toast.error(this.i18n.t('Could not save'), describeError(e));
    }
  }
}
