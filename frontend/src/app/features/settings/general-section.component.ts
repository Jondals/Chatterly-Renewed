/**
 * src/app/features/settings/general-section.component.ts
 * Settings - Language and Sounds & notifications: the interface language, the time format, the sound volumes,
 * the click sound, the soundboard, the pop-up notices and the desktop notifications.
 */
import { Component, DestroyRef, EnvironmentInjector, inject, input, signal } from '@angular/core';
import { I18nService, LANGUAGES, TranslatePipe } from '../../core/i18n/i18n.service';
import {
  SettingsService,
  type ClickStyle,
  type LanguagePref,
} from '../../core/services/settings.service';
import { pickFile } from '../../core/file-picker';
import {
  deleteCustomClick,
  deleteCustomRingtone,
  MELODIES,
  RINGTONE_IDS,
  seasonalRingtone,
  saveCustomClick,
  saveCustomRingtone,
  type RingtoneId,
} from '../../core/ringtones';
import { SoundService } from '../../core/services/sound.service';
import { ToastService } from '../../core/services/toast.service';
import { UiService } from '../../core/services/ui.service';
import { CollapseComponent } from '../../shared/components/collapse.component';
import { IconComponent } from '../../shared/components/icon.component';
import {
  SegmentedComponent,
  SettingRowComponent,
  ToggleComponent,
} from '../../shared/components/controls.component';

/** Language picker and sound / notification preferences. */
/** The flags of the languages as pictures: they look the same in every browser and system (an emoji flag depends on the font). */
const FLAGS: Record<string, string> = {
  en:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"><clipPath id="s"><path d="M0,0v30h60V0z"/></clipPath>' +
    '<clipPath id="t"><path d="M30,15h30v15zv15h-30zh-30V0zV0h30z"/></clipPath><g clip-path="url(#s)"><path d="M0,0v30h60V0z" fill="#012169"/>' +
    '<path d="M0,0 60,30M60,0 0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 60,30M60,0 0,30" clip-path="url(#t)" stroke="#C8102E" stroke-width="4"/>' +
    '<path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#C8102E" stroke-width="6"/></g></svg>',
  es: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#AA151B"/><rect y="0.5" width="3" height="1" fill="#F1BF00"/></svg>',
};

@Component({
  selector: 'app-general-section',
  standalone: true,
  imports: [
    IconComponent,
    TranslatePipe,
    SegmentedComponent,
    SettingRowComponent,
    ToggleComponent,
    CollapseComponent,
  ],
  template: `
    @if (mode() === 'language') {
      <p class="mb-5 text-sm text-muted">
        {{ 'Choose the language of the interface. Emoji search follows it too.' | t }}
      </p>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          class="lang-option"
          [class.is-on]="s.language() === 'auto'"
          (click)="s.language.set('auto')"
        >
          <span class="lang-coin lang-coin-auto"><app-icon name="globe" [size]="22" /></span>
          <span class="min-w-0 flex-1 text-left">
            <b class="block truncate text-sm">{{ 'Automatic' | t }}</b>
            <span class="block truncate text-xs text-muted">{{
              'Use the browser language' | t
            }}</span>
          </span>
          <span class="lang-tick"><app-icon name="check" [size]="14" /></span>
        </button>
        @for (l of languages; track l.id) {
          <button
            type="button"
            class="lang-option"
            [class.is-on]="s.language() === l.id"
            (click)="setLanguage(l.id)"
          >
            <span class="lang-coin"
              ><img alt="" [src]="flagPicture(l.id)" [attr.title]="l.flag"
            /></span>
            <span class="min-w-0 flex-1 text-left">
              <b class="block truncate text-sm">{{ l.native }}</b>
              @if (languageHint(l); as hint) {
                <span class="block truncate text-xs text-muted">{{ hint }}</span>
              }
            </span>
            <span class="lang-tick"><app-icon name="check" [size]="14" /></span>
          </button>
        }
      </div>
      <div class="mt-6 rounded-ui-lg border border-white/8 bg-black/10 px-5 py-1">
        <app-setting-row title="Time format" hint="How the time of each message is shown.">
          <app-segmented
            [options]="timeFormats"
            [value]="s.timeFormat()"
            (valueChange)="setTimeFormat($event)"
          />
        </app-setting-row>
      </div>
      <p class="mt-6 text-xs text-dim">
        {{
          'Missing a language? Translations live in one small file — contributions are welcome.' | t
        }}
      </p>
    } @else if (mode() === 'calls') {
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'Ring and sounds' | t }}</h2>
        <div class="my-5">
          <app-collapse title="Call ringtone" [summary]="ringtoneLabel()">
            <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              @for (id of ringtones; track id) {
                <button
                  type="button"
                  class="ring-card"
                  [class.is-on]="s.ringtone() === id"
                  [class.is-playing]="playing() === id"
                  (click)="chooseRingtone(id)"
                >
                  <span class="flex w-full items-start justify-between">
                    <span class="nav-tile !h-9 !w-9" [class]="ringtoneTone(id)"
                      ><app-icon [name]="ringtoneIcon(id)" [size]="18"
                    /></span>
                    @if (playing() === id) {
                      <span class="ring-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                    } @else if (s.ringtone() === id) {
                      <app-icon name="check" [size]="15" class="text-accent" />
                    }
                  </span>
                  <span class="mt-1 text-sm font-semibold">{{ ringtoneName(id) | t }}</span>
                  <span class="text-[0.6875rem] leading-snug text-muted">{{
                    ringtoneHint(id) | t
                  }}</span>
                  @if (id === 'auto') {
                    <span class="mt-0.5 text-[0.6875rem] font-semibold text-accent"
                      >{{ 'Today' | t }}: {{ ringtoneName(today()) | t }}</span
                    >
                  }
                </button>
              }
            </div>
            @if (s.ringtone() === 'custom') {
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <button class="btn btn-sm" type="button" (click)="uploadRingtone()">
                  <app-icon name="upload" [size]="14" /> {{ 'Upload your own' | t }}
                </button>
                <span class="text-xs text-dim">{{
                  'Any audio file: cut the part you want (up to 30 seconds)' | t
                }}</span>
                @if (s.ringtoneName()) {
                  <span class="max-w-48 truncate text-xs text-muted">{{ s.ringtoneName() }}</span>
                  <button
                    class="btn btn-sm btn-soft-danger"
                    type="button"
                    (click)="removeRingtone()"
                  >
                    {{ 'Remove' | t }}
                  </button>
                }
              </div>
            }
            <p class="mt-3 text-xs text-muted">
              {{
                'Plays when someone calls you. Tap one to hear it. Your own sound: any audio file, cut to up to 30 seconds.'
                  | t
              }}
            </p>
          </app-collapse>
        </div>
        <app-setting-row
          title="Soundboard"
          hint="Open it from the bar of a call or with its shortcut, to try the effects and upload your own sounds."
        >
          <button
            class="btn btn-sm btn-primary"
            type="button"
            (mousedown)="$event.stopPropagation()"
            (click)="ui.soundboardAnchor.set(null); ui.soundboardOpen.set(true)"
          >
            <app-icon name="waveform" [size]="14" /> {{ 'Open soundboard' | t }}
          </button>
        </app-setting-row>
      </section>
    } @else {
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'Volume' | t }}</h2>
        <app-setting-row
          title="Interface sounds"
          hint="Message pings, join/leave tones and a soft click under every button."
        >
          <app-toggle
            [checked]="s.sounds()"
            (checkedChange)="s.sounds.set($event)"
            [label]="'Interface sounds' | t"
          />
        </app-setting-row>
        <app-setting-row
          title="Music volume"
          hint="The song shared in a call. Only YouTube can be controlled from here; Spotify uses its own player volume."
        >
          <div class="flex items-center gap-3">
            <app-icon name="music" [size]="16" class="text-muted" /><input
              type="range"
              min="0"
              max="100"
              class="w-44 accent-[var(--accent)]"
              [value]="s.musicVolume()"
              (input)="s.musicVolume.set(+$any($event.target).value)"
            /><span class="w-9 text-right font-mono text-xs text-muted"
              >{{ s.musicVolume() }}%</span
            >
          </div>
        </app-setting-row>
        <app-setting-row
          title="Effects volume"
          hint="Message pings, button clicks, mute tones and the soundboard."
        >
          <div class="flex items-center gap-3">
            <app-icon name="volume" [size]="16" class="text-muted" /><input
              type="range"
              min="0"
              max="100"
              class="w-44 accent-[var(--accent)]"
              [value]="s.soundVolume()"
              (input)="s.soundVolume.set(+$any($event.target).value)"
              (change)="sound.play('success')"
            /><span class="w-9 text-right font-mono text-xs text-muted"
              >{{ s.soundVolume() }}%</span
            >
          </div>
        </app-setting-row>
        <app-setting-row
          title="Notification volume"
          hint="The ping of a message, the tones of people joining and leaving, and the ring of a call."
        >
          <div class="flex items-center gap-3">
            <app-icon name="bell" [size]="16" class="text-muted" /><input
              type="range"
              min="0"
              max="100"
              class="w-44 accent-[var(--accent)]"
              [value]="s.notificationVolume()"
              (input)="s.notificationVolume.set(+$any($event.target).value)"
              (change)="sound.play('message')"
            /><span class="w-9 text-right font-mono text-xs text-muted"
              >{{ s.notificationVolume() }}%</span
            >
          </div>
        </app-setting-row>
      </section>
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'Sounds' | t }}</h2>
        <div class="my-5">
          <app-collapse title="Click sound" [summary]="clickLabel()">
            <div class="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4">
              @for (c of clickStyles; track c.id) {
                <button
                  type="button"
                  class="min-w-0 truncate rounded-ui border px-2 py-2.5 text-sm font-medium hover:bg-white/5"
                  [class.border-accent]="s.clickStyle() === c.id"
                  [class.bg-accent/10]="s.clickStyle() === c.id"
                  [class.border-white/10]="s.clickStyle() !== c.id"
                  (click)="setClick(c.id)"
                >
                  {{ c.label | t }}
                </button>
              }
              @if (s.clickName()) {
                <button
                  type="button"
                  class="min-w-0 truncate rounded-ui border px-2 py-2.5 text-sm font-medium hover:bg-white/5"
                  [class.border-accent]="s.clickStyle() === 'custom'"
                  [class.bg-accent/10]="s.clickStyle() === 'custom'"
                  [class.border-white/10]="s.clickStyle() !== 'custom'"
                  (click)="setClick('custom')"
                >
                  <span class="block truncate">{{ s.clickName() }}</span>
                </button>
              }
              <button
                type="button"
                class="flex min-w-0 items-center justify-center gap-2 truncate rounded-ui border border-dashed border-white/15 px-3 py-2.5 text-sm font-medium text-muted hover:bg-white/5 hover:text-fg"
                (click)="uploadClick()"
              >
                <app-icon name="upload" [size]="15" />
                {{ (s.clickName() ? 'Change' : 'Upload yours') | t }}
              </button>
            </div>
            <p class="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-muted">
              <span>{{ 'The sound of pressing a button. Try them!' | t }}</span>
              <span class="text-dim">{{ 'Your own sound: up to 1 MB and 3 seconds' | t }}</span>
              @if (s.clickName()) {
                <button type="button" class="underline hover:text-fg" (click)="removeClick()">
                  {{ 'Remove' | t }}
                </button>
              }
            </p>
          </app-collapse>
        </div>
      </section>
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'Notifications' | t }}</h2>
        <app-setting-row
          title="Pop-up notices"
          hint="The small messages that appear in the corner, like Copied."
        >
          <app-segmented
            [options]="noticeModes"
            [value]="s.toastMode()"
            (valueChange)="setNoticeMode($event)"
          />
        </app-setting-row>
        <app-setting-row
          title="Desktop notifications"
          hint="Generic alerts only — never the text of your messages."
        >
          <app-toggle
            [checked]="s.desktopNotifications()"
            (checkedChange)="setNotifications($event)"
            [label]="'Desktop notifications' | t"
          />
        </app-setting-row>
      </section>
    }
  `,
})
export class GeneralSectionComponent {
  /**
   * The small line under the name of a language: its name in the language of the interface ("Spanish" in English,
   * "Inglés" in Spanish). It is left out when it would only repeat the name above it ("Español" under "Español").
   */
  protected languageHint(language: { name: string; native: string }): string {
    const translated = this.i18n.t(language.name);
    return translated === language.native ? '' : translated;
  }

  /** The address of the picture of the flag of a language. */
  protected flagPicture(id: string): string {
    return 'data:image/svg+xml,' + encodeURIComponent(FLAGS[id] ?? '');
  }

  /** Stops a ringtone preview when the page is closed. */
  constructor() {
    inject(DestroyRef).onDestroy(this.endPreview.bind(this));
  }

  readonly mode = input.required<'language' | 'sounds' | 'calls'>();
  protected readonly s = inject(SettingsService);
  protected readonly sound = inject(SoundService);
  protected readonly ui = inject(UiService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly languages = LANGUAGES;
  protected readonly clickStyles: { id: ClickStyle; label: string }[] = [
    { id: 'tap', label: 'Tap' },
    { id: 'switch', label: 'Switch' },
    { id: 'pluck', label: 'Pluck' },
    { id: 'bubble', label: 'Bubble' },
    { id: 'soft', label: 'Soft' },
    { id: 'drop', label: 'Drop' },
    { id: 'glass', label: 'Glass' },
    { id: 'typewriter', label: 'Typewriter' },
    { id: 'marimba', label: 'Marimba' },
    { id: 'kalimba', label: 'Kalimba' },
    { id: 'off', label: 'Off' },
  ];

  private readonly injector = inject(EnvironmentInjector);
  protected readonly ringtones = RINGTONE_IDS;
  /** Stops the ringtone that is being previewed. */
  private stopPreview: (() => void) | null = null;
  /** The ringtone whose preview is playing. */
  protected readonly playing = signal<RingtoneId | null>(null);
  private previewTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly timeFormats = [
    { id: 'auto', label: 'Automatic' },
    { id: '12', label: '12 h' },
    { id: '24', label: '24 h' },
  ];

  protected readonly noticeModes = [
    { id: 'all', label: 'All' },
    { id: 'important', label: 'Important' },
    { id: 'off', label: 'Off' },
  ];

  /** Chooses 12 hour, 24 hour or automatic time. */
  protected setTimeFormat(value: string): void {
    this.s.timeFormat.set(value === '12' ? '12' : value === '24' ? '24' : 'auto');
  }

  /** Chooses which pop-up notices are shown. */
  protected setNoticeMode(value: string): void {
    this.s.toastMode.set(value === 'off' ? 'off' : value === 'important' ? 'important' : 'all');
  }

  /** Name of the chosen click sound. */
  protected clickLabel(): string {
    const current = this.s.clickStyle();
    for (const style of this.clickStyles) {
      if (style.id === current) {
        return style.label;
      }
    }
    return 'Soft';
  }

  /** Name of the chosen ringtone. */
  protected ringtoneLabel(): string {
    return this.ringtoneName(this.s.ringtone());
  }

  /** Display name of a ringtone. */
  protected ringtoneName(id: RingtoneId): string {
    if (id === 'auto') {
      return 'Automatic';
    }
    return id === 'custom' ? 'Your own' : MELODIES[id].label;
  }

  /** The short description under a ringtone. */
  protected ringtoneHint(id: RingtoneId): string {
    if (id === 'auto') {
      return 'Changes with the time of the year.';
    }
    return id === 'custom' ? 'A sound from your device.' : MELODIES[id].hint;
  }

  /** The colors of the tile of a ringtone (the automatic one wears the colors of today's melody). */
  protected ringtoneTone(id: RingtoneId): string {
    if (id === 'custom') {
      return 'bg-accent/15 text-accent';
    }
    return MELODIES[id === 'auto' ? seasonalRingtone() : id].tone;
  }

  /** The icon of a ringtone (the automatic one shows today's melody). */
  protected ringtoneIcon(id: RingtoneId): string {
    if (id === 'custom') {
      return 'music';
    }
    if (id === 'auto') {
      return 'zap';
    }
    return MELODIES[id].icon;
  }

  /** Chooses a ringtone and plays a few seconds of it. A custom one asks for the file first if there is none. */
  protected async chooseRingtone(id: RingtoneId): Promise<void> {
    if (id === 'custom' && !this.s.ringtoneName()) {
      await this.uploadRingtone();
      return;
    }
    this.s.ringtone.set(id);
    if (this.playing() === id) {
      this.endPreview();
      return;
    }
    this.playPreview(id);
  }

  /** The melody the automatic ringtone plays today. */
  protected today(): RingtoneId {
    return seasonalRingtone();
  }

  /** Plays a ringtone for a few seconds, replacing the one that was playing. */
  private playPreview(id: RingtoneId): void {
    this.stopPreview?.();
    clearTimeout(this.previewTimer);
    this.stopPreview = this.sound.preview(id);
    this.playing.set(id);
    this.previewTimer = setTimeout(this.endPreview.bind(this), 6000);
  }

  /** Ends the preview. */
  private endPreview(): void {
    clearTimeout(this.previewTimer);
    this.stopPreview?.();
    this.stopPreview = null;
    this.playing.set(null);
  }

  /** Lets the person pick an audio file as their ringtone; it is checked before it is kept. */
  protected async uploadRingtone(): Promise<void> {
    const file = await pickFile('audio/*,.mp3,.wav,.ogg,.m4a,.opus');
    if (!file) {
      return;
    }
    try {
      const editor = await import('../../shared/components/sound-edit.component');
      if (file.size > editor.MAX_SOURCE_BYTES) {
        this.toast.error(this.i18n.t('Sounds can be up to 25 MB.'));
        return;
      }
      const result = await editor.editSound(
        this.injector,
        file,
        null,
        file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Ringtone',
      );
      if (!result) {
        return;
      }
      await saveCustomRingtone(result.blob);
      this.s.ringtoneName.set(result.name.slice(0, 40));
    } catch {
      this.toast.error(this.i18n.t('That file is not a playable audio file.'));
      return;
    }
    this.s.ringtone.set('custom');
    this.playPreview('custom');
  }

  /** Lets the person pick a short sound file to use as the click sound. */
  protected async uploadClick(): Promise<void> {
    const file = await pickFile('audio/*,.mp3,.wav,.ogg,.m4a,.opus');
    if (!file) {
      return;
    }
    if (file.size > 1024 * 1024) {
      this.toast.error(this.i18n.t('Click sounds can be up to 1 MB.'));
      return;
    }
    try {
      const buffer = await this.sound.context.decodeAudioData(await file.arrayBuffer());
      if (buffer.duration > 3) {
        this.toast.error(this.i18n.t('Click sounds can last up to 3 seconds.'));
        return;
      }
    } catch {
      this.toast.error(this.i18n.t('That file is not a playable audio file.'));
      return;
    }
    await saveCustomClick(file);
    this.s.clickName.set(file.name.slice(0, 40));
    this.s.clickStyle.set('custom');
    this.sound.forgetClickClip();
  }

  /** Deletes the uploaded click sound and goes back to the soft one. */
  protected async removeClick(): Promise<void> {
    await deleteCustomClick();
    this.s.clickName.set('');
    if (this.s.clickStyle() === 'custom') {
      this.s.clickStyle.set('soft');
    }
    this.sound.forgetClickClip();
  }

  /** Deletes the custom ringtone and goes back to the normal one. */
  protected async removeRingtone(): Promise<void> {
    await deleteCustomRingtone();
    this.s.ringtoneName.set('');
    if (this.s.ringtone() === 'custom') {
      this.s.ringtone.set('auto');
    }
  }

  /** Chooses the interface language. */
  protected setLanguage(id: string): void {
    this.s.language.set(id as LanguagePref);
  }

  /** Chooses a click sound. The sound under every press (app.component.ts) plays the new style by itself, so it is the preview. */
  protected setClick(id: string): void {
    this.s.clickStyle.set(id as ClickStyle);
  }

  /** Turns desktop notifications on or off; turning them on asks the browser for permission. */
  protected async setNotifications(on: boolean): Promise<void> {
    this.s.desktopNotifications.set(on);
    if (!on) {
      return;
    }
    if (!('Notification' in window)) {
      this.s.desktopNotifications.set(false);
      return;
    }
    if ((await Notification.requestPermission()) !== 'granted') {
      this.s.desktopNotifications.set(false);
      this.toast.error(
        this.i18n.t('Notifications blocked'),
        this.i18n.t('Enable them in your browser site settings.'),
      );
    }
  }
}
