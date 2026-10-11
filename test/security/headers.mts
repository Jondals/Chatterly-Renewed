/**
 * test/security/headers.mts
 * Response headers of the API.
 */
import { check, step, makeApp } from './support.mts';

/** Response headers of the API. */
export async function checkHeaders(): Promise<void> {
  step('API: headers and errors');
  const app = await makeApp();
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  check(health.headers['x-content-type-options'] === 'nosniff', 'nosniff on API answers');
  check(
    String(health.headers['content-security-policy']).includes("default-src 'none'"),
    'the API has a locked-down CSP',
  );
  check(health.headers['cache-control'] === 'no-store', 'API answers are not cached');
  check(!health.headers['x-powered-by'], 'the server does not announce its software');
  const cors = await app.inject({
    method: 'OPTIONS',
    url: '/api/friends',
    headers: {
      origin: 'http://evil.test',
      'access-control-request-method': 'GET',
    },
  });
  check(
    !cors.headers['access-control-allow-origin'],
    'a site that is not listed gets no CORS permission',
  );
  const allowed = await app.inject({
    method: 'OPTIONS',
    url: '/api/friends',
    headers: {
      origin: 'http://app.test',
      'access-control-request-method': 'GET',
    },
  });
  check(
    allowed.headers['access-control-allow-origin'] === 'http://app.test',
    'the listed site does',
  );
  const oversized = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'a', authSecret: 'x'.repeat(300_000) },
  });
  check(oversized.statusCode === 413, 'a body over the limit is refused');
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'a' },
  });
  check(
    invalid.statusCode === 400 && invalid.json().error === 'validation_error',
    'invalid input is a 400 with a short error',
  );
  await app.close();
}
