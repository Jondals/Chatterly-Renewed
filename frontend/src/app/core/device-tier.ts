/**
 * src/app/core/device-tier.ts
 * Tells whether the device is a modest one, so the heavy parts of the app (the effects of the camera, the cutting of pictures) ask less of it.
 */
/**
 * Whether this device is a modest one (a phone, or little memory or few cores): the effects of the camera ask less of it, so a
 * middle or low range phone does not run out of memory or heat up until the page crashes.
 */
export function lowEndDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  const memory = nav.deviceMemory ?? 8;
  return phone || memory <= 4 || (nav.hardwareConcurrency ?? 8) <= 4;
}
