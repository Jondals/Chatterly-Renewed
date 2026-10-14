/**
 * src/app/core/device-wipe.ts
 * Erases everything the app keeps on this device: what signing out and erasing the account both leave behind.
 *
 * ! What goes (the whole origin of the app, nothing is kept "just in case"):
 *   - every IndexedDB database: identity keys, the key of the session vault, the encrypted library, stickers, sounds,
 *     fonts, click and ringtone, wallpaper, presets (the known list, plus any other the browser reports);
 *   - localStorage (session, pinned and verified keys of contacts, active group, used emoji, every preference) and
 *     sessionStorage;
 *   - Cache Storage, if anything was ever put there.
 * The caller then loads the page again, so nothing read into memory before (pictures, messages) survives either.
 * ? What cannot be promised: a forensic erasure. The browser or the system may keep copies in free space of the disk
 * or in their own caches; what is erased here is what the app itself can still reach.
 * * Signing in again works as on a new device: the keys come back from the server (wrapped with the password) and the
 *   synced settings come back if synchronisation was on. Contacts are pinned again the first time they are seen.
 */

/** Every database the app opens (also the ones a browser without indexedDB.databases() would not list). */
export const LOCAL_DATABASES = [
  'chatterly-renewed-keys',
  'chatterly-renewed-vault',
  'chatterly-renewed-library',
  'chatterly-renewed-stickers',
  'chatterly-renewed-sounds',
  'chatterly-renewed-fonts',
  'chatterly-renewed-click',
  'chatterly-renewed-ringtone',
  'chatterly-renewed-wallpaper',
  'chatterly-renewed-presets',
];

/**
 * Asks the browser to delete one database. A database still open in this page is "blocked": the deletion then finishes
 * as soon as the page is loaded again, which is what the callers do next, so a blocked one does not wait.
 */
function deleteDatabase(name: string): Promise<void> {
  return new Promise<void>(function wait(resolve) {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(name);
    } catch {
      resolve();
      return;
    }
    request.onsuccess = function deleted() {
      resolve();
    };
    request.onerror = function failed() {
      resolve();
    };
    request.onblocked = function blocked() {
      resolve();
    };
  });
}

/** The names of every database of the app: the known list and whatever the browser reports. */
async function databaseNames(): Promise<string[]> {
  const names = new Set(LOCAL_DATABASES);
  try {
    for (const database of (await indexedDB.databases?.()) ?? []) {
      if (database.name) names.add(database.name);
    }
  } catch {
    /* an old browser without indexedDB.databases(): the known list is enough */
  }
  return [...names];
}

/** Erases every database, both storages and Cache Storage of the app on this device. */
export async function wipeDeviceData(): Promise<void> {
  await Promise.all((await databaseNames()).map(deleteDatabase));
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* storage switched off by the browser: there is nothing to erase */
  }
  try {
    if (typeof caches !== 'undefined') {
      await Promise.all(
        (await caches.keys()).map(function drop(key) {
          return caches.delete(key);
        }),
      );
    }
  } catch {
    /* no Cache Storage here */
  }
}
