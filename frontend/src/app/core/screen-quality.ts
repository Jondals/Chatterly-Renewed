/**
 * src/app/core/screen-quality.ts
 * The qualities of a shared screen: the height of the picture and the pictures per second, as one choice ("1080-60").
 * The phone offers up to 1080p; a computer goes up to 1440p (2K). A choice saved by an older version (standard, high, max)
 * still works: see `screenQuality`.
 */

/** One quality: how big the picture is and how many pictures per second. */
export interface ScreenQualityDef {
  id: ScreenQuality;
  width: number;
  height: number;
  fps: number;
  /** What the menu shows. */
  label: string;
  /** The highest bitrate sent for it (a busy screen must not fill the line: every frame is also encrypted). */
  bitrate: number;
}

export type ScreenQuality = '720-30' | '720-60' | '1080-30' | '1080-60' | '1440-30' | '1440-60';

/** What an older version saved, and what it meant. */
const LEGACY: Record<string, ScreenQuality> = {
  standard: '720-30',
  high: '1080-30',
  max: '1080-60',
};

const ALL: ScreenQualityDef[] = [
  { id: '720-30', width: 1280, height: 720, fps: 30, label: '720p · 30', bitrate: 2_500_000 },
  { id: '720-60', width: 1280, height: 720, fps: 60, label: '720p · 60', bitrate: 4_000_000 },
  { id: '1080-30', width: 1920, height: 1080, fps: 30, label: '1080p · 30', bitrate: 5_000_000 },
  { id: '1080-60', width: 1920, height: 1080, fps: 60, label: '1080p · 60', bitrate: 8_000_000 },
  { id: '1440-30', width: 2560, height: 1440, fps: 30, label: '2K · 30', bitrate: 8_000_000 },
  { id: '1440-60', width: 2560, height: 1440, fps: 60, label: '2K · 60', bitrate: 12_000_000 },
];

/** The qualities this device offers: the phone up to 1080p, a computer up to 2K. */
export function screenQualities(phone: boolean): ScreenQualityDef[] {
  return phone
    ? ALL.filter(function small(entry) {
        return entry.height <= 1080;
      })
    : ALL;
}

/** The quality a saved value means (an unknown value is 1080p at 30). */
export function screenQuality(saved: string | undefined, phone = false): ScreenQualityDef {
  const id = LEGACY[saved ?? ''] ?? saved;
  const found = ALL.find(function same(entry) {
    return entry.id === id;
  });
  const entry = found ?? ALL[2]!;
  return phone && entry.height > 1080 ? ALL[entry.fps === 60 ? 3 : 2]! : entry;
}
