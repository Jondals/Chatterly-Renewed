/**
 * src/app/shared/util/name-fx.directive.ts
 * The animation of a name: the person chooses one in their profile and the LETTERS of their name move (they bounce, jump,
 * wave, wobble like jelly...) when the pointer is over the name.
 * Use: `<span [nameFx]="u.nameFx">{{ u.displayName }}</span>`.
 *
 * * How it is made: the text of the name stays where it is (Angular keeps writing it), moved into a wrapper that is hidden but
 * keeps its width; over it goes a layer with one element per letter (styles/chat.css, "nfx-"). Only transform and opacity
 * move (the graphics chip does it, the page does not draw again), and a name that is off the screen does not move at all.
 * ? When the pointer leaves, the letters finish the movement they are in: the animation stops when the last letter ends it.
 * ! A name never stays frozen half way through a movement: when the window loses the focus or is hidden, when a name that played on
 *   its own goes off the screen, or when a letter never ends its turn, the letters are put back at rest (see `rest`).
 */
import {
  AfterViewChecked,
  Directive,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
} from '@angular/core';

/** The animations of a name, with what each one looks like (the profile shows these words). */
export const NAME_FX: { id: string; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'The name stays still.' },
  { id: 'bounce', label: 'Bounce', hint: 'Quick low bounces, like rubber balls.' },
  { id: 'jump', label: 'Jump', hint: 'Somersaults: the letters leap and turn over in the air.' },
  { id: 'wave', label: 'Wave', hint: 'A smooth wave runs along the letters.' },
  { id: 'jelly', label: 'Jelly', hint: 'The letters wobble like jelly.' },
  { id: 'pop', label: 'Pop', hint: 'The letters pop up, one by one, with a rebound.' },
  { id: 'swing', label: 'Swing', hint: 'The letters hang and swing like a mobile.' },
  { id: 'flip', label: 'Flip', hint: 'The letters turn like coins.' },
  { id: 'glow', label: 'Glow', hint: 'A wide soft light breathes behind the name.' },
  { id: 'neon', label: 'Neon', hint: 'White-hot tubes with a tight halo that flicker one by one.' },
  { id: 'drift', label: 'Drift', hint: 'The letters rise like bubbles, fading in and out.' },
  {
    id: 'twinkle',
    label: 'Twinkle',
    hint: 'A light runs over the letters and makes them twinkle.',
  },
];

/** The ids that exist (what comes from another person is only used when it is one of these). */
const KNOWN = new Set(
  NAME_FX.map(function id(fx) {
    return fx.id;
  }),
);
/** The animations that are a light behind the name (a blurred copy of it) and not a movement of the letters. */
const HALOS = new Set(['glow', 'neon']);

/** How many names may play at the same time on their own (the rest wait for the pointer): a long chat is not a stage. */
const MAX_LIVE = 30;
/** How many names are playing on their own now. */
let liveNow = 0;

/** What to do when a name comes into view or goes out of it. */
const watchers = new WeakMap<Element, (visible: boolean) => void>();
/** One observer for every name of the chat. */
let observer: IntersectionObserver | null = null;

/** Starts telling a function when an element is on the screen. */
function watchVisible(element: Element, tell: (visible: boolean) => void): void {
  if (typeof IntersectionObserver === 'undefined') {
    tell(true);
    return;
  }
  observer ??= new IntersectionObserver(function seen(entries) {
    for (const entry of entries) {
      watchers.get(entry.target)?.(entry.isIntersecting);
    }
  });
  watchers.set(element, tell);
  observer.observe(element);
}

/** Stops watching an element. */
function unwatchVisible(element: Element): void {
  watchers.delete(element);
  observer?.unobserve(element);
}

/** Every name that has letters now: the window tells them when it loses the focus, is hidden or comes back. */
const lettered = new Set<NameFxDirective>();
let windowWatched = false;

/** The window lost the focus or was hidden: every name goes back to rest (nothing is looking at it). */
function suspendAll(): void {
  for (const name of lettered) {
    name.suspend();
  }
}

/** The window is back: the names that play on their own (or are under the pointer) start again. */
function wakeAll(): void {
  for (const name of lettered) {
    name.wake();
  }
}

/** The page was hidden or shown (another tab, minimized). */
function onVisibility(): void {
  if (document.hidden) {
    suspendAll();
  } else {
    wakeAll();
  }
}

/** Starts listening to the window once, for every name. */
function watchWindow(): void {
  if (windowWatched || typeof window === 'undefined') {
    return;
  }
  windowWatched = true;
  window.addEventListener('blur', suspendAll);
  window.addEventListener('focus', wakeAll);
  document.addEventListener('visibilitychange', onVisibility);
}

/** How long after the pointer leaves the letters may still be finishing their turn (the longest one is about 6.5 s). */
const FINISH_MS = 8000;

/** Makes the letters of a name move. */
@Directive({
  selector: '[nameFx]',
  standalone: true,
  host: {
    '[class.nfx]': 'fxClass() !== ""',
    '[class.nfx-bounce]': 'nameFx() === "bounce"',
    '[class.nfx-jump]': 'nameFx() === "jump"',
    '[class.nfx-wave]': 'nameFx() === "wave"',
    '[class.nfx-jelly]': 'nameFx() === "jelly"',
    '[class.nfx-pop]': 'nameFx() === "pop"',
    '[class.nfx-swing]': 'nameFx() === "swing"',
    '[class.nfx-flip]': 'nameFx() === "flip"',
    '[class.nfx-glow]': 'nameFx() === "glow"',
    '[class.nfx-neon]': 'nameFx() === "neon"',
    '[class.nfx-drift]': 'nameFx() === "drift"',
    '[class.nfx-twinkle]': 'nameFx() === "twinkle"',
    '(mouseenter)': 'enter()',
    '(mouseover)': 'over()',
    '(mouseleave)': 'leave()',
  },
})
export class NameFxDirective implements AfterViewChecked, OnDestroy {
  readonly nameFx = input<string | null | undefined>('none');
  /** Kept for compatibility with saved templates; names animate on hover throughout the app. */
  readonly fxLive = input(false);
  protected readonly fxClass = computed(this.pickClass.bind(this));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The wrapper that holds the real text of the name (hidden), and the layer of letters over it. */
  private wrapper: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  /** What the letters were made from (so they are made again only when it changes). */
  private made = '';
  private stopping = false;
  /** True while the letters were put back at rest by `rest` and nobody has started them again. */
  private resting = false;
  /** Puts the letters at rest if one never ends its turn after the pointer left. */
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private watching = false;
  /** True once the letters are wanted (the pointer came, or the name is on the screen): until then the name is plain text. */
  private armed = false;
  /** True while this name counts among the ones that play on their own. */
  private playing = false;
  /** Tells when the letters change size (a name in a folded section is measured when it opens). */
  private resize: ResizeObserver | null = null;

  /** The classes, or nothing when there is no animation (or the id is not one of ours). */
  private pickClass(): string {
    const id = this.nameFx();
    if (!id || id === 'none' || !KNOWN.has(id)) {
      return '';
    }
    return 'nfx nfx-' + id;
  }

  /**
   * After every check of the view: the letters follow the text of the name. ! They are only made when they are wanted (the
   * pointer is over the name, or it is on the screen and plays on its own): a list of names costs nothing until then.
   */
  ngAfterViewChecked(): void {
    const id = this.nameFx();
    if (!id || id === 'none' || !KNOWN.has(id)) {
      this.unmake();
      return;
    }
    if (!this.armed) {
      if (this.fxLive() && !this.watching) {
        this.watching = true;
        watchVisible(this.host.nativeElement, this.visible.bind(this));
      }
      return;
    }
    this.refresh();
  }

  /** Makes the letters again when the name, its animation or its kind of colour changed. */
  private refresh(): void {
    const id = this.nameFx();
    if (!id || id === 'none' || !KNOWN.has(id)) {
      return;
    }
    const node = this.nameNode();
    const text = node?.textContent?.trim() ?? '';
    if (!node || !text) {
      this.unmake();
      return;
    }
    // ! The kind of colour is part of the key: a name that goes from a gradient to a plain colour (or back) needs its letters
    // ! made again, or they would keep painting the gradient that is no longer there (and the name would disappear).
    const kind = this.host.nativeElement.style.getPropertyValue('--name-image') ? 'g' : 'c';
    if (this.made === id + '|' + text + '|' + kind && this.layer?.isConnected) {
      return;
    }
    this.make(node, id, text, kind);
  }

  ngOnDestroy(): void {
    if (this.playing) {
      this.playing = false;
      liveNow--;
    }
    this.resize?.disconnect();
    lettered.delete(this);
    this.clearFinishTimer();
    unwatchVisible(this.host.nativeElement);
  }

  /** The text node with the name (the first one with something written; Angular keeps updating it). */
  private nameNode(): Node | null {
    for (const child of Array.from(this.host.nativeElement.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim()) {
        return child;
      }
      if (child === this.wrapper) {
        return this.wrapper.firstChild;
      }
    }
    return null;
  }

  /** Builds the layer of letters over the name. */
  private make(node: Node, id: string, text: string, kind: string): void {
    const host = this.host.nativeElement;
    this.unmake(false);
    const wrapper = document.createElement('span');
    wrapper.className = 'nfx-orig';
    node.parentNode?.insertBefore(wrapper, node);
    wrapper.appendChild(node);
    const layer = document.createElement('span');
    layer.className = 'nfx-overlay';
    layer.setAttribute('aria-hidden', 'true');
    if (HALOS.has(id)) {
      const halo = document.createElement('span');
      halo.className = 'nfx-halo';
      halo.textContent = text;
      layer.appendChild(halo);
    }
    const letters = document.createElement('span');
    letters.className = 'nfx-letters';
    Array.from(text).forEach(function letter(char, index) {
      const piece = document.createElement('span');
      piece.className = 'nfx-l';
      piece.style.setProperty('--i', String(index));
      piece.textContent = char;
      letters.appendChild(piece);
    });
    layer.appendChild(letters);
    layer.addEventListener('animationiteration', this.iterated.bind(this));
    wrapper.appendChild(layer);
    this.wrapper = wrapper;
    this.layer = layer;
    this.made = id + '|' + text + '|' + kind;
    this.paintLetters(letters);
    lettered.add(this);
    watchWindow();
    this.resize?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(this.paintLetters.bind(this, letters));
      this.resize.observe(letters);
    }
    if (this.fxLive() && !this.watching) {
      this.watching = true;
      watchVisible(host, this.visible.bind(this));
    }
  }

  /** A name painted with a gradient: every letter paints its own part of it (a letter that moves cannot be cut out of the whole). */
  private paintLetters(letters: HTMLElement): void {
    const image = getComputedStyle(this.host.nativeElement).getPropertyValue('--name-image').trim();
    if (!image || image === 'none' || letters.scrollWidth === 0) {
      return;
    }
    this.layer?.classList.add('nfx-gradient');
    this.layer?.style.setProperty('--w', letters.scrollWidth + 'px');
    for (const piece of Array.from(letters.children) as HTMLElement[]) {
      piece.style.setProperty('--x', -piece.offsetLeft + 'px');
    }
  }

  /** Puts the name back as it was (and takes the letters away). */
  private unmake(forget = true): void {
    if (this.wrapper) {
      const node = this.wrapper.firstChild;
      if (node && this.wrapper.parentNode) {
        this.wrapper.parentNode.insertBefore(node, this.wrapper);
      }
      this.wrapper.remove();
    }
    this.resize?.disconnect();
    lettered.delete(this);
    this.clearFinishTimer();
    this.wrapper = null;
    this.layer = null;
    this.made = '';
    if (forget && this.watching) {
      this.watching = false;
      unwatchVisible(this.host.nativeElement);
      this.host.nativeElement.classList.remove('nfx-on');
    }
  }

  /** The pointer is over the name: the letters start (or go on, the ones that were resting). */
  protected enter(): void {
    this.stopping = false;
    this.clearFinishTimer();
    if (!this.armed) {
      this.armed = true;
      this.refresh();
    }
    this.host.nativeElement.classList.add('nfx-on');
    this.resume();
  }

  /** The pointer moved over the name after the letters were put at rest (the window had lost the focus): they start again. */
  protected over(): void {
    if (this.resting && this.armed) {
      this.enter();
    }
  }

  /** The pointer left: each letter finishes the turn it is in and rests there (and if one never ends it, all rest after a while). */
  protected leave(): void {
    if (!this.fxLive()) {
      this.stopping = true;
      this.clearFinishTimer();
      this.finishTimer = setTimeout(this.restIfAway.bind(this), FINISH_MS);
    }
  }

  /** The time to finish ran out: if the pointer is not back, every letter goes to rest where it started. */
  private restIfAway(): void {
    this.finishTimer = null;
    if (this.stopping && !this.host.nativeElement.matches(':hover')) {
      this.rest();
    }
  }

  private clearFinishTimer(): void {
    if (this.finishTimer !== null) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
  }

  /** The window lost the focus or was hidden. */
  suspend(): void {
    this.rest();
  }

  /** The window is back: names that play on their own, or are under the pointer, go on. */
  wake(): void {
    if (this.layer && (this.playing || this.host.nativeElement.matches(':hover'))) {
      this.stopping = false;
      this.resume();
    }
  }

  /**
   * Puts every letter back at rest, at the start of its movement (no animation, held there). ! This is the only way a letter
   * is left still other than at the end of its own turn, so a name can never stay half way through a jump or a flicker.
   */
  private rest(): void {
    this.clearFinishTimer();
    this.stopping = false;
    for (const piece of this.pieces()) {
      piece.style.animation = 'none';
      piece.style.animationPlayState = 'paused';
    }
    this.resting = this.layer !== null;
  }

  /** The letters (and the light) of this name. */
  private pieces(): HTMLElement[] {
    return Array.from(this.layer?.querySelectorAll<HTMLElement>('.nfx-l, .nfx-halo') ?? []);
  }

  /**
   * Lets every piece that was left resting go on.
   * ! The pieces rest at the end of their own turn, so they all stand at the start of it: if they simply went on they would
   *   move together (the delay of each letter, which made the wave of the name, was used up the first time). So when any
   *   piece was resting they all start again, with their delays, and the name moves as it did the first time.
   */
  private resume(): void {
    this.resting = false;
    const pieces = this.pieces();
    const rested = pieces.some(function isResting(piece) {
      return piece.style.animationPlayState === 'paused';
    });
    if (rested) {
      for (const piece of pieces) {
        piece.style.animation = 'none';
      }
      // reading the size makes the browser see the "none" before the animation comes back
      void this.layer?.offsetWidth;
    }
    for (const piece of pieces) {
      if (rested) {
        piece.style.animation = '';
      }
      piece.style.animationPlayState = '';
    }
  }

  /** A name that plays on its own does it while it is on the screen (up to a number of them at once). */
  private visible(on: boolean): void {
    const host = this.host.nativeElement;
    if (on && !this.playing && liveNow < MAX_LIVE) {
      this.playing = true;
      liveNow++;
      this.armed = true;
      this.refresh();
      host.classList.add('nfx-on');
      this.resume();
    } else if (!on && this.playing) {
      this.playing = false;
      liveNow--;
      if (!host.matches(':hover')) {
        host.classList.remove('nfx-on');
        this.rest();
      }
    }
  }

  /**
   * A piece (a letter or the light) ended a turn. If the pointer is gone this piece stops here, at rest: every letter is in a
   * different moment of its movement (they start one after another), so each one waits for its own end and none stays in
   * the air.
   */
  private iterated(event: Event): void {
    if (!this.stopping || !(event.target instanceof HTMLElement)) {
      return;
    }
    // the pointer may be over the name again (the page changed under it): then everything goes on
    if (this.host.nativeElement.matches(':hover')) {
      this.stopping = false;
      this.resume();
      return;
    }
    event.target.style.animationPlayState = 'paused';
  }
}
