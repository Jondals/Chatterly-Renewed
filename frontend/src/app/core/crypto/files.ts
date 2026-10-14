/**
 * src/app/core/crypto/files.ts
 * Encryption of attached files with a key of their own per file, and the check of their SHA-256.
 */
import { equalBytes, fromB64, randomBytes, sha256, toB64, toHex } from './bytes';

/** Everything a recipient needs to fetch, decrypt and verify an attachment. Sent inside the E2EE message. */
export interface FileSecret {
  key: string;
  iv: string;
  /** Hex SHA-256 of the plaintext. */
  sha256: string;
}

class IntegrityError extends Error {
  /** Creates the error with a default message. */
  constructor(message = 'File integrity check failed') {
    super(message);
    this.name = 'IntegrityError';
  }
}

/** Each file gets its own random key, so a leaked file key exposes nothing else. */
export async function encryptFile(
  data: ArrayBuffer,
): Promise<{ cipher: Uint8Array<ArrayBuffer>; secret: FileSecret }> {
  const rawKey = randomBytes(32);
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return {
    cipher,
    secret: {
      key: toB64(rawKey),
      iv: toB64(iv),
      sha256: toHex(await sha256(new Uint8Array(data))),
    },
  };
}

/** Decrypts a downloaded file with its one-time key and checks its SHA-256 before returning it. */
export async function decryptFile(
  cipher: ArrayBuffer,
  secret: FileSecret,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', fromB64(secret.key), 'AES-GCM', false, [
    'decrypt',
  ]);
  let plain: Uint8Array<ArrayBuffer>;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(secret.iv) }, key, cipher),
    );
  } catch {
    throw new IntegrityError('Attachment was tampered with or corrupted');
  }
  const actual = await sha256(plain);
  const expected = new Uint8Array(
    secret.sha256.match(/../g)?.map(function (h) {
      return parseInt(h, 16);
    }) ?? [],
  );
  if (!equalBytes(actual, expected)) throw new IntegrityError('SHA-256 mismatch');
  return plain;
}
