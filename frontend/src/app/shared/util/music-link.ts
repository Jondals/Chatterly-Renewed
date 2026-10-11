/**
 * src/app/shared/util/music-link.ts
 * The music links accepted in calls ("listen together"): only YouTube and Spotify. A link is recognized and
 * reduced to an identifier checked against a strict pattern; the address of the player is always built from
 * that identifier, never from the text the person typed.
 */

/** A recognized music link. */
export interface MusicLink {
  kind: 'youtube' | 'spotify';
  /** Identifier of the video, track or list. */
  id: string;
  /** Spotify: track, album, playlist, episode, show or artist. YouTube: 'video' or 'list'. */
  type: string;
  /** YouTube: the playlist a video is played from, when the link names both. */
  list?: string;
}

const YOUTUBE_HOST = /^(www\.|m\.|music\.)?(youtube\.com|youtube-nocookie\.com)$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;
const YOUTUBE_LIST = /^[A-Za-z0-9_-]{10,64}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{10,30}$/;
const SPOTIFY_TYPES = ['track', 'album', 'playlist', 'episode', 'show', 'artist'];

/** Recognizes a YouTube or Spotify link; returns null for anything else (no other site is ever accepted). */
export function parseMusicLink(text: string): MusicLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    return YOUTUBE_ID.test(id) ? { kind: 'youtube', id, type: 'video' } : null;
  }
  if (YOUTUBE_HOST.test(host)) {
    return parseYoutube(url);
  }
  return host === 'open.spotify.com' ? parseSpotify(url) : null;
}

/** The origin of this page for the YouTube player (it refuses to play without knowing who shows it). */
function originOption(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return origin.startsWith('http') ? '&origin=' + encodeURIComponent(origin) : '';
}

/** Reads a YouTube address: watch?v=, list=, /shorts/, /embed/ and /live/ forms. */
function parseYoutube(url: URL): MusicLink | null {
  const list = url.searchParams.get('list');
  const video = url.searchParams.get('v');
  if (video && YOUTUBE_ID.test(video)) {
    const found: MusicLink = { kind: 'youtube', id: video, type: 'video' };
    if (list && YOUTUBE_LIST.test(list)) {
      found.list = list;
    }
    return found;
  }
  if (list && YOUTUBE_LIST.test(list)) {
    return { kind: 'youtube', id: list, type: 'list' };
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (['shorts', 'embed', 'live'].includes(parts[0] ?? '') && YOUTUBE_ID.test(parts[1] ?? '')) {
    return { kind: 'youtube', id: parts[1], type: 'video' };
  }
  return null;
}

/** Reads a Spotify address (an optional "intl-xx" language segment is ignored). */
function parseSpotify(url: URL): MusicLink | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const withoutLanguage = parts[0]?.startsWith('intl-') ? parts.slice(1) : parts;
  const [type, id] = withoutLanguage;
  if (SPOTIFY_TYPES.includes(type ?? '') && SPOTIFY_ID.test(id ?? '')) {
    return { kind: 'spotify', id, type };
  }
  return null;
}

/** Address of the embedded player; `start` is the second to start from (YouTube only). */
export function embedUrl(link: MusicLink, start = 0): string {
  if (link.kind === 'spotify') {
    return 'https://open.spotify.com/embed/' + link.type + '/' + link.id + '?theme=0';
  }
  const options =
    // controls=0: the bar of the call (play, time, timeline) is the only one; the one of YouTube hid itself in some browsers
    // on a Short and was a second set of buttons that did not tell the others in the call.
    'enablejsapi=1&autoplay=1&rel=0&modestbranding=1&playsinline=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0' +
    originOption() +
    (start > 1 && link.type !== 'list' ? '&start=' + Math.floor(start) : '');
  const base = 'https://www.youtube-nocookie.com/embed/';
  if (link.type === 'list') {
    return base + 'videoseries?list=' + link.id + '&' + options;
  }
  return base + link.id + '?' + (link.list ? 'list=' + link.list + '&' : '') + options;
}
