/**
 * src/app/core/services/android-update.service.ts
 * Updates of the Android app: is there a newer version, download it and open the installer of Android. Outside the
 * Android app it does nothing (`supported` is false).
 *
 * * Release channel: the version comes from the Chatterly server (/api/health: the server always runs the stable release),
 *   so the app does not ask GitHub until the person downloads; the APK is the one of that GitHub release.
 * * Beta channel (testers and administrators): like the desktop app, the account gets a token from the server and the
 *   manifest beta-android.yml says which APK is the beta.
 * ! The page only chooses what to ask for. The native plugin (UpdatePlugin.java) downloads only from those two places, and
 *   before opening the installer checks that the APK is this app, newer, and signed with the certificate of the installed
 *   app; Android checks the certificate again and the person confirms in the installer. Nothing is installed by itself.
 */
import { Injectable, inject, signal } from '@angular/core';
import { ANDROID_APP, API_BASE } from '../config';
import { updatePlugin, type UpdateTarget } from '../native-bridge';
import { isNewerVersion } from '../version-compare';
import { APP_LABEL } from '../../version';
import { ApiService } from './api.service';
import { BetaService } from './beta.service';
import { persisted } from './persisted';
import { ToastService } from './toast.service';

/** Where an update is: nothing found, being looked for, available, downloading, downloaded (ready to install), or failed. */
export type AndroidUpdateStatus =
  'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';

/** The GitHub releases of the project: the stable APK of a version is attached to its release. */
const RELEASES = 'https://github.com/Jondals/ChatterlyRenewed/releases/download/';

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
    if (!this.supported || this.status() === 'checking' || this.status() === 'downloading') return;
    this.status.set('checking');
    this.problem.set('');
    this.target = null;
    try {
      const found = this.usingBeta() ? await this.findBeta() : await this.findRelease();
      if (found && isNewerVersion(found.version, APP_LABEL)) {
        this.target = found.target;
        this.found.set(found.version);
        this.status.set('available');
      } else {
        // Android never installs an older version over a newer one (a stable 2.33.0 is above every 2.33.0-bN): say so,
        // instead of a plain "up to date" that hides why the beta is not offered.
        if (found && found.version !== APP_LABEL && this.usingBeta()) {
          this.problem.set(
            'The latest beta is older than the installed version: Android only installs it after uninstalling Chatterly.',
          );
        }
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

  /** Marks the failure with a message for the person (the technical detail goes to the console only). */
  private fail(error: unknown, message: string): void {
    console.warn(message, error);
    this.problem.set(message);
    this.status.set('error');
  }
}
