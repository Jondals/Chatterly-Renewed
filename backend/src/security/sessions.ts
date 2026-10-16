/**
 * src/security/sessions.ts
 * Checks that the session behind an access token is still open, so that signing out, changing the password,
 * erasing the account or losing the session cap revokes the access token at once (not when it expires).
 */
import type { Db } from '../db';

/**
 * Whether a session exists, belongs to the user, has not expired and its account is not erased or suspended.
 * * Access tokens carry the id of their session (`sid`); a token without a live session is worthless, which
 * is what makes logout and "close all sessions" effective immediately instead of after the 15 minute lifetime.
 *
 * @param db Open database.
 * @param sessionId The `sid` claim of the access token.
 * @param userId The `sub` claim of the access token.
 * @param now Current time in milliseconds (injectable for tests).
 */
export function isSessionLive(
  db: Db,
  sessionId: string,
  userId: string,
  now = Date.now(),
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.user_id = ? AND s.expires_at > ? AND u.deleted_at IS NULL
          AND u.suspended_at IS NULL`,
    )
    .get(sessionId, userId, now);
}
