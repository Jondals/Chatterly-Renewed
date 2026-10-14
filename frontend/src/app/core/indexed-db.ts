/**
 * src/app/core/indexed-db.ts
 * Tiny helpers over IndexedDB shared by the stores that keep data on this device (keys, stickers, sounds):
 * open a database with one object store and run a single request inside a transaction.
 */

/** Where a store lives: the database, the object store and (optionally) the field that holds each record's key. */
export interface StoreLocation {
  database: string;
  store: string;
  keyPath?: string;
}

/** Opens the database, creating the object store the first time. */
function openStore(location: StoreLocation): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>(function open(resolve, reject) {
    const request = indexedDB.open(location.database, 1);
    request.onupgradeneeded = function create() {
      request.result.createObjectStore(
        location.store,
        location.keyPath ? { keyPath: location.keyPath } : undefined,
      );
    };
    request.onsuccess = function opened() {
      resolve(request.result);
    };
    request.onerror = function failed() {
      reject(request.error);
    };
  });
}

/** Runs one request inside a transaction of the object store and returns its result. */
export async function runInStore<T>(
  location: StoreLocation,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openStore(location);
  try {
    return await new Promise<T>(function execute(resolve, reject) {
      const request = action(db.transaction(location.store, mode).objectStore(location.store));
      request.onsuccess = function succeeded() {
        resolve(request.result as T);
      };
      request.onerror = function failed() {
        reject(request.error);
      };
    });
  } finally {
    db.close();
  }
}

/** A file kept as its bytes: some browsers (Safari, private windows) fail to store a Blob in IndexedDB, bytes always work. */
interface PackedBlob {
  packedBlob: ArrayBuffer;
  type: string;
}

/** Whether a stored value is a file kept as bytes. */
function isPacked(value: unknown): value is PackedBlob {
  return typeof value === 'object' && value !== null && 'packedBlob' in value;
}

/** Copies a value turning every file inside it into its bytes, so it can be stored in any browser. */
export async function packBlobs<T>(value: T): Promise<T> {
  if (value instanceof Blob) {
    return { packedBlob: await value.arrayBuffer(), type: value.type } as T;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    for (const item of value) {
      copy.push(await packBlobs(item));
    }
    return copy as T;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = await packBlobs(item);
    }
    return copy as T;
  }
  return value;
}

/** The opposite of `packBlobs`: files kept as bytes become files again (files stored as files are left alone). */
export function unpackBlobs<T>(value: T): T {
  if (isPacked(value)) {
    return new Blob([value.packedBlob], { type: value.type }) as T;
  }
  if (Array.isArray(value)) {
    return value.map(unpackBlobs) as T;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = unpackBlobs(item);
    }
    return copy as T;
  }
  return value;
}
