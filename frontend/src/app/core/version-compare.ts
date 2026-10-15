/**
 * src/app/core/version-compare.ts
 * Orders the versions of the app: "2.33.0" (a release) and "2.33.0-b3" (the third beta of it). A release is above all its
 * betas and below the betas of the next version. Pure functions, so the single test checks them without a browser.
 */

/** The parts of a version label as numbers to compare in order, or null when it is not a version of the app. */
export function versionParts(label: string): number[] | null {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-b(\d{1,3}))?$/.exec(label.trim());
  if (!match) return null;
  // ! A release counts as the highest beta number, so 2.33.0 > 2.33.0-b9 and 2.33.0 < 2.34.0-b1.
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ? Number(match[4]) : 1000];
}

/** True when `candidate` is a newer version than `current` (an unreadable label is never newer: no downgrade by mistake). */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const now = versionParts(current);
  if (!next || !now) return false;
  for (let i = 0; i < next.length; i++) {
    if (next[i]! !== now[i]!) return next[i]! > now[i]!;
  }
  return false;
}
