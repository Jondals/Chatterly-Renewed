/**
 * src/app/features/spinly/spinly-model.ts
 * The native Spinly of Chatterly: what a wheel or a tournament is (plain data that travels inside encrypted
 * messages and call signals) and how it is checked when it comes from somebody else. It is kept apart from the
 * rules that play it (spinly-engine.ts) because the message store needs only this part.
 */

/** The hidden reaction that runs the wheel or tournament of a message (it is never shown as a reaction). */
export const RUN_MARK = '⟦spinly:run⟧';
/** Most options (or participants) in one wheel or tournament. */
export const MAX_OPTIONS = 25;
/** Most participants in a tournament. */
export const MAX_PARTICIPANTS = 32;
/** Fewest options (or participants) that make a draw. */
export const MIN_OPTIONS = 2;
/** Longest option name on a wheel. */
export const MAX_OPTION_NAME = 20;
/** Longest participant name in a tournament. */
export const MAX_PARTICIPANT_NAME = 24;
/** Longest title. */
export const MAX_TITLE = 40;
/** Most themes and presets kept from a linked Spinly account. */
export const MAX_PROFILE_ITEMS = 40;
/** Most colors in one theme. */
export const MAX_THEME_COLORS = 12;

/** Spinly's palette, by name. */
export const PALETTE: Record<string, string> = {
  indigo: '#3730a3',
  coral: '#ff7d7d',
  amber: '#fbbf24',
  teal: '#2dd4bf',
  pink: '#f472b6',
  violet: '#a78bfa',
  sky: '#4dc3f7',
  mint: '#4ade80',
};
/** The palette names in the order new options receive them. */
export const PALETTE_NAMES = Object.keys(PALETTE);

/** The look of a wheel: sector colors (cycled) and the rim, hub, pointer and lights. */
export interface SpinlyTheme {
  name: string;
  segments: string[];
  border?: string;
  center?: string;
  pointer?: string;
  light?: string;
}

/** A name with its color (a palette name or #rrggbb). */
export interface SpecOption {
  name: string;
  color: string;
}

/** A wheel to spin. */
export interface WheelSpec {
  title: string;
  options: SpecOption[];
  theme?: SpinlyTheme;
}

/** How a tournament is played. */
export interface TournamentConfig {
  /** Best of how many spins each regular duel is played. */
  bestOf: number;
  /** Same for the final. */
  finalBestOf: number;
  /** equal: 50%. seed: the better seed gets a bigger slice of the duel wheel. */
  odds: 'equal' | 'seed';
  /** random: shuffled with drawSeed. order: as listed. */
  seeding: 'random' | 'order';
  /** A match for the third place. */
  thirdPlace: boolean;
  /** Shorter spins. */
  quickSpin: boolean;
}

/** A tournament to play. */
export interface TournamentSpec {
  title: string;
  config: TournamentConfig;
  participants: SpecOption[];
  /** Seeds the shuffle when seeding is random, so everybody draws the same bracket. */
  drawSeed: number;
  theme?: SpinlyTheme;
}

/** What is shared: a wheel or a tournament. */
export type SpinlyActivity =
  { kind: 'wheel'; wheel: WheelSpec } | { kind: 'tournament'; tournament: TournamentSpec };

/** A wheel preset of a linked Spinly account. */
export interface SpinlyPreset {
  name: string;
  options: SpecOption[];
  theme?: SpinlyTheme;
}

/** What Chatterly keeps from a linked Spinly account: its themes and presets (never its login). */
export interface SpinlyProfile {
  themes: SpinlyTheme[];
  presets: SpinlyPreset[];
  /** Whether the person was signed in to Spinly when it was linked. */
  signedIn: boolean;
  /** When it was linked or last refreshed. */
  linkedAt: number;
}

/** The default way a tournament is played. */
export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  bestOf: 3,
  finalBestOf: 5,
  odds: 'equal',
  seeding: 'random',
  thirdPlace: false,
  quickSpin: false,
};

// ---- checking data that comes from outside -------------------------------------------------

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True for plain objects. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collapses whitespace and trims a value to `max` characters; '' for anything that is not text. */
export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** A palette name or #rrggbb color; anything else becomes the fallback. */
export function cleanColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value in PALETTE || HEX_COLOR.test(value) ? value : fallback;
}

/** The value when it is a hex color, else undefined. */
function hexOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : undefined;
}

/** Validates a theme; null when it has no usable colors. */
export function sanitizeTheme(raw: unknown): SpinlyTheme | null {
  if (!isRecord(raw) || !Array.isArray(raw['segments'])) {
    return null;
  }
  const segments: string[] = [];
  for (const item of (raw['segments'] as unknown[]).slice(0, MAX_THEME_COLORS)) {
    const color = hexOrUndefined(item);
    if (color) {
      segments.push(color);
    }
  }
  if (segments.length === 0) {
    return null;
  }
  return {
    name: cleanText(raw['name'], MAX_TITLE) || 'Theme',
    segments,
    border: hexOrUndefined(raw['border']),
    center: hexOrUndefined(raw['center']),
    pointer: hexOrUndefined(raw['pointer']),
    light: hexOrUndefined(raw['light']),
  };
}

/** Validates a list of named colors; the names are cut to `max` characters and empty ones dropped. */
export function sanitizeOptions(raw: unknown, max: number, limit: number): SpecOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const options: SpecOption[] = [];
  for (const item of (raw as unknown[]).slice(0, limit)) {
    const entry = isRecord(item) ? item : {};
    const name = cleanText(entry['name'], max);
    if (name) {
      options.push({
        name,
        color: cleanColor(entry['color'], PALETTE_NAMES[options.length % PALETTE_NAMES.length]),
      });
    }
  }
  return options;
}

/** A whole number from `min` to `max`, or the fallback. */
function cleanInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

/** Validates how a tournament is played, falling back to the defaults field by field. */
export function sanitizeConfig(raw: unknown): TournamentConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    bestOf: cleanInt(source['bestOf'], 1, 10, DEFAULT_TOURNAMENT_CONFIG.bestOf),
    finalBestOf: cleanInt(source['finalBestOf'], 1, 10, DEFAULT_TOURNAMENT_CONFIG.finalBestOf),
    odds: source['odds'] === 'seed' ? 'seed' : 'equal',
    seeding: source['seeding'] === 'order' ? 'order' : 'random',
    thirdPlace: source['thirdPlace'] === true,
    quickSpin: source['quickSpin'] === true,
  };
}

/** Validates a wheel or a tournament that came from outside; null when it cannot be played. */
export function sanitizeActivity(raw: unknown): SpinlyActivity | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw['kind'] === 'wheel' && isRecord(raw['wheel'])) {
    const source = raw['wheel'];
    const options = sanitizeOptions(source['options'], MAX_OPTION_NAME, MAX_OPTIONS);
    if (options.length < MIN_OPTIONS) {
      return null;
    }
    const theme = sanitizeTheme(source['theme']) ?? undefined;
    return {
      kind: 'wheel',
      wheel: { title: cleanText(source['title'], MAX_TITLE), options, theme },
    };
  }
  if (raw['kind'] === 'tournament' && isRecord(raw['tournament'])) {
    const source = raw['tournament'];
    const participants = sanitizeOptions(
      source['participants'],
      MAX_PARTICIPANT_NAME,
      MAX_PARTICIPANTS,
    );
    if (participants.length < MIN_OPTIONS) {
      return null;
    }
    const drawSeed = source['drawSeed'];
    return {
      kind: 'tournament',
      tournament: {
        title: cleanText(source['title'], MAX_TITLE),
        config: sanitizeConfig(source['config']),
        participants,
        drawSeed: typeof drawSeed === 'number' && Number.isFinite(drawSeed) ? drawSeed >>> 0 : 1,
        theme: sanitizeTheme(source['theme']) ?? undefined,
      },
    };
  }
  return null;
}
