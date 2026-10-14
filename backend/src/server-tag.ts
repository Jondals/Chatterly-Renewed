/**
 * src/server-tag.ts
 * The tag of a group ("server tag"): a short mark (up to four letters or numbers, a color and a small icon) that the owner of
 * a group makes, and that every member may choose to show next to their name, or not.
 *
 * * What a person shows is kept on their own row (`server_tag`, already written as the public object) so that every place that
 * sends a user also sends the tag without another query; the functions here keep it true when the group or the member changes.
 */
import type { Db } from './db';

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** One emoji: a flag, a keycap, a pictograph with its skin tone or variation selector, joined with others by ZWJ, or a tag flag. */
const ONE_EMOJI =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Extended_Pictographic}[\u{E0020}-\u{E007F}]+)$/u;

/**
 * True when the value is a valid icon for a tag: nothing (no icon) or exactly ONE emoji, any emoji.
 * ! This is what keeps text, markup or a long string out of a place that every member sees next to a name.
 */
export function isTagIcon(value: string): boolean {
  if (value === '') return true;
  if (value.length > 32) return false;
  return [...GRAPHEMES.segment(value)].length === 1 && ONE_EMOJI.test(value);
}

/** What the browser gets about the tag of a person. */
export interface ServerTag {
  guildId: string;
  text: string;
  color: string;
  icon: string;
}

/** Reads the tag written on a row of a user (null when there is none or it is damaged). */
export function parseServerTag(raw: string): ServerTag | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ServerTag;
    return typeof value.text === 'string' && typeof value.guildId === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Writes the tag a person shows from the group they chose (clearing it when that group has no tag or they are not in it). */
export function refreshServerTag(db: Db, userId: string): void {
  const chosen = db.prepare('SELECT tag_guild FROM users WHERE id = ?').get(userId) as
    { tag_guild: string | null } | undefined;
  if (!chosen) return;
  let written = '';
  if (chosen.tag_guild) {
    const row = db
      .prepare(
        `SELECT g.id, g.tag_text, g.tag_color, g.tag_icon FROM guilds g
           JOIN guild_members m ON m.guild_id = g.id AND m.user_id = ?
          WHERE g.id = ? AND g.tag_text <> ''`,
      )
      .get(userId, chosen.tag_guild) as
      { id: string; tag_text: string; tag_color: string; tag_icon: string } | undefined;
    if (row) {
      written = JSON.stringify({
        guildId: row.id,
        text: row.tag_text,
        color: row.tag_color,
        icon: row.tag_icon,
      } satisfies ServerTag);
    }
  }
  db.prepare('UPDATE users SET server_tag = ?, tag_guild = ? WHERE id = ?').run(
    written,
    written ? chosen.tag_guild : null,
    userId,
  );
}

/** The people who show the tag of a group (to refresh them when the group changes it or disappears). */
export function showingTagOf(db: Db, guildId: string): string[] {
  return (
    db.prepare('SELECT id FROM users WHERE tag_guild = ?').all(guildId) as { id: string }[]
  ).map(function id(row) {
    return row.id;
  });
}
