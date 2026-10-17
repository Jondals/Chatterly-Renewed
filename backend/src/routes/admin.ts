/**
 * src/routes/admin.ts
 * The administration of the server, for its administrators (Settings > Administration): how the server is doing, the accounts
 * (suspend, restore, close their sessions), whether new accounts can be made, an announcement for everybody, and the record of
 * what the administrators did.
 *
 * * Who: the owners of ADMIN_USERS and the administrators they added (see routes/beta.ts). Anybody else gets 404, as if the
 *   routes did not exist.
 * ! What an administrator can see is what the server already knows in clear: names, when an account was made, how many
 *   sessions it has open, totals. Never a message, a file, a key or anything the browsers seal: the server cannot read them,
 *   and so cannot show them to anybody.
 * ! The owners are above everybody: nobody can suspend an owner or close their sessions, and only an owner can do that to
 *   another administrator. Nobody can do it to themselves (an administrator does not lock themselves out by mistake).
 * * Every change is written to the record (admin_audit): who, when, what and to whom. The record cannot be changed from the
 *   app; it keeps the last MAX_AUDIT_ROWS entries.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context';
import { hashAuthSecret } from '../security/password';
import type { Db } from '../db';
import { authSecretField, b64Field, callerId } from '../validation';
import { isBetaAdmin } from './beta';

/** How many entries of the record are kept. */
const MAX_AUDIT_ROWS = 500;
/** The longest announcement and the longest reason of a suspension. */
const MAX_ANNOUNCEMENT = 300;
const MAX_REASON = 200;
/** How long the sizes on the disk are reused before they are measured again. */
const SIZES_TTL_MS = 60_000;
/** How many accounts a search returns at most. */
const MAX_RESULTS = 50;
const ID_PATTERN = '^[0-9a-f-]{36}$';

/** The value of a choice of the server ('' when it was never set). */
function readSetting(db: Db, key: string): string {
  const row = db.prepare('SELECT value FROM server_settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? '';
}

/** Changes a choice of the server ('' removes it). */
function writeSetting(db: Db, key: string, value: string): void {
  if (value === '') db.prepare('DELETE FROM server_settings WHERE key = ?').run(key);
  else
    db.prepare(
      'INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
}

/** True while new accounts can be made (the default). */
export function registrationsOpen(db: Db): boolean {
  return readSetting(db, 'registrations') !== 'closed';
}

/** The announcement of the server, as the apps show it. */
export interface Announcement {
  id: string;
  text: string;
  tone: 'info' | 'warning';
  at: number;
}

/** The announcement in force, or null. */
export function currentAnnouncement(db: Db): Announcement | null {
  try {
    const raw = JSON.parse(readSetting(db, 'announcement') || 'null') as Announcement | null;
    if (!raw || typeof raw.text !== 'string' || raw.text === '') return null;
    return {
      id: String(raw.id),
      text: raw.text.slice(0, MAX_ANNOUNCEMENT),
      tone: raw.tone === 'warning' ? 'warning' : 'info',
      at: Number(raw.at) || 0,
    };
  } catch {
    return null;
  }
}

/** Writes one line of the record and forgets the oldest ones. */
function audit(
  db: Db,
  actorId: string,
  action: string,
  targetId: string | null,
  detail = '',
): void {
  db.prepare(
    'INSERT INTO admin_audit (at, actor_id, action, target_id, detail) VALUES (?, ?, ?, ?, ?)',
  ).run(Date.now(), actorId, action, targetId, detail.slice(0, 300));
  db.prepare(
    'DELETE FROM admin_audit WHERE id <= (SELECT id FROM admin_audit ORDER BY id DESC LIMIT 1 OFFSET ?)',
  ).run(MAX_AUDIT_ROWS);
}

/** The bytes a folder uses (0 when it does not exist), counted file by file. */
async function folderBytes(folder: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) total += await folderBytes(full);
    else if (entry.isFile()) {
      try {
        total += (await fs.promises.stat(full)).size;
      } catch {
        /* removed meanwhile */
      }
    }
  }
  return total;
}

/** The size of a file (0 when it does not exist). */
function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** One account as the administration sees it. */
interface AccountRow {
  id: string;
  username: string;
  display_name: string;
  created_at: number;
  suspended_at: number | null;
  suspended_reason: string;
  sessions: number;
  tester: number;
  added_admin: number;
  recovery_at: number | null;
}

/** Registers the routes of the administration. */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, hub } = ctx;
  const me = callerId;
  const auth = { onRequest: [app.authenticate] };
  const changing = { ...auth, config: { rateLimit: { max: 60, timeWindow: 60_000 } } };
  const startedAt = Date.now();
  let sizes: { at: number; value: Promise<{ uploads: number; database: number }> } | null = null;

  /** True when the username is one of the owners of ADMIN_USERS. */
  function isOwnerName(username: string): boolean {
    return config.adminUsers.includes(username.toLowerCase());
  }

  /** True when the account is an owner. */
  function isOwner(userId: string): boolean {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as
      { username: string } | undefined;
    return row !== undefined && isOwnerName(row.username);
  }

  /** The caller when they administer the server, or null (and the 404 is already sent). */
  function adminOrNotFound(req: { user: unknown }, reply: FastifyReply): string | null {
    const id = me(req);
    if (!isBetaAdmin(ctx, id)) {
      void reply.code(404).send({ error: 'not_found' });
      return null;
    }
    return id;
  }

  /**
   * Whether `actor` may act on the account `target` (suspend it, close its sessions). '' when yes, or the error to answer.
   * ! Not yourself, never an owner, and another administrator only by an owner.
   */
  function mayActOn(actor: string, target: string): string {
    if (actor === target) return 'not_yourself';
    const row = db
      .prepare('SELECT username FROM users WHERE id = ? AND deleted_at IS NULL')
      .get(target) as { username: string } | undefined;
    if (!row) return 'user_not_found';
    if (isOwnerName(row.username)) return 'owner_fixed';
    if (isBetaAdmin(ctx, target) && !isOwner(actor)) return 'owners_only';
    return '';
  }

  /** The bytes the uploads and the database use (measured at most once a minute). */
  function measureSizes(): Promise<{ uploads: number; database: number }> {
    if (!sizes || Date.now() - sizes.at > SIZES_TTL_MS) {
      sizes = {
        at: Date.now(),
        value: folderBytes(config.uploadDir).then(function withDb(uploads) {
          return {
            uploads,
            database: fileBytes(config.dbPath) + fileBytes(config.dbPath + '-wal'),
          };
        }),
      };
    }
    return sizes.value;
  }

  /** The numbers of the server: accounts, people online, calls, messages, the disk, and the choices in force. */
  app.get('/api/admin/overview', auth, async function (req, reply) {
    if (!adminOrNotFound(req, reply)) return reply;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const count = function count(sql: string, ...args: unknown[]): number {
      return (db.prepare(sql).get(...args) as { n: number }).n;
    };
    const disk = await measureSizes();
    return {
      version: config.version,
      uptimeSec: Math.round((now - startedAt) / 1000),
      users: {
        total: count('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL'),
        new7d: count(
          'SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND created_at > ?',
          now - 7 * day,
        ),
        suspended: count('SELECT COUNT(*) AS n FROM users WHERE suspended_at IS NOT NULL'),
        online: hub.onlineCount(),
      },
      guilds: count('SELECT COUNT(*) AS n FROM guilds'),
      messages: {
        total: count('SELECT COUNT(*) AS n FROM messages'),
        last24h: count('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?', now - day),
      },
      calls: hub.callCounts(),
      connections: hub.connectionCount(),
      storage: {
        uploads: disk.uploads,
        database: disk.database,
        vault: count('SELECT COALESCE(SUM(size), 0) AS n FROM vault_items'),
      },
      registrations: registrationsOpen(db) ? 'open' : 'closed',
      announcement: currentAnnouncement(db),
      owner: isOwner(me(req)),
    };
  });

  /** The accounts, newest first, or the ones whose name contains the search (at most MAX_RESULTS). */
  app.get(
    '/api/admin/users',
    {
      ...auth,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 40 },
            filter: { type: 'string', enum: ['all', 'suspended', 'admins', 'testers'] },
          },
        },
      },
    },
    async function (req, reply) {
      if (!adminOrNotFound(req, reply)) return reply;
      const { q = '', filter = 'all' } = req.query as { q?: string; filter?: string };
      // The search is a plain "contains", with the wildcards of LIKE written as themselves.
      const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
      const where =
        filter === 'suspended'
          ? 'AND u.suspended_at IS NOT NULL'
          : filter === 'testers'
            ? 'AND b.user_id IS NOT NULL'
            : '';
      const rows = db
        .prepare(
          `SELECT u.id, u.username, u.display_name, u.created_at, u.suspended_at, u.suspended_reason,
                  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions,
                  (b.user_id IS NOT NULL) AS tester, (a.user_id IS NOT NULL) AS added_admin,
                  (SELECT at FROM recovery_requests r WHERE r.user_id = u.id) AS recovery_at
             FROM users u
             LEFT JOIN beta_testers b ON b.user_id = u.id
             LEFT JOIN admins a ON a.user_id = u.id
            WHERE u.deleted_at IS NULL
              AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\') ${where}
            ORDER BY u.created_at ASC
            LIMIT ?`,
        )
        .all(Date.now(), like, like, filter === 'admins' ? 1000 : MAX_RESULTS) as AccountRow[];
      const users = rows
        .map(function describe(row) {
          const owner = isOwnerName(row.username);
          return {
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            createdAt: row.created_at,
            suspended: row.suspended_at !== null,
            suspendedAt: row.suspended_at ?? 0,
            reason: row.suspended_reason ?? '',
            sessions: row.sessions,
            tester: row.tester === 1,
            recoveryAt: row.recovery_at ?? 0,
            admin: owner || row.added_admin === 1,
            owner,
          };
        })
        .filter(function wanted(user) {
          return filter !== 'admins' || user.admin;
        })
        .slice(0, MAX_RESULTS);
      return { users };
    },
  );

  const userParams = {
    type: 'object',
    required: ['userId'],
    properties: { userId: { type: 'string', pattern: ID_PATTERN } },
  };

  /** Suspends an account: it cannot sign in, every session of it ends now and it leaves its call. Its data stays. */
  app.post(
    '/api/admin/users/:userId/suspend',
    {
      ...changing,
      schema: {
        params: userParams,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { reason: { type: 'string', maxLength: MAX_REASON } },
        },
      },
    },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      const { userId } = req.params as { userId: string };
      const problem = mayActOn(actor, userId);
      if (problem === 'user_not_found') return reply.code(404).send({ error: problem });
      if (problem) return reply.code(403).send({ error: problem });
      const reason = ((req.body as { reason?: string } | undefined)?.reason ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim();
      db.transaction(function suspend() {
        db.prepare('UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ?').run(
          Date.now(),
          reason,
          userId,
        );
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        audit(db, actor, 'suspend', userId, reason);
      })();
      hub.closeSessions(userId);
      return { ok: true };
    },
  );

  /** Gives a suspended account back its access (the person signs in again). */
  app.post(
    '/api/admin/users/:userId/restore',
    { ...changing, schema: { params: userParams } },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      const { userId } = req.params as { userId: string };
      const problem = mayActOn(actor, userId);
      if (problem === 'user_not_found') return reply.code(404).send({ error: problem });
      if (problem && problem !== 'not_yourself') return reply.code(403).send({ error: problem });
      const changed = db
        .prepare(
          "UPDATE users SET suspended_at = NULL, suspended_reason = '' WHERE id = ? AND suspended_at IS NOT NULL",
        )
        .run(userId).changes;
      if (changed) audit(db, actor, 'restore', userId);
      return { ok: true };
    },
  );

  /** Closes every session of an account (on every device): the person has to sign in again. */
  app.post(
    '/api/admin/users/:userId/sign-out',
    { ...changing, schema: { params: userParams } },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      const { userId } = req.params as { userId: string };
      const problem = mayActOn(actor, userId);
      if (problem === 'user_not_found') return reply.code(404).send({ error: problem });
      if (problem) return reply.code(403).send({ error: problem });
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      audit(db, actor, 'sign-out', userId);
      hub.closeSessions(userId);
      return { ok: true };
    },
  );

  /**
   * The open sessions of an account, so an administrator can see how many devices are signed in and when each one signed in.
   * ! Only what the server already has and nothing about the device: no address, no browser, no place. A session is an opaque id,
   * the day it opened, the day it ends and whether it is connected now.
   */
  app.get(
    '/api/admin/users/:userId/sessions',
    { ...auth, schema: { params: userParams } },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      const { userId } = req.params as { userId: string };
      const problem = actor === userId ? '' : mayActOn(actor, userId);
      if (problem === 'user_not_found') return reply.code(404).send({ error: problem });
      if (problem) return reply.code(403).send({ error: problem });
      const rows = db
        .prepare(
          'SELECT id, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20',
        )
        .all(userId, Date.now()) as { id: string; created_at: number; expires_at: number }[];
      return {
        sessions: rows.map(function describe(row) {
          return {
            id: row.id,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            online: hub.isSessionOnline(userId, row.id),
          };
        }),
      };
    },
  );

  /** Closes ONE session of an account (the other devices stay signed in). */
  app.post(
    '/api/admin/users/:userId/sessions/:sessionId/close',
    {
      ...changing,
      schema: {
        params: {
          type: 'object',
          required: ['userId', 'sessionId'],
          properties: {
            userId: { type: 'string', pattern: ID_PATTERN },
            sessionId: { type: 'string', pattern: ID_PATTERN },
          },
        },
      },
    },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      const { userId, sessionId } = req.params as { userId: string; sessionId: string };
      const problem = mayActOn(actor, userId);
      if (problem === 'user_not_found') return reply.code(404).send({ error: problem });
      if (problem) return reply.code(403).send({ error: problem });
      const done = db
        .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
        .run(sessionId, userId);
      if (done.changes === 0) return reply.code(404).send({ error: 'session_not_found' });
      audit(db, actor, 'close-session', userId);
      hub.closeSession(userId, sessionId);
      return { ok: true };
    },
  );

  /**
   * Sets a temporary password on an account whose person cannot sign in (they asked for it from the sign-in page). The browser of
   * the administrator makes the proof of the password: the server never sees it. The person makes new keys when they sign in
   * (see routes/recovery.ts): what was encrypted for the old ones is lost.
   */
  app.post(
    '/api/admin/users/:userId/reset-password',
    {
      ...changing,
      schema: {
        params: userParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['authSecret', 'kdfSalt', 'kdfIterations'],
          properties: {
            authSecret: authSecretField,
            kdfSalt: b64Field(16, 64),
            kdfIterations: { type: 'integer', maximum: 5_000_000 },
          },
        },
      },
    },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      const { userId } = req.params as { userId: string };
      const problem = mayActOn(actor, userId);
      if (problem === 'user_not_found') return reply.code(404).send({ error: problem });
      if (problem) return reply.code(403).send({ error: problem });
      const body = req.body as { authSecret: string; kdfSalt: string; kdfIterations: number };
      if (body.kdfIterations < config.minKdfIterations) {
        return reply.code(400).send({ error: 'kdf_too_weak', minIterations: config.minKdfIterations });
      }
      const guest = db.prepare('SELECT guest FROM users WHERE id = ?').get(userId) as { guest: number };
      if (guest.guest === 1) return reply.code(403).send({ error: 'guest' });
      const authHash = await hashAuthSecret(body.authSecret, config.scrypt, config.serverSecret);
      db.transaction(function reset() {
        db.prepare(
          'UPDATE users SET auth_hash = ?, kdf_salt = ?, kdf_iterations = ?, identity_reset = 1 WHERE id = ?',
        ).run(authHash, body.kdfSalt, body.kdfIterations, userId);
        db.prepare('DELETE FROM recovery_requests WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      })();
      hub.closeSessions(userId);
      audit(db, actor, 'reset-password', userId);
      return { ok: true };
    },
  );

  /** Erases an account for good (owners only): it is what a person can do to their own, done by the owner of the server. */
  app.delete(
    '/api/admin/users/:userId',
    { ...changing, schema: { params: userParams } },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      if (!isOwner(actor)) return reply.code(403).send({ error: 'owners_only' });
      const { userId } = req.params as { userId: string };
      const problem = mayActOn(actor, userId);
      if (problem === 'user_not_found') return reply.code(404).send({ error: problem });
      if (problem) return reply.code(403).send({ error: problem });
      const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as {
        username: string;
      };
      // ! The record keeps the name (the row of the account is going to disappear).
      audit(db, actor, 'delete-account', null, row.username);
      ctx.eraseAccount?.(userId);
      return reply.code(204).send();
    },
  );

  /** Empties the record of the administration (owners only). One line says who did it. */
  app.delete('/api/admin/audit', changing, async function (req, reply) {
    const actor = adminOrNotFound(req, reply);
    if (!actor) return reply;
    if (!isOwner(actor)) return reply.code(403).send({ error: 'owners_only' });
    db.prepare('DELETE FROM admin_audit').run();
    audit(db, actor, 'audit-clear', null);
    return reply.code(204).send();
  });

  /** Opens or closes the sign-up of new accounts. */
  app.put(
    '/api/admin/registrations',
    {
      ...changing,
      schema: {
        body: {
          type: 'object',
          required: ['open'],
          additionalProperties: false,
          properties: { open: { type: 'boolean' } },
        },
      },
    },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      const { open } = req.body as { open: boolean };
      if (open !== registrationsOpen(db)) {
        writeSetting(db, 'registrations', open ? '' : 'closed');
        audit(db, actor, open ? 'registrations-open' : 'registrations-close', null);
      }
      return { registrations: open ? 'open' : 'closed' };
    },
  );

  /** Puts an announcement for everybody (plain text), or takes it away with an empty text. Every open app shows it at once. */
  app.put(
    '/api/admin/announcement',
    {
      ...changing,
      schema: {
        body: {
          type: 'object',
          required: ['text'],
          additionalProperties: false,
          properties: {
            text: { type: 'string', maxLength: MAX_ANNOUNCEMENT },
            tone: { type: 'string', enum: ['info', 'warning'] },
          },
        },
      },
    },
    async function (req, reply) {
      const actor = adminOrNotFound(req, reply);
      if (!actor) return reply;
      const body = req.body as { text: string; tone?: 'info' | 'warning' };
      const text = body.text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim();
      const announcement: Announcement | null = text
        ? {
            id: Date.now().toString(36),
            text,
            tone: body.tone === 'warning' ? 'warning' : 'info',
            at: Date.now(),
          }
        : null;
      writeSetting(db, 'announcement', announcement ? JSON.stringify(announcement) : '');
      audit(db, actor, announcement ? 'announce' : 'announce-clear', null, text);
      hub.broadcast({ t: 'server.announcement', announcement });
      return { announcement };
    },
  );

  /** What the administrators did, newest first. */
  app.get('/api/admin/audit', auth, async function (req, reply) {
    if (!adminOrNotFound(req, reply)) return reply;
    const rows = db
      .prepare(
        `SELECT l.at, l.action, l.detail, actor.username AS actor, target.username AS target
           FROM admin_audit l
           LEFT JOIN users actor ON actor.id = l.actor_id
           LEFT JOIN users target ON target.id = l.target_id
          ORDER BY l.id DESC LIMIT 100`,
      )
      .all() as {
      at: number;
      action: string;
      detail: string;
      actor: string | null;
      target: string | null;
    }[];
    return {
      entries: rows.map(function describe(row) {
        return {
          at: row.at,
          action: row.action,
          detail: row.detail,
          actor: row.actor ?? '',
          target: row.target ?? '',
        };
      }),
    };
  });

  /** The announcement in force, for every signed-in person (the apps show it on top). */
  app.get('/api/announcement', auth, async function () {
    return { announcement: currentAnnouncement(db) };
  });
}

export { audit as recordAdminAction };
