/**
 * src/app/core/services/cursor-overlay.ts
 * A cursor drawn by the page itself, for what the browser cannot do: pulsing animation, animated cursor files
 * and trails. The real cursor is made invisible and this overlay follows the pointer. For every pointer move it
 * asks the page which cursor state it wants (arrow, link, text, hand...) through the computed `cursor` style,
 * so EVERY state keeps its themed drawing (see markerCss) instead of falling back to the system cursor. The
 * overlay lives in the browser's top layer, above menus and dialogs.
 */
import type { CursorFrame } from '../cursor-files';
import { markerName } from './cursor-markers';
import { CursorTrail, type TrailConfig } from './cursor-trail';

/** One drawn cursor state of the overlay. */
export interface OverlayLayer {
  /** SVG of the state (or an <img> tag for an uploaded animated cursor). */
  html: string;
  /** Hot spot inside the drawing, in pixels. */
  hot: [number, number];
  /** Offset from the hot spot to the point the trail comes out of (the back of an arrow, not its tip). */
  anchor: [number, number];
}

/** What the overlay draws. */
export interface OverlayConfig {
  /** Drawing of every cursor state, by name ("default", "pointer", "text"...). */
  layers: Record<string, OverlayLayer>;
  /** Frames of an uploaded animated cursor; they are played inside the <img> of the layers that use one. */
  frames?: CursorFrame[];
  trail?: TrailConfig;
}

/** Cursor states over which the drawing grows a little (buttons and links). */
const GROWING_STATES: string[] = ['pointer'];
/** Scale of the drawing over a button or link. */
const HOVER_SCALE = 1.14;
/** Events after which the page may have opened something new in the top layer. */
const REVIEW_EVENTS: string[] = ['pointerup', 'click', 'keyup', 'transitionend', 'animationend'];

/** What was found out about an element: whether it scrolls on each axis, and when it was looked at. */
const scrollMemory = new WeakMap<Element, { x: boolean; y: boolean; at: number }>();
/** How long what was found out about an element is trusted (ms): the style of an element rarely changes its overflow. */
const SCROLL_MEMORY_MS = 3000;

/** Whether an element scrolls (or always shows a bar) on one axis. Remembered for a moment: reading a style costs. */
function scrolls(element: Element, axis: 'x' | 'y'): boolean {
  const now = performance.now();
  let known = scrollMemory.get(element);
  if (!known || now - known.at > SCROLL_MEMORY_MS) {
    const style = getComputedStyle(element);
    const bar = function (value: string): boolean {
      return value === 'auto' || value === 'scroll' || value === 'overlay';
    };
    known = { x: bar(style.overflowX), y: bar(style.overflowY), at: now };
    scrollMemory.set(element, known);
  }
  return axis === 'x' ? known.x : known.y;
}

/**
 * Whether the pointer is over the scrollbar of the element it is on (or of one of the elements around it).
 * ! Only elements that really scroll count, and sizes are compared in layout pixels: a button that grows on hover
 * ! (transform: scale) is wider on screen than in layout and used to look like it had a scrollbar.
 */
function overScrollbar(pointer: PointerEvent): boolean {
  let element = pointer.target instanceof Element ? pointer.target : null;
  while (element && element !== document.documentElement) {
    const box = element.getBoundingClientRect();
    const html = element as HTMLElement;
    const scale = html.offsetWidth > 0 ? box.width / html.offsetWidth : 1;
    const side =
      element.clientWidth > 0
        ? (html.offsetWidth - element.clientWidth - element.clientLeft * 2) * scale
        : 0;
    if (
      side > 2 &&
      scrolls(element, 'y') &&
      pointer.clientX >= box.right - side - element.clientLeft
    ) {
      return true;
    }
    const low =
      element.clientHeight > 0
        ? (html.offsetHeight - element.clientHeight - element.clientTop * 2) * scale
        : 0;
    if (
      low > 2 &&
      scrolls(element, 'x') &&
      pointer.clientY >= box.bottom - low - element.clientTop
    ) {
      return true;
    }
    element = element.parentElement;
  }
  const root = document.documentElement;
  return root.clientWidth > 0 && pointer.clientX >= root.clientWidth;
}

/** The cursor drawn by the page. */
export class CursorOverlay {
  private config: OverlayConfig | null = null;
  private node: HTMLElement | null = null;
  private inner: HTMLElement | null = null;
  private trail: CursorTrail | null = null;
  private readonly layerNodes = new Map<string, HTMLElement>();
  private pictures: HTMLImageElement[] = [];
  private frameIndex = 0;
  private frameTimer = 0;
  private frame = 0;
  private x = -100;
  private y = -100;
  private target: Element | null = null;
  private activeState = 'default';
  private visible = false;
  private nativeMode = false;
  private reviewTimer = 0;
  /** The last pointer event of this frame, looked at when the frame is painted. */
  private pending: PointerEvent | null = null;
  private seenLayers = new Set<Element>();

  private readonly moveHandler = this.onPointer.bind(this);
  private readonly leaveHandler = this.setNativeMode.bind(this, true);
  private readonly outHandler = this.onPointerOut.bind(this);
  private readonly toggleHandler = this.onToggle.bind(this);
  private readonly reviewHandler = this.scheduleReview.bind(this);

  /** Starts (or restarts) the overlay with a configuration. */
  activate(config: OverlayConfig): void {
    this.deactivate();
    this.config = config;
    document.documentElement.classList.add('cursor-js');

    const node = document.createElement('div');
    node.className = 'cursor-overlay';
    node.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('div');
    inner.className = 'cs-in';
    node.appendChild(inner);
    for (const name of Object.keys(config.layers)) {
      const layer = document.createElement('span');
      layer.className = 'cs-layer';
      layer.dataset['cur'] = name;
      layer.innerHTML = config.layers[name].html;
      inner.appendChild(layer);
      this.layerNodes.set(name, layer);
    }
    this.pictures = Array.from(inner.querySelectorAll('img'));
    if (config.frames && config.frames.length > 1) {
      this.showNextFrame();
    }
    this.node = node;
    this.inner = inner;
    this.setState('default');

    if (config.trail) {
      this.trail = new CursorTrail(config.trail);
    }
    document.body.appendChild(node);
    this.raiseToTopLayer();
    document.addEventListener('toggle', this.toggleHandler, true);
    for (const type of REVIEW_EVENTS) {
      document.addEventListener(type, this.reviewHandler, true);
    }
    document.addEventListener('pointermove', this.moveHandler, true);
    document.addEventListener('pointerdown', this.moveHandler, true);
    // ? Coming back into the page (from another app that changes the mouse, a game, a remote session) brings the themed cursor back at once,
    //   without waiting for the next move.
    document.addEventListener('pointerover', this.moveHandler, true);
    document.addEventListener('mouseleave', this.leaveHandler);
    document.documentElement.addEventListener('mouseleave', this.leaveHandler);
    window.addEventListener('blur', this.leaveHandler);
    document.addEventListener('pointerout', this.outHandler, true);
  }

  /** Stops the overlay and gives the real cursor back. */
  deactivate(): void {
    document.removeEventListener('toggle', this.toggleHandler, true);
    for (const type of REVIEW_EVENTS) {
      document.removeEventListener(type, this.reviewHandler, true);
    }
    document.removeEventListener('pointermove', this.moveHandler, true);
    document.removeEventListener('pointerdown', this.moveHandler, true);
    document.removeEventListener('pointerover', this.moveHandler, true);
    document.removeEventListener('mouseleave', this.leaveHandler);
    document.documentElement.removeEventListener('mouseleave', this.leaveHandler);
    window.removeEventListener('blur', this.leaveHandler);
    document.removeEventListener('pointerout', this.outHandler, true);
    window.clearTimeout(this.reviewTimer);
    window.clearTimeout(this.frameTimer);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.node?.remove();
    this.node = null;
    this.inner = null;
    this.trail?.destroy();
    this.trail = null;
    this.layerNodes.clear();
    this.pictures = [];
    this.seenLayers.clear();
    this.config = null;
    this.visible = false;
    this.nativeMode = false;
    document.documentElement.classList.remove('cursor-js', 'cursor-native');
  }

  // ---- top layer ------------------------------------------------------------------------------

  /**
   * Puts the trail and the cursor in the browser's top layer (popover API), the only way to stay above the
   * menus and pickers that live there too. The cursor goes last, so it is on top of everything.
   */
  private raiseToTopLayer(): void {
    const elements: (HTMLElement | null)[] = [this.trail ? this.trail.canvas : null, this.node];
    for (const element of elements) {
      if (!element) {
        continue;
      }
      const popover = element as HTMLElement & {
        showPopover?: () => void;
        hidePopover?: () => void;
      };
      popover.setAttribute('popover', 'manual');
      try {
        popover.hidePopover?.();
        popover.showPopover?.();
      } catch {
        // The browser has no popover support: the high z-index of the stylesheet is used instead.
      }
    }
  }

  /** Something opened in the top layer (menu, color picker): put the cursor back on top of it. */
  private onToggle(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target || target === this.node || (this.trail && target === this.trail.canvas)) {
      return;
    }
    if ((event as Event & { newState?: string }).newState === 'open') {
      window.setTimeout(this.raiseToTopLayer.bind(this), 0);
    }
  }

  /** Waits a moment for whatever was just opened to reach the top layer, then checks if the cursor must be raised. */
  private scheduleReview(): void {
    window.clearTimeout(this.reviewTimer);
    this.reviewTimer = window.setTimeout(this.reviewLayers.bind(this), 40);
  }

  /** Raises the cursor again when a new menu, picker or dialog is open in the top layer. */
  private reviewLayers(): void {
    let open: Element[] = [];
    try {
      open = Array.from(document.querySelectorAll(':popover-open, :modal'));
    } catch {
      return;
    }
    let found = false;
    const next = new Set<Element>();
    for (const element of open) {
      if (element === this.node || (this.trail && element === this.trail.canvas)) {
        continue;
      }
      next.add(element);
      if (!this.seenLayers.has(element)) {
        found = true;
      }
    }
    this.seenLayers = next;
    if (found) {
      this.raiseToTopLayer();
    }
  }

  // ---- pointer --------------------------------------------------------------------------------

  /** The pointer moved over an element that is not part of this page (an extension panel, another window). */
  private onPointerOut(event: Event): void {
    const pointer = event as PointerEvent;
    const related = pointer.relatedTarget as Element | null;
    if (related && (related.tagName === 'IFRAME' || related.shadowRoot)) {
      this.setNativeMode(true);
      return;
    }
    // No related element: the pointer left the page, unless the element under it was only replaced (a list that
    // ! re-renders), which must not bring the system cursor back.
    // ! The page of another site (an iframe) never says where the pointer went: the element under the pointer does.
    if (
      !related &&
      document.elementFromPoint(pointer.clientX, pointer.clientY)?.tagName === 'IFRAME'
    ) {
      this.setNativeMode(true);
      return;
    }
    const edge = 2;
    const outside =
      pointer.clientX <= edge ||
      pointer.clientY <= edge ||
      pointer.clientX >= window.innerWidth - edge ||
      pointer.clientY >= window.innerHeight - edge;
    if (!related && outside) {
      this.setNativeMode(true);
    }
  }

  /** Shows the real cursor while the pointer is over something this page cannot follow. */
  private setNativeMode(native: boolean): void {
    this.nativeMode = native;
    document.documentElement.classList.toggle('cursor-native', native);
    if (native) {
      this.pending = null;
      this.hide();
    }
  }

  /** Pointer position changed: remember it and paint on the next frame. */
  private onPointer(event: Event): void {
    const pointer = event as PointerEvent;
    if (pointer.pointerType === 'touch') {
      return;
    }
    // A page of another site never reports its moves: entering it keeps the system cursor (see onPointerOut).
    if (pointer.type === 'pointerover' && (pointer.target as Element | null)?.tagName === 'IFRAME') {
      return;
    }
    // ! Only the last position of the frame is kept: a mouse sends hundreds of events a second, and looking at the page for
    // each one (which elements are around, which cursor they ask for) made every move cost a layout.
    this.x = pointer.clientX;
    this.y = pointer.clientY;
    this.target = pointer.target as Element | null;
    this.pending = pointer;
    if (!this.frame) {
      this.frame = requestAnimationFrame(this.paint.bind(this));
    }
  }

  /** Asks the page which cursor state it wants over an element; null means "no cursor here". */
  private stateFor(element: Element | null): string | null {
    if (!element) {
      return 'default';
    }
    const computed = getComputedStyle(element).cursor;
    if (computed === 'none') {
      return null;
    }
    const name = markerName(computed);
    if (name && this.layerNodes.has(name)) {
      return name;
    }
    return 'default';
  }

  /** Makes one cursor state visible and the others transparent. */
  private setState(name: string): void {
    this.activeState = name;
    this.layerNodes.forEach(function toggle(layer: HTMLElement, key: string): void {
      layer.classList.toggle('cs-active', key === name);
    });
  }

  /** Paints one frame: the right state, the position and the trail. */
  private paint(): void {
    this.frame = 0;
    const node = this.node;
    const inner = this.inner;
    const config = this.config;
    if (!node || !inner || !config) {
      return;
    }
    const pointer = this.pending;
    this.pending = null;
    if (pointer && overScrollbar(pointer)) {
      // The browser draws its own arrow over a scrollbar: the themed one steps aside so there are not two.
      this.setNativeMode(true);
      return;
    }
    if (pointer && this.nativeMode) {
      this.setNativeMode(false);
    }
    if (this.nativeMode) {
      // ! The pointer left (the window edge, a frame of another site): a frame that was already due must not bring the cursor back.
      node.style.opacity = '0';
      return;
    }
    const state = this.stateFor(this.target);
    this.visible = state !== null;
    if (state !== null && state !== this.activeState) {
      this.setState(state);
    }
    const layer = config.layers[this.activeState] ?? config.layers['default'];
    const scale = GROWING_STATES.indexOf(this.activeState) >= 0 ? HOVER_SCALE : 1;
    node.style.opacity = this.visible ? '1' : '0';
    node.style.transform =
      'translate3d(' + (this.x - layer.hot[0]) + 'px, ' + (this.y - layer.hot[1]) + 'px, 0)';
    inner.style.transformOrigin = layer.hot[0] + 'px ' + layer.hot[1] + 'px';
    inner.style.transform = 'scale(' + scale + ')';
    if (this.trail && this.visible) {
      this.trail.addPoint(this.x + layer.anchor[0], this.y + layer.anchor[1]);
    }
  }

  /** Hides the cursor (the pointer left the window). */
  private hide(): void {
    this.visible = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.node) {
      this.node.style.opacity = '0';
    }
  }

  // ---- animated pictures ----------------------------------------------------------------------

  /** Shows the next frame of an uploaded animated cursor and waits for its time. */
  private showNextFrame(): void {
    const frames = this.config?.frames;
    if (!frames || this.pictures.length === 0) {
      return;
    }
    const current = frames[this.frameIndex % frames.length];
    for (const picture of this.pictures) {
      picture.src = current.data;
    }
    this.frameIndex++;
    this.frameTimer = window.setTimeout(this.showNextFrame.bind(this), current.ms);
  }
}
