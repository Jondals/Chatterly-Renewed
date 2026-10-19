/**
 * src/routes/player.ts
 * GET /api/player/youtube and GET /api/player/relay.js: the page that shows the YouTube player of "listen and watch together" for
 * the iPhone and iPad app.
 *
 * Why it exists: YouTube refuses to play an embedded video unless the page that shows it sends a Referer (error 153). The page of
 * the iOS app is capacitor://localhost, which is not an http address, so no Referer is sent. This page is served by the server over
 * https, so the player inside it gets one; the app shows THIS page in its frame and talks to the player through it (the script
 * only passes messages along, in both directions).
 *
 * ! The address of the player is built here from identifiers checked against a strict pattern, never from text of the request.
 * ! Only the iOS app may frame it (frame-ancestors), and the page loads nothing but its own script and the YouTube player.
 */
import type { FastifyInstance } from 'fastify';

/** The video and the list of YouTube are made of these characters only. */
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
/** A host name, with an optional port (it is only written into the address of the player as the origin of this page). */
const HOST = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;
/** The player of YouTube (without cookies). */
const YOUTUBE = 'https://www.youtube-nocookie.com';
/** The same options the app uses in a browser (see embedUrl in music-link.ts). */
const OPTIONS =
  'enablejsapi=1&autoplay=1&rel=0&modestbranding=1&playsinline=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0';

/** The script of the page: it passes messages from the app to the player and from the player to the app, nothing else. */
const RELAY = `'use strict';
(function relay() {
  var frame = document.getElementById('player');
  var youtube = '${YOUTUBE}';
  window.addEventListener('message', function onMessage(event) {
    if (event.source === window.parent) {
      try {
        frame.contentWindow.postMessage(event.data, youtube);
      } catch (error) {
        /* the player is changing page: the app asks again */
      }
      return;
    }
    if (event.source === frame.contentWindow && event.origin === youtube) {
      window.parent.postMessage(event.data, '*');
    }
  });
})();
`;

/** The address of the player of YouTube for these identifiers (null when they are not valid). */
function playerAddress(
  query: { v?: string; list?: string; start?: string },
  origin: string,
): string | null {
  const start = Number(query.start ?? 0);
  const startPart =
    Number.isInteger(start) && start > 1 && start <= 86400 && !query.list ? '&start=' + start : '';
  const originPart = '&origin=' + encodeURIComponent(origin);
  if (query.list && !query.v) {
    if (!LIST_ID.test(query.list)) return null;
    return YOUTUBE + '/embed/videoseries?list=' + query.list + '&' + OPTIONS + originPart;
  }
  if (!query.v || !VIDEO_ID.test(query.v)) return null;
  if (query.list && !LIST_ID.test(query.list)) return null;
  return (
    YOUTUBE +
    '/embed/' +
    query.v +
    '?' +
    (query.list ? 'list=' + query.list + '&' : '') +
    OPTIONS +
    originPart +
    startPart
  );
}

export function registerPlayerRoutes(app: FastifyInstance): void {
  /** GET /api/player/youtube?v=&list=&start=: the page with the player (null identifiers: 400). */
  app.get(
    '/api/player/youtube',
    {
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
      schema: {
        querystring: {
          type: 'object',
          properties: {
            v: { type: 'string', maxLength: 20 },
            list: { type: 'string', maxLength: 64 },
            start: { type: 'string', maxLength: 6 },
          },
          additionalProperties: false,
        },
      },
    },
    async function (req, reply) {
      const host = req.headers.host ?? '';
      if (!HOST.test(host)) return reply.code(400).send({ error: 'bad_request' });
      const address = playerAddress(req.query as { v?: string; list?: string; start?: string }, 'https://' + host);
      if (!address) return reply.code(400).send({ error: 'bad_request' });
      const page =
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<meta name="referrer" content="strict-origin"><title>Player</title></head>' +
        '<body style="margin:0;background:#000"><iframe id="player" src="' +
        address +
        '" style="position:absolute;inset:0;width:100%;height:100%;border:0" referrerpolicy="strict-origin-when-cross-origin"' +
        ' allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>' +
        '<script src="/api/player/relay.js"></script></body></html>';
      // ! Only the iOS app frames this page (its pages are capacitor://localhost); nothing else may load in it.
      reply.removeHeader('x-frame-options');
      return reply
        .header(
          'Content-Security-Policy',
          "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src " +
            YOUTUBE +
            '; frame-ancestors capacitor://localhost',
        )
        .header('Referrer-Policy', 'strict-origin')
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(page);
    },
  );

  /** GET /api/player/relay.js: the script of the page. */
  app.get(
    '/api/player/relay.js',
    { config: { rateLimit: { max: 120, timeWindow: 60_000 } } },
    async function (_req, reply) {
      return reply
        .header('Cache-Control', 'public, max-age=3600')
        .header('Content-Security-Policy', "default-src 'none'")
        .type('text/javascript; charset=utf-8')
        .send(RELAY);
    },
  );
}
