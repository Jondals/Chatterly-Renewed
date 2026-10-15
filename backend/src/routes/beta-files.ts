/**
 * src/routes/beta-files.ts
 * Where the beta installers live and who may download them. The stable releases stay on GitHub; a beta is never published
 * there: the build uploads it here and only the beta testers (and the administrators) can download it.
 *
 * * Download: the desktop app of a tester asks GET /api/beta/feed (with the session) and gets a token that lasts two hours and is
 *   tied to that account. It sends the token in the Authorization header (never in the address, so no log can keep it) to
 *   GET /api/beta/dl/:file. ! The account is checked AGAIN on every download: taking somebody off the list stops them at once.
 * * Integrity: the server is NOT trusted to say what an update is. Every manifest (beta.yml) travels with a signature (beta.yml.sig)
 *   made in the build with a key that never reaches the server, and the app verifies it before it installs anything.
 * * Upload: only the build, with BETA_UPLOAD_TOKEN (PUT /api/beta/upload/:file). Without that variable uploading is off. Only the
 *   newest beta is kept: uploading a manifest deletes the installers that no manifest points to any more.
 * * The server keeps no record of who downloads what: the log has the path and the status, never the account or the address.
 * ! Every failure of the download routes is the same 404, so nobody learns whether a file or a token exists.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { callerId } from '../validation';
import { canUseBeta } from './beta';

/** What the download token is worth: two hours, which is enough to download an installer on a slow line. */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
/** How long a file that no manifest points to is kept before it is deleted. */
const GRACE_MS = 60 * 60 * 1000;
/** The biggest file the build may upload. */
const MAX_FILE_BYTES = 400 * 1024 * 1024;
/**
 * The names that exist here: the manifests (and their signatures) of each platform and the installers. Nothing else.
 * * Android: beta-android.yml says which APK is the beta (its version, file and SHA-256). It needs no Ed25519 signature: the app
 *   installs an APK only if Android confirms it is signed with the same certificate as the installed app and is newer.
 */
const FILE_NAME =
  /^(?:(?:beta|beta-linux)\.yml(?:\.sig)?|beta-android\.yml|Chatterly-[0-9A-Za-z.-]{1,60}\.(?:exe|AppImage|apk))$/;
const MANIFEST_NAME = /^(?:beta|beta-linux|beta-android)\.yml$/;
const INSTALLER_NAME = /^Chatterly-[0-9A-Za-z.-]{1,60}\.(?:exe|AppImage|apk)$/;

/** Stops a stream that is bigger than allowed. */
class SizeLimit extends Transform {
  private seen = 0;

  _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.seen += chunk.length;
    if (this.seen > MAX_FILE_BYTES) {
      done(new Error('too_big'));
      return;
    }
    done(null, chunk);
  }
}

/** Registers the routes that hand out the beta installers and take them from the build. */
export function registerBetaFileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;
  const auth = { onRequest: [app.authenticate] };
  const tokenKey = createHmac('sha256', config.serverSecret).update('beta-download-v1').digest();

  function sign(text: string): string {
    return createHmac('sha256', tokenKey).update(text).digest('base64url');
  }

  /** The token of an account: "<account>.<expires>.<signature>". */
  function makeToken(userId: string, expires: number): string {
    const body = userId + '.' + expires;
    return body + '.' + sign(body);
  }

  /** The account a valid, unexpired token belongs to, or null. */
  function readToken(header: string | undefined): string | null {
    if (header === undefined || !header.startsWith('Bearer ')) return null;
    const parts = header.slice(7).split('.');
    if (parts.length !== 3) return null;
    const [userId, expires, signature] = parts as [string, string, string];
    const expected = Buffer.from(sign(userId + '.' + expires));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (!(Number(expires) > Date.now())) return null;
    return userId;
  }

  /** True when the request carries the upload secret of the build. */
  function isBuild(req: FastifyRequest): boolean {
    if (config.betaUploadToken === '') return false;
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) return false;
    const given = createHash('sha256').update(header.slice(7)).digest();
    const expected = createHash('sha256').update(config.betaUploadToken).digest();
    return timingSafeEqual(given, expected);
  }

  function missing(reply: FastifyReply): FastifyReply {
    return reply.code(404).send({ error: 'not_found' });
  }

  /** The path of a file of the folder, or null when the name is not one of the allowed ones. */
  function filePath(name: string): string | null {
    return FILE_NAME.test(name) ? path.join(config.betaDir, name) : null;
  }

  /** A tester (or administrator) asks for the token the desktop app uses to download. */
  app.get(
    '/api/beta/feed',
    { ...auth, config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async function (req, reply) {
      const id = callerId(req);
      if (!canUseBeta(ctx, id)) return missing(reply);
      const expires = Date.now() + TOKEN_TTL_MS;
      return { token: makeToken(id, expires), expiresAt: expires };
    },
  );

  /** Gives a file to an account that holds a valid token and still belongs to the program. */
  app.get(
    '/api/beta/dl/:file',
    {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: {
        params: {
          type: 'object',
          required: ['file'],
          properties: { file: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async function (req, reply) {
      const userId = readToken(req.headers.authorization);
      if (userId === null || !canUseBeta(ctx, userId)) return missing(reply);
      const target = filePath((req.params as { file: string }).file);
      if (target === null) return missing(reply);
      let size: number;
      try {
        const stat = fs.statSync(target);
        if (!stat.isFile()) return missing(reply);
        size = stat.size;
      } catch {
        return missing(reply);
      }
      return reply
        .header('content-length', size)
        .type('application/octet-stream')
        .send(fs.createReadStream(target));
    },
  );

  /** The routes of the build live in their own scope: only they read an upload as a raw stream (content type application/x-chatterly-beta: the octet-stream one belongs to encrypted attachments). */
  app.register(async function buildRoutes(scope) {
    scope.addContentTypeParser(
      'application/x-chatterly-beta',
      function rawStream(_req, payload, done) {
        done(null, payload);
      },
    );

    /** The number of the next beta of a version (1, 2, 3...), the same one when the same commit asks again. */
    scope.get(
      '/api/beta/next',
      {
        config: { rateLimit: { max: 30, timeWindow: 60_000 } },
        schema: {
          querystring: {
            type: 'object',
            required: ['base', 'sha'],
            additionalProperties: false,
            properties: {
              base: { type: 'string', pattern: '^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}$' },
              sha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
            },
          },
        },
      },
      async function (req, reply) {
        if (!isBuild(req)) return missing(reply);
        const { base, sha } = req.query as { base: string; sha: string };
        const file = path.join(config.betaDir, 'counter.json');
        fs.mkdirSync(config.betaDir, { recursive: true });
        let counter: Record<string, { last: number; shas: Record<string, number> }> = {};
        try {
          counter = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
          counter = {};
        }
        const entry = counter[base] ?? { last: 0, shas: {} };
        let number = entry.shas[sha];
        if (number === undefined) {
          number = entry.last + 1;
          entry.last = number;
          entry.shas[sha] = number;
          counter[base] = entry;
          fs.writeFileSync(file, JSON.stringify(counter));
        }
        return { number };
      },
    );

    /** The build uploads one file (an installer, a manifest or the signature of a manifest). */
    scope.put(
      '/api/beta/upload/:file',
      {
        bodyLimit: MAX_FILE_BYTES + 1024,
        config: { rateLimit: { max: 60, timeWindow: 60_000 } },
        schema: {
          params: {
            type: 'object',
            required: ['file'],
            properties: { file: { type: 'string', maxLength: 100 } },
          },
        },
      },
      async function (req, reply) {
        if (!isBuild(req)) return missing(reply);
        const name = (req.params as { file: string }).file;
        const target = filePath(name);
        if (target === null) return reply.code(400).send({ error: 'bad_name' });
        fs.mkdirSync(config.betaDir, { recursive: true });
        const partial = path.join(config.betaDir, '.part-' + randomBytes(8).toString('hex'));
        try {
          await pipeline(
            req.body as NodeJS.ReadableStream,
            new SizeLimit(),
            fs.createWriteStream(partial),
          );
        } catch (error) {
          fs.rmSync(partial, { force: true });
          const tooBig = error instanceof Error && error.message === 'too_big';
          return reply.code(tooBig ? 413 : 400).send({ error: tooBig ? 'too_big' : 'bad_upload' });
        }
        fs.renameSync(partial, target);
        if (MANIFEST_NAME.test(name)) prune();
        return reply.code(201).send({ ok: true });
      },
    );
  });

  /** Keeps what a manifest points to and deletes the installers nobody points to (and left-over partial uploads). */
  function prune(): void {
    const keep = new Set<string>();
    for (const manifest of ['beta.yml', 'beta-linux.yml', 'beta-android.yml']) {
      try {
        const text = fs.readFileSync(path.join(config.betaDir, manifest), 'utf8');
        const found = /^path:\s*(\S+)\s*$/m.exec(text);
        if (found) keep.add(found[1]!);
      } catch {
        // No manifest for that platform yet.
      }
    }
    // ? An hour of grace: the build uploads both platforms one after the other, and the first manifest must not delete the
    //   installer of the other platform that has just arrived.
    const old = Date.now() - GRACE_MS;
    for (const entry of fs.readdirSync(config.betaDir)) {
      const removable =
        entry.startsWith('.part-') || (INSTALLER_NAME.test(entry) && !keep.has(entry));
      if (removable && fs.statSync(path.join(config.betaDir, entry)).mtimeMs < old) {
        fs.rmSync(path.join(config.betaDir, entry), { force: true });
      }
    }
  }
}
