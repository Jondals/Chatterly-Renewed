/**
 * src/app/core/services/key-store.ts
 * IndexedDB store for the device's non-extractable private keys, so the unlocked identity survives a page reload.
 */
import { InjectionToken } from '@angular/core';
import type { PublicKeys } from '../crypto/identity';
import { runInStore, type StoreLocation } from '../indexed-db';

/** The identity kept between page loads. */
interface StoredIdentity {
  userId: string;
  ecdhPrivate: CryptoKey;
  ecdsaPrivate: CryptoKey;
  publicKeys: PublicKeys;
}

/**
 * Persists the unlocked identity between page loads. CryptoKey objects are stored with the structured-clone
 * algorithm in IndexedDB; because they are non-extractable, not even a script running in this origin can read
 * the key bytes (it can only use them while the session lasts).
 */
export interface KeyStore {
  load(): Promise<StoredIdentity | null>;
  save(identity: StoredIdentity): Promise<void>;
  clear(): Promise<void>;
}

const LOCATION: StoreLocation = { database: 'chatterly-renewed-keys', store: 'identity' };
const KEY = 'current';

/** Reads the stored identity. */
function readIdentity(store: IDBObjectStore): IDBRequest {
  return store.get(KEY);
}

/** Replaces the stored identity. */
function writeIdentity(identity: StoredIdentity, store: IDBObjectStore): IDBRequest {
  return store.put(identity, KEY);
}

/** Removes everything in the store. */
function clearIdentity(store: IDBObjectStore): IDBRequest {
  return store.clear();
}

/** KeyStore that keeps the identity in IndexedDB. */
class IndexedDbKeyStore implements KeyStore {
  /** The stored identity, or null when there is none (or the database cannot be read). */
  async load(): Promise<StoredIdentity | null> {
    try {
      return (
        (await runInStore<StoredIdentity | undefined>(LOCATION, 'readonly', readIdentity)) ?? null
      );
    } catch {
      return null;
    }
  }

  /** Stores the identity. */
  async save(identity: StoredIdentity): Promise<void> {
    await runInStore(LOCATION, 'readwrite', writeIdentity.bind(null, identity));
  }

  /** Removes the stored identity. */
  async clear(): Promise<void> {
    try {
      await runInStore(LOCATION, 'readwrite', clearIdentity);
    } catch {
      // Nothing was stored.
    }
  }
}

/** Injection token of the key store (IndexedDB by default). */
export const KEY_STORE = new InjectionToken<KeyStore>('KEY_STORE', {
  providedIn: 'root',
  factory: function createKeyStore() {
    return new IndexedDbKeyStore();
  },
});
