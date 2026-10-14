/**
 * desktop/scripts/sign-update.mjs
 * Signs the manifest of an update (latest.yml, beta.yml...) and writes the signature next to it as "<manifest>.sig".
 *
 *   CHATTERLY_UPDATE_KEY="<private key, PEM>" node desktop/scripts/sign-update.mjs <manifest> [<manifest>...]
 *
 * * The app checks this signature with the public key in desktop/src/update-verify.cjs before it downloads anything.
 * ! The private key lives only in the secret of the repository (the "update-signing" environment), and only the small job of the
 *   workflow that publishes receives it: never the jobs that build with the code of many npm packages.
 * * After signing, the script checks the signature with the public keys of the app, so a key that does not match is found in the
 *   build and not by the people who would receive an update they cannot install.
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
const key = crypto.createPrivateKey(pem);
for (const file of files) {
  const data = fs.readFileSync(file);
  const signature = crypto.sign(null, data, key).toString('base64');
  if (!verify.verifySignature(data, signature)) {
    console.error(
      'The signature of ' + path.basename(file) + ' does not match the public key of the app.',
    );
    process.exit(1);
  }
  fs.writeFileSync(file + '.sig', signature + '\n');
  console.log('signed ' + path.basename(file));
}
