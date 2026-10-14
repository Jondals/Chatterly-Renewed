/**
 * src/routes/gifs.ts
 * Search and download proxy for GIFs (GIPHY), so the browser never talks to the providers.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';

/** Only media from the CDNs of the providers can be downloaded, so this endpoint cannot be used to reach internal hosts. */
const GIF_MEDIA =
  /^https:\/\/((media\d*|i)\.giphy\.com)\/(?!.*\.\.)[A-Za-z0-9_\-./%]+(\?[A-Za-z0-9_=&.%-]*)?$/;
const MAX_GIF_BYTES = 12 * 1024 * 1024;
const PAGE = 24;

interface GifItem {
  id: string;
  title: string;
  preview: string;
  url: string;
  width: number;
  height: number;
}

interface GifPage {
  results: GifItem[];
  next: string;
}

interface GiphyImage {
  url?: string;
  width?: string;
  height?: string;
}

interface GiphyResult {
  id: string;
  title?: string;
  images?: Record<string, GiphyImage>;
}

/**
 * GIF proxy. Searches GIPHY (when it has a key).
 * The browser never talks to the providers: searches go through this server and the chosen GIF is
 * downloaded here and encrypted again by the client as a normal attachment, so no provider knows who
 * is talking to whom.
 */
export function registerGifRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;
  const doFetch = config.fetch ?? fetch;
  const auth = { onRequest: [app.authenticate] };
  const limit = { config: { rateLimit: { max: 90, timeWindow: 60_000 } } };

  /** Whether the GIF service is configured (a key of Giphy). */
  function enabled(): boolean {
    return !!config.gifKey;
  }

  app.get('/api/gifs/status', auth, async function () {
    return { enabled: enabled() };
  });

  /** Asks Giphy and turns its answer into the format of the app. */
  async function giphy(
    path: 'search' | 'trending',
    params: Record<string, string>,
    offset: string,
  ): Promise<GifPage> {
    const url = new URL('https://api.giphy.com/v1/gifs/' + path);
    url.search = new URLSearchParams({
      api_key: config.gifKey,
      limit: String(PAGE),
      rating: 'pg-13',
      bundle: 'messaging_non_clips',
      ...params,
      ...(offset ? { offset } : {}),
    }).toString();
    const res = await doFetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('giphy_' + res.status);
    const data = (await res.json()) as {
      data?: GiphyResult[];
      pagination?: { offset: number; count: number; total_count: number };
    };
    const pg = data.pagination;
    return {
      next: pg && pg.offset + pg.count < pg.total_count ? String(pg.offset + pg.count) : '',
      results: (data.data ?? []).map(function (r) {
        const small = r.images?.['fixed_height_small'] ?? r.images?.['fixed_height'];
        const full = r.images?.['downsized'] ?? r.images?.['original'];
        return {
          id: 'g' + r.id,
          title: r.title ?? '',
          preview: small?.url ?? '',
          url: full?.url ?? small?.url ?? '',
          width: Number(small?.width) || 200,
          height: Number(small?.height) || 200,
        };
      }),
    };
  }

  /** Looks in the GIF service and returns one page, keeping only what comes from an allowed CDN. */
  async function lookup(
    kind: 'search' | 'featured',
    q: string,
    pos: string,
    lang: string,
  ): Promise<GifPage> {
    const page = await giphy(
      kind === 'search' ? 'search' : 'trending',
      kind === 'search' ? { q, lang } : {},
      pos,
    );
    return {
      results: page.results.filter(function allowed(item) {
        return GIF_MEDIA.test(item.preview) && GIF_MEDIA.test(item.url);
      }),
      next: page.next,
    };
  }

  const queryProps = {
    q: { type: 'string', maxLength: 80 },
    pos: { type: 'string', maxLength: 240 },
    locale: { type: 'string', maxLength: 10 },
  } as const;

  app.get(
    '/api/gifs/search',
    {
      ...auth,
      ...limit,
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          properties: queryProps,
        },
      },
    },
    /** GET /api/gifs/search: GIFs that match a search. */
    async function (req, reply) {
      if (!enabled()) return reply.code(503).send({ error: 'gifs_not_configured' });
      const { q, pos, locale } = req.query as {
        q: string;
        pos?: string;
        locale?: string;
      };
      try {
        return await lookup('search', q, pos ?? '', (locale ?? 'en').slice(0, 2));
      } catch {
        return reply.code(502).send({ error: 'gif_provider_error' });
      }
    },
  );

  app.get(
    '/api/gifs/featured',
    {
      ...auth,
      ...limit,
      schema: { querystring: { type: 'object', properties: queryProps } },
    },
    /** GET /api/gifs/featured: the GIFs of the moment. */
    async function (req, reply) {
      if (!enabled()) return reply.code(503).send({ error: 'gifs_not_configured' });
      const { pos, locale } = req.query as { pos?: string; locale?: string };
      try {
        return await lookup('featured', '', pos ?? '', (locale ?? 'en').slice(0, 2));
      } catch {
        return reply.code(502).send({ error: 'gif_provider_error' });
      }
    },
  );

  app.get(
    '/api/gifs/media',
    {
      ...auth,
      ...limit,
      schema: {
        querystring: {
          type: 'object',
          required: ['u'],
          properties: { u: { type: 'string', maxLength: 400 } },
        },
      },
    },
    /**
     * ! GET /api/gifs/media: passes a GIF through the server (only from the known hosts), so the browser never talks to the GIF service.
     */
    async function (req, reply) {
      const { u } = req.query as { u: string };
      if (!enabled()) return reply.code(503).send({ error: 'gifs_not_configured' });
      if (!GIF_MEDIA.test(u)) return reply.code(400).send({ error: 'invalid_media_url' });
      try {
        const res = await doFetch(u, {
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !/^image\/(gif|webp|png|jpeg)/.test(type))
          return reply.code(502).send({ error: 'gif_provider_error' });
        // ! Refuse before downloading when the provider already says the file is too big.
        if (Number(res.headers.get('content-length') ?? 0) > MAX_GIF_BYTES)
          return reply.code(413).send({ error: 'gif_too_large' });
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > MAX_GIF_BYTES) return reply.code(413).send({ error: 'gif_too_large' });
        return reply
          .header('Content-Type', type.split(';')[0]!)
          .header('Cache-Control', 'private, max-age=86400')
          .send(bytes);
      } catch {
        return reply.code(502).send({ error: 'gif_provider_error' });
      }
    },
  );
}
