/**
 * src/main.ts
 * Entry point of the frontend: starts the Angular application.
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { startFlagSupport } from './app/core/flag-support';

/** Reports a failure to start the application in the console. */
function reportStartError(error: unknown): void {
  console.error(error);
}

/** Starts the application. */
function start(): void {
  bootstrapApplication(AppComponent, appConfig).catch(reportStartError);
}

/**
 * Marks weak devices (a phone, 4 cores or fewer, 4 GB of memory or less, or "save data" on) so the page can do less of what is only
 * decoration: no blur behind panels, a lighter animation of arriving, no web fonts for emoji and names, and quick motion.
 */
function markWeakDevice(): void {
  const info = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  // a phone (a touch screen that is small) starts in light mode: its first seconds are the ones that must not stutter
  const phone = window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches;
  if (
    phone ||
    (info.hardwareConcurrency ?? 8) <= 4 ||
    (info.deviceMemory ?? 8) <= 4 ||
    info.connection?.saveData === true
  ) {
    document.documentElement.dataset['perf'] = 'low';
  }
}

markWeakDevice();
startFlagSupport();
if (document.querySelector('app-root[data-snapshot]')) {
  // The picture of the sign-in page that came inside the HTML is painted first, and only then does the app start (and replace it).
  requestAnimationFrame(setTimeout.bind(window, start, 0));
} else {
  start();
}
