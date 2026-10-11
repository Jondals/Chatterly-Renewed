/**
 * src/app/core/preset-card.ts
 * The small picture that goes with a preset in a message: the one the person uploaded, made small, or (when there is none)
 * one drawn from the preset itself (a tiny chat with its colors, or a tiny profile card). It is a WebP data address of a few
 * kilobytes, so it travels inside the encrypted message.
 */
import type { Preset } from './preset';
import { THUMB_SMALL } from './preset';
import { ACCENTS, THEMES } from './theme-data';

/** The most characters a picture of a preset may have in a message (the receiver refuses more). */
export const THUMB_MAX_CHARS = 40_000;
/** What a picture of a preset in a message looks like (the receiver accepts only this). */
export const THUMB_PATTERN = /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/;

/** A text of the data of a preset. */
function text(preset: Preset, key: string): string {
  const value = preset.data[key];
  return typeof value === 'string' ? value : '';
}

/** A rounded rectangle. */
function pill(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, w, h, radius);
  context.fill();
}

/** The picture drawn from a theme: its background, a received bubble, an own bubble and the accent. */
function drawTheme(context: CanvasRenderingContext2D, preset: Preset, w: number, h: number): void {
  const theme = THEMES.find(function same(entry) {
    return entry.id === text(preset, 'pref.theme');
  });
  const custom = text(preset, 'pref.customTheme') || '#1b1530';
  const colors = theme ? theme.colors : [custom, custom, custom];
  const gradient = context.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.6, colors[1]);
  gradient.addColorStop(1, colors[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, w, h);
  const id = text(preset, 'pref.accent');
  const accent =
    id === 'custom'
      ? text(preset, 'pref.customAccent') || '#2ef2b0'
      : (ACCENTS.find(function same(entry) {
          return entry.id === id;
        })?.color ?? '#2ef2b0');
  const step = preset.data['pref.cornerStep'];
  const radius = [2, 6, 10, 14, 18, 22][
    typeof step === 'number' ? Math.min(5, Math.max(0, step)) : 3
  ]!;
  context.fillStyle = text(preset, 'pref.bubbleOther') || 'rgba(255,255,255,0.18)';
  pill(context, w * 0.07, h * 0.18, w * 0.5, h * 0.2, radius);
  context.fillStyle = text(preset, 'pref.bubbleOwn') || accent;
  pill(context, w * 0.4, h * 0.46, w * 0.53, h * 0.2, radius);
  context.fillStyle = accent;
  context.beginPath();
  context.arc(w * 0.9, h * 0.86, h * 0.07, 0, Math.PI * 2);
  context.fill();
}

/** The picture drawn from a profile: its banner color, a round picture and the name. */
function drawProfile(
  context: CanvasRenderingContext2D,
  preset: Preset,
  w: number,
  h: number,
): void {
  context.fillStyle = '#10131b';
  context.fillRect(0, 0, w, h);
  const banner = /#[0-9a-f]{6}/i.exec(text(preset, 'bannerColor'))?.[0];
  const gradient = context.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, banner ?? '#2ef2b0');
  gradient.addColorStop(1, banner ? banner : '#7c5cff');
  context.fillStyle = gradient;
  context.fillRect(0, 0, w, h * 0.42);
  context.fillStyle = '#4b5263';
  context.strokeStyle = '#10131b';
  context.lineWidth = h * 0.04;
  context.beginPath();
  context.arc(w * 0.2, h * 0.42, h * 0.17, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = /#[0-9a-f]{6}/i.exec(text(preset, 'profileColor'))?.[0] ?? '#e6e9f2';
  context.font = '700 ' + h * 0.13 + 'px system-ui, sans-serif';
  context.fillText(preset.name.slice(0, 18), w * 0.08, h * 0.82);
}

/** Draws a picture of the size and turns it into a WebP address. */
function toDataUrl(
  draw: (context: CanvasRenderingContext2D, w: number, h: number) => void,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SMALL.width;
  canvas.height = THUMB_SMALL.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return '';
  }
  draw(context, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', 0.8);
}

/** The picture of a preset for a message: the one of the person made small, or one drawn from the preset. */
export async function presetCardPicture(preset: Preset): Promise<string> {
  const own = preset.assets.thumb;
  let url = '';
  if (own) {
    try {
      const bitmap = await createImageBitmap(own);
      url = toDataUrl(function copy(context, w, h) {
        context.drawImage(bitmap, 0, 0, w, h);
      });
      bitmap.close();
    } catch {
      url = '';
    }
  }
  if (!url) {
    url = toDataUrl(function make(context, w, h) {
      (preset.kind === 'theme' ? drawTheme : drawProfile)(context, preset, w, h);
    });
  }
  return url.length <= THUMB_MAX_CHARS && THUMB_PATTERN.test(url) ? url : '';
}
