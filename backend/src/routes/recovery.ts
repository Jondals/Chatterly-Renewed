/**
 * src/routes/recovery.ts
 * Getting back into an account when the password is lost.
 *
 * * The identity of a person (their private keys) is encrypted in their browser with a key made from their password: the server
 *   cannot open it, and an administrator cannot either. So "resetting the password" cannot give the old keys back. What it does:
 *   1. The person tells the administrators from the sign-in page that they cannot sign in (POST /api/auth/recovery-request: only
 *      the name and the time are kept).
 *   2. An administrator sets a temporary password (POST /api/admin/users/:id/reset-password: the browser of the administrator
 *      makes the proof of the password, the server never sees it) and tells it to the person by another way.
 *   3. The person signs in with it: the app sees `identityReset` and makes NEW keys with a password of the person's own choice
 *      (POST /api/me/identity-reset). The account, its name, friends and groups stay; what was encrypted for the old keys cannot
 *      be read any more (old direct messages, the library, the synced settings, the picture and banner): `eraseIdentityData`.
 * ! Only an administrator who may act on that account can reset it (never an owner, never themselves; an administrator only
 *   an account that is not one), and every reset is written in the record.
 */
import type { AppContext } from '../context';
import { deleteImage } from './images';
import { vaultFile } from './vault';
import fs from 'node:fs';

/** Forgets everything that was encrypted for the old keys of a person (their new keys cannot open it). */
export function eraseIdentityData(ctx: AppContext, userId: string): void {
  const { db } = ctx;
  const images = db
    .prepare("SELECT id FROM images WHERE owner_id = ? AND kind IN ('avatar','banner','font')")
    .all(userId) as { id: string }[];
  const vault = db.prepare('SELECT id FROM vault_items WHERE owner_id = ?').all(userId) as {
    id: string;
  }[];
  db.transaction(function erase() {
    // The envelopes of group keys that this person wrapped for others carry their OLD public key from now on (as when an account is erased).
    db.prepare(
      'UPDATE guild_keys SET wrapper_pub = (SELECT pub_ecdh FROM users WHERE id = ?) WHERE wrapper_id = ? AND wrapper_pub IS NULL',
    ).run(userId, userId);
    // The envelopes made for the old keys are useless: the owners of the groups are asked to renew the key and give a new one.
    db.prepare('DELETE FROM guild_keys WHERE user_id = ?').run(userId);
    db.prepare(
      'UPDATE guilds SET needs_rotation = 1 WHERE id IN (SELECT guild_id FROM guild_members WHERE user_id = ?)',
    ).run(userId);
    db.prepare('DELETE FROM image_keys WHERE viewer_id = ?').run(userId);
    db.prepare(
      'UPDATE users SET avatar_image = NULL, banner_image = NULL, name_font_image = NULL WHERE id = ?',
    ).run(userId);
    db.prepare('DELETE FROM vault_items WHERE owner_id = ?').run(userId);
    db.prepare('DELETE FROM settings_blobs WHERE user_id = ?').run(userId);
  })();
  for (const image of images) deleteImage(ctx, image.id);
  for (const item of vault) {
    fs.rm(vaultFile(ctx, item.id), { force: true }, function ignore() {
      return undefined;
    });
  }
}
