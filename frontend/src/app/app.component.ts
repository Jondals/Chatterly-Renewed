/**
 * src/app/app.component.ts
 * Root component: the animated background, the routed pages, the notices, the sound under every press, the
 * block on the browser's own context menu, the mouse wheel on sliders and the late start of cursors and tooltips.
 */
import { ChangeDetectionStrategy, Component, HostListener, Injector, NgZone, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { desktopBridge } from './core/desktop-bridge';
import { I18nService } from './core/i18n/i18n.service';
import { ArrivalService } from './core/services/arrival.service';
import { SettingsService } from './core/services/settings.service';
import { SettingsSyncService } from './core/services/settings-sync.service';
import { SoundService } from './core/services/sound.service';
import { ArrivalComponent } from './shared/components/arrival.component';
import { MeshBackgroundComponent } from './shared/components/mesh-background.component';
import { TitlebarComponent } from './shared/components/titlebar.component';
import { ToastHostComponent } from './shared/components/toast-host.component';
import { pauseDecorationWhenAway, watchFramePerformance } from './shared/util/perf-monitor';
import { PresetService } from './core/services/preset.service';
import { PresetTryComponent } from './shared/components/preset-try.component';
import { ViewerService } from './core/services/viewer.service';
import { ImageViewerComponent } from './shared/components/image-viewer.component';
import { ScreenPickerComponent } from './layout/screen-picker.component';

/** Things that make a press feel like a press: tiny sounds under controls. */
const PRESSABLE =
  'button, a[href], [role="button"], [role="link"], [role="switch"], [role="tab"], [role="radio"], summary, select, input[type="checkbox"], input[type="radio"], .clickable, .nav-item, .choice-card, .ring-card, .seg-tab, .menu-card';

/** How much a press matters, from the look of the control: the sound keeps its style but changes pitch and level. */
interface PressWeight {
  pitch: number;
  level: number;
}

/** Picks the weight of a press: main actions ring brighter, destructive ones lower, quiet icon buttons softer. */
function weightOf(target: HTMLElement): PressWeight {
  const classes = target.classList;
  if (classes.contains('btn-primary')) {
    return { pitch: 1.22, level: 1.25 };
  }
  if (
    classes.contains('btn-danger') ||
    classes.contains('btn-soft-danger') ||
    classes.contains('friend-act-danger')
  ) {
    return { pitch: 0.8, level: 1.05 };
  }
  if (
    classes.contains('nav-item') ||
    classes.contains('seg-tab') ||
    classes.contains('choice-card') ||
    classes.contains('ring-card') ||
    classes.contains('menu-card')
  ) {
    return { pitch: 1, level: 0.85 };
  }
  if (
    classes.contains('btn-ghost') ||
    classes.contains('btn-icon') ||
    classes.contains('dock-btn')
  ) {
    return { pitch: 1.1, level: 0.7 };
  }
  return { pitch: 1, level: 1 };
}

/** The application shell. */
/** True when some text of the page is selected. */
function hasSelection(): boolean {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== '';
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  standalone: true,
  imports: [
    ImageViewerComponent,
    RouterOutlet,
    ArrivalComponent,
    MeshBackgroundComponent,
    PresetTryComponent,
    ScreenPickerComponent,
    TitlebarComponent,
    ToastHostComponent,
  ],
  template: `
    @if (desktopBar) {
      <app-titlebar />
    }
    @defer (on idle) {
      <app-mesh-background />
    }
    <router-outlet />
    <app-toast-host />
    @if (desktop) {
      <app-screen-picker />
    }
    @if (viewer.open()) {
      @defer (on immediate) {
        <app-image-viewer />
      }
    }
    @if (presets.trying() || presets.previewing()) {
      @defer (on immediate) {
        <app-preset-try />
      }
    }
    @if (arrival.current(); as a) {
      @defer (on immediate) {
        <app-arrival [kind]="a.kind" [name]="a.name" />
      }
    }
  `,
})
export class AppComponent {
  /** The desktop app draws its own bar at the top of the window. */
  protected readonly desktopBar = !!desktopBridge()?.titlebar;
  /** True inside the desktop app: it draws the menu to choose what to share. */
  protected readonly desktop = !!desktopBridge()?.screen;
  protected readonly arrival = inject(ArrivalService);
  protected readonly presets = inject(PresetService);
  protected readonly viewer = inject(ViewerService);
  private readonly settings = inject(SettingsService);
  private readonly sound = inject(SoundService);
  // Made at the start: it brings the settings of the account when the person signs in, and keeps them.
  private readonly settingsSync = inject(SettingsSyncService);
  private readonly i18n = inject(I18nService);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly wheelHandler = this.onWheel.bind(this);
  /** The pending long press of a finger, and where it started. */
  private press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  /** Whether text was already selected when the finger went down (then a long press is for copying it). */
  private selectedAtPress = false;

  constructor() {
    // The cursor engine, the tooltips and the uploaded fonts are not needed for the first paint: they load right after it.
    window.setTimeout(this.loadExtras.bind(this), 0);
    // The very first visit opens with a short animation (nothing is shown to people who are already signed in).
    window.setTimeout(this.arrival.maybeIntro.bind(this.arrival), 0);
    // The sounds load once the page has settled (fifty small files must not compete with the first paint or the first
    // interaction; on a phone later still); a press before that loads them at once.
    const soundDelay = document.documentElement.dataset['perf'] === 'low' ? 12000 : 8000;
    window.setTimeout(this.sound.preload.bind(this.sound), soundDelay);
    document.addEventListener('pointerdown', this.sound.preload.bind(this.sound), {
      once: true,
      passive: true,
    });
    // The address that search engines see for a page is the page itself (the HTML carries the one of the home page).
    this.router.events.subscribe(this.updateCanonical.bind(this));
    // ! Not passive: the page must not scroll while the wheel turns over a slider.
    document.addEventListener('wheel', this.wheelHandler, { passive: false });
    document.addEventListener('pointerdown', this.onFingerDown.bind(this), { passive: true });
    // ! Capture: it runs before the menus of the app, so it can leave the phone its own copy and paste menu.
    document.addEventListener('contextmenu', this.onContextMenu.bind(this), { capture: true });
    document.addEventListener('pointermove', this.onFingerMove.bind(this), { passive: true });
    document.addEventListener('pointerup', this.cancelPress.bind(this), { passive: true });
    document.addEventListener('pointercancel', this.cancelPress.bind(this), { passive: true });
    effect(this.applyAccent.bind(this));
    effect(this.applyLanguage.bind(this));
  }

  /** Points the canonical link at the page that is open (without its query), when the page changes. */
  private updateCanonical(event: unknown): void {
    if (!(event instanceof NavigationEnd) || !location.protocol.startsWith('http')) {
      return;
    }
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (link) {
      link.href = location.origin + event.urlAfterRedirects.split(/[?#(]/)[0]!;
    }
  }

  /** The chosen accent color re-themes the whole interface. */
  private applyAccent(): void {
    this.settings.applyAccent(this.settings.accent(), this.settings.customAccent());
  }

  /** Keeps the lang attribute of the page equal to the language of the interface. */
  private applyLanguage(): void {
    document.documentElement.lang = this.i18n.lang();
  }

  /** Loads and starts the themed cursors and the global tooltips (separate chunks, after the first paint). */
  private async loadExtras(): Promise<void> {
    const cursor = await import('./core/services/cursor.service');
    const tooltip = await import('./core/services/tooltip.service');
    this.injector.get(cursor.CursorService);
    this.injector.get(tooltip.TooltipService);
    // The emoji, script and serif fonts are a separate stylesheet that does not block the first paint.
    // * Always: the emoji font makes every emoji look the same on the phone, the computer and the web (the emoji of the
    //   system differ, and some joined ones, like the eye in a speech bubble, were drawn as two broken pieces).
    const lazyFonts = document.getElementById('lazy-fonts');
    if (lazyFonts) {
      (lazyFonts as HTMLLinkElement).media = 'all';
    }
    const fonts = await import('./core/services/font.service');
    this.injector.get(fonts.FontService);
    // From here on the real frames are measured: a device that stutters gets the light mode by itself.
    this.injector.get(NgZone).runOutsideAngular(watchFramePerformance);
    this.injector.get(NgZone).runOutsideAngular(pauseDecorationWhenAway);
  }

  /**
   * ! A file dropped on any part of the page that does not take files would be OPENED by the browser (the page would be
   * replaced by the file, and a console error appears: "cannot load or link to file:///"). Only the chat takes files.
   */
  @HostListener('document:dragover', ['$event'])
  @HostListener('document:drop', ['$event'])
  keepFilesOut(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
    }
  }

  /**
   * The browser's own context menu is blocked (the app has its own menus), except on a phone where the system menu is the
   * one that copies and pastes: a long press in a text box (Paste, Select all...) or on text that was already selected
   * (Copy, Share...). Then the menus of the app do not open.
   */
  private onContextMenu(event: Event): void {
    // A phone that sent the event by itself (Android) does not need ours.
    if (event.isTrusted) {
      this.cancelPress();
    }
    if (event.isTrusted && this.wantsSystemMenu(event.target)) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
  }

  /** True for a long press of a finger in a text box, or on text that was selected before the finger went down. */
  private wantsSystemMenu(target: EventTarget | null): boolean {
    if (!window.matchMedia('(pointer: coarse)').matches || !(target instanceof Element)) {
      return false;
    }
    if (
      target.closest(
        'textarea, [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="password"]',
      )
    ) {
      return true;
    }
    return this.selectedAtPress && hasSelection();
  }

  /** A finger went down: if it stays still for a moment it counts as a right click. */
  private onFingerDown(event: PointerEvent): void {
    this.cancelPress();
    this.selectedAtPress = hasSelection();
    if (event.pointerType !== 'touch') {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    this.press = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(this.longPress.bind(this, target), 600),
    };
  }

  /** The finger moved: it is a scroll, not a long press. */
  private onFingerMove(event: PointerEvent): void {
    if (this.press && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 10) {
      this.cancelPress();
    }
  }

  /** Forgets the pending long press. */
  private cancelPress(): void {
    if (this.press) {
      clearTimeout(this.press.timer);
      this.press = null;
    }
  }

  /** The finger stayed: the element gets the event a right click would have sent. */
  private longPress(target: Element): void {
    const press = this.press;
    this.press = null;
    if (!press || !target.isConnected) {
      return;
    }
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: press.x,
        clientY: press.y,
      }),
    );
  }

  /**
   * ? The mouse wheel over a slider moves it one step (up raises it, down lowers it) instead of scrolling the
   * page. The step is the slider's own (1 when it has none).
   */
  private onWheel(event: WheelEvent): void {
    const slider = event.target;
    if (!(slider instanceof HTMLInputElement) || slider.type !== 'range' || slider.disabled) {
      return;
    }
    event.preventDefault();
    const step = Number(slider.step) > 0 ? Number(slider.step) : 1;
    const min = slider.min === '' ? 0 : Number(slider.min);
    const max = slider.max === '' ? 100 : Number(slider.max);
    const current = Number(slider.value);
    const next = Math.min(max, Math.max(min, current + (event.deltaY < 0 ? step : -step)));
    if (next === current) {
      return;
    }
    // Rounded to the decimals of the step, to avoid values like 0.30000000000000004.
    const decimals = (String(step).split('.')[1] ?? '').length;
    slider.value = next.toFixed(decimals);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Plays the click sound under every control that is pressed (a different one for switches). */
  @HostListener('document:click', ['$event'])
  onPress(event: MouseEvent): void {
    const target = (event.target as Element | null)?.closest(PRESSABLE) as HTMLElement | null;
    if (!target || target.hasAttribute('disabled') || target.dataset['silent'] !== undefined) {
      return;
    }
    const isSwitch =
      target.getAttribute('role') === 'switch' ||
      (target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type));
    this.sound.play(isSwitch ? 'toggle' : 'click', isSwitch ? undefined : weightOf(target));
  }

  /** A soft tick under every step of a slider; the pitch rises with the value. */
  @HostListener('document:input', ['$event'])
  onSlide(event: Event): void {
    const slider = event.target;
    if (!(slider instanceof HTMLInputElement) || slider.type !== 'range') {
      return;
    }
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    this.sound.slide(max > min ? (Number(slider.value) - min) / (max - min) : 0);
  }
}
