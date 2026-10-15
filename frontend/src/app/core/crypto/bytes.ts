/** Small byte/encoding helpers shared by the crypto modules. Pure TS, no Angular. */

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = function (text: string): Bytes {
  return encoder.encode(text);
};
export const fromUtf8 = function (bytes: BufferSource): string {
  return decoder.decode(bytes);
};

/** Encodes bytes as base64 text. */
export function toB64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const chunk = 0x8000; // avoid call-stack limits on large buffers
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Encodes bytes as base64url text without padding (safe in URLs and JSON, as the server's tokens are). */
export function toB64Url(data: ArrayBuffer | Uint8Array): string {
  return toB64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64 text into bytes. */
export function fromB64(b64: string): Bytes {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Returns cryptographically secure random bytes (in several calls when the request is larger than the browser allows at once). */
export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length);
  // getRandomValues refuses requests above 64 KiB.
  for (let i = 0; i < length; i += 65536) crypto.getRandomValues(out.subarray(i, i + 65536));
  return out;
}

/** Joins several byte arrays into one. */
export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(
    parts.reduce(function (n, p) {
      return n + p.length;
    }, 0),
  );
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encodes bytes as lowercase hexadecimal text. */
export function toHex(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Array.from(bytes, function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

/** SHA-256 hash of a text or of bytes. */
export async function sha256(data: BufferSource | string): Promise<Bytes> {
  const input = typeof data === 'string' ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

/** Constant-time-ish comparison for short secrets such as hashes. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
