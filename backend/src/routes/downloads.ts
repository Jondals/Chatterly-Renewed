/**
 * src/routes/downloads.ts
 * GET /api/download/:app: sends the person to the file of the LATEST published release for their device. The first page of the web
 * links here instead of to a file with a version in its name (that file does not exist until its release is published, and a page
 * that was built before the next release would point to an old one).
 *
 * * The server asks GitHub which release is the latest (its public API, once every few minutes, never with anything about the
 *   person) and answers with a redirect to that file. A person who clicks goes to GitHub for the download, as before.
 * ! It only redirects to files of this project's releases: the address is checked before it is sent. When GitHub cannot be
 *   reached, or the release has no file for that device (yet), it sends the person to the list of releases.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';

/** The repository whose releases hold the apps. */
const REPO = process.env['RELEASES_REPO'] ?? 'Jondals/Chatterly-Renewed';
/** The extension of the file of each app. */
const EXTENSIONS: Record<string, string> = {
  windows: 'exe',
  mac: 'dmg',
  linux: 'AppImage',
  android: 'apk',
  ios: 'ipa',
};
/** How long the answer of GitHub is kept. */
const KEEP_MS = 10 * 60 * 1000;

/** What is kept of a release: the address of each file by name. */
interface Latest {
  at: number;
  files: Map<string, string>;
}

export function registerDownloadRoutes(app: FastifyInstance, ctx: AppContext): void {
  const doFetch = ctx.config.fetch ?? fetch;
  const releases = 'https://github.com/' + REPO + '/releases';
  const allowed = new RegExp('^https://github\\.com/' + REPO.replace('/', '\\/') + '/releases/download/');
  let latest: Latest | null = null;
  let pending: Promise<Latest> | null = null;

  /** The files of the latest release (kept for a few minutes; an empty list when GitHub does not answer). */
  async function read(): Promise<Latest> {
    if (latest && Date.now() - latest.at < KEEP_MS) return latest;
    pending ??= (async function ask(): Promise<Latest> {
      const files = new Map<string, string>();
      try {
        const res = await doFetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
          signal: AbortSignal.timeout(5000),
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'chatterly-renewed' },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            assets?: { name?: string; browser_download_url?: string }[];
          };
          for (const asset of data.assets ?? []) {
            if (
              typeof asset.name === 'string' &&
              typeof asset.browser_download_url === 'string' &&
              allowed.test(asset.browser_download_url)
            ) {
              files.set(asset.name, asset.browser_download_url);
            }
          }
        }
      } catch {
        /* no answer: the person is sent to the list of releases */
      }
      // A failure is remembered for a minute only, a good answer for ten.
      latest = { at: files.size > 0 ? Date.now() : Date.now() - KEEP_MS + 60_000, files };
      return latest;
    })().finally(function done() {
      pending = null;
    });
    return pending;
  }

  app.get(
    '/api/download/:app',
    {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: {
        params: {
          type: 'object',
          required: ['app'],
          properties: { app: { type: 'string', maxLength: 16 } },
        },
      },
    },
    /** GET /api/download/:app: a redirect to the file of that app in the latest release (or to the releases). */
    async function (req, reply) {
      const extension = EXTENSIONS[(req.params as { app: string }).app];
      if (!extension) return reply.code(404).send({ error: 'unknown_app' });
      const { files } = await read();
      for (const [name, url] of files) {
        if (/^Chatterly-[0-9][0-9A-Za-z.-]*$/.test(name.slice(0, -(extension.length + 1))) && name.endsWith('.' + extension)) {
          return reply.header('Cache-Control', 'no-store').redirect(url);
        }
      }
      return reply.header('Cache-Control', 'no-store').redirect(releases);
    },
  );
}
