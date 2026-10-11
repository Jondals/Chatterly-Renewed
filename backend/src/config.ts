/**
 * src/config.ts
 * Reads the server configuration (port, secrets, GIF keys, TURN, TLS...) from environment variables and generates the secrets that are missing.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface AppConfig {
  version: string;
  host: string;
  port: number;
  /** ':memory:' or a file path. */
  dbPath: string;
  uploadDir: string;
  jwtSecret: string;
  /** Used for deterministic fake KDF salts and TURN credentials. */
  serverSecret: string;
  corsOrigins: string[];
  accessTtlSec: number;
  refreshTtlSec: number;
  scrypt: { N: number; r: number; p: number };
  /** Lowest PBKDF2 iteration count the server accepts from a client. */
  minKdfIterations: number;
  maxUploadBytes: number;
  /** Profile pictures / banners / group icons (already re-encoded by the client). */
  maxImageBytes: number;
  /** GIPHY API key. GIF search is disabled when empty. */
  gifKey: string;
  /** Tenor key (the Tenor API is closed; it is kept in case it comes back). Optional. */
  tenorKey: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  rateLimit: { max: number; authMax: number; windowMs: number };
  loginLockout: { maxFailures: number; windowMs: number; lockMs: number };
  stunUrls: string[];
  /**
   * Every call must go through the relay (no peer learns the address of another and no third party sees it).
   * ! This is the REQUESTED policy: it stays true even when the relay is not configured, so the calls fail closed
   * (see `relayProblem`) instead of silently falling back to direct or STUN-assisted connections.
   */
  relayOnly: boolean;
  turn: { urls: string[]; secret: string; ttlSec: number } | null;
  tls: { key: string; cert: string } | null;
  logger: boolean;
}

export const APP_VERSION = '2.23.1';

/** ! The shortest secret the server accepts from the environment (generated ones are 64 characters). */
const MIN_SECRET_LENGTH = 32;

/**
 * How long the credentials of the relay stay valid, in seconds: TURN_TTL_SEC, kept between 5 minutes and 7 days (one
 * hour when it is missing or not a number). A call can last as long as its credentials are valid, and the app asks for
 * new ones before they expire, so a long TTL only means that nothing has to be renewed during a normal call.
 */
function turnTtlSec(value: string | undefined): number {
  const seconds = Math.floor(Number(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return 3600;
  return Math.min(Math.max(seconds, 300), 7 * 24 * 3600);
}

/** A list from an environment variable, separated by commas. */
function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

/**
 * Secrets are taken from the environment. When absent (local development) they are generated once
 * and persisted next to the database so tokens survive restarts.
 */
function loadSecrets(dataDir: string): {
  jwtSecret: string;
  serverSecret: string;
} {
  const fromEnv = {
    jwtSecret: process.env['JWT_SECRET'],
    serverSecret: process.env['SERVER_SECRET'],
  };
  for (const name of ['jwtSecret', 'serverSecret'] as const) {
    const value = fromEnv[name];
    if (value && value.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `${name === 'jwtSecret' ? 'JWT_SECRET' : 'SERVER_SECRET'} must have at least ${MIN_SECRET_LENGTH} characters (try: openssl rand -base64 48)`,
      );
    }
  }
  if (fromEnv.jwtSecret && fromEnv.jwtSecret === fromEnv.serverSecret) {
    throw new Error('JWT_SECRET and SERVER_SECRET must be different values');
  }
  if (fromEnv.jwtSecret && fromEnv.serverSecret) {
    return { jwtSecret: fromEnv.jwtSecret, serverSecret: fromEnv.serverSecret };
  }
  const file = path.join(dataDir, 'secrets.json');
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stored.jwtSecret && stored.serverSecret) {
      return {
        jwtSecret: fromEnv.jwtSecret ?? stored.jwtSecret,
        serverSecret: fromEnv.serverSecret ?? stored.serverSecret,
      };
    }
  } catch {
    /* generate below */
  }
  const generated = {
    jwtSecret: fromEnv.jwtSecret ?? randomBytes(48).toString('base64'),
    serverSecret: fromEnv.serverSecret ?? randomBytes(48).toString('base64'),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(generated, null, 2), { mode: 0o600 });
  return generated;
}

/** True for a TURN url that a browser can use (`turn:` or `turns:`); STUN-only entries cannot relay anything. */
function isTurnUrl(url: string): boolean {
  return /^turns?:\S+$/i.test(url);
}

/**
 * * Why the calls cannot start under the requested policy, or null when everything needed is in place.
 * ! When the
 * operator asked for relay-only calls but no usable TURN relay is configured, the server must refuse to hand out
 * ICE servers: handing out a STUN server (or nothing) would let the browsers connect directly and expose addresses.
 */
export function relayProblem(config: Pick<AppConfig, 'relayOnly' | 'turn'>): string | null {
  if (config.relayOnly && !config.turn) {
    return 'RELAY_ONLY=1 needs TURN_URLS (turn:/turns: addresses) and TURN_SECRET; calls are refused until they are set';
  }
  return null;
}

/** Reads the settings of the server from the environment; the secrets are created the first time and kept. */
export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = path.resolve(process.env['DATA_DIR'] ?? path.join(process.cwd(), 'data'));
  const secrets =
    overrides.jwtSecret && overrides.serverSecret
      ? { jwtSecret: overrides.jwtSecret, serverSecret: overrides.serverSecret }
      : loadSecrets(dataDir);

  const turnUrls = list(process.env['TURN_URLS'], []).filter(isTurnUrl);
  const turnSecret = process.env['TURN_SECRET'];
  const relayRequested = process.env['RELAY_ONLY'] === '1';

  const tlsKey = process.env['TLS_KEY'];
  const tlsCert = process.env['TLS_CERT'];

  const base: AppConfig = {
    version: APP_VERSION,
    host: process.env['HOST'] ?? '0.0.0.0',
    port: Number(process.env['PORT'] ?? 3000),
    dbPath: process.env['DB_PATH'] ?? path.join(dataDir, 'chatterly.db'),
    uploadDir: process.env['UPLOAD_DIR'] ?? path.join(dataDir, 'uploads'),
    ...secrets,
    corsOrigins: list(process.env['CORS_ORIGINS'], [
      'http://localhost:4200',
      'http://127.0.0.1:4200',
    ]),
    accessTtlSec: 15 * 60,
    refreshTtlSec: 30 * 24 * 3600,
    // OWASP minimum for scrypt: N=2^17, r=8, p=1. 2^15 keeps login snappy while the client already
    // ! spends 600k PBKDF2 rounds before the secret ever reaches us.
    scrypt: { N: 1 << 15, r: 8, p: 1 },
    minKdfIterations: 200_000,
    maxUploadBytes: 12 * 1024 * 1024,
    maxImageBytes: 8 * 1024 * 1024,
    gifKey: process.env['GIPHY_API_KEY'] ?? '',
    tenorKey: process.env['TENOR_API_KEY'] ?? '',
    rateLimit: { max: 600, authMax: 20, windowMs: 60_000 },
    loginLockout: {
      maxFailures: 5,
      windowMs: 15 * 60_000,
      lockMs: 15 * 60_000,
    },
    // With an own relay (coturn also answers STUN), or when relay-only calls are requested, Google is not asked at
    // all: it would learn the address of every caller.
    stunUrls: list(
      process.env['STUN_URLS'],
      (turnUrls.length && turnSecret) || relayRequested
        ? []
        : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
    ),
    relayOnly: relayRequested,
    turn:
      turnUrls.length && turnSecret
        ? { urls: turnUrls, secret: turnSecret, ttlSec: turnTtlSec(process.env['TURN_TTL_SEC']) }
        : null,
    tls: tlsKey && tlsCert ? { key: tlsKey, cert: tlsCert } : null,
    logger: process.env['NODE_ENV'] !== 'test',
  };
  return { ...base, ...overrides };
}
