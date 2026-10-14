/**
 * src/routes/auth.ts
 * Registration, zero-knowledge sign in, token renewal and sign out, and profile editing.
 */
import { createHash, createPublicKey, createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { getUser, toPublicUser, toSelfUser, profileAudience, type UserRow } from '../models';
import { refreshServerTag } from '../server-tag';
import { hashAuthSecret, verifyAuthSecret, needsUpgrade } from '../security/password';
import { deleteImage, imageFile, ownsImage } from './images';
import { vaultFile } from './vault';
import {
  authSecretField,
  b64Field,
  publicKeyField,
  usernameField,
  callerId,
  cleanText,
} from '../validation';

const ACCENTS = [
  'mint',
  'violet',
  'coral',
  'quantum',
  'obsidian',
  'rose',
  'amber',
  'lime',
  'indigo',
  'custom',
] as const;
/** The animations a name can have (the same list as NAME_FX in the web app). */
const NAME_FX = [
  'none',
  'float',
  'bounce',
  'pulse',
  'shake',
  'swing',
  'glow',
  'neon',
  'glitch',
  'flip',
  'sparkle',
  'jump',
  'jelly',
  'drift',
  'twinkle',
  'wave',
  'aurora',
  'shimmer',
  'pop',
  'toon',
  'ember',
] as const;
const NAME_FONTS = [
  'default',
  'display',
  'tech',
  'serif',
  'mono',
  'hand',
  'script',
  'arcade',
  'orbit',
  'elegant',
  'condensed',
  'marker',
  'rounded',
  // The font the person uploaded themselves (it is drawn on their own device).
  'custom',
] as const;
const HEX = '^#[0-9a-fA-F]{6}$';
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const AURAS = [
  'void',
  'prism',
  'pulse',
  'orbit',
  'dashed',
  'double',
  'glow',
  'ticks',
  'glitch',
  'rainbow',
  'comet',
  'nebula',
  // Older effects: still accepted so existing profiles keep working.
  'solar',
  'aurora',
  'ocean',
  'neon',
  'sakura',
  'lava',
  'ice',
  'gold',
  'matrix',
  'galaxy',
] as const;

const sha256 = function (value: string) {
  return createHash('sha256').update(value).digest('hex');
};

const SPKI_P256_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

/** Rejects points that are not on the P-256 curve (invalid-curve attacks). */
function isValidP256Point(b64: string): boolean {
  try {
    const raw = Buffer.from(b64, 'base64');
    if (raw.length !== 65 || raw[0] !== 0x04) return false;
    // Importing as SPKI makes OpenSSL verify the point really lies on the curve.
    createPublicKey({
      key: Buffer.concat([SPKI_P256_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    return true;
  } catch {
    return false;
  }
}

const wrappedField = b64Field(100, 1024);

const wrappedKeysSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ecdh', 'ecdsa'],
  properties: { ecdh: wrappedField, ecdsa: wrappedField },
} as const;

const registerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'authSecret', 'kdfSalt', 'kdfIterations', 'publicKeys', 'wrappedKeys'],
    properties: {
      username: usernameField,
      displayName: { type: 'string', minLength: 1, maxLength: 32 },
      authSecret: authSecretField,
      kdfSalt: b64Field(16, 64),
      kdfIterations: { type: 'integer', maximum: 5_000_000 },
      publicKeys: {
        type: 'object',
        additionalProperties: false,
        required: ['ecdh', 'ecdsa'],
        properties: { ecdh: publicKeyField, ecdsa: publicKeyField },
      },
      wrappedKeys: wrappedKeysSchema,
    },
  },
} as const;

const clean = cleanText;

/** Does nothing (the answer of a file removal that nobody waits for). */
function noop(): void {
  return;
}

/**
 * ! Registers the routes of the accounts: sign-up, sign-in, sessions, profile and password. Passwords are never received in clear.
 */
export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const authLimit = {
    config: {
      rateLimit: {
        max: config.rateLimit.authMax,
        timeWindow: config.rateLimit.windowMs,
      },
    },
  };

  /**
   * Creates the pair of tokens of a session: a short access token and a long refresh token that is stored only as a hash.
   * The access token names its session (`sid`), so closing the session revokes the token at once. Renewing a session
   * (`renewing`) keeps its id and only replaces the refresh token, so the access tokens in flight stay valid.
   *
   * @param userId Owner of the session.
   * @param sessionId Id of the session: a fresh one by default, or the one being renewed.
   * @param renewing True when the session already exists and only its refresh token changes.
   */
  function issueTokens(userId: string, sessionId: string = randomUUID(), renewing = false) {
    const accessToken = app.jwt.sign(
      { sub: userId, sid: sessionId },
      { expiresIn: config.accessTtlSec },
    );
    const refreshToken = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = now + config.refreshTtlSec * 1000;
    if (renewing) {
      db.prepare('UPDATE sessions SET token_hash = ?, expires_at = ? WHERE id = ?').run(
        sha256(refreshToken),
        expiresAt,
        sessionId,
      );
    } else {
      db.prepare(
        'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)',
      ).run(sessionId, userId, sha256(refreshToken), expiresAt, now);
    }
    // Opportunistic cleanup of dead sessions, and a limit of 20 open ones per person (the oldest close first).
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    db.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20)',
    ).run(userId, userId);
    return { accessToken, refreshToken, expiresIn: config.accessTtlSec };
  }

  const userId = callerId;

  // Pre-login: the client needs its salt to stretch the password. Unknown users get a stable
  // fake salt so the endpoint cannot be used to enumerate accounts.
  app.get(
    '/api/auth/kdf',
    {
      ...authLimit,
      schema: {
        querystring: {
          type: 'object',
          required: ['username'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    /**
     * GET /api/auth/kdf: the salt and the cost with which the browser derives its keys for a username (a fake one for unknown names, so nobody can tell which exist).
     */
    async function (req) {
      const { username } = req.query as { username: string };
      const row = db
        .prepare('SELECT kdf_salt, kdf_iterations FROM users WHERE username = ?')
        .get(username) as { kdf_salt: string; kdf_iterations: number } | undefined;
      if (row) return { salt: row.kdf_salt, iterations: row.kdf_iterations };
      const fake = createHmac('sha256', config.serverSecret)
        .update('kdf-salt:' + username.toLowerCase())
        .digest()
        .subarray(0, 16);
      return {
        salt: fake.toString('base64'),
        iterations: Math.max(config.minKdfIterations, 600_000),
      };
    },
  );

  app.post(
    '/api/auth/register',
    { ...authLimit, schema: registerSchema },
    /**
     * POST /api/auth/register: creates an account from the public keys and the proof of the password derived in the browser.
     */
    async function (req, reply) {
      const body = req.body as {
        username: string;
        displayName?: string;
        authSecret: string;
        kdfSalt: string;
        kdfIterations: number;
        publicKeys: { ecdh: string; ecdsa: string };
        wrappedKeys: { ecdh: string; ecdsa: string };
      };
      if (body.kdfIterations < config.minKdfIterations) {
        return reply.code(400).send({
          error: 'kdf_too_weak',
          minIterations: config.minKdfIterations,
        });
      }
      if (!isValidP256Point(body.publicKeys.ecdh) || !isValidP256Point(body.publicKeys.ecdsa)) {
        return reply.code(400).send({ error: 'invalid_public_key' });
      }
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) {
        return reply.code(409).send({ error: 'username_taken' });
      }
      const id = randomUUID();
      const authHash = await hashAuthSecret(body.authSecret, config.scrypt, config.serverSecret);
      const colors = ['#2ef2b0', '#a78bfa', '#fb7185', '#38bdf8', '#fbbf24'];
      try {
        db.prepare(
          `INSERT INTO users (id, username, display_name, auth_hash, kdf_salt, kdf_iterations,
           pub_ecdh, pub_ecdsa, wrapped_ecdh, wrapped_ecdsa, avatar_color, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          body.username,
          clean(body.displayName ?? body.username) || body.username,
          authHash,
          body.kdfSalt,
          body.kdfIterations,
          body.publicKeys.ecdh,
          body.publicKeys.ecdsa,
          body.wrappedKeys.ecdh,
          body.wrappedKeys.ecdsa,
          colors[randomBytes(1)[0]! % colors.length],
          Date.now(),
        );
      } catch {
        return reply.code(409).send({ error: 'username_taken' });
      }
      const row = getUser(db, id)!;
      return reply.code(201).send({ user: toSelfUser(row), ...issueTokens(id) });
    },
  );

  // A throwaway hash so unknown usernames cost the same CPU time as wrong passwords.
  let dummyHash: Promise<string> | undefined;

  app.post(
    '/api/auth/login',
    {
      ...authLimit,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'authSecret'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
            authSecret: authSecretField,
          },
        },
      },
    },
    /**
     * POST /api/auth/login: checks the proof of the password (slow hash, locked after several failures) and opens a session.
     */
    async function (req, reply) {
      const { username, authSecret } = req.body as {
        username: string;
        authSecret: string;
      };
      const wait = ctx.throttle.retryAfter(username);
      if (wait > 0) {
        return reply
          .code(429)
          .header('Retry-After', String(wait))
          .send({ error: 'account_locked', retryAfter: wait });
      }
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
        UserRow | undefined;
      let ok = false;
      if (row) {
        ok = await verifyAuthSecret(authSecret, row.auth_hash, config.serverSecret);
      } else {
        dummyHash ??= hashAuthSecret('x', config.scrypt, config.serverSecret);
        await verifyAuthSecret(authSecret, await dummyHash, config.serverSecret);
      }
      if (!row || !ok) {
        ctx.throttle.recordFailure(username);
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      ctx.throttle.recordSuccess(username);
      // A hash made before the pepper existed is made again now that the proof of the password is at hand.
      if (needsUpgrade(row.auth_hash)) {
        db.prepare('UPDATE users SET auth_hash = ? WHERE id = ?').run(
          await hashAuthSecret(authSecret, config.scrypt, config.serverSecret),
          row.id,
        );
      }
      return {
        user: toSelfUser(row),
        wrappedKeys: { ecdh: row.wrapped_ecdh, ecdsa: row.wrapped_ecdsa },
        ...issueTokens(row.id),
      };
    },
  );

  app.post(
    '/api/auth/refresh',
    {
      ...authLimit,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string', minLength: 20, maxLength: 128 },
          },
        },
      },
    },
    /**
     * POST /api/auth/refresh: gives a new pair of tokens and cancels the old one (a refresh token works once: reusing it closes every session of the account).
     */
    async function (req, reply) {
      const { refreshToken } = req.body as { refreshToken: string };
      const session = db
        .prepare('SELECT * FROM sessions WHERE token_hash = ?')
        .get(sha256(refreshToken)) as
        { id: string; user_id: string; expires_at: number } | undefined;
      if (!session) {
        // ! Reusing a token that was already rotated means it was copied: every session of that account is closed.
        const spent = db
          .prepare('SELECT user_id FROM spent_tokens WHERE token_hash = ?')
          .get(sha256(refreshToken)) as { user_id: string } | undefined;
        if (spent) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(spent.user_id);
          ctx.hub.closeSessions(spent.user_id);
        }
        return reply.code(401).send({ error: 'invalid_refresh_token' });
      }
      if (session.expires_at < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
        return reply.code(401).send({ error: 'invalid_refresh_token' });
      }
      // ! Rotation: a refresh token works exactly once. The session keeps its id, only the refresh token changes.
      db.prepare(
        'INSERT OR IGNORE INTO spent_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      ).run(sha256(refreshToken), session.user_id, session.expires_at);
      db.prepare('DELETE FROM spent_tokens WHERE expires_at < ?').run(Date.now());
      return issueTokens(session.user_id, session.id, true);
    },
  );

  app.post(
    '/api/auth/logout',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string', maxLength: 128 } },
        },
      },
    },
    /**
     * POST /api/auth/logout: closes the session of a refresh token. Its access token stops working at once and
     * the connections opened with it are closed.
     */
    async function (req, reply) {
      const { refreshToken } = req.body as { refreshToken: string };
      const session = db
        .prepare('SELECT id, user_id FROM sessions WHERE token_hash = ?')
        .get(sha256(refreshToken)) as { id: string; user_id: string } | undefined;
      if (session) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
        ctx.hub.closeSession(session.user_id, session.id);
      }
      return reply.code(204).send();
    },
  );

  // ---- authenticated profile endpoints ------------------------------------------------------

  app.get('/api/me', { onRequest: [app.authenticate] }, async function (req, reply) {
    const row = getUser(db, userId(req));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { user: toSelfUser(row) };
  });

  app.patch(
    '/api/me',
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            displayName: { type: 'string', minLength: 1, maxLength: 32 },
            pronouns: { type: 'string', maxLength: 32 },
            bio: { type: 'string', maxLength: 1000 },
            statusText: { type: 'string', maxLength: 80 },
            accent: { type: 'string', enum: [...ACCENTS] },
            aura: { type: 'string', enum: [...AURAS] },
            auraColor: {
              type: 'string',
              pattern: '^(#[0-9a-fA-F]{6},#[0-9a-fA-F]{6})?$',
            },
            nameFont: { type: 'string', enum: [...NAME_FONTS] },
            nameFx: { type: 'string', enum: [...NAME_FX] },
            avatarColor: { type: 'string', pattern: HEX },
            bannerColor: {
              type: 'string',
              pattern:
                '^(#[0-9a-fA-F]{6}|g:#[0-9a-fA-F]{6},#[0-9a-fA-F]{6},[0-9]{1,3},[0-9]{1,3}(,[0-9]{1,3},[0-9]{1,3}(,#[0-9a-fA-F]{6})?)?|m:[0-9]{1,3}:[0-9]{1,3}:#[0-9a-fA-F]{6}@[0-9]{1,3}(,#[0-9a-fA-F]{6}@[0-9]{1,3}){1,4})?$',
            },
            profileColor: {
              type: 'string',
              pattern:
                '^(#[0-9a-fA-F]{6}|g:#[0-9a-fA-F]{6},#[0-9a-fA-F]{6},[0-9]{1,3}(,[0-9]{1,3},[0-9]{1,3}(,#[0-9a-fA-F]{6})?)?|m:[0-9]{1,3}:[0-9]{1,3}:#[0-9a-fA-F]{6}@[0-9]{1,3}(,#[0-9a-fA-F]{6}@[0-9]{1,3}){1,4})?$',
            },
            presenceVisibility: {
              type: 'string',
              enum: ['everyone', 'friends', 'nobody'],
            },
            friendRequests: { type: 'string', enum: ['everyone', 'nobody'] },
            searchable: { type: 'boolean' },
            avatarImage: { type: ['string', 'null'], pattern: UUID },
            bannerImage: { type: ['string', 'null'], pattern: UUID },
            // The font file of the name (an encrypted upload of kind font), shown to others when nameFont is custom.
            nameFontImage: { type: ['string', 'null'], pattern: UUID },
            // The group whose tag the person shows next to their name (null: none).
            tagGuild: { type: ['string', 'null'], pattern: UUID },
          },
        },
      },
    },
    /** PATCH /api/me: changes the profile; only the listed fields are accepted and every one is validated. */
    async function (req, reply) {
      const id = userId(req);
      const body = req.body as Record<string, string | null>;
      const columns: Record<string, string> = {
        displayName: 'display_name',
        pronouns: 'pronouns',
        bio: 'bio',
        statusText: 'status_text',
        accent: 'accent',
        aura: 'aura',
        auraColor: 'aura_color',
        nameFont: 'name_font',
        nameFx: 'name_fx',
        avatarColor: 'avatar_color',
        bannerColor: 'banner_color',
        profileColor: 'profile_color',
      };
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = body[key];
        if (typeof value === 'string') {
          sets.push(`${column} = ?`);
          // Bio keeps newlines; everything else is single-line.
          values.push(key === 'bio' ? value.replace(/\u0000/g, '') : clean(value));
        }
      }
      // Privacy choices: who sees the person online, who may ask for their friendship, and whether they appear in searches.
      let presenceChanged = false;
      for (const [key, column] of [
        ['presenceVisibility', 'presence_visibility'],
        ['friendRequests', 'friend_requests'],
      ] as const) {
        const value = body[key];
        if (typeof value === 'string') {
          sets.push(`${column} = ?`);
          values.push(value);
          presenceChanged ||= key === 'presenceVisibility';
        }
      }
      const searchable = (body as Record<string, unknown>)['searchable'];
      if (typeof searchable === 'boolean') {
        sets.push('searchable = ?');
        values.push(searchable ? 1 : 0);
      }
      const previous = getUser(db, id)!;
      const orphans: (string | null)[] = [];
      for (const [key, column, kind] of [
        ['avatarImage', 'avatar_image', 'avatar'],
        ['bannerImage', 'banner_image', 'banner'],
        ['nameFontImage', 'name_font_image', 'font'],
      ] as const) {
        if (!(key in body)) continue;
        const next = body[key] ?? null;
        if (next !== null && !ownsImage(ctx, next, id, kind))
          return reply.code(400).send({ error: 'invalid_image' });
        sets.push(`${column} = ?`);
        values.push(next);
        const old = previous[column];
        if (old && old !== next) orphans.push(old);
      }
      if ('tagGuild' in body) {
        sets.push('tag_guild = ?');
        values.push(body['tagGuild'] ?? null);
      }
      if (sets.length)
        db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      if ('tagGuild' in body) refreshServerTag(db, id);
      orphans.forEach(function (o) {
        return deleteImage(ctx, o);
      });
      const row = getUser(db, id)!;
      const user = toPublicUser(row);
      const own = toSelfUser(row);
      // * Everybody who may see the pictures gets the change, also people who only share a direct conversation or a pending request.
      ctx.hub.sendToMany(profileAudience(db, id), { t: 'user.update', user });
      ctx.hub.sendTo(id, { t: 'user.update', user: own });
      // Each person around now gets what the new choice allows them to see (or "offline").
      if (presenceChanged) ctx.hub.refreshPresence(id);
      return { user: own };
    },
  );

  app.post(
    '/api/me/password',
    {
      onRequest: [app.authenticate],
      ...authLimit,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['oldAuthSecret', 'newAuthSecret', 'kdfSalt', 'kdfIterations', 'wrappedKeys'],
          properties: {
            oldAuthSecret: authSecretField,
            newAuthSecret: authSecretField,
            kdfSalt: b64Field(16, 64),
            kdfIterations: { type: 'integer', maximum: 5_000_000 },
            wrappedKeys: wrappedKeysSchema,
          },
        },
      },
    },
    /**
     * POST /api/me/password: changes the password: the old proof is checked and the private keys come re-encrypted from the browser.
     */
    async function (req, reply) {
      const id = userId(req);
      const body = req.body as {
        oldAuthSecret: string;
        newAuthSecret: string;
        kdfSalt: string;
        kdfIterations: number;
        wrappedKeys: { ecdh: string; ecdsa: string };
      };
      // ! A stolen session must not be able to guess the old password: failures lock this action like the sign-in.
      const lockKey = 'password:' + id;
      const wait = ctx.throttle.retryAfter(lockKey);
      if (wait > 0) {
        return reply
          .code(429)
          .header('Retry-After', String(wait))
          .send({ error: 'account_locked', retryAfter: wait });
      }
      const row = getUser(db, id);
      if (
        !row ||
        !(await verifyAuthSecret(body.oldAuthSecret, row.auth_hash, config.serverSecret))
      ) {
        ctx.throttle.recordFailure(lockKey);
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      ctx.throttle.recordSuccess(lockKey);
      if (body.kdfIterations < config.minKdfIterations) {
        return reply.code(400).send({
          error: 'kdf_too_weak',
          minIterations: config.minKdfIterations,
        });
      }
      const authHash = await hashAuthSecret(body.newAuthSecret, config.scrypt, config.serverSecret);
      db.prepare(
        `UPDATE users SET auth_hash = ?, kdf_salt = ?, kdf_iterations = ?, wrapped_ecdh = ?, wrapped_ecdsa = ?
          WHERE id = ?`,
      ).run(
        authHash,
        body.kdfSalt,
        body.kdfIterations,
        body.wrappedKeys.ecdh,
        body.wrappedKeys.ecdsa,
        id,
      );
      // * Every other device must log in again: their sessions end and so do their connections.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      const sessionId = randomUUID();
      const tokens = issueTokens(id, sessionId);
      ctx.hub.closeSessions(id, sessionId);
      return tokens;
    },
  );

  app.post(
    '/api/me/delete',
    {
      onRequest: [app.authenticate],
      ...authLimit,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['authSecret'],
          properties: { authSecret: authSecretField },
        },
      },
    },
    /**
     * ! POST /api/me/delete: erases the account. It asks for the proof of the password again (a stolen session must not be
     * enough). Everything of the person goes: their messages, reactions, files, pictures, friendships, direct
     * conversations, the keys that protect their private data, their sessions and the row of the person itself.
     * Other people keep what is theirs: a group the person owns passes to its longest-standing member (who is asked to
     * renew the group key, because the old owner held it) and is only erased when nobody else is in it. The only thing
     * kept of the person is their public key inside the key envelopes they wrapped for others, so those people can
     * still read their groups until the key is renewed.
     */
    async function (req, reply) {
      const id = userId(req);
      const { authSecret } = req.body as { authSecret: string };
      const lockKey = 'delete:' + id;
      const wait = ctx.throttle.retryAfter(lockKey);
      if (wait > 0) {
        return reply
          .code(429)
          .header('Retry-After', String(wait))
          .send({ error: 'account_locked', retryAfter: wait });
      }
      const row = getUser(db, id);
      if (!row || !(await verifyAuthSecret(authSecret, row.auth_hash, config.serverSecret))) {
        ctx.throttle.recordFailure(lockKey);
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      ctx.throttle.recordSuccess(lockKey);

      // What is read now (whom to tell, what to remove from the disk) cannot be read once the rows are gone.
      const column = function (sql: string, ...args: unknown[]): string[] {
        return (db.prepare(sql).all(...args) as Record<string, string>[]).map(function first(r) {
          return Object.values(r)[0]!;
        });
      };
      const friends = column(
        'SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END FROM friendships WHERE user_a = ? OR user_b = ?',
        id,
        id,
        id,
      );
      const dmChannels = column('SELECT channel_id FROM dm_members WHERE user_id = ?', id);
      const dmPeers = column(
        `SELECT DISTINCT user_id FROM dm_members WHERE user_id != ? AND channel_id IN
           (SELECT channel_id FROM dm_members WHERE user_id = ?)`,
        id,
        id,
      );
      const ownedGuilds = column('SELECT id FROM guilds WHERE owner_id = ?', id);
      // A group with other members is handed to the member who has been in it the longest; one with nobody else goes.
      const heirs = new Map<string, string>();
      for (const guild of ownedGuilds) {
        const heir = db
          .prepare(
            `SELECT user_id FROM guild_members WHERE guild_id = ? AND user_id <> ?
              ORDER BY joined_at, user_id LIMIT 1`,
          )
          .get(guild, id) as { user_id: string } | undefined;
        if (heir) heirs.set(guild, heir.user_id);
      }
      const abandonedGuilds = ownedGuilds.filter(function noHeir(guild) {
        return !heirs.has(guild);
      });
      const joinedGuilds = column(
        "SELECT guild_id FROM guild_members WHERE user_id = ? AND role != 'owner'",
        id,
      );
      const peersOf = function (guilds: string[]): string[] {
        return guilds.flatMap(function members(guild) {
          return column(
            'SELECT user_id FROM guild_members WHERE guild_id = ? AND user_id != ?',
            guild,
            id,
          );
        });
      };
      const inheritedMembers = peersOf([...heirs.keys()]);
      const joinedMembers = peersOf(joinedGuilds);
      const doomedChannels = [
        ...dmChannels,
        ...abandonedGuilds.flatMap(function channels(guild) {
          return column('SELECT id FROM channels WHERE guild_id = ?', guild);
        }),
      ];
      const files = [
        ...column('SELECT id FROM files WHERE uploader_id = ?', id),
        ...doomedChannels.flatMap(function filesOf(channel) {
          return column('SELECT id FROM files WHERE channel_id = ?', channel);
        }),
      ];
      // ? The icon of a group that goes to somebody else stays with the group: it changes hands instead of being erased.
      const keptIcons = [...heirs.keys()].flatMap(function iconOf(guild) {
        return column(
          'SELECT icon_image FROM guilds WHERE id = ? AND icon_image IS NOT NULL',
          guild,
        );
      });
      const images = column('SELECT id FROM images WHERE owner_id = ?', id).filter(
        function erased(image) {
          return !keptIcons.includes(image);
        },
      );
      const vaultItems = column('SELECT id FROM vault_items WHERE owner_id = ?', id);
      db.transaction(function erase() {
        for (const channel of dmChannels)
          db.prepare('DELETE FROM channels WHERE id = ?').run(channel);
        for (const [guild, heir] of heirs) {
          db.prepare('UPDATE guilds SET owner_id = ?, needs_rotation = 1 WHERE id = ?').run(
            heir,
            guild,
          );
          db.prepare(
            "UPDATE guild_members SET role = 'owner' WHERE guild_id = ? AND user_id = ?",
          ).run(guild, heir);
          db.prepare(
            'UPDATE images SET owner_id = ? WHERE id = (SELECT icon_image FROM guilds WHERE id = ?)',
          ).run(heir, guild);
        }
        for (const guild of abandonedGuilds)
          db.prepare('DELETE FROM guilds WHERE id = ?').run(guild);
        // The people of the groups keep the envelopes that this person wrapped for them: the public key goes into the
        // ? envelope (it is public) because the row of the person goes now, and the owner is asked to renew the key.
        db.prepare(
          `UPDATE guild_keys SET wrapper_pub = (SELECT pub_ecdh FROM users WHERE id = ?)
             WHERE wrapper_id = ? AND wrapper_pub IS NULL`,
        ).run(id, id);
        for (const guild of joinedGuilds)
          db.prepare('UPDATE guilds SET needs_rotation = 1 WHERE id = ?').run(guild);
        db.prepare('DELETE FROM reactions WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM messages WHERE sender_id = ?').run(id);
        db.prepare('DELETE FROM files WHERE uploader_id = ?').run(id);
        db.prepare('DELETE FROM guild_keys WHERE user_id = ?').run(id);
        // Everything else that hangs from the person (friendships, memberships, tags, receipts, sessions, pictures) goes with it.
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
      })();

      for (const file of files) fs.rm(path.join(config.uploadDir, file), { force: true }, noop);
      for (const image of images) fs.rm(imageFile(ctx, image), { force: true }, noop);
      for (const item of vaultItems) fs.rm(vaultFile(ctx, item), { force: true }, noop);
      ctx.hub.dropUser(id);
      ctx.hub.sendToMany([...friends, ...dmPeers], { t: 'friends.update' });
      for (const guild of joinedGuilds)
        ctx.hub.sendToMany(joinedMembers, {
          t: 'guild.update',
          guildId: guild,
        });
      for (const guild of heirs.keys())
        ctx.hub.sendToMany(inheritedMembers, {
          t: 'guild.update',
          guildId: guild,
        });
      return reply.code(204).send();
    },
  );
}
