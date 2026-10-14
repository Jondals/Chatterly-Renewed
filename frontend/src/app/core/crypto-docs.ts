/**
 * src/app/core/crypto-docs.ts
 * The encryption systems the app uses and the document that describes each one, and a helper that finds their
 * names inside a text so they can be shown as links.
 */

/** One system and its specification. */
interface CryptoDoc {
  name: string;
  url: string;
}

/** The systems; when two names start at the same place the longer one wins ("ECDH P-256" over "ECDH"). */
const CRYPTO_DOCS: CryptoDoc[] = [
  { name: 'WebRTC Encoded Transform', url: 'https://www.w3.org/TR/webrtc-encoded-transform/' },
  { name: 'Trust on first use', url: 'https://en.wikipedia.org/wiki/Trust_on_first_use' },
  { name: 'Web Crypto API', url: 'https://developer.mozilla.org/docs/Web/API/Web_Crypto_API' },
  { name: 'AES-256-GCM', url: 'https://csrc.nist.gov/pubs/sp/800/38/d/final' },
  { name: 'ECDH P-256', url: 'https://csrc.nist.gov/pubs/sp/800/186/final' },
  { name: 'ECDSA P-256', url: 'https://csrc.nist.gov/pubs/fips/186-5/final' },
  { name: 'DTLS-SRTP', url: 'https://www.rfc-editor.org/rfc/rfc5764' },
  { name: 'SHA-256', url: 'https://csrc.nist.gov/pubs/fips/180-4/upd1/final' },
  { name: 'PBKDF2', url: 'https://www.rfc-editor.org/rfc/rfc8018' },
  { name: 'scrypt', url: 'https://www.rfc-editor.org/rfc/rfc7914' },
  { name: 'HKDF', url: 'https://www.rfc-editor.org/rfc/rfc5869' },
  { name: 'ECDSA', url: 'https://csrc.nist.gov/pubs/fips/186-5/final' },
  { name: 'ECDH', url: 'https://csrc.nist.gov/pubs/sp/800/186/final' },
];

/** A piece of a text: plain, or the name of a system with its link. */
export interface TextPart {
  text: string;
  url?: string;
}

/** Splits a text into plain pieces and names of encryption systems (which carry the link to their document). */
export function linkCrypto(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let rest = text;
  while (rest) {
    let best = -1;
    let found: CryptoDoc | null = null;
    for (const candidate of CRYPTO_DOCS) {
      const at = rest.indexOf(candidate.name);
      if (at >= 0 && (best < 0 || at < best)) {
        best = at;
        found = candidate;
      }
    }
    if (!found) {
      parts.push({ text: rest });
      break;
    }
    if (best > 0) {
      parts.push({ text: rest.slice(0, best) });
    }
    parts.push({ text: found.name, url: found.url });
    rest = rest.slice(best + found.name.length);
  }
  return parts;
}
