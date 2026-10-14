/**
 * src/app/shared/util/errors.ts
 * Turns API errors into readable messages and scores the strength of a password.
 */
import { ApiError } from '../../core/services/api.service';

/** Readable message of each error code the API can answer with. */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong username or password.',
  account_locked: 'Too many failed attempts. Try again in a few minutes.',
  username_taken: 'That username is already taken.',
  user_not_found: 'No user with that username.',
  owner_fixed: 'An owner is set in the server and cannot be removed here.',
  cannot_friend_self: 'You cannot add yourself.',
  already_friends: 'You are already friends.',
  already_requested: 'Friend request already sent.',
  not_friends: 'You can only do that with friends.',
  validation_error: 'Some of the values are not valid.',
  kdf_downgrade: 'The server asked for weak key stretching. Login aborted for your safety.',
  too_many_requests: 'Slow down a little — too many requests.',
  rotation_pending: 'The group key is being rotated. Try again in a moment.',
  already_member: 'They are already in this group.',
  guild_full: 'This group is full.',
  invalid_file: 'That file cannot be uploaded (empty or too large).',
  invalid_image: 'That image is not valid.',
  unsupported_image_type: 'Only PNG, JPEG, WebP or GIF images are supported.',
  too_many_images: 'You have too many uploaded images. Remove some first.',
  gifs_not_configured: 'GIF search is not enabled on this server.',
  gif_provider_error: 'The GIF service is not responding right now.',
};

/** A readable message for any error (API errors by their code; network, crypto and other errors by type). */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return MESSAGES['too_many_requests']!;
    return MESSAGES[error.code] ?? `Request failed (${error.code}).`;
  }
  if (error instanceof TypeError) return 'Cannot reach the server. Is the backend running?';
  if (error instanceof DOMException && error.name === 'OperationError')
    return 'Decryption failed — wrong password?';
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** 0-4 heuristic: length and character variety. Only guidance — the real defence is the KDF. */
export function passwordScore(password: string): number {
  if (password.length < 8) return password.length ? 1 : 0;
  let score = 1;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  if (password.length >= 18) score = Math.max(score, 4);
  return Math.min(4, score);
}
