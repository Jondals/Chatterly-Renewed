/**
 * src/app/shared/util/gif-encoder.ts
 * Writes an animated GIF from frames that are already cut and scaled (RGBA pixels), so a picture that moves can be adjusted (moved and
 * zoomed) like a still one and keep moving. Browsers cannot encode an animation by themselves, hence this small encoder:
 * one palette of 256 colors for the whole animation (median cut over a sample of every frame), a cache from color to palette entry
 * and the LZW packing of the format. Nothing here leaves the device.
 */

/** One frame: its pixels (RGBA, width x height) and how long it stays on screen, in hundredths of a second. */
export interface GifFrame {
  data: Uint8ClampedArray;
  delay: number;
}

/** A group of colors in the median cut. */
interface Box {
  colors: number[];
}

/** The color channel (0 red, 1 green, 2 blue) with the widest range in a box, and that range. */
function widestChannel(box: Box, pixels: Uint8Array): { channel: number; range: number } {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const index of box.colors) {
    for (let c = 0; c < 3; c++) {
      const value = pixels[index * 3 + c]!;
      if (value < min[c]!) min[c] = value;
      if (value > max[c]!) max[c] = value;
    }
  }
  let channel = 0;
  let range = -1;
  for (let c = 0; c < 3; c++) {
    if (max[c]! - min[c]! > range) {
      range = max[c]! - min[c]!;
      channel = c;
    }
  }
  return { channel, range };
}

/** A palette of up to 256 colors for a sample of pixels (3 bytes each: r, g, b), by median cut. */
function buildPalette(sample: Uint8Array): Uint8Array {
  const count = sample.length / 3;
  const boxes: Box[] = [{ colors: Array.from({ length: count }, (_, i) => i) }];
  while (boxes.length < 256) {
    let best = -1;
    let bestRange = 0;
    let bestChannel = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i]!.colors.length < 2) continue;
      const { channel, range } = widestChannel(boxes[i]!, sample);
      const weight = range * Math.sqrt(boxes[i]!.colors.length);
      if (weight > bestRange) {
        bestRange = weight;
        best = i;
        bestChannel = channel;
      }
    }
    if (best < 0) break;
    const box = boxes[best]!;
    box.colors.sort((a, b) => sample[a * 3 + bestChannel]! - sample[b * 3 + bestChannel]!);
    const middle = box.colors.length >> 1;
    boxes.splice(best, 1, { colors: box.colors.slice(0, middle) }, { colors: box.colors.slice(middle) });
  }
  const palette = new Uint8Array(256 * 3);
  boxes.forEach((box, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const index of box.colors) {
      r += sample[index * 3]!;
      g += sample[index * 3 + 1]!;
      b += sample[index * 3 + 2]!;
    }
    const n = Math.max(1, box.colors.length);
    palette[i * 3] = Math.round(r / n);
    palette[i * 3 + 1] = Math.round(g / n);
    palette[i * 3 + 2] = Math.round(b / n);
  });
  return palette;
}

/** The pixels of every frame as indexes into the palette (each color is looked up once, by its 5-5-5 bits). */
function indexFrame(frame: GifFrame, palette: Uint8Array, cache: Int16Array): Uint8Array {
  const pixels = frame.data;
  const out = new Uint8Array(pixels.length / 4);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = pixels[p]!;
    const g = pixels[p + 1]!;
    const b = pixels[p + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let found = cache[key]!;
    if (found < 0) {
      let bestDistance = Infinity;
      found = 0;
      for (let e = 0; e < 256; e++) {
        const dr = palette[e * 3]! - r;
        const dg = palette[e * 3 + 1]! - g;
        const db = palette[e * 3 + 2]! - b;
        const distance = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          found = e;
        }
      }
      cache[key] = found;
    }
    out[i] = found;
  }
  return out;
}

/** The LZW packing of the format for 8-bit indexes (the clear code is 256, the end code 257). */
function lzw(indexes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  let size = 9;
  const put = (code: number): void => {
    buffer |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(buffer & 255);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  let table = new Map<number, number>();
  let next = 258;
  put(256);
  let prefix = indexes[0]!;
  for (let i = 1; i < indexes.length; i++) {
    const byte = indexes[i]!;
    const key = (prefix << 8) | byte;
    const known = table.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    put(prefix);
    if (next < 4096) {
      // The code size grows (after the code just written) when the entry to add needs one more bit.
      if (next >= 1 << size && size < 12) size++;
      table.set(key, next++);
    } else {
      put(256);
      table = new Map();
      next = 258;
      size = 9;
    }
    prefix = byte;
  }
  put(prefix);
  put(257);
  if (bits > 0) out.push(buffer & 255);
  return Uint8Array.from(out);
}

/** Splits bytes in the blocks of at most 255 that a GIF uses. */
function blocks(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let at = 0; at < bytes.length; at += 255) {
    const part = bytes.subarray(at, at + 255);
    out.push(part.length, ...part);
  }
  out.push(0);
  return out;
}

/** Encodes the frames (all of the same size) as an animated GIF that repeats forever. */
export function encodeGif(frames: GifFrame[], width: number, height: number): Blob {
  // The palette comes from a sample of every frame, so colors that appear later in the animation are there too.
  const perFrame = Math.max(200, Math.floor(40000 / frames.length));
  const sample = new Uint8Array(frames.length * perFrame * 3);
  let filled = 0;
  for (const frame of frames) {
    const pixels = frame.data.length / 4;
    const step = Math.max(1, Math.floor(pixels / perFrame));
    for (let i = 0, taken = 0; i < pixels && taken < perFrame; i += step, taken++) {
      sample[filled++] = frame.data[i * 4]!;
      sample[filled++] = frame.data[i * 4 + 1]!;
      sample[filled++] = frame.data[i * 4 + 2]!;
    }
  }
  const palette = buildPalette(sample.subarray(0, filled));
  const cache = new Int16Array(32768).fill(-1);

  const parts: number[][] = [];
  const header: number[] = [
    ...Array.from('GIF89a', (c) => c.charCodeAt(0)),
    width & 255,
    width >> 8,
    height & 255,
    height >> 8,
    0xf7, // a global palette of 256 colors
    0,
    0,
    ...palette,
    // The animation repeats forever.
    0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0,
  ];
  parts.push(header);
  const body: Uint8Array[] = [];
  for (const frame of frames) {
    const delay = Math.max(2, Math.min(frame.delay, 65535));
    const control = [0x21, 0xf9, 4, 0x04, delay & 255, delay >> 8, 0, 0];
    const descriptor = [0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0, 8];
    const packed = lzw(indexFrame(frame, palette, cache));
    body.push(Uint8Array.from([...control, ...descriptor, ...blocks(packed)]));
  }
  return new Blob([Uint8Array.from(parts[0]!), ...(body as BlobPart[]), Uint8Array.from([0x3b])], {
    type: 'image/gif',
  });
}
