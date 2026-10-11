/** Base64 (standard alphabet) with optional padding. */
export const B64 = '^[A-Za-z0-9+/]+={0,2}$';

export const b64Field = function (minLength: number, maxLength: number) {
  return {
    type: 'string',
    pattern: B64,
    minLength,
    maxLength,
  };
};

export const ivField = b64Field(16, 16); // 12 bytes
export const signatureField = b64Field(86, 88); // 64 byte P1363 ECDSA signature
export const ciphertextField = b64Field(24, 90_000);
export const publicKeyField = b64Field(88, 88); // 65 byte uncompressed P-256 point
export const authSecretField = b64Field(43, 44); // 32 bytes

export const usernameField = {
  type: 'string',
  pattern: '^[a-zA-Z0-9_.-]{3,24}$',
} as const;

/**
 * A text of a group that its members sealed with the key of the group (a name, a channel, a tag): `g1.<key version>.<iv>.<data>`.
 * The server cannot read it; it only checks the shape and which key version it was made with.
 */
export const SEALED_TEXT = '^g1\\.[0-9]{1,6}\\.[A-Za-z0-9+/]{16}\\.[A-Za-z0-9+/]{22,640}={0,2}$';
export const sealedText = { type: 'string', pattern: SEALED_TEXT, maxLength: 700 } as const;
/** The key version a sealed text was made with (0 when it is empty). */
export function sealedVersion(text: string): number {
  return text ? Number(text.split('.')[1]) : 0;
}

/** Removes control characters and the spaces around a text: every name and short text is stored like this. */
// eslint-disable-next-line no-control-regex
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/** The id of the person that makes the request (the token was already checked by `authenticate`). */
export function callerId(req: { user: unknown }): string {
  return (req.user as { sub: string }).sub;
}
