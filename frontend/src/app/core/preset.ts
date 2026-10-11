/**
 * src/app/core/preset.ts
 * Presets: the look of the app (theme) or of the profile, saved with a name, applied in one press and shared in a chat.
 *
 * The things a preset keeps are the settings that make the look, plus the custom pieces that go with them (a wallpaper, the
 * fonts that were uploaded, the pictures of a profile). A shared preset is one file: a small JSON header and, after it, the
 * bytes of those pieces one after the other (no base64: a wallpaper is not made 33% bigger to travel).
 *
 * * What comes from another person is never trusted: only the settings that belong to a preset are read, every value is
 * checked (short, no markup, no styles) and every piece is limited in size before anything is applied.
 */

/** The two kinds of preset. */
export type PresetKind = 'theme' | 'profile';

/** The settings a theme preset keeps (the keys of the persisted settings). */
export const THEME_KEYS: string[] = [
  'pref.theme',
  'pref.accent',
  'pref.customAccent',
  'pref.cornerStep',
  'pref.font',
  'pref.fontSize',
  'pref.animations',
  'pref.bgBlur',
  'pref.bgShuffleMinutes',
  'pref.chatStyle',
  'pref.bubbleStyle',
  'pref.bubbleOwn',
  'pref.bubbleOwnTo',
  'pref.bubbleOwnGrad',
  'pref.bubbleOther',
  'pref.background',
  'pref.bgShuffleMode',
  'pref.bgSolidColor',
  'pref.customTheme',
  'pref.customThemeParts',
  'pref.bgMotion',
  'pref.bgVisibility',
  'pref.cursor',
  'pref.cursorAnimated',
  'pref.cursorTrail',
  'pref.cursorTrailSize',
  'pref.cursorColor',
  'pref.cursorTrailLength',
  'pref.cursorSize',
  'pref.customCursors',
  'pref.customFontName',
  'pref.wallpaper',
];

/** The fields of the profile a profile preset keeps (never the name or the account: those are the person's own). */
export const PROFILE_FIELDS = [
  'pronouns',
  'statusText',
  'bio',
  'nameFont',
  'nameFx',
  'profileColor',
  'bannerColor',
  'aura',
  'auraColor',
] as const;

/** The pieces that can travel with a preset, each one a file. */
export type AssetName = 'wallpaper' | 'fontUi' | 'fontName' | 'avatar' | 'banner' | 'thumb';

/** The most each piece may weigh (bytes). */
export const ASSET_LIMITS: Record<AssetName, number> = {
  wallpaper: 12 * 1024 * 1024,
  fontUi: 5 * 1024 * 1024,
  fontName: 5 * 1024 * 1024,
  avatar: 2 * 1024 * 1024,
  banner: 4 * 1024 * 1024,
  thumb: 256 * 1024,
};
/** The most a shared preset may weigh in all (the server takes 12 MB a file). */
export const SHARE_LIMIT = 11 * 1024 * 1024;
/** The pieces each kind may carry. */
const ASSETS_OF: Record<PresetKind, AssetName[]> = {
  theme: ['wallpaper', 'fontUi', 'thumb'],
  profile: ['fontName', 'avatar', 'banner', 'thumb'],
};

/** A preset kept on this device. */
export interface Preset {
  id: string;
  kind: PresetKind;
  name: string;
  createdAt: number;
  /** The settings (theme) or the fields of the profile (profile). */
  data: Record<string, unknown>;
  /** The custom pieces. */
  assets: Partial<Record<AssetName, Blob>>;
}

/** The size of the picture of a preset, and of the small copy that travels in a message. */
export const THUMB_SIZE = { width: 256, height: 160 };
export const THUMB_SMALL = { width: 160, height: 100 };

/** The longest name of a preset. */
export const PRESET_NAME_MAX = 30;
/** The mime type of a shared preset. */
export const PRESET_MIME = 'application/x-chatterly-preset';

/** Keeps a name short and free of line breaks. */
export function cleanName(name: unknown): string {
  return typeof name === 'string'
    ? name
        .replace(/[\u0000-\u001f]/g, ' ')
        .trim()
        .slice(0, PRESET_NAME_MAX)
    : '';
}

/** A short text that is safe to put in a style or a label (no markup, no quotes, no braces). */
const SAFE_TEXT = /^[^<>{}"'`\\;]*$/;

/**
 * Cleans a value that came from another person: texts are short and without markup, lists and objects are small and shallow,
 * pictures (`data`) are only pictures. Returns undefined for what is not accepted.
 */
function cleanValue(value: unknown, key: string, depth: number): unknown {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(-1e6, Math.min(1e6, value)) : undefined;
  }
  if (typeof value === 'string') {
    if (key === 'data') {
      return value.length <= 300_000 &&
        /^data:image\/(png|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]*$/.test(
          value,
        )
        ? value
        : undefined;
    }
    return value.length <= 300 && SAFE_TEXT.test(value) ? value : undefined;
  }
  if (depth >= 3) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value.slice(0, 80)) {
      const clean = cleanValue(item, key, depth + 1);
      if (clean !== undefined) {
        items.push(clean);
      }
    }
    return items;
  }
  if (value && typeof value === 'object') {
    const object: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value).slice(0, 24)) {
      if (!/^[A-Za-z0-9_]{1,24}$/.test(name)) {
        continue;
      }
      const clean = cleanValue(item, name, depth + 1);
      if (clean !== undefined) {
        object[name] = clean;
      }
    }
    return object;
  }
  return undefined;
}

/** The settings of a theme that came from outside: only the ones a theme has, each one checked. */
export function cleanThemeData(raw: unknown): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') {
    return data;
  }
  for (const key of THEME_KEYS) {
    const clean = cleanValue((raw as Record<string, unknown>)[key], key, 0);
    if (clean !== undefined) {
      data[key] = clean;
    }
  }
  return data;
}

/** The fields of a profile that came from outside, each one checked (the server checks them again when they are saved). */
export function cleanProfileData(raw: unknown): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') {
    return data;
  }
  const limits: Record<string, number> = { pronouns: 32, statusText: 80, bio: 1000 };
  for (const field of PROFILE_FIELDS) {
    const value = (raw as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.length <= (limits[field] ?? 120)) {
      data[field] = value.replace(/\u0000/g, '');
    }
  }
  return data;
}

/** Whether a name is one of the pieces a kind may carry. */
function allowedAsset(kind: PresetKind, name: string): name is AssetName {
  return (ASSETS_OF[kind] as string[]).includes(name);
}

/** The magic text at the start of a shared preset. */
const MAGIC = 'CHPRESET1';

/** Turns a preset into the file that is shared (the pieces that do not fit are left out, said by `left`). */
export async function packPreset(preset: Preset): Promise<{ file: Blob; left: AssetName[] }> {
  const header: {
    v: 1;
    kind: PresetKind;
    name: string;
    data: Record<string, unknown>;
    assets: { name: AssetName; type: string; size: number }[];
  } = { v: 1, kind: preset.kind, name: preset.name, data: preset.data, assets: [] };
  const parts: BlobPart[] = [];
  const left: AssetName[] = [];
  let budget = SHARE_LIMIT - 64 * 1024;
  // the smallest pieces first, so as many as possible fit
  const names = (Object.keys(preset.assets) as AssetName[]).sort(function bySize(a, b) {
    return (preset.assets[a]?.size ?? 0) - (preset.assets[b]?.size ?? 0);
  });
  for (const name of names) {
    const blob = preset.assets[name];
    if (!blob) {
      continue;
    }
    if (blob.size > budget) {
      left.push(name);
      continue;
    }
    budget -= blob.size;
    header.assets.push({ name, type: blob.type, size: blob.size });
    parts.push(blob);
  }
  const head = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, head.length);
  return {
    file: new Blob([MAGIC, length, head, ...parts], { type: PRESET_MIME }),
    left,
  };
}

/** Reads a shared preset. Returns null when the file is not a preset (or is damaged, too big, or of an unknown version). */
export async function unpackPreset(file: Blob): Promise<Preset | null> {
  try {
    if (file.size > SHARE_LIMIT + 1024 || file.size < MAGIC.length + 6) {
      return null;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) {
      return null;
    }
    const headLength = new DataView(bytes.buffer, MAGIC.length, 4).getUint32(0);
    const start = MAGIC.length + 4;
    if (headLength > 400_000 || start + headLength > bytes.length) {
      return null;
    }
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + headLength)));
    if (header?.v !== 1 || (header.kind !== 'theme' && header.kind !== 'profile')) {
      return null;
    }
    const kind = header.kind as PresetKind;
    const name = cleanName(header.name) || (kind === 'theme' ? 'Theme' : 'Profile');
    const assets: Partial<Record<AssetName, Blob>> = {};
    let at = start + headLength;
    for (const piece of Array.isArray(header.assets) ? header.assets.slice(0, 6) : []) {
      const size = Number(piece?.size);
      if (!Number.isInteger(size) || size < 0 || at + size > bytes.length) {
        return null;
      }
      if (allowedAsset(kind, String(piece.name)) && size <= ASSET_LIMITS[piece.name as AssetName]) {
        const type = String(piece.type ?? '');
        assets[piece.name as AssetName] = new Blob([bytes.slice(at, at + size)], {
          type: /^[a-z]+\/[a-z0-9.+-]{1,40}$/i.test(type) ? type : '',
        });
      }
      at += size;
    }
    return {
      id: crypto.randomUUID(),
      kind,
      name,
      createdAt: Date.now(),
      data: kind === 'theme' ? cleanThemeData(header.data) : cleanProfileData(header.data),
      assets,
    };
  } catch {
    return null;
  }
}
