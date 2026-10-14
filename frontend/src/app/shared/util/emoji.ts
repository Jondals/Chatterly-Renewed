/**
 * src/app/shared/util/emoji.ts
 * Emoji data and helpers: the quick reactions and the `:shortcodes:` that are turned into emoji before a
 * message is encrypted.
 */

/** The emoji offered first when reacting to a message. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '👀'];

/** :shortcodes: converted to emoji before a message is encrypted. */
const SHORTCODES: Record<string, string> = {
  smile: '😄',
  grin: '😁',
  joy: '😂',
  rofl: '🤣',
  wink: '😉',
  heart: '❤️',
  fire: '🔥',
  rocket: '🚀',
  tada: '🎉',
  thumbsup: '👍',
  '+1': '👍',
  thumbsdown: '👎',
  clap: '👏',
  pray: '🙏',
  eyes: '👀',
  thinking: '🤔',
  cry: '😢',
  sob: '😭',
  sunglasses: '😎',
  party: '🥳',
  skull: '💀',
  ghost: '👻',
  robot: '🤖',
  alien: '👽',
  star: '⭐',
  sparkles: '✨',
  zap: '⚡',
  lock: '🔒',
  key: '🔑',
  shield: '🛡️',
  check: '✅',
  x: '❌',
  warning: '⚠️',
  wave: '👋',
  ok: '👌',
  muscle: '💪',
  brain: '🧠',
  coffee: '☕',
  pizza: '🍕',
  beer: '🍺',
  cake: '🎂',
  gift: '🎁',
  music: '🎵',
  mic: '🎤',
  headphones: '🎧',
  gamepad: '🎮',
  trophy: '🏆',
  bulb: '💡',
  moon: '🌙',
  sun: '☀️',
  rainbow: '🌈',
  cat: '🐱',
  dog: '🐶',
  unicorn: '🦄',
  100: '💯',
  love: '😍',
  kiss: '😘',
  sleep: '😴',
  angry: '😠',
  shrug: '🤷',
  facepalm: '🤦',
};

/** Replaces every known `:shortcode:` of a text by its emoji (unknown ones are left as they are). */
export function replaceShortcodes(text: string): string {
  return text.replace(/:([a-z0-9_+-]{1,20}):/gi, function replaceOne(whole: string, name: string) {
    return SHORTCODES[name.toLowerCase()] ?? whole;
  });
}
