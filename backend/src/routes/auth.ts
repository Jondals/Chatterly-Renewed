/**
 * src/routes/auth.ts
 * Registration, zero-knowledge sign in, token renewal and sign out, and profile editing.
 */
import {
  createHash,
  createPublicKey,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { getUser, toPublicUser, toSelfUser, profileAudience, type UserRow } from '../models';
import { refreshServerTag } from '../server-tag';
import { hashAuthSecret, verifyAuthSecret, needsUpgrade } from '../security/password';
import { deleteImage, imageFile, ownsImage } from './images';
import { vaultFile } from './vault';
import { registrationsOpen } from './admin';
import { eraseIdentityData } from './recovery';
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

/**
 * How long a refresh token that was just rotated may be presented again. A phone can lose the answer of a renewal (the
 * network drops, the system kills the app before it saves the new token); without this second chance the next try
 * looked like a stolen token and closed every session of the account.
 * ! The second chance gives back the SAME next token (see nextRefreshToken), it ends as soon as that next token is used,
 * and it never applies to a session that is closed, expired or whose next token was already replaced.
 */
const REFRESH_GRACE_MS = 10 * 60_000;

/** The retry key that the app sends with each renewal: 32 random bytes in base64url (optional: older apps send none). */
const RETRY_KEY_SCHEMA = {
  type: 'string',
  minLength: 43,
  maxLength: 43,
  pattern: '^[A-Za-z0-9_-]{43}$',
};

/**
 * ! Whether a spent refresh token may still be presented (the second chance of a renewal whose answer was lost): it was
 * rotated less than REFRESH_GRACE_MS ago by a request with this same retry key, and the token after it was not used.
 * Rows written before this second chance existed have no session and no key, so they never qualify.
 */
function inGrace(
  spent: { session_id: string | null; spent_at: number; retry_hash: string | null },
  retryKey: string | null,
  now: number,
): boolean {
  return (
    !!spent.session_id &&
    !!spent.retry_hash &&
    !!retryKey &&
    spent.retry_hash === sha256(retryKey) &&
    spent.spent_at > 0 &&
    now - spent.spent_at <= REFRESH_GRACE_MS
  );
}

/** The key that turns a refresh token into the one that follows it: derived from SERVER_SECRET, used for nothing else. */
function refreshChainKey(serverSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', serverSecret, '', 'chatterly/refresh-next/v1', 32));
}

/**
 * The refresh token that follows `token` in a session. It is computed, not drawn at random, so asking again with the
 * same old token gives exactly the same answer: a retry never creates a second branch of the session that a copy of the
 * token could keep alive.
 */
function nextRefreshToken(key: Buffer, sessionId: string, token: string): string {
  return createHmac('sha256', key)
    .update('refresh-next/v1|' + sessionId + '|' + sha256(token))
    .digest('base64url');
}

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

/** The random id that a device makes for itself (never a device name or an address): see issueTokens. */
const deviceIdField = { type: 'string', pattern: '^[A-Za-z0-9_-]{22,64}$' } as const;

const registerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'authSecret', 'kdfSalt', 'kdfIterations', 'publicKeys', 'wrappedKeys'],
    properties: {
      username: usernameField,
      displayName: { type: 'string', minLength: 1, maxLength: 32 },
      authSecret: authSecretField,
      deviceId: deviceIdField,
      // A guest (the web only): a temporary account to try the app. Nothing of it is kept.
      guest: { type: 'boolean' },
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

/** A guest session lasts this long without being used (the account is erased with it). */
const GUEST_SESSION_MS = 2 * 60 * 60 * 1000;
/** A guest account is erased this long after it was made, whatever it does. */
const GUEST_LIFETIME_MS = 12 * 60 * 60 * 1000;
/** The most guest accounts at the same time. */
const MAX_GUESTS = 150;
/** How often the guests that are over are erased. */
const GUEST_SWEEP_MS = 10 * 60 * 1000;
/** The name of a guest: `guest-` and eight letters or digits (a real account cannot be made with it). */
const GUEST_NAME = /^guest-[a-z0-9]{8}$/;

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
   * @param nextToken The refresh token to give when renewing (see nextRefreshToken); a random one otherwise.
   */
  function issueTokens(
    userId: string,
    sessionId: string = randomUUID(),
    renewing = false,
    nextToken?: string,
    deviceId?: string,
  ) {
    const accessToken = app.jwt.sign(
      { sub: userId, sid: sessionId },
      { expiresIn: config.accessTtlSec },
    );
    const refreshToken = nextToken ?? randomBytes(32).toString('base64url');
    const now = Date.now();
    const guest = (db.prepare('SELECT guest FROM users WHERE id = ?').get(userId) as
      | { guest: number }
      | undefined)?.guest === 1;
    const expiresAt = now + (guest ? GUEST_SESSION_MS : config.refreshTtlSec * 1000);
    if (renewing) {
      db.prepare('UPDATE sessions SET token_hash = ?, expires_at = ? WHERE id = ?').run(
        sha256(refreshToken),
        expiresAt,
        sessionId,
      );
    } else {
      // ! One session per device: the device that signs in again (its old session was lost, or it never signed out) replaces
      // its old one. The id is random, made by the device, and only its hash is kept: it says nothing about the device.
      const deviceHash = deviceId ? sha256('device|' + deviceId) : null;
      if (deviceHash) {
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND device_hash = ?').run(
          userId,
          deviceHash,
        );
      }
      db.prepare(
        'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, device_hash) VALUES (?,?,?,?,?,?)',
      ).run(sessionId, userId, sha256(refreshToken), expiresAt, now, deviceHash);
    }
    // Opportunistic cleanup of dead sessions, and a limit of 20 open ones per person (the oldest close first).
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    db.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20)',
    ).run(userId, userId);
    return { accessToken, refreshToken, expiresIn: config.accessTtlSec };
  }

  const userId = callerId;
  const chainKey = refreshChainKey(config.serverSecret);

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
        deviceId?: string;
        guest?: boolean;
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
      // An administrator can close the sign-up (Settings > Administration); the owners of ADMIN_USERS can always make theirs.
      if (!registrationsOpen(db) && !config.adminUsers.includes(body.username.toLowerCase())) {
        return reply.code(403).send({ error: 'registrations_closed' });
      }
      // ! The names that start with "guest-" are for guests only, and a guest can only have one of them.
      if (GUEST_NAME.test(body.username.toLowerCase()) !== (body.guest === true)) {
        return reply.code(400).send({ error: 'invalid_username' });
      }
      if (body.guest) {
        // ! Only the web: the apps (desktop, Android, iPhone) send an origin of their own, and they have no guest mode.
        if (/^(app|capacitor):\/\/|chatterly\.internal/i.test(String(req.headers.origin ?? ''))) {
          return reply.code(403).send({ error: 'guest_web_only' });
        }
        const guests = db.prepare('SELECT COUNT(*) AS n FROM users WHERE guest = 1').get() as {
          n: number;
        };
        if (guests.n >= MAX_GUESTS) return reply.code(503).send({ error: 'guests_busy' });
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
           pub_ecdh, pub_ecdsa, wrapped_ecdh, wrapped_ecdsa, avatar_color, created_at, guest, searchable)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          body.guest ? 1 : 0,
          body.guest ? 0 : 1,
        );
      } catch {
        return reply.code(409).send({ error: 'username_taken' });
      }
      const row = getUser(db, id)!;
      return reply
        .code(201)
        .send({ user: toSelfUser(row), ...issueTokens(id, undefined, false, undefined, body.deviceId) });
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
            deviceId: deviceIdField,
            // Only checks the password (to change it or to erase the account): no session is opened for it.
            verifyOnly: { type: 'boolean' },
          },
        },
      },
    },
    /**
     * POST /api/auth/login: checks the proof of the password (slow hash, locked after several failures) and opens a session.
     */
    async function (req, reply) {
      const { username, authSecret, deviceId, verifyOnly } = req.body as {
        username: string;
        authSecret: string;
        deviceId?: string;
        verifyOnly?: boolean;
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
      // ! Only after the password is proven: a person who does not know it cannot tell a suspended account from a wrong password.
      if (row.suspended_at !== null && row.suspended_at !== undefined) {
        return reply
          .code(403)
          .send({ error: 'account_suspended', reason: row.suspended_reason ?? '' });
      }
      // A hash made before the pepper existed is made again now that the proof of the password is at hand.
      if (needsUpgrade(row.auth_hash)) {
        db.prepare('UPDATE users SET auth_hash = ? WHERE id = ?').run(
          await hashAuthSecret(authSecret, config.scrypt, config.serverSecret),
          row.id,
        );
      }
      const wrappedKeys = { ecdh: row.wrapped_ecdh, ecdsa: row.wrapped_ecdsa };
      // A check of the password (change of password, erasing the account) opens no session: it used to leave one more open
      // every time, and nobody could close it.
      if (verifyOnly) return { user: toSelfUser(row), wrappedKeys };
      return {
        user: toSelfUser(row),
        wrappedKeys,
        // An administrator reset the password: the person makes new keys now (see routes/recovery.ts).
        identityReset: row.identity_reset === 1,
        ...issueTokens(row.id, undefined, false, undefined, deviceId),
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
            retryKey: RETRY_KEY_SCHEMA,
          },
        },
      },
    },
    /**
     * POST /api/auth/refresh: gives a new pair of tokens and cancels the old one. A refresh token works once: reusing it
     * closes every session of the account, except for the short second chance of a renewal whose answer was lost
     * (REFRESH_GRACE_MS), which gives back the same next token and never revives a closed session.
     * ! Everything runs in one synchronous transaction (no await between reading and writing), so two renewals that
     * arrive at the same time are handled one after the other.
     */
    async function (req, reply) {
      const { refreshToken, retryKey } = req.body as { refreshToken: string; retryKey?: string };
      const result = renew(refreshToken, retryKey ?? null, Date.now());
      if (!result) return reply.code(401).send({ error: 'invalid_refresh_token' });
      return result;
    },
  );

  /**
   * The renewal of a session, or null when the token is refused.
   *
   * 1. The token is the current one of a live session: it is rotated (the next token is derived from it, and the hash
   *    of the retry key of this request is kept) and the token before it loses its second chance, because using this
   *    one proves that its answer arrived.
   * 2. The token was rotated less than REFRESH_GRACE_MS ago, by a request with THIS retry key, it was not superseded,
   *    and its session is still open, not expired, of an account that is not erased, and still holds exactly the token
   *    that follows it: the same answer is given again (nothing is written).
   * 3. Any other spent token means a copy: every session of the account is closed (as before this second chance).
   *
   * ! The retry key is what keeps reuse detection intact: it is random per request and saved by the app before asking,
   * so only the device that made the request can ask again. A copy of the token (a backup, another device) has no key
   * or another one and falls in case 3 at once. Apps of older versions send no key and never get the second chance.
   */
  const renew = db.transaction(function renewSession(
    token: string,
    retryKey: string | null,
    now: number,
  ) {
    const hash = sha256(token);
    const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash) as
      { id: string; user_id: string; expires_at: number } | undefined;
    if (session) {
      if (session.expires_at < now) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
        return null;
      }
      // ! Rotation: a refresh token works exactly once. The session keeps its id, only the refresh token changes.
      db.prepare(
        'INSERT OR IGNORE INTO spent_tokens (token_hash, user_id, expires_at, session_id, spent_at, retry_hash) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        hash,
        session.user_id,
        session.expires_at,
        session.id,
        now,
        retryKey ? sha256(retryKey) : null,
      );
      db.prepare(
        'UPDATE spent_tokens SET spent_at = 0 WHERE session_id = ? AND token_hash != ?',
      ).run(session.id, hash);
      db.prepare('DELETE FROM spent_tokens WHERE expires_at < ?').run(now);
      return issueTokens(
        session.user_id,
        session.id,
        true,
        nextRefreshToken(chainKey, session.id, token),
      );
    }
    const spent = db
      .prepare(
        'SELECT user_id, session_id, spent_at, retry_hash FROM spent_tokens WHERE token_hash = ?',
      )
      .get(hash) as
      | { user_id: string; session_id: string | null; spent_at: number; retry_hash: string | null }
      | undefined;
    if (!spent) return null;
    if (inGrace(spent, retryKey, now)) {
      const sessionId = spent.session_id!;
      const next = nextRefreshToken(chainKey, sessionId, token);
      const live = db
        .prepare(
          `SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id = ? AND s.user_id = ? AND s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
        )
        .get(sessionId, spent.user_id, sha256(next), now);
      if (live) {
        return {
          accessToken: app.jwt.sign(
            { sub: spent.user_id, sid: sessionId },
            { expiresIn: config.accessTtlSec },
          ),
          refreshToken: next,
          expiresIn: config.accessTtlSec,
        };
      }
    }
    // ! Reusing a token that was already rotated means it was copied: every session of that account is closed.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(spent.user_id);
    ctx.hub.closeSessions(spent.user_id);
    return null;
  });

  app.post(
    '/api/auth/logout',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string', maxLength: 128 },
            retryKey: RETRY_KEY_SCHEMA,
          },
        },
      },
    },
    /**
     * POST /api/auth/logout: closes the session of a refresh token. Its access token stops working at once and
     * the connections opened with it are closed. A token that was rotated within the second chance of a renewal also
     * closes its session, with the retry key of that renewal: the device whose answer was lost still holds only that one.
     */
    async function (req, reply) {
      const { refreshToken, retryKey } = req.body as { refreshToken: string; retryKey?: string };
      const hash = sha256(refreshToken);
      let session = db
        .prepare('SELECT id, user_id FROM sessions WHERE token_hash = ?')
        .get(hash) as { id: string; user_id: string } | undefined;
      if (!session) {
        const spent = db
          .prepare(
            'SELECT user_id, session_id, spent_at, retry_hash FROM spent_tokens WHERE token_hash = ?',
          )
          .get(hash) as
          | {
              user_id: string;
              session_id: string | null;
              spent_at: number;
              retry_hash: string | null;
            }
          | undefined;
        if (spent && inGrace(spent, retryKey ?? null, Date.now())) {
          session = { id: spent.session_id!, user_id: spent.user_id };
        }
      }
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

  /**
   * Erases an account and everything of it (see the route /api/me/delete): its messages, files, pictures, friendships, direct
   * conversations, keys and sessions. Used when a person erases theirs, when a guest leaves and when guests run out of time.
   */
  function eraseAccount(id: string): void {
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
  }

  ctx.eraseAccount = eraseAccount;

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

      eraseAccount(id);
      return reply.code(204).send();
    },
  );

  /** GET /api/me/sessions: the open sessions of the person (when each opened, when it ends, which is this one, which are connected). */
  app.get('/api/me/sessions', { onRequest: [app.authenticate] }, async function (req) {
    const id = userId(req);
    const current = (req.user as { sid: string }).sid;
    const rows = db
      .prepare(
        'SELECT id, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20',
      )
      .all(id, Date.now()) as { id: string; created_at: number; expires_at: number }[];
    return {
      sessions: rows.map(function describe(row) {
        return {
          id: row.id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          current: row.id === current,
          online: ctx.hub.isSessionOnline(id, row.id),
        };
      }),
    };
  });

  /** POST /api/me/sessions/close-others: closes every session of the person except the one that asks. */
  app.post(
    '/api/me/sessions/close-others',
    { onRequest: [app.authenticate], ...authLimit },
    async function (req, reply) {
      const id = userId(req);
      const current = (req.user as { sid: string }).sid;
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(id, current);
      ctx.hub.closeSessions(id, current);
      return reply.code(204).send();
    },
  );

  /** POST /api/me/sessions/:id/close: closes one session of the person (not the one that asks: that is signing out). */
  app.post(
    '/api/me/sessions/:sessionId/close',
    {
      onRequest: [app.authenticate],
      ...authLimit,
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string', pattern: '^[0-9a-f-]{36}$' } },
        },
      },
    },
    async function (req, reply) {
      const id = userId(req);
      const { sessionId } = req.params as { sessionId: string };
      if (sessionId === (req.user as { sid: string }).sid) {
        return reply.code(400).send({ error: 'this_session' });
      }
      const done = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, id);
      if (done.changes === 0) return reply.code(404).send({ error: 'session_not_found' });
      ctx.hub.closeSession(id, sessionId);
      return reply.code(204).send();
    },
  );

  /**
   * POST /api/auth/recovery-request: a person who cannot sign in tells the administrators (they see it in Administration > People).
   * Always answers the same, so it cannot be used to find out which names exist.
   */
  app.post(
    '/api/auth/recovery-request',
    {
      ...authLimit,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['username'],
          properties: { username: { type: 'string', minLength: 1, maxLength: 64 } },
        },
      },
    },
    async function (req, reply) {
      const { username } = req.body as { username: string };
      const row = db
        .prepare('SELECT id FROM users WHERE username = ? AND guest = 0 AND deleted_at IS NULL')
        .get(username) as { id: string } | undefined;
      if (row) {
        db.prepare('INSERT OR REPLACE INTO recovery_requests (user_id, at) VALUES (?, ?)').run(
          row.id,
          Date.now(),
        );
      }
      return reply.code(204).send();
    },
  );

  /**
   * POST /api/me/identity-reset: after an administrator reset the password, the person makes new keys with a password of their own.
   * Only for an account that was reset; what was encrypted for the old keys is forgotten (see routes/recovery.ts).
   */
  app.post(
    '/api/me/identity-reset',
    {
      onRequest: [app.authenticate],
      ...authLimit,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['authSecret', 'kdfSalt', 'kdfIterations', 'publicKeys', 'wrappedKeys'],
          properties: {
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
      },
    },
    async function (req, reply) {
      const id = userId(req);
      const body = req.body as {
        authSecret: string;
        kdfSalt: string;
        kdfIterations: number;
        publicKeys: { ecdh: string; ecdsa: string };
        wrappedKeys: { ecdh: string; ecdsa: string };
      };
      const row = getUser(db, id);
      if (!row || row.identity_reset !== 1) return reply.code(403).send({ error: 'not_reset' });
      if (body.kdfIterations < config.minKdfIterations) {
        return reply.code(400).send({ error: 'kdf_too_weak', minIterations: config.minKdfIterations });
      }
      if (!isValidP256Point(body.publicKeys.ecdh) || !isValidP256Point(body.publicKeys.ecdsa)) {
        return reply.code(400).send({ error: 'invalid_public_key' });
      }
      const authHash = await hashAuthSecret(body.authSecret, config.scrypt, config.serverSecret);
      eraseIdentityData(ctx, id);
      db.prepare(
        `UPDATE users SET auth_hash = ?, kdf_salt = ?, kdf_iterations = ?, pub_ecdh = ?, pub_ecdsa = ?,
           wrapped_ecdh = ?, wrapped_ecdsa = ?, identity_reset = 0 WHERE id = ?`,
      ).run(
        authHash,
        body.kdfSalt,
        body.kdfIterations,
        body.publicKeys.ecdh,
        body.publicKeys.ecdsa,
        body.wrappedKeys.ecdh,
        body.wrappedKeys.ecdsa,
        id,
      );
      // Every other session of the account ends (the temporary password is over), and the people who share things are told.
      const current = (req.user as { sid: string }).sid;
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(id, current);
      ctx.hub.closeSessions(id, current);
      const friends = db
        .prepare(
          'SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id FROM friendships WHERE user_a = ? OR user_b = ?',
        )
        .all(id, id, id) as { id: string }[];
      ctx.hub.sendToMany(
        friends.map(function ids(f) {
          return f.id;
        }),
        { t: 'friends.update' },
      );
      return { user: toSelfUser(getUser(db, id)!) };
    },
  );

  /**
   * POST /api/me/guest/leave: a guest leaves and their account is erased at once (nothing of a guest is kept). Only a guest can
   * use it: the account of anybody else needs the proof of the password (/api/me/delete).
   */
  app.post(
    '/api/me/guest/leave',
    { onRequest: [app.authenticate], ...authLimit },
    async function (req, reply) {
      const id = userId(req);
      const row = getUser(db, id);
      if (!row || row.guest !== 1) return reply.code(403).send({ error: 'not_a_guest' });
      eraseAccount(id);
      return reply.code(204).send();
    },
  );

  // The guests that are over (their last session ended, or they were made too long ago) are erased now and then, so a tab that
  // was closed without leaving cannot keep an account for longer than a few hours.
  const sweepGuests = function sweepGuests(): void {
    const now = Date.now();
    const old = db
      .prepare(
        `SELECT id FROM users WHERE guest = 1 AND (created_at < ?
           OR NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id AND s.expires_at > ?))`,
      )
      .all(now - GUEST_LIFETIME_MS, now) as { id: string }[];
    for (const guest of old) {
      try {
        eraseAccount(guest.id);
      } catch {
        /* it is tried again at the next sweep */
      }
    }
  };
  const sweeper = setInterval(sweepGuests, GUEST_SWEEP_MS);
  sweeper.unref();
  app.addHook('onClose', async function stopSweeping() {
    clearInterval(sweeper);
  });
}
