/**
 * src/routes/messages.ts
 * Encrypted messages, reactions, encrypted attachments, delivery and read marks, and the call configuration (ICE/TURN).
 */
import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { relayProblem } from '../config';
import {
  areFriends,
  canAccessChannel,
  channelAudience,
  getChannel,
  type ChannelRow,
} from '../models';
import { ciphertextField, ivField, signatureField, callerId } from '../validation';

interface MessageRow {
  seq: number;
  id: string;
  channel_id: string;
  sender_id: string;
  iv: string;
  ciphertext: string;
  key_version: number;
  signature: string;
  created_at: number;
  edited_at: number | null;
}

interface ReactionRow {
  id: string;
  message_id: string;
  user_id: string;
  iv: string;
  ciphertext: string;
  signature: string;
}

const sealedBody = {
  type: 'object',
  additionalProperties: false,
  required: ['iv', 'ciphertext', 'signature'],
  properties: {
    iv: ivField,
    ciphertext: ciphertextField,
    signature: signatureField,
  },
} as const;

const reactionOut = function (r: ReactionRow) {
  return {
    id: r.id,
    messageId: r.message_id,
    userId: r.user_id,
    iv: r.iv,
    ciphertext: r.ciphertext,
    signature: r.signature,
  };
};

const messageOut = function (m: MessageRow, reactions: ReactionRow[] = []) {
  return {
    id: m.id,
    seq: m.seq,
    channelId: m.channel_id,
    senderId: m.sender_id,
    iv: m.iv,
    ciphertext: m.ciphertext,
    keyVersion: m.key_version,
    signature: m.signature,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    reactions: reactions.map(reactionOut),
  };
};

/** The most ciphertext one account may write in an hour (a message may carry 90 000 characters: without this one account could fill the disk). */
const WRITTEN_PER_HOUR = 8 * 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;

export function registerMessageRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub, config } = ctx;
  const me = callerId;
  const auth = { onRequest: [app.authenticate] };

  /** How much each account wrote in the hour that is running (kept in memory: it only has to stop abuse, not to last). */
  const written = new Map<string, { since: number; chars: number }>();

  /** Adds what an account is writing to its hour; false when it would go over the limit. */
  function withinBudget(userId: string, chars: number): boolean {
    const now = Date.now();
    let entry = written.get(userId);
    if (!entry || now - entry.since > HOUR_MS) {
      entry = { since: now, chars: 0 };
      written.set(userId, entry);
      // old entries do not pile up: a new hour for somebody is the moment to forget the ones that ended
      for (const [id, other] of written) {
        if (now - other.since > HOUR_MS) written.delete(id);
      }
    }
    if (entry.chars + chars > WRITTEN_PER_HOUR) return false;
    entry.chars += chars;
    return true;
  }

  /** 404 for both "missing" and "not yours" so channel ids cannot be probed. */
  function requireChannel(
    req: FastifyRequest,
    reply: FastifyReply,
    id: string,
  ): ChannelRow | undefined {
    const channel = getChannel(db, id);
    if (!channel || !canAccessChannel(db, channel, me(req))) {
      reply.code(404).send({ error: 'not_found' });
      return undefined;
    }
    return channel;
  }

  /** DMs only work between current friends. */
  function dmWritable(channel: ChannelRow, userId: string): boolean {
    if (channel.type !== 'dm') return true;
    const other = (
      db
        .prepare('SELECT user_id FROM dm_members WHERE channel_id = ? AND user_id <> ?')
        .get(channel.id, userId) as { user_id: string } | undefined
    )?.user_id;
    return !!other && areFriends(db, userId, other);
  }

  const publish = function (channel: ChannelRow, message: unknown, except?: string) {
    return hub.sendToMany(channelAudience(db, channel), message, except);
  };

  // ---- delivery and read marks ------------------------------------------------------------------

  /** Records that the caller has received and/or read messages up to a number, and tells the others. */
  app.post(
    '/api/channels/:id/receipt',
    {
      ...auth,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            delivered: { type: 'integer', minimum: 0 },
            read: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async function (req, reply) {
      const channel = requireChannel(req, reply, (req.params as { id: string }).id);
      if (!channel) return;
      const body = req.body as { delivered?: number; read?: number };
      // ! A mark can never point past the newest message of the channel.
      const newest = (
        db
          .prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM messages WHERE channel_id = ?')
          .get(channel.id) as { n: number }
      ).n;
      const read = Math.min(body.read ?? 0, newest);
      const delivered = Math.min(Math.max(body.delivered ?? 0, read), newest);
      db.prepare(
        `INSERT INTO channel_receipts (channel_id, user_id, delivered_seq, read_seq) VALUES (?,?,?,?)
         ON CONFLICT(channel_id, user_id) DO UPDATE SET
           delivered_seq = MAX(delivered_seq, excluded.delivered_seq),
           read_seq = MAX(read_seq, excluded.read_seq)`,
      ).run(channel.id, me(req), delivered, read);
      const row = db
        .prepare(
          'SELECT delivered_seq, read_seq FROM channel_receipts WHERE channel_id = ? AND user_id = ?',
        )
        .get(channel.id, me(req)) as {
        delivered_seq: number;
        read_seq: number;
      };
      publish(
        channel,
        {
          t: 'receipt',
          channelId: channel.id,
          userId: me(req),
          delivered: row.delivered_seq,
          read: row.read_seq,
        },
        me(req),
      );
      return { ok: true };
    },
  );

  /** The delivery and read marks of everybody else in the channel. */
  app.get('/api/channels/:id/receipts', auth, async function (req, reply) {
    const channel = requireChannel(req, reply, (req.params as { id: string }).id);
    if (!channel) return;
    const rows = db
      .prepare(
        'SELECT user_id, delivered_seq, read_seq FROM channel_receipts WHERE channel_id = ? AND user_id <> ?',
      )
      .all(channel.id, me(req)) as {
      user_id: string;
      delivered_seq: number;
      read_seq: number;
    }[];
    return {
      receipts: rows.map(function (r) {
        return {
          userId: r.user_id,
          delivered: r.delivered_seq,
          read: r.read_seq,
        };
      }),
    };
  });

  app.get(
    '/api/channels/:id/messages',
    {
      ...auth,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            before: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async function (req, reply) {
      const channel = requireChannel(req, reply, (req.params as { id: string }).id);
      if (!channel) return;
      const { before, limit = 50 } = req.query as {
        before?: number;
        limit?: number;
      };
      const rows = db
        .prepare(
          `SELECT * FROM messages WHERE channel_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
        )
        .all(channel.id, before ?? Number.MAX_SAFE_INTEGER, limit) as MessageRow[];
      rows.reverse();
      const reactions = rows.length
        ? (db
            .prepare(
              `SELECT * FROM reactions WHERE message_id IN (${rows
                .map(function () {
                  return '?';
                })
                .join(',')}) ORDER BY created_at`,
            )
            .all(
              ...rows.map(function (r) {
                return r.id;
              }),
            ) as ReactionRow[])
        : [];
      return {
        messages: rows.map(function (m) {
          return messageOut(
            m,
            reactions.filter(function (r) {
              return r.message_id === m.id;
            }),
          );
        }),
        hasMore: rows.length === limit,
      };
    },
  );

  app.post(
    '/api/channels/:id/messages',
    {
      ...auth,
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
      schema: {
        body: {
          ...sealedBody,
          required: [...sealedBody.required, 'keyVersion'],
          properties: {
            ...sealedBody.properties,
            keyVersion: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async function (req, reply) {
      const self = me(req);
      const channel = requireChannel(req, reply, (req.params as { id: string }).id);
      if (!channel) return;
      if (!dmWritable(channel, self)) return reply.code(403).send({ error: 'not_friends' });
      const body = req.body as {
        iv: string;
        ciphertext: string;
        signature: string;
        keyVersion: number;
      };
      if (!withinBudget(self, body.ciphertext.length)) {
        return reply.code(429).send({ error: 'write_quota' });
      }
      const expected = channel.guild_id
        ? (
            db.prepare('SELECT key_version FROM guilds WHERE id = ?').get(channel.guild_id) as {
              key_version: number;
            }
          ).key_version
        : 1;
      if (body.keyVersion !== expected) {
        return reply.code(409).send({ error: 'stale_key_version', current: expected });
      }
      const id = randomUUID();
      const createdAt = Date.now();
      const info = db
        .prepare(
          `INSERT INTO messages (id, channel_id, sender_id, iv, ciphertext, key_version, signature, created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          channel.id,
          self,
          body.iv,
          body.ciphertext,
          body.keyVersion,
          body.signature,
          createdAt,
        );
      const message = messageOut(
        {
          seq: Number(info.lastInsertRowid),
          id,
          channel_id: channel.id,
          sender_id: self,
          iv: body.iv,
          ciphertext: body.ciphertext,
          key_version: body.keyVersion,
          signature: body.signature,
          created_at: createdAt,
          edited_at: null,
        },
        [],
      );
      publish(channel, { t: 'message.new', message });
      return reply.code(201).send({ message });
    },
  );

  function loadOwnMessage(req: FastifyRequest, reply: FastifyReply) {
    const message = db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get((req.params as { id: string }).id) as MessageRow | undefined;
    const channel = message ? getChannel(db, message.channel_id) : undefined;
    if (!message || !channel || !canAccessChannel(db, channel, me(req))) {
      reply.code(404).send({ error: 'not_found' });
      return undefined;
    }
    return { message, channel };
  }

  app.patch(
    '/api/messages/:id',
    { ...auth, schema: { body: sealedBody } },
    async function (req, reply) {
      const found = loadOwnMessage(req, reply);
      if (!found) return;
      if (found.message.sender_id !== me(req)) return reply.code(403).send({ error: 'not_author' });
      if (!dmWritable(found.channel, me(req)))
        return reply.code(403).send({ error: 'not_friends' });
      const body = req.body as {
        iv: string;
        ciphertext: string;
        signature: string;
      };
      if (!withinBudget(me(req), body.ciphertext.length)) {
        return reply.code(429).send({ error: 'write_quota' });
      }
      const editedAt = Date.now();
      db.prepare(
        'UPDATE messages SET iv = ?, ciphertext = ?, signature = ?, edited_at = ? WHERE id = ?',
      ).run(body.iv, body.ciphertext, body.signature, editedAt, found.message.id);
      const updated = {
        ...found.message,
        ...body,
        edited_at: editedAt,
        iv: body.iv,
        ciphertext: body.ciphertext,
        signature: body.signature,
      };
      publish(found.channel, {
        t: 'message.edit',
        message: messageOut(updated as MessageRow),
      });
      return { ok: true };
    },
  );

  app.delete('/api/messages/:id', auth, async function (req, reply) {
    const found = loadOwnMessage(req, reply);
    if (!found) return;
    const self = me(req);
    const isGuildOwner =
      !!found.channel.guild_id &&
      !!db
        .prepare('SELECT 1 FROM guilds WHERE id = ? AND owner_id = ?')
        .get(found.channel.guild_id, self);
    if (found.message.sender_id !== self && !isGuildOwner)
      return reply.code(403).send({ error: 'forbidden' });
    db.prepare('DELETE FROM messages WHERE id = ?').run(found.message.id);
    publish(found.channel, {
      t: 'message.delete',
      channelId: found.channel.id,
      messageId: found.message.id,
    });
    return reply.code(204).send();
  });

  // ---- reactions (the emoji itself is encrypted, the server only stores blobs) ---------------

  app.post(
    '/api/messages/:id/reactions',
    {
      ...auth,
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
      schema: { body: sealedBody },
    },
    async function (req, reply) {
      const found = loadOwnMessage(req, reply);
      if (!found) return;
      const self = me(req);
      if (!dmWritable(found.channel, self)) return reply.code(403).send({ error: 'not_friends' });
      const body = req.body as {
        iv: string;
        ciphertext: string;
        signature: string;
      };
      const count = (
        db
          .prepare('SELECT COUNT(*) AS n FROM reactions WHERE message_id = ? AND user_id = ?')
          .get(found.message.id, self) as { n: number }
      ).n;
      if (count >= 12) return reply.code(429).send({ error: 'too_many_reactions' });
      const reaction: ReactionRow = {
        id: randomUUID(),
        message_id: found.message.id,
        user_id: self,
        ...body,
      };
      db.prepare(
        'INSERT INTO reactions (id, message_id, user_id, iv, ciphertext, signature, created_at) VALUES (?,?,?,?,?,?,?)',
      ).run(
        reaction.id,
        reaction.message_id,
        self,
        body.iv,
        body.ciphertext,
        body.signature,
        Date.now(),
      );
      publish(found.channel, {
        t: 'reaction.add',
        channelId: found.channel.id,
        reaction: reactionOut(reaction),
      });
      return reply.code(201).send({ reaction: reactionOut(reaction) });
    },
  );

  app.delete('/api/reactions/:id', auth, async function (req, reply) {
    const reaction = db
      .prepare('SELECT * FROM reactions WHERE id = ?')
      .get((req.params as { id: string }).id) as ReactionRow | undefined;
    if (!reaction || reaction.user_id !== me(req))
      return reply.code(404).send({ error: 'not_found' });
    const message = db
      .prepare('SELECT channel_id FROM messages WHERE id = ?')
      .get(reaction.message_id) as { channel_id: string } | undefined;
    const channel = message ? getChannel(db, message.channel_id) : undefined;
    db.prepare('DELETE FROM reactions WHERE id = ?').run(reaction.id);
    if (channel) {
      publish(channel, {
        t: 'reaction.remove',
        channelId: channel.id,
        messageId: reaction.message_id,
        reactionId: reaction.id,
      });
    }
    return reply.code(204).send();
  });

  // ---- encrypted attachments ----------------------------------------------------------------

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: config.maxUploadBytes + 1024 },
    function (_req, body, done) {
      return done(null, body);
    },
  );

  app.post(
    '/api/channels/:id/files',
    {
      ...auth,
      bodyLimit: config.maxUploadBytes + 1024,
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    },
    async function (req, reply) {
      const self = me(req);
      const channel = requireChannel(req, reply, (req.params as { id: string }).id);
      if (!channel) return;
      if (!dmWritable(channel, self)) return reply.code(403).send({ error: 'not_friends' });
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length < 17 || body.length > config.maxUploadBytes) {
        return reply.code(400).send({ error: 'invalid_file' });
      }
      // Quota: nobody can fill the disk with uploads (a limit of bytes in the last day and one of files in total).
      const used = db
        .prepare(
          'SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS n FROM files WHERE uploader_id = ? AND created_at > ?',
        )
        .get(self, Date.now() - 24 * 60 * 60 * 1000) as {
        bytes: number;
        n: number;
      };
      if (used.bytes + body.length > config.maxUploadBytes * 20 || used.n >= 300) {
        return reply.code(429).send({ error: 'upload_quota' });
      }
      const id = randomUUID();
      fs.mkdirSync(config.uploadDir, { recursive: true });
      await fs.promises.writeFile(path.join(config.uploadDir, id), body, {
        mode: 0o600,
      });
      db.prepare(
        'INSERT INTO files (id, channel_id, uploader_id, size, created_at) VALUES (?,?,?,?,?)',
      ).run(id, channel.id, self, body.length, Date.now());
      return reply.code(201).send({ fileId: id, size: body.length });
    },
  );

  app.get('/api/files/:id', auth, async function (req, reply) {
    const file = db
      .prepare('SELECT * FROM files WHERE id = ?')
      .get((req.params as { id: string }).id) as { id: string; channel_id: string } | undefined;
    const channel = file ? getChannel(db, file.channel_id) : undefined;
    if (!file || !channel || !canAccessChannel(db, channel, me(req))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const data = await fs.promises.readFile(path.join(config.uploadDir, file.id));
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .send(data);
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
  });

  // ---- WebRTC ICE configuration -------------------------------------------------------------

  /**
   * GET /api/rtc/config: the ICE servers of a call and the relay policy.
   * ! FAIL CLOSED: when relay-only calls are requested but no TURN relay is configured the answer is 503, never a
   * ! STUN-only list, because a STUN server would let the browsers connect directly and show their addresses. In
   * relay-only mode no STUN server is listed at all (the relay is the only thing a browser may contact).
   */
  app.get('/api/rtc/config', auth, async function (req, reply) {
    if (relayProblem(config)) {
      req.log.error('relay-only calls are requested but no TURN relay is configured');
      return reply.code(503).send({ error: 'relay_unavailable' });
    }
    const iceServers: {
      urls: string | string[];
      username?: string;
      credential?: string;
    }[] = config.relayOnly || !config.stunUrls.length ? [] : [{ urls: config.stunUrls }];
    let expiresAt = 0;
    if (config.turn) {
      // The relay also answers STUN: the same addresses without the transport.
      if (!config.relayOnly) {
        iceServers.push({
          urls: [
            ...new Set(
              config.turn.urls.map(function asStun(url) {
                return url.replace(/^turns?:/, 'stun:').replace(/\?.*$/, '');
              }),
            ),
          ],
        });
      }
      // ! coturn "use-auth-secret" scheme: short-lived credentials, never a shared static password.
      expiresAt = Math.floor(Date.now() / 1000) + config.turn.ttlSec;
      const username = `${expiresAt}:${me(req)}`;
      const credential = createHmac('sha1', config.turn.secret).update(username).digest('base64');
      iceServers.push({ urls: config.turn.urls, username, credential });
    } else if (config.cloudflareTurn) {
      const cf = config.cloudflareTurn;
      try {
        const response = await (config.fetch ?? fetch)(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cf.keyId)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${cf.apiToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: cf.ttlSec }),
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!response.ok) throw new Error(`Cloudflare TURN answered ${response.status}`);
        const body = (await response.json()) as { iceServers?: unknown };
        // Cloudflare has answered both one object and a list of them.
        const servers = (Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers]) as {
          urls?: string | string[];
          username?: string;
          credential?: string;
        }[];
        for (const server of servers) {
          if (!server || !server.urls) continue;
          // ? Port 53 is blocked by browsers (Firefox waits for it until the call times out); relay-only keeps no STUN.
          const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(function usable(url) {
            return !/:53(\?|$)/.test(url) && (!config.relayOnly || /^turns?:/.test(url));
          });
          if (!urls.length) continue;
          iceServers.push(
            server.username ? { urls, username: server.username, credential: server.credential } : { urls },
          );
        }
        expiresAt = Math.floor(Date.now() / 1000) + cf.ttlSec;
      } catch (error) {
        req.log.error({ err: error }, 'Cloudflare TURN credentials could not be obtained');
        // ! FAIL CLOSED here too: relay-only never falls back to a list without the relay.
        if (config.relayOnly) return reply.code(503).send({ error: 'relay_unavailable' });
      }
    }
    return {
      iceServers,
      relayOnly: config.relayOnly,
      ttlSec: config.turn?.ttlSec ?? config.cloudflareTurn?.ttlSec ?? 0,
      expiresAt: expiresAt * 1000,
    };
  });
}
