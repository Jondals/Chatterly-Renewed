/**
 * src/app/core/cursor-files.ts
 * Reads cursor files the person uploads: .cur / .ico (static), .ani (animated Windows cursors) and animated
 * images (GIF, WebP, APNG). Everything is turned into data the browser knows how to draw.
 */

/** One frame of an animated cursor. */
export interface CursorFrame {
  /** Image of the frame as a data URL. */
  data: string;
  /** How long the frame is shown, in milliseconds. */
  ms: number;
}

/** What was read from a cursor file. */
export interface ParsedCursor {
  /** 'cur' is used as a CSS cursor as it is; 'image' is a still picture; 'animated' is drawn by the page itself. */
  kind: 'cur' | 'image' | 'animated';
  data: string;
  frames?: CursorFrame[];
  /** Hot spot (where the cursor "points") in image pixels; only known for .cur and .ani files. */
  hot?: [number, number];
  /** Width and height of the first frame, to draw it at the right size. */
  width: number;
  height: number;
}

/** Biggest cursor file accepted (1 MB). */
const MAX_BYTES = 1024 * 1024;
/** Frames per second the Windows animated cursor format counts time in ("jiffies"). */
const JIFFIES_PER_SECOND = 60;

/** Encodes bytes as a base64 data URL. */
function toDataUrl(bytes: Uint8Array, mime: string): string {
  let text = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return 'data:' + mime + ';base64,' + btoa(text);
}

/** Reads `length` ASCII characters from a binary view. */
function readText(view: DataView, position: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(view.getUint8(position + index));
  }
  return text;
}

/** Header of a .cur / .ico file: its type (1 icon, 2 cursor), the size of the first image and its hot spot. */
function readIconHeader(
  bytes: Uint8Array,
): { type: number; width: number; height: number; hot: [number, number] } | null {
  if (bytes.length < 22) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0) {
    return null;
  }
  const type = view.getUint16(2, true);
  if ((type !== 1 && type !== 2) || view.getUint16(4, true) < 1) {
    return null;
  }
  const width = view.getUint8(6) || 256;
  const height = view.getUint8(7) || 256;
  return {
    type,
    width,
    height,
    hot: type === 2 ? [view.getUint16(10, true), view.getUint16(12, true)] : [0, 0],
  };
}

/** True when a GIF, WebP or APNG image has more than one frame. */
function isAnimatedImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/gif') {
    let frames = 0;
    for (let index = 0; index < bytes.length - 3; index++) {
      if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9 && bytes[index + 2] === 0x04) {
        frames++;
      }
      if (frames > 1) {
        return true;
      }
    }
    return false;
  }
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  if (mime === 'image/webp') {
    return text.includes('ANIM');
  }
  return mime === 'image/png' ? text.includes('acTL') : false;
}

/** Reads a .ani file into a list of frames with their timing. */
function readAni(bytes: Uint8Array): ParsedCursor | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || readText(view, 0, 4) !== 'RIFF' || readText(view, 8, 4) !== 'ACON') {
    return null;
  }
  let defaultJiffies = 6;
  let steps = 0;
  const rates: number[] = [];
  const sequence: number[] = [];
  const icons: Uint8Array[] = [];

  /** Walks the chunks between two positions, going into the "fram" lists. */
  function walk(start: number, end: number): void {
    let position = start;
    while (position + 8 <= end) {
      const id = readText(view, position, 4);
      const length = view.getUint32(position + 4, true);
      const data = position + 8;
      if (id === 'LIST') {
        if (readText(view, data, 4) === 'fram') {
          walk(data + 4, Math.min(end, data + length));
        }
      } else if (id === 'anih' && length >= 36) {
        steps = view.getUint32(data + 8, true);
        defaultJiffies = view.getUint32(data + 28, true) || 6;
      } else if (id === 'rate') {
        for (let offset = 0; offset + 4 <= length; offset += 4) {
          rates.push(view.getUint32(data + offset, true));
        }
      } else if (id === 'seq ') {
        for (let offset = 0; offset + 4 <= length; offset += 4) {
          sequence.push(view.getUint32(data + offset, true));
        }
      } else if (id === 'icon') {
        icons.push(bytes.slice(data, data + length));
      }
      position = data + length + (length % 2);
    }
  }

  walk(12, Math.min(bytes.length, 8 + view.getUint32(4, true)));
  if (icons.length === 0) {
    return null;
  }
  let order = sequence;
  if (order.length === 0) {
    order = [];
    for (let index = 0; index < icons.length; index++) {
      order.push(index);
    }
  }
  const frames: CursorFrame[] = [];
  for (let step = 0; step < Math.max(steps, order.length) && step < order.length; step++) {
    const icon = icons[order[step]];
    if (!icon) {
      continue;
    }
    const jiffies = rates[step] ?? defaultJiffies;
    frames.push({
      data: toDataUrl(icon, 'image/x-icon'),
      ms: Math.max(20, Math.round((jiffies * 1000) / JIFFIES_PER_SECOND)),
    });
  }
  const header = readIconHeader(icons[0]);
  if (frames.length === 0 || !header) {
    return null;
  }
  return {
    kind: 'animated',
    data: frames[0].data,
    frames,
    hot: header.hot,
    width: header.width,
    height: header.height,
  };
}

/** Guesses the type of an image file from its name when the browser does not say. */
function guessMime(name: string): string {
  if (name.endsWith('.gif')) {
    return 'image/gif';
  }
  return name.endsWith('.webp') ? 'image/webp' : 'image/png';
}

/** Reads a cursor file uploaded by the person. Throws an Error with a clear text when it cannot be used. */
export async function readCursorFile(file: File): Promise<ParsedCursor> {
  if (file.size > MAX_BYTES) {
    throw new Error('Cursor files can be up to 1 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith('.ani')) {
    const ani = readAni(bytes);
    if (!ani) {
      throw new Error('That .ani file could not be read.');
    }
    return ani;
  }
  if (name.endsWith('.cur') || name.endsWith('.ico')) {
    const header = readIconHeader(bytes);
    if (!header) {
      throw new Error('That cursor file could not be read.');
    }
    return {
      kind: 'cur',
      data: toDataUrl(bytes, 'image/x-icon'),
      hot: header.hot,
      width: header.width,
      height: header.height,
    };
  }
  const mime = file.type || guessMime(name);
  if (!/^image\/(png|gif|webp|jpeg|svg\+xml)$/.test(mime)) {
    throw new Error('That file type is not supported.');
  }
  if (isAnimatedImage(bytes, mime)) {
    return { kind: 'animated', data: toDataUrl(bytes, mime), width: 24, height: 24 };
  }
  return { kind: 'image', data: '', width: 24, height: 24 };
}
