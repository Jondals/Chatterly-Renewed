/**
 * src/app/shared/util/save-file.ts
 * Saves a file of a chat (already decrypted on this device) where the person keeps their files: the Downloads folder of the
 * phone in the Android app (its WebView cannot download a file made by the page), a normal download elsewhere.
 */
import { filesPlugin } from '../../core/native-bridge';

/** Common extensions by type, for a file whose name has none (a GIF from the picker is called "gif"). */
const EXTENSIONS: Record<string, string> = {
  'image/gif': '.gif',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
};

/** A file name without folders or characters that systems refuse, with an extension that matches its type. */
function safeFileName(name: string, mime: string): string {
  let clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'chatterly-file';
  const extension = EXTENSIONS[mime];
  if (extension && !clean.toLowerCase().endsWith(extension) && !/\.[a-z0-9]{2,5}$/i.test(clean)) {
    clean += extension;
  }
  return clean.slice(-120);
}

/** Reads a blob as base64 (without the "data:...;base64," part). */
function toBase64(blob: Blob): Promise<string> {
  return new Promise<string>(function read(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function done(): void {
      const text = String(reader.result ?? '');
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.onerror = function failed(): void {
      reject(reader.error ?? new Error('read failed'));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves the file behind a blob address. Answers 'downloads' when the Android app put it in the Downloads folder, and
 * 'browser' when the browser (or the desktop app) took the download.
 */
export async function saveFile(
  url: string,
  name: string,
  mime: string,
): Promise<'downloads' | 'browser'> {
  const fileName = safeFileName(name, mime);
  const plugin = filesPlugin();
  if (plugin) {
    const blob = await (await fetch(url)).blob();
    await plugin.save({ name: fileName, mime, data: await toBase64(blob) });
    return 'downloads';
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  return 'browser';
}
