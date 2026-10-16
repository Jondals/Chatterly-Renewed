/**
 * src/app/core/web-tab.ts
 * Whether the page runs in a tab of a browser: not in one of the apps (desktop, Android, iPhone) and not in a web app that was
 * installed (a window of its own). Only a tab has the first page of the web and the way back to it.
 */
import { ANDROID_APP, IOS_APP } from './config';
import { isDesktopApp } from './desktop-bridge';

export function isWebTab(): boolean {
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  return !ANDROID_APP && !IOS_APP && !isDesktopApp() && !installed;
}
