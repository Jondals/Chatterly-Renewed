/**
 * src/app/core/crypto/guild-meta.ts
 * What a group is called (its name, the name of each channel, each tag with its color) is sealed with the key of the group, so
 * the server keeps only text it cannot read. A sealed text looks like `g1.<key version>.<iv>.<data>`.
 * ! Every text is bound to the group, to what it is and to the thing it names (the id of the channel or tag), so the server
 * cannot give the name of one channel to another, nor a name from another group.
 */
import { open, seal } from './pairwise';

/** What a sealed text names. */
export type MetaField = 'name' | 'channel' | 'tag';

const SEALED = /^g1\.(\d+)\.([A-Za-z0-9+/]{16})\.([A-Za-z0-9+/]+={0,2})$/;

/** Whether a text is a sealed one (the old groups kept their names in clear). */
export function isSealedText(text: string): boolean {
  return SEALED.test(text);
}

/** The version of the group key a sealed text was made with (0 when it is not sealed). */
export function sealedKeyVersion(text: string): number {
  const found = SEALED.exec(text);
  return found ? Number(found[1]) : 0;
}

/** The context a sealed text is bound to. */
function context(guildId: string, version: number, field: MetaField, id: string): string {
  return `group-meta|${guildId}|${version}|${field}|${id}`;
}

/** Seals a value (a text, or a tag) with the key of the group in a version. */
export async function sealMeta(
  key: CryptoKey,
  guildId: string,
  version: number,
  field: MetaField,
  id: string,
  value: unknown,
): Promise<string> {
  const sealed = await seal(key, value, context(guildId, version, field, id));
  return `g1.${version}.${sealed.iv}.${sealed.ciphertext}`;
}

/** Opens a sealed text; it fails when the key, the group or the thing it names are not the ones it was made for. */
export async function openMeta<T>(
  key: CryptoKey,
  guildId: string,
  field: MetaField,
  id: string,
  text: string,
): Promise<T> {
  const found = SEALED.exec(text);
  if (!found) {
    throw new Error('Not a sealed text');
  }
  return open<T>(
    key,
    { iv: found[2]!, ciphertext: found[3]! },
    context(guildId, Number(found[1]), field, id),
  );
}
