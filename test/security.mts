/**
 * test/security.mts
 * Security regression checks of Chatterly-Renewed. It is one step of the single test (`pnpm test`, see run.mjs), but it can
 * also be run alone:  node backend/node_modules/tsx/dist/cli.mjs test/security.mts
 *
 * What it does: builds the real backend in memory (no network, no browser) and attacks it the way a hostile account
 * would: other people's channels, files and pictures by id, revoked and stale sessions, WebSocket abuse, the link-preview
 * fetcher against the server's own network, uploads with hidden metadata, account deletion in groups that other people
 * still use, a database from an older version. It also checks the pure parts of the call code: the frame cipher, the
 * relay-only policy (it must fail closed) and the freshness of signaling.
 *
 * ? Why one file with the backend in the same process: every check is fast and exact (no timing luck), and a failure
 * names the property that broke. The browser test (run.mjs) covers the screens; this one covers the guarantees.
 *
 * ! Safety: everything is temporary (in-memory database, a temporary folder removed at the end), keys are generated here
 * and no real secret, user or file is read. No arrow functions are used, like in the rest of the project.
 */
import fs from 'node:fs';
import { TMP } from './security/support.mts';
import { checkRelayConfiguration } from './security/relay-configuration.mts';
import { checkSessions } from './security/sessions.mts';
import { checkAuthorization } from './security/authorization.mts';
import { checkImages } from './security/images.mts';
import { checkVault } from './security/vault.mts';
import { checkBeta } from './security/beta.mts';
import { checkBetaFiles } from './security/beta-files.mts';
import { checkAdmin } from './security/admin.mts';
import { checkPreview } from './security/preview.mts';
import { checkDeletion } from './security/deletion.mts';
import { checkDatabase } from './security/database.mts';
import { checkSockets } from './security/sockets.mts';
import { checkStaticServer } from './security/static-server.mts';
import { checkMediaCipher } from './security/media-cipher.mts';
import { checkRelayPolicy } from './security/relay-policy.mts';
import { checkKdf } from './security/kdf.mts';
import { checkVersions } from './security/versions.mts';
import { checkHeaders } from './security/headers.mts';
import { checkPrivacy } from './security/privacy.mts';
import { checkFriendRemoval } from './security/friend-removal.mts';
import { checkServerTags } from './security/server-tags.mts';

async function main(): Promise<void> {
  try {
    await checkRelayConfiguration();
    await checkSessions();
    await checkAuthorization();
    await checkImages();
    await checkVault();
    await checkBeta();
    await checkBetaFiles();
    await checkAdmin();
    await checkPreview();
    await checkDeletion();
    await checkFriendRemoval();
    await checkServerTags();
    await checkPrivacy();
    await checkDatabase();
    await checkSockets();
    await checkStaticServer();
    await checkMediaCipher();
    await checkRelayPolicy();
    await checkKdf();
    await checkVersions();
    await checkHeaders();
    console.log('\nSECURITY CHECKS CORRECT');
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}

main().then(
  function done() {
    process.exit(0);
  },
  function failed(error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
