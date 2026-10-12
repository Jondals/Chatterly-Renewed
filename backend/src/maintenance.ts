/**
 * src/maintenance.ts
 * Periodic cleanup of data that nothing can reach any more: expired sessions, used-up refresh tokens and uploaded
 * pictures that were never attached to a profile or a group.
 *
 * ? Why it exists: without it the database keeps dead sessions forever and an upload that is abandoned half way (the
 * person picks a picture and closes the page) stays on the disk with a row that nothing references. Removing
 * what is unreachable keeps the stored data to what people actually use.
 */
import fs from 'node:fs';
import type { AppContext } from './context';
import { imageFile } from './routes/images';

/** How long a new upload may wait to be attached to a profile or a group before it is considered abandoned. */
export const IMAGE_GRACE_MS = 24 * 60 * 60 * 1000;
/** How long an old group icon that is not encrypted may wait for its owner to open the app (which encrypts it) before it is erased. */
export const PLAIN_ICON_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
/** How often the cleanup runs. */
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

/** What one run removed. */
export interface MaintenanceReport {
  sessions: number;
  spentTokens: number;
  images: number;
  /** Pictures stored before they were encrypted (profile pictures, banners, and old group icons that waited too long): erased. */
  plainPictures: number;
}

/**
 * Removes what nothing can reach any more. Safe to run at any time and as often as wanted: it only deletes rows that
 * are expired or unreferenced, and a picture is only removed once it is older than the grace period.
 *
 * @param ctx The application context (database and configuration).
 * @param now Current time in milliseconds (injectable for tests).
 */
export function runMaintenance(ctx: AppContext, now = Date.now()): MaintenanceReport {
  const { db } = ctx;
  const sessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes;
  const spentTokens = db.prepare('DELETE FROM spent_tokens WHERE expires_at < ?').run(now).changes;
  const plain = db
    .prepare("SELECT id FROM images WHERE encrypted = 0 AND kind IN ('avatar','banner')")
    .all() as { id: string }[];
  for (const image of plain) {
    db.prepare('UPDATE users SET avatar_image = NULL WHERE avatar_image = ?').run(image.id);
    db.prepare('UPDATE users SET banner_image = NULL WHERE banner_image = ?').run(image.id);
    db.prepare('DELETE FROM images WHERE id = ?').run(image.id);
    fs.rmSync(imageFile(ctx, image.id), { force: true });
  }
  const oldIcons = db
    .prepare("SELECT id FROM images WHERE encrypted = 0 AND kind = 'group' AND created_at < ?")
    .all(now - PLAIN_ICON_GRACE_MS) as { id: string }[];
  for (const image of oldIcons) {
    db.prepare('UPDATE guilds SET icon_image = NULL WHERE icon_image = ?').run(image.id);
    db.prepare('DELETE FROM images WHERE id = ?').run(image.id);
    fs.rmSync(imageFile(ctx, image.id), { force: true });
  }
  const abandoned = db
    .prepare(
      `SELECT id FROM images
        WHERE created_at < ?
          AND id NOT IN (SELECT avatar_image FROM users WHERE avatar_image IS NOT NULL)
          AND id NOT IN (SELECT banner_image FROM users WHERE banner_image IS NOT NULL)
          AND id NOT IN (SELECT name_font_image FROM users WHERE name_font_image IS NOT NULL)
          AND id NOT IN (SELECT icon_image FROM guilds WHERE icon_image IS NOT NULL)`,
    )
    .all(now - IMAGE_GRACE_MS) as { id: string }[];
  const remove = db.prepare('DELETE FROM images WHERE id = ?');
  for (const image of abandoned) {
    remove.run(image.id);
    fs.rmSync(imageFile(ctx, image.id), { force: true });
  }
  return {
    sessions,
    spentTokens,
    images: abandoned.length,
    plainPictures: plain.length + oldIcons.length,
  };
}
