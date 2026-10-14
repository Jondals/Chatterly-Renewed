/**
 * src/app/shared/util/gradient.ts
 * The gradients of the profile (banner and name): from two to five colors, each one with its own place on the line,
 * and an angle. They are stored as "m:angle:opacity:#color@place,#color@place,..." (the older formats with two colors
 * are still read).
 */

/** One color of a gradient and where it sits on the line (0-100). */
export interface Stop {
  color: string;
  pos: number;
}

/** The parts every gradient has. */
export interface GradientParts {
  angle: number;
  stops: Stop[];
}

/** The most colors a gradient can have. */
const MAX_STOPS = 5;

const MULTI = /^m:(\d{1,3}):(\d{1,3}):((?:#[0-9a-f]{6}@\d{1,3})(?:,#[0-9a-f]{6}@\d{1,3}){1,4})$/i;

/** The stops in order along the line, as the CSS wants them. */
export function sortedStops(stops: Stop[]): Stop[] {
  return [...stops].sort(function byPlace(a, b) {
    return a.pos - b.pos;
  });
}

/** The CSS of a gradient. */
export function gradientCss(parts: GradientParts): string {
  const list = sortedStops(parts.stops).map(function css(stop) {
    return stop.color + ' ' + Math.max(0, Math.min(100, Math.round(stop.pos))) + '%';
  });
  return 'linear-gradient(' + parts.angle + 'deg, ' + list.join(', ') + ')';
}

/** Reads the stored "m:" format; null when the text is something else. */
export function parseMulti(
  value: string,
): { angle: number; opacity: number; stops: Stop[] } | null {
  const match = MULTI.exec(value);
  if (!match) {
    return null;
  }
  const stops = match[3]!.split(',').map(function read(item): Stop {
    const [color, pos] = item.split('@');
    return { color: color!, pos: Math.min(100, +pos!) };
  });
  return { angle: Math.min(360, +match[1]!), opacity: Math.min(100, +match[2]!), stops };
}

/** Writes the stored "m:" format. */
export function encodeMulti(angle: number, opacity: number, stops: Stop[]): string {
  const list = stops.slice(0, MAX_STOPS).map(function write(stop) {
    return stop.color + '@' + Math.round(Math.max(0, Math.min(100, stop.pos)));
  });
  return 'm:' + Math.round(angle) + ':' + Math.round(opacity) + ':' + list.join(',');
}

/** The stops of an older gradient: two colors, maybe one in the middle, between where it starts and ends. */
export function legacyStops(
  from: string,
  to: string,
  start: number,
  end: number,
  mid = '',
): Stop[] {
  const stops: Stop[] = [{ color: from, pos: start }];
  if (mid) {
    stops.push({ color: mid, pos: Math.round((start + end) / 2) });
  }
  stops.push({ color: to, pos: end });
  return stops;
}
