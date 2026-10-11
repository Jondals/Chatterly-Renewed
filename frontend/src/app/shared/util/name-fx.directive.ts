/**
 * src/app/shared/util/name-fx.directive.ts
 * The animation of a name: the person chooses one in their profile and the LETTERS of their name move (they bounce, jump,
 * wave, wobble like jelly...) when the pointer is over the name, and all the time in the chat (`fxLive`) while the name is on
 * the screen.
 * Use: `<span [nameFx]="u.nameFx" [fxLive]="true">{{ u.displayName }}</span>`.
 *
 * * How it is made: the text of the name stays where it is (Angular keeps writing it), moved into a wrapper that is hidden but
 * keeps its width; over it goes a layer with one element per letter (styles/chat.css, "nfx-"). Only transform and opacity
 * move (the graphics chip does it, the page does not draw again), and a name that is off the screen does not move at all.
 * ? When the pointer leaves, the letters finish the movement they are in: the animation stops when the last letter ends it.
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
  { id: 'bounce', label: 'Bounce', hint: 'The letters crouch, spring up and land squashed.' },
  { id: 'jump', label: 'Jump', hint: 'Big leaps, one letter after another, with a twist.' },
  { id: 'wave', label: 'Wave', hint: 'The letters sway from side to side like a ribbon.' },
  { id: 'jelly', label: 'Jelly', hint: 'The letters wobble like jelly.' },
  { id: 'pop', label: 'Pop', hint: 'The letters pop up, one by one, with a rebound.' },
  { id: 'swing', label: 'Swing', hint: 'The letters hang and swing like a mobile.' },
  { id: 'flip', label: 'Flip', hint: 'The letters turn like coins.' },
  { id: 'glow', label: 'Glow', hint: 'A soft light breathes behind the name.' },
  { id: 'neon', label: 'Neon', hint: 'A neon sign that hums and flickers.' },
  { id: 'drift', label: 'Drift', hint: 'The letters float like leaves on the water.' },
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

/** Makes the letters of a name move. */
@Directive({
  selector: '[nameFx]',
  standalone: true,
  host: {
    '[class]': 'fxClass()',
    '(mouseenter)': 'enter()',
    '(mouseleave)': 'leave()',
  },
})
export class NameFxDirective implements AfterViewChecked, OnDestroy {
  readonly nameFx = input<string | null | undefined>('none');
  /** True where the animation plays all the time (the chat); elsewhere only under the pointer. */
  readonly fxLive = input(false);
  protected readonly fxClass = computed(this.pickClass.bind(this));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The wrapper that holds the real text of the name (hidden), and the layer of letters over it. */
  private wrapper: HTMLElement | null = null;
  private layer: HTMLElement | null = null;
  /** What the letters were made from (so they are made again only when it changes). */
  private made = '';
  private stopping = false;
  private watching = false;
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

  /** After every check of the view: the letters follow the text of the name. */
  ngAfterViewChecked(): void {
    const id = this.nameFx();
    if (!id || id === 'none' || !KNOWN.has(id)) {
      this.unmake();
      return;
    }
    const node = this.nameNode();
    const text = node?.textContent?.trim() ?? '';
    if (!node || !text) {
      this.unmake();
      return;
    }
    if (this.made === id + '|' + text && this.layer?.isConnected) {
      return;
    }
    this.make(node, id, text);
  }

  ngOnDestroy(): void {
    this.resize?.disconnect();
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
  private make(node: Node, id: string, text: string): void {
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
    this.made = id + '|' + text;
    this.paintLetters(letters);
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
    this.wrapper = null;
    this.layer = null;
    this.made = '';
    if (forget && this.watching) {
      this.watching = false;
      unwatchVisible(this.host.nativeElement);
      this.host.nativeElement.classList.remove('nfx-on');
    }
  }

  /** The pointer is over the name: the letters start. */
  protected enter(): void {
    this.stopping = false;
    this.host.nativeElement.classList.add('nfx-on');
  }

  /** The pointer left: the letters finish the movement they are in. */
  protected leave(): void {
    if (!this.fxLive()) {
      this.stopping = true;
    }
  }

  /** A name in the chat plays while it is on the screen. */
  private visible(on: boolean): void {
    this.host.nativeElement.classList.toggle('nfx-on', on);
  }

  /** The last letter ended a turn: if the pointer is gone, this is the moment to stop (all the letters are resting). */
  private iterated(event: Event): void {
    const last = this.layer?.querySelector('.nfx-letters')?.lastElementChild;
    if (this.stopping && (event.target === last || !last)) {
      this.stopping = false;
      // the pointer may be over the name again (the page changed under it): then the letters go on
      if (!this.host.nativeElement.matches(':hover')) {
        this.host.nativeElement.classList.remove('nfx-on');
      }
    }
  }
}
