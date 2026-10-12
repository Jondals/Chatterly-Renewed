/**
 * src/routes/guilds.ts
 * Grupos: crear, editar, confirmDelete, invitar, expulsar, canales y claves de grupo cifradas.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import type { Db } from '../db';
import {
  areFriends,
  getUser,
  getUsers,
  profileAudience,
  toPublicUser,
  toSelfUser,
} from '../models';
import { isTagIcon, refreshServerTag, showingTagOf } from '../server-tag';
import { b64Field, callerId, sealedText, sealedVersion } from '../validation';
import { deleteImage, ownsImage } from './images';

interface GuildRow {
  id: string;
  name: string;
  icon_image: string | null;
  owner_id: string;
  key_version: number;
  needs_rotation: number;
  tag_text: string;
  tag_color: string;
  tag_icon: string;
  icon_key_version: number;
  icon_key_iv: string;
  icon_key_data: string;
  created_at: number;
}

const envelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['iv', 'data'],
  properties: { iv: b64Field(16, 16), data: b64Field(60, 200) },
} as const;

/** The key of the encrypted icon of a group, sealed in the browser of the owner with the key of the group (version `version`). */
const iconKeySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'iv', 'data'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    iv: b64Field(16, 16),
    data: b64Field(60, 200),
  },
} as const;

const uuidField = {
  type: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
} as const;

/**
 * ! What a group calls itself is sealed in the browsers of its members with the key of the group (see core/crypto/guild-meta.ts):
 * the name, the emoji, the name of every channel and of every tag (with its color). The server stores those texts as they come
 * and never reads them. This is the whole set, sealed with one key version.
 */
const metaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'channels', 'tags'],
  properties: {
    name: sealedText,
    channels: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name'],
        properties: { id: { type: 'string', maxLength: 64 }, name: sealedText },
      },
    },
    tags: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name'],
        properties: { id: { type: 'string', maxLength: 64 }, name: sealedText },
      },
    },
  },
} as const;

interface Meta {
  name: string;
  channels: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

/** Whether two lists have the same ids (no more, no less, none twice). */
function sameIds(given: { id: string }[], wanted: string[]): boolean {
  const ids = new Set(
    given.map(function id(item) {
      return item.id;
    }),
  );
  return (
    ids.size === given.length &&
    ids.size === wanted.length &&
    wanted.every(function has(id) {
      return ids.has(id);
    })
  );
}

/**
 * What a member receives about a group: channels, members with their tags, the tags, and only THEIR own wrapped keys.
 */
export function guildPayload(db: Db, guild: GuildRow, userId: string) {
  const channels = db
    .prepare(
      'SELECT id, name, type, position FROM channels WHERE guild_id = ? ORDER BY position, created_at',
    )
    .all(guild.id);
  const members = db
    .prepare(
      'SELECT user_id AS userId, role FROM guild_members WHERE guild_id = ? ORDER BY COALESCE(sort_order, joined_at)',
    )
    .all(guild.id);
  const tags = db
    .prepare(
      'SELECT id, name, color FROM guild_tags WHERE guild_id = ? ORDER BY position, created_at',
    )
    .all(guild.id);
  const given = db
    .prepare('SELECT user_id AS userId, tag_id AS tagId FROM guild_member_tags WHERE guild_id = ?')
    .all(guild.id) as { userId: string; tagId: string }[];
  const tagsOf = new Map<string, string[]>();
  for (const row of given) {
    tagsOf.set(row.userId, [...(tagsOf.get(row.userId) ?? []), row.tagId]);
  }
  const keys = db
    .prepare(
      `SELECT key_version AS keyVersion, wrapper_id AS wrapperId, wrapper_pub AS wrapperPub, iv, data
         FROM guild_keys WHERE guild_id = ? AND user_id = ? ORDER BY key_version`,
    )
    .all(guild.id, userId);
  return {
    id: guild.id,
    name: guild.name,
    iconImage: guild.icon_image,
    ownerId: guild.owner_id,
    keyVersion: guild.key_version,
    needsRotation: !!guild.needs_rotation,
    tag: { text: guild.tag_text, color: guild.tag_color, icon: guild.tag_icon },
    // null: the icon is an old one that is not encrypted yet (its owner's browser encrypts it the next time it opens the app)
    iconKey: guild.icon_key_data
      ? { keyVersion: guild.icon_key_version, iv: guild.icon_key_iv, data: guild.icon_key_data }
      : null,
    channels,
    members: (members as { userId: string; role: string }[]).map(function withTags(member) {
      return { ...member, tags: tagsOf.get(member.userId) ?? [] };
    }),
    tags,
    keys,
  };
}

/** Registers every route of the groups. Each handler checks who is asking before it touches anything. */
export function registerGuildRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub, config } = ctx;
  const me = callerId;
  const auth = { onRequest: [app.authenticate] };

  const getGuild = function (id: string) {
    return db.prepare('SELECT * FROM guilds WHERE id = ?').get(id) as GuildRow | undefined;
  };
  const memberIds = function (guildId: string) {
    return (
      db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(guildId) as {
        user_id: string;
      }[]
    ).map(function (r) {
      return r.user_id;
    });
  };
  const isMember = function (guildId: string, userId: string) {
    return !!db
      .prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId);
  };
  const notifyGuild = function (guildId: string, extraUsers: string[] = []) {
    return hub.sendToMany([...memberIds(guildId), ...extraUsers], {
      t: 'guild.update',
      guildId,
    });
  };

  /** Tells everybody who may see a person that their public profile changed (their tag). */
  const announceUser = function (userId: string) {
    const row = getUser(db, userId);
    if (!row) return;
    hub.sendToMany(profileAudience(db, userId), { t: 'user.update', user: toPublicUser(row) });
    hub.sendTo(userId, { t: 'user.update', user: toSelfUser(row) });
  };

  /** Loads the guild and checks the caller belongs to it (404 otherwise, so ids don't leak). */
  function requireMember(req: FastifyRequest, reply: FastifyReply): GuildRow | undefined {
    const guild = getGuild((req.params as { id: string }).id);
    if (!guild || !isMember(guild.id, me(req))) {
      reply.code(404).send({ error: 'not_found' });
      return undefined;
    }
    return guild;
  }

  /**
   * ? Loads the group and requires the caller to be its owner (403 otherwise): only the owner manages channels, members and tags.
   */
  function requireOwner(req: FastifyRequest, reply: FastifyReply): GuildRow | undefined {
    const guild = requireMember(req, reply);
    if (!guild) return undefined;
    if (guild.owner_id !== me(req)) {
      reply.code(403).send({ error: 'owner_only' });
      return undefined;
    }
    return guild;
  }

  app.get('/api/guilds', auth, async function (req) {
    const self = me(req);
    const guilds = db
      .prepare(
        `SELECT g.* FROM guilds g JOIN guild_members m ON m.guild_id = g.id
          WHERE m.user_id = ? ORDER BY g.created_at`,
      )
      .all(self) as GuildRow[];
    const payloads = guilds.map(function (g) {
      return guildPayload(db, g, self);
    });
    const userIds = payloads.flatMap(function (g) {
      return [
        ...g.members.map(function (m) {
          return (m as { userId: string }).userId;
        }),
      ];
    });
    return { guilds: payloads, users: getUsers(db, userIds) };
  });

  app.post(
    '/api/guilds',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'envelope', 'channels'],
          properties: {
            id: uuidField,
            name: sealedText,
            envelope: envelopeSchema,
            // The first channels (a text one and a voice one), with their names sealed.
            channels: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'name', 'type'],
                properties: { id: uuidField, name: sealedText, type: { enum: ['text', 'voice'] } },
              },
            },
          },
        },
      },
    },
    /**
     * POST /api/guilds: creates a group with its first channels and the wrapped key of its owner, in one transaction.
     */
    async function (req, reply) {
      const self = me(req);
      const body = req.body as {
        id: string;
        name: string;
        envelope: { iv: string; data: string };
        channels: { id: string; name: string; type: 'text' | 'voice' }[];
      };
      const count = (
        db.prepare('SELECT COUNT(*) AS n FROM guilds WHERE owner_id = ?').get(self) as { n: number }
      ).n;
      if (count >= 25) return reply.code(403).send({ error: 'guild_limit' });
      // Key envelopes and sealed texts are bound to the guild id, so the creator chooses it.
      const id = body.id;
      if (getGuild(id)) return reply.code(409).send({ error: 'id_taken' });
      const first = [
        body.name,
        ...body.channels.map(function name(c) {
          return c.name;
        }),
      ];
      if (
        first.some(function stale(text) {
          return text && sealedVersion(text) !== 1;
        }) ||
        body.channels[0]!.type !== 'text' ||
        body.channels[1]!.type !== 'voice' ||
        body.channels[0]!.id === body.channels[1]!.id
      ) {
        return reply.code(400).send({ error: 'invalid_group' });
      }
      if (
        db
          .prepare('SELECT 1 FROM channels WHERE id IN (?, ?)')
          .get(body.channels[0]!.id, body.channels[1]!.id)
      ) {
        return reply.code(409).send({ error: 'id_taken' });
      }
      const now = Date.now();
      db.transaction(function () {
        db.prepare(
          'INSERT INTO guilds (id, name, owner_id, key_version, created_at) VALUES (?,?,?,1,?)',
        ).run(id, body.name, self, now);
        db.prepare(
          "INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?,?, 'owner', ?)",
        ).run(id, self, now);
        db.prepare(
          'INSERT INTO guild_keys (guild_id, user_id, key_version, wrapper_id, iv, data) VALUES (?,?,1,?,?,?)',
        ).run(id, self, self, body.envelope.iv, body.envelope.data);
        const addChannel = db.prepare(
          'INSERT INTO channels (id, guild_id, type, name, position, created_at) VALUES (?,?,?,?,?,?)',
        );
        body.channels.forEach(function add(channel, index) {
          addChannel.run(channel.id, id, channel.type, channel.name, index, now);
        });
      })();
      return reply.code(201).send({ guild: guildPayload(db, getGuild(id)!, self) });
    },
  );

  app.patch(
    '/api/guilds/:id',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: sealedText,
            iconImage: {
              type: ['string', 'null'],
              pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            },
            // With a new icon comes the key that opens it (sealed with the key of the group).
            iconKey: iconKeySchema,
            // The tag of the group: up to four letters or numbers, a color and one emoji (any one: checked below).
            tag: { type: 'string', pattern: '^[A-Za-z0-9]{0,4}$' },
            tagColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
            tagIcon: { type: 'string', maxLength: 32 },
          },
        },
      },
    },
    /**
     * PATCH /api/guilds/:id: renames the group (a sealed name) or changes its icon (a picture the owner uploaded) and its tag.
     */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const body = req.body as {
        name?: string;
        iconImage?: string | null;
        iconKey?: { version: number; iv: string; data: string };
        tag?: string;
        tagColor?: string;
        tagIcon?: string;
      };
      if (body.tagIcon !== undefined && !isTagIcon(body.tagIcon)) {
        return reply.code(400).send({ error: 'invalid_tag_icon' });
      }
      if (body.name && sealedVersion(body.name) !== guild.key_version) {
        return reply.code(409).send({ error: 'stale_key_version', current: guild.key_version });
      }
      let iconImage = guild.icon_image;
      let iconKey = {
        version: guild.icon_key_version,
        iv: guild.icon_key_iv,
        data: guild.icon_key_data,
      };
      if (body.iconImage !== undefined) {
        if (body.iconImage !== null) {
          // ! A new icon is an encrypted picture of this group, with the key that opens it (made with the current group key).
          if (
            !ownsImage(ctx, body.iconImage, me(req), 'group', guild.id) ||
            !body.iconKey ||
            body.iconKey.version !== guild.key_version
          ) {
            return reply.code(400).send({ error: 'invalid_image' });
          }
          iconKey = body.iconKey;
        } else {
          iconKey = { version: 0, iv: '', data: '' };
        }
        iconImage = body.iconImage;
      }
      db.prepare('UPDATE guilds SET tag_text = ?, tag_color = ?, tag_icon = ? WHERE id = ?').run(
        body.tag !== undefined ? body.tag.toUpperCase() : guild.tag_text,
        body.tagColor ?? guild.tag_color,
        body.tagIcon ?? guild.tag_icon,
        guild.id,
      );
      db.prepare(
        'UPDATE guilds SET icon_key_version = ?, icon_key_iv = ?, icon_key_data = ? WHERE id = ?',
      ).run(iconKey.version, iconKey.iv, iconKey.data, guild.id);
      db.prepare('UPDATE guilds SET name = ?, icon_image = ? WHERE id = ?').run(
        body.name ?? guild.name,
        iconImage,
        guild.id,
      );
      if (guild.icon_image && guild.icon_image !== iconImage) deleteImage(ctx, guild.icon_image);
      if (body.tag !== undefined || body.tagColor !== undefined || body.tagIcon !== undefined) {
        for (const who of showingTagOf(db, guild.id)) {
          refreshServerTag(db, who);
          announceUser(who);
        }
      }
      notifyGuild(guild.id);
      return { guild: guildPayload(db, getGuild(guild.id)!, me(req)) };
    },
  );

  app.delete('/api/guilds/:id', auth, async function (req, reply) {
    const guild = requireOwner(req, reply);
    if (!guild) return;
    const members = memberIds(guild.id);
    const showing = showingTagOf(db, guild.id);
    const files = db
      .prepare(
        'SELECT f.id FROM files f JOIN channels c ON c.id = f.channel_id WHERE c.guild_id = ?',
      )
      .all(guild.id) as { id: string }[];
    db.prepare('DELETE FROM guilds WHERE id = ?').run(guild.id);
    for (const who of showing) {
      refreshServerTag(db, who);
      announceUser(who);
    }
    deleteImage(ctx, guild.icon_image);
    for (const file of files)
      fs.rm(path.join(config.uploadDir, file.id), { force: true }, function () {
        return undefined;
      });
    hub.sendToMany(members, { t: 'guild.removed', guildId: guild.id });
    return reply.code(204).send();
  });

  // Any member may bring in one of their own friends: they hold the key, so they can wrap it.
  app.post(
    '/api/guilds/:id/members',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['userId', 'envelope'],
          properties: {
            userId: { type: 'string', maxLength: 64 },
            envelope: envelopeSchema,
          },
        },
      },
    },
    /** POST /api/guilds/:id/members: adds a friend of the caller with the group key wrapped for them. */
    async function (req, reply) {
      const guild = requireMember(req, reply);
      if (!guild) return;
      const self = me(req);
      const body = req.body as {
        userId: string;
        envelope: { iv: string; data: string };
      };
      if (guild.needs_rotation) return reply.code(409).send({ error: 'rotation_pending' });
      if (isMember(guild.id, body.userId)) return reply.code(409).send({ error: 'already_member' });
      if (!areFriends(db, self, body.userId)) return reply.code(403).send({ error: 'not_friends' });
      if (memberIds(guild.id).length >= 50) return reply.code(403).send({ error: 'guild_full' });
      db.transaction(function () {
        db.prepare(
          "INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?,?, 'member', ?)",
        ).run(guild.id, body.userId, Date.now());
        db.prepare(
          'INSERT INTO guild_keys (guild_id, user_id, key_version, wrapper_id, iv, data) VALUES (?,?,?,?,?,?)',
        ).run(guild.id, body.userId, guild.key_version, self, body.envelope.iv, body.envelope.data);
      })();
      notifyGuild(guild.id);
      return reply.code(201).send({ ok: true });
    },
  );

  // ---- tags (only the owner of the group creates them and gives them) ----------------------------

  const MAX_TAGS = 12;
  const MAX_TAGS_PER_MEMBER = 5;

  app.post(
    '/api/guilds/:id/tags',
    {
      ...auth,
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name'],
          properties: { id: uuidField, name: sealedText },
        },
      },
    },
    /** POST /api/guilds/:id/tags: creates a tag (its name and color travel sealed; at most 12 per group). */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const body = req.body as { id: string; name: string };
      if (sealedVersion(body.name) !== guild.key_version) {
        return reply.code(409).send({ error: 'stale_key_version', current: guild.key_version });
      }
      if (db.prepare('SELECT 1 FROM guild_tags WHERE id = ?').get(body.id)) {
        return reply.code(409).send({ error: 'id_taken' });
      }
      const count = (
        db.prepare('SELECT COUNT(*) AS n FROM guild_tags WHERE guild_id = ?').get(guild.id) as {
          n: number;
        }
      ).n;
      if (count >= MAX_TAGS) return reply.code(400).send({ error: 'too_many_tags' });
      const id = body.id;
      const last = (
        db
          .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM guild_tags WHERE guild_id = ?')
          .get(guild.id) as { p: number }
      ).p;
      db.prepare(
        'INSERT INTO guild_tags (id, guild_id, name, color, created_at, position) VALUES (?,?,?,?,?,?)',
      ).run(id, guild.id, body.name, '', Date.now(), last + 1);
      notifyGuild(guild.id);
      return reply.code(201).send({ id });
    },
  );

  // The owner puts the tags in the order the sections of the members list follow.
  app.patch(
    '/api/guilds/:id/tags/order',
    {
      ...auth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ids'],
          properties: {
            ids: {
              type: 'array',
              maxItems: MAX_TAGS,
              items: { type: 'string', maxLength: 64 },
            },
          },
        },
      },
    },
    /**
     * PATCH /api/guilds/:id/tags/order: stores the order of the tags, which is the order of the sections of the members.
     */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const ids = [...new Set((req.body as { ids: string[] }).ids)];
      db.transaction(function () {
        ids.forEach(function place(tagId, index) {
          db.prepare('UPDATE guild_tags SET position = ? WHERE id = ? AND guild_id = ?').run(
            index + 1,
            tagId,
            guild.id,
          );
        });
      })();
      notifyGuild(guild.id);
      return reply.code(204).send();
    },
  );

  app.delete('/api/guilds/:id/tags/:tagId', auth, async function (req, reply) {
    const guild = requireOwner(req, reply);
    if (!guild) return;
    const tagId = (req.params as { tagId: string }).tagId;
    const result = db
      .prepare('DELETE FROM guild_tags WHERE id = ? AND guild_id = ?')
      .run(tagId, guild.id);
    if (!result.changes) return reply.code(404).send({ error: 'not_found' });
    notifyGuild(guild.id);
    return reply.code(204).send();
  });

  app.patch(
    '/api/guilds/:id/members/:userId/tags',
    {
      ...auth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['tagIds'],
          properties: {
            tagIds: {
              type: 'array',
              maxItems: MAX_TAGS_PER_MEMBER,
              items: { type: 'string', maxLength: 64 },
            },
          },
        },
      },
    },
    /**
     * PATCH /api/guilds/:id/members/:userId/tags: sets the tags of one member (every tag must belong to this group).
     */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const target = (req.params as { userId: string }).userId;
      if (!isMember(guild.id, target)) return reply.code(404).send({ error: 'not_found' });
      const wanted = [...new Set((req.body as { tagIds: string[] }).tagIds)];
      const valid = wanted.filter(function exists(tagId) {
        return !!db
          .prepare('SELECT 1 FROM guild_tags WHERE id = ? AND guild_id = ?')
          .get(tagId, guild.id);
      });
      if (valid.length !== wanted.length) return reply.code(400).send({ error: 'unknown_tag' });
      db.transaction(function () {
        db.prepare('DELETE FROM guild_member_tags WHERE guild_id = ? AND user_id = ?').run(
          guild.id,
          target,
        );
        for (const tagId of valid) {
          db.prepare(
            'INSERT INTO guild_member_tags (guild_id, user_id, tag_id) VALUES (?,?,?)',
          ).run(guild.id, target, tagId);
        }
      })();
      notifyGuild(guild.id);
      return reply.code(204).send();
    },
  );

  // Leave (self) or kick (owner). Either way the old key is considered burned: the owner rotates.
  app.delete('/api/guilds/:id/members/:userId', auth, async function (req, reply) {
    const guild = requireMember(req, reply);
    if (!guild) return;
    const self = me(req);
    const target = (req.params as { userId: string }).userId;
    if (target === guild.owner_id) return reply.code(400).send({ error: 'owner_cannot_leave' });
    if (target !== self && guild.owner_id !== self)
      return reply.code(403).send({ error: 'owner_only' });
    if (!isMember(guild.id, target)) return reply.code(404).send({ error: 'not_found' });
    db.transaction(function () {
      db.prepare('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?').run(
        guild.id,
        target,
      );
      db.prepare('DELETE FROM guild_member_tags WHERE guild_id = ? AND user_id = ?').run(
        guild.id,
        target,
      );
      db.prepare('DELETE FROM guild_keys WHERE guild_id = ? AND user_id = ?').run(guild.id, target);
      db.prepare('UPDATE guilds SET needs_rotation = 1 WHERE id = ?').run(guild.id);
    })();
    refreshServerTag(db, target);
    announceUser(target);
    const room = hub.roomOf(target);
    if (
      room &&
      db.prepare('SELECT 1 FROM channels WHERE id = ? AND guild_id = ?').get(room, guild.id)
    ) {
      hub.leaveRoom(target);
    }
    hub.sendTo(target, { t: 'guild.removed', guildId: guild.id });
    notifyGuild(guild.id);
    return reply.code(204).send();
  });

  // The owner re-encrypts a fresh key for exactly the remaining members.
  app.post(
    '/api/guilds/:id/rotate',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['keyVersion', 'envelopes', 'meta'],
          properties: {
            keyVersion: { type: 'integer', minimum: 2 },
            // The names of the group sealed again with the new key (all of them: a member who comes later only has the new key).
            meta: metaSchema,
            // The key of the icon sealed again with the new key of the group (needed when the group has an encrypted icon).
            iconKey: {
              type: 'object',
              additionalProperties: false,
              required: ['iv', 'data'],
              properties: { iv: b64Field(16, 16), data: b64Field(60, 200) },
            },
            envelopes: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['userId', 'iv', 'data'],
                properties: {
                  userId: { type: 'string', maxLength: 64 },
                  iv: b64Field(16, 16),
                  data: b64Field(60, 200),
                },
              },
            },
          },
        },
      },
    },
    /**
     * POST /api/guilds/:id/rotate: stores the new key of the group wrapped for each remaining member, after somebody left.
     */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const body = req.body as {
        keyVersion: number;
        meta: Meta;
        iconKey?: { iv: string; data: string };
        envelopes: { userId: string; iv: string; data: string }[];
      };
      if (body.keyVersion !== guild.key_version + 1) {
        return reply.code(409).send({ error: 'stale_key_version', current: guild.key_version });
      }
      if (guild.icon_key_data && !body.iconKey) {
        return reply.code(400).send({ error: 'icon_key_required' });
      }
      const refused = checkMeta(guild, body.meta, body.keyVersion);
      if (refused) return reply.code(refused.status).send({ error: refused.error });
      const members = new Set(memberIds(guild.id));
      const given = new Set(
        body.envelopes.map(function (e) {
          return e.userId;
        }),
      );
      if (
        members.size !== given.size ||
        [...members].some(function (id) {
          return !given.has(id);
        })
      ) {
        return reply.code(400).send({ error: 'envelopes_must_match_members' });
      }
      db.transaction(function () {
        const insert = db.prepare(
          'INSERT INTO guild_keys (guild_id, user_id, key_version, wrapper_id, iv, data) VALUES (?,?,?,?,?,?)',
        );
        for (const e of body.envelopes)
          insert.run(guild.id, e.userId, body.keyVersion, guild.owner_id, e.iv, e.data);
        db.prepare('UPDATE guilds SET key_version = ?, needs_rotation = 0 WHERE id = ?').run(
          body.keyVersion,
          guild.id,
        );
        if (guild.icon_key_data && body.iconKey) {
          db.prepare(
            'UPDATE guilds SET icon_key_version = ?, icon_key_iv = ?, icon_key_data = ? WHERE id = ?',
          ).run(body.keyVersion, body.iconKey.iv, body.iconKey.data, guild.id);
        }
        writeMeta(guild.id, body.meta);
      })();
      notifyGuild(guild.id);
      return { keyVersion: body.keyVersion };
    },
  );

  /** Checks a whole set of sealed names against the group (every channel and tag, one key version). */
  function checkMeta(
    guild: GuildRow,
    meta: Meta,
    version: number,
  ): { status: number; error: string } | null {
    const texts = [
      meta.name,
      ...meta.channels.map(function name(c) {
        return c.name;
      }),
      ...meta.tags.map(function name(c) {
        return c.name;
      }),
    ];
    if (
      texts.some(function stale(text) {
        return text && sealedVersion(text) !== version;
      })
    ) {
      return { status: 409, error: 'stale_key_version' };
    }
    const channels = (
      db.prepare('SELECT id FROM channels WHERE guild_id = ?').all(guild.id) as { id: string }[]
    ).map(function id(row) {
      return row.id;
    });
    const tags = (
      db.prepare('SELECT id FROM guild_tags WHERE guild_id = ?').all(guild.id) as { id: string }[]
    ).map(function id(row) {
      return row.id;
    });
    if (!sameIds(meta.channels, channels) || !sameIds(meta.tags, tags)) {
      return { status: 409, error: 'meta_mismatch' };
    }
    return null;
  }

  /** Stores a whole set of sealed names (call it inside a transaction). */
  function writeMeta(guildId: string, meta: Meta): void {
    db.prepare('UPDATE guilds SET name = ? WHERE id = ?').run(meta.name, guildId);
    const channel = db.prepare('UPDATE channels SET name = ? WHERE id = ? AND guild_id = ?');
    for (const item of meta.channels) channel.run(item.name, item.id, guildId);
    const tag = db.prepare(
      "UPDATE guild_tags SET name = ?, color = '' WHERE id = ? AND guild_id = ?",
    );
    for (const item of meta.tags) tag.run(item.name, item.id, guildId);
  }

  // A group made before the names were sealed: its owner seals them all (the browser does it when it opens the app).
  app.put(
    '/api/guilds/:id/meta',
    {
      ...auth,
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
      schema: { body: metaSchema },
    },
    /** PUT /api/guilds/:id/meta: replaces the names of the group by their sealed version (owner only, current key). */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const meta = req.body as Meta;
      const refused = checkMeta(guild, meta, guild.key_version);
      if (refused) return reply.code(refused.status).send({ error: refused.error });
      db.transaction(function () {
        writeMeta(guild.id, meta);
      })();
      notifyGuild(guild.id);
      return { ok: true };
    },
  );

  // ---- channels -----------------------------------------------------------------------------

  app.post(
    '/api/guilds/:id/channels',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'type'],
          properties: {
            id: uuidField,
            name: sealedText,
            type: { type: 'string', enum: ['text', 'voice'] },
          },
        },
      },
    },
    /** POST /api/guilds/:id/channels: creates a text or voice channel (limited in number per group). */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const body = req.body as { id: string; name: string; type: 'text' | 'voice' };
      if (sealedVersion(body.name) !== guild.key_version) {
        return reply.code(409).send({ error: 'stale_key_version', current: guild.key_version });
      }
      if (db.prepare('SELECT 1 FROM channels WHERE id = ?').get(body.id)) {
        return reply.code(409).send({ error: 'id_taken' });
      }
      const count = (
        db.prepare('SELECT COUNT(*) AS n FROM channels WHERE guild_id = ?').get(guild.id) as {
          n: number;
        }
      ).n;
      if (count >= 40) return reply.code(403).send({ error: 'channel_limit' });
      db.prepare(
        'INSERT INTO channels (id, guild_id, type, name, position, created_at) VALUES (?,?,?,?,?,?)',
      ).run(body.id, guild.id, body.type, body.name, count, Date.now());
      notifyGuild(guild.id);
      return reply
        .code(201)
        .send({ channel: { id: body.id, name: body.name, type: body.type, position: count } });
    },
  );

  // Reorder members: only the owner. Receives the ids of ALL members in the wanted order.
  app.patch(
    '/api/guilds/:id/members/order',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ids'],
          properties: {
            ids: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              items: { type: 'string', maxLength: 64 },
            },
          },
        },
      },
    },
    /** PATCH /api/guilds/:id/members/order: stores the order of the members chosen by the owner. */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const { ids } = req.body as { ids: string[] };
      const current = (
        db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(guild.id) as {
          user_id: string;
        }[]
      ).map(function (row) {
        return row.user_id;
      });
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== current.length ||
        !ids.every(function (id) {
          return current.includes(id);
        })
      ) {
        return reply.code(400).send({ error: 'invalid_order' });
      }
      const place = db.prepare(
        'UPDATE guild_members SET sort_order = ? WHERE guild_id = ? AND user_id = ?',
      );
      db.transaction(function () {
        return ids.forEach(function (id, index) {
          return place.run(index, guild.id, id);
        });
      })();
      notifyGuild(guild.id);
      return { ok: true };
    },
  );

  // Reorder channels: owner only. It receives the ids of ALL the channels in the wanted order.
  app.patch(
    '/api/guilds/:id/channels/order',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ids'],
          properties: {
            ids: {
              type: 'array',
              minItems: 1,
              maxItems: 40,
              items: { type: 'string', maxLength: 64 },
            },
          },
        },
      },
    },
    /** PATCH /api/guilds/:id/channels/order: stores the order of the channels of one kind. */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const { ids } = req.body as { ids: string[] };
      const actuales = (
        db.prepare('SELECT id FROM channels WHERE guild_id = ?').all(guild.id) as { id: string }[]
      ).map(function (c) {
        return c.id;
      });
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== actuales.length ||
        !ids.every(function (id) {
          return actuales.includes(id);
        })
      ) {
        return reply.code(400).send({ error: 'invalid_order' });
      }
      const poner = db.prepare('UPDATE channels SET position = ? WHERE id = ?');
      db.transaction(function () {
        return ids.forEach(function (id, i) {
          return poner.run(i, id);
        });
      })();
      notifyGuild(guild.id);
      return { ok: true };
    },
  );

  app.patch(
    '/api/guilds/:id/channels/:channelId',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: sealedText },
        },
      },
    },
    /** PATCH /api/guilds/:id/channels/:channelId: renames a channel. */
    async function (req, reply) {
      const guild = requireOwner(req, reply);
      if (!guild) return;
      const { channelId } = req.params as { channelId: string };
      const channel = db
        .prepare('SELECT * FROM channels WHERE id = ? AND guild_id = ?')
        .get(channelId, guild.id) as { type: 'text' | 'voice' } | undefined;
      if (!channel) return reply.code(404).send({ error: 'not_found' });
      const body = req.body as { name: string };
      if (sealedVersion(body.name) !== guild.key_version) {
        return reply.code(409).send({ error: 'stale_key_version', current: guild.key_version });
      }
      db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(body.name, channelId);
      notifyGuild(guild.id);
      return { channel: { id: channelId, name: body.name } };
    },
  );

  app.delete('/api/guilds/:id/channels/:channelId', auth, async function (req, reply) {
    const guild = requireOwner(req, reply);
    if (!guild) return;
    const { channelId } = req.params as { channelId: string };
    const channel = db
      .prepare('SELECT * FROM channels WHERE id = ? AND guild_id = ?')
      .get(channelId, guild.id) as { id: string; type: string } | undefined;
    if (!channel) return reply.code(404).send({ error: 'not_found' });
    const texts = (
      db
        .prepare("SELECT COUNT(*) AS n FROM channels WHERE guild_id = ? AND type = 'text'")
        .get(guild.id) as {
        n: number;
      }
    ).n;
    if (channel.type === 'text' && texts <= 1)
      return reply.code(400).send({ error: 'last_text_channel' });
    const files = db.prepare('SELECT id FROM files WHERE channel_id = ?').all(channelId) as {
      id: string;
    }[];
    db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
    for (const file of files)
      fs.rm(path.join(config.uploadDir, file.id), { force: true }, function () {
        return undefined;
      });
    notifyGuild(guild.id);
    return reply.code(204).send();
  });
}
