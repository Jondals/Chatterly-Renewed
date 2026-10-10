/**
 * src/app/core/services/persisted.ts
 * An Angular signal that is saved to localStorage and restored from it, used for every per-device preference.
 * Every one is also listed by its key, so the settings can be copied to the account and back (settings-sync.service.ts).
 */
import { effect, signal, type WritableSignal } from '@angular/core';

/** Prefix of every key this app writes in localStorage. */
const KEY_PREFIX = 'chatterly.';

/** Every persisted signal by its key (without the prefix). */
const registry = new Map<string, WritableSignal<unknown>>();

/** A signal mirrored to localStorage. It must be called in an injection context. */
export function persisted<T>(key: string, initial: T): WritableSignal<T> {
  const storageKey = KEY_PREFIX + key;
  let value = initial;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw !== null) {
      value = JSON.parse(raw) as T;
    }
  } catch {
    // Damaged or blocked storage: the default value is used.
  }
  const state = signal<T>(value);
  registry.set(key, state as WritableSignal<unknown>);
  effect(function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state()));
    } catch {
      // Storage full or disabled: the value simply is not kept.
    }
  });
  return state;
}

/** The values of the persisted signals whose key is accepted by `wanted`. */
export function snapshotPersisted(wanted: (key: string) => boolean): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, state] of registry) {
    if (wanted(key)) {
      values[key] = state();
    }
  }
  return values;
}

/** The kind of a value: text, number, yes/no, list, object or nothing (a value of another kind than the one it replaces is not accepted). */
function kindOf(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'list' : typeof value;
}

/**
 * Gives values to the persisted signals. Only keys that exist are used, and only values of the same kind as the one they
 * replace (a damaged or foreign copy cannot put a list where a number is expected).
 */
export function applyPersisted(values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    const state = registry.get(key);
    if (state && kindOf(state()) === kindOf(value)) {
      state.set(value);
    }
  }
}
