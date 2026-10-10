/**
 * src/app.ts
 * Builds the Fastify server: security headers, CORS, request limits, JWT, the database and the registration of every route and of the WebSocket.
 */
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fs from 'node:fs';
import { loadConfig, type AppConfig } from './config';
import { openDatabase } from './db';
import { Hub } from './ws/hub';
import { runMaintenance, MAINTENANCE_INTERVAL_MS } from './maintenance';
import { LoginThrottle } from './security/throttle';
import { isSessionLive } from './security/sessions';
import type { AppContext } from './context';
import { registerAuthRoutes } from './routes/auth';
import { registerSocialRoutes } from './routes/social';
import { registerGuildRoutes } from './routes/guilds';
import { registerMessageRoutes } from './routes/messages';
import { registerImageRoutes } from './routes/images';
import { registerSettingsSyncRoutes } from './routes/settings-sync';
import { registerGifRoutes } from './routes/gifs';
import { registerPreviewRoutes } from './routes/preview';
import { registerSocket } from './ws/socket';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    ctx: AppContext;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; sid: string };
    user: { sub: string; sid: string };
  }
}

/** What the log says about a request: the method and the path, never the address of who asks or the query. */
function logRequest(request: { method?: string; url?: string }): {
  method?: string;
  path: string;
} {
  return { method: request.method, path: (request.url ?? '').split('?')[0]! };
}

/** What the log says about an answer: only its status. */
function logResponse(response: { statusCode?: number }): { status?: number } {
  return { status: response.statusCode };
}

/**
 * ! How many reverse proxies stand in front of the app (the TRUST_PROXY variable: 1 for a single Caddy). Fastify then
 * believes exactly that many entries of X-Forwarded-For, counted from the end, so a client cannot choose the address
 * the rate limits see. 0 or anything that is not a positive whole number means no proxy is trusted.
 */
function trustedProxyHops(): false | ((address: string, hop: number) => boolean) {
  const hops = Number(process.env['TRUST_PROXY'] ?? 0);
  if (!Number.isInteger(hops) || hops <= 0) return false;
  return function trustHop(_address: string, hop: number): boolean {
    return hop < hops;
  };
}

/**
 * Builds the whole server: security headers, CORS, limits, tokens, database and every route. The tests build it too.
 */
export async function buildApp(overrides: Partial<AppConfig> = {}) {
  const config = loadConfig(overrides);
  const app = Fastify({
    // The log keeps no address of anybody and no query of the address (it can carry a name): only what is needed to see errors.
    logger: config.logger
      ? {
          redact: ['req.headers.authorization'],
          serializers: { req: logRequest, res: logResponse },
        }
      : false,
    bodyLimit: 256 * 1024,
    // The number of reverse proxies in front of the app (1 = Caddy). Only that many entries of X-Forwarded-For are
    // believed, so a client cannot choose its own address (which would defeat the per-address rate limits).
    trustProxy: trustedProxyHops(),
    ...(config.tls
      ? {
          https: {
            key: fs.readFileSync(config.tls.key),
            cert: fs.readFileSync(config.tls.cert),
          },
        }
      : {}),
  });

  // This service only speaks JSON: lock down everything a browser could be tricked into doing.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  // ! API answers are never stored in shared caches or in the browser (except media, which has its own policy).
  app.addHook('onSend', async function (_req, reply, payload) {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    );
    return payload;
  });
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  // ! The counter of the rate limit is kept per address and, unless the route says otherwise, SHARED by every route: a route
  // with its own limit (20 uploads a minute) was refused as soon as the same address had made 20 requests of ANY kind.
  // Each route that has a limit of its own gets its own counter.
  app.addHook('onRoute', function ownCounter(route) {
    const limit = route.config?.rateLimit;
    if (limit && typeof limit === 'object' && !('groupId' in limit)) {
      const methods = Array.isArray(route.method) ? route.method.join(',') : route.method;
      route.config = {
        ...route.config,
        rateLimit: { ...limit, groupId: methods + ' ' + route.url },
      };
    }
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
  });
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const db = openDatabase(config.dbPath);
  /**
   * ! Authenticates a request: the signature of the access token must be valid AND the session it names must still
   * be open. A token whose session was closed (sign out, password change, erased account) is refused at once.
   */
  app.decorate('authenticate', async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
      const { sub, sid } = req.user as { sub: string; sid?: string };
      if (!sid || !isSessionLive(db, sid, sub)) throw new Error('gone');
    } catch {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  const hub = new Hub(db);
  const throttle = new LoginThrottle(config.loginLockout);
  const ctx: AppContext = { db, config, hub, throttle };
  app.decorate('ctx', ctx);

  app.setErrorHandler(function (
    error: {
      statusCode?: number;
      validation?: unknown;
      code?: string;
      message: string;
    },
    req,
    reply,
  ) {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      req.log.error(error);
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(status).send({
      error: error.validation ? 'validation_error' : (error.code ?? 'bad_request').toLowerCase(),
      message: error.validation ? error.message : undefined,
    });
  });

  app.get('/api/health', async function () {
    return {
      status: 'ok',
      version: config.version,
      connections: hub.connectionCount(),
    };
  });

  registerAuthRoutes(app, ctx);
  registerSocialRoutes(app, ctx);
  registerGuildRoutes(app, ctx);
  registerMessageRoutes(app, ctx);
  registerImageRoutes(app, ctx);
  registerSettingsSyncRoutes(app, ctx);
  registerGifRoutes(app, ctx);
  registerPreviewRoutes(app, ctx);
  registerSocket(app, ctx);

  // Cleanup of what nothing can reach any more (expired sessions, abandoned uploads). Not kept alive by the timer.
  const maintenance = function () {
    try {
      runMaintenance(ctx);
    } catch (error) {
      app.log.error(error);
    }
  };
  maintenance();
  const maintenanceTimer = setInterval(maintenance, MAINTENANCE_INTERVAL_MS);
  maintenanceTimer.unref();

  app.addHook('onClose', async function () {
    clearInterval(maintenanceTimer);
    hub.shutdown();
    db.close();
  });

  return app;
}
