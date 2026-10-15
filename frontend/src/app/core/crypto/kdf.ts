/**
 * src/app/core/crypto/kdf.ts
 * Key derivation from the password (PBKDF2 + HKDF), to keep the sign-in secret apart from the encryption key.
 */
import { fromB64, utf8 } from './bytes';

/**
 * ! The cheapest password stretching this client ever performs. The number of rounds of an account comes from the
 * server, so a hostile server could ask for 1 round: the `authSecret` it then receives would be almost free to brute
 * force, and with the password it would also get the wrapping key. Every derivation is checked here, so no flow
 * (sign in, password change, account deletion) can be talked into a weaker one.
 */
export const MIN_KDF_ITERATIONS = 600_000;

/** The server asked for weaker password stretching than this client accepts. */
export class KdfDowngradeError extends Error {
  /** Creates the error; the message names the number of rounds that was refused. */
  constructor(iterations: number) {
    super(`Refused to stretch the password with only ${iterations} rounds`);
    this.name = 'KdfDowngradeError';
  }
}

export interface DerivedSecrets {
  /** Sent to the server (which hashes it again with scrypt). Reveals nothing about the wrapping key. */
  authSecret: string;
  /** Never leaves the browser: unwraps the identity private keys. */
  wrappingKey: CryptoKey;
}

/**
 * password --PBKDF2(600k)--> master --HKDF--> { authSecret , wrappingKey }
 *
 * The two outputs are independent: the server learns `authSecret` at login, yet it cannot derive
 * `wrappingKey`, so it can never unwrap the stored (encrypted) private keys.
 * Splitting with HKDF (instead of reading two PBKDF2 blocks) keeps the full iteration cost for an
 * attacker who steals the auth hash and tries to guess the password.
 */
export async function deriveSecrets(
  password: string,
  saltB64: string,
  iterations: number,
): Promise<DerivedSecrets> {
  if (!Number.isSafeInteger(iterations) || iterations < MIN_KDF_ITERATIONS) {
    throw new KdfDowngradeError(iterations);
  }
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    utf8(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    passwordKey,
    256,
  );
  const master = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const hkdf = function (info: string) {
    return {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: utf8('chatterly-renewed/' + info),
    };
  };
  const authBits = await crypto.subtle.deriveBits(hkdf('auth/v1'), master, 256);
  const wrappingKey = await crypto.subtle.deriveKey(
    hkdf('wrap/v1'),
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
  return { authSecret: btoa(String.fromCharCode(...new Uint8Array(authBits))), wrappingKey };
}
