/**
 * src/app/shared/util/name-fx.directive.ts
 * The animation of a name (the "nfx-*" classes of styles/chat.css): the person chooses one in their profile and it plays when
 * the pointer is over their name, and all the time in the chat (`fxLive`).
 * Use: `<span [nameFx]="u.nameFx" [fxLive]="true">`.
 */
import { Directive, computed, input } from '@angular/core';

/** The animations of a name, with what each one looks like (the profile shows these words). */
export const NAME_FX: { id: string; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'The name stays still.' },
  { id: 'float', label: 'Float', hint: 'It floats up and down, softly.' },
  { id: 'bounce', label: 'Bounce', hint: 'It hops.' },
  { id: 'pulse', label: 'Pulse', hint: 'It grows and shrinks like a heartbeat.' },
  { id: 'shake', label: 'Shake', hint: 'It trembles.' },
  { id: 'swing', label: 'Swing', hint: 'It swings like a sign.' },
  { id: 'glow', label: 'Glow', hint: 'A light that breathes around it.' },
  { id: 'neon', label: 'Neon', hint: 'A neon sign that flickers.' },
  { id: 'glitch', label: 'Glitch', hint: 'It breaks in colored copies.' },
  { id: 'flip', label: 'Flip', hint: 'It turns over now and then.' },
  { id: 'sparkle', label: 'Sparkle', hint: 'A star twinkles next to it.' },
];

/** The ids that exist (what comes from another person is only used when it is one of these). */
const KNOWN = new Set(
  NAME_FX.map(function id(fx) {
    return fx.id;
  }),
);

/** Puts the classes of the animation of a name on the element. */
@Directive({
  selector: '[nameFx]',
  standalone: true,
  host: { '[class]': 'fxClass()' },
})
export class NameFxDirective {
  readonly nameFx = input<string | null | undefined>('none');
  /** True where the animation plays all the time (the chat); elsewhere only under the pointer. */
  readonly fxLive = input(false);
  protected readonly fxClass = computed(this.pickClass.bind(this));

  /** The classes, or nothing when there is no animation (or the id is not one of ours). */
  private pickClass(): string {
    const id = this.nameFx();
    if (!id || id === 'none' || !KNOWN.has(id)) {
      return '';
    }
    return 'nfx nfx-' + id + (this.fxLive() ? ' nfx-live' : '');
  }
}
