/**
 * test/security/kdf.mts
 * The password stretching and the identity keys: known answers from an independent implementation (node:crypto), and
 * the refusals that protect them from a hostile server (fewer rounds, a swapped public key, a wrong password).
 */
import { createCipheriv, hkdfSync, pbkdf2Sync, randomBytes } from 'node:crypto';
import {
  KdfDowngradeError,
  MIN_KDF_ITERATIONS,
  deriveSecrets,
} from '../../frontend/src/app/core/crypto/kdf';
import { createIdentity, unlockIdentity } from '../../frontend/src/app/core/crypto/identity';
import { check, step } from './support.mts';

/** True when the promise is refused with a KdfDowngradeError (and nothing else). */
async function refusesDowngrade(work: Promise<unknown>): Promise<boolean> {
  try {
    await work;
    return false;
  } catch (error) {
    return error instanceof KdfDowngradeError;
  }
}

/** True when the promise is refused with any error. */
async function fails(work: Promise<unknown>): Promise<boolean> {
  try {
    await work;
    return false;
  } catch {
    return true;
  }
}

/** The password stretching and the identity keys. */
export async function checkKdf(): Promise<void> {
  step('keys: password stretching gives the same keys as an independent implementation');
  const password = 'correct horse battery staple ñ';
  const salt = Buffer.alloc(16, 7);
  const saltB64 = salt.toString('base64');
  const secrets = await deriveSecrets(password, saltB64, MIN_KDF_ITERATIONS);

  // The same derivation, written again with node:crypto (not WebCrypto): PBKDF2-SHA-256, then HKDF-SHA-256 per output.
  const master = pbkdf2Sync(
    Buffer.from(password.normalize('NFKC'), 'utf8'),
    salt,
    MIN_KDF_ITERATIONS,
    32,
    'sha256',
  );
  const expectedAuth = Buffer.from(
    hkdfSync('sha256', master, Buffer.alloc(0), 'chatterly-renewed/auth/v1', 32),
  ).toString('base64');
  check(
    secrets.authSecret === expectedAuth,
    'the sign-in secret matches the independent derivation',
  );

  // The wrapping key cannot be read (it is not extractable), so it is compared through what it encrypts.
  const wrapKeyBytes = Buffer.from(
    hkdfSync('sha256', master, Buffer.alloc(0), 'chatterly-renewed/wrap/v1', 32),
  );
  const payload = randomBytes(32);
  const iv = randomBytes(12);
  const payloadKey = await crypto.subtle.importKey('raw', payload, 'AES-GCM', true, ['encrypt']);
  const wrapped = Buffer.from(
    await crypto.subtle.wrapKey('raw', payloadKey, secrets.wrappingKey, { name: 'AES-GCM', iv }),
  );
  const cipher = createCipheriv('aes-256-gcm', wrapKeyBytes, iv);
  const expectedWrapped = Buffer.concat([
    cipher.update(payload),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  check(wrapped.equals(expectedWrapped), 'the wrapping key matches the independent derivation');
  check(
    Buffer.from(
      hkdfSync('sha256', master, Buffer.alloc(0), 'chatterly-renewed/auth/v1', 32),
    ).equals(wrapKeyBytes) === false,
    'the sign-in secret and the wrapping key are independent (different HKDF labels)',
  );

  step('keys: a server cannot ask for weaker password stretching');
  check(
    await refusesDowngrade(deriveSecrets(password, saltB64, 1)),
    'one round is refused (a hostile server would get a secret that is almost free to brute force)',
  );
  check(
    await refusesDowngrade(deriveSecrets(password, saltB64, 200_000)),
    'the old floor of 200 000 rounds is refused too',
  );
  check(
    await refusesDowngrade(deriveSecrets(password, saltB64, MIN_KDF_ITERATIONS - 1)),
    'one round fewer than the floor is refused',
  );
  check(
    (await refusesDowngrade(deriveSecrets(password, saltB64, Number.NaN))) &&
      (await refusesDowngrade(deriveSecrets(password, saltB64, 600_000.5))) &&
      (await refusesDowngrade(deriveSecrets(password, saltB64, -600_000))),
    'a number of rounds that is not a whole number is refused',
  );

  step('keys: the identity cannot be swapped or opened with another password');
  const wrappingKey = secrets.wrappingKey;
  const made = await createIdentity(wrappingKey);
  const reopened = await unlockIdentity(made.wrappedKeys, wrappingKey, made.publicKeys);
  check(
    reopened.ecdhPrivate.extractable === false && reopened.ecdsaPrivate.extractable === false,
    'the private keys of the identity are not extractable once opened',
  );
  const other = await createIdentity(wrappingKey);
  check(
    await fails(unlockIdentity(made.wrappedKeys, wrappingKey, other.publicKeys)),
    'keys that do not match the advertised public keys are refused (a server cannot swap the identity)',
  );
  check(
    await fails(
      unlockIdentity(
        { ecdh: made.wrappedKeys.ecdsa, ecdsa: made.wrappedKeys.ecdh },
        wrappingKey,
        made.publicKeys,
      ),
    ),
    'the two wrapped keys cannot be exchanged (each one is bound to its role)',
  );
  const wrong = await deriveSecrets('another password', saltB64, MIN_KDF_ITERATIONS);
  check(
    await fails(unlockIdentity(made.wrappedKeys, wrong.wrappingKey, made.publicKeys)),
    'a wrong password cannot open the identity',
  );
}
