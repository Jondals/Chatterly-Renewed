/**
 * src/app/core/services/android-update.service.ts
 * Updates of the Android app: is there a newer version, download it and open the installer of Android. Outside the
 * Android app it does nothing (`supported` is false).
 *
 * * Release channel: the version comes from the Chatterly server (/api/health: the server always runs the stable release),
 *   so the app does not ask GitHub until the person downloads; the APK is the one of that GitHub release.
 * * Beta channel (testers and administrators): like the desktop app, the account gets a token from the server and the
 *   manifest beta-android.yml says which APK is the beta.
 * * Another channel can offer an OLDER version (back from a beta to the release, or a beta older than the release installed).
 *   Android never installs a lower version over a higher one, so that is a change in two steps the person does: the app
 *   keeps the checked APK in Downloads, opens the uninstaller of Android, and the person installs the file from Downloads.
 * ! The page only chooses what to ask for. The native plugin (UpdatePlugin.java) downloads only from those two places, and
 *   before opening the installer checks that the APK is this app, newer, and signed with the certificate of the installed
 *   app; Android checks the certificate again and the person confirms in the installer. Nothing is installed by itself.
 */
import { Injectable, inject, signal } from '@angular/core';
import { ANDROID_APP, API_BASE } from '../config';
import { updatePlugin, type UpdateTarget } from '../native-bridge';
import { isNewerVersion } from '../version-compare';
import { APP_LABEL } from '../../version';
import { ApiError, ApiService } from './api.service';
import { BetaService } from './beta.service';
import { persisted } from './persisted';
import { ToastService } from './toast.service';

/**
 * Where an update is: nothing found, being looked for, available, downloading, downloaded (ready to install), or failed.
 * 'older': the channel offers an older version than the installed one; 'saved': that version is in Downloads, waiting for the
 * person to uninstall the app and install it.
 */
export type AndroidUpdateStatus =
  | 'idle'
  | 'checking'
  | 'none'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'older'
  | 'saved'
  | 'error';

/** The GitHub releases of the project: the stable APK of a version is attached to its release. */
const RELEASES = 'https://github.com/Jondals/ChatterlyRenewed/releases/download/';

/**
 * Why a step failed, in words for the person: the first rule whose pattern matches the error (the message of the native plugin,
 * of the browser or the code of the server) gives the explanation. Each explanation is a key of the translations.
 */
const REASONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/already in progress/i, 'A download is already in progress: wait for it to finish.'],
  [
    /not newer than the installed/i,
    'That version is not newer than the one installed: Android never installs an older or equal version over it.',
  ],
  [
    /not signed by the author/i,
    'The file is not signed with the key of Chatterly, so it was refused: it could be a forged copy.',
  ],
  [/is another app|is not an app/i, 'The downloaded file is not Chatterly, so it was refused.'],
  [/damaged/i, 'The download arrived damaged (its fingerprint does not match). Try again.'],
  [
    /not available \(404\)|beta_manifest_404/i,
    'The file of that version is not on the server: it may not be published yet.',
  ],
  [
    /not available \(|beta_manifest_5\d\d/i,
    'The server could not give the file right now. Try again in a few minutes.',
  ],
  [
    /sent somewhere else|not a download of the app/i,
    'The update pointed to an address the app does not trust, so nothing was downloaded.',
  ],
  [/too big/i, 'The file is far bigger than an update of Chatterly, so it was refused.'],
  [
    /could not be kept|cannot be read|ENOSPC|space/i,
    'The phone could not save the file: check that there is free space.',
  ],
  [
    /Allow Chatterly to install apps/i,
    'Allow Chatterly to install apps, come back and press Install again.',
  ],
  [
    /needs Android 10/i,
    'Changing to an older version needs Android 10 or newer: uninstall Chatterly and install the APK from the release page by hand.',
  ],
  [
    /kept in Downloads/i,
    'The file could not be saved in Downloads: check that there is free space.',
  ],
  [/is the installed version/i, 'That is the version you already have.'],
  [
    /failed to fetch|network|unable to resolve|timed? ?out|connect|unreachable/i,
    'There is no connection with the server. Check the internet and try again.',
  ],
  [/^429$|too many/i, 'Too many tries in a short time: wait a minute and try again.'],
  [/^40[34]$/, 'Your account is not in the beta program any more: choose Release.'],
  [/^401$/, 'The session has expired: sign in again and retry.'],
  [/beta_manifest/i, 'The beta server answered something the app does not understand.'],
];

/** The name of an APK the server may point to. */
const APK_NAME = /^Chatterly-[0-9A-Za-z.-]{1,60}\.apk$/;

@Injectable({ providedIn: 'root' })
export class AndroidUpdateService {
  private readonly api = inject(ApiService);
  private readonly betaProgram = inject(BetaService);
  private readonly toast = inject(ToastService);

  /** True inside the Android app. */
  readonly supported = ANDROID_APP;
  /** The person chose the beta channel (it is only used while the account is a tester or an administrator). */
  readonly beta = persisted('updates.androidBeta', false);
  readonly status = signal<AndroidUpdateStatus>('idle');
  /** The version that was found (or downloaded). */
  readonly found = signal('');
  /** Why the last step failed, for the person. */
  readonly problem = signal('');
  /** When the last check ended (ms since 1970), or 0. */
  readonly lastCheck = signal(0);
  /** The name of the APK kept in Downloads (status 'saved'). */
  readonly savedName = signal('');
  private target: UpdateTarget | null = null;
  private autoChecked = false;

  /** The first time, a quiet check a few seconds after the app opens; a toast only if there is something new. */
  checkOnStart(): void {
    if (!this.supported || this.autoChecked) return;
    this.autoChecked = true;
    setTimeout(this.quietCheck.bind(this), 8000);
  }

  /** The check of the start: says nothing unless a new version exists. */
  private async quietCheck(): Promise<void> {
    await this.check();
    if (this.status() === 'available') {
      this.toast.info(
        'A new version of Chatterly is available',
        'Open Settings > Updates to download it.',
        '⬆️',
      );
    }
  }

  /** True when the beta channel is in use: chosen, and the account is still in the program. */
  private usingBeta(): boolean {
    return this.beta() && this.betaProgram.canUseBeta();
  }

  /** Looks for a newer version in the channel in use. */
  async check(): Promise<void> {
    if (
      !this.supported ||
      this.status() === 'checking' ||
      this.status() === 'downloading' ||
      this.status() === 'saved'
    )
      return;
    this.status.set('checking');
    this.problem.set('');
    this.target = null;
    try {
      const found = this.usingBeta() ? await this.findBeta() : await this.findRelease();
      if (found && isNewerVersion(found.version, APP_LABEL)) {
        this.target = found.target;
        this.found.set(found.version);
        this.status.set('available');
      } else if (found && found.version !== APP_LABEL) {
        // The channel offers an older version (Android never installs it over a newer one): the person may change to it in
        // two steps (see changeToOlder), or wait for a newer one.
        this.target = found.target;
        this.found.set(found.version);
        this.status.set('older');
      } else {
        this.status.set('none');
      }
    } catch (error) {
      this.fail(error, 'Could not look for updates');
    } finally {
      this.lastCheck.set(Date.now());
    }
  }

  /** The stable version the server runs, and the APK of that release in GitHub. */
  private async findRelease(): Promise<{ version: string; target: UpdateTarget } | null> {
    const health = await this.api.get<{ version?: string }>('/api/health');
    const version = health.version ?? '';
    if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) return null;
    return {
      version,
      target: { url: RELEASES + 'v' + version + '/Chatterly-' + version + '.apk' },
    };
  }

  /** The beta of the server: a token for the account, then the manifest beta-android.yml (version, file, SHA-256). */
  private async findBeta(): Promise<{ version: string; target: UpdateTarget } | null> {
    const feed = await this.api.get<{ token: string }>('/api/beta/feed');
    const response = await fetch(API_BASE + '/api/beta/dl/beta-android.yml', {
      headers: { authorization: 'Bearer ' + feed.token },
      credentials: 'omit',
      cache: 'no-store',
    });
    // No Android beta has been uploaded yet (the beta server answers 404 to everything it does not have).
    if (response.status === 404) {
      this.problem.set('No Android beta has been published yet.');
      return null;
    }
    if (!response.ok) throw new Error('beta_manifest_' + response.status);
    const text = (await response.text()).slice(0, 2000);
    const read = function field(name: string): string {
      return new RegExp('^' + name + ':\\s*(\\S+)\\s*$', 'm').exec(text)?.[1] ?? '';
    };
    const version = read('version');
    const file = read('path');
    const sha256 = read('sha256').toLowerCase();
    if (!APK_NAME.test(file) || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('beta_manifest');
    return {
      version,
      target: { url: API_BASE + '/api/beta/dl/' + file, token: feed.token, sha256 },
    };
  }

  /** Downloads the version that was found; the plugin checks it before keeping it. */
  async download(): Promise<void> {
    const plugin = updatePlugin();
    if (!plugin || !this.target || this.status() !== 'available') return;
    this.status.set('downloading');
    this.problem.set('');
    try {
      const done = await plugin.download(this.target);
      if (done.version) this.found.set(done.version);
      this.status.set('ready');
    } catch (error) {
      this.fail(error, 'The update could not be downloaded');
    }
  }

  /**
   * The first step to change to an older version: downloads it (checked: this app, signed by the same author) and keeps it in
   * the Downloads folder, where it stays after the app is uninstalled.
   */
  async changeToOlder(): Promise<void> {
    const plugin = updatePlugin();
    if (!plugin || !this.target || this.status() !== 'older') return;
    this.status.set('downloading');
    this.problem.set('');
    try {
      await plugin.download({ ...this.target, allowOlder: true });
      const kept = await plugin.keepInDownloads();
      this.savedName.set(kept.name);
      this.status.set('saved');
    } catch (error) {
      this.fail(error, 'The version could not be prepared');
    }
  }

  /** The second step: the dialog of Android that uninstalls the app (then the person installs the file from Downloads). */
  async uninstall(): Promise<void> {
    const plugin = updatePlugin();
    if (!plugin || this.status() !== 'saved') return;
    try {
      await plugin.uninstall();
    } catch (error) {
      this.fail(error, 'The uninstaller of Android could not be opened');
    }
  }

  /** Leaves the change to an older version (the file stays in Downloads; it can be deleted from there). */
  cancelChange(): void {
    if (this.status() === 'saved') this.status.set('older');
  }

  /** Opens the installer of Android (the first time Android asks to allow Chatterly to install apps). */
  async install(): Promise<void> {
    const plugin = updatePlugin();
    if (!plugin || this.status() !== 'ready') return;
    try {
      await plugin.install();
    } catch (error) {
      if ((error as { code?: string })?.code === 'permission') {
        this.problem.set('Allow Chatterly to install apps, come back and press Install again.');
        return;
      }
      this.fail(error, 'The installer could not be opened');
    }
  }

  /**
   * Marks the failure with the reason for the person: what happened, never just "it failed". An error the app does not know
   * keeps the general message and its own text, so it can still be reported.
   */
  private fail(error: unknown, message: string): void {
    console.warn(message, error);
    this.problem.set(explain(error, message));
    this.status.set('error');
  }
}

/** The explanation of an error (see REASONS), or the general message with the text of the error. */
function explain(error: unknown, message: string): string {
  const text =
    error instanceof ApiError
      ? String(error.status)
      : String((error as { message?: unknown } | null)?.message ?? error ?? '');
  for (const [pattern, reason] of REASONS) {
    if (pattern.test(text)) return reason;
  }
  return text ? message + ' (' + text.slice(0, 200) + ')' : message;
}
