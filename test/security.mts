/**
 * test/security.mts
 * Security regression checks of Chatterly-Renewed. It is one step of the single test (`pnpm test`, see run.mjs), but it can
 * also be run alone:  node backend/node_modules/tsx/dist/cli.mjs test/security.mts
 *
 * What it does: builds the real backend in memory (no network, no browser) and attacks it the way a hostile account
 * would: other people's channels, files and pictures by id, revoked and stale sessions, WebSocket abuse, the link-preview
 * fetcher against the server's own network, uploads with hidden metadata, account deletion in groups that other people
 * still use, a database from an older version. It also checks the pure parts of the call code: the frame cipher, the
 * relay-only policy (it must fail closed) and the freshness of signaling.
 *
 * ? Why one file with the backend in the same process: every check is fast and exact (no timing luck), and a failure
 * names the property that broke. The browser test (run.mjs) covers the screens; this one covers the guarantees.
 *
 * ! Safety: everything is temporary (in-memory database, a temporary folder removed at the end), keys are generated here
 * and no real secret, user or file is read. No arrow functions are used, like in the rest of the project.
 */
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildApp } from '../backend/src/app';
import { loadConfig, relayProblem, type AppConfig } from '../backend/src/config';
import { openDatabase, SCHEMA_VERSION } from '../backend/src/db';
import { runMaintenance, IMAGE_GRACE_MS } from '../backend/src/maintenance';
import { assertFetchable, isPrivateAddress, metaTags } from '../backend/src/routes/preview';
import { canSeeProfile } from '../backend/src/models';
import { sanitizeImage } from '../backend/src/security/image-sanitize';
import {
  MediaKeyChain,
  RATCHET_MS,
  TAG_BYTES,
  TRAILER_BYTES,
  deriveLinkSecrets,
  securityCode,
} from '../frontend/src/app/core/crypto/media-cipher';
import {
  RelayUnavailableError,
  buildPeerConfiguration,
  credentialExpiry,
  earliestExpiry,
  isFreshSignal,
  isRelayCandidate,
  needsIceRefresh,
  selectedPathKind,
} from '../frontend/src/app/core/rtc-policy';
import { createStaticHandler, resolveFile } from '../scripts/static-server.mjs';

const require = createRequire(import.meta.url);
const WebSocket = require('../backend/node_modules/ws');
const Database = require('../backend/node_modules/better-sqlite3');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chatterly-security-'));

/** Prints a passed check, or stops the whole run with the property that broke. */
function check(condition: unknown, message: string): void {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok  ' + message);
}

/** Prints the title of a group of checks. */
function step(title: string): void {
  console.log('\n== ' + title);
}

/** Waits for a number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(function executor(resolve) {
    setTimeout(resolve, ms);
  });
}

/** Waits until a condition holds (true) or the time runs out (false). */
async function until(condition: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await sleep(20);
  }
  return condition();
}

// ---- helpers to build a server and accounts --------------------------------------------------------------------

interface Account {
  id: string;
  username: string;
  authSecret: string;
  access: string;
  refresh: string;
}

/** The type of the server the tests build. */
type TestApp = Awaited<ReturnType<typeof buildApp>>;

/** A server with an in-memory database and fast hashing; the settings can be overridden per test. */
async function makeApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  return buildApp({
    dbPath: ':memory:',
    uploadDir: path.join(TMP, 'uploads-' + randomUUID()),
    jwtSecret: 'j'.repeat(48),
    serverSecret: 's'.repeat(48),
    corsOrigins: ['http://app.test'],
    scrypt: { N: 1 << 10, r: 8, p: 1 },
    rateLimit: { max: 1_000_000, authMax: 1_000_000, windowMs: 60_000 },
    logger: false,
    ...overrides,
  });
}

/** A fresh P-256 public key in the uncompressed raw form the server expects (base64 of 65 bytes). */
function publicKey(): string {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 65).toString('base64');
}

/** The body of a registration request for a user name. */
function registration(username: string, authSecret: string): Record<string, unknown> {
  return {
    username,
    authSecret,
    kdfSalt: randomBytes(16).toString('base64'),
    kdfIterations: 600_000,
    publicKeys: { ecdh: publicKey(), ecdsa: publicKey() },
    wrappedKeys: {
      ecdh: randomBytes(128).toString('base64'),
      ecdsa: randomBytes(128).toString('base64'),
    },
  };
}

/** Creates an account and returns its tokens. */
async function signUp(app: TestApp, name: string): Promise<Account> {
  const username = name + '_' + randomBytes(3).toString('hex');
  const authSecret = randomBytes(32).toString('base64');
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: registration(username, authSecret),
  });
  if (res.statusCode !== 201) throw new Error('sign up failed: ' + res.statusCode + ' ' + res.body);
  const body = res.json();
  return {
    id: body.user.id,
    username,
    authSecret,
    access: body.accessToken,
    refresh: body.refreshToken,
  };
}

/** Header with the access token of an account. */
function bearer(account: Account): Record<string, string> {
  return { authorization: 'Bearer ' + account.access };
}

/** A request as an account (or without a session when `account` is null). */
function call(
  app: TestApp,
  account: Account | null,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: account ? bearer(account) : {},
    payload: payload as never,
  });
}

/** Makes two accounts friends and returns the id of their direct channel. */
async function befriend(app: TestApp, a: Account, b: Account): Promise<string> {
  await call(app, a, 'POST', '/api/friends/request', { username: b.username });
  await call(app, b, 'POST', `/api/friends/${a.id}/accept`);
  const res = await call(app, a, 'POST', '/api/dms', { userId: b.id });
  return res.json().channelId;
}

/** Base64 of some random bytes, for the encrypted fields the server only stores. */
function blob(bytes: number): string {
  return randomBytes(bytes).toString('base64');
}

/** A sealed message body (the server never reads it; it only checks the shape). */
function sealed(): Record<string, unknown> {
  return { iv: blob(12), ciphertext: blob(40), signature: blob(64) };
}

/** A key envelope for a group (the server only stores it). */
function envelope(): { iv: string; data: string } {
  return { iv: blob(12), data: blob(48) };
}

/** Creates a group owned by `owner` and returns its id and its first text channel. */
async function makeGuild(app: TestApp, owner: Account): Promise<{ id: string; text: string }> {
  const res = await call(app, owner, 'POST', '/api/guilds', {
    name: 'Club',
    envelope: envelope(),
  });
  const guild = res.json().guild;
  const text = guild.channels.find(function isText(c: { type: string }) {
    return c.type === 'text';
  });
  return { id: guild.id, text: text.id };
}

// ---- pictures built by hand -----------------------------------------------------------------------------------

/** One PNG chunk with its CRC. */
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** A tiny PNG carrying text and EXIF chunks that mention a secret place. */
function pngWithMetadata(width = 1, height = 1, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(Math.min(width, 4) * 3, 200)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('Comment\0GPS-secret-place')),
    pngChunk('eXIf', Buffer.from('Exif-GPS-secret-place')),
    ...extra,
    pngChunk('IDAT', zlib.deflateSync(row)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A tiny JPEG with a JFIF header, an EXIF block with a GPS tag, a comment and a scan. */
function jpegWithExif(width = 2, height = 2): Buffer {
  function segment(marker: number, body: Buffer): Buffer {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(body.length + 2, 0);
    return Buffer.concat([Buffer.from([0xff, marker]), length, body]);
  }
  const frame = Buffer.alloc(9);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame.set([1, 1, 0x11, 0], 5);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, Buffer.from('Exif\0\0GPSLatitude-secret-place', 'latin1')),
    segment(0xfe, Buffer.from('comment-secret-place')),
    segment(0xc0, frame),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A tiny WebP (lossless) with EXIF and XMP chunks and the flags that announce them. */
function webpWithMetadata(): Buffer {
  function chunk(type: string, data: Buffer): Buffer {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  }
  const extended = Buffer.alloc(10);
  extended[0] = 0x2c;
  extended.set([2, 0, 0], 4);
  extended.set([2, 0, 0], 7);
  const body = Buffer.concat([
    Buffer.from('WEBP', 'latin1'),
    chunk('VP8X', extended),
    chunk('VP8L', Buffer.from([0x2f, 2, 0x80, 0, 0, 1, 2, 3])),
    chunk('EXIF', Buffer.from('GPS-secret-place')),
    chunk('XMP ', Buffer.from('xmp-secret-place')),
  ]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** A tiny GIF with a comment extension that hides text. */
function gifWithComment(): Buffer {
  return Buffer.concat([
    Buffer.from('GIF89a', 'latin1'),
    Buffer.from([1, 0, 1, 0, 0x80, 0, 0]),
    Buffer.from([0, 0, 0, 255, 255, 255]),
    Buffer.from([0x21, 0xfe, 6]),
    Buffer.from('secret'),
    Buffer.from([0]),
    Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0]),
    Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0]),
    Buffer.from([2, 2, 0x44, 0x01, 0]),
    Buffer.from([0x3b]),
  ]);
}

// ---- checks ---------------------------------------------------------------------------------------------------

/** Relay-only calls must fail closed on the server, and the configuration must be strict about secrets. */
async function checkRelayConfiguration(): Promise<void> {
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

/** Access tokens die with their session; refresh tokens work once; passwords and sockets follow. */
async function checkSessions(): Promise<void> {
  step('sessions: revocation is immediate');
  const app = await makeApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const alice = await signUp(app, 'alice');

  check((await call(app, alice, 'GET', '/api/me')).statusCode === 200, 'a new access token works');
  const legacy = app.jwt.sign({ sub: alice.id } as never, { expiresIn: 600 });
  const old = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { authorization: 'Bearer ' + legacy },
  });
  check(old.statusCode === 401, 'a token that names no session is refused');
  const forged = app.jwt.sign({ sub: alice.id, sid: randomUUID() } as never, {
    expiresIn: 600,
  });
  const unknown = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { authorization: 'Bearer ' + forged },
  });
  check(unknown.statusCode === 401, 'a signed token for a session that does not exist is refused');

  const rotated = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: alice.refresh },
    })
  ).json();
  check(Boolean(rotated.accessToken && rotated.refreshToken), 'a refresh token gives new tokens');
  check(
    (await call(app, alice, 'GET', '/api/me')).statusCode === 200,
    'the access token in flight survives the rotation of its session',
  );

  const live = await openSocket(port, rotated.accessToken);
  check(await live.ready, 'a socket opens with a valid access token');
  const reuse = await app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    payload: { refreshToken: alice.refresh },
  });
  check(reuse.statusCode === 401, 'a refresh token used twice is refused');
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + rotated.accessToken },
      })
    ).statusCode === 401,
    'reusing a refresh token closes the session: its access token stops working at once',
  );
  check((await live.closed) === 4401, 'and the open socket of that session is closed');

  const login = async function (): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: alice.username, authSecret: alice.authSecret },
    });
    return res.json();
  };
  const first = await login();
  const second = await login();
  const firstSocket = await openSocket(port, first.accessToken);
  await firstSocket.ready;
  await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    payload: { refreshToken: first.refreshToken },
  });
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + first.accessToken },
      })
    ).statusCode === 401,
    'logging out stops the access token at once, not after 15 minutes',
  );
  check((await firstSocket.closed) === 4401, 'logging out closes the socket of that session');
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + second.accessToken },
      })
    ).statusCode === 200,
    'another session of the same person is not affected',
  );

  const secondSocket = await openSocket(port, second.accessToken);
  await secondSocket.ready;
  const third = await login();
  const changed = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: { authorization: 'Bearer ' + third.accessToken },
    payload: {
      oldAuthSecret: alice.authSecret,
      newAuthSecret: randomBytes(32).toString('base64'),
      kdfSalt: randomBytes(16).toString('base64'),
      kdfIterations: 600_000,
      wrappedKeys: { ecdh: blob(128), ecdsa: blob(128) },
    },
  });
  check(changed.statusCode === 200, 'the password can be changed with the old proof');
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + third.accessToken },
      })
    ).statusCode === 401,
    'a password change ends every old session, including the one that asked',
  );
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + changed.json().accessToken },
      })
    ).statusCode === 200,
    'and gives the caller a new one',
  );
  check(
    (await secondSocket.closed) === 4401,
    'a password change closes the sockets of the other devices',
  );

  step('sessions: expiry and brute force');
  const dying = await signUp(app, 'dying');
  app.ctx.db
    .prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?')
    .run(Date.now() - 1, dying.id);
  check(
    (await call(app, dying, 'GET', '/api/me')).statusCode === 401,
    'an access token whose session expired is refused',
  );
  check(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: dying.refresh },
      })
    ).statusCode === 401,
    'an expired refresh token is refused',
  );
  const target = await signUp(app, 'target');
  let last = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: target.username,
        authSecret: randomBytes(32).toString('base64'),
      },
    });
    last = res.statusCode;
  }
  check(last === 429, 'six wrong passwords lock the account for a while');
  const stranger = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      username: 'nobody_here',
      authSecret: randomBytes(32).toString('base64'),
    },
  });
  check(stranger.statusCode === 401, 'an unknown user and a wrong password look the same');
  await app.close();
}

interface TestSocket {
  frames: Record<string, unknown>[];
  open: Promise<void>;
  ready: Promise<boolean>;
  closed: Promise<number>;
  send(message: unknown): void;
  raw(data: string): void;
}

/** Opens a WebSocket to the test server and authenticates it. */
async function openSocket(
  port: number,
  token: string | null,
  headers: Record<string, string> = {},
): Promise<TestSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  const frames: Record<string, unknown>[] = [];
  ws.on('message', function onMessage(data: Buffer) {
    frames.push(JSON.parse(data.toString()));
  });
  const closed = new Promise<number>(function executor(resolve) {
    ws.on('close', function onClose(code: number) {
      resolve(code);
    });
    ws.on('error', function onError() {
      return undefined;
    });
  });
  const open = new Promise<void>(function executor(resolve) {
    ws.on('open', function onOpen() {
      if (token) ws.send(JSON.stringify({ t: 'auth', token }));
      resolve();
    });
  });
  const ready = until(function hasReady() {
    return frames.some(function isReady(frame) {
      return frame['t'] === 'ready';
    });
  }, 4000);
  return {
    frames,
    open,
    ready,
    closed,
    send: function send(message: unknown) {
      ws.send(JSON.stringify(message));
    },
    raw: function raw(data: string) {
      ws.send(data);
    },
  };
}

/** Other people's channels, files, groups and pictures cannot be reached by guessing or changing an id. */
async function checkAuthorization(): Promise<void> {
  step('authorization: ids of other people');
  const app = await makeApp();
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const mallory = await signUp(app, 'mallory');
  const channel = await befriend(app, alice, bob);

  const posted = await call(app, alice, 'POST', `/api/channels/${channel}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });
  check(posted.statusCode === 201, 'a member can post in their direct channel');
  const messageId = posted.json().message.id;
  const upload = await app.inject({
    method: 'POST',
    url: `/api/channels/${channel}/files`,
    headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
    payload: randomBytes(64),
  });
  check(upload.statusCode === 201, 'a member can upload an encrypted attachment');
  const fileId = upload.json().fileId;
  check(
    (await call(app, bob, 'GET', `/api/files/${fileId}`)).statusCode === 200,
    'the other member downloads it',
  );

  const missing = randomUUID();
  const probes: [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?][] = [
    ['read the messages of a channel', 'GET', `/api/channels/${channel}/messages`],
    [
      'post in a channel',
      'POST',
      `/api/channels/${channel}/messages`,
      { ...sealed(), keyVersion: 1 },
    ],
    ['read the receipts of a channel', 'GET', `/api/channels/${channel}/receipts`],
    ['mark a channel as read', 'POST', `/api/channels/${channel}/receipt`, { read: 1 }],
    ['download an attachment', 'GET', `/api/files/${fileId}`],
    ['edit a message', 'PATCH', `/api/messages/${messageId}`, sealed()],
    ['delete a message', 'DELETE', `/api/messages/${messageId}`],
    ['react to a message', 'POST', `/api/messages/${messageId}/reactions`, sealed()],
  ];
  for (const [what, method, url, payload] of probes) {
    const outsider = await call(app, mallory, method, url, payload);
    const nobody = await call(
      app,
      mallory,
      method,
      url.replace(channel, missing).replace(messageId, missing).replace(fileId, missing),
      payload,
    );
    check(outsider.statusCode === 404, `an unrelated account cannot ${what} (404)`);
    check(
      outsider.statusCode === nobody.statusCode && outsider.body === nobody.body,
      `...and it cannot tell it from an id that does not exist (${what})`,
    );
    const anonymous = await call(app, null, method, url, payload);
    check(anonymous.statusCode === 401, `without a session nobody can ${what} (401)`);
  }
  const upload2 = await app.inject({
    method: 'POST',
    url: `/api/channels/${channel}/files`,
    headers: { ...bearer(mallory), 'content-type': 'application/octet-stream' },
    payload: randomBytes(64),
  });
  check(upload2.statusCode === 404, 'an unrelated account cannot upload into a channel');
  check(
    (await call(app, mallory, 'POST', '/api/dms', { userId: alice.id })).statusCode === 403,
    'direct chats only exist between friends',
  );
  for (const bad of ['..%2F..%2Fsecrets.json', '%00', 'x'.repeat(300), "1' OR '1'='1"]) {
    const res = await call(app, mallory, 'GET', `/api/files/${bad}`);
    check(
      [400, 404, 414].includes(res.statusCode),
      `a hostile file id is refused (${bad.slice(0, 16)}: ${res.statusCode})`,
    );
  }

  step('authorization: groups, and access that is taken away');
  const guild = await makeGuild(app, alice);
  check(
    (
      await call(app, bob, 'POST', `/api/guilds/${guild.id}/members`, {
        userId: mallory.id,
        envelope: envelope(),
      })
    ).statusCode === 404,
    'a person outside a group cannot bring anybody in',
  );
  const added = await call(app, alice, 'POST', `/api/guilds/${guild.id}/members`, {
    userId: bob.id,
    envelope: envelope(),
  });
  check(added.statusCode === 201, 'the owner adds a friend to the group');
  const groupFile = await app.inject({
    method: 'POST',
    url: `/api/channels/${guild.text}/files`,
    headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
    payload: randomBytes(64),
  });
  const groupFileId = groupFile.json().fileId;
  check(
    (await call(app, bob, 'GET', `/api/files/${groupFileId}`)).statusCode === 200,
    'a member downloads the group file',
  );
  check(
    (await call(app, mallory, 'GET', `/api/files/${groupFileId}`)).statusCode === 404,
    'an outsider cannot download it',
  );
  check(
    (await call(app, bob, 'DELETE', `/api/guilds/${guild.id}`)).statusCode === 403,
    'a member cannot delete the group',
  );
  check(
    (
      await call(app, bob, 'POST', `/api/guilds/${guild.id}/channels`, {
        name: 'x',
        type: 'text',
      })
    ).statusCode === 403,
    'a member cannot create channels',
  );
  check(
    (await call(app, bob, 'DELETE', `/api/guilds/${guild.id}/members/${alice.id}`)).statusCode ===
      400,
    'nobody removes the owner',
  );
  const left = await call(app, bob, 'DELETE', `/api/guilds/${guild.id}/members/${bob.id}`);
  check(left.statusCode === 204, 'a member can leave');
  check(
    (await call(app, bob, 'GET', `/api/files/${groupFileId}`)).statusCode === 404,
    'after leaving, the files of the group are closed',
  );
  check(
    (await call(app, bob, 'GET', `/api/channels/${guild.text}/messages`)).statusCode === 404,
    'after leaving, the messages of the group are closed',
  );
  const after = (await call(app, alice, 'GET', '/api/guilds')).json().guilds[0];
  check(after.needsRotation === true, 'after somebody leaves, the group key must be renewed');
  check(
    (
      await call(app, alice, 'POST', `/api/guilds/${guild.id}/members`, {
        userId: bob.id,
        envelope: envelope(),
      })
    ).statusCode === 409,
    'nobody can be added until the key is renewed',
  );

  step('direct links: /direct/<id> is only a screen; the data behind it is private');
  check(
    (await call(app, mallory, 'GET', `/api/channels/${channel}/messages`)).statusCode === 404,
    'the channel id of a /direct/<id> address gives an unrelated account nothing',
  );
  check(
    (await call(app, null, 'GET', `/api/channels/${channel}/messages`)).statusCode === 401,
    'and gives a visitor without a session nothing',
  );
  check(
    (await call(app, alice, 'GET', `/api/channels/${channel}/messages`)).statusCode === 200,
    'while the owner of the conversation reads it',
  );
  await app.close();
}

/** Uploaded pictures are checked and rebuilt without metadata; ids cannot reach other files. */
async function checkImages(): Promise<void> {
  step('pictures: metadata, malformed files and limits');
  const png = sanitizeImage(pngWithMetadata());
  check(png !== null && png.mime === 'image/png', 'a PNG is accepted');
  check(
    png !== null &&
      !png.data.includes('GPS-secret-place') &&
      !png.data.includes('tEXt') &&
      !png.data.includes('eXIf'),
    'the text and EXIF chunks of a PNG are removed',
  );
  check(
    png !== null &&
      png.data.includes('IHDR') &&
      png.data.includes('IDAT') &&
      png.data.includes('IEND'),
    'the chunks that draw the PNG stay',
  );
  const jpeg = sanitizeImage(jpegWithExif());
  check(
    jpeg !== null && jpeg.mime === 'image/jpeg' && jpeg.width === 2 && jpeg.height === 2,
    'a JPEG is accepted with its size',
  );
  check(
    jpeg !== null &&
      !jpeg.data.includes('GPSLatitude') &&
      !jpeg.data.includes('Exif') &&
      !jpeg.data.includes('secret-place'),
    'the EXIF block and the comment of a JPEG are removed',
  );
  check(
    jpeg !== null && jpeg.data.includes('JFIF') && jpeg.data[jpeg.data.length - 1] === 0xd9,
    'the JPEG keeps its header and end',
  );
  const webp = sanitizeImage(webpWithMetadata());
  check(
    webp !== null && webp.mime === 'image/webp' && webp.width === 3 && webp.height === 3,
    'a WebP is accepted with its size',
  );
  check(
    webp !== null &&
      !webp.data.includes('GPS-secret-place') &&
      !webp.data.includes('xmp-secret-place'),
    'the EXIF and XMP chunks of a WebP are removed',
  );
  check(webp !== null && (webp.data[20]! & 0x0c) === 0, 'and their flags are cleared');
  check(
    webp !== null && webp.data.readUInt32LE(4) === webp.data.length - 8,
    'and the size of the file is right',
  );
  const gif = sanitizeImage(gifWithComment());
  check(
    gif !== null && gif.mime === 'image/gif' && !gif.data.includes('secret'),
    'the comment of a GIF is removed',
  );

  check(
    sanitizeImage(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ) === null,
    'SVG is refused',
  );
  check(
    sanitizeImage(Buffer.from('<html><script>alert(1)</script></html>')) === null,
    'HTML is refused',
  );
  check(sanitizeImage(Buffer.alloc(0)) === null, 'an empty file is refused');
  check(sanitizeImage(randomBytes(64)) === null, 'random bytes are refused');
  check(sanitizeImage(pngWithMetadata().subarray(0, 40)) === null, 'a truncated PNG is refused');
  check(
    sanitizeImage(pngWithMetadata(60000, 60000)) === null,
    'a PNG that declares a gigantic size is refused',
  );
  check(
    sanitizeImage(pngWithMetadata(4097, 10)) === null,
    'a side longer than 4096 pixels is refused',
  );
  check(
    sanitizeImage(pngWithMetadata(1, 1, [pngChunk('ABCD', Buffer.from('x'))])) === null,
    'an unknown critical PNG chunk is refused',
  );
  check(
    sanitizeImage(jpegWithExif(65535, 65535)) === null,
    'a JPEG that declares a gigantic size is refused',
  );
  check(
    sanitizeImage(Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0])])) === null,
    'a truncated GIF is refused',
  );

  step('pictures: the routes');
  // (the global limit of requests is lifted here: this block makes more than the real limit allows in a minute)
  const app = await makeApp({ rateLimit: { max: 100000, authMax: 100000, windowMs: 60_000 } });
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const upload = async function (who: Account | null, body: Buffer, kind = 'group') {
    return app.inject({
      method: 'POST',
      url: '/api/images?kind=' + kind,
      headers: {
        ...(who ? bearer(who) : {}),
        'content-type': 'application/octet-stream',
      },
      payload: body,
    });
  };
  check((await upload(null, pngWithMetadata())).statusCode === 401, 'uploading needs a session');
  check(
    (await upload(alice, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).statusCode ===
      415,
    'a non-image is refused with 415',
  );
  check(
    (await upload(alice, pngWithMetadata(), 'wallpaper')).statusCode === 400,
    'an unknown kind is refused',
  );
  const stored = await upload(alice, pngWithMetadata());
  check(stored.statusCode === 201, 'a PNG with metadata is accepted');
  const imageId = stored.json().id;
  const onDisk = fs.readFileSync(path.join(app.ctx.config.uploadDir, 'images', imageId));
  check(!onDisk.includes('GPS-secret-place'), 'the file on the disk has no metadata');
  const downloaded = await call(app, bob, 'GET', `/api/images/${imageId}`);
  check(
    downloaded.statusCode === 200 && downloaded.headers['content-type'] === 'image/png',
    'group icons are readable by signed-in users (by design) with their real type',
  );
  check(
    String(downloaded.headers['content-security-policy']).includes('sandbox'),
    'and are served sandboxed',
  );
  check(downloaded.headers['x-content-type-options'] === 'nosniff', 'and with nosniff');
  check(
    (await call(app, null, 'GET', `/api/images/${imageId}`)).statusCode === 401,
    'a visitor without a session gets no picture',
  );
  check(
    (await call(app, bob, 'GET', `/api/images/${randomUUID()}`)).statusCode === 404,
    'an unknown picture is 404',
  );
  for (const bad of ['..%2F..%2Fsecrets.json', '..%2Fimages%2F' + imageId + '%2F..%2F..']) {
    const res = await call(app, bob, 'GET', `/api/images/${bad}`);
    check(
      res.statusCode === 404 || res.statusCode === 400,
      `a path in place of an id gives nothing (${bad.slice(0, 18)})`,
    );
  }
  step('profile pictures are end-to-end encrypted');
  const secretPicture = randomBytes(300);
  const avatarUp = await upload(alice, secretPicture, 'avatar');
  check(avatarUp.statusCode === 201, 'a profile picture is stored as the ciphertext it arrives as');
  const avatarId = avatarUp.json().id;
  check(
    fs.readFileSync(path.join(app.ctx.config.uploadDir, 'images', avatarId)).equals(secretPicture),
    'the server keeps the bytes untouched (it cannot read or rebuild them)',
  );
  check(
    (await upload(alice, Buffer.from('tiny'), 'avatar')).statusCode === 400,
    'too short to be ciphertext is refused',
  );
  check(
    (await call(app, bob, 'GET', `/api/images/${avatarId}`)).statusCode === 404,
    'a person without a key gets nothing, as if it did not exist',
  );
  check(
    (await call(app, alice, 'GET', `/api/images/${avatarId}`)).statusCode === 404,
    'not even the owner reads it before a key exists (their browser seals one for them)',
  );
  check(
    (await call(app, bob, 'GET', `/api/images/${avatarId}/audience`)).statusCode === 404,
    'only the owner asks who is missing a key',
  );
  const audience0 = (await call(app, alice, 'GET', `/api/images/${avatarId}/audience`)).json();
  check(
    audience0.missing.length === 1 && audience0.missing[0].id === alice.id,
    'a stranger is not in the audience; the owner is',
  );
  const mutual = await befriend(app, alice, bob);
  void mutual;
  const audience1 = (await call(app, alice, 'GET', `/api/images/${avatarId}/audience`)).json();
  check(
    audience1.missing.some(function (m: { id: string }) {
      return m.id === bob.id;
    }),
    'a friend joins the audience',
  );
  const keyFor = function (viewer: Account) {
    return {
      viewerId: viewer.id,
      iv: Buffer.alloc(12, 1).toString('base64'),
      ciphertext: Buffer.alloc(48, 2).toString('base64'),
    };
  };
  check(
    (
      await call(app, bob, 'PUT', `/api/images/${avatarId}/keys`, {
        keys: [keyFor(bob)],
      })
    ).statusCode === 404,
    'only the owner can seal keys',
  );
  const carolStranger = await signUp(app, 'carol2');
  const sealedKeys = await call(app, alice, 'PUT', `/api/images/${avatarId}/keys`, {
    keys: [keyFor(alice), keyFor(bob), keyFor(carolStranger)],
  });
  check(sealedKeys.json().stored === 2, 'keys for people outside the audience are dropped');
  check(
    (await call(app, bob, 'GET', `/api/images/${avatarId}`)).rawPayload.equals(secretPicture),
    'with a key sealed for them, a friend downloads the ciphertext',
  );
  const opened = (await call(app, bob, 'GET', `/api/images/${avatarId}/open`)).json();
  check(
    opened.ownerEcdh ===
      (
        app.ctx.db.prepare('SELECT pub_ecdh AS k FROM users WHERE id = ?').get(alice.id) as {
          k: string;
        }
      ).k && Buffer.from(opened.data, 'base64').equals(secretPicture),
    'and gets, in one answer, the picture and the key sealed for them with the public key of the owner',
  );
  check(
    (await call(app, carolStranger, 'GET', `/api/images/${avatarId}`)).statusCode === 404,
    'a stranger still gets nothing',
  );
  check(
    (await call(app, carolStranger, 'GET', `/api/images/${avatarId}/open`)).statusCode === 404,
    'and no key',
  );
  check(canSeeProfile(app.ctx.db, alice.id, bob.id), 'a friend may see the pictures');
  await call(app, alice, 'DELETE', `/api/friends/${bob.id}`);
  // (the direct conversation of the two is kept after the friendship ends, and it also counts: take it out for this check)
  app.ctx.db.prepare('DELETE FROM dm_members WHERE user_id IN (?, ?)').run(alice.id, bob.id);
  check(
    !canSeeProfile(app.ctx.db, alice.id, bob.id),
    'a person who is no longer a friend may not see them, although their key is still stored',
  );
  await befriend(app, alice, bob);
  check(
    (await call(app, bob, 'PATCH', '/api/me', { avatarImage: avatarId })).statusCode === 400,
    "nobody can use another person's picture as theirs",
  );
  check(
    (await call(app, alice, 'PATCH', '/api/me', { avatarImage: avatarId })).statusCode === 200,
    'the owner can use their picture',
  );
  check(
    (await call(app, alice, 'PATCH', '/api/me', { nameFx: '<script>' })).statusCode === 400,
    'an animation of the name that is not in the list is refused',
  );
  const animated = await call(app, alice, 'PATCH', '/api/me', { nameFx: 'glow' });
  check(
    animated.statusCode === 200 && animated.json().user.nameFx === 'glow',
    'the animation of the name is saved and comes back with the profile',
  );
  app.ctx.db
    .prepare(
      "INSERT INTO images (id, owner_id, kind, mime, size, created_at, encrypted) VALUES ('old-plain', ?, 'avatar', 'image/png', 3, ?, 0)",
    )
    .run(bob.id, Date.now());
  app.ctx.db.prepare("UPDATE users SET avatar_image = 'old-plain' WHERE id = ?").run(bob.id);
  check(
    runMaintenance(app.ctx).plainPictures === 1,
    'a picture stored before the encryption is erased',
  );
  check(
    !app.ctx.db.prepare("SELECT 1 FROM images WHERE id = 'old-plain'").get() &&
      (
        app.ctx.db.prepare('SELECT avatar_image AS a FROM users WHERE id = ?').get(bob.id) as {
          a: string | null;
        }
      ).a === null,
    'and its owner is left without it, to upload it again',
  );

  step('rate limits: a route with a limit of its own has its own counter');
  const limited = await makeApp();
  const heavy = await signUp(limited, 'heavy');
  for (let i = 0; i < 30; i++) await call(limited, heavy, 'GET', '/api/friends');
  const uploaded = await limited.inject({
    method: 'POST',
    url: '/api/images?kind=group',
    headers: { ...bearer(heavy), 'content-type': 'application/octet-stream' },
    payload: pngWithMetadata(),
  });
  check(
    uploaded.statusCode === 201,
    'an upload is not refused because the same address made 30 other requests in the minute',
  );
  await limited.close();

  step('settings of the account: sealed, versioned, private');
  const sealedSettings = {
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
  };
  check(
    (await call(app, null, 'PUT', '/api/me/settings', { ...sealedSettings, base: 0 }))
      .statusCode === 401,
    'saving settings needs a session',
  );
  check(
    (await call(app, alice, 'GET', '/api/me/settings')).json().empty === true,
    'a person with none saved gets an empty answer',
  );
  const first = await call(app, alice, 'PUT', '/api/me/settings', { ...sealedSettings, base: 0 });
  check(first.statusCode === 200 && first.json().updatedAt > 0, 'the first save works');
  check(
    (await call(app, alice, 'GET', '/api/me/settings')).json().ciphertext ===
      sealedSettings.ciphertext,
    'and comes back as it was sealed (the server keeps no plain text)',
  );
  check(
    (await call(app, alice, 'PUT', '/api/me/settings', { ...sealedSettings, base: 0 }))
      .statusCode === 409,
    'a save made on an old version is refused (409), so nothing is lost silently',
  );
  const second = await call(app, alice, 'PUT', '/api/me/settings', {
    ...sealedSettings,
    base: first.json().updatedAt,
  });
  check(
    second.statusCode === 200 && second.json().updatedAt > first.json().updatedAt,
    'a save made on the last version works',
  );
  check(
    (
      await call(app, alice, 'PUT', '/api/me/settings', {
        iv: '<b>',
        ciphertext: 'x',
        base: second.json().updatedAt,
      })
    ).statusCode === 400,
    'something that is not sealed base64 is refused',
  );
  check(
    (await call(app, bob, 'GET', '/api/me/settings')).json().empty === true,
    'nobody sees the settings of another person',
  );

  step('maintenance: abandoned uploads and dead sessions');
  const addPicture = function (age: number): string {
    const id = randomUUID();
    fs.writeFileSync(path.join(app.ctx.config.uploadDir, 'images', id), randomBytes(64));
    app.ctx.db
      .prepare(
        "INSERT INTO images (id, owner_id, kind, mime, size, created_at, encrypted) VALUES (?, ?, 'banner', 'application/octet-stream', 64, ?, 1)",
      )
      .run(id, alice.id, Date.now() - age);
    return id;
  };
  const abandoned = addPicture(IMAGE_GRACE_MS + 1000);
  const recent = addPicture(0);
  const report = runMaintenance(app.ctx);
  check(report.images === 1, 'an old picture that nothing uses is removed ');
  check(!fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', abandoned)), 'with its file');
  check(
    fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', recent)) &&
      fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', avatarId)),
    'a new upload and a picture in use stay',
  );
  app.ctx.db.prepare('UPDATE sessions SET expires_at = 1 WHERE user_id = ?').run(bob.id);
  check(runMaintenance(app.ctx).sessions >= 1, 'expired sessions are removed');
  await app.close();
}

/** The link preview must not be usable to reach the network of the server. */
async function checkPreview(): Promise<void> {
  step('link preview: the server never connects to its own network');
  const blocked = [
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
    '198.18.0.1',
    '::1',
    '::',
    '[::1]',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    'fd00::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1',
    'not-an-address',
  ];
  for (const ip of blocked) check(isPrivateAddress(ip), `${ip} is refused`);
  for (const ip of [
    '8.8.8.8',
    '93.184.216.34',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '[2606:4700:4700::1111]',
  ]) {
    check(!isPrivateAddress(ip), `${ip} is allowed`);
  }
  const refusedUrls = [
    'http://example.com/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[fd00::1]/',
    'https://2130706433/',
    'https://0x7f.1/',
    'https://169.254.169.254/latest/meta-data/',
    'https://example.com:8443/',
    'https://example.com:22/',
    'https://user:pass@example.com/',
    'ftp://example.com/',
  ];
  for (const text of refusedUrls) {
    let refused = false;
    try {
      assertFetchable(new URL(text));
    } catch {
      refused = true;
    }
    check(refused, `${text} is refused before any connection`);
  }
  assertFetchable(new URL('https://example.com/page?x=1'));
  check(true, 'an ordinary https address passes the check');

  const app = await makeApp();
  const alice = await signUp(app, 'alice');
  for (const target of [
    'https://[::1]/',
    'https://[::ffff:7f00:1]/',
    'https://127.0.0.1/',
    'https://localhost/',
  ]) {
    const res = await call(app, alice, 'GET', '/api/preview?url=' + encodeURIComponent(target));
    check(
      res.statusCode === 502 || res.statusCode === 422,
      `the preview of ${target} fails without a connection`,
    );
  }
  check(
    (await call(app, alice, 'GET', '/api/preview?url=' + encodeURIComponent('http://example.com')))
      .statusCode === 400,
    'http is refused',
  );
  check(
    (await call(app, null, 'GET', '/api/preview?url=https://example.com')).statusCode === 401,
    'the preview needs a session',
  );
  await app.close();

  step('link preview: hostile pages cannot stall the server');
  const hostile = '<meta '.repeat(66_000);
  let started = Date.now();
  metaTags(hostile);
  check(Date.now() - started < 1500, 'a page of 66000 unclosed <meta> is read in linear time');
  started = Date.now();
  metaTags('<meta name="a" content="' + 'x'.repeat(390_000));
  check(Date.now() - started < 1500, 'a page with one huge unfinished tag is read in linear time');
  const tags = metaTags(
    '<meta property="og:title" content="Hi &amp; bye"><meta name="description" content="d">',
  );
  check(
    tags.get('og:title') === 'Hi & bye' && tags.get('description') === 'd',
    'the tags of a normal page are still read',
  );
}

/** Deleting an account removes the person and keeps what belongs to other people. */
async function checkDeletion(): Promise<void> {
  step('account deletion: groups of other people survive');
  const app = await makeApp();
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const carol = await signUp(app, 'carol');
  const dm = await befriend(app, alice, bob);
  await befriend(app, alice, carol);

  const club = await makeGuild(app, alice);
  await call(app, alice, 'POST', `/api/guilds/${club.id}/members`, {
    userId: bob.id,
    envelope: envelope(),
  });
  app.ctx.db
    .prepare('UPDATE guild_members SET joined_at = 1000 WHERE guild_id = ? AND user_id = ?')
    .run(club.id, alice.id);
  app.ctx.db
    .prepare('UPDATE guild_members SET joined_at = 2000 WHERE guild_id = ? AND user_id = ?')
    .run(club.id, bob.id);
  await call(app, alice, 'POST', `/api/guilds/${club.id}/members`, {
    userId: carol.id,
    envelope: envelope(),
  });
  app.ctx.db
    .prepare('UPDATE guild_members SET joined_at = 3000 WHERE guild_id = ? AND user_id = ?')
    .run(club.id, carol.id);
  const alone = await makeGuild(app, alice);
  const icon = await app.inject({
    method: 'POST',
    url: '/api/images?kind=group',
    headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
    payload: pngWithMetadata(),
  });
  const iconId = icon.json().id;
  await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, {
    iconImage: iconId,
  });
  const avatar = (
    await app.inject({
      method: 'POST',
      url: '/api/images?kind=avatar',
      headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
      payload: pngWithMetadata(),
    })
  ).json().id;
  await call(app, alice, 'PATCH', '/api/me', { avatarImage: avatar });
  await call(app, alice, 'POST', `/api/channels/${club.text}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });
  await call(app, bob, 'POST', `/api/channels/${club.text}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });
  const aliceFile = (
    await app.inject({
      method: 'POST',
      url: `/api/channels/${club.text}/files`,
      headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
      payload: randomBytes(64),
    })
  ).json().fileId;
  await call(app, alice, 'POST', `/api/channels/${dm}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });

  step('account deletion: a failed deletion changes nothing');
  app.ctx.db.exec(
    "CREATE TRIGGER block_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'blocked'); END",
  );
  const failed = await call(app, alice, 'POST', '/api/me/delete', {
    authSecret: alice.authSecret,
  });
  check(
    failed.statusCode === 500,
    'when the database refuses, the request fails (and shows no internals)',
  );
  check(
    failed.json().error === 'internal_error' && !failed.body.includes('blocked'),
    'the error says nothing about the cause',
  );
  const db = app.ctx.db;
  check(
    (
      db.prepare('SELECT owner_id FROM guilds WHERE id = ?').get(club.id) as {
        owner_id: string;
      }
    ).owner_id === alice.id,
    'the group still belongs to its owner after the failure',
  );
  check(
    (
      db.prepare('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ?').get(club.text) as {
        n: number;
      }
    ).n === 2,
    'no message was lost',
  );
  check(
    Boolean(db.prepare('SELECT 1 FROM files WHERE id = ?').get(aliceFile)),
    'no file row was lost',
  );
  check(
    Boolean(db.prepare('SELECT 1 FROM sessions WHERE user_id = ?').get(alice.id)),
    'the session survived the failure',
  );
  db.exec('DROP TRIGGER block_user_delete');

  step('account deletion: the wrong password, then the right one');
  const wrong = await call(app, alice, 'POST', '/api/me/delete', {
    authSecret: randomBytes(32).toString('base64'),
  });
  check(wrong.statusCode === 401, 'a wrong proof of the password does not delete anything');
  check(
    (await call(app, alice, 'GET', '/api/me')).statusCode === 200,
    'the account is still there',
  );
  const gone = await call(app, alice, 'POST', '/api/me/delete', {
    authSecret: alice.authSecret,
  });
  check(gone.statusCode === 204, 'the right proof deletes the account');
  check(
    (await call(app, alice, 'GET', '/api/me')).statusCode === 401,
    'the old access token is dead',
  );
  check(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: alice.refresh },
      })
    ).statusCode === 401,
    'the old refresh token is dead',
  );
  check(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: alice.username, authSecret: alice.authSecret },
      })
    ).statusCode === 401,
    'the name cannot sign in',
  );
  check(!db.prepare('SELECT 1 FROM users WHERE id = ?').get(alice.id), 'the account row is gone');
  for (const table of [
    'sessions',
    'spent_tokens',
    'friendships',
    'guild_members',
    'guild_keys',
    'dm_members',
    'messages',
    'reactions',
    'files',
    'images',
    'channel_receipts',
    'guild_member_tags',
  ]) {
    const column =
      table === 'friendships'
        ? 'user_a = ? OR user_b = ?'
        : table === 'messages'
          ? 'sender_id = ?'
          : table === 'files'
            ? 'uploader_id = ?'
            : table === 'images'
              ? 'owner_id = ?'
              : 'user_id = ?';
    const args = table === 'friendships' ? [alice.id, alice.id] : [alice.id];
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}`).get(...args) as {
      n: number;
    };
    check(row.n === 0, `nothing of the account stays in ${table}`);
  }
  check(
    !db.prepare('SELECT 1 FROM channels WHERE id = ?').get(dm),
    'the direct conversation is erased',
  );
  check(
    !fs.existsSync(path.join(app.ctx.config.uploadDir, aliceFile)),
    'the files of the person are erased from the disk',
  );
  check(
    !fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', avatar)),
    'their profile picture is erased from the disk',
  );

  step('account deletion: what belongs to other people stays usable');
  const guild = db
    .prepare('SELECT owner_id, needs_rotation, icon_image FROM guilds WHERE id = ?')
    .get(club.id) as
    | { owner_id: string; needs_rotation: number; icon_image: string | null }
    | undefined;
  check(guild !== undefined, 'a group with other members is NOT destroyed when its owner leaves');
  check(guild?.owner_id === bob.id, 'it passes to the member who has been in it the longest');
  check(
    guild?.needs_rotation === 1,
    'and its key is marked for renewal, because the old owner held it',
  );
  check(
    (
      db
        .prepare('SELECT role FROM guild_members WHERE guild_id = ? AND user_id = ?')
        .get(club.id, bob.id) as { role: string }
    ).role === 'owner',
    'the new owner has the owner role',
  );
  check(
    (
      db.prepare('SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?').get(club.id) as {
        n: number;
      }
    ).n === 2,
    'the group has no ghost member',
  );
  check(
    guild?.icon_image === iconId &&
      fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', iconId)),
    'the icon of the group stays',
  );
  check(
    (
      db.prepare('SELECT owner_id FROM images WHERE id = ?').get(iconId) as {
        owner_id: string;
      }
    ).owner_id === bob.id,
    'and now belongs to the new owner',
  );
  const bobView = (await call(app, bob, 'GET', '/api/guilds')).json();
  const mine = bobView.guilds.find(function isClub(g: { id: string }) {
    return g.id === club.id;
  });
  check(
    Boolean(mine) && mine.ownerId === bob.id && mine.keys.length >= 1,
    'the new owner still has the key envelopes of the group',
  );
  check(
    mine.keys.every(function wrapped(k: { wrapperId: string; wrapperPub: string | null }) {
      return k.wrapperId !== alice.id || Boolean(k.wrapperPub);
    }),
    'envelopes wrapped by the erased person carry their public key, so they can still be opened',
  );
  check(
    (await call(app, carol, 'GET', `/api/channels/${club.text}/messages`)).statusCode === 200,
    'other members still read the group',
  );
  const remaining = (await call(app, carol, 'GET', `/api/channels/${club.text}/messages`)).json()
    .messages;
  check(
    remaining.length === 1 && remaining[0].senderId === bob.id,
    "only the erased person's messages disappeared",
  );
  check(
    (
      await call(app, bob, 'POST', `/api/channels/${club.text}/messages`, {
        ...sealed(),
        keyVersion: 1,
      })
    ).statusCode === 201,
    'the group can still be used',
  );
  check(
    !db.prepare('SELECT 1 FROM guilds WHERE id = ?').get(alone.id),
    'a group with nobody else in it is erased',
  );
  check(
    (
      await call(app, bob, 'POST', `/api/guilds/${club.id}/rotate`, {
        keyVersion: 2,
        envelopes: [
          { userId: bob.id, ...envelope() },
          { userId: carol.id, ...envelope() },
        ],
      })
    ).statusCode === 200,
    'the new owner can renew the key and clear the warning',
  );
  check(
    (
      db.prepare('SELECT needs_rotation FROM guilds WHERE id = ?').get(club.id) as {
        needs_rotation: number;
      }
    ).needs_rotation === 0,
    'the renewal is recorded',
  );
  await app.close();
}

/** An older database is migrated safely and repeatably; a newer one is not touched. */
async function checkDatabase(): Promise<void> {
  step('database: migrations');
  const file = path.join(TMP, 'legacy.db');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
      auth_hash TEXT NOT NULL, kdf_salt TEXT NOT NULL, kdf_iterations INTEGER NOT NULL, pub_ecdh TEXT NOT NULL,
      pub_ecdsa TEXT NOT NULL, wrapped_ecdh TEXT NOT NULL, wrapped_ecdsa TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '', status_text TEXT NOT NULL DEFAULT '', accent TEXT NOT NULL DEFAULT 'mint',
      aura TEXT NOT NULL DEFAULT 'prism', avatar_emoji TEXT NOT NULL DEFAULT '', avatar_color TEXT NOT NULL DEFAULT '#2ef2b0',
      created_at INTEGER NOT NULL);
    CREATE TABLE guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key_version INTEGER NOT NULL DEFAULT 1,
      needs_rotation INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE guild_keys (guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key_version INTEGER NOT NULL,
      wrapper_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, iv TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id, key_version));
    INSERT INTO users (id, username, display_name, auth_hash, kdf_salt, kdf_iterations, pub_ecdh, pub_ecdsa, wrapped_ecdh, wrapped_ecdsa, created_at)
      VALUES ('u1','old_user','Old','h','s',1,'e','d','w','w',1);
    INSERT INTO guilds (id, name, owner_id, created_at) VALUES ('g1','Old group','u1',1);
    INSERT INTO guild_keys VALUES ('g1','u1',1,'u1','iv','data');
  `);
  old.close();
  const db = openDatabase(file);
  const columns = db.prepare('PRAGMA table_info(users)').all() as {
    name: string;
  }[];
  check(
    ['pronouns', 'avatar_image', 'deleted_at'].every(function present(name) {
      return columns.some(function has(c) {
        return c.name === name;
      });
    }),
    'columns added after the first version appear',
  );
  check(
    (db.prepare('SELECT username FROM users').get() as { username: string }).username ===
      'old_user',
    'the old rows are kept',
  );
  const ties = db.prepare('PRAGMA foreign_key_list(guild_keys)').all() as {
    from: string;
  }[];
  check(
    !ties.some(function onWrapper(tie) {
      return tie.from === 'wrapper_id';
    }),
    'key envelopes no longer die with the person who wrapped them',
  );
  check(
    (db.prepare('SELECT COUNT(*) AS n FROM guild_keys').get() as { n: number }).n === 1,
    'and none was lost in the rebuild',
  );
  check(
    db.pragma('user_version', { simple: true }) === SCHEMA_VERSION,
    'the schema version is recorded',
  );
  check(
    db.pragma('secure_delete', { simple: true }) === 1,
    'deleted content is overwritten (secure_delete)',
  );
  check(db.pragma('foreign_keys', { simple: true }) === 1, 'foreign keys are enforced');
  db.close();
  const again = openDatabase(file);
  check(
    (again.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 1,
    'opening it again is harmless',
  );
  again.close();
  const future = new Database(path.join(TMP, 'future.db'));
  future.pragma('user_version = 99');
  future.close();
  let refused = false;
  try {
    openDatabase(path.join(TMP, 'future.db'));
  } catch {
    refused = true;
  }
  check(refused, 'a database from a newer version is refused, not changed');
}

/** WebSocket abuse: origins, frames, rooms and relayed signals. */
async function checkSockets(): Promise<void> {
  step('realtime: authentication, origins and signaling');
  const app = await makeApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const mallory = await signUp(app, 'mallory');
  const dm = await befriend(app, alice, bob);

  const evil = await openSocket(port, alice.access, {
    origin: 'http://evil.test',
  });
  check((await evil.closed) === 1008, 'a page of another site cannot open the socket');
  const silent = await openSocket(port, null);
  await silent.open;
  silent.send({ t: 'ping' });
  check((await silent.closed) === 4401, 'a first frame that is not the login closes the socket');
  const bad = await openSocket(port, 'not-a-token');
  check((await bad.closed) === 4401, 'an invalid token closes the socket');
  const junk = await openSocket(port, alice.access);
  await junk.ready;
  junk.raw('this is not json');
  check((await junk.closed) === 1003, 'a frame that is not JSON closes the socket');
  const huge = await openSocket(port, alice.access);
  await huge.ready;
  huge.raw(JSON.stringify({ t: 'typing', filler: 'x'.repeat(70_000) }));
  const hugeCode = await huge.closed;
  check(
    hugeCode === 1009 || hugeCode === 1006,
    `a frame over 64 KB closes the socket (code ${hugeCode})`,
  );

  const a = await openSocket(port, alice.access);
  const b = await openSocket(port, bob.access);
  const m = await openSocket(port, mallory.access);
  await Promise.all([a.ready, b.ready, m.ready]);
  m.send({ t: 'call.join', roomId: dm });
  check(
    await until(function refused() {
      return m.frames.some(function isError(f) {
        return f['t'] === 'error' && f['code'] === 'room_not_found';
      });
    }),
    'an unrelated account cannot join the call of a direct chat',
  );
  m.send({ t: 'typing', channelId: dm });
  a.send({ t: 'call.join', roomId: dm });
  check(
    await until(function ringing() {
      return b.frames.some(function isIncoming(f) {
        return f['t'] === 'call.incoming';
      });
    }),
    'the friend is told about the call',
  );
  check(
    !b.frames.some(function isTyping(f) {
      return f['t'] === 'typing' && f['userId'] === mallory.id;
    }),
    'typing in a channel that is not yours reaches nobody',
  );
  m.send({ t: 'rtc.signal', roomId: dm, to: bob.id, payload: { sdp: 'evil' } });
  b.send({ t: 'call.join', roomId: dm });
  await until(function bothIn() {
    return a.frames.some(function isState(f) {
      return f['t'] === 'call.state' && (f['participants'] as unknown[]).length === 2;
    });
  });
  await sleep(150);
  check(
    !b.frames.some(function isSignal(f) {
      return f['t'] === 'rtc.signal' && f['from'] === mallory.id;
    }),
    'a signal from somebody who is not in the room is not relayed',
  );
  a.send({ t: 'rtc.signal', roomId: dm, to: bob.id, payload: { sdp: 'ok' } });
  check(
    await until(function relayed() {
      return b.frames.some(function isSignal(f) {
        return f['t'] === 'rtc.signal' && f['from'] === alice.id;
      });
    }),
    'a signal between two people of the room is relayed, and carries the real sender',
  );
  const signals = function (): number {
    return b.frames.filter(function isSignal(f) {
      return f['t'] === 'rtc.signal';
    }).length;
  };
  const before = signals();
  a.send({
    t: 'rtc.signal',
    roomId: dm,
    to: bob.id,
    payload: { blob: 'x'.repeat(50_000) },
  });
  a.send({
    t: 'rtc.signal',
    roomId: dm,
    to: mallory.id,
    payload: { sdp: 'leak' },
  });
  a.send({ t: 'rtc.signal', roomId: dm, to: bob.id, payload: 'not an object' });
  await sleep(200);
  check(signals() === before, 'oversized, misdirected and malformed signals are dropped');
  check(
    !m.frames.some(function isSignal(f) {
      return f['t'] === 'rtc.signal';
    }),
    'a signal addressed to somebody outside the room is not delivered to them',
  );
  await app.close();
}

/** Static server: bad addresses must not crash it or leave the folder. */
async function checkStaticServer(): Promise<void> {
  step('web server: malformed addresses and paths');
  const dir = fs.mkdtempSync(path.join(TMP, 'dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>app</html>');
  fs.writeFileSync(path.join(dir, 'main-ABCDEFGH.js'), 'console.log(1)');
  fs.writeFileSync(path.join(TMP, 'outside.txt'), 'private');
  check(
    resolveFile(dir, '/%E0%A4%A') === null,
    'an invalid escape is a bad request, not an exception',
  );
  check(resolveFile(dir, '/a%00b') === null, 'a NUL byte is a bad request');
  check(
    resolveFile(dir, '/direct/abd26c23-be5f-437c-9e2d-177d591f7092') ===
      path.join(dir, 'index.html'),
    'an app route gets index.html',
  );
  check(
    resolveFile(dir, '/main-ABCDEFGH.js') === path.join(dir, 'main-ABCDEFGH.js'),
    'a real file is served',
  );
  for (const attempt of [
    '/../outside.txt',
    '/..%2foutside.txt',
    '/%2e%2e/outside.txt',
    '/..\\outside.txt',
  ]) {
    const found = resolveFile(dir, attempt);
    check(
      found === null || found === path.join(dir, 'index.html'),
      `${attempt} never reaches a file outside the folder`,
    );
  }
  const sibling = dir + '-evil';
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'private');
  const siblingName = path.basename(sibling);
  const viaSibling = resolveFile(dir, '/..%2f' + siblingName + '%2fsecret.txt');
  check(
    viaSibling === null || viaSibling === path.join(dir, 'index.html'),
    'a sibling folder with the same prefix is not served',
  );

  const handler = createStaticHandler(dir);
  /** Runs the handler with a fake request and returns what it answered. */
  const answer = function (
    method: string,
    url: string,
  ): { status: number; headers: Record<string, unknown>; body: string } {
    const result = {
      status: 0,
      headers: {} as Record<string, unknown>,
      body: '',
    };
    handler(
      { method, url, headers: {} } as never,
      {
        writeHead: function writeHead(status: number, headers: Record<string, unknown>) {
          result.status = status;
          result.headers = headers;
        },
        end: function end(body?: Buffer | string) {
          result.body = body ? String(body) : '';
        },
      } as never,
    );
    return result;
  };
  check(
    answer('GET', '/%E0%A4%A').status === 400,
    'the handler answers 400 to a malformed address',
  );
  check(answer('POST', '/').status === 405, 'the handler refuses other methods');
  check(
    answer('GET', '/missing.json').status === 404,
    'a file that does not exist is a 404, not the page of the app',
  );
  check(
    answer('GET', '/.well-known/ai-catalog.json').status === 404,
    'nothing under /.well-known/ is answered with the app page',
  );
  check(
    answer('GET', '/').status === 200 && answer('GET', '/direct/abc').status === 200,
    'the routes of the app still get the page',
  );
  const page = answer('GET', '/direct/x');
  check(page.status === 200 && page.body.includes('app'), 'an app route gets the page');
  check(
    page.headers['x-content-type-options'] === 'nosniff' &&
      page.headers['x-frame-options'] === 'DENY',
    'with the security headers',
  );
  check(
    String(answer('GET', '/main-ABCDEFGH.js').headers['cache-control']).includes('immutable'),
    'hashed files are cached for good',
  );
  check(answer('HEAD', '/').body === '', 'HEAD sends no body');
}

/** The frame cipher of the calls. */
async function checkMediaCipher(): Promise<void> {
  step('calls: end-to-end frame encryption');
  const shared = randomBytes(32);
  const alice = await deriveLinkSecrets(
    shared.buffer.slice(shared.byteOffset, shared.byteOffset + 32),
    'alice',
    'bob',
  );
  const bob = await deriveLinkSecrets(
    shared.buffer.slice(shared.byteOffset, shared.byteOffset + 32),
    'bob',
    'alice',
  );
  check(
    Buffer.from(alice.send).equals(Buffer.from(bob.recv)),
    'each side derives the key the other one sends with',
  );
  check(
    Buffer.from(alice.send).equals(Buffer.from(alice.recv)) === false,
    'the two directions use different keys',
  );

  const frame = function (size = 120): ArrayBuffer {
    const bytes = randomBytes(size);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + size);
  };
  const copy = function (secret: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    return new Uint8Array(secret);
  };
  const sender = await MediaKeyChain.create(copy(alice.send));
  const receiver = await MediaKeyChain.create(copy(bob.recv));
  const plain = frame();
  const sealedFrame = await sender.encrypt(plain, 1);
  check(
    sealedFrame.byteLength === plain.byteLength + TAG_BYTES + TRAILER_BYTES,
    'a frame grows by the tag and the trailer only',
  );
  check(
    Buffer.from(sealedFrame).subarray(0, 1).equals(Buffer.from(plain).subarray(0, 1)),
    'the codec header stays readable',
  );
  check(
    !Buffer.from(sealedFrame).subarray(1, 100).equals(Buffer.from(plain).subarray(1, 100)),
    'the payload is not readable',
  );
  const opened = await receiver.decrypt(sealedFrame, 1);
  check(Buffer.from(opened).equals(Buffer.from(plain)), 'the other side recovers the exact frame');

  /** True when decrypting the frame fails. */
  const fails = async function (
    chain: MediaKeyChain,
    data: ArrayBuffer,
    header = 1,
  ): Promise<boolean> {
    try {
      await chain.decrypt(data, header);
      return false;
    } catch {
      return true;
    }
  };
  const fresh = async function (): Promise<MediaKeyChain> {
    return MediaKeyChain.create(copy(bob.recv));
  };
  const flip = function (data: ArrayBuffer, index: number): ArrayBuffer {
    const bytes = new Uint8Array(data.slice(0));
    bytes[index] = bytes[index]! ^ 0x01;
    return bytes.buffer;
  };
  const next = await sender.encrypt(frame(), 1);
  check(await fails(await fresh(), flip(next, 40)), 'a changed byte of the payload is detected');
  check(
    await fails(await fresh(), flip(next, 0)),
    'a changed header byte is detected (it is authenticated)',
  );
  check(
    await fails(await fresh(), flip(next, next.byteLength - 3)),
    'a changed counter is detected',
  );
  check(
    await fails(await fresh(), flip(next, next.byteLength - 1)),
    'a changed key id is detected',
  );
  check(await fails(await fresh(), next.slice(0, next.byteLength - 5)), 'a cut frame is detected');
  check(
    await fails(await fresh(), new ArrayBuffer(10)),
    'a frame shorter than the tag is detected',
  );
  check(
    await fails(await MediaKeyChain.create(copy(alice.recv)), next),
    'a frame reflected back to its sender is refused (the two directions use different keys)',
  );
  const stranger = await MediaKeyChain.create(new Uint8Array(randomBytes(32)));
  check(await fails(stranger, next), 'a frame cannot be opened with an unrelated key');

  const once = await sender.encrypt(frame(), 1);
  await receiver.decrypt(once, 1);
  check(await fails(receiver, once), 'a frame played again is refused (replay)');
  const batch = [
    await sender.encrypt(frame(), 1),
    await sender.encrypt(frame(), 1),
    await sender.encrypt(frame(), 1),
  ];
  let reordered = true;
  for (const index of [2, 0, 1]) {
    try {
      await receiver.decrypt(batch[index]!, 1);
    } catch {
      reordered = false;
    }
  }
  check(reordered, 'frames that arrive out of order are still accepted once');

  const counters = new Set<number>();
  const ivs = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const out = new Uint8Array(await sender.encrypt(frame(30), 1));
    const trailer = out.subarray(out.length - TRAILER_BYTES);
    const view = new DataView(trailer.buffer, trailer.byteOffset, TRAILER_BYTES);
    counters.add(view.getUint32(0) * 2 ** 32 + view.getUint32(4));
    ivs.add(Buffer.from(trailer.subarray(0, 8)).toString('hex') + trailer[8]);
  }
  check(counters.size === 200 && ivs.size === 200, 'the nonce of a key is never repeated');

  const rotating = await MediaKeyChain.create(copy(alice.send));
  const peer = await MediaKeyChain.create(copy(bob.recv));
  const early = await rotating.encrypt(frame(), 1);
  await rotating.maybeRatchet(Date.now() + RATCHET_MS + 1);
  check(rotating.keyId === 1, 'the sender moves to a new key after the interval');
  const late = await rotating.encrypt(frame(), 1);
  check(!(await fails(peer, late)), 'the receiver follows the key change');
  check(
    !(await fails(peer, early)),
    'a frame of the previous key still opens right after the change',
  );
  const forged = new Uint8Array(await rotating.encrypt(frame(), 1));
  forged[forged.length - 1] = (forged[forged.length - 1]! + 3) & 0xff;
  check(await fails(peer, forged.buffer), 'a frame with a made-up key id is refused');
  check(
    !(await fails(peer, await rotating.encrypt(frame(), 1))),
    'and the receiver keeps working afterwards (a forgery cannot desynchronise it)',
  );
  const far = await MediaKeyChain.create(copy(alice.send));
  for (let i = 0; i < 40; i++) await far.maybeRatchet(Date.now() + RATCHET_MS + 1);
  check(
    await fails(await fresh(), await far.encrypt(frame(), 1)),
    'a key far in the future is refused',
  );

  const left = (await securityCode('AAA=', 'BBB=')).replace(' ', '');
  check(/^\d{8}$/.test(left), 'the security code has eight digits');
  check(
    (await securityCode('AAA=', 'BBB=')) === (await securityCode('BBB=', 'AAA=')),
    'both people compute the same code',
  );
  check(
    (await securityCode('AAA=', 'BBB=')) !== (await securityCode('AAA=', 'CCC=')),
    'a different key exchange gives a different code',
  );
}

/** The relay-only policy of the browser side. */
async function checkRelayPolicy(): Promise<void> {
  step('calls: relay-only policy in the browser (fail closed)');
  const now = Date.now();
  const future = Math.floor(now / 1000) + 3600;
  const turnServer = function (expiry = future): RTCIceServer {
    return {
      urls: [
        'turn:relay.test:3478?transport=udp',
        'turn:relay.test:3478?transport=tcp',
        'stun:relay.test:3478',
      ],
      username: `${expiry}:user`,
      credential: 'cred',
    };
  };
  const stunServer: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };
  /** True when building the configuration throws the relay error. */
  const refuses = function (response: never, at = now): boolean {
    try {
      buildPeerConfiguration(response, at);
      return false;
    } catch (error) {
      return error instanceof RelayUnavailableError;
    }
  };

  const strict = buildPeerConfiguration(
    { iceServers: [stunServer, turnServer()], relayOnly: true },
    now,
  );
  check(
    strict.configuration.iceTransportPolicy === 'relay' && strict.relayRequired,
    'relay-only gives iceTransportPolicy "relay"',
  );
  check(strict.configuration.iceServers!.length === 1, 'only the relay server is kept (no STUN)');
  check(
    (strict.configuration.iceServers![0]!.urls as string[]).every(function isTurn(url) {
      return url.startsWith('turn:');
    }),
    'and only its TURN addresses',
  );
  check(
    buildPeerConfiguration({ iceServers: [stunServer], relayOnly: false }, now).configuration
      .iceTransportPolicy === 'all',
    'without a requirement, the normal policy is used',
  );
  check(
    refuses({ iceServers: [], relayOnly: true } as never),
    'relay-only with no ICE server at all does not start the call',
  );
  check(
    refuses({ iceServers: [stunServer], relayOnly: true } as never),
    'relay-only with only STUN does not start the call (no direct fallback)',
  );
  check(
    refuses({
      iceServers: [{ urls: ['turn:relay.test:3478'] }],
      relayOnly: true,
    } as never),
    'a relay without credentials is not usable',
  );
  check(
    refuses({
      iceServers: [{ urls: 'turn:relay.test:3478', username: 'u', credential: '' }],
      relayOnly: true,
    } as never),
    'a relay with an empty credential is not usable',
  );
  check(
    refuses({
      iceServers: [turnServer(Math.floor(now / 1000) - 10)],
      relayOnly: true,
    } as never),
    'expired relay credentials do not start the call',
  );
  check(
    refuses({
      iceServers: [turnServer(Math.floor(now / 1000) + 5)],
      relayOnly: true,
    } as never),
    'credentials about to expire do not start the call',
  );
  check(refuses(undefined as never), 'a missing answer does not start the call');
  check(refuses({ relayOnly: true } as never), 'an answer without servers does not start the call');
  check(
    refuses({ iceServers: 'turn:x', relayOnly: true } as never),
    'a malformed answer does not start the call',
  );

  check(
    credentialExpiry(turnServer(future)) === future * 1000,
    'the expiry of a credential is read from its username',
  );
  check(
    credentialExpiry({ urls: 'turn:x', username: 'plain', credential: 'c' }) === null,
    'a username without expiry has none',
  );
  check(
    earliestExpiry([turnServer(future), turnServer(future + 100), stunServer]) === future * 1000,
    'the earliest expiry is used for the renewal',
  );
  check(earliestExpiry([stunServer]) === null, 'no relay means nothing to renew');
  check(
    needsIceRefresh(now + 5 * 60_000, now) &&
      !needsIceRefresh(now + 30 * 60_000, now) &&
      !needsIceRefresh(null, now),
    'credentials are renewed ten minutes before they expire',
  );

  check(
    isRelayCandidate(
      'candidate:1 1 udp 41885439 203.0.113.5 50000 typ relay raddr 0.0.0.0 rport 0',
    ),
    'a relay candidate is recognised',
  );
  check(
    !isRelayCandidate('candidate:2 1 udp 2113937151 192.168.1.5 50000 typ host'),
    'a host candidate is not relayed',
  );
  check(
    !isRelayCandidate(
      'candidate:3 1 udp 1677729535 198.51.100.7 50000 typ srflx raddr 192.168.1.5 rport 50000',
    ),
    'a server reflexive candidate is not relayed',
  );
  check(
    !isRelayCandidate('candidate:4 1 tcp 1 192.0.2.1 9 typ host tcptype active'),
    'a TCP host candidate is not relayed',
  );

  /** A statistics report like the ones of the browsers. */
  const report = function (entries: Record<string, unknown>[]) {
    return {
      forEach: function each(callback: (entry: never) => void) {
        for (const entry of entries) callback(entry as never);
      },
    };
  };
  check(
    selectedPathKind(
      report([
        { type: 'transport', id: 'T', selectedCandidatePairId: 'P' },
        { type: 'candidate-pair', id: 'P', localCandidateId: 'L' },
        { type: 'local-candidate', id: 'L', candidateType: 'relay' },
      ]),
    ) === 'relay',
    'a selected relay candidate is reported as relay (Chrome statistics)',
  );
  check(
    selectedPathKind(
      report([
        { type: 'transport', id: 'T', selectedCandidatePairId: 'P' },
        { type: 'candidate-pair', id: 'P', localCandidateId: 'L' },
        { type: 'local-candidate', id: 'L', candidateType: 'srflx' },
      ]),
    ) === 'direct',
    'a selected server-reflexive candidate is reported as direct',
  );
  check(
    selectedPathKind(
      report([
        {
          type: 'candidate-pair',
          id: 'P',
          selected: true,
          localCandidateId: 'L',
        },
        { type: 'local-candidate', id: 'L', candidateType: 'host' },
      ]),
    ) === 'direct',
    'a host candidate is reported as direct (Firefox statistics)',
  );
  check(
    selectedPathKind(report([])) === 'unknown',
    'before the connection is made nothing is claimed',
  );

  check(
    isFreshSignal(now, now) &&
      isFreshSignal(now - 4 * 60_000, now) &&
      isFreshSignal(now + 4 * 60_000, now),
    'a recent signal is accepted',
  );
  check(
    !isFreshSignal(now - 10 * 60_000, now) && !isFreshSignal(now + 10 * 60_000, now),
    'a recording of an old signal is refused',
  );
  check(
    !isFreshSignal(undefined, now) && !isFreshSignal('now', now) && !isFreshSignal(NaN, now),
    'a signal without a valid time is refused',
  );
}

/** Response headers of the API. */
async function checkHeaders(): Promise<void> {
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

/** The privacy choices are enforced by the server, not only hidden by the screen. */
async function checkPrivacy(): Promise<void> {
  step('privacy: online status, friend requests and search');
  const app = await makeApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const dave = await signUp(app, 'dave');
  await befriend(app, alice, bob);
  // Dave shares a group with Alice but is not her friend (he was, to be added, and then was removed from her friends).
  await befriend(app, alice, dave);
  const club = await makeGuild(app, alice);
  await call(app, alice, 'POST', `/api/guilds/${club.id}/members`, {
    userId: dave.id,
    envelope: envelope(),
  });
  await call(app, alice, 'DELETE', `/api/friends/${dave.id}`);

  const sockets = {
    alice: await openSocket(port, alice.access),
    bob: await openSocket(port, bob.access),
    dave: await openSocket(port, dave.access),
  };
  await Promise.all([sockets.alice.ready, sockets.bob.ready, sockets.dave.ready]);
  /** The last status of Alice that a socket was told (or null when it was not told anything). */
  const lastSeen = function (socket: TestSocket): string | null {
    let status: string | null = null;
    for (const frame of socket.frames) {
      if (frame['t'] === 'presence' && frame['userId'] === alice.id)
        status = String(frame['status']);
    }
    return status;
  };
  const snapshot = async function (who: Account): Promise<string[]> {
    const res = await call(app, who, 'GET', '/api/presence');
    return res.json().presence.map(function id(p: { userId: string }) {
      return p.userId;
    });
  };

  check((await snapshot(bob)).includes(alice.id), 'by default a friend sees the person online');
  check(
    (await snapshot(dave)).includes(alice.id),
    'by default somebody who shares a group sees them too',
  );
  const own = (await call(app, alice, 'GET', '/api/me')).json().user;
  check(
    own.privacy.presenceVisibility === 'everyone' &&
      own.privacy.friendRequests === 'everyone' &&
      own.privacy.searchable === true,
    'the defaults are open',
  );
  const others = (await call(app, bob, 'GET', `/api/users/${alice.id}`)).json().user;
  check(others.privacy === undefined, "other people never receive somebody's privacy choices");

  const set = async function (patch: Record<string, unknown>) {
    return call(app, alice, 'PATCH', '/api/me', patch);
  };
  check(
    (await set({ presenceVisibility: 'friends' })).statusCode === 200,
    'the person can choose to be seen online by friends only',
  );
  check(
    await until(function hidden() {
      return lastSeen(sockets.dave) === 'offline';
    }),
    'somebody who is not a friend is told at once that the person went offline',
  );
  check(lastSeen(sockets.bob) === 'online', 'a friend keeps seeing them online');
  check(
    !(await snapshot(dave)).includes(alice.id) && (await snapshot(bob)).includes(alice.id),
    'the list of who is online follows the same rule',
  );

  check(
    (await set({ presenceVisibility: 'nobody' })).statusCode === 200,
    'the person can choose to be seen by nobody',
  );
  check(
    await until(function hiddenFromFriends() {
      return lastSeen(sockets.bob) === 'offline';
    }),
    'then friends see them offline too',
  );
  check(!(await snapshot(bob)).includes(alice.id), 'and the list of who is online leaves them out');
  check(
    (await call(app, alice, 'GET', '/api/me')).json().user.privacy.presenceVisibility === 'nobody',
    'the person still sees their own choice',
  );
  await set({ presenceVisibility: 'everyone' });
  check(
    await until(function visibleAgain() {
      return lastSeen(sockets.dave) === 'online';
    }),
    'going back to everybody shows them again',
  );
  check(
    (await set({ presenceVisibility: 'strangers' })).statusCode === 400,
    'a value that does not exist is refused',
  );

  step('privacy: friend requests and search');
  const eve = await signUp(app, 'eve');
  check(
    (await set({ friendRequests: 'nobody' })).statusCode === 200,
    'the person closes their friend requests',
  );
  const refused = await call(app, eve, 'POST', '/api/friends/request', {
    username: alice.username,
  });
  check(
    refused.statusCode === 403 && refused.json().error === 'requests_closed',
    'a request to them is refused by the server',
  );
  check(
    (await call(app, bob, 'GET', '/api/friends')).json().friends.includes(alice.id),
    'friends they already have are not affected',
  );
  await set({ friendRequests: 'everyone' });
  check(
    (
      await call(app, eve, 'POST', '/api/friends/request', {
        username: alice.username,
      })
    ).statusCode === 201,
    'opening them again allows requests',
  );

  const found = async function (who: Account, text: string): Promise<boolean> {
    const res = await call(app, who, 'GET', '/api/users/search?q=' + text);
    return res.json().users.some(function isAlice(u: { id: string }) {
      return u.id === alice.id;
    });
  };
  const prefix = alice.username.slice(0, 5);
  check(await found(bob, prefix), 'by default they are found by a search');
  check((await set({ searchable: false })).statusCode === 200, 'the person can leave the search');
  check(!(await found(bob, prefix)), 'then a search does not list them');
  const frank = await signUp(app, 'frank');
  check(
    (
      await call(app, frank, 'POST', '/api/friends/request', {
        username: alice.username,
      })
    ).statusCode === 201,
    'but their exact username still works',
  );
  await app.close();
}

/** Runs every group. */
async function main(): Promise<void> {
  try {
    await checkRelayConfiguration();
    await checkSessions();
    await checkAuthorization();
    await checkImages();
    await checkPreview();
    await checkDeletion();
    await checkPrivacy();
    await checkDatabase();
    await checkSockets();
    await checkStaticServer();
    await checkMediaCipher();
    await checkRelayPolicy();
    await checkHeaders();
    console.log('\nSECURITY CHECKS CORRECT');
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

main().then(
  function done() {
    process.exit(0);
  },
  function failed(error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
