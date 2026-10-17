/**
 * src/models.ts
 * Types of the database rows and the functions that turn them into public objects for the client.
 */
import type { Db } from './db';
import { parseServerTag, type ServerTag } from './server-tag';

export interface UserRow {
  id: string;
  /** 1: a guest account (erased when the person leaves). */
  guest?: number;
  /** 1: an administrator reset the password and the person has to make new keys (see routes/recovery.ts). */
  identity_reset?: number;
  username: string;
  display_name: string;
  auth_hash: string;
  kdf_salt: string;
  kdf_iterations: number;
  pub_ecdh: string;
  pub_ecdsa: string;
  wrapped_ecdh: string;
  wrapped_ecdsa: string;
  bio: string;
  status_text: string;
  accent: string;
  aura: string;
  aura_color: string;
  pronouns: string;
  avatar_image: string | null;
  banner_image: string | null;
  name_font_image: string | null;
  banner_color: string;
  profile_color: string;
  name_font: string;
  name_fx: string;
  server_tag: string;
  tag_guild: string | null;
  avatar_color: string;
  presence_visibility: 'everyone' | 'friends' | 'nobody';
  friend_requests: 'everyone' | 'nobody';
  searchable: number;
  created_at: number;
  /** Suspended by an administrator (routes/admin.ts): when, or null. */
  suspended_at?: number | null;
  suspended_reason?: string;
}

/** The privacy choices of a person. Only the person themselves receive them (see `toSelfUser`). */
export interface PrivacyChoices {
  presenceVisibility: 'everyone' | 'friends' | 'nobody';
  friendRequests: 'everyone' | 'nobody';
  searchable: boolean;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  statusText: string;
  accent: string;
  aura: string;
  auraColor: string;
  pronouns: string;
  avatarImage: string | null;
  bannerImage: string | null;
  bannerColor: string;
  profileColor: string;
  nameFont: string;
  nameFx: string;
  serverTag: ServerTag | null;
  avatarColor: string;
  publicKeys: { ecdh: string; ecdsa: string };
  createdAt: number;
}

/** The part of a user that other people may see (never the secrets). */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    statusText: row.status_text,
    accent: row.accent,
    aura: row.aura,
    auraColor: row.aura_color,
    pronouns: row.pronouns,
    avatarImage: row.avatar_image,
    bannerImage: row.banner_image,
    bannerColor: row.banner_color,
    profileColor: row.profile_color,
    // A font the person uploaded travels as "custom:<id of the encrypted font file>", so every place that draws a name
    // knows which file to use (a name font with no file, or a built-in one, is just its name).
    nameFont:
      row.name_font === 'custom' && row.name_font_image
        ? 'custom:' + row.name_font_image
        : row.name_font,
    nameFx: row.name_fx,
    serverTag: parseServerTag(row.server_tag ?? ''),
    avatarColor: row.avatar_color,
    publicKeys: { ecdh: row.pub_ecdh, ecdsa: row.pub_ecdsa },
    createdAt: row.created_at,
  };
}

/** The user as the person themselves see it: the public profile plus their own privacy choices (nobody else gets those). */
export function toSelfUser(
  row: UserRow,
): PublicUser & { privacy: PrivacyChoices; nameFontImage: string | null; guest: boolean } {
  return {
    ...toPublicUser(row),
    guest: row.guest === 1,
    nameFontImage: row.name_font_image,
    privacy: {
      presenceVisibility: row.presence_visibility,
      friendRequests: row.friend_requests,
      searchable: row.searchable === 1,
    },
  };
}

/** A user by id. */
export function getUser(db: Db, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

/** Several users by id, in chunks so the query never exceeds the limit of SQLite. */
export function getUsers(db: Db, ids: Iterable<string>): PublicUser[] {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows: UserRow[] = [];
  // SQLite caps bound variables; chunk to stay far below it.
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const marks = chunk
      .map(function () {
        return '?';
      })
      .join(',');
    rows.push(
      ...(db.prepare(`SELECT * FROM users WHERE id IN (${marks})`).all(...chunk) as UserRow[]),
    );
  }
  return rows.map(toPublicUser);
}

/** Two ids in a fixed order: a friendship is one row, whoever asked first. */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Whether two people are friends. */
export function areFriends(db: Db, a: string, b: string): boolean {
  const [x, y] = orderedPair(a, b);
  return !!db
    .prepare("SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'accepted'")
    .get(x, y);
}

export interface ChannelRow {
  id: string;
  guild_id: string | null;
  type: 'text' | 'voice' | 'dm';
  name: string;
  dm_key: string | null;
  position: number;
  created_at: number;
}

/** A channel by id. */
export function getChannel(db: Db, id: string): ChannelRow | undefined {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
}

/** Everyone who can read the channel: DM participants or guild members. */
export function channelAudience(db: Db, channel: ChannelRow): string[] {
  const rows = channel.guild_id
    ? db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(channel.guild_id)
    : db.prepare('SELECT user_id FROM dm_members WHERE channel_id = ?').all(channel.id);
  return (rows as { user_id: string }[]).map(function (r) {
    return r.user_id;
  });
}

/** Whether a person can read a channel: a participant of a direct chat or a member of the group. */
export function canAccessChannel(db: Db, channel: ChannelRow, userId: string): boolean {
  if (channel.guild_id) {
    return !!db
      .prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?')
      .get(channel.guild_id, userId);
  }
  return !!db
    .prepare('SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?')
    .get(channel.id, userId);
}

/** Users that should learn about `userId`'s presence changes. */
export function presenceAudience(db: Db, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT CASE WHEN user_a = @u THEN user_b ELSE user_a END AS id
         FROM friendships WHERE status = 'accepted' AND (user_a = @u OR user_b = @u)
       UNION
       SELECT gm2.user_id AS id FROM guild_members gm1
         JOIN guild_members gm2 ON gm1.guild_id = gm2.guild_id
        WHERE gm1.user_id = @u AND gm2.user_id <> @u`,
    )
    .all({ u: userId }) as { id: string }[];
  return rows.map(function (r) {
    return r.id;
  });
}

/**
 * Everybody who may see the profile picture of a person: friends (also the ones still pending), people who share a server
 * with them and people they have a direct conversation with.
 */
export function profileAudience(db: Db, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT CASE WHEN user_a = @u THEN user_b ELSE user_a END AS id
         FROM friendships WHERE user_a = @u OR user_b = @u
       UNION
       SELECT gm2.user_id AS id FROM guild_members gm1
         JOIN guild_members gm2 ON gm1.guild_id = gm2.guild_id
        WHERE gm1.user_id = @u AND gm2.user_id <> @u
       UNION
       SELECT d2.user_id AS id FROM dm_members d1
         JOIN dm_members d2 ON d1.channel_id = d2.channel_id
        WHERE d1.user_id = @u AND d2.user_id <> @u`,
    )
    .all({ u: userId }) as { id: string }[];
  return rows.map(function (r) {
    return r.id;
  });
}

/**
 * Whether `viewerId` may see the pictures of `ownerId` right now: the owner, or somebody who is still their friend (or
 * has a pending request with them), shares a server with them or has a direct conversation with them. A person who is no
 * longer in any of those loses the picture even if the key that was sealed for them is still stored.
 */
export function canSeeProfile(db: Db, ownerId: string, viewerId: string): boolean {
  if (ownerId === viewerId) return true;
  return !!db
    .prepare(
      `SELECT 1 FROM friendships
        WHERE (user_a = @o AND user_b = @v) OR (user_a = @v AND user_b = @o)
       UNION ALL
       SELECT 1 FROM guild_members gm1 JOIN guild_members gm2 ON gm1.guild_id = gm2.guild_id
        WHERE gm1.user_id = @o AND gm2.user_id = @v
       UNION ALL
       SELECT 1 FROM dm_members d1 JOIN dm_members d2 ON d1.channel_id = d2.channel_id
        WHERE d1.user_id = @o AND d2.user_id = @v
       LIMIT 1`,
    )
    .get({ o: ownerId, v: viewerId });
}
