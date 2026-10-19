/**
 * test/e2e/21-api-requests-without-a-session-and-cors.mjs
 * API: requests without a session, and CORS.
 */
import { errors, step, check } from './support.mjs';

/** API: requests without a session, and CORS. */
export async function step21(world) {
  const { API } = world;
  step('API: requests without a session, and CORS');
  for (const route of [
    '/api/friends',
    '/api/guilds',
    '/api/images/x',
    '/api/gifs/status',
    '/api/rtc/config',
  ]) {
    const r = await fetch(API + route);
    check(r.status === 401, `${route} without a session answers 401`);
  }
  // The downloads of the first page are public: a redirect to the latest release (or to the list of releases), never anything else.
  for (const app of ['windows', 'mac', 'linux', 'android', 'ios']) {
    const r = await fetch(API + '/api/download/' + app, { redirect: 'manual' });
    const to = r.headers.get('location') ?? '';
    check(
      r.status === 302 && /^https:\/\/github\.com\/Jondals\/Chatterly-Renewed\/releases(\/|$)/.test(to),
      `/api/download/${app} sends to the releases of the project (${r.status} ${to.slice(0, 60)})`,
    );
  }
  check((await fetch(API + '/api/download/beos')).status === 404, 'an unknown app has no download');
  const pre = await fetch(API + '/api/friends', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://evil.example',
      'access-control-request-method': 'GET',
    },
  });
  check(!pre.headers.get('access-control-allow-origin'), 'a disallowed origin gets no CORS');
  const hdr = await fetch(API + '/api/friends');
  check(hdr.headers.get('x-content-type-options') === 'nosniff', 'defensive headers present');

  check(
    errors.length === 0,
    'no errors in the browser console' + (errors.length ? ':\n' + errors.join('\n') : ''),
  );
}
