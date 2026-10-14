/**
 * src/app/features/voice/background-picker.component.ts
 * The window of the camera of a call: a live preview of how the others see you, and the options in folded sections of the style
 * of the app. Background: none, a blur (with its strength), your own colors or gradient, ready-made backgrounds, and the pictures
 * and GIFs of your library (encrypted before they leave the device, in your account or only on this device). Image: mirror
 * (everybody sees it mirrored), brightness, contrast, saturation and zoom. Every change is applied at once, also in the middle
 * of a call.
 */
import {
  ApplicationRef,
  Component,
  DestroyRef,
  EnvironmentInjector,
  computed,
  createComponent,
  effect,
  inject,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import {
  CallBackgroundService,
  PRESET_BACKGROUNDS,
} from '../../core/services/call-background.service';
import { CallService } from '../../core/services/call.service';
import {
  canChangeCamera,
  isNeutral,
  startCameraFx,
  type CameraFx,
} from '../../core/services/camera-fx';
import { SettingsService } from '../../core/services/settings.service';
import { ToastService } from '../../core/services/toast.service';
import { VaultService, type VaultItem } from '../../core/services/vault.service';
import { FoldComponent } from '../../shared/components/fold.component';
import { GradientControlsComponent } from '../../shared/components/gradient-controls.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { ToggleComponent } from '../../shared/components/controls.component';
import type { GradientParts } from '../../shared/util/gradient';
import { MediaStreamDirective } from '../../shared/util/media-stream.directive';

/** The choices that are not a picture: id, name and an icon. */
const BASIC = [
  { id: 'none', name: 'None', icon: 'video-off' },
  { id: 'blur', name: 'Blur', icon: 'eye-off' },
];

/** The window of the camera. */
@Component({
  selector: 'app-background-picker',
  standalone: true,
  imports: [
    ModalComponent,
    IconComponent,
    FoldComponent,
    ToggleComponent,
    GradientControlsComponent,
    MediaStreamDirective,
    TranslatePipe,
  ],
  template: `
    <app-modal
      [title]="'Camera' | t"
      [subtitle]="'How the others see you: background, mirror and picture.' | t"
      [width]="860"
      (closed)="closed.emit()"
    >
      <div class="cs-layout">
        <div class="cs-side">
          <div
            class="cs-frame"
            [class.is-pannable]="zoomed()"
            [class.is-panning]="panning()"
            (pointerdown)="panStart($event)"
            (pointermove)="panMove($event)"
            (pointerup)="panEnd($event)"
            (pointercancel)="panEnd($event)"
          >
            @if (stream(); as live) {
              <video [appMediaStream]="live" muted playsinline class="cs-video"></video>
            } @else {
              <div class="cs-empty">
                <app-icon [name]="failed() ? 'alert-triangle' : 'video'" [size]="26" />
                <span>{{
                  (failed() ? 'The camera is not available.' : 'Starting the camera…') | t
                }}</span>
              </div>
            }
            <span class="cs-live">{{ 'Preview' | t }}</span>
            @if (zoomed()) {
              <span class="cs-hint">{{ 'Drag the picture to move the camera.' | t }}</span>
            }
          </div>
          @if (!supported) {
            <p class="mt-3 rounded-ui bg-amber-400/10 p-3 text-xs text-amber-200">
              {{ 'This browser cannot change the background of the camera.' | t }}
            </p>
          }
          <p class="mt-3 text-[0.6875rem] text-dim">
            {{
              'The effects are made on your device: nothing about your camera is sent to anyone to make them.'
                | t
            }}
          </p>
        </div>

        <div class="cs-options">
          <app-fold [startOpen]="true">
            <span foldTitle>{{ 'Background' | t }}</span>
            <span foldHint>{{ currentName() | t }}</span>
            <div class="cs-section">
              <div class="cs-grid">
                @for (b of basic; track b.id) {
                  <button
                    type="button"
                    class="cs-tile"
                    [class.is-on]="choice() === b.id"
                    [attr.aria-pressed]="choice() === b.id"
                    (click)="choose(b.id)"
                  >
                    <span class="cs-art" [attr.data-kind]="b.id"
                      ><app-icon [name]="b.icon" [size]="22"
                    /></span>
                    <span class="cs-name">{{ b.name | t }}</span>
                    <span class="pick-dot"></span>
                  </button>
                }
                <button
                  type="button"
                  class="cs-tile"
                  [class.is-on]="choice() === 'custom'"
                  [attr.aria-pressed]="choice() === 'custom'"
                  (click)="choose('custom')"
                >
                  <span class="cs-art" [style.background]="customCss()"
                    ><app-icon name="palette" [size]="20" class="cs-art-icon"
                  /></span>
                  <span class="cs-name">{{ 'Custom' | t }}</span>
                  <span class="pick-dot"></span>
                </button>
                @for (p of presets; track p.id) {
                  <button
                    type="button"
                    class="cs-tile"
                    [class.is-on]="choice() === 'preset:' + p.id"
                    [attr.aria-pressed]="choice() === 'preset:' + p.id"
                    (click)="choose('preset:' + p.id)"
                  >
                    <span
                      class="cs-art"
                      [style.background]="
                        'linear-gradient(' + p.angle + 'deg,' + p.stops.join(',') + ')'
                      "
                    ></span>
                    <span class="cs-name">{{ p.name | t }}</span>
                    <span class="pick-dot"></span>
                  </button>
                }
              </div>

              @if (choice() === 'blur') {
                <label class="cs-slider anim-fade-in">
                  <span>{{ 'Strength' | t }}</span>
                  <b>{{ settings.callBackgroundBlur() }}</b>
                  <input
                    type="range"
                    min="2"
                    max="40"
                    [value]="settings.callBackgroundBlur()"
                    (input)="setBlur(+$any($event.target).value)"
                    [attr.aria-label]="'Strength' | t"
                  />
                </label>
              }
              @if (choice() !== 'none') {
                <label class="cs-slider anim-fade-in">
                  <span>{{ 'Soft edge' | t }}</span>
                  <b>{{ settings.cameraEdgeSoftness() }}%</b>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    [value]="settings.cameraEdgeSoftness()"
                    (input)="setSoftness(+$any($event.target).value)"
                    [attr.aria-label]="'Soft edge' | t"
                  />
                </label>
              }
              @if (choice() === 'custom') {
                <div class="cs-custom anim-fade-in">
                  <p class="mb-2 text-xs text-muted">
                    {{
                      'Choose your colors: one is a flat color, two or more make a gradient.' | t
                    }}
                  </p>
                  <app-gradient-controls [parts]="customParts()" (changed)="setCustom($event)" />
                </div>
              }
            </div>
          </app-fold>

          <app-fold>
            <span foldTitle>{{ 'Your library' | t }}</span>
            <span foldHint>{{ vault.items().length }}</span>
            <div class="cs-section">
              <p class="cs-lock">
                <app-icon name="lock" [size]="11" /> {{ 'Encrypted, only you can open it' | t }}
              </p>
              <div class="cs-grid">
                <button type="button" class="cs-tile cs-add" [disabled]="busy()" (click)="add()">
                  <span class="cs-art"><app-icon name="plus" [size]="22" /></span>
                  <span class="cs-name">{{ 'Add a file or GIF' | t }}</span>
                </button>
                @for (item of vault.items(); track item.id) {
                  <div
                    class="cs-tile anim-fade-in"
                    role="button"
                    tabindex="0"
                    [class.is-on]="choice() === 'vault:' + item.id"
                    [attr.aria-pressed]="choice() === 'vault:' + item.id"
                    (click)="choose('vault:' + item.id)"
                    (keydown.enter)="choose('vault:' + item.id)"
                  >
                    <span
                      class="cs-art"
                      [style.background-image]="'url(' + item.meta.thumb + ')'"
                    ></span>
                    <span class="cs-name">{{ item.meta.name }}</span>
                    <span class="pick-dot"></span>
                    <span class="cs-where" [attr.title]="whereTitle(item) | t">
                      <app-icon
                        [name]="item.where === 'account' ? 'globe' : 'monitor'"
                        [size]="11"
                      />
                    </span>
                    <button
                      type="button"
                      class="cs-remove"
                      [attr.aria-label]="'Remove' | t"
                      [attr.title]="'Remove' | t"
                      (click)="remove(item, $event)"
                    >
                      <app-icon name="trash" [size]="12" />
                    </button>
                  </div>
                }
              </div>
              @if (vault.items().length === 0 && !vault.loading()) {
                <p class="mt-2 text-xs text-dim">
                  {{
                    'Pictures and GIFs you add stay in your library, ready for the next call.' | t
                  }}
                </p>
              }
            </div>
          </app-fold>

          <app-fold [startOpen]="true">
            <span foldTitle>{{ 'Image' | t }}</span>
            <span foldHint>{{ (adjusted() ? 'Adjusted' : 'Default settings') | t }}</span>
            <div class="cs-section">
              <div class="cs-row">
                <span>{{ 'Mirror' | t }}</span>
                <app-toggle
                  [checked]="settings.cameraMirror()"
                  (checkedChange)="setMirror($event)"
                  [label]="'Mirror' | t"
                />
              </div>
              <p class="cs-note">{{ 'Everybody sees you as in a mirror.' | t }}</p>
              @for (s of sliders; track s.key) {
                <label class="cs-slider">
                  <span>{{ s.label | t }}</span>
                  <b>{{ valueOf(s.key) }}{{ s.unit }}</b>
                  <input
                    type="range"
                    [min]="s.min"
                    [max]="s.max"
                    [value]="valueOf(s.key)"
                    (input)="setSlider(s.key, +$any($event.target).value)"
                    [attr.aria-label]="s.label | t"
                  />
                </label>
              }
              <button
                type="button"
                class="btn btn-sm mt-1 gap-1.5"
                [disabled]="!adjusted()"
                (click)="resetImage()"
              >
                <app-icon name="refresh" [size]="13" /> {{ 'Reset' | t }}
              </button>
            </div>
          </app-fold>
        </div>
      </div>
    </app-modal>
  `,
  styles: `
    .cs-layout {
      display: grid;
      gap: 1.1rem;
      grid-template-columns: minmax(0, 1fr);
    }
    @media (min-width: 760px) {
      .cs-layout {
        grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
      }
      .cs-side {
        position: sticky;
        top: 0;
        align-self: start;
      }
    }
    .cs-frame {
      position: relative;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      border-radius: var(--r-lg, 14px);
      background: #000;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .cs-frame.is-pannable {
      cursor: grab;
      touch-action: none;
    }
    .cs-frame.is-panning {
      cursor: grabbing;
    }
    .cs-hint {
      position: absolute;
      left: 50%;
      bottom: 0.6rem;
      transform: translateX(-50%);
      padding: 0.15rem 0.6rem;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.55);
      font-size: 0.6875rem;
      color: #fff;
      pointer-events: none;
    }
    .cs-video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .cs-empty {
      display: flex;
      height: 100%;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-size: 0.8125rem;
      color: var(--muted, #9aa3b5);
    }
    .cs-live {
      position: absolute;
      left: 0.6rem;
      top: 0.6rem;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.55);
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #fff;
    }
    .cs-options {
      display: grid;
      align-content: start;
      gap: 0.6rem;
    }
    .cs-section {
      display: grid;
      gap: 0.75rem;
      padding: 0.2rem 0.8rem 0.9rem;
    }
    .cs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(6.4rem, 1fr));
      gap: 0.5rem;
    }
    .cs-tile {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      padding: 0.3rem;
      border-radius: calc(var(--r) * 0.8);
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      text-align: left;
      cursor: var(--cur-pointer, pointer);
      transition:
        transform 0.3s var(--ease),
        border-color 0.3s var(--ease),
        background-color 0.3s var(--ease);
    }
    .cs-tile:hover {
      transform: translateY(-1px);
      background: rgba(255, 255, 255, 0.06);
    }
    .cs-tile.is-on {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }
    .cs-art {
      display: grid;
      place-items: center;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      border-radius: calc(var(--r) * 0.55);
      background-color: rgba(255, 255, 255, 0.06);
      background-size: cover;
      background-position: center;
      color: var(--muted, #9aa3b5);
    }
    .cs-art[data-kind='blur'] {
      background-image: linear-gradient(135deg, #5b6b8c, #8e6fa8);
      color: #fff;
      filter: saturate(0.9);
    }
    .cs-art-icon {
      color: #fff;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
    }
    .cs-name {
      padding: 0 0.15rem 0.1rem;
      overflow: hidden;
      font-size: 0.6875rem;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* The round mark of the chosen one: an empty circle that fills when it is the one in use. */
    .pick-dot {
      position: absolute;
      top: 0.55rem;
      right: 0.55rem;
      width: 1rem;
      height: 1rem;
      border-radius: 999px;
      border: 2px solid rgba(255, 255, 255, 0.75);
      background: rgba(0, 0, 0, 0.35);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      transition:
        border-color 0.3s var(--ease),
        background-color 0.3s var(--ease);
    }
    .pick-dot::after {
      content: '';
      position: absolute;
      inset: 2px;
      border-radius: 999px;
      background: var(--accent);
      transform: scale(0);
      transition: transform 0.32s var(--ease);
    }
    .is-on > .pick-dot {
      border-color: var(--accent);
    }
    .is-on > .pick-dot::after {
      transform: scale(1);
    }
    .cs-add .cs-art {
      border: 2px dashed rgba(255, 255, 255, 0.18);
      background: transparent;
      transition:
        border-color 0.3s var(--ease),
        color 0.3s var(--ease);
    }
    .cs-add:hover .cs-art {
      border-color: var(--accent);
      color: var(--accent);
    }
    .cs-lock {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.6875rem;
      color: var(--accent);
    }
    .cs-where {
      position: absolute;
      left: 0.55rem;
      bottom: 1.7rem;
      display: grid;
      padding: 0.18rem;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
    }
    .cs-remove {
      position: absolute;
      right: 0.55rem;
      bottom: 1.7rem;
      display: grid;
      padding: 0.28rem;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      opacity: 0;
      transform: scale(0.8);
      transition:
        opacity 0.25s var(--ease),
        transform 0.3s var(--ease),
        background-color 0.2s var(--ease-suave);
    }
    .cs-tile:hover .cs-remove,
    .cs-remove:focus-visible {
      opacity: 1;
      transform: scale(1);
    }
    .cs-remove:hover {
      background: #c0392b;
    }
    .cs-slider {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.3rem 0.5rem;
      font-size: 0.75rem;
      color: var(--muted, #9aa3b5);
    }
    .cs-slider b {
      font-family: var(--font-code, monospace);
      font-size: 0.7rem;
      color: var(--fg, #fff);
    }
    .cs-slider input {
      grid-column: 1 / -1;
      width: 100%;
      accent-color: var(--accent);
    }
    .cs-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .cs-note {
      margin-top: -0.4rem;
      font-size: 0.6875rem;
      color: var(--dim, #6b7385);
    }
  `,
})
class BackgroundPickerComponent {
  /** The window was closed. */
  readonly closed = output<void>();

  protected readonly settings = inject(SettingsService);
  protected readonly vault = inject(VaultService);
  private readonly call = inject(CallService);
  private readonly backgrounds = inject(CallBackgroundService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(EnvironmentInjector);

  protected readonly basic = BASIC;
  protected readonly presets = PRESET_BACKGROUNDS;
  protected readonly supported = canChangeCamera();
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  /** The sliders of the image: the setting they change, their name, their range and what follows the number. */
  protected readonly sliders = [
    { key: 'brightness', label: 'Brightness', min: -50, max: 50, unit: '' },
    { key: 'contrast', label: 'Contrast', min: 50, max: 150, unit: '%' },
    { key: 'saturation', label: 'Color', min: 0, max: 200, unit: '%' },
    { key: 'zoom', label: 'Zoom', min: 100, max: 200, unit: '%' },
  ] as const;

  /** What the person has chosen for the background ('none', 'blur', 'custom', 'preset:...', 'vault:...'). */
  protected readonly choice = computed(this.currentChoice.bind(this));
  /** The preview camera of this window (only while the camera of the call is off). */
  private readonly own = signal<MediaStream | null>(null);
  private ownRaw: MediaStream | null = null;
  private ownFx: CameraFx | null = null;
  private applying: Promise<void> = Promise.resolve();
  /** What the preview shows: the camera of the call when it is on (it already has the effects), else the preview camera. */
  protected readonly stream = computed(this.currentStream.bind(this));
  /** The custom background as a gradient for its tile. */
  protected readonly customCss = computed(this.buildCustomCss.bind(this));
  /** The custom background as the parts the gradient editor wants. */
  protected readonly customParts = computed(this.buildCustomParts.bind(this));
  /** Whether any adjustment of the image is not at its place. */
  protected readonly adjusted = computed(this.isAdjusted.bind(this));
  /** Whether the zoom leaves room to move the camera. */
  protected readonly zoomed = computed(this.isZoomed.bind(this));
  /** Whether the preview is being dragged. */
  protected readonly panning = signal(false);
  /** Where the drag started: the pointer, the size of the preview and the pan it began with. */
  private grab: {
    x: number;
    y: number;
    width: number;
    height: number;
    panX: number;
    panY: number;
  } | null = null;

  constructor() {
    void this.vault.refresh();
    effect(this.watchCall.bind(this));
    inject(DestroyRef).onDestroy(this.stopOwn.bind(this));
  }

  /** The choice, in a form the template can compare ('blur-light' is the old name of the blur). */
  private currentChoice(): string {
    const value = this.settings.callBackground();
    return value === 'blur-light' ? 'blur' : value;
  }

  /** The stream of the preview. */
  private currentStream(): MediaStream | null {
    return this.call.cameraOn() ? this.call.localCamera() : this.own();
  }

  /** The name of the background in use (shown at the right of the title of its section). */
  protected currentName(): string {
    const value = this.choice();
    if (value === 'none') return 'None';
    if (value === 'blur') return 'Blur';
    if (value === 'custom') return 'Custom';
    if (value.startsWith('preset:')) {
      return (
        this.presets.find(function same(p) {
          return 'preset:' + p.id === value;
        })?.name ?? 'None'
      );
    }
    return 'Your library';
  }

  /** When the camera of the call is off the window opens its own preview, and when it turns on the preview goes. */
  private watchCall(): void {
    const on = this.call.cameraOn();
    untracked(
      function react(this: BackgroundPickerComponent): void {
        if (on) {
          this.stopOwn();
        } else if (!this.ownRaw) {
          void this.startOwn();
        }
      }.bind(this),
    );
  }

  /** Opens the camera for the preview, with the effects that are chosen. */
  private async startOwn(): Promise<void> {
    try {
      const raw = await this.call.openPreviewCamera();
      if (this.call.cameraOn()) {
        raw.getTracks().forEach(function stop(track) {
          track.stop();
        });
        return;
      }
      this.ownRaw = raw;
      const options = await this.backgrounds.options();
      this.ownFx = isNeutral(options) || !this.supported ? null : await startCameraFx(raw, options);
      this.own.set(this.ownFx ? this.ownFx.stream : raw);
      this.failed.set(false);
    } catch {
      this.failed.set(true);
    }
  }

  /** Stops the preview camera. */
  private stopOwn(): void {
    if (this.ownFx) {
      this.ownFx.stop();
    }
    this.ownRaw?.getTracks().forEach(function stop(track) {
      track.stop();
    });
    this.ownFx = null;
    this.ownRaw = null;
    this.own.set(null);
  }

  /** A setting changed: the camera of the call (or the preview) follows it at once. */
  private apply(): void {
    this.applying = this.applying.then(this.applyNow.bind(this));
  }

  /** The work of `apply`, one change after another. */
  private async applyNow(): Promise<void> {
    if (this.call.cameraOn()) {
      await this.call.applyBackground();
      return;
    }
    if (!this.ownRaw) {
      return;
    }
    const options = await this.backgrounds.options();
    if (this.ownFx) {
      this.ownFx.setOptions(options);
    } else if (!isNeutral(options) && this.supported) {
      this.ownFx = await startCameraFx(this.ownRaw, options);
      if (this.ownFx) {
        this.own.set(this.ownFx.stream);
      }
    }
  }

  /** Uses a background. */
  protected choose(id: string): void {
    this.settings.callBackground.set(id);
    this.apply();
  }

  /** The strength of the blur. */
  protected setBlur(value: number): void {
    this.settings.callBackgroundBlur.set(value);
    this.apply();
  }

  /** The custom background as a gradient (a single color is flat). */
  private buildCustomCss(): string {
    const custom = this.settings.callBackgroundCustom();
    const stops = custom.stops.length === 1 ? [custom.stops[0]!, custom.stops[0]!] : custom.stops;
    return 'linear-gradient(' + custom.angle + 'deg,' + stops.join(',') + ')';
  }

  /** The custom background in the form of the editor of gradients. */
  private buildCustomParts(): GradientParts {
    const custom = this.settings.callBackgroundCustom();
    const last = Math.max(1, custom.stops.length - 1);
    return {
      angle: custom.angle,
      stops: custom.stops.map(function place(color, index) {
        return { color, pos: Math.round((index / last) * 100) };
      }),
    };
  }

  /** The editor of gradients changed something: the colors in the order of the bar, and the angle. */
  protected setCustom(change: Partial<GradientParts>): void {
    const now = this.customParts();
    const stops = (change.stops ?? now.stops)
      .slice()
      .sort(function byPlace(a, b) {
        return a.pos - b.pos;
      })
      .map(function color(stop) {
        return stop.color;
      });
    this.settings.callBackgroundCustom.set({ stops, angle: change.angle ?? now.angle });
    if (this.settings.callBackground() !== 'custom') {
      this.settings.callBackground.set('custom');
    }
    this.apply();
  }

  /** Mirror on or off. */
  protected setMirror(on: boolean): void {
    this.settings.cameraMirror.set(on);
    this.apply();
  }

  /** The number of one of the sliders. */
  protected valueOf(key: string): number {
    switch (key) {
      case 'brightness':
        return this.settings.cameraBrightness();
      case 'contrast':
        return this.settings.cameraContrast();
      case 'saturation':
        return this.settings.cameraSaturation();
      default:
        return this.settings.cameraZoom();
    }
  }

  /** Moves one of the sliders. */
  protected setSlider(key: string, value: number): void {
    switch (key) {
      case 'brightness':
        this.settings.cameraBrightness.set(value);
        break;
      case 'contrast':
        this.settings.cameraContrast.set(value);
        break;
      case 'saturation':
        this.settings.cameraSaturation.set(value);
        break;
      default:
        this.settings.cameraZoom.set(value);
    }
    this.apply();
  }

  /** True when the zoom is above 100 percent, so the camera can look elsewhere. */
  private isZoomed(): boolean {
    return this.settings.cameraZoom() > 100;
  }

  /** The soft edge of the person against the background. */
  protected setSoftness(value: number): void {
    this.settings.cameraEdgeSoftness.set(value);
    this.apply();
  }

  /** The press on the preview starts moving the camera (only when it is zoomed). */
  protected panStart(event: PointerEvent): void {
    if (!this.zoomed() || event.button !== 0) {
      return;
    }
    const frame = event.currentTarget as HTMLElement;
    const box = frame.getBoundingClientRect();
    frame.setPointerCapture(event.pointerId);
    this.grab = {
      x: event.clientX,
      y: event.clientY,
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
      panX: this.settings.cameraPanX(),
      panY: this.settings.cameraPanY(),
    };
    this.panning.set(true);
  }

  /** Dragging moves the picture with the pointer: the camera looks the other way. */
  protected panMove(event: PointerEvent): void {
    const grab = this.grab;
    if (!grab) {
      return;
    }
    const zoom = this.settings.cameraZoom() / 100;
    // How much of the picture the room of the zoom allows, as a fraction of the frame.
    const room = 0.5 - 0.5 / zoom;
    if (room <= 0) {
      return;
    }
    const dx = (event.clientX - grab.x) / grab.width;
    const dy = (event.clientY - grab.y) / grab.height;
    const limit = function limit(value: number): number {
      return Math.round(Math.max(-100, Math.min(100, value)));
    };
    this.settings.cameraPanX.set(limit(grab.panX - (dx / zoom / room) * 100));
    this.settings.cameraPanY.set(limit(grab.panY + (dy / zoom / room) * 100));
    this.apply();
  }

  /** Letting go ends the drag. */
  protected panEnd(event: PointerEvent): void {
    if (!this.grab) {
      return;
    }
    this.grab = null;
    this.panning.set(false);
    const frame = event.currentTarget as HTMLElement;
    if (frame.hasPointerCapture(event.pointerId)) {
      frame.releasePointerCapture(event.pointerId);
    }
  }

  /** Whether the image is not as the camera gives it. */
  private isAdjusted(): boolean {
    const s = this.settings;
    return (
      s.cameraMirror() ||
      s.cameraPanX() !== 0 ||
      s.cameraPanY() !== 0 ||
      s.cameraBrightness() !== 0 ||
      s.cameraContrast() !== 100 ||
      s.cameraSaturation() !== 100 ||
      s.cameraZoom() !== 100
    );
  }

  /** Puts the mirror and the sliders back as they were. */
  protected resetImage(): void {
    const s = this.settings;
    s.cameraMirror.set(false);
    s.cameraBrightness.set(0);
    s.cameraContrast.set(100);
    s.cameraSaturation.set(100);
    s.cameraZoom.set(100);
    s.cameraPanX.set(0);
    s.cameraPanY.set(0);
    this.apply();
  }

  /** Where an item is kept, in words. */
  protected whereTitle(item: VaultItem): string {
    return item.where === 'account' ? 'In your account' : 'Only on this device';
  }

  /** Asks for a file or a GIF, keeps it in the library and uses it. */
  protected async add(): Promise<void> {
    this.busy.set(true);
    try {
      const source = await import('../../shared/components/image-source.component');
      const choice = await source.chooseImageSource(this.injector, {
        title: 'Add a background',
        subtitle: 'Upload your own picture or pick a GIF.',
      });
      if (!choice) {
        return;
      }
      const blob = await source.sourceToBlob(this.injector, choice);
      const name = choice.kind === 'file' ? choice.file.name : choice.gif.title || 'GIF';
      const item = await this.vault.add(blob, name, choice.kind);
      this.choose('vault:' + item.id);
    } catch (error) {
      this.toast.error(
        'Could not add the background',
        error instanceof Error ? error.message : 'Try another file.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** Removes a picture of the library (and stops using it when it was the chosen one). */
  protected async remove(item: VaultItem, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await this.vault.remove(item);
      if (this.settings.callBackground() === 'vault:' + item.id) {
        this.choose('none');
      }
    } catch {
      this.toast.error('Could not remove it', 'Try again.');
    }
  }
}

/**
 * Opens the window of the camera.
 * @param injector Where the window gets its services from.
 */
export function openBackgroundPicker(injector: EnvironmentInjector): void {
  const ref = createComponent(BackgroundPickerComponent, { environmentInjector: injector });
  const app = injector.get(ApplicationRef);
  app.attachView(ref.hostView);
  document.body.appendChild(ref.location.nativeElement);
  const subscription = ref.instance.closed.subscribe(function finish() {
    subscription.unsubscribe();
    app.detachView(ref.hostView);
    ref.destroy();
  });
}
