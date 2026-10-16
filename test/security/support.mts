/**
 * test/security/support.mts
 * What every security check uses: the temporary folder, the printing of a passed check, a server with an in-memory database,
 * accounts that sign up for real, and small builders of the encrypted fields the server only stores.
 * ! Everything is temporary and no real secret, user or file is read.
 */
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../../backend/src/app';
import { type AppConfig } from '../../backend/src/config';

const require = createRequire(import.meta.url);
export const WebSocket = require('../../backend/node_modules/ws');
export const Database = require('../../backend/node_modules/better-sqlite3');
export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chatterly-security-'));

/** Prints a passed check, or stops the whole run with the property that broke. */
export function check(condition: unknown, message: string): void {
  if (!condition) throw new Error('FAILED: ' + message);
  console.log('  ok  ' + message);
}

/** Prints the title of a group of checks. */
export function step(title: string): void {
  console.log('\n== ' + title);
}

/** Waits for a number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(function executor(resolve) {
    setTimeout(resolve, ms);
  });
}

/** Waits until a condition holds (true) or the time runs out (false). */
export async function until(condition: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (condition()) return true;
    await sleep(20);
  }
  return condition();
}

// ---- helpers to build a server and accounts --------------------------------------------------------------------

export interface Account {
  id: string;
  username: string;
  authSecret: string;
  access: string;
  refresh: string;
}

/** The type of the server the tests build. */
export type TestApp = Awaited<ReturnType<typeof buildApp>>;

/** A server with an in-memory database and fast hashing; the settings can be overridden per test. */
export async function makeApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
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
export function publicKey(): string {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 65).toString('base64');
}

/** The body of a registration request for a user name. */
export function registration(username: string, authSecret: string): Record<string, unknown> {
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
export async function signUp(app: TestApp, name: string): Promise<Account> {
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
export function bearer(account: Account): Record<string, string> {
  return { authorization: 'Bearer ' + account.access };
}

/** A request as an account (or without a session when `account` is null). */
export function call(
  app: TestApp,
  account: Account | null,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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
export async function befriend(app: TestApp, a: Account, b: Account): Promise<string> {
  await call(app, a, 'POST', '/api/friends/request', { username: b.username });
  await call(app, b, 'POST', `/api/friends/${a.id}/accept`);
  const res = await call(app, a, 'POST', '/api/dms', { userId: b.id });
  return res.json().channelId;
}

/** Base64 of some random bytes, for the encrypted fields the server only stores. */
export function blob(bytes: number): string {
  return randomBytes(bytes).toString('base64');
}

/** A sealed message body (the server never reads it; it only checks the shape). */
export function sealed(): Record<string, unknown> {
  return { iv: blob(12), ciphertext: blob(40), signature: blob(64) };
}

/** A key envelope for a group (the server only stores it). */
export function envelope(): { iv: string; data: string } {
  return { iv: blob(12), data: blob(48) };
}

/** A name of a group sealed with its key (the server only checks the shape and the version of the key). */
export function sealedName(version = 1): string {
  return `g1.${version}.${blob(12)}.${blob(80)}`;
}

/** The names of a group (its channels and tags), all sealed again with the key of a version. */
export async function metaOf(
  app: TestApp,
  owner: Account,
  guildId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const guild = (await call(app, owner, 'GET', '/api/guilds')).json().guilds.find(function same(g: {
    id: string;
  }) {
    return g.id === guildId;
  });
  return {
    name: sealedName(version),
    channels: guild.channels.map(function seal(c: { id: string }) {
      return { id: c.id, name: sealedName(version) };
    }),
    tags: guild.tags.map(function seal(c: { id: string }) {
      return { id: c.id, name: sealedName(version) };
    }),
  };
}

/** Creates a group owned by `owner` and returns its id and its first text channel. */
export async function makeGuild(
  app: TestApp,
  owner: Account,
): Promise<{ id: string; text: string }> {
  const res = await call(app, owner, 'POST', '/api/guilds', {
    id: randomUUID(),
    name: sealedName(),
    envelope: envelope(),
    channels: [
      { id: randomUUID(), name: sealedName(), type: 'text' },
      { id: randomUUID(), name: sealedName(), type: 'voice' },
    ],
  });
  const guild = res.json().guild;
  const text = guild.channels.find(function isText(c: { type: string }) {
    return c.type === 'text';
  });
  return { id: guild.id, text: text.id };
}

// ---- checks ---------------------------------------------------------------------------------------------------

export interface TestSocket {
  frames: Record<string, unknown>[];
  open: Promise<void>;
  ready: Promise<boolean>;
  closed: Promise<number>;
  send(message: unknown): void;
  raw(data: string): void;
  close(): void;
}

/** Opens a WebSocket to the test server and authenticates it. */
export async function openSocket(
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
    close: function close() {
      ws.close();
    },
  };
}
