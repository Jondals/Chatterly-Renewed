/**
 * src/app/core/gif-decode.ts
 * Reads the frames of an animated GIF on the main thread, for the browsers that have no ImageDecoder (Firefox): without it a
 * GIF used as the background of the camera would be a still picture. Only the GIF format is read (it is the one people use).
 */

/** One decoded frame: a picture the size of the whole GIF and how long it stays (milliseconds). */
export interface GifFrame {
  image: ImageData;
  delay: number;
}

/** The pieces of a frame before it is drawn. */
interface RawFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  interlaced: boolean;
  palette: Uint8Array;
  indices: Uint8Array;
  delay: number;
  transparent: number;
  disposal: number;
}

/** A reader of bytes. */
class Bytes {
  position = 0;
  constructor(readonly data: Uint8Array) {}
  byte(): number {
    return this.data[this.position++] ?? 0;
  }
  word(): number {
    return this.byte() | (this.byte() << 8);
  }
  skipBlocks(): void {
    for (let size = this.byte(); size > 0; size = this.byte()) {
      this.position += size;
    }
  }
  blocks(): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let size = this.byte(); size > 0; size = this.byte()) {
      parts.push(this.data.subarray(this.position, this.position + size));
      this.position += size;
      total += size;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/** Unpacks the LZW data of a frame into one palette index per pixel. */
function lzw(minimum: number, packed: Uint8Array, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  const clear = 1 << minimum;
  const end = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let size = minimum + 1;
  let mask = (1 << size) - 1;
  let next = clear + 2;
  let previous = -1;
  let first = 0;
  let bits = 0;
  let value = 0;
  let at = 0;
  let written = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (written < pixels && at < packed.length + 2) {
    while (bits < size && at < packed.length) {
      value |= packed[at++]! << bits;
      bits += 8;
    }
    if (bits < size) break;
    let code = value & mask;
    value >>= size;
    bits -= size;
    if (code === clear) {
      size = minimum + 1;
      mask = (1 << size) - 1;
      next = clear + 2;
      previous = -1;
      continue;
    }
    if (code === end) break;
    if (previous === -1) {
      out[written++] = suffix[code]!;
      previous = code;
      first = code;
      continue;
    }
    const incoming = code;
    let top = 0;
    if (code >= next) {
      stack[top++] = first;
      code = previous;
    }
    while (code >= clear) {
      stack[top++] = suffix[code]!;
      code = prefix[code]!;
    }
    first = suffix[code]!;
    stack[top++] = first;
    if (next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next++;
      if ((next & mask) === 0 && next < 4096) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    previous = incoming;
    while (top > 0 && written < pixels) out[written++] = stack[--top]!;
  }
  return out;
}

/** Reads every frame of a GIF, or null when the bytes are not a GIF. */
export function decodeGif(
  data: Uint8Array,
  maxFrames: number,
): { width: number; height: number; frames: GifFrame[] } | null {
  const reader = new Bytes(data);
  const signature = String.fromCharCode(...data.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  reader.position = 6;
  const width = reader.word();
  const height = reader.word();
  const flags = reader.byte();
  reader.position += 2;
  let globalPalette: Uint8Array = new Uint8Array(0);
  if (flags & 0x80) {
    const length = 3 * (1 << ((flags & 7) + 1));
    globalPalette = data.subarray(reader.position, reader.position + length);
    reader.position += length;
  }
  if (width === 0 || height === 0) return null;
  const raws: RawFrame[] = [];
  let delay = 100;
  let transparent = -1;
  let disposal = 0;
  while (reader.position < data.length && raws.length < maxFrames) {
    const block = reader.byte();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = reader.byte();
      if (label === 0xf9) {
        reader.byte();
        const packed = reader.byte();
        delay = Math.max(20, reader.word() * 10);
        const index = reader.byte();
        disposal = (packed >> 2) & 7;
        transparent = packed & 1 ? index : -1;
        reader.byte();
      } else {
        reader.skipBlocks();
      }
    } else if (block === 0x2c) {
      const left = reader.word();
      const top = reader.word();
      const w = reader.word();
      const h = reader.word();
      const local = reader.byte();
      let palette: Uint8Array = globalPalette;
      if (local & 0x80) {
        const length = 3 * (1 << ((local & 7) + 1));
        palette = data.subarray(reader.position, reader.position + length);
        reader.position += length;
      }
      const minimum = reader.byte();
      const packed = reader.blocks();
      raws.push({
        left,
        top,
        width: w,
        height: h,
        interlaced: (local & 0x40) !== 0,
        palette,
        indices: lzw(minimum, packed, w * h),
        delay,
        transparent,
        disposal,
      });
      delay = 100;
      transparent = -1;
      disposal = 0;
    } else {
      break;
    }
  }
  return { width, height, frames: compose(raws, width, height) };
}

/** Draws every frame over the previous one, following what each one says about how to leave its place. */
function compose(raws: RawFrame[], width: number, height: number): GifFrame[] {
  const frames: GifFrame[] = [];
  let canvas = new Uint8ClampedArray(width * height * 4);
  let before: Uint8ClampedArray<ArrayBuffer> | null = null;
  for (const raw of raws) {
    if (raw.disposal === 3) before = canvas.slice();
    const rows = rowOrder(raw.height, raw.interlaced);
    for (let y = 0; y < raw.height; y++) {
      const targetY = raw.top + rows[y]!;
      if (targetY >= height) continue;
      for (let x = 0; x < raw.width; x++) {
        const targetX = raw.left + x;
        if (targetX >= width) continue;
        const index = raw.indices[y * raw.width + x]!;
        if (index === raw.transparent) continue;
        const to = (targetY * width + targetX) * 4;
        canvas[to] = raw.palette[index * 3]!;
        canvas[to + 1] = raw.palette[index * 3 + 1]!;
        canvas[to + 2] = raw.palette[index * 3 + 2]!;
        canvas[to + 3] = 255;
      }
    }
    frames.push({ image: new ImageData(canvas.slice(), width, height), delay: raw.delay });
    if (raw.disposal === 2) {
      for (let y = raw.top; y < Math.min(height, raw.top + raw.height); y++) {
        const from = (y * width + raw.left) * 4;
        canvas.fill(0, from, from + Math.min(raw.width, width - raw.left) * 4);
      }
    } else if (raw.disposal === 3 && before) {
      canvas = before;
    }
  }
  return frames;
}

/** The row of the picture that each stored row of a frame belongs to (the rows of an interlaced frame come in four passes). */
function rowOrder(height: number, interlaced: boolean): number[] {
  const order: number[] = [];
  if (!interlaced) {
    for (let y = 0; y < height; y++) order.push(y);
    return order;
  }
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const) {
    for (let y = start; y < height; y += step) order.push(y);
  }
  return order;
}
