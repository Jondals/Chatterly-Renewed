/**
 * desktop/src/update-verify.cjs
 * Checks that an update is the one the project published, before anything is downloaded or installed.
 *
 * * Every manifest of an update (latest.yml, beta.yml...) is signed in the build with an Ed25519 key that never reaches GitHub or the
 *   server: next to it travels "<manifest>.sig" (the signature in base64). The app holds only the PUBLIC keys, below. electron-updater
 *   then checks the sha512 of the installer against that manifest, so the chain is: signature, manifest, installer.
 * ! HTTPS and the sha512 alone are not enough: whoever can write in the release (or in the beta server) could change the installer
 *   and the manifest together. They cannot sign.
 * * Rotating the key: add the new public key as a second entry, publish a version signed with the OLD key that carries both, and
 *   later drop the old one. A key that is lost or stolen is replaced the same way (the people who already have the app need
 *   one update signed with the old key, or a reinstall).
 * * A manifest is accepted only if the version it names is the one electron-updater found and the sha512 is the same one, so the
 *   signed text and the file that will be downloaded cannot differ.
 */
'use strict';

const crypto = require('node:crypto');

/** The public keys that may sign an update (base64 of the SPKI DER of an Ed25519 key). The first one is the current one. */
const PUBLIC_KEYS = ['MCowBQYDK2VwAyEAdPefxXi9eTZc1iAb8BSYnfT3xnfUoJMkDln5tsHmohI='];

/** True when `signature` (base64) is a valid signature of `data` by any of the keys. */
function verifySignature(data, signature, keys = PUBLIC_KEYS) {
  if (!Buffer.isBuffer(data) || typeof signature !== 'string') return false;
  const raw = Buffer.from(signature.trim(), 'base64');
  if (raw.length !== 64) return false;
  for (const key of keys) {
    try {
      const publicKey = crypto.createPublicKey({
        key: Buffer.from(key, 'base64'),
        format: 'der',
        type: 'spki',
      });
      if (crypto.verify(null, data, publicKey, raw)) return true;
    } catch (error) {
      // A malformed key never verifies anything.
    }
  }
  return false;
}

/** The version, installer name and sha512 of a manifest (the lines that start at the left edge), or null. */
function readManifest(text) {
  if (typeof text !== 'string' || text.length > 64 * 1024) return null;
  const version = /^version:\s*['"]?([0-9A-Za-z.+-]+)['"]?\s*$/m.exec(text);
  const file = /^path:\s*(\S+)\s*$/m.exec(text);
  const sha512 = /^sha512:\s*(\S+)\s*$/m.exec(text);
  if (!version || !file || !sha512) return null;
  return { version: version[1], path: file[1], sha512: sha512[1] };
}

/**
 * Decides whether what electron-updater found (`info`) is what the signed manifest says. Returns '' when it is, or the reason it is
 * not (a short English sentence for the log and the page).
 */
function checkAgainstManifest(info, manifestText, signature, keys = PUBLIC_KEYS) {
  if (!verifySignature(Buffer.from(manifestText, 'utf8'), signature, keys)) {
    return 'the signature of the update is not valid';
  }
  const signed = readManifest(manifestText);
  if (!signed) return 'the signed manifest cannot be read';
  if (!info || info.version !== signed.version) return 'the version is not the signed one';
  if (info.sha512 !== signed.sha512) return 'the installer is not the signed one';
  return '';
}

module.exports = { PUBLIC_KEYS, verifySignature, readManifest, checkAgainstManifest };
