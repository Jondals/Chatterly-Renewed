/**
 * src/app/shared/util/download-target.ts
 * The apps of Chatterly and which one fits the device that opens the web page: the landing page shows the right download
 * first. The link goes to the server of the page (GET /api/download/<app>), which sends the person to the file of the LATEST
 * published release (a file with the version in its name would not exist until its release is out).
 */
import { API_BASE } from '../../core/config';

/** Where the project lives, and its releases (for a device with no app). */
const REPOSITORY = 'https://github.com/Jondals/ChatterlyRenewed';
const RELEASES = REPOSITORY + '/releases';

/** The apps that exist. */
type AppId = 'windows' | 'mac' | 'linux' | 'android' | 'ios';

/** One app: what it is called, the file of the release and the icon of the landing page. */
export interface AppTarget {
  id: AppId;
  /** The device, for "Download for {device}". */
  label: string;
  icon: string;
  /** A short line under the button (what to know before installing), or ''. */
  note: string;
}

/** Every app, in the order the landing page lists them. */
export const APPS: readonly AppTarget[] = [
  { id: 'windows', label: 'Windows', icon: 'monitor', note: '' },
  { id: 'mac', label: 'macOS', icon: 'monitor', note: '' },
  { id: 'linux', label: 'Linux', icon: 'monitor', note: '' },
  {
    id: 'android',
    label: 'Android',
    icon: 'smartphone',
    note: 'Android asks you to allow installing from this browser.',
  },
  {
    id: 'ios',
    label: 'iOS',
    icon: 'smartphone',
    note: 'Not signed by Apple: install it with AltStore or Sideloadly.',
  },
];

/** The app that fits this device (null on a device that has none: a TV, a console, a robot). */
export function detectApp(): AppTarget | null {
  const agent = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  let id: AppId | null = null;
  if (/android/i.test(agent)) id = 'android';
  // iPadOS 13+ says it is a Mac: a Mac with a touch screen is an iPad.
  else if (/iphone|ipad|ipod/i.test(agent) || (/macintosh/i.test(agent) && touch)) id = 'ios';
  else if (/windows/i.test(agent)) id = 'windows';
  else if (/macintosh|mac os x/i.test(agent)) id = 'mac';
  else if (/linux|x11|cros/i.test(agent)) id = 'linux';
  return (
    APPS.find(function same(app) {
      return app.id === id;
    }) ?? null
  );
}

/** The download of an app: the server sends the person to the file of the latest release. */
export function downloadUrl(app: AppTarget): string {
  return API_BASE + '/api/download/' + app.id;
}

/** The repository of the project. */
export const REPOSITORY_URL = REPOSITORY;

/** The page of all the releases. */
export const RELEASES_URL = RELEASES;
