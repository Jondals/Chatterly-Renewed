/**
 * src/app/shared/util/emoji-data.ts
 * The emoji list (names, tags, skin tones) in one language. It is a big file, so it is downloaded once, kept for the
 * rest of the session and can be asked for in advance while the browser is idle, which makes the picker open at once.
 */

/** One emoji of the list. */
export interface EmojiEntry {
  hexcode: string;
  unicode: string;
  label: string;
  tags?: string[];
  group?: number;
  skins?: { unicode: string }[];
}

/** One emoji of each version of Emoji that a browser may not know yet (it draws a box in place of what it does not know). */
const SAMPLES: [version: number, emoji: string][] = [
  [11, '\u{1F970}'],
  [12, '\u{1F971}'],
  [12.1, '\u{1F9D1}\u200D\u{1F9B0}'],
  [13, '\u{1F972}'],
  [13.1, '\u{1F62E}\u200D\u{1F4A8}'],
  [14, '\u{1FAE0}'],
  [15, '\u{1FAE8}'],
  [15.1, '\u{1F426}\u200D\u{1F525}'],
  [16, '\u{1FAE9}'],
];
/** The same order as the page: its own emoji font first (it is downloaded in pieces), then the one of the system. */
const EMOJI_FONT =
  '"Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", "Twemoji Mozilla", sans-serif';

/** The newest version of Emoji this browser draws (Infinity when it cannot be told: a protected canvas gives nothing to read). */
async function supportedVersion(): Promise<number> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 40;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return Infinity;
  }
  // the pieces of the emoji font that these emoji need are asked for before they are drawn
  await Promise.all(
    SAMPLES.map(function load([, emoji]) {
      return document.fonts.load('28px "Noto Color Emoji"', emoji).catch(function ignore() {
        return [];
      });
    }),
  );
  context.font = '28px ' + EMOJI_FONT;
  context.textBaseline = 'middle';
  const base = context.measureText('\u{1F600}').width;
  /** Whether an emoji is drawn as one colored picture (a box is gray, and a sequence that is not known is drawn in pieces). */
  const draws = function draws(emoji: string): boolean {
    if (context.measureText(emoji).width > base * 1.6) {
      return false;
    }
    context.clearRect(0, 0, 40, 40);
    context.fillText(emoji, 4, 20);
    const pixels = context.getImageData(0, 0, 40, 40).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! > 128) {
        const spread =
          Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) -
          Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
        if (spread > 24) {
          return true;
        }
      }
    }
    return false;
  };
  if (!draws('\u{1F600}')) {
    return Infinity;
  }
  let level = 10;
  for (const [version, emoji] of SAMPLES) {
    if (!draws(emoji)) {
      break;
    }
    level = version;
  }
  return level;
}

/** Leaves out the emoji of a version that this browser does not draw (they would show as empty boxes). */
async function onlyDrawn(list: EmojiEntry[]): Promise<EmojiEntry[]> {
  if (typeof document === 'undefined') {
    return list;
  }
  const level = await supportedVersion();
  if (level === Infinity || level >= 16) {
    return list;
  }
  const module = await import('emojibase-data/versions/emoji.json');
  const versions = ((module as { default?: unknown }).default ?? module) as Record<
    string,
    string[]
  >;
  const newer = new Set<string>();
  for (const [version, hexcodes] of Object.entries(versions)) {
    if (Number(version) > level) {
      for (const hexcode of hexcodes) {
        newer.add(hexcode);
      }
    }
  }
  return list.filter(function drawn(entry: EmojiEntry): boolean {
    return !newer.has(entry.hexcode);
  });
}

/** The lists already asked for, by language. */
const lists = new Map<string, Promise<EmojiEntry[]>>();

/** Downloads one list (never the "components" group, which holds only skin tone and hair modifiers). */
async function download(lang: string): Promise<EmojiEntry[]> {
  const module =
    lang === 'es'
      ? await import('emojibase-data/es/compact.json')
      : await import('emojibase-data/en/compact.json');
  const data = ((module as { default?: unknown }).default ?? module) as EmojiEntry[];
  return onlyDrawn(
    data.filter(function keep(entry: EmojiEntry): boolean {
      return entry.group !== undefined && entry.group !== 2;
    }),
  );
}

/** The emoji of a language (the same promise for every caller; a failed download can be asked for again). */
export function loadEmojiData(lang: string): Promise<EmojiEntry[]> {
  const key = lang === 'es' ? 'es' : 'en';
  let pending = lists.get(key);
  if (!pending) {
    pending = download(key);
    pending.catch(function forget(): void {
      lists.delete(key);
    });
    lists.set(key, pending);
  }
  return pending;
}

/** Asks for the list when the browser has nothing better to do, so the picker finds it ready. */
export function preloadEmojiData(lang: string): void {
  const ask = function ask(): void {
    void loadEmojiData(lang).catch(function ignore(): void {
      return undefined;
    });
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(ask, { timeout: 4000 });
  } else {
    setTimeout(ask, 2000);
  }
}
