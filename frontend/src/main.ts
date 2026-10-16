/**
 * src/main.ts
 * Entry point of the frontend: starts the Angular application.
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { desktopBridge } from './app/core/desktop-bridge';
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
 * Marks weak devices (2 cores or fewer, 2 GB of memory or less, or "save data" on). With the automatic power mode (the
 * default) the page then does less of what is only decoration: no blur behind panels, still decorations, a lighter
 * camera. A phone is not weak for being a phone: it gets every animation, like the computer (the person can choose the
 * battery saver in Settings > Appearance).
 */
function markWeakDevice(): void {
  const info = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (
    (info.hardwareConcurrency ?? 8) <= 2 ||
    (info.deviceMemory ?? 8) <= 2 ||
    info.connection?.saveData === true
  ) {
    document.documentElement.dataset['weak'] = '1';
  }
  try {
    // Before the settings are read (the first paint), the light mode follows what the person chose last time.
    const mode = JSON.parse(localStorage.getItem('chatterly.pref.powerMode') ?? '"auto"');
    if (mode === 'saver' || (mode === 'auto' && document.documentElement.dataset['weak'] === '1')) {
      document.documentElement.dataset['perf'] = 'low';
    }
  } catch {
    // Storage blocked: the settings decide a moment later.
  }
}

/**
 * The desktop app (Windows) draws its own bar at the top of the window: the page learns its height before the first paint,
 * so nothing jumps when the bar appears. (In a browser or on a phone this does nothing.)
 */
function markDesktopBar(): void {
  const bar = desktopBridge()?.titlebar;
  if (bar) {
    document.documentElement.dataset['titlebar'] = 'custom';
    document.documentElement.style.setProperty('--titlebar-h', bar.height + 'px');
  }
}

markWeakDevice();
markDesktopBar();
startFlagSupport();
if (document.querySelector('app-root[data-snapshot]')) {
  // The picture of the sign-in page that came inside the HTML is painted first, and only then does the app start (and replace it).
  requestAnimationFrame(setTimeout.bind(window, start, 0));
} else {
  start();
}
