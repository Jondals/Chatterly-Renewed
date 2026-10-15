/**
 * src/app/core/config.ts
 * Where the backend lives and the cost of the password key derivation.
 *
 * Where the backend lives. Override at runtime (no rebuild needed) by defining
 * `window.CHATTERLY_API` before the app boots, e.g. from a <script> tag in index.html.
 */
declare global {
  interface Window {
    CHATTERLY_API?: string;
    /** Set only by native-config.js, a file that the native apps carry inside their package (never sent by a server). */
    CHATTERLY_NATIVE?: { strictRelay?: boolean; platform?: string };
  }
}

/** Address of the backend when none is configured: port 3000 of the same host when the page is on port 4200, and the address of the page itself otherwise. */
function defaultApi(): string {
  const { protocol, hostname, port, origin } = window.location;
  return port === '4200' ? `${protocol}//${hostname}:3000` : origin;
}

export const API_BASE: string = (window.CHATTERLY_API ?? defaultApi()).replace(/\/$/, '');
export const WS_URL: string = API_BASE.replace(/^http/, 'ws') + '/ws';

/**
 * ! True in the native apps: every call must go through the relay over TLS (`turns:`), whatever the server answers
 * (see buildPeerConfiguration). Read once, when the app starts: nothing that arrives later can change it.
 */
export const STRICT_RELAY: boolean = window.CHATTERLY_NATIVE?.strictRelay === true;

/** True inside the Android app (set by its native-config.js, like STRICT_RELAY). */
export const ANDROID_APP: boolean = window.CHATTERLY_NATIVE?.platform === 'android';

/** Argon-class cost is not available in WebCrypto; PBKDF2 at OWASP's recommended 600k rounds. */
export const KDF_ITERATIONS = 600_000;
/** Refuse to log in if a server asks for a cheaper KDF than this (downgrade protection, also enforced in deriveSecrets). */
export { MIN_KDF_ITERATIONS as MIN_ACCEPTED_KDF_ITERATIONS } from './crypto/kdf';
