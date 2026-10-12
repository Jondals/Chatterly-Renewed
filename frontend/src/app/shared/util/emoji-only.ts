/**
 * src/app/shared/util/emoji-only.ts
 * Detects a message that is only a few emoji (up to ten), which the chat draws big (like WhatsApp does): the fewer, the bigger.
 */

/** One emoji: a pictographic character with an optional variation selector or skin tone, joined with others by ZWJ. */
const EMOJI =
  /^(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*){1,10}$/u;

/** True when the text (ignoring spaces at both ends) is only one to ten emoji. */
export function isOnlyEmoji(text: string): boolean {
  return EMOJI.test(text.trim());
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
