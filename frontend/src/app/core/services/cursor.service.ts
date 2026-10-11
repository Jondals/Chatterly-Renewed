/**
 * src/app/core/services/cursor.service.ts
 * Themed cursors: draws every cursor state (arrow, link, text, hand, wait...) in the accent color and exposes
 * them as CSS variables (--cur-*). When the person asks for animation, a trail or an animated cursor file, the
 * real cursor is hidden and the page draws its own (see CursorOverlay); the same variables then carry a marker
 * instead of a picture, so every cursor state keeps its themed drawing. "System" removes it all.
 */
import { Injectable, effect, inject } from '@angular/core';
import { CursorOverlay, type OverlayConfig, type OverlayLayer } from './cursor-overlay';
import { CURSOR_STATES, markerCss } from './cursor-markers';
import type { TrailType } from './cursor-trail';
import { SettingsService, type CursorMode, type CustomCursor } from './settings.service';

/** A picture address that is safe to write inside an HTML attribute: only a base64 image, nothing that could close the attribute. */
function safePicture(data: string): string {
  return /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(data) ? data : '';
}

/** The module with the drawings of the cursors. */
type Shapes = typeof import('./cursor-shapes');

/** Starts the cursor engine and keeps it in sync with the settings. */
@Injectable({ providedIn: 'root' })
export class CursorService {
  private readonly settings = inject(SettingsService);
  private readonly overlay = new CursorOverlay();
  private observer?: MutationObserver;
  /** The drawings of the cursors, loaded the first time a cursor has to be drawn. */
  private shapes: Shapes | null = null;

  /** Starts following the cursor settings and the theme colors. */
  constructor() {
    effect(this.onSettingsChanged.bind(this));
    // The accent color can change without a setting changing (theme, custom accent): the cursors follow it.
    this.observer = new MutationObserver(this.apply.bind(this));
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-accent', 'style'],
    });
  }

  /** Reads every cursor setting (so the effect runs again when any of them changes) and applies them. */
  private onSettingsChanged(): void {
    this.settings.cursor();
    this.settings.customCursors();
    this.settings.cursorAnimated();
    this.settings.cursorTrail();
    this.settings.cursorSize();
    this.settings.cursorColor();
    this.settings.cursorTrailSize();
    this.settings.cursorTrailLength();
    this.apply();
  }

  /** The drawings arrived: the cursor is put in the page. */
  private drawingsLoaded(module: Shapes): void {
    this.shapes = module;
    this.apply();
  }

  /** Removes every --cur-* variable from the page. */
  private clearVariables(): void {
    for (const name of CURSOR_STATES) {
      document.documentElement.style.removeProperty('--cur-' + name);
    }
  }

  /** Puts the cursor in the page: CSS cursors when possible, the overlay when animation or a trail is needed. */
  private apply(): void {
    const root = document.documentElement;
    const mode = this.settings.cursor();
    const custom = this.findCustom(mode);
    // ! The color goes into the drawing of the cursor (markup): only a hex color is used, whatever was saved or came in a preset.
    const saved = this.settings.cursorColor();
    const chosenColor = /^#[0-9a-fA-F]{3,8}$/.test(saved) ? saved : '';
    const accent =
      chosenColor || getComputedStyle(root).getPropertyValue('--accent').trim() || '#2ef2b0';
    const accent2 =
      chosenColor || getComputedStyle(root).getPropertyValue('--accent-2').trim() || accent;
    const size = Math.min(64, Math.max(14, this.settings.cursorSize()));
    const trail = this.settings.cursorTrail();
    const animated = this.settings.cursorAnimated();

    if (mode === 'system') {
      this.overlay.deactivate();
      this.clearVariables();
      return;
    }
    const shapes = this.shapes;
    if (!shapes) {
      void import('./cursor-shapes').then(this.drawingsLoaded.bind(this));
      return;
    }
    const needsOverlay =
      trail !== 'off' || animated || (custom !== null && custom.kind === 'animated');
    if (needsOverlay) {
      // The variables carry markers: invisible cursors that tell the overlay which state the page asks for.
      for (const name of CURSOR_STATES) {
        const marker = markerCss(name);
        if (root.style.getPropertyValue('--cur-' + name) !== marker) {
          root.style.setProperty('--cur-' + name, marker);
        }
      }
      this.overlay.activate(
        this.buildOverlay(shapes, mode, custom, accent, accent2, size, animated, trail),
      );
      return;
    }
    this.overlay.deactivate();
    for (const name of CURSOR_STATES) {
      const value = shapes.cursorCss(name, accent, mode, custom, size);
      // The same value is not written again: that would wake the observer for nothing.
      if (root.style.getPropertyValue('--cur-' + name) !== value) {
        root.style.setProperty('--cur-' + name, value);
      }
    }
  }

  /** The uploaded cursor chosen as the current one, if any. */
  private findCustom(mode: CursorMode): CustomCursor | null {
    for (const cursor of this.settings.customCursors()) {
      if ('custom:' + cursor.id === mode) {
        return cursor;
      }
    }
    return null;
  }

  /** Builds what the overlay draws: every cursor state, plus the trail. */
  private buildOverlay(
    shapes: Shapes,
    mode: CursorMode,
    custom: CustomCursor | null,
    accent: string,
    accent2: string,
    size: number,
    animated: boolean,
    trail: TrailType | 'off',
  ): OverlayConfig {
    const family = shapes.FAMILIES.indexOf(mode) >= 0 ? mode : 'classic';
    const arrowBody: [number, number] =
      shapes.ARROW_FAMILIES.indexOf(family) >= 0
        ? [Math.round((size * 8) / shapes.BASE_SIZE), Math.round((size * 12) / shapes.BASE_SIZE)]
        : [0, 0];
    const layers: Record<string, OverlayLayer> = {};
    for (const name of CURSOR_STATES) {
      const arrowLike = name === 'default' || name === 'pointer';
      const shapeFamily = family;
      layers[name] = {
        html: shapes.svgCursor(shapeFamily, name, accent, size, animated),
        hot: shapes.hotSpot(shapeFamily, name, size),
        anchor: arrowLike ? arrowBody : [0, 0],
      };
    }
    const config: OverlayConfig = { layers };
    if (trail !== 'off') {
      config.trail = {
        type: trail,
        color: accent,
        color2: accent2,
        scale: this.settings.cursorTrailSize(),
        length: this.settings.cursorTrailLength(),
      };
    }
    if (custom) {
      this.useUploadedCursor(config, custom, size);
    }
    return config;
  }

  /** Replaces the arrow and link drawings with the uploaded cursor (a picture, or the frames of an animation). */
  private useUploadedCursor(config: OverlayConfig, custom: CustomCursor, size: number): void {
    const frames =
      custom.frames && custom.frames.length > 0 ? custom.frames : [{ data: custom.data, ms: 1000 }];
    const ratio = size / Math.max(1, custom.width);
    const height = Math.round(custom.height * ratio);
    let hot: [number, number] = [size / 2, height / 2];
    if (custom.hot) {
      hot = [Math.round(custom.hot[0] * ratio), Math.round(custom.hot[1] * ratio)];
    } else if (custom.point === 'corner') {
      hot = [0, 0];
    }
    const picture =
      '<img alt="" draggable="false" src="' +
      safePicture(frames[0].data) +
      '" style="display:block;max-width:none;width:' +
      size +
      'px;height:' +
      height +
      'px">';
    const layer: OverlayLayer = { html: picture, hot, anchor: [0, 0] };
    config.layers['default'] = layer;
    config.layers['pointer'] = layer;
    if (frames.length > 1) {
      config.frames = frames;
    }
  }
}
