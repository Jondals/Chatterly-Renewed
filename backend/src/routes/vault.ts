/**
 * src/routes/vault.ts
 * The personal library of a person: the pictures and animations they keep on their account (for now, the backgrounds of
 * their camera in calls), so every device they sign in on has them.
 *
 * * Everything is END-TO-END ENCRYPTED and only the owner can open it. The browser encrypts the file with a random
 * AES-256-GCM key, seals that key and the description of the file (name, type, size, a small thumbnail) with a key that
 * comes from the identity of the person, and sends the server three opaque things. The server cannot read any of them and
 * does not know what the file is: it only holds ciphertext and sees its size and the time.
 * ! The browser makes the id of every item and binds it into the encryption (the "additional data" of AES-GCM), so a server
 * that swapped the bytes, the key or the description of two items would make them fail to open instead of showing the wrong one.
 * ? There are limits (items per person, bytes per item, bytes per person) so the library cannot be used to fill the disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { callerId } from '../validation';

/** The most items one person can keep. */
const MAX_VAULT_ITEMS = 40;
/** The most bytes (encrypted) one item may weigh. */
const MAX_VAULT_ITEM_BYTES = 12 * 1024 * 1024;
/** The most bytes (encrypted) one person may keep in all. */
const MAX_VAULT_TOTAL_BYTES = 160 * 1024 * 1024;
/** An AES-GCM file is its 12-byte nonce, the bytes and the 16-byte tag. */
const MIN_ENCRYPTED_BYTES = 12 + 16 + 8;
/** The largest sealed description (base64 characters): a name, a type and a small thumbnail. */
const MAX_META_CHARS = 96 * 1024;
const BASE64_PATTERN = '^[A-Za-z0-9+/]+={0,2}$';
const ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/** Where the ciphertext of an item lives on the disk. */
export function vaultFile(ctx: AppContext, id: string): string {
  return path.join(ctx.config.uploadDir, 'vault', id);
}

/** What one row holds. */
interface VaultRow {
  id: string;
  size: number;
  created_at: number;
  key_iv: string;
  key_ct: string;
  meta_iv: string;
  meta_ct: string;
}

/** Registers the routes of the personal library. */
export function registerVaultRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const me = callerId;
  const auth = { onRequest: [app.authenticate] };

  /** The sealed descriptions and keys of every item of the caller, and what they use. */
  app.get('/api/vault', auth, async function (req) {
    const rows = db
      .prepare(
        'SELECT id, size, created_at, key_iv, key_ct, meta_iv, meta_ct FROM vault_items WHERE owner_id = ? ORDER BY created_at DESC',
      )
      .all(me(req)) as VaultRow[];
    return {
      items: rows.map(function describe(row) {
        return {
          id: row.id,
          size: row.size,
          createdAt: row.created_at,
          key: { iv: row.key_iv, ciphertext: row.key_ct },
          meta: { iv: row.meta_iv, ciphertext: row.meta_ct },
        };
      }),
      used: rows.reduce(function add(total, row) {
        return total + row.size;
      }, 0),
      limits: {
        items: MAX_VAULT_ITEMS,
        itemBytes: MAX_VAULT_ITEM_BYTES,
        totalBytes: MAX_VAULT_TOTAL_BYTES,
      },
    };
  });

  /**
   * Stores one item: the encrypted bytes are the body, the sealed key and description travel in the query. The id is
   * made by the browser (it is part of what the encryption is bound to), and an id that already exists is refused.
   */
  app.post(
    '/api/vault',
    {
      ...auth,
      bodyLimit: MAX_VAULT_ITEM_BYTES + 1024,
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
      schema: {
        querystring: {
          type: 'object',
          required: ['id', 'ki', 'kc', 'mi', 'mc'],
          additionalProperties: false,
          properties: {
            id: { type: 'string', pattern: ID_PATTERN },
            ki: { type: 'string', minLength: 8, maxLength: 64, pattern: BASE64_PATTERN },
            kc: { type: 'string', minLength: 16, maxLength: 256, pattern: BASE64_PATTERN },
            mi: { type: 'string', minLength: 8, maxLength: 64, pattern: BASE64_PATTERN },
            mc: {
              type: 'string',
              minLength: 16,
              maxLength: MAX_META_CHARS,
              pattern: BASE64_PATTERN,
            },
          },
        },
      },
    },
    async function (req, reply) {
      const owner = me(req);
      const q = req.query as { id: string; ki: string; kc: string; mi: string; mc: string };
      const body = req.body;
      if (
        !Buffer.isBuffer(body) ||
        body.length < MIN_ENCRYPTED_BYTES ||
        body.length > MAX_VAULT_ITEM_BYTES
      ) {
        return reply.code(400).send({ error: 'invalid_item' });
      }
      const totals = db
        .prepare(
          'SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM vault_items WHERE owner_id = ?',
        )
        .get(owner) as { n: number; bytes: number };
      if (totals.n >= MAX_VAULT_ITEMS) return reply.code(429).send({ error: 'too_many_items' });
      if (totals.bytes + body.length > MAX_VAULT_TOTAL_BYTES) {
        return reply.code(413).send({ error: 'library_full' });
      }
      if (db.prepare('SELECT 1 FROM vault_items WHERE id = ?').get(q.id)) {
        return reply.code(409).send({ error: 'id_taken' });
      }
      fs.mkdirSync(path.dirname(vaultFile(ctx, q.id)), { recursive: true });
      await fs.promises.writeFile(vaultFile(ctx, q.id), body, { mode: 0o600, flag: 'wx' });
      try {
        db.prepare(
          'INSERT INTO vault_items (id, owner_id, size, created_at, key_iv, key_ct, meta_iv, meta_ct) VALUES (?,?,?,?,?,?,?,?)',
        ).run(q.id, owner, body.length, Date.now(), q.ki, q.kc, q.mi, q.mc);
      } catch (error) {
        // * No row, no file: an upload that cannot be recorded must not leave bytes on the disk.
        await fs.promises.rm(vaultFile(ctx, q.id), { force: true });
        throw error;
      }
      return reply.code(201).send({ id: q.id });
    },
  );

  /** The encrypted bytes of one item (only to its owner). */
  app.get('/api/vault/:id', auth, async function (req, reply) {
    const id = (req.params as { id: string }).id;
    // ! Only a well-formed id reaches the disk path.
    const row =
      new RegExp(ID_PATTERN).test(id) &&
      db.prepare('SELECT 1 FROM vault_items WHERE id = ? AND owner_id = ?').get(id, me(req));
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const data = await fs.promises.readFile(vaultFile(ctx, id));
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Cache-Control', 'private, no-store')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .send(data);
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
  });

  /** Removes one item (row and file). */
  app.delete('/api/vault/:id', auth, async function (req, reply) {
    const id = (req.params as { id: string }).id;
    const removed = db
      .prepare('DELETE FROM vault_items WHERE id = ? AND owner_id = ?')
      .run(id, me(req)).changes;
    if (!removed) return reply.code(404).send({ error: 'not_found' });
    await fs.promises.rm(vaultFile(ctx, id), { force: true });
    return reply.code(204).send();
  });

  /** Removes every item of the caller (the button "remove all from my account"). */
  app.delete('/api/vault', auth, async function (req, reply) {
    const owner = me(req);
    const ids = (
      db.prepare('SELECT id FROM vault_items WHERE owner_id = ?').all(owner) as { id: string }[]
    ).map(function idOf(row) {
      return row.id;
    });
    db.prepare('DELETE FROM vault_items WHERE owner_id = ?').run(owner);
    for (const id of ids) await fs.promises.rm(vaultFile(ctx, id), { force: true });
    return reply.code(204).send();
  });
}
