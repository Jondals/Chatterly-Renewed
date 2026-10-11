/**
 * desktop/src/preload.cjs
 * The only things the web page can see of the desktop shell: a frozen object with two read-only facts and, when the
 * web app is bundled, the address of the API.
 *
 * ! Do not add IPC channels or Node modules here without a security review: this file is the whole attack surface
 *   between the page and the main process. (desktop/test/desktop.mjs checks that the page has no `require`/`process`.)
 */
'use strict';

const { contextBridge } = require('electron');

/** The API address given by the main process (bundled mode only). Anything that is not an http(s) origin is ignored. */
function readApiOrigin() {
  const prefix = '--chatterly-api=';
  const arg = process.argv.find(function isApiArg(value) {
    return value.startsWith(prefix);
  });
  if (!arg) return null;
  try {
    const url = new URL(arg.slice(prefix.length));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch (error) {
    return null;
  }
}

// * The web app reads window.CHATTERLY_API before it starts (frontend/src/app/core/config.ts).
const apiOrigin = readApiOrigin();
if (apiOrigin) contextBridge.exposeInMainWorld('CHATTERLY_API', apiOrigin);

contextBridge.exposeInMainWorld(
  'chatterlyDesktop',
  Object.freeze({ isDesktop: true, platform: process.platform }),
);
