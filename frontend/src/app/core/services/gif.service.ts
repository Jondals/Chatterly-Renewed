/**
 * src/app/core/services/gif.service.ts
 * GIF search through this app's own backend: the browser never contacts the GIF provider directly.
 */
import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { SettingsService } from './settings.service';

/** One GIF found by a search. */
export interface GifResult {
  id: string;
  title: string;
  preview: string;
  url: string;
  width: number;
  height: number;
}

/** A page of search results and the token of the next page. */
export interface GifPage {
  results: GifResult[];
  next: string;
}

/** The most previews downloaded at the same time. */
const PREVIEWS_AT_ONCE = 4;

/** Guesses the image type from the end of its address. */
function mimeFromUrl(url: string): string {
  if (/\.webp(\?|$)/i.test(url)) {
    return 'image/webp';
  }
  if (/\.png(\?|$)/i.test(url)) {
    return 'image/png';
  }
  return /\.jpe?g(\?|$)/i.test(url) ? 'image/jpeg' : 'image/gif';
}

/** GIF search and download through the backend. */
@Injectable({ providedIn: 'root' })
export class GifService {
  private readonly api = inject(ApiService);
  private readonly settings = inject(SettingsService);
  /** Whether the server has a GIF provider key (null until asked). */
  readonly enabled = signal<boolean | null>(null);
  private readonly previews = new Map<string, Promise<string>>();

  /** Asks the server once whether GIF search is available. */
  async init(): Promise<void> {
    if (this.enabled() !== null) {
      return;
    }
    try {
      const status = await this.api.get<{ enabled: boolean }>('/api/gifs/status');
      this.enabled.set(status.enabled);
    } catch {
      this.enabled.set(false);
    }
  }

  /** Language and region sent to the provider, from the language of the app. */
  private locale(): string {
    const preference = this.settings.language();
    if (preference === 'auto') {
      return navigator.language.replace('-', '_');
    }
    return preference === 'es' ? 'es_ES' : 'en_US';
  }

  /** Searches GIFs. */
  search(query: string, position = ''): Promise<GifPage> {
    const params = new URLSearchParams({ q: query, locale: this.locale() });
    if (position) {
      params.set('pos', position);
    }
    return this.api.get<GifPage>('/api/gifs/search?' + params);
  }

  /** The featured (trending) GIFs. */
  featured(position = ''): Promise<GifPage> {
    const params = new URLSearchParams({ locale: this.locale() });
    if (position) {
      params.set('pos', position);
    }
    return this.api.get<GifPage>('/api/gifs/featured?' + params);
  }

  /** Downloads the bytes of a GIF file through the backend proxy. */
  private fetchBytes(url: string): Promise<ArrayBuffer> {
    return this.api.download('/api/gifs/media?u=' + encodeURIComponent(url));
  }

  /** Blob URL of a small preview (cached). Only a few are downloaded at the same time, the rest wait their turn. */
  preview(url: string): Promise<string> {
    let cached = this.previews.get(url);
    if (!cached) {
      cached = this.turn().then(this.downloadPreview.bind(this, url));
      cached.catch(this.previews.delete.bind(this.previews, url));
      this.previews.set(url, cached);
    }
    return cached;
  }

  /** How many previews are being downloaded now, and who waits. */
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  /** Resolves when there is room for one more download. */
  private turn(): Promise<void> {
    if (this.running < PREVIEWS_AT_ONCE) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>(this.waiting.push.bind(this.waiting));
  }

  /** Downloads one preview and gives its place to the next that waits. */
  private async downloadPreview(url: string): Promise<string> {
    try {
      return this.toBlobUrl(url, await this.fetchBytes(url));
    } finally {
      const next = this.waiting.shift();
      if (next) {
        next();
      } else {
        this.running--;
      }
    }
  }

  /** Turns downloaded bytes into a blob URL. */
  private toBlobUrl(url: string, bytes: ArrayBuffer): string {
    return URL.createObjectURL(new Blob([bytes], { type: mimeFromUrl(url) }));
  }

  /** Downloads a GIF as a blob (to send it as an encrypted attachment). */
  async download(url: string): Promise<Blob> {
    return new Blob([await this.fetchBytes(url)], { type: mimeFromUrl(url) });
  }
}
