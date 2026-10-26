/**
 * desktop/src/server-url.cjs
 * Which server the desktop app talks to, and the rule that keeps that address safe.
 *
 * ! A packaged build only accepts https. Plain http is allowed just for localhost while developing, so a build that
 *   reaches users can never be pointed at an unencrypted address.
 */
'use strict';

const DEFAULT_URL = 'https://chatterly.dpdns.org';

/** Turns the configured address into a URL object, or throws with a clear message. */
function parseServerUrl(raw, isPackaged) {
  let url;
  try {
    url = new URL(raw || DEFAULT_URL);
  } catch (error) {
    throw new Error('CHATTERLY_URL is not a valid address: ' + raw);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const secure = url.protocol === 'https:';
  const devHttp = url.protocol === 'http:' && local && !isPackaged;
  if (!secure && !devHttp) {
    throw new Error('The server address must be https (http only on localhost when not packaged).');
  }
  if (url.username || url.password) {
    throw new Error('The server address must not contain a user name or password.');
  }
  return url;
}

module.exports = { DEFAULT_URL, parseServerUrl };
