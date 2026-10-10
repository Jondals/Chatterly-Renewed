/**
 * src/routes/settings-sync.ts
 * The settings of a person, kept on their account so that a new device starts with them.
 *
 * * The server only keeps a sealed blob: the browser encrypts the settings with a key that comes from the identity of the
 * person (it cannot be derived by anybody else), so the server cannot read them. It does not know what the settings are.
 * ? Two devices may save at nearly the same time: every save says which version it was made on, and a save made on an old
 * version is refused with 409, so the device loads the new one, merges and saves again (nothing is lost silently).
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { callerId } from '../validation';

/** The largest sealed blob (base64 characters): the settings are small; this leaves room for several profiles. */
const MAX_BLOB_CHARS = 262_144;
const BASE64_PATTERN = '^[A-Za-z0-9+/]*={0,2}$';

/** What is stored. */
interface SealedSettings {
  iv: string;
  ciphertext: string;
  updated_at: number;
}

/** Registers the routes of the settings of the account. */
export function registerSettingsSyncRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;
  const me = callerId;
  const auth = { onRequest: [app.authenticate] };

  app.get('/api/me/settings', auth, async function (req) {
    const row = db
      .prepare('SELECT iv, ciphertext, updated_at FROM settings_blobs WHERE user_id = ?')
      .get(me(req)) as SealedSettings | undefined;
    // ? Nothing saved yet is a normal answer (not a 404: the browser would print an error in its console).
    if (!row) return { empty: true };
    return { iv: row.iv, ciphertext: row.ciphertext, updatedAt: row.updated_at };
  });

  app.put(
    '/api/me/settings',
    {
      ...auth,
      bodyLimit: MAX_BLOB_CHARS + 4096,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          required: ['iv', 'ciphertext', 'base'],
          additionalProperties: false,
          properties: {
            iv: { type: 'string', minLength: 8, maxLength: 64, pattern: BASE64_PATTERN },
            ciphertext: {
              type: 'string',
              minLength: 16,
              maxLength: MAX_BLOB_CHARS,
              pattern: BASE64_PATTERN,
            },
            // The version this save was made on (0 when the device had none).
            base: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async function (req, reply) {
      const owner = me(req);
      const body = req.body as { iv: string; ciphertext: string; base: number };
      const now = Date.now();
      const current = db
        .prepare('SELECT updated_at FROM settings_blobs WHERE user_id = ?')
        .get(owner) as { updated_at: number } | undefined;
      if (current && current.updated_at !== body.base) {
        return reply.code(409).send({ error: 'conflict', updatedAt: current.updated_at });
      }
      // Always later than the one before (two saves in the same millisecond must not look like the same version).
      const version = Math.max(now, (current?.updated_at ?? 0) + 1);
      db.prepare(
        `INSERT INTO settings_blobs (user_id, iv, ciphertext, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      ).run(owner, body.iv, body.ciphertext, version);
      return { updatedAt: version };
    },
  );
}
