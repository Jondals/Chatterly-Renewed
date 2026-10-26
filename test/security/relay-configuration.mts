/**
 * test/security/relay-configuration.mts
 * Relay-only calls must fail closed on the server, and the configuration must be strict about secrets.
 */
import { createHmac } from 'node:crypto';
import { loadConfig, relayProblem } from '../../backend/src/config';
import { check, step, makeApp, signUp, call } from './support.mts';

/** Relay-only calls must fail closed on the server, and the configuration must be strict about secrets. */
export async function checkRelayConfiguration(): Promise<void> {
  step('calls: the relay policy fails closed (server)');
  const turn = {
    urls: ['turn:relay.test:3478?transport=udp'],
    secret: 'x'.repeat(40),
    ttlSec: 3600,
  };

  const broken = await makeApp({ relayOnly: true, turn: null, stunUrls: [] });
  const account = await signUp(broken, 'relayless');
  const refused = await call(broken, account, 'GET', '/api/rtc/config');
  check(refused.statusCode === 503, 'relay-only without a relay answers 503, not a STUN-only list');
  check(refused.json().error === 'relay_unavailable', 'the refusal says the relay is unavailable');
  check(!refused.body.includes('stun:'), 'the refusal offers no STUN server to fall back to');
  const unauthenticated = await call(broken, null, 'GET', '/api/rtc/config');
  check(unauthenticated.statusCode === 401, 'the call configuration needs a session');
  check(
    relayProblem({ relayOnly: true, turn: null }) !== null,
    'relayProblem reports the missing relay',
  );
  await broken.close();

  const strict = await makeApp({
    relayOnly: true,
    turn,
    stunUrls: ['stun:stun.l.google.com:19302'],
  });
  const person = await signUp(strict, 'private');
  const answer = (await call(strict, person, 'GET', '/api/rtc/config')).json();
  check(answer.relayOnly === true, 'relay-only is announced to the client');
  check(answer.iceServers.length === 1, 'relay-only lists exactly one ICE server');
  check(
    answer.iceServers[0].urls.every(function isTurn(url: string) {
      return url.startsWith('turn:');
    }),
    'relay-only lists no STUN address, even when STUN_URLS is set',
  );
  check(
    answer.iceServers[0].credential ===
      createHmac('sha1', turn.secret).update(answer.iceServers[0].username).digest('base64'),
    'the relay credential is the coturn HMAC of its username',
  );
  const [expiry, owner] = String(answer.iceServers[0].username).split(':');
  check(owner === person.id, 'the relay username names the account that asked');
  check(
    Number(expiry) * 1000 > Date.now() && Number(expiry) * 1000 <= Date.now() + 3_700_000,
    'the relay credential is short lived',
  );
  check(answer.expiresAt === Number(expiry) * 1000, 'the answer says when the credential expires');
  check(
    !JSON.stringify(answer).includes(turn.secret),
    'the TURN secret is never sent to the browser',
  );
  await strict.close();

  const open = await makeApp({ relayOnly: false, turn, stunUrls: [] });
  const caller = await signUp(open, 'open');
  const loose = (await call(open, caller, 'GET', '/api/rtc/config')).json();
  check(
    loose.relayOnly === false && loose.iceServers.length === 2,
    'without relay-only, STUN and TURN are listed',
  );
  await open.close();

  step('calls: Cloudflare managed relay');
  const cloudflareTurn = { keyId: 'key-id', apiToken: 't'.repeat(40), ttlSec: 3600 };
  const asked: { url: string; auth: string; body: string }[] = [];
  const cloudflare = await makeApp({
    relayOnly: true,
    turn: null,
    stunUrls: [],
    cloudflareTurn,
    fetch: async function fakeCloudflare(input: string | URL | Request, init?: RequestInit) {
      asked.push({
        url: String(input),
        auth: String((init?.headers as Record<string, string>)['Authorization']),
        body: String(init?.body),
      });
      return new Response(
        JSON.stringify({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:53?transport=udp',
                'turns:turn.cloudflare.com:443?transport=tcp',
              ],
              username: 'cf-user',
              credential: 'cf-pass',
            },
          ],
        }),
        { status: 201 },
      );
    } as typeof fetch,
  });
  const cfPerson = await signUp(cloudflare, 'cloudflare');
  const cfAnswer = (await call(cloudflare, cfPerson, 'GET', '/api/rtc/config')).json();
  check(asked.length === 1 && asked[0]!.url.includes('/turn/keys/key-id/'), 'Cloudflare is asked with the key id');
  check(asked[0]!.auth === `Bearer ${cloudflareTurn.apiToken}`, 'Cloudflare is asked with the API token');
  check(JSON.parse(asked[0]!.body).ttl === 3600, 'the requested credentials are short lived');
  check(
    cfAnswer.iceServers.length === 1 &&
      cfAnswer.iceServers[0].username === 'cf-user' &&
      cfAnswer.iceServers[0].urls.length === 2 &&
      cfAnswer.iceServers[0].urls.every(function isTurn(url: string) {
        return /^turns?:/.test(url) && !url.includes(':53');
      }),
    'relay-only keeps only the Cloudflare TURN addresses (no STUN, no port 53)',
  );
  check(!JSON.stringify(cfAnswer).includes(cloudflareTurn.apiToken), 'the API token never reaches the browser');
  check(relayProblem({ relayOnly: true, turn: null, cloudflareTurn }) === null, 'Cloudflare satisfies relay-only');
  await cloudflare.close();

  const cfDown = await makeApp({
    relayOnly: true,
    turn: null,
    stunUrls: [],
    cloudflareTurn,
    fetch: async function failing() {
      return new Response('nope', { status: 500 });
    } as typeof fetch,
  });
  const cfDownPerson = await signUp(cfDown, 'cfdown');
  const cfRefused = await call(cfDown, cfDownPerson, 'GET', '/api/rtc/config');
  check(cfRefused.statusCode === 503, 'relay-only fails closed when Cloudflare does not answer');
  await cfDown.close();

  step('configuration: environment variables');
  const saved = { ...process.env };
  try {
    process.env['RELAY_ONLY'] = '1';
    delete process.env['TURN_URLS'];
    delete process.env['TURN_SECRET'];
    delete process.env['STUN_URLS'];
    const config = loadConfig({
      jwtSecret: 'j'.repeat(48),
      serverSecret: 's'.repeat(48),
    });
    check(
      config.relayOnly === true,
      'RELAY_ONLY=1 stays on when no relay is configured (it does not turn itself off)',
    );
    check(config.stunUrls.length === 0, 'RELAY_ONLY=1 does not fall back to public STUN servers');
    check(relayProblem(config) !== null, 'the missing relay is reported at start');
    process.env['TURN_URLS'] = 'stun:only-stun.test:3478';
    process.env['TURN_SECRET'] = 'z'.repeat(40);
    const stunOnly = loadConfig({
      jwtSecret: 'j'.repeat(48),
      serverSecret: 's'.repeat(48),
    });
    check(stunOnly.turn === null, 'a STUN address is not accepted as a TURN relay');
    process.env['TURN_URLS'] = 'turn:relay.test:3478';
    const ready = loadConfig({
      jwtSecret: 'j'.repeat(48),
      serverSecret: 's'.repeat(48),
    });
    check(
      ready.turn !== null && relayProblem(ready) === null,
      'a valid relay satisfies relay-only',
    );
    check(ready.turn?.ttlSec === 3600, 'the relay credentials last one hour by default');
    const ttlCases: [string, number][] = [
      ['86400', 86400],
      ['10', 300],
      ['99999999', 7 * 24 * 3600],
      ['abc', 3600],
      ['-5', 3600],
    ];
    for (const [value, expected] of ttlCases) {
      process.env['TURN_TTL_SEC'] = value;
      const withTtl = loadConfig({
        jwtSecret: 'j'.repeat(48),
        serverSecret: 's'.repeat(48),
      });
      check(
        withTtl.turn?.ttlSec === expected,
        `TURN_TTL_SEC=${value} gives ${expected} seconds (limits: 5 minutes to 7 days)`,
      );
    }
    delete process.env['TURN_TTL_SEC'];
    delete process.env['RELAY_ONLY'];
    process.env['JWT_SECRET'] = 'too-short';
    process.env['SERVER_SECRET'] = 'q'.repeat(48);
    let rejected = false;
    try {
      loadConfig({});
    } catch {
      rejected = true;
    }
    check(rejected, 'a JWT secret shorter than 32 characters is refused');
    process.env['JWT_SECRET'] = 'q'.repeat(48);
    rejected = false;
    try {
      loadConfig({});
    } catch {
      rejected = true;
    }
    check(rejected, 'the same value for both secrets is refused');
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
