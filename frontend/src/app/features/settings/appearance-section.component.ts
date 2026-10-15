/**
 * src/app/features/settings/appearance-section.component.ts
 * Settings - Appearance: theme, background, accent, typeface, bubbles, motion and cursors.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { ArrivalService } from '../../core/services/arrival.service';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { SelectComponent, type SelectOption } from '../../shared/components/select.component';
import type { AccentId } from '../../core/models';
import { readCursorFile } from '../../core/cursor-files';
import { GradientControlsComponent } from '../../shared/components/gradient-controls.component';
import { RevealComponent } from '../../shared/components/reveal.component';
import {
  encodeMulti,
  gradientCss,
  parseMulti,
  type GradientParts,
} from '../../shared/util/gradient';
import { FAMILIES, cursorImageToDataUrl, svgCursor } from '../../core/services/cursor-shapes';
import { FontService } from '../../core/services/font.service';
import { ImageService } from '../../core/services/image.service';
import type { TrailType } from '../../core/services/cursor-trail';
import {
  CORNER_STEPS,
  SettingsService,
  type BackgroundId,
  type BubbleStyle,
  type CursorMode,
  type CustomCursor,
  type FontId,
  type ThemeId,
} from '../../core/services/settings.service';
import { ToastService } from '../../core/services/toast.service';
import { WallpaperStore } from '../../core/services/wallpaper.store';
import { CollapseComponent } from '../../shared/components/collapse.component';
import { StepSliderComponent, type StepLabel } from '../../shared/components/step-slider.component';
import { ColorPickerComponent } from '../../shared/components/color-picker.component';
import { IconComponent } from '../../shared/components/icon.component';
import { BackgroundSceneComponent } from '../../shared/components/mesh-background.component';
import {
  SegmentedComponent,
  SettingRowComponent,
  ToggleComponent,
} from '../../shared/components/controls.component';
import { ACCENTS, THEMES } from '../../core/theme-data';
import { PresetsComponent } from './presets.component';

const FONTS: { id: FontId; label: string; css: string }[] = [
  { id: 'app', label: 'Chatterly', css: "'Open Sans Variable'" },
  { id: 'system', label: 'System', css: 'system-ui' },
  { id: 'inter', label: 'Inter', css: "'Inter Variable'" },
  { id: 'outfit', label: 'Outfit', css: "'Outfit Variable'" },
  { id: 'manrope', label: 'Manrope', css: "'Manrope Variable'" },
  { id: 'nunito', label: 'Nunito', css: "'Nunito Variable'" },
  { id: 'space', label: 'Space Grotesk', css: "'Space Grotesk Variable'" },
  { id: 'lora', label: 'Lora', css: "'Lora Variable'" },
  { id: 'mono', label: 'JetBrains Mono', css: "'JetBrains Mono Variable'" },
];
const BACKGROUNDS: { id: BackgroundId; label: string }[] = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'nebula', label: 'Nebula' },
  { id: 'cosmos', label: 'Cosmos' },
  { id: 'stars', label: 'Stars' },
  { id: 'network', label: 'Network' },
  { id: 'fireflies', label: 'Fireflies' },
  { id: 'lavalamp', label: 'Lava lamp' },
  { id: 'prism', label: 'Prism' },
  { id: 'orbs', label: 'Orbs' },
  { id: 'mist', label: 'Mist' },
  { id: 'topography', label: 'Topography' },
  { id: 'curtains', label: 'Curtains' },
  { id: 'synthwave', label: 'Synthwave' },
  { id: 'waves', label: 'Waves' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'beams', label: 'Beams' },
  { id: 'ripples', label: 'Ripples' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'grid', label: 'Grid' },
  { id: 'shuffle', label: 'Shuffle' },
  { id: 'solid', label: 'Solid color' },
  { id: 'image', label: 'Wallpaper' },
];
const CURSORS: { id: CursorMode; label: string }[] = [
  { id: 'classic', label: 'Default' },
  { id: 'themed', label: 'Neon' },
  { id: 'solid', label: 'Solid' },
  { id: 'soft', label: 'Soft' },
  { id: 'sleek', label: 'Sleek' },
  { id: 'halo', label: 'Halo' },
  { id: 'pixel', label: 'Pixel' },
  { id: 'system', label: 'System' },
];

/** The available trails, each with a short description. */
const TRAILS: { id: TrailType | 'off'; label: string; hint: string }[] = [
  { id: 'off', label: 'None', hint: 'No trail' },
  { id: 'comet', label: 'Comet', hint: 'A glowing tail that thins out' },
  { id: 'ribbon', label: 'Ribbon', hint: 'A soft ribbon in your theme colors' },
  { id: 'glow', label: 'Glow', hint: 'Soft lights, like the interface' },
  { id: 'ink', label: 'Ink', hint: 'A brush stroke that dries' },
  { id: 'rainbow', label: 'Rainbow', hint: 'A line that changes color' },
  { id: 'stardust', label: 'Stardust', hint: 'Little sparkling stars' },
  { id: 'bubbles', label: 'Bubbles', hint: 'Bubbles that float up' },
  { id: 'fire', label: 'Fire', hint: 'Flames that fade out' },
];

@Component({
  selector: 'app-appearance-section',
  standalone: true,
  imports: [
    PresetsComponent,
    StepSliderComponent,
    GradientControlsComponent,
    RevealComponent,
    IconComponent,
    TranslatePipe,
    SegmentedComponent,
    SettingRowComponent,
    ToggleComponent,
    CollapseComponent,
    ColorPickerComponent,
    BackgroundSceneComponent,
    SelectComponent,
  ],
  template: `
    <div class="space-y-5">
      <app-collapse title="Theme" [summary]="currentTheme().label">
        <span preview class="flex h-6 w-14 overflow-hidden rounded-ui border border-white/10"
          ><span class="flex-1" [style.background]="currentTheme().colors[0]"></span
          ><span class="flex-1" [style.background]="currentTheme().colors[1]"></span
          ><span class="flex-1" [style.background]="currentTheme().colors[2]"></span
        ></span>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
          @for (th of themes; track th.id) {
            <button
              type="button"
              class="overflow-hidden rounded-ui border text-left hover:-translate-y-0.5"
              [class.border-accent]="s.theme() === th.id"
              [class.border-white/10]="s.theme() !== th.id"
              (click)="s.theme.set(th.id)"
            >
              <div class="flex h-12">
                <span class="flex-1" [style.background]="th.colors[0]"></span
                ><span class="flex-1" [style.background]="th.colors[1]"></span
                ><span class="flex-1" [style.background]="th.colors[2]"></span>
              </div>
              <div class="flex items-center justify-between gap-2 px-2.5 py-2 text-xs font-medium">
                <span class="min-w-0 flex-1 leading-tight">{{ th.label | t }}</span>
                @if (s.theme() === th.id) {
                  <app-icon name="check" [size]="13" class="shrink-0 text-accent" />
                }
              </div>
            </button>
          }
          <button
            type="button"
            class="overflow-hidden rounded-ui border text-left hover:-translate-y-0.5"
            [class.border-accent]="s.theme() === 'custom'"
            [class.border-white/10]="s.theme() !== 'custom'"
            (click)="s.theme.set('custom')"
          >
            <div class="flex h-12 items-center justify-center" [style.background]="s.customTheme()">
              <app-icon name="palette" [size]="18" class="text-white/70" />
            </div>
            <div class="flex items-center justify-between gap-2 px-2.5 py-2 text-xs font-medium">
              <span class="min-w-0 flex-1 leading-tight">{{ 'Custom' | t }}</span>
              @if (s.theme() === 'custom') {
                <app-icon name="check" [size]="13" class="shrink-0 text-accent" />
              }
            </div>
          </button>
        </div>
        @if (s.theme() === 'custom') {
          <div
            class="mt-5 divide-y divide-white/6 overflow-hidden rounded-ui border border-white/8 bg-black/15"
          >
            @for (p of themeParts; track p.id) {
              <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span
                  ><span class="block text-sm font-medium">{{ p.label | t }}</span
                  ><span class="block text-xs text-muted">{{ p.hint | t }}</span></span
                >
                <span class="flex items-center gap-2">
                  @if (p.id !== 'base' && partValue(p.id)) {
                    <button
                      type="button"
                      class="text-xs text-muted underline hover:text-fg"
                      (click)="setPart(p.id, '')"
                    >
                      {{ 'Reset' | t }}
                    </button>
                  }
                  <app-color-picker
                    [value]="partValue(p.id) || p.fallback"
                    [size]="32"
                    [label]="p.label"
                    (valueChange)="setPart(p.id, $event)"
                  />
                </span>
              </div>
            }
          </div>
        }
      </app-collapse>

      <app-collapse title="Background" [summary]="currentBackground()">
        <span
          preview
          class="bg-preview relative h-8 w-14 overflow-hidden rounded-ui border border-white/10"
          ><app-bg-scene [kind]="s.background()"
        /></span>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          @for (b of backgrounds; track b.id) {
            <button
              type="button"
              class="overflow-hidden rounded-ui border text-left hover:-translate-y-0.5"
              [class.border-accent]="s.background() === b.id"
              [class.border-white/10]="s.background() !== b.id"
              (click)="s.background.set(b.id)"
            >
              <span class="bg-preview relative block h-16 overflow-hidden"
                ><app-bg-scene [kind]="b.id" />
                @if (b.id === 'shuffle') {
                  <span class="absolute inset-0 flex items-center justify-center text-white/90"
                    ><app-icon name="shuffle" [size]="22"
                  /></span>
                }
              </span>
              <span class="flex items-center justify-between px-2.5 py-1.5 text-xs font-medium"
                >{{ b.label | t }}
                @if (s.background() === b.id) {
                  <app-icon name="check" [size]="13" class="text-accent" />
                }
              </span>
            </button>
          }
        </div>
        @if (s.background() === 'shuffle') {
          <div class="mt-6 space-y-5 rounded-ui border border-white/8 bg-black/15 p-5">
            <p class="text-xs text-muted">
              {{ 'A different background is picked at random. Choose when it changes.' | t }}
            </p>
            <app-segmented
              [options]="shuffleModes"
              [value]="s.bgShuffleMode()"
              (valueChange)="setShuffle($event)"
            />
            @if (s.bgShuffleMode() === 'interval') {
              <label class="flex items-center gap-3 pt-1 text-xs text-muted"
                >{{ 'Change every' | t }}
                <input
                  type="range"
                  min="1"
                  max="120"
                  class="w-44 accent-[var(--accent)]"
                  [value]="s.bgShuffleMinutes()"
                  (input)="s.bgShuffleMinutes.set(+$any($event.target).value)"
                />
                <b class="w-16 text-fg">{{ s.bgShuffleMinutes() }} min</b>
              </label>
            }
          </div>
        }
        @if (s.background() === 'solid') {
          <div
            class="mt-6 flex flex-wrap items-center gap-4 rounded-ui border border-white/8 bg-black/15 p-4"
          >
            <span class="text-sm font-medium">{{ 'Background color' | t }}</span>
            <app-color-picker
              [value]="s.bgSolidColor()"
              [size]="36"
              label="Background color"
              (valueChange)="s.bgSolidColor.set($event)"
            />
          </div>
        }
        @if (s.background() === 'image') {
          <div
            class="mt-6 flex flex-wrap items-center gap-4 rounded-ui border border-white/8 bg-black/15 p-4"
          >
            <button class="btn btn-sm btn-primary" type="button" (click)="pickWallpaper()">
              <app-icon name="upload" [size]="14" /> {{ 'Choose wallpaper' | t }}
            </button>
            @if (wallpaper.url() || s.wallpaper()) {
              <button class="btn btn-sm" type="button" (click)="removeWallpaper()">
                {{ 'Remove' | t }}
              </button>
            }
            <span class="text-xs text-muted">{{
              'A picture, a GIF or a short video (up to 12 MB for pictures and 25 MB for videos). It moves if it is animated. Stored only on this device.'
                | t
            }}</span>
          </div>
        }
      </app-collapse>

      <app-collapse title="Accent color" [summary]="currentAccent()">
        <span
          preview
          class="h-6 w-6 rounded-full border border-white/20"
          style="background: var(--accent)"
        ></span>
        <div class="flex flex-wrap items-center gap-2.5">
          @for (a of accents; track a.id) {
            <button
              type="button"
              class="relative h-9 w-9 dot rounded-full ring-offset-1 ring-offset-ink-850 hover:scale-105"
              [class.ring-2]="s.accent() === a.id"
              [style.--tw-ring-color]="a.color"
              [style.background]="a.color"
              (click)="s.accent.set(a.id)"
              [attr.aria-label]="a.label | t"
              [attr.title]="a.label | t"
            >
              @if (s.accent() === a.id) {
                <app-icon
                  name="check"
                  [size]="16"
                  [stroke]="3"
                  class="absolute inset-0 m-auto text-ink-950"
                />
              }
            </button>
          }
          <span class="mx-1 h-6 w-px bg-white/10"></span>
          <app-color-picker
            [value]="s.customAccent()"
            [size]="36"
            shape="round"
            [rainbow]="true"
            label="Custom color"
            (valueChange)="s.customAccent.set($event); s.accent.set('custom')"
          />
          <span
            class="text-xs"
            [class.text-accent]="s.accent() === 'custom'"
            [class.text-muted]="s.accent() !== 'custom'"
            >{{ 'Custom color' | t }}</span
          >
        </div>
      </app-collapse>

      <app-collapse title="Typeface" [summary]="currentFont().label">
        <span preview class="text-lg" [style.font-family]="currentFont().css + ', sans-serif'"
          >Aa</span
        >
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          @for (f of fonts; track f.id) {
            <button
              type="button"
              class="choice-card"
              [class.is-on]="s.font() === f.id"
              (click)="s.font.set(f.id)"
            >
              <span class="text-lg leading-tight" [style.font-family]="f.css + ', sans-serif'">
                Aa Bb 123
              </span>
              <span class="text-[0.6875rem] text-muted">{{ f.label | t }}</span>
            </button>
          }
          <button
            type="button"
            class="choice-card"
            [class.is-on]="s.font() === 'custom'"
            [class.is-dashed]="!s.customFontName()"
            (click)="chooseCustomFont()"
          >
            @if (s.customFontName()) {
              <span
                class="text-lg leading-tight"
                style="font-family: 'Chatterly Custom UI', sans-serif"
                >Aa Bb 123</span
              >
              <span
                class="flex w-full items-center justify-between gap-2 text-[0.6875rem] text-muted"
                ><span class="truncate">{{ s.customFontName() }}</span
                ><span
                  class="cursor-pointer underline hover:text-fg"
                  role="button"
                  tabindex="0"
                  (click)="removeCustomFont($event)"
                  (keydown.enter)="removeCustomFont($event)"
                  >{{ 'Remove' | t }}</span
                ></span
              >
            } @else {
              <span class="flex items-center gap-2 text-sm font-medium text-muted"
                ><app-icon name="upload" [size]="16" /> {{ 'Upload font' | t }}</span
              >
              <span class="text-[0.6875rem] text-dim">.ttf .otf .woff2</span>
            }
          </button>
        </div>
      </app-collapse>
    </div>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Motion' | t }}</h2>
      <app-setting-row
        title="Background visibility"
        hint="How much of the animated background shows through the panels."
      >
        <app-step-slider
          label="Background visibility"
          [max]="visibilityLevels.length - 1"
          [value]="s.bgVisibility()"
          [labels]="visibilityLabels"
          (valueChange)="s.bgVisibility.set($event)"
        />
      </app-setting-row>
      <app-setting-row
        title="Background blur"
        hint="Softens the edges of the animated shapes behind the interface."
      >
        <app-step-slider
          label="Background blur"
          [max]="100"
          [value]="s.bgBlur()"
          [labels]="blurLabels()"
          (valueChange)="s.bgBlur.set($event)"
        />
      </app-setting-row>
      <app-setting-row title="Background motion">
        <app-step-slider
          label="Background motion"
          [max]="motionLevels.length - 1"
          [value]="motionIndex()"
          [labels]="motionLabels"
          (valueChange)="setMotion(motionLevels[$event]!.id)"
        />
      </app-setting-row>
      <app-setting-row
        title="Animations"
        hint="Transitions and movement of the interface (not the background)."
      >
        <app-step-slider
          label="Animations"
          [max]="animationLevels.length - 1"
          [value]="animationIndex()"
          [labels]="animationLabels"
          (valueChange)="s.animations.set(animationLevels[$event]!.id)"
        />
      </app-setting-row>
      <app-setting-row
        title="Introduction"
        hint="The animation that plays once each time you open the browser."
      >
        <button type="button" class="btn btn-sm" (click)="replayIntro()">
          <app-icon name="play" [size]="14" /> {{ 'Watch it again' | t }}
        </button>
      </app-setting-row>
    </section>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Interface' | t }}</h2>
      <app-collapse class="mb-3" title="Corner style" [summary]="corners[s.cornerStep()].name">
        <span
          preview
          class="h-7 w-7 border-l-2 border-t-2 border-accent transition-[border-radius] duration-300"
          [style.border-top-left-radius.px]="corners[s.cornerStep()].large"
        ></span>
        <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <!-- A small piece of the app that follows the slider -->
          <div
            class="flex flex-col gap-3 border border-white/10 bg-ink-900/70 p-3.5 transition-[border-radius] duration-300"
            [style.border-radius.px]="corners[s.cornerStep()].large"
            aria-hidden="true"
          >
            <div class="flex items-center gap-2.5">
              <span
                class="flex h-9 w-9 items-center justify-center bg-accent/25 text-sm font-bold text-accent transition-[border-radius] duration-300"
                [style.border-radius.px]="corners[s.cornerStep()].large"
                >A</span
              >
              <span class="flex-1 space-y-1.5">
                <span class="block h-2 w-20 rounded-full bg-white/25"></span>
                <span class="block h-2 w-14 rounded-full bg-white/10"></span>
              </span>
            </div>
            <span
              class="block max-w-[80%] self-start bg-white/[.08] px-3 py-2 text-xs transition-[border-radius] duration-300"
              [style.border-radius.px]="corners[s.cornerStep()].large"
              >{{ 'Hello! How do the corners look?' | t }}</span
            >
            <span
              class="block max-w-[80%] self-end bg-accent px-3 py-2 text-xs text-[var(--accent-ink)] transition-[border-radius] duration-300"
              [style.border-radius.px]="corners[s.cornerStep()].large"
              >{{ 'Great!' | t }}</span
            >
            <div class="flex items-center gap-2">
              <span
                class="h-9 flex-1 border border-white/15 bg-white/[.04] transition-[border-radius] duration-300"
                [style.border-radius.px]="corners[s.cornerStep()].small"
              ></span>
              <span
                class="flex h-9 items-center bg-accent px-3.5 text-xs font-semibold text-[var(--accent-ink)] transition-[border-radius] duration-300"
                [style.border-radius.px]="corners[s.cornerStep()].small"
                >{{ 'Button' | t }}</span
              >
            </div>
          </div>

          <div class="flex min-w-0 flex-col justify-center gap-4">
            <div class="flex items-baseline justify-between gap-3">
              <b class="text-lg text-accent">{{ corners[s.cornerStep()].name | t }}</b>
              <span class="font-mono text-[0.6875rem] text-muted"
                >{{ corners[s.cornerStep()].small }} / {{ corners[s.cornerStep()].large }} px</span
              >
            </div>
            <div class="grid grid-cols-7 gap-1.5">
              @for (c of corners; track c.name; let i = $index) {
                <button
                  type="button"
                  class="flex aspect-square items-center justify-center rounded-ui border p-1.5 transition-colors"
                  [class]="
                    i === s.cornerStep()
                      ? 'border-accent bg-accent/15'
                      : 'border-white/10 hover:border-white/25 hover:bg-white/[.05]'
                  "
                  [attr.aria-label]="c.name | t"
                  [attr.title]="c.name | t"
                  (click)="s.cornerStep.set(i)"
                >
                  <span
                    class="block h-full w-full border-l-2 border-t-2 transition-colors"
                    [class]="i === s.cornerStep() ? 'border-accent' : 'border-white/40'"
                    [style.border-top-left-radius.px]="c.large"
                  ></span>
                </button>
              }
            </div>
            <app-step-slider
              class="!w-full"
              label="Corner style"
              [max]="corners.length - 1"
              [value]="s.cornerStep()"
              [labels]="cornerLabels"
              (valueChange)="s.cornerStep.set($event)"
            />
          </div>
        </div>
      </app-collapse>
      <app-setting-row title="Text size">
        <app-step-slider
          label="Text size"
          [min]="12"
          [max]="18"
          [value]="sizePreview() ?? s.fontSize()"
          [labels]="sizeLabels()"
          (valueChange)="sizePreview.set($event)"
          (committed)="commitSize($event)"
        />
      </app-setting-row>
    </section>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Chat' | t }}</h2>
      <app-setting-row
        title="Actions over a message"
        hint="The bar with reactions and options that shows when you point at a message."
      >
        <app-toggle
          [checked]="s.messageActions()"
          (checkedChange)="s.messageActions.set($event)"
          [label]="'Actions over a message' | t"
        />
      </app-setting-row>
      <div>
        <app-collapse title="Chat bubbles" [summary]="s.bubbleOwn() ? 'Custom' : 'Accent color'">
          <span preview class="flex gap-1">
            <span
              class="h-5 w-8 rounded-ui"
              [style.background]="
                s.bubbleStyle() === 'neon' ? s.bubbleOwn() || accentHex() : ownCss()
              "
            ></span>
            <span
              class="h-5 w-8 rounded-ui"
              [style.background]="s.bubbleOther() || 'rgba(255,255,255,.1)'"
            ></span>
          </span>
          <div class="space-y-4">
            <div>
              <div class="mb-2 text-xs text-muted">{{ 'Bubble style' | t }}</div>
              <div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
                @for (b of bubbles; track b.id) {
                  <button
                    type="button"
                    class="rounded-ui border p-2 text-center text-[0.6875rem] hover:bg-white/5"
                    [class.border-accent]="s.bubbleStyle() === b.id"
                    [class.bg-accent/10]="s.bubbleStyle() === b.id"
                    [class.border-white/10]="s.bubbleStyle() !== b.id"
                    (click)="s.bubbleStyle.set(b.id)"
                  >
                    <span class="mb-1.5 flex flex-col gap-1" [class]="'bs-preview bs-' + b.id">
                      <span class="bubble-in self-start px-2 py-1 text-[0.625rem]">Hi</span>
                      <span class="bubble-out self-end px-2 py-1 text-[0.625rem]">Hey</span>
                    </span>
                    {{ b.label | t }}
                  </button>
                }
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <span class="w-28 text-xs text-muted">{{ 'Your messages' | t }}</span>
              <span
                class="inline-flex transition-opacity duration-300"
                [class.opacity-40]="ownGradient()"
                [class.pointer-events-none]="ownGradient()"
                [attr.inert]="ownGradient() ? '' : null"
              >
                <app-color-picker
                  [value]="s.bubbleOwn() || accentHex()"
                  [size]="30"
                  label="Your messages"
                  (valueChange)="s.bubbleOwn.set($event)"
                />
              </span>
              <span
                class="inline-flex transition-opacity duration-300"
                [class.opacity-40]="s.bubbleStyle() === 'neon'"
                [class.pointer-events-none]="s.bubbleStyle() === 'neon'"
                [attr.title]="
                  s.bubbleStyle() === 'neon' ? ('Neon bubbles use a single color.' | t) : null
                "
              >
                <app-segmented
                  [options]="colorModes"
                  [value]="ownGradient() && s.bubbleStyle() !== 'neon' ? 'gradient' : 'solid'"
                  (valueChange)="toggleOwnGradient($event === 'gradient')"
                />
              </span>
            </div>
            <app-reveal [open]="!!ownGradient() && s.bubbleStyle() !== 'neon'">
              @if (ownGradient(); as grad) {
                <app-gradient-controls [parts]="grad" (changed)="changeOwnGradient($event)" />
              }
            </app-reveal>
            <div class="flex flex-wrap items-center gap-3">
              <span class="w-28 text-xs text-muted">{{ 'Their messages' | t }}</span>
              <app-color-picker
                [value]="s.bubbleOther() || '#2a2f3c'"
                [size]="30"
                label="Their messages"
                (valueChange)="s.bubbleOther.set($event)"
              />
            </div>
            <div class="flex flex-col gap-2 rounded-ui border border-white/8 bg-black/20 p-3">
              <span class="bubble-in self-start px-3 py-1.5 text-sm">{{
                'Hello! How are you?' | t
              }}</span>
              <span class="bubble-out self-end px-3 py-1.5 text-sm">{{
                'Great, thanks!' | t
              }}</span>
            </div>
            <button
              type="button"
              class="text-xs text-muted underline hover:text-fg"
              (click)="resetBubbles()"
            >
              {{ 'Reset' | t }}
            </button>
          </div>
        </app-collapse>
      </div>
    </section>

    <!-- a phone has no mouse: nothing to choose about the cursor -->
    @if (hasMouse) {
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'Cursor' | t }}</h2>
        <app-collapse title="Mouse cursor" [summary]="currentCursor()">
          <span preview class="flex gap-1">
            <span
              class="h-7 w-7"
              [style.background-image]="previewUrl('default', s.cursor())"
              style="background-size: contain; background-repeat: no-repeat; background-position: center"
            ></span>
            <span
              class="h-7 w-7"
              [style.background-image]="previewUrl('pointer', s.cursor())"
              style="background-size: contain; background-repeat: no-repeat; background-position: center"
            ></span>
          </span>
          <h4 class="label mb-2.5">{{ 'Shape' | t }}</h4>
          <div class="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            @for (c of cursors; track c.id) {
              <button
                type="button"
                class="flex flex-col items-center gap-1.5 rounded-ui border px-2 py-3 text-xs hover:bg-white/5"
                [class.border-accent]="s.cursor() === c.id"
                [class.bg-accent/10]="s.cursor() === c.id"
                [class.border-white/10]="s.cursor() !== c.id"
                (click)="s.cursor.set(c.id)"
              >
                @if (c.id === 'system') {
                  <app-icon name="cursor" [size]="26" class="text-muted" />
                } @else {
                  <span class="flex gap-1.5">
                    <span
                      class="h-8 w-8"
                      [style.background-image]="previewUrl('default', c.id)"
                      style="background-size: contain; background-repeat: no-repeat; background-position: center"
                    ></span>
                    <span
                      class="h-8 w-8"
                      [style.background-image]="previewUrl('pointer', c.id)"
                      style="background-size: contain; background-repeat: no-repeat; background-position: center"
                    ></span>
                  </span>
                }
                {{ c.label | t }}
              </button>
            }
          </div>

          <h4 class="label mb-2.5">{{ 'Behavior' | t }}</h4>
          <div
            class="mb-7 divide-y divide-white/6 overflow-hidden rounded-ui-lg border border-white/8 bg-black/15"
          >
            <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div>
                <div class="text-sm font-medium">{{ 'Animation' | t }}</div>
                <div class="text-xs text-muted">
                  {{ 'The cursor pulses with an outline around its shape.' | t }}
                </div>
              </div>
              <app-segmented
                [options]="animations"
                [value]="s.cursorAnimated() ? 'on' : 'off'"
                (valueChange)="s.cursorAnimated.set($event === 'on')"
              />
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div>
                <div class="text-sm font-medium">{{ 'Trail' | t }}</div>
                <div class="text-xs text-muted">{{ trailHint() | t }}</div>
              </div>
              <app-select
                class="w-44"
                label="Trail"
                [options]="trailOptions()"
                [value]="s.cursorTrail()"
                (valueChange)="s.cursorTrail.set($any($event))"
              />
            </div>
            @if (s.cursorTrail() !== 'off') {
              <label class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <span
                  ><span class="block text-sm font-medium">{{ 'Trail thickness' | t }}</span
                  ><span class="block text-xs text-muted">{{
                    'How wide the trail is' | t
                  }}</span></span
                >
                <span class="flex items-center gap-3"
                  ><input
                    type="range"
                    min="0.4"
                    max="2.5"
                    step="0.1"
                    class="w-44 accent-[var(--accent)]"
                    [value]="s.cursorTrailSize()"
                    (input)="s.cursorTrailSize.set(+$any($event.target).value)"
                  /><b
                    class="w-14 rounded-ui bg-white/[.06] px-2 py-0.5 text-center font-mono text-xs"
                    >{{ s.cursorTrailSize().toFixed(1) }}x</b
                  ></span
                >
              </label>
              <label class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                <span
                  ><span class="block text-sm font-medium">{{ 'Trail length' | t }}</span
                  ><span class="block text-xs text-muted">{{
                    'How long it takes to fade' | t
                  }}</span></span
                >
                <span class="flex items-center gap-3"
                  ><input
                    type="range"
                    min="0.3"
                    max="1.5"
                    step="0.1"
                    class="w-44 accent-[var(--accent)]"
                    [value]="s.cursorTrailLength()"
                    (input)="s.cursorTrailLength.set(+$any($event.target).value)"
                  /><b
                    class="w-14 rounded-ui bg-white/[.06] px-2 py-0.5 text-center font-mono text-xs"
                    >{{ s.cursorTrailLength().toFixed(1) }}x</b
                  ></span
                >
              </label>
            }
            <label class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <span
                ><span class="block text-sm font-medium">{{ 'Cursor size' | t }}</span
                ><span class="block text-xs text-muted">{{ 'From small to large' | t }}</span></span
              >
              <span class="flex items-center gap-3"
                ><input
                  type="range"
                  min="16"
                  max="56"
                  step="2"
                  class="w-44 accent-[var(--accent)]"
                  [value]="s.cursorSize()"
                  (input)="s.cursorSize.set(+$any($event.target).value)"
                /><b
                  class="w-14 rounded-ui bg-white/[.06] px-2 py-0.5 text-center font-mono text-xs"
                  >{{ s.cursorSize() }}px</b
                ></span
              >
            </label>
            <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <span
                ><span class="block text-sm font-medium">{{ 'Cursor color' | t }}</span
                ><span class="block text-xs text-muted">{{
                  'Also colors the trail. Empty follows the theme.' | t
                }}</span></span
              >
              <span class="flex items-center gap-2">
                @if (s.cursorColor()) {
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost"
                    (click)="s.cursorColor.set('')"
                  >
                    {{ 'Use theme color' | t }}
                  </button>
                }
                <app-color-picker
                  [value]="s.cursorColor() || accentHex()"
                  [size]="32"
                  shape="round"
                  label="Cursor color"
                  (valueChange)="s.cursorColor.set($event)"
                />
              </span>
            </div>
          </div>
          <h4 class="label mb-2.5">{{ 'Your cursors' | t }}</h4>
          <div class="space-y-2">
            @for (c of s.customCursors(); track c.id) {
              <div
                class="flex flex-wrap items-center gap-3 rounded-ui border p-2"
                [class.border-accent]="s.cursor() === 'custom:' + c.id"
                [class.border-white/10]="s.cursor() !== 'custom:' + c.id"
              >
                <button
                  type="button"
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-ui bg-black/30 hover:bg-white/10"
                  (click)="s.cursor.set('custom:' + c.id)"
                  [attr.aria-label]="'Use this cursor' | t"
                >
                  <img [src]="c.data" alt="" class="max-h-8 max-w-8 object-contain" />
                </button>
                <input
                  class="input selectable !h-9 min-w-0 flex-1"
                  maxlength="24"
                  [value]="c.name"
                  (change)="renameCursor(c.id, $any($event.target).value)"
                  [attr.aria-label]="'Cursor name' | t"
                />
                @if (c.kind !== 'cur' && !c.hot) {
                  <app-select
                    class="w-48"
                    label="Click point"
                    [options]="clickPointOptions()"
                    [value]="c.point"
                    (valueChange)="setClickPoint(c.id, $event)"
                  />
                }
                @if (c.kind === 'animated') {
                  <span class="chip chip-accent">{{ 'Animated' | t }}</span>
                }
                <button
                  type="button"
                  class="btn btn-icon btn-sm btn-soft-danger"
                  (click)="removeCursor(c.id)"
                  [attr.aria-label]="'Delete' | t"
                >
                  <app-icon name="trash" [size]="14" />
                </button>
              </div>
            } @empty {
              <p class="text-xs text-muted">
                {{ 'Upload a cursor file and it appears here, ready to name and use.' | t }}
              </p>
            }
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button class="btn btn-sm btn-primary" type="button" (click)="uploadCursor()">
              <app-icon name="upload" [size]="14" /> {{ 'Upload your cursor' | t }}
            </button>
            <span class="text-xs text-muted">{{
              'Works with .cur, .ani (animated), PNG, GIF and WebP, up to 1 MB. Stored only on this device.'
                | t
            }}</span>
          </div>
        </app-collapse>
      </section>
    }

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Presets' | t }}</h2>
      <app-collapse title="Theme presets" summary="Save, apply and share the look of the app">
        <app-presets kind="theme" />
      </app-collapse>
    </section>
  `,
})
export class AppearanceSectionComponent {
  protected readonly s = inject(SettingsService);
  private readonly images = inject(ImageService);
  private readonly fontFiles = inject(FontService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly accents = ACCENTS;
  protected readonly themes = THEMES;
  protected readonly fonts = FONTS;

  /** The files of the typefaces start to download as soon as the section opens, so the previews are ready when the fold is. */
  constructor() {
    for (const font of FONTS) {
      void document.fonts.load('16px ' + font.css).catch(function ignore() {
        return undefined;
      });
    }
  }
  protected readonly backgrounds = BACKGROUNDS;
  protected readonly cursors = CURSORS;
  protected readonly bubbles: { id: BubbleStyle; label: string }[] = [
    { id: 'tail', label: 'Tail' },
    { id: 'round', label: 'Round' },
    { id: 'square', label: 'Square' },
    { id: 'gloss', label: 'Gloss' },
    { id: 'outline', label: 'Outline' },
    { id: 'minimal', label: 'Minimal' },
    { id: 'glass', label: 'Glass' },
    { id: 'neon', label: 'Neon' },
    { id: 'leaf', label: 'Leaf' },
    { id: 'ticket', label: 'Ticket' },
    { id: 'block', label: 'Block' },
    { id: 'dashed', label: 'Dashed' },
  ];
  /** False on a phone or a tablet (no mouse): the options of the cursor are not shown. */
  protected readonly hasMouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
  protected readonly corners = CORNER_STEPS;
  /** The names of the three classic corner styles, under the slider at their steps. */
  protected readonly cornerLabels: StepLabel[] = [
    { at: 1, text: 'Sharp' },
    { at: 3, text: 'Soft' },
    { at: 5, text: 'Round' },
  ];
  protected readonly shuffleModes = [
    { id: 'reload', label: 'On every reload' },
    { id: 'interval', label: 'Every few minutes' },
  ];
  protected readonly animations = [
    { id: 'off', label: 'Static' },
    { id: 'on', label: 'Animated' },
  ];
  protected readonly trails = TRAILS;
  /** The trails as the options of a drop-down list. */
  protected readonly trailOptions = computed(this.buildTrailOptions.bind(this));
  /** Where a cursor file clicks. */
  protected readonly clickPointOptions = computed(this.buildClickPointOptions.bind(this));

  /** The trails with their names in the language in use. */
  private buildTrailOptions(): SelectOption[] {
    return TRAILS.map(
      function toOption(this: AppearanceSectionComponent, trail: { id: string; label: string }) {
        return { value: trail.id, label: this.i18n.t(trail.label) };
      }.bind(this),
    );
  }

  /** The two places a cursor file can click. */
  private buildClickPointOptions(): SelectOption[] {
    return [
      { value: 'center', label: this.i18n.t('Center') },
      { value: 'corner', label: this.i18n.t('Top-left corner') },
    ];
  }
  protected readonly motionLevels = [
    { id: 'off', label: 'Off' },
    { id: 'calm', label: 'Slow' },
    { id: 'normal', label: 'Normal' },
    { id: 'lively', label: 'Fast' },
  ];
  protected readonly animationLevels: { id: 'off' | 'quick' | 'full'; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'quick', label: 'Quick' },
    { id: 'full', label: 'Full' },
  ];
  /** The steps of "background visibility", from the one that shows the least. */
  protected readonly visibilityLevels = [
    { id: 'solid', label: 'Solid' },
    { id: 'soft', label: 'Soft' },
    { id: 'medium', label: 'Medium' },
    { id: 'clear', label: 'Clear' },
    { id: 'open', label: 'Open' },
  ];
  /** Place of the chosen animations in the slider. */
  protected readonly visibilityLabels = this.labelsOf(this.visibilityLevels);
  protected readonly motionLabels = this.labelsOf(this.motionLevels);
  protected readonly animationLabels = this.labelsOf(this.animationLevels);
  /** The size being dragged (the text of the page changes only when the thumb is let go, so the slider stays still). */
  protected readonly sizePreview = signal<number | null>(null);
  /** The names under the blur slider: the ends and the value in use. */
  protected readonly blurLabels = computed(this.buildBlurLabels.bind(this));
  /** The names under the text size slider: the ends and the size in use. */
  protected readonly sizeLabels = computed(this.buildSizeLabels.bind(this));
  protected readonly animationIndex = computed(this.findAnimationIndex.bind(this));

  /** The step of the slider that matches the animations setting. */
  private findAnimationIndex(): number {
    return Math.max(
      0,
      this.animationLevels.findIndex(
        function same(this: AppearanceSectionComponent, level: { id: string }) {
          return level.id === this.s.animations();
        }.bind(this),
      ),
    );
  }

  /** Place of the chosen motion in the slider. */
  protected readonly motionIndex = computed(this.findMotionIndex.bind(this));

  /** The step of the slider that matches the motion of the background. */
  private findMotionIndex(): number {
    const index = this.motionLevels.findIndex(
      function same(this: AppearanceSectionComponent, level: { id: string }) {
        return level.id === this.s.bgMotion();
      }.bind(this),
    );
    return Math.max(0, index);
  }

  protected readonly currentTheme = computed(
    function (this: AppearanceSectionComponent) {
      return (
        THEMES.find(
          function (
            this: AppearanceSectionComponent,
            t: { id: ThemeId; label: string; colors: [string, string, string] },
          ) {
            return t.id === this.s.theme();
          }.bind(this),
        ) ?? THEMES[0]!
      );
    }.bind(this),
  );
  protected readonly currentFont = computed(
    function (this: AppearanceSectionComponent) {
      return (
        FONTS.find(
          function (
            this: AppearanceSectionComponent,
            f: { id: FontId; label: string; css: string },
          ) {
            return f.id === this.s.font();
          }.bind(this),
        ) ?? FONTS[0]!
      );
    }.bind(this),
  );
  protected readonly currentAccent = computed(
    function (this: AppearanceSectionComponent) {
      return this.s.accent() === 'custom'
        ? 'Custom color'
        : (ACCENTS.find(
            function (
              this: AppearanceSectionComponent,
              a: { id: AccentId; label: string; color: string },
            ) {
              return a.id === this.s.accent();
            }.bind(this),
          )?.label ?? 'Mint');
    }.bind(this),
  );
  protected readonly currentBackground = computed(
    function (this: AppearanceSectionComponent) {
      return (
        BACKGROUNDS.find(
          function (this: AppearanceSectionComponent, b: { id: BackgroundId; label: string }) {
            return b.id === this.s.background();
          }.bind(this),
        )?.label ?? 'Aurora'
      );
    }.bind(this),
  );
  /** Parts of the custom theme that can be chosen: the base color and four more. */
  protected readonly themeParts = [
    {
      id: 'base',
      label: 'Base color',
      hint: 'Everything else is calculated from this one. Pick a dark one.',
      fallback: '#1b1530',
    },
    { id: 'panel', label: 'Panels', hint: 'Cards, menus and the chat area', fallback: '#1b1530' },
    { id: 'text', label: 'Text', hint: 'Main text color', fallback: '#e8ecf4' },
    {
      id: 'muted',
      label: 'Soft text',
      hint: 'Descriptions and secondary text',
      fallback: '#98a2b3',
    },
    {
      id: 'accent2',
      label: 'Second accent',
      hint: 'Used in gradients, channels and trails',
      fallback: '#8b5cf6',
    },
  ];

  /** The color of a part of the custom theme (the base or one of the pieces). */
  protected partValue(id: string): string {
    return id === 'base'
      ? this.s.customTheme()
      : ((this.s.customThemeParts() as unknown as Record<string, string>)[id] ?? '');
  }

  /** Changes the color of a part of the custom theme. */
  protected setPart(id: string, value: string): void {
    if (id === 'base') this.s.customTheme.set(value);
    else
      this.s.customThemeParts.update(function (p) {
        return { ...p, [id]: value };
      });
  }

  protected readonly trailHint = computed(
    function (this: AppearanceSectionComponent) {
      return (
        TRAILS.find(
          function (
            this: AppearanceSectionComponent,
            e: { id: TrailType | 'off'; label: string; hint: string },
          ) {
            return e.id === this.s.cursorTrail();
          }.bind(this),
        )?.hint ?? 'No trail'
      );
    }.bind(this),
  );
  protected readonly currentCursor = computed(this.cursorName.bind(this));
  protected readonly ownCss = computed(this.computeOwnBubble.bind(this));

  /** The name of the cursor chosen, for the summary of its section. */
  private cursorName(): string {
    const mode = this.s.cursor();
    const own = this.s.customCursors().find(function (c) {
      return 'custom:' + c.id === mode;
    });
    return own
      ? own.name
      : (CURSORS.find(function (c) {
          return c.id === mode;
        })?.label ?? 'Themed');
  }

  /** The color or gradient of the own bubbles, for the preview. */
  private computeOwnBubble(): string {
    const grad = this.ownGradient();
    return grad ? gradientCss(grad) : this.s.bubbleOwn() || this.accentHex();
  }

  /** The accent color as #rrggbb (the custom one or the one of the chosen name). */
  protected accentHex(): string {
    return this.s.accent() === 'custom'
      ? this.s.customAccent()
      : (ACCENTS.find(
          function (
            this: AppearanceSectionComponent,
            a: { id: AccentId; label: string; color: string },
          ) {
            return a.id === this.s.accent();
          }.bind(this),
        )?.color ?? '#2ef2b0');
  }

  /** CSS `url(...)` of a cursor shape for the previews (animated when animation is on). */
  /** The cursor previews already drawn (they are the same until the accent color changes). */
  private readonly previewCache = new Map<string, string>();

  /** The picture of a cursor for the previews of the cards (made once per family, state and color). */
  protected previewUrl(name: string, mode: CursorMode): string | null {
    if (mode === 'system') return null;
    const own = this.s.customCursors().find(function (c) {
      return 'custom:' + c.id === mode;
    });
    if (own) return `url("${own.data}")`;
    const family = FAMILIES.includes(mode) ? mode : 'classic';
    const key = family + '|' + name + '|' + this.accentHex();
    let url = this.previewCache.get(key);
    if (!url) {
      url = `url("data:image/svg+xml,${encodeURIComponent(svgCursor(family, name, this.accentHex(), 32, false))}")`;
      this.previewCache.set(key, url);
    }
    return url;
  }

  /** The names under a slider with named steps: one at each step. */
  private labelsOf(levels: { label: string }[]): StepLabel[] {
    return levels.map(function name(level, at) {
      return { at, text: level.label };
    });
  }

  /** The ends of the blur slider and, between them, the value in use. */
  private buildBlurLabels(): StepLabel[] {
    return this.endsAndCurrent(0, 100, this.s.bgBlur(), '0', '100', String(this.s.bgBlur()));
  }

  /** The ends of the text size slider and, between them, the size in use. */
  private buildSizeLabels(): StepLabel[] {
    const size = this.sizePreview() ?? this.s.fontSize();
    return this.endsAndCurrent(12, 18, size, '12px', '18px', size + 'px');
  }

  /** Names for the two ends and for the value in use (when it is not at one of the ends). */
  private endsAndCurrent(
    min: number,
    max: number,
    value: number,
    first: string,
    last: string,
    current: string,
  ): StepLabel[] {
    const room = (max - min) * 0.18;
    const labels: StepLabel[] = [];
    if (value - min > room || value === min) {
      labels.push({ at: min, text: first });
    }
    if (max - value > room || value === max) {
      labels.push({ at: max, text: last });
    }
    if (value > min && value < max) {
      labels.push({ at: value, text: current });
    }
    return labels;
  }

  private readonly arrival = inject(ArrivalService);

  /** Plays the introduction again. */
  protected replayIntro(): void {
    void this.arrival.replayIntro();
  }

  /** The person let go of the text size slider: now the whole page changes to the new size. */
  protected commitSize(size: number): void {
    this.s.fontSize.set(size);
    this.sizePreview.set(null);
  }

  /** Sets how the background changes: when the page loads or every few minutes. */
  protected setShuffle(v: string): void {
    this.s.bgShuffleMode.set(v === 'interval' ? 'interval' : 'reload');
  }
  /** Sets how fast the animated background moves. */
  protected setMotion(v: string): void {
    this.s.bgMotion.set(v as 'lively' | 'normal' | 'calm' | 'off');
  }

  /** The gradient of the own bubbles, or null when they are one color. */
  /** The two ways to colour something: one plain colour or a gradient. */
  protected readonly colorModes = [
    { id: 'solid', label: 'Color' },
    { id: 'gradient', label: 'Gradient' },
  ];
  protected readonly ownGradient = computed(
    function (this: AppearanceSectionComponent) {
      const grad = parseMulti(this.s.bubbleOwnGrad());
      if (grad) {
        return { angle: grad.angle, stops: grad.stops };
      }
      const second = this.s.bubbleOwnTo();
      if (second) {
        return {
          angle: 135,
          stops: [
            { color: this.s.bubbleOwn() || this.accentHex(), pos: 0 },
            { color: second, pos: 100 },
          ],
        };
      }
      return null;
    }.bind(this),
  );

  /** Turns the gradient of the own bubbles on or off. */
  protected toggleOwnGradient(active: boolean): void {
    this.s.bubbleOwnTo.set('');
    if (!active) {
      this.s.bubbleOwnGrad.set('');
      return;
    }
    const first = this.s.bubbleOwn() || this.accentHex();
    this.s.bubbleOwnGrad.set(
      encodeMulti(135, 100, [
        { color: first, pos: 0 },
        { color: '#818cf8', pos: 100 },
      ]),
    );
  }

  /** A change in the controls of the gradient of the own bubbles. */
  protected changeOwnGradient(change: Partial<GradientParts>): void {
    const current = this.ownGradient();
    if (!current) {
      return;
    }
    const next = { ...current, ...change };
    this.s.bubbleOwnTo.set('');
    this.s.bubbleOwnGrad.set(encodeMulti(next.angle, 100, next.stops));
  }

  /** Goes back to the colors of the bubbles that follow the accent. */
  protected resetBubbles(): void {
    this.s.bubbleOwn.set('');
    this.s.bubbleOwnTo.set('');
    this.s.bubbleOwnGrad.set('');
    this.s.bubbleOther.set('');
  }

  /** Uploads a cursor file (.cur, .ani, PNG, GIF, WebP), converts it and adds it to the list with an editable name. */
  protected async uploadCursor(): Promise<void> {
    const file = await this.images.pickFile(
      'image/png,image/gif,image/webp,image/svg+xml,image/jpeg,.cur,.ani,.ico',
    );
    if (!file) return;
    try {
      const parsed = await readCursorFile(file);
      const data = parsed.kind === 'image' ? await cursorImageToDataUrl(file) : parsed.data;
      const created: CustomCursor = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || this.i18n.t('My cursor'),
        data,
        kind: parsed.kind,
        frames: parsed.frames,
        point: 'center',
        hot: parsed.hot,
        width: parsed.width,
        height: parsed.height,
      };
      this.s.customCursors.update(function (list) {
        return [...list, created];
      });
      this.s.cursor.set('custom:' + created.id);
    } catch (e) {
      this.toast.error(
        this.i18n.t('That image could not be read'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    }
  }

  /** Renames an uploaded cursor (up to 24 letters). */
  protected renameCursor(id: string, name: string): void {
    const clean = name.trim().slice(0, 24);
    if (!clean) return;
    this.changeCursor(id, { name: clean });
  }

  /** Says whether the point of an uploaded cursor is its center or its corner. */
  protected setClickPoint(id: string, point: string): void {
    this.changeCursor(id, { point: point === 'corner' ? 'corner' : 'center' });
  }

  /** Changes part of an uploaded cursor. */
  private changeCursor(id: string, change: Partial<CustomCursor>): void {
    this.s.customCursors.update(function (list) {
      return list.map(function (c) {
        return c.id === id ? { ...c, ...change } : c;
      });
    });
  }

  /** Deletes an uploaded cursor. */
  protected removeCursor(id: string): void {
    this.s.customCursors.update(function (list) {
      return list.filter(function (c) {
        return c.id !== id;
      });
    });
    if (this.s.cursor() === 'custom:' + id) this.s.cursor.set('classic');
  }

  /** Uses the uploaded font, or asks for the file first when there is none. */
  protected async chooseCustomFont(): Promise<void> {
    if (this.s.customFontName()) {
      this.s.font.set('custom');
      return;
    }
    try {
      await this.fontFiles.upload('ui');
      if (this.s.customFontName()) {
        this.s.font.set('custom');
      }
    } catch (e) {
      this.toast.error(
        this.i18n.t('Could not load the font'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    }
  }

  /** Deletes the uploaded font. */
  protected async removeCustomFont(event: Event): Promise<void> {
    event.stopPropagation();
    await this.fontFiles.remove('ui');
  }

  protected readonly wallpaper = inject(WallpaperStore);

  /** Lets the person choose a picture, a GIF or a video for the background. */
  protected async pickWallpaper(): Promise<void> {
    try {
      await this.wallpaper.choose();
      this.s.wallpaper.set('');
    } catch (e) {
      this.toast.error(
        this.i18n.t('That file could not be used'),
        this.i18n.t(e instanceof Error ? e.message : 'Unknown error'),
      );
    }
  }

  /** Removes the wallpaper. */
  protected async removeWallpaper(): Promise<void> {
    await this.wallpaper.remove();
    this.s.wallpaper.set('');
  }
}
