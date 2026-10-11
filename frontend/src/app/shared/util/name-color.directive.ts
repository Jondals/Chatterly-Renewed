/**
 * src/app/shared/util/name-color.directive.ts
 * Paints a name with a solid color or a gradient, as chosen in the profile.
 */
import { Directive, computed, input } from '@angular/core';
import {
  encodeMulti,
  gradientCss,
  legacyStops,
  parseMulti,
  sortedStops,
  type GradientParts,
} from './gradient';

/** The older gradient format: "g:#from,#to,angle" plus, optionally, ",start,end" and ",#mid" (a third color). */
const LEGACY =
  /^g:(#[0-9a-f]{6}),(#[0-9a-f]{6}),(\d{1,3})(?:,(\d{1,3}),(\d{1,3})(?:,(#[0-9a-f]{6}))?)?$/i;

/** The parts of a name color. */
export interface NameColorParts extends GradientParts {
  /** The first color (the only one when it is solid). */
  from: string;
  gradient: boolean;
}

/** Splits a stored name color: "#rrggbb" (solid), "m:angle:100:#color@place,..." or an older "g:" gradient; null when it is none. */
export function parseNameColor(value: string): NameColorParts | null {
  const multi = parseMulti(value);
  if (multi) {
    return {
      from: sortedStops(multi.stops)[0]!.color,
      angle: multi.angle,
      stops: multi.stops,
      gradient: true,
    };
  }
  const match = LEGACY.exec(value);
  if (match) {
    return {
      from: match[1]!,
      angle: Math.min(360, +match[3]!),
      stops: legacyStops(
        match[1]!,
        match[2]!,
        match[4] === undefined ? 0 : Math.min(100, +match[4]),
        match[5] === undefined ? 100 : Math.min(100, +match[5]),
        match[6] ?? '',
      ),
      gradient: true,
    };
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return { from: value, angle: 90, stops: legacyStops(value, value, 0, 100), gradient: false };
  }
  return null;
}

/** Turns the parts of a name color back into the stored text. */
export function encodeNameColor(parts: NameColorParts): string {
  return parts.gradient ? encodeMulti(parts.angle, 100, parts.stops) : parts.from;
}

/**
 * Paints the text of a name with the color or gradient chosen in the profile.
 * Use: `<span [appNameColor]="user.profileColor" fallback="var(--fg)">`.
 */
@Directive({
  selector: '[appNameColor]',
  standalone: true,
  host: {
    '[style.color]': 'color()',
    '[style.background-image]': 'image()',
    '[style.background-clip]': 'image() ? "text" : null',
    '[style.-webkit-background-clip]': 'image() ? "text" : null',
    '[style.--fx-color]': 'light()',
    '[style.--name-color]': 'solid()',
    '[style.--name-image]': 'image()',
  },
})
export class NameColorDirective {
  readonly appNameColor = input<string | null | undefined>('');
  readonly fallback = input<string | null>(null);
  private readonly parsed = computed(this.readColor.bind(this));
  protected readonly image = computed(this.computeImage.bind(this));
  protected readonly color = computed(this.computeColor.bind(this));
  /** The plain color of the letters when the name moves (null over a gradient: every letter paints its part of it). */
  protected readonly solid = computed(this.computeSolid.bind(this));
  /** The color the animations of the name shine with (the first color: over a gradient the text itself is transparent). */
  protected readonly light = computed(this.computeLight.bind(this));

  /** The parts of the chosen color. */
  private readColor(): NameColorParts | null {
    return parseNameColor(this.appNameColor() ?? '');
  }

  /** The gradient drawn behind the text (null for a solid color). */
  private computeImage(): string | null {
    const parts = this.parsed();
    return parts && parts.gradient ? gradientCss(parts) : null;
  }

  /** The plain color of the text, when it has one. */
  private computeSolid(): string | null {
    const parts = this.parsed();
    if (parts) {
      return parts.gradient ? null : parts.from;
    }
    return this.fallback();
  }

  /** The color of the light of an animation of the name. */
  private computeLight(): string | null {
    return this.parsed()?.from ?? this.fallback();
  }

  /** The text color: transparent over a gradient, the solid color, or the fallback. */
  private computeColor(): string | null {
    const parts = this.parsed();
    if (parts) {
      return parts.gradient ? 'transparent' : parts.from;
    }
    return this.fallback();
  }
}
