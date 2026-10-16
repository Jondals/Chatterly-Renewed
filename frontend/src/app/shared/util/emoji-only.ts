/**
 * src/app/shared/util/emoji-only.ts
 * Detects a message that is only emoji (spaces between them are fine), which the chat draws big and without a bubble
 * (like WhatsApp does): the fewer, the bigger.
 */

/**
 * One emoji: a pictographic character with an optional variation selector or skin tone, joined with others by ZWJ; or a
 * flag (two regional letters, or a black flag with tag letters, like Scotland); or a keycap (a digit, # or * with the
 * keycap mark).
 */
const ONE =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)/u
    .source;

/** Invisible marks that some keyboards leave around emoji (zero-width space, word joiner, text-style selector...). */
const INVISIBLE = /[\u200B\u200C\u2060\uFE0E\uFEFF]/gu;

/** The text without the invisible marks and the spaces around it. */
function bare(text: string): string {
  return text.replace(INVISIBLE, '').trim();
}

/** Only emoji, as many as there are, with any spaces between them. */
const EMOJI = new RegExp('^' + ONE + '(?:\\s*' + ONE + ')*$', 'u');

/** Splits a text into what a person sees as characters (an emoji with its skin tone or a family is one). */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** How many emoji (graphemes that are not spaces) a text has. */
export function emojiCountOf(text: string): number {
  let count = 0;
  for (const part of GRAPHEMES.segment(bare(text))) {
    if (part.segment.trim()) {
      count++;
    }
  }
  return count;
}

/** True when the text (ignoring spaces) is only emoji, however many: it never gets a bubble. */
export function isOnlyEmoji(text: string): boolean {
  const trimmed = bare(text);
  return trimmed.length > 0 && EMOJI.test(trimmed);
}

/** The kinds of emoji that have their own little animation when they are alone in a message (the first one counts). */
const MOODS: [string, RegExp][] = [
  ['kiss', /^[😘😗😙😚💋]/u],
  ['love', /^[😍🥰😻🤩😽🫶💑]/u],
  ['heart', /^[❤💖💗💓💕💞💘💝🧡💛💚💙💜🖤🤍🤎💟❣]/u],
  ['laugh', /^[😂🤣😹😆😄😁😀😃]/u],
  ['cry', /^[😭😢🥺😿😥😰]/u],
  ['fire', /^[🔥💥⚡]/u],
  ['thumb', /^[👍👌🤝✅💯]/u],
  ['clap', /^[👏🙌]/u],
  ['wave', /^[👋🤚🖐✋]/u],
  ['party', /^[🎉🥳🎊🎂🍾]/u],
  ['gasp', /^[😮😱😲🤯😳😧]/u],
  ['sleep', /^[😴💤🥱]/u],
  ['skull', /^[💀☠]/u],
  ['float', /^[👻👽🎈🛸🫧]/u],
  ['star', /^[⭐🌟✨💫]/u],
  ['cool', /^[😎🕶😏🤨]/u],
  ['angry', /^[😡😠🤬👿]/u],
  ['pray', /^[🙏]/u],
  ['muscle', /^[💪]/u],
  ['peace', /^[✌🤞🤟🤘🤙👊✊🫡]/u],
  ['look', /^[👀🙄]/u],
  ['think', /^[🤔🧐🤨🤷]/u],
  ['launch', /^[🚀🛩✈🛫]/u],
  ['drive', /^[🚗🚕🚙🏎🚓🚑🚒🚚🏍🚲🛵🚂🚌]/u],
  ['sun', /^[☀🌞🌝🌕🌙]/u],
  ['sway', /^[🌸🌹🌷🌼🌻🌺🍀🌿🌱🍃🍂🍁🌾☁🌧⛈❄☃🌈]/u],
  ['gift', /^[🎁🧧📦💌]/u],
  ['coin', /^[💰💸🤑🪙💎]/u],
  ['dance', /^[🎵🎶🎤🎧🎸🥁🎹🎺🎻💃🕺]/u],
  ['yum', /^[😋🤤🍕🍔🍟🌭🍿🥓🍩🍪🍫🍦🍰🍎🍓🍒🍉🍌🍇🥑🌮🍣🍜🍺🍻🥂☕🍷]/u],
  ['critter', /^[🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦆🦉🐺🦄🐝🦋🐢🐙🐬🐳🦈🐍🐲🐉]/u],
  ['poop', /^[💩]/u],
];

/** The calm movements a lone emoji with no kind of its own can have: one is picked per message, so they do not all look alike. */
const GENERIC = ['hop', 'jelly', 'swing', 'wobble'];

/**
 * Which animation a lone emoji has: its kind ("heart", "kiss", "critter"...) or, when it has none, one of a few general
 * movements chosen from the seed (the id of the message), so the same emoji does not always move the same way.
 */
export function emojiMood(text: string, seed = ''): string {
  const first = text.trim();
  for (const [id, pattern] of MOODS) {
    if (pattern.test(first)) {
      return id;
    }
  }
  let hash = 0;
  for (const char of seed || first) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return GENERIC[hash % GENERIC.length];
}
