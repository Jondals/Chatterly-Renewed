/**
 * src/routes/images.ts
 * Upload and download of profile pictures, banners and group icons.
 *
 * * Every picture is END-TO-END ENCRYPTED: the browser encrypts it with a random key and the server stores only ciphertext.
 * The key of a profile picture or banner is sealed once for each person who may see it (table image_keys) with the pair
 * key of the owner and that person. The key of a group icon is sealed with the key of the group (it travels with the group,
 * see routes/guilds.ts) and the server hands the icon only to the members of that group. The server cannot open any of them.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { callerId } from '../validation';
import { canSeeProfile, profileAudience } from '../models';

export const IMAGE_KINDS = ['avatar', 'banner', 'group'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

const MAX_IMAGES_PER_USER = 30;
/** An AES-GCM picture is its 12-byte nonce, the bytes and the 16-byte tag. */
const MIN_ENCRYPTED_BYTES = 12 + 16 + 8;
/** Most people one picture can be sealed for in one request. */
const MAX_KEYS_PER_REQUEST = 1000;
const BASE64_PATTERN = '^[A-Za-z0-9+/]+={0,2}$';

export function imageFile(ctx: AppContext, id: string): string {
  return path.join(ctx.config.uploadDir, 'images', id);
}

/** Removes an uploaded image (row + file) when nothing references it any more. */
export function deleteImage(ctx: AppContext, id: string | null | undefined): void {
  if (!id) return;
  ctx.db.prepare('DELETE FROM images WHERE id = ?').run(id);
  fs.rm(imageFile(ctx, id), { force: true }, function () {
    return undefined;
  });
}

/** True when `id` is an image of `kind` uploaded by `ownerId` (a group icon must also be one of the group `guildId`). */
export function ownsImage(
  ctx: AppContext,
  id: string,
  ownerId: string,
  kind: ImageKind,
  guildId?: string,
): boolean {
  return !!ctx.db
    .prepare(
      'SELECT 1 FROM images WHERE id = ? AND owner_id = ? AND kind = ? AND (? IS NULL OR guild_id = ?)',
    )
    .get(id, ownerId, kind, guildId ?? null, guildId ?? null);
}

export function registerImageRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const me = callerId;
  const auth = { onRequest: [app.authenticate] };

  // ! Every picture arrives as ciphertext (the server cannot look inside, so it only bounds the size). A group icon names
  // the group it is for, and only the owner of that group may upload it.
  app.post(
    '/api/images',
    {
      ...auth,
      bodyLimit: config.maxImageBytes + 1024,
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
      schema: {
        querystring: {
          type: 'object',
          required: ['kind'],
          properties: {
            kind: { type: 'string', enum: [...IMAGE_KINDS] },
            guild: {
              type: 'string',
              pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            },
          },
        },
      },
    },
    async function (req, reply) {
      const owner = me(req);
      const { kind, guild } = req.query as { kind: ImageKind; guild?: string };
      const body = req.body;
      if (
        !Buffer.isBuffer(body) ||
        body.length < MIN_ENCRYPTED_BYTES ||
        body.length > config.maxImageBytes
      ) {
        return reply.code(400).send({ error: 'invalid_image' });
      }
      if (
        kind === 'group' &&
        !(
          guild &&
          db.prepare('SELECT 1 FROM guilds WHERE id = ? AND owner_id = ?').get(guild, owner)
        )
      ) {
        return reply.code(403).send({ error: 'owner_only' });
      }
      const count = (
        db.prepare('SELECT COUNT(*) AS n FROM images WHERE owner_id = ?').get(owner) as {
          n: number;
        }
      ).n;
      if (count >= MAX_IMAGES_PER_USER) return reply.code(429).send({ error: 'too_many_images' });
      const id = randomUUID();
      fs.mkdirSync(path.dirname(imageFile(ctx, id)), { recursive: true });
      await fs.promises.writeFile(imageFile(ctx, id), body, { mode: 0o600 });
      try {
        db.prepare(
          "INSERT INTO images (id, owner_id, kind, mime, size, created_at, encrypted, guild_id) VALUES (?,?,?,'application/octet-stream',?,?,1,?)",
        ).run(id, owner, kind, body.length, Date.now(), kind === 'group' ? guild : null);
      } catch (error) {
        // * No row, no file: an upload that cannot be recorded must not leave bytes on the disk.
        await fs.promises.rm(imageFile(ctx, id), { force: true });
        throw error;
      }
      return reply.code(201).send({ id });
    },
  );

  /** Who may see a picture of this person and does not hold its key yet (with their public key, to seal it for them). */
  app.get('/api/images/:id/audience', auth, async function (req, reply) {
    const id = (req.params as { id: string }).id;
    const row = db
      .prepare("SELECT owner_id FROM images WHERE id = ? AND encrypted = 1 AND kind <> 'group'")
      .get(id) as { owner_id: string } | undefined;
    if (!row || row.owner_id !== me(req)) return reply.code(404).send({ error: 'not_found' });
    const have = new Set(
      (
        db.prepare('SELECT viewer_id FROM image_keys WHERE image_id = ?').all(id) as {
          viewer_id: string;
        }[]
      ).map(function (entry) {
        return entry.viewer_id;
      }),
    );
    const lookup = db.prepare('SELECT pub_ecdh FROM users WHERE id = ? AND deleted_at IS NULL');
    const missing: { id: string; ecdh: string }[] = [];
    for (const viewer of [row.owner_id, ...profileAudience(db, row.owner_id)]) {
      if (have.has(viewer)) continue;
      const user = lookup.get(viewer) as { pub_ecdh: string } | undefined;
      if (user) missing.push({ id: viewer, ecdh: user.pub_ecdh });
    }
    return { missing };
  });

  /** The owner seals the key of a picture for the people who may see it. */
  app.put(
    '/api/images/:id/keys',
    {
      ...auth,
      bodyLimit: 512 * 1024,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          required: ['keys'],
          additionalProperties: false,
          properties: {
            keys: {
              type: 'array',
              maxItems: MAX_KEYS_PER_REQUEST,
              items: {
                type: 'object',
                required: ['viewerId', 'iv', 'ciphertext'],
                additionalProperties: false,
                properties: {
                  viewerId: { type: 'string', maxLength: 64 },
                  iv: {
                    type: 'string',
                    maxLength: 64,
                    pattern: BASE64_PATTERN,
                  },
                  ciphertext: {
                    type: 'string',
                    maxLength: 512,
                    pattern: BASE64_PATTERN,
                  },
                },
              },
            },
          },
        },
      },
    },
    async function (req, reply) {
      const id = (req.params as { id: string }).id;
      const owner = me(req);
      const row = db
        .prepare("SELECT owner_id FROM images WHERE id = ? AND encrypted = 1 AND kind <> 'group'")
        .get(id) as { owner_id: string } | undefined;
      if (!row || row.owner_id !== owner) return reply.code(404).send({ error: 'not_found' });
      const allowed = new Set([owner, ...profileAudience(db, owner)]);
      const keys = (
        req.body as {
          keys: { viewerId: string; iv: string; ciphertext: string }[];
        }
      ).keys.filter(function (entry) {
        return allowed.has(entry.viewerId);
      });
      const insert = db.prepare(
        'INSERT OR REPLACE INTO image_keys (image_id, viewer_id, iv, ciphertext) VALUES (?,?,?,?)',
      );
      db.transaction(function store() {
        for (const entry of keys) insert.run(id, entry.viewerId, entry.iv, entry.ciphertext);
      })();
      return { stored: keys.length };
    },
  );

  /**
   * An encrypted picture and the key sealed for the caller, in ONE answer (the page asks for dozens of pictures when it
   * opens, and one request each keeps the rate limit and the waiting low). 404 when there is no key for the caller.
   */
  app.get('/api/images/:id/open', auth, async function (req, reply) {
    const id = (req.params as { id: string }).id;
    const row = db
      .prepare(
        `SELECT k.iv, k.ciphertext, u.pub_ecdh AS owner_ecdh, u.id AS owner_id
           FROM image_keys k JOIN images i ON i.id = k.image_id JOIN users u ON u.id = i.owner_id
          WHERE k.image_id = ? AND k.viewer_id = ? AND i.encrypted = 1`,
      )
      .get(id, me(req)) as
      { iv: string; ciphertext: string; owner_ecdh: string; owner_id: string } | undefined;
    // ! The sealed key is not enough: the person must still be somebody who may see the pictures of the owner.
    if (!row || !canSeeProfile(db, row.owner_id, me(req))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const data = await fs.promises.readFile(imageFile(ctx, id));
      return {
        iv: row.iv,
        ciphertext: row.ciphertext,
        ownerEcdh: row.owner_ecdh,
        data: data.toString('base64'),
      };
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
  });

  app.get('/api/images/:id', auth, async function (req, reply) {
    const id = (req.params as { id: string }).id;
    const row = db
      .prepare('SELECT mime, encrypted, owner_id, kind, guild_id FROM images WHERE id = ?')
      .get(id) as
      | { mime: string; encrypted: number; owner_id: string; kind: string; guild_id: string | null }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    // ! A group icon is handed only to the members of its group (and to the owner while it is not the icon of a group yet).
    if (
      row.kind === 'group' &&
      row.owner_id !== me(req) &&
      !(
        row.guild_id &&
        db
          .prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?')
          .get(row.guild_id, me(req))
      )
    ) {
      return reply.code(404).send({ error: 'not_found' });
    }
    // ! A profile picture or banner is handed only to the people it was sealed for: to anyone else it does not exist.
    if (
      row.kind !== 'group' &&
      row.encrypted &&
      (!db
        .prepare('SELECT 1 FROM image_keys WHERE image_id = ? AND viewer_id = ?')
        .get(id, me(req)) ||
        !canSeeProfile(db, row.owner_id, me(req)))
    ) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const data = await fs.promises.readFile(imageFile(ctx, id));
      return reply
        .header('Content-Type', row.mime)
        .header(
          'Cache-Control',
          row.encrypted ? 'private, max-age=3600' : 'private, max-age=31536000, immutable',
        )
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .send(data);
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
  });
}
