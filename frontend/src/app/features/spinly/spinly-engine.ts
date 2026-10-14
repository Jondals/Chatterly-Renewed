/**
 * src/app/features/spinly/spinly-engine.ts
 * The pure rules of the native Spinly: shared randomness, the wheel and the knockout tournament. Everybody who
 * receives the same data and the same seed gets the very same result, so a spin only has to be announced, never
 * described. This part is loaded only when a wheel or a tournament is actually shown.
 */
import {
  MAX_PROFILE_ITEMS,
  MAX_OPTIONS,
  MAX_OPTION_NAME,
  MAX_TITLE,
  MIN_OPTIONS,
  PALETTE,
  PALETTE_NAMES,
  cleanText,
  isRecord,
  sanitizeActivity,
  sanitizeOptions,
  sanitizeTheme,
  type SpecOption,
  type SpinlyActivity,
  type SpinlyPreset,
  type SpinlyProfile,
  type SpinlyTheme,
  type TournamentConfig,
  type TournamentSpec,
} from './spinly-model';

/** The two themes every Spinly has, available without linking an account. */
export const BUILT_IN_THEMES: SpinlyTheme[] = [
  {
    name: 'Obsidian Flow',
    segments: ['#0b0f19', '#1e1b4b', '#3730a3', '#6366f1', '#c7d2fe'],
    pointer: '#a5b4fc',
    light: '#818cf8',
  },
  {
    name: 'Neon Nights',
    segments: ['#22d3ee', '#f472b6', '#a855f7', '#3b82f6', '#ec4899'],
    pointer: '#22d3ee',
    light: '#f472b6',
  },
];

/** Validates the account data that Spinly hands over when it is linked; null when it is not an object. */
export function sanitizeProfile(raw: unknown, signedIn: boolean): SpinlyProfile | null {
  if (!isRecord(raw)) {
    return null;
  }
  const themes: SpinlyTheme[] = [];
  if (Array.isArray(raw['themes'])) {
    for (const item of (raw['themes'] as unknown[]).slice(0, MAX_PROFILE_ITEMS)) {
      const theme = sanitizeTheme(item);
      if (theme) {
        themes.push(theme);
      }
    }
  }
  const presets: SpinlyPreset[] = [];
  if (Array.isArray(raw['presets'])) {
    for (const item of (raw['presets'] as unknown[]).slice(0, MAX_PROFILE_ITEMS)) {
      if (!isRecord(item)) {
        continue;
      }
      const options = sanitizeOptions(item['options'], MAX_OPTION_NAME, MAX_OPTIONS);
      if (options.length >= MIN_OPTIONS) {
        presets.push({
          name: cleanText(item['name'], MAX_TITLE) || 'Preset',
          options,
          theme: sanitizeTheme(item['theme']) ?? undefined,
        });
      }
    }
  }
  return { themes, presets, signedIn, linkedAt: Date.now() };
}

// ---- shared randomness ---------------------------------------------------------------------

/** A number from a text (FNV-1a), used to turn ids into seeds. */
export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A generator of numbers from 0 up to (not including) 1 that always gives the same series for the same seed. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  /** The next number of the series (mulberry32). */
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return next;
}

/** A fresh seed for a spin started on this device. */
export function freshSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0];
}

// ---- the wheel -----------------------------------------------------------------------------

/** Where a spin ends: which sector, the angle that ends under the pointer and how many extra turns it makes. */
export interface WheelPlan {
  index: number;
  land: number;
  turns: number;
}

/** Plans a spin of a wheel with `count` equal sectors from a seed: the winner and a point inside its sector. */
export function planWheel(count: number, seed: number): WheelPlan {
  const random = makeRandom(seed);
  const index = Math.min(count - 1, Math.floor(random() * count));
  const size = 360 / count;
  const margin = size * 0.12;
  return {
    index,
    land: index * size + margin + random() * (size - 2 * margin),
    turns: 5 + Math.floor(random() * 3),
  };
}

const PALETTE_NAMES_LIST = PALETTE_NAMES.map(function toHex(name) {
  return PALETTE[name];
});

/** The color of sector `index`: the option's own (the window bakes the theme into it), else the theme's cycled, else the palette's. */
export function sectorColor(
  option: SpecOption | undefined,
  index: number,
  theme: SpinlyTheme | undefined,
): string {
  if (option?.color) {
    return PALETTE[option.color] ?? option.color;
  }
  if (theme && theme.segments.length > 0) {
    return theme.segments[index % theme.segments.length];
  }
  return PALETTE_NAMES_LIST[index % PALETTE_NAMES_LIST.length];
}

/** Whether a color is light enough to need dark text on it. */
export function isLightColor(color: string): boolean {
  let hex = color.startsWith('#') ? color.slice(1) : '';
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) {
    return false;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

// ---- the tournament ------------------------------------------------------------------------

type Side = 'a' | 'b';

/** A participant with the place the draw gave them (1 = top seed). */
interface Participant {
  id: string;
  name: string;
  color: string;
  seed: number;
}

/** One spin of a duel, or a duel awarded without spinning. */
interface TournamentEvent {
  match: string;
  winner: Side;
  forced: boolean;
}

/** A spin of the tournament as it is shared: the seed that decides it (or the side awarded). */
export interface TournamentSpin {
  seed: number;
  forced?: Side;
}

/** One duel of the bracket. */
export interface Match {
  id: string;
  round: number;
  slot: number;
  third: boolean;
  a: string | null;
  b: string | null;
  winsA: number;
  winsB: number;
  winner: string | null;
  loser: string | null;
  bye: boolean;
  bestOf: number;
}

/** The bracket rebuilt from the participants and the spins so far. */
interface Bracket {
  rounds: Match[][];
  third: Match | null;
  /** The duel to play now; null once there is a champion. */
  current: Match | null;
  champion: string | null;
  playable: number;
  decided: number;
}

/** What a spin of the tournament did, ready to be animated. */
interface ResolvedSpin {
  match: string;
  /** Who was on each side. */
  a: string;
  b: string;
  winner: Side;
  forced: boolean;
  /** Probability that A wins. */
  probability: number;
  land: number;
  turns: number;
}

/** A tournament played as far as its spins go. */
export interface TournamentState {
  participants: Participant[];
  bracket: Bracket;
  spins: ResolvedSpin[];
}

/** Spin wins needed to take a best-of-N duel. */
function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/** Smallest power of two that fits n participants (at least 2). */
function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, n)));
}

/** Classic seeding order: for an 8-slot bracket, [1, 8, 4, 5, 2, 7, 3, 6]. */
function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    const doubled: number[] = [];
    for (const seed of order) {
      doubled.push(seed, next - seed);
    }
    order = doubled;
  }
  return order;
}

/** Gives each participant a seed: in the listed order, or shuffled from the draw seed. */
function seedParticipants(spec: TournamentSpec): Participant[] {
  const list = spec.participants.slice();
  if (spec.config.seeding === 'random') {
    const random = makeRandom(spec.drawSeed);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const keep = list[i];
      list[i] = list[j];
      list[j] = keep;
    }
  }
  return list.map(function toParticipant(entry, index) {
    return { id: 'p' + index, name: entry.name, color: entry.color, seed: index + 1 };
  });
}

/** An empty match slot of the bracket. */
function emptyMatch(id: string, round: number, slot: number, bestOf: number, third = false): Match {
  return {
    id,
    round,
    slot,
    third,
    a: null,
    b: null,
    winsA: 0,
    winsB: 0,
    winner: null,
    loser: null,
    bye: false,
    bestOf,
  };
}

/** Every match in play order: round by round, with the third-place match right before the final. */
function playOrder(bracket: Pick<Bracket, 'rounds' | 'third'>): Match[] {
  const { rounds, third } = bracket;
  return [...rounds.slice(0, -1).flat(), ...(third ? [third] : []), rounds[rounds.length - 1][0]];
}

/** Rebuilds the bracket from the participants and the spins played so far. */
function buildBracket(
  participants: Participant[],
  config: TournamentConfig,
  events: TournamentEvent[],
): Bracket {
  const size = nextPowerOfTwo(participants.length);
  const roundCount = Math.log2(size);
  const bySeed = new Map<number, string>();
  for (const participant of participants) {
    bySeed.set(participant.seed, participant.id);
  }
  const rounds: Match[][] = [];
  for (let round = 0; round < roundCount; round++) {
    const count = size / 2 ** (round + 1);
    const bestOf = round === roundCount - 1 ? config.finalBestOf : config.bestOf;
    const row: Match[] = [];
    for (let slot = 0; slot < count; slot++) {
      row.push(emptyMatch('r' + round + 'm' + slot, round, slot, bestOf));
    }
    rounds.push(row);
  }
  const third =
    config.thirdPlace && roundCount >= 2
      ? emptyMatch('third', roundCount - 1, 1, config.bestOf, true)
      : null;
  const order = seedOrder(size);
  for (let slot = 0; slot < rounds[0].length; slot++) {
    rounds[0][slot].a = bySeed.get(order[slot * 2]) ?? null;
    rounds[0][slot].b = bySeed.get(order[slot * 2 + 1]) ?? null;
  }

  /** Moves the winner (and, in the semifinals, the loser to the third-place match) to the next slot. */
  function advance(match: Match): void {
    if (match.third || !match.winner) {
      return;
    }
    const next = rounds[match.round + 1]?.[Math.floor(match.slot / 2)];
    if (next) {
      if (match.slot % 2 === 0) {
        next.a = match.winner;
      } else {
        next.b = match.winner;
      }
    }
    if (third && match.round === roundCount - 2 && match.loser) {
      if (match.slot % 2 === 0) {
        third.a = match.loser;
      } else {
        third.b = match.loser;
      }
    }
  }

  /** Marks a match as decided in favour of one side. */
  function settle(match: Match, winner: Side): void {
    match.winner = winner === 'a' ? match.a : match.b;
    match.loser = winner === 'a' ? match.b : match.a;
  }

  for (const match of rounds[0]) {
    if (match.a && !match.b) {
      match.bye = true;
      match.winner = match.a;
    } else if (!match.a && match.b) {
      match.bye = true;
      match.winner = match.b;
    }
    advance(match);
  }

  const all = [...rounds.flat(), ...(third ? [third] : [])];
  const byId = new Map<string, Match>();
  for (const match of all) {
    byId.set(match.id, match);
  }
  for (const event of events) {
    const match = byId.get(event.match);
    if (!match || match.winner || !match.a || !match.b) {
      continue;
    }
    if (event.forced) {
      settle(match, event.winner);
    } else {
      if (event.winner === 'a') {
        match.winsA += 1;
      } else {
        match.winsB += 1;
      }
      const need = winsNeeded(match.bestOf);
      if (match.winsA >= need) {
        settle(match, 'a');
      } else if (match.winsB >= need) {
        settle(match, 'b');
      }
    }
    advance(match);
  }

  const queue = playOrder({ rounds, third });
  const current =
    queue.find(function isOpen(match) {
      return !match.winner && match.a !== null && match.b !== null;
    }) ?? null;
  let playable = 0;
  let decided = 0;
  for (const match of queue) {
    if (!match.bye) {
      playable += 1;
      if (match.winner) {
        decided += 1;
      }
    }
  }
  return {
    rounds,
    third,
    current,
    champion: rounds[roundCount - 1][0].winner,
    playable,
    decided,
  };
}

/** Probability that side A wins each spin of a duel. */
function probabilityA(participants: Participant[], config: TournamentConfig, match: Match): number {
  if (config.odds === 'equal' || !match.a || !match.b) {
    return 0.5;
  }
  const total = participants.length;
  /** Strength used for the odds: the better the seed, the higher. */
  function strength(id: string | null): number {
    const found = participants.find(function byId(p) {
      return p.id === id;
    });
    return total + 1 - (found ? found.seed : total);
  }
  return strength(match.a) / (strength(match.a) + strength(match.b));
}

/**
 * Where each side sits on the duel wheel, in degrees clockwise from the top. B takes the first part and A the
 * rest, so with even odds the wheel matches the scoreboard (A on the left, B on the right).
 */
function duelSplit(probability: number): number {
  return 360 * (1 - probability);
}

/** Plays a spin of a duel from its seed: who wins and the angle that ends under the pointer. */
function playDuel(
  probability: number,
  seed: number,
): { winner: Side; land: number; turns: number } {
  const random = makeRandom(seed);
  const winner: Side = random() < probability ? 'a' : 'b';
  const split = duelSplit(probability);
  const from = winner === 'a' ? split : 0;
  const to = winner === 'a' ? 360 : split;
  const margin = (to - from) * 0.12;
  return {
    winner,
    land: from + margin + random() * (to - from - 2 * margin),
    turns: 5 + Math.floor(random() * 3),
  };
}

/** Plays a tournament as far as its spins go (spins that do not fit the bracket are ignored). */
export function resolveTournament(spec: TournamentSpec, spins: TournamentSpin[]): TournamentState {
  const participants = seedParticipants(spec);
  const events: TournamentEvent[] = [];
  const resolved: ResolvedSpin[] = [];
  let bracket = buildBracket(participants, spec.config, events);
  for (const spin of spins) {
    const match = bracket.current;
    if (!match || !match.a || !match.b) {
      break;
    }
    const probability = probabilityA(participants, spec.config, match);
    if (spin.forced) {
      events.push({ match: match.id, winner: spin.forced, forced: true });
      resolved.push({
        match: match.id,
        a: match.a,
        b: match.b,
        winner: spin.forced,
        forced: true,
        probability,
        land: 0,
        turns: 0,
      });
    } else {
      const duel = playDuel(probability, spin.seed);
      events.push({ match: match.id, winner: duel.winner, forced: false });
      resolved.push({
        match: match.id,
        a: match.a,
        b: match.b,
        winner: duel.winner,
        forced: false,
        probability,
        land: duel.land,
        turns: duel.turns,
      });
    }
    bracket = buildBracket(participants, spec.config, events);
  }
  return { participants, bracket, spins: resolved };
}

/** The spins that play a whole tournament from one shared seed (the chat card runs it all at once). */
export function autoSpins(spec: TournamentSpec, runSeed: number): TournamentSpin[] {
  const spins: TournamentSpin[] = [];
  let state = resolveTournament(spec, spins);
  while (state.bracket.current && spins.length < 400) {
    spins.push({ seed: hashSeed(runSeed + ':' + spins.length) });
    state = resolveTournament(spec, spins);
  }
  return spins;
}

/** The podium names of a finished tournament (champion, runner-up and, when played, third place). */
export function podium(state: TournamentState): string[] {
  const { bracket, participants } = state;
  if (!bracket.champion) {
    return [];
  }
  /** The name of a participant by id. */
  function nameOf(id: string | null): string {
    return (
      participants.find(function byId(p) {
        return p.id === id;
      })?.name ?? ''
    );
  }
  const final = bracket.rounds[bracket.rounds.length - 1][0];
  const names = [nameOf(final.winner), nameOf(final.loser)];
  if (bracket.third?.winner) {
    names.push(nameOf(bracket.third.winner));
  }
  return names.filter(Boolean);
}

/** Name of a round from how many matches it has until the final. */
export function roundName(round: number, roundCount: number, third: boolean): string {
  if (third) {
    return 'Third place';
  }
  const matches = 2 ** (roundCount - round - 1);
  if (matches === 1) {
    return 'Final';
  }
  if (matches === 2) {
    return 'Semifinals';
  }
  if (matches === 4) {
    return 'Quarterfinals';
  }
  return matches === 8 ? 'Round of 16' : 'Round of 32';
}

// ---- the wheel or tournament of a call -----------------------------------------------------

/** What a call is spinning right now. Everybody in the call keeps a copy and the newest change wins. */
export interface CallSpinState {
  /** Grows with every change, so the newest copy can be told apart. */
  rev: number;
  /** Who made the change (breaks a tie between two changes made at the same time). */
  by: string;
  /** The wheel or tournament; null once somebody closed it. */
  activity: SpinlyActivity | null;
  /** How many times the wheel has been spun since it was set up. */
  spinSeq: number;
  /** Seed of the latest wheel spin. */
  seed: number;
  /** The spins of the tournament so far. */
  spins: TournamentSpin[];
}

/** Validates the state of a call's wheel that came from another person; null when it is not usable. */
export function sanitizeCallState(raw: unknown): CallSpinState | null {
  if (!isRecord(raw)) {
    return null;
  }
  const rev = raw['rev'];
  const by = raw['by'];
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0 || typeof by !== 'string') {
    return null;
  }
  const activity = raw['activity'] === null ? null : sanitizeActivity(raw['activity']);
  if (raw['activity'] !== null && !activity) {
    return null;
  }
  const spins: TournamentSpin[] = [];
  if (Array.isArray(raw['spins'])) {
    for (const item of (raw['spins'] as unknown[]).slice(0, 400)) {
      if (isRecord(item) && typeof item['seed'] === 'number' && Number.isFinite(item['seed'])) {
        spins.push({
          seed: item['seed'] >>> 0,
          forced: item['forced'] === 'a' || item['forced'] === 'b' ? item['forced'] : undefined,
        });
      }
    }
  }
  const spinSeq = raw['spinSeq'];
  const seed = raw['seed'];
  return {
    rev,
    by: by.slice(0, 64),
    activity,
    spinSeq: typeof spinSeq === 'number' && Number.isInteger(spinSeq) && spinSeq >= 0 ? spinSeq : 0,
    seed: typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : 0,
    spins,
  };
}

/** Whether a received state is newer than the one held. */
export function isNewer(incoming: CallSpinState, held: CallSpinState | null): boolean {
  if (!held) {
    return true;
  }
  return incoming.rev > held.rev || (incoming.rev === held.rev && incoming.by > held.by);
}
