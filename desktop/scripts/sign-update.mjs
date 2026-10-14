/**
 * desktop/scripts/sign-update.mjs
 * Signs the manifest of an update (latest.yml, beta.yml...) and writes the signature in its last line ("chatterlySignature: ...",
 * which electron-updater ignores), so the manifest is the only file to publish. What is signed is everything before that line.
 *
 *   CHATTERLY_UPDATE_KEY="<private key, PEM>" node desktop/scripts/sign-update.mjs <manifest> [<manifest>...]
 *
 * * The app checks this signature with the public key in desktop/src/update-verify.cjs before it downloads anything.
 * ! The private key lives only in the secret of the repository (the "update-signing" environment), and only the small job of the
 *   workflow that publishes receives it: never the jobs that build with the code of many npm packages.
 * * After signing, the script checks the manifest the same way the app does, so a key that does not match is found in the build and
 *   not by the people who would receive an update they cannot install.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const verify = require('../src/update-verify.cjs');

const pem = process.env.CHATTERLY_UPDATE_KEY;
const files = process.argv.slice(2);
if (!pem || files.length === 0) {
  console.error('Usage: CHATTERLY_UPDATE_KEY=<PEM> node sign-update.mjs <manifest>...');
  process.exit(1);
}

/**
 * The key as it arrives from the secret of GitHub: a PEM, but pasting often changes it (line breaks become spaces, a line is lost,
 * Windows line ends). Only the base64 body matters, so it is taken out and read as the DER of a PKCS#8 key.
 */
function readKey(text) {
  const body = text
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    return crypto.createPrivateKey({
      key: Buffer.from(body, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  } catch (error) {
    console.error(
      'The secret UPDATE_SIGNING_KEY is not a private key (' +
        body.length +
        ' characters of base64 were found; an Ed25519 key has 64). Paste the whole .pem file, BEGIN and END lines included.',
    );
    process.exit(1);
  }
}

const NEWLINE = String.fromCharCode(10);
const key = readKey(pem);
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  // a manifest that was signed already is signed again from its content
  const split = verify.splitSigned(text);
  const base = split ? split.content : text;
  const content = base.endsWith(NEWLINE) ? base : base + NEWLINE;
  const signature = crypto.sign(null, Buffer.from(content, 'utf8'), key).toString('base64');
  const signed = content + verify.SIGNATURE_MARK.slice(1) + signature + NEWLINE;
  // the same check the app makes: the manifest has to say what it says and the signature has to be of the key the app carries
  const info = verify.readManifest(content);
  if (!info || verify.checkAgainstManifest(info, signed) !== '') {
    console.error(
      'The signature of ' + path.basename(file) + ' does not match the public key of the app.',
    );
    process.exit(1);
  }
  fs.writeFileSync(file, signed);
  console.log('signed ' + path.basename(file));
}
