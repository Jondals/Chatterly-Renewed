/**
 * src/routes/beta.ts
 * The beta testers of the desktop app: people the administrator lets try the versions that are built from the beta branch
 * before everybody else (the desktop app of a tester looks for updates in the pre-releases of GitHub).
 *
 * * Who administers: the usernames in ADMIN_USERS (comma separated, set in the server environment: the owners, who cannot be
 *   removed from the app) and the people those administrators add in Settings > Administration.
 * * The server only keeps WHO is a tester (a row per person, erased with the account). It never sees which version they run.
 * ! A person who is not an administrator gets 404 on the management routes, as if they did not exist.
 * ! Only an OWNER makes or unmakes administrators: an administrator account that is taken over cannot hand the server to
 *   more accounts. Every change is written to the record of the administration (routes/admin.ts).
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { callerId, usernameField } from '../validation';
import { recordAdminAction } from './admin';

/** What the administrator sees about one tester. */
interface TesterRow {
  id: string;
  username: string;
  display_name: string;
  added_at: number;
}

/** True when the account administers the program: an owner (ADMIN_USERS) or somebody an administrator added. */
export function isBetaAdmin(ctx: AppContext, userId: string): boolean {
  const row = ctx.db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as
    { username: string } | undefined;
  if (row === undefined) return false;
  return (
    ctx.config.adminUsers.includes(row.username.toLowerCase()) ||
    Boolean(ctx.db.prepare('SELECT 1 FROM admins WHERE user_id = ?').get(userId))
  );
}

/** True when the account may use the beta channel: a tester, or an administrator (who always can). */
export function canUseBeta(ctx: AppContext, userId: string): boolean {
  return (
    Boolean(ctx.db.prepare('SELECT 1 FROM beta_testers WHERE user_id = ?').get(userId)) ||
    isBetaAdmin(ctx, userId)
  );
}

/** Registers the routes of the beta program. */
export function registerBetaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;
  const me = callerId;
  const auth = { onRequest: [app.authenticate] };

  /** True when the person is an owner (named in ADMIN_USERS): they cannot be removed from the app. */
  function isOwner(username: string): boolean {
    return config.adminUsers.includes(username.toLowerCase());
  }

  /** True when the account is one of the owners (ADMIN_USERS). */
  function isCallerOwner(userId: string): boolean {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as
      { username: string } | undefined;
    return row !== undefined && isOwner(row.username);
  }

  /** True when the caller is an administrator of the server: an owner, or somebody an administrator added. */
  function isAdmin(userId: string): boolean {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as
      { username: string } | undefined;
    if (row === undefined) return false;
    return (
      isOwner(row.username) ||
      Boolean(db.prepare('SELECT 1 FROM admins WHERE user_id = ?').get(userId))
    );
  }

  /** The state of the caller: whether they are a tester and whether they administer the program. */
  app.get('/api/beta/me', auth, async function (req) {
    const id = me(req);
    const tester = db.prepare('SELECT 1 FROM beta_testers WHERE user_id = ?').get(id);
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as
      { username: string } | undefined;
    return {
      beta: Boolean(tester),
      admin: isAdmin(id),
      owner: row !== undefined && isOwner(row.username),
    };
  });

  /** Every tester, newest first (administrators only). */
  app.get('/api/beta/testers', auth, async function (req, reply) {
    if (!isAdmin(me(req))) return reply.code(404).send({ error: 'not_found' });
    const rows = db
      .prepare(
        'SELECT u.id, u.username, u.display_name, b.added_at FROM beta_testers b JOIN users u ON u.id = b.user_id ORDER BY b.added_at DESC',
      )
      .all() as TesterRow[];
    return {
      testers: rows.map(function describe(row) {
        return {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          addedAt: row.added_at,
        };
      }),
    };
  });

  /** Every administrator: the owners of ADMIN_USERS (fixed) and the ones added from the app (administrators only). */
  app.get('/api/beta/admins', auth, async function (req, reply) {
    if (!isAdmin(me(req))) return reply.code(404).send({ error: 'not_found' });
    const rows = db
      .prepare(
        'SELECT u.id, u.username, u.display_name, a.added_at FROM users u LEFT JOIN admins a ON a.user_id = u.id ORDER BY a.added_at DESC',
      )
      .all() as (TesterRow & { added_at: number | null })[];
    return {
      admins: rows
        .filter(function isListed(row) {
          return row.added_at !== null || isOwner(row.username);
        })
        .map(function describe(row) {
          return {
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            addedAt: row.added_at ?? 0,
            fixed: isOwner(row.username),
          };
        }),
    };
  });

  /** Makes a person an administrator, by username (administrators only). */
  app.post(
    '/api/beta/admins',
    {
      ...auth,
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          required: ['username'],
          additionalProperties: false,
          properties: { username: usernameField },
        },
      },
    },
    async function (req, reply) {
      const actor = me(req);
      if (!isAdmin(actor)) return reply.code(404).send({ error: 'not_found' });
      if (!isCallerOwner(actor)) return reply.code(403).send({ error: 'owners_only' });
      const { username } = req.body as { username: string };
      const target = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
        { id: string } | undefined;
      if (!target) return reply.code(404).send({ error: 'user_not_found' });
      const added = db
        .prepare('INSERT OR IGNORE INTO admins (user_id, added_at) VALUES (?, ?)')
        .run(target.id, Date.now()).changes;
      if (added) recordAdminAction(db, actor, 'admin-add', target.id);
      return reply.code(201).send({ ok: true });
    },
  );

  /** Takes the administration away from a person added from the app. The owners of ADMIN_USERS cannot be removed here. */
  app.delete(
    '/api/beta/admins/:userId',
    {
      ...auth,
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async function (req, reply) {
      const actor = me(req);
      if (!isAdmin(actor)) return reply.code(404).send({ error: 'not_found' });
      const { userId } = req.params as { userId: string };
      const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as
        { username: string } | undefined;
      if (row && isOwner(row.username)) return reply.code(403).send({ error: 'owner_fixed' });
      if (!isCallerOwner(actor)) return reply.code(403).send({ error: 'owners_only' });
      const removed = db.prepare('DELETE FROM admins WHERE user_id = ?').run(userId).changes;
      if (removed) recordAdminAction(db, actor, 'admin-remove', userId);
      return { ok: true };
    },
  );

  /** Lets a person try the beta versions, by username (administrators only). */
  app.post(
    '/api/beta/testers',
    {
      ...auth,
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          required: ['username'],
          additionalProperties: false,
          properties: { username: usernameField },
        },
      },
    },
    async function (req, reply) {
      const actor = me(req);
      if (!isAdmin(actor)) return reply.code(404).send({ error: 'not_found' });
      const { username } = req.body as { username: string };
      const target = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
        { id: string } | undefined;
      if (!target) return reply.code(404).send({ error: 'user_not_found' });
      const added = db
        .prepare('INSERT OR IGNORE INTO beta_testers (user_id, added_at) VALUES (?, ?)')
        .run(target.id, Date.now()).changes;
      if (added) recordAdminAction(db, actor, 'tester-add', target.id);
      return reply.code(201).send({ ok: true });
    },
  );

  /** Takes a person out of the beta program (administrators only). */
  app.delete(
    '/api/beta/testers/:userId',
    {
      ...auth,
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async function (req, reply) {
      const actor = me(req);
      if (!isAdmin(actor)) return reply.code(404).send({ error: 'not_found' });
      const { userId } = req.params as { userId: string };
      // ! An owner always has the beta (see canUseBeta): taking it away would mean nothing, so it is refused.
      if (isCallerOwner(userId)) return reply.code(403).send({ error: 'owner_fixed' });
      const removed = db.prepare('DELETE FROM beta_testers WHERE user_id = ?').run(userId).changes;
      if (removed) recordAdminAction(db, actor, 'tester-remove', userId);
      return { ok: true };
    },
  );
}
