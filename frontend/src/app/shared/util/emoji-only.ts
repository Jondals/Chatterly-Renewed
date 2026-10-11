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
  ['skull', /^[💀☠👻]/u],
  ['star', /^[⭐🌟✨💫]/u],
  ['cool', /^[😎🕶😏🤨]/u],
  ['angry', /^[😡😠🤬👿]/u],
  ['pray', /^[🙏]/u],
  ['muscle', /^[💪]/u],
];

/** Which animation a lone emoji has: its kind ("heart", "kiss"...) or "default" for the common hop. */
export function emojiMood(text: string): string {
  const first = text.trim();
  for (const [id, pattern] of MOODS) {
    if (pattern.test(first)) {
      return id;
    }
  }
  return 'default';
}
