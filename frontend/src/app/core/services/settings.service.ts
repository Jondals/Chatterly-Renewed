/**
 * src/app/core/services/settings.service.ts
 * Per-device preferences (appearance, sound, cursor, background, calls, nicknames, privacy, integrations) and
 * the code that applies them to the page. Nothing here is ever sent to the server.
 */
import { Injectable, computed, effect, signal } from '@angular/core';
import { setTimeFormat } from '../../shared/pipes/timestamp.pipe';
import type { AccentId } from '../models';
import type { TrailType } from './cursor-trail';
import type { RingtoneId } from '../ringtones';
import type { SpinlyProfile } from '../../features/spinly/spinly-model';
import { gradientCss, parseMulti, sortedStops } from '../../shared/util/gradient';
import { persisted } from './persisted';

export type ThemeId =
  | 'midnight'
  | 'graphite'
  | 'amoled'
  | 'dusk'
  | 'forest'
  | 'ocean'
  | 'crimson'
  | 'mocha'
  | 'nord'
  | 'matrix'
  | 'rose'
  | 'tangerine'
  | 'abyss'
  | 'plum'
  | 'glacier'
  | 'custom';

/** How opaque the big blocks of the interface are for each level of "background visibility", in percent. */
const GLASS_LEVELS = [94, 80, 64, 46, 28];

/** The animations to start with: off for whoever had "reduce motion" on before this setting existed, all of them otherwise. */
function initialAnimations(): 'off' | 'quick' | 'full' {
  try {
    return localStorage.getItem('chatterly.pref.reduceMotion') === 'true' ? 'off' : 'full';
  } catch {
    return 'full';
  }
}

/** Below this charge (0 to 1), without a charger, the automatic power mode saves battery. */
const LOW_BATTERY = 0.2;

/** The part of the Battery Status API that is read (Chromium and the Android WebView have it). */
interface BatteryInfo extends EventTarget {
  level: number;
  charging: boolean;
}

/** The corner styles of the interface, from square to bubbly: the radius of small and of large elements, in pixels. */
export const CORNER_STEPS: { name: string; small: number; large: number }[] = [
  { name: 'Square', small: 2, large: 3 },
  { name: 'Sharp', small: 4, large: 6 },
  { name: 'Crisp', small: 6, large: 9 },
  { name: 'Soft', small: 8, large: 12 },
  { name: 'Smooth', small: 11, large: 16 },
  { name: 'Round', small: 14, large: 20 },
  { name: 'Bubble', small: 18, large: 26 },
];
export type FontId =
  | 'app'
  | 'system'
  | 'inter'
  | 'outfit'
  | 'manrope'
  | 'nunito'
  | 'space'
  | 'lora'
  | 'mono'
  | 'custom';
export type BackgroundId =
  | 'aurora'
  | 'waves'
  | 'grid'
  | 'solid'
  | 'image'
  | 'stars'
  | 'bubbles'
  | 'beams'
  | 'nebula'
  | 'sunset'
  | 'ripples'
  | 'network'
  | 'fireflies'
  | 'rain'
  | 'snow'
  | 'synthwave'
  | 'curtains'
  | 'lavalamp'
  | 'cosmos'
  | 'prism'
  | 'orbs'
  | 'mist'
  | 'topography'
  | 'shuffle';
/** 'themed', 'system', a family ('solid', 'soft', 'sleek', 'halo', 'pixel', 'classic') or 'custom:<id>' for an uploaded cursor. */
export type CursorMode = string;

/** A cursor the person uploaded (kept only on this device). */
export interface CustomCursor {
  id: string;
  name: string;
  /** Picture of the cursor (data URL), or of its first frame. */
  data: string;
  /** 'cur' = .cur/.ico file used as it is; 'image' = PNG reduced to 32 px; 'animated' = GIF/WebP/APNG/.ani drawn by the page. */
  kind: 'cur' | 'image' | 'animated';
  frames?: { data: string; ms: number }[];
  /** Hot spot: 'center' or 'corner' (top left). .cur and .ani files bring their own. */
  point: 'center' | 'corner';
  hot?: [number, number];
  width: number;
  height: number;
}

/** Shape of the chat bubbles. */
export type BubbleStyle =
  | 'tail'
  | 'round'
  | 'square'
  | 'gloss'
  | 'outline'
  | 'minimal'
  | 'glass'
  | 'neon'
  | 'leaf'
  | 'ticket'
  | 'block'
  | 'dashed';
export type ClickStyle =
  | 'tap'
  | 'switch'
  | 'pluck'
  | 'bubble'
  | 'soft'
  | 'drop'
  | 'glass'
  | 'typewriter'
  | 'marimba'
  | 'kalimba'
  | 'custom'
  | 'off';
export type LanguagePref = 'auto' | 'en' | 'es';

/** Parts of the custom theme that can be changed by hand (empty means "calculated from the base color"). */
export interface CustomThemeParts {
  panel: string;
  text: string;
  muted: string;
  accent2: string;
}

/** Names of the surface shades of the interface, from the darkest to the lightest. */
const SURFACE_SHADES = ['950', '900', '850', '800', '700', '600', '500'];
/** CSS variables a custom theme can set one by one. */
const THEME_VARIABLES = ['--fg', '--muted', '--dim', '--accent-2'];
/** A "#rrggbb" color. */
const HEX = /^#[0-9a-f]{6}$/i;

/** True for a "#rrggbb" color. */
function isHex(value: string): boolean {
  return HEX.test(value);
}

/** Splits "#rrggbb" into its red, green and blue values. */
function rgbOf(hex: string): number[] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Average brightness (0 to 1) of a list of "#rrggbb" colors. */
function averageBrightness(colors: string[]): number {
  let total = 0;
  for (const hex of colors) {
    const rgb = rgbOf(hex);
    total += (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  }
  return total / colors.length;
}

/** Dark text over light colors and white text over dark ones. */
function readableInk(colors: string[]): string {
  return averageBrightness(colors) > 0.6 ? '#0a0c11' : '#ffffff';
}

/** Per-device preferences (never sent to the server). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  // ---- sound and notifications
  readonly sounds = persisted('pref.sounds', true);
  /** Volume of the interface sounds and the soundboard (0 to 100). */
  readonly soundVolume = persisted('pref.soundVolume', 80);
  /** Whether the bar of reactions and options shows over a message when it is pointed at. */
  readonly messageActions = persisted('pref.messageActions', true);
  /** File name of the click sound the person uploaded (empty when there is none). */
  readonly clickName = persisted('pref.clickName', '');
  /** Volume (0 to 100) of the notifications: the ping of a message, the tones of people joining and leaving, and the ring of a call. */
  readonly notificationVolume = persisted('pref.notificationVolume', 100);
  /** Volume (0 to 100) of the soundboard effects of a call, on top of the general volume. */
  readonly callEffectsVolume = persisted('pref.callEffectsVolume', 100);
  /** The categories the person made to sort the sounds of the soundboard. */
  readonly soundCategories = persisted<{ id: string; name: string }[]>('pref.soundCategories', []);
  /** Volume of the music shared in a call (only YouTube can be controlled from outside). */
  readonly musicVolume = persisted('pref.musicVolume', 80);
  readonly clickStyle = persisted<ClickStyle>('pref.clickStyle', 'soft');
  /** The sound of an incoming call. */
  readonly ringtone = persisted<RingtoneId>('pref.ringtone', 'auto');
  /** File name of the custom ringtone (empty when there is none). */
  readonly ringtoneName = persisted<string>('pref.ringtoneName', '');
  /** Pop-up notices: 'all', 'important' (errors and calls only) or 'off'. */
  readonly toastMode = persisted<'all' | 'important' | 'off'>('pref.toastMode', 'all');
  readonly desktopNotifications = persisted('pref.notifications', false);

  // ---- privacy
  /** Load the player of a video link as soon as the message is shown (off: it loads when you press play). */
  /** Tell the other people when you have read their messages (off: nobody sees it, and you do not see theirs). */
  readonly sendReadReceipts = persisted<boolean>('pref.sendReadReceipts', true);
  /** Tell the other people when you are typing (off: nobody sees the three dots, and you still see theirs). */
  readonly sendTyping = persisted<boolean>('pref.sendTyping', true);
  /** Show the sent, delivered and read marks under your messages. */
  readonly showMessageStatus = persisted<boolean>('pref.showMessageStatus', true);
  /** Draw the names of other people in the font they uploaded (a file that comes from them; turn it off to see only built-in fonts). */
  readonly showSharedFonts = persisted<boolean>('pref.showSharedFonts', true);

  // ---- integrations
  /** What Spinly last said about the account: signed in, signed out, or nothing yet (empty). */
  readonly spinlyAccount = persisted<'' | 'in' | 'out'>('pref.spinlyAccount', '');
  /** The themes and presets of the linked Spinly account (null while no account is linked). */
  readonly spinlyProfile = persisted<SpinlyProfile | null>('pref.spinlyProfile', null);

  // ---- appearance
  readonly theme = persisted<ThemeId>('pref.theme', 'midnight');
  readonly accent = persisted<AccentId>('pref.accent', 'mint');
  /** Color used when `accent` is 'custom'. */
  readonly customAccent = persisted<string>('pref.customAccent', '#2ef2b0');
  /** Index into CORNER_STEPS (3 is "Soft", the default). */
  readonly cornerStep = persisted<number>('pref.cornerStep', 3);
  readonly font = persisted<FontId>('pref.font', 'app');
  /** File name of the uploaded interface font (empty when there is none). */
  readonly customFontName = persisted<string>('pref.customFontName', '');
  /** File name of the uploaded display-name font (empty when there is none). */
  readonly customNameFontName = persisted<string>('pref.customNameFontName', '');
  readonly fontSize = persisted('pref.fontSize', 14);
  readonly chatStyle = persisted<'bubbles' | 'flat'>('pref.chatStyle', 'bubbles');
  readonly bubbleStyle = persisted<BubbleStyle>('pref.bubbleStyle', 'tail');
  /** Color of your bubbles ('' = the accent color) and, if there is one, the second color of a gradient. */
  readonly bubbleOwn = persisted<string>('pref.bubbleOwn', '');
  readonly bubbleOwnTo = persisted<string>('pref.bubbleOwnTo', '');
  /** The gradient of the own bubbles with two to five colors, as "m:angle:100:#color@place,..." ('' when there is none). */
  readonly bubbleOwnGrad = persisted<string>('pref.bubbleOwnGrad', '');
  /** Color of the bubbles of the other people ('' = the default). */
  readonly bubbleOther = persisted<string>('pref.bubbleOther', '');
  readonly background = persisted<BackgroundId>('pref.background', 'aurora');
  /** With the shuffled background: change on every reload ('reload') or every few minutes ('interval'). */
  readonly bgShuffleMode = persisted<'reload' | 'interval'>('pref.bgShuffleMode', 'reload');
  readonly bgShuffleMinutes = persisted('pref.bgShuffleMinutes', 10);
  /** Color of the "solid" background. */
  readonly bgSolidColor = persisted<string>('pref.bgSolidColor', '#05060a');
  /** Base color of the custom theme: every surface is made from it. */
  readonly customTheme = persisted<string>('pref.customTheme', '#1b1530');
  /** Parts of the custom theme that can be changed by hand. */
  readonly customThemeParts = persisted<CustomThemeParts>('pref.customThemeParts', {
    panel: '',
    text: '',
    muted: '',
    accent2: '',
  });
  readonly bgBlur = persisted('pref.bgBlur', 46);
  readonly bgMotion = persisted<'lively' | 'normal' | 'calm' | 'off'>('pref.bgMotion', 'lively');
  /** Wallpaper chosen by the person as a data URL (kept locally, never uploaded). */
  readonly wallpaper = persisted<string>('pref.wallpaper', '');
  readonly cursor = persisted<CursorMode>('pref.cursor', 'classic');
  /** Animated cursor (an outline pulses around the shape) instead of a still one. */
  readonly cursorAnimated = persisted<boolean>('pref.cursorAnimated', false);
  /** Trail the cursor leaves while it moves. */
  readonly cursorTrail = persisted<TrailType | 'off'>('pref.cursorTrail', 'off');
  /** Thickness of the trail (1 = normal). */
  readonly cursorTrailSize = persisted<number>('pref.cursorTrailSize', 1);
  /** Color of the cursor and its trail (empty = the accent color of the theme). */
  readonly cursorColor = persisted<string>('pref.cursorColor', '');
  /** Length of the trail (1 = normal). */
  readonly cursorTrailLength = persisted<number>('pref.cursorTrailLength', 1);
  /** Size of the cursor in pixels. */
  readonly cursorSize = persisted<number>('pref.cursorSize', 24);
  /** Cursors the person uploaded (kept only on this device). */
  readonly customCursors = persisted<CustomCursor[]>('pref.customCursors', []);
  /** Keyboard shortcuts the person changed: action to combination (empty = none); the others keep their default. */
  readonly shortcuts = persisted<Record<string, string>>('pref.shortcuts', {});
  /** The order of the groups in the left bar, as the person arranged it (ids; new groups go last). */
  /** The music card of the call is folded to one line. */
  readonly musicMini = persisted<boolean>('pref.musicMini', false);
  /** Where the music card of the call rests on the stage. */
  readonly musicPlace = persisted<'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'>('pref.musicPlace', 'tl');
  readonly guildOrder = persisted<string[]>('pref.guildOrder', []);
  /** Where the floating bar of the call rests while the person is on another page. */
  readonly dockPlace = persisted<'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'>('pref.dockPlace', 'tr');
  /** What the person shared last time, to offer it again in the menu of sharing the screen. */
  readonly screenShare = persisted<{
    surface: 'any' | 'monitor' | 'window' | 'browser';
    quality: 'standard' | 'high' | 'max';
    audio: boolean;
  }>('pref.screenShare', { surface: 'any', quality: 'high', audio: true });
  /** How much the interface animates: nothing, short transitions, or everything. Apart from the motion of the background. */
  readonly animations = persisted<'off' | 'quick' | 'full'>('pref.animations', initialAnimations());
  /**
   * How the app uses the battery and the processor (this device only):
   *   - 'auto': everything on; the light mode (no blur, still decorations, a lighter camera) only on a device that cannot
   *     keep up or with the battery under 20 % and no charger;
   *   - 'full': everything on, always;
   *   - 'saver': the light mode always, the camera at 480p and 15 pictures per second, slower meters.
   */
  readonly powerMode = persisted<'auto' | 'full' | 'saver'>('pref.powerMode', 'auto');
  /** Whether the introduction plays when the app (or the browser) starts. */
  readonly introOnStart = persisted('pref.introOnStart', true);
  /** Android: stay connected in the background (a quiet notification) so calls ring with the app minimized. */
  readonly backgroundCalls = persisted('pref.backgroundCalls', true);
  /** The device could not keep up (few cores or little memory, or the frames of the page came slow). */
  readonly deviceWeak = signal(document.documentElement.dataset['weak'] === '1');
  /** The battery is low and not charging (read from the system when it says). */
  readonly batteryLow = signal(false);
  /** True while the light mode is on (the power mode asks for it, or the automatic mode decided it). */
  readonly saving = computed(
    function (this: SettingsService) {
      const mode = this.powerMode();
      return mode === 'saver' || (mode === 'auto' && (this.deviceWeak() || this.batteryLow()));
    }.bind(this),
  );
  /** How much of the animated background shows through the big blocks of the interface (0 = almost none, 4 = the most). */
  readonly bgVisibility = persisted<number>('pref.bgVisibility', 2);
  readonly language = persisted<LanguagePref>('pref.language', 'auto');
  /** Nicknames given to friends (only visible to the person, on this device): user id to nickname. */
  readonly aliases = persisted<Record<string, string>>('pref.aliases', {});
  /** Time format of the messages: automatic (follows the language), 12 h or 24 h. */
  readonly timeFormat = persisted<'auto' | '12' | '24'>('pref.timeFormat', 'auto');
  readonly skinTone = persisted('pref.skinTone', 0);

  // ---- calls
  readonly inputDeviceId = persisted<string>('pref.inputDevice', 'default');
  readonly outputDeviceId = persisted<string>('pref.outputDevice', 'default');
  /** The camera of the calls ('default' lets the browser choose). */
  readonly cameraDeviceId = persisted<string>('pref.cameraDevice', 'default');
  /** How loud each person is for this device, in percent (0 to 200; missing means 100). Kept for the next calls. */
  readonly peerVolumes = persisted<Record<string, number>>('pref.peerVolumes', {});
  /** How loud the shared screen (its sound) of each person is for this device, in percent (0 to 200; missing means 100). */
  readonly screenVolumes = persisted<Record<string, number>>('pref.screenVolumes', {});
  readonly noiseSuppression = persisted('pref.noiseSuppression', true);
  readonly echoCancellation = persisted('pref.echoCancellation', true);
  readonly autoGain = persisted('pref.autoGain', true);
  readonly spatialAudio = persisted('pref.spatial', true);
  /** Microphone level (0 to 100) below which the voice gate stays closed. */
  readonly inputGate = persisted('pref.inputGate', 8);
  /** Volume of the microphone before it is sent, in percent (0 to 200). */
  readonly inputVolume = persisted('pref.inputVolume', 100);
  /** What is done to the voice after the browser's own processing (see audio-chain.ts). */
  readonly voiceMode = persisted<'off' | 'natural' | 'noisy' | 'studio'>(
    'pref.voiceMode',
    'natural',
  );
  /** The quality of the camera in calls (the height of the picture in pixels). */
  readonly cameraQuality = persisted<'480' | '720' | '1080'>('pref.cameraQuality', '720');
  /** Pictures per second of the camera. */
  readonly cameraFps = persisted<'15' | '30' | '60'>('pref.cameraFps', '30');
  /** What is behind the person in the camera of a call: 'none', 'blur', 'custom', 'preset:<id>' or 'vault:<id>' (a picture of the library). */
  readonly callBackground = persisted<string>('pref.callBackground', 'none');
  /** Whether the camera is turned like in a mirror, for you and for everybody who sees it. */
  readonly cameraMirror = persisted('pref.cameraMirrorAll', false);
  /** Brightness of the camera, in percent points (-50 to 50; 0 is as it is). */
  readonly cameraBrightness = persisted('pref.cameraBrightness', 0);
  /** Contrast of the camera, in percent (50 to 150; 100 is as it is). */
  readonly cameraContrast = persisted('pref.cameraContrast', 100);
  /** Color strength of the camera, in percent (0 to 200; 100 is as it is). */
  readonly cameraSaturation = persisted('pref.cameraSaturation', 100);
  /** Zoom of the camera, in percent (100 to 200; 100 is none). */
  readonly cameraZoom = persisted('pref.cameraZoom', 100);
  /** Where the zoomed camera looks, as -100 to 100 percent of the room the zoom leaves (0 is the middle). Set by dragging the preview. */
  readonly cameraPanX = persisted('pref.cameraPanX', 0);
  readonly cameraPanY = persisted('pref.cameraPanY', 0);
  /** How soft the edge of the person is against the background (0 to 100; 33 is the original look). */
  readonly cameraEdgeSoftness = persisted('pref.cameraEdgeSoftness', 55);
  /** How strong the blur of the background is (2 to 40). */
  readonly callBackgroundBlur = persisted('pref.callBackgroundBlur', 16);
  /** The colors and the angle of the custom background of the camera. */
  readonly callBackgroundCustom = persisted<{ stops: string[]; angle: number }>(
    'pref.callBackgroundCustom',
    { stops: ['#3b2f6b', '#2af5b5'], angle: 135 },
  );

  /** Brings old data up to date and starts applying the preferences to the page. */
  constructor() {
    this.upgradeOldData();
    effect(this.applyBubbles.bind(this));
    effect(this.applyTimeFormat.bind(this));
    effect(this.applyCustomTheme.bind(this));
    effect(this.applyDocumentSettings.bind(this));
    effect(this.applyPowerMode.bind(this));
    window.addEventListener('chatterly:weak', this.markWeak.bind(this));
    void this.watchBattery();
  }

  /** The light mode follows the power mode: `data-perf="low"` on the page (no blur, still decorations). */
  private applyPowerMode(): void {
    const root = document.documentElement;
    if (this.saving()) {
      root.dataset['perf'] = 'low';
    } else {
      delete root.dataset['perf'];
    }
    root.dataset['power'] = this.saving() ? 'saver' : 'normal';
  }

  /** The frame monitor (perf-monitor.ts) found that the device cannot keep up. */
  private markWeak(): void {
    this.deviceWeak.set(true);
  }

  /** Follows the charge of the battery, when the system tells it, for the automatic power mode. */
  private async watchBattery(): Promise<void> {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryInfo> })
      .getBattery;
    if (!getBattery) {
      return;
    }
    try {
      const battery = await getBattery.call(navigator);
      const update = this.readBattery.bind(this, battery);
      update();
      battery.addEventListener('levelchange', update);
      battery.addEventListener('chargingchange', update);
    } catch {
      // No battery information: the automatic mode only looks at the speed of the device.
    }
  }

  /** Low battery: under LOW_BATTERY and not charging. */
  private readBattery(battery: BatteryInfo): void {
    this.batteryLow.set(!battery.charging && battery.level <= LOW_BATTERY);
  }

  /** Brings preferences saved by older versions up to date (renamed fields, removed themes). */
  private upgradeOldData(): void {
    // ? Phones used to start with the quick animations (and that choice was saved and copied to the account): everything
    //   animates now, and the battery saver (Settings > Appearance > Performance) is the way to do less. Once per device.
    try {
      if (localStorage.getItem('chatterly.upgrade.fullAnimations') !== '1') {
        localStorage.setItem('chatterly.upgrade.fullAnimations', '1');
        if (this.animations() === 'quick') {
          this.animations.set('full');
        }
      }
    } catch {
      // Storage blocked: nothing to bring up to date.
    }
    // The flat message list no longer exists: the chat is always bubbles.
    if (this.chatStyle() !== 'bubbles') {
      this.chatStyle.set('bubbles');
    }
    // The Slate theme no longer exists: whoever had it goes back to Midnight.
    if ((this.theme() as string) === 'slate') {
      this.theme.set('midnight');
    }
    // Uploaded cursors used to save their kind and hot spot in Spanish.
    const old = this.customCursors() as unknown as Record<string, unknown>[];
    let changed = false;
    const upgraded: CustomCursor[] = [];
    for (const cursor of old) {
      if (cursor['tipo'] !== undefined || cursor['ancho'] !== undefined) {
        changed = true;
        const kindNames: Record<string, CustomCursor['kind']> = {
          cur: 'cur',
          imagen: 'image',
          animado: 'animated',
        };
        upgraded.push({
          id: cursor['id'] as string,
          name: cursor['name'] as string,
          data: cursor['data'] as string,
          kind: kindNames[cursor['tipo'] as string] ?? 'image',
          frames: cursor['frames'] as CustomCursor['frames'],
          point: cursor['punto'] === 'esquina' ? 'corner' : 'center',
          hot: cursor['hot'] as CustomCursor['hot'],
          width: cursor['ancho'] as number,
          height: cursor['alto'] as number,
        });
      } else {
        upgraded.push(cursor as unknown as CustomCursor);
      }
    }
    if (changed) {
      this.customCursors.set(upgraded);
    }
  }

  /** Keeps the shared time formatter in sync with the preference. */
  private applyTimeFormat(): void {
    setTimeFormat(this.timeFormat());
  }

  /** Writes the theme, radius, bubble style, font, motion and background settings on the page. */
  private applyDocumentSettings(): void {
    const root = document.documentElement;
    const speeds = { lively: 0.45, normal: 1, calm: 3.5, off: 1 };
    if ((this.theme() as string) === 'sand') {
      // The old Sand theme became the orange one.
      this.theme.set('tangerine');
    }
    root.dataset['theme'] = this.theme();
    const corner = CORNER_STEPS[this.cornerStep()] ?? CORNER_STEPS[3]!;
    root.style.setProperty('--r', corner.small + 'px');
    root.style.setProperty('--r-lg', corner.large + 'px');
    root.dataset['bubble'] = this.bubbleStyle();
    root.dataset['font'] = this.font();
    root.dataset['motion'] =
      this.animations() === 'off' ? 'reduced' : this.animations() === 'quick' ? 'quick' : 'full';
    root.dataset['bg'] = this.bgMotion() === 'off' ? 'still' : 'live';
    root.style.setProperty(
      '--glass',
      GLASS_LEVELS[Math.min(4, Math.max(0, this.bgVisibility()))] + '%',
    );
    root.style.setProperty('--font-size', this.fontSize() + 'px');
    // (the slider goes to 100; a larger value kept from before is read as 100)
    const blur = Math.min(100, this.bgBlur());
    root.style.setProperty('--bg-blur', blur + 'px');
    root.style.setProperty('--bg-core', Math.max(0, 45 - blur * 0.4) + '%');
    root.style.setProperty('--bg-speed', String(speeds[this.bgMotion()]));
  }

  /** Custom theme: the surfaces of the interface are calculated from a base color and the parts chosen by hand. */
  private applyCustomTheme(): void {
    const root = document.documentElement;
    const parts = this.customThemeParts();
    if (this.theme() !== 'custom' || !isHex(this.customTheme())) {
      for (const shade of SURFACE_SHADES) {
        root.style.removeProperty('--ink-' + shade);
      }
      for (const variable of THEME_VARIABLES) {
        root.style.removeProperty(variable);
      }
      return;
    }
    const base = this.customTheme();
    // With a panel color, the lighter surfaces come from it and the darker ones keep coming from the base color.
    const panel = isHex(parts.panel) ? parts.panel : base;
    const surfaces: string[][] = [
      ['950', 'color-mix(in oklab, ' + base + ' 38%, #000)'],
      ['900', 'color-mix(in oklab, ' + base + ' 58%, #000)'],
      ['850', 'color-mix(in oklab, ' + base + ' 78%, #000)'],
      ['800', panel],
      ['700', 'color-mix(in oklab, ' + panel + ' 90%, #fff)'],
      ['600', 'color-mix(in oklab, ' + panel + ' 80%, #fff)'],
      ['500', 'color-mix(in oklab, ' + panel + ' 68%, #fff)'],
    ];
    for (const surface of surfaces) {
      root.style.setProperty('--ink-' + surface[0], surface[1]);
    }
    // Text, soft text and second accent only change when the person chose them.
    this.setOrRemove('--fg', isHex(parts.text) ? parts.text : '');
    this.setOrRemove('--muted', isHex(parts.muted) ? parts.muted : '');
    this.setOrRemove(
      '--dim',
      isHex(parts.muted) ? 'color-mix(in oklab, ' + parts.muted + ' 70%, transparent)' : '',
    );
    this.setOrRemove('--accent-2', isHex(parts.accent2) ? parts.accent2 : '');
  }

  /** Sets a CSS variable on the page, or removes it when the value is empty. */
  private setOrRemove(name: string, value: string): void {
    if (value) {
      document.documentElement.style.setProperty(name, value);
    } else {
      document.documentElement.style.removeProperty(name);
    }
  }

  /** Sets the CSS variables of the chat bubbles and picks readable text for their colors. */
  private applyBubbles(): void {
    const own = this.bubbleOwn();
    const second = this.bubbleOwnTo();
    const other = this.bubbleOther();
    const multi = parseMulti(this.bubbleOwnGrad());
    if (multi) {
      this.setOrRemove('--bubble-own', gradientCss(multi));
      this.setOrRemove(
        '--bubble-own-ink',
        readableInk(
          multi.stops.map(function colorOf(stop) {
            return stop.color;
          }),
        ),
      );
      this.setOrRemove('--bubble-own-solid', sortedStops(multi.stops)[0]!.color);
    } else if (isHex(own)) {
      const colors = isHex(second) ? [own, second] : [own];
      this.setOrRemove(
        '--bubble-own',
        isHex(second) ? 'linear-gradient(135deg, ' + own + ', ' + second + ')' : own,
      );
      this.setOrRemove('--bubble-own-ink', readableInk(colors));
      // Styles that cannot show a gradient (neon) use only the first color.
      this.setOrRemove('--bubble-own-solid', own);
    } else {
      this.setOrRemove('--bubble-own-solid', '');
      this.setOrRemove('--bubble-own', '');
      this.setOrRemove('--bubble-own-ink', '');
    }
    this.setOrRemove('--bubble-other', isHex(other) ? other : '');
    this.setOrRemove('--bubble-other-ink', isHex(other) ? readableInk([other]) : '');
  }

  /** Applies the accent color of the profile; a custom one also picks a readable text color for it. */
  applyAccent(accent: AccentId, custom = ''): void {
    const root = document.documentElement;
    root.dataset['accent'] = accent;
    if (accent === 'custom' && isHex(custom)) {
      this.setOrRemove('--accent', custom);
      this.setOrRemove('--accent-ink', readableInk([custom]));
    } else {
      this.setOrRemove('--accent', '');
      this.setOrRemove('--accent-ink', '');
    }
  }
}
