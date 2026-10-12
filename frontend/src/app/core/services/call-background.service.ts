/**
 * src/app/core/services/call-background.service.ts
 * What the person chose for their camera in a call (the background and the adjustments) and how that becomes the options of the
 * effects. The choices are settings, so they follow the account like the others; a picture of the library is opened (and
 * decrypted) only when it is used.
 */
import { Injectable, inject } from '@angular/core';
import { decodeBackground, type BackgroundSetting, type CameraFxOptions } from './camera-fx';
import { SettingsService } from './settings.service';
import { VaultService } from './vault.service';

/** A ready-made background drawn by the app (no file involved). */
export interface PresetBackground {
  id: string;
  name: string;
  stops: string[];
  angle: number;
}

/** The ready-made backgrounds. (The "Custom" one is the person's own colors, see `callBackgroundCustom`.) */
export const PRESET_BACKGROUNDS: PresetBackground[] = [
  { id: 'aurora', name: 'Aurora', stops: ['#0b1d2a', '#14606e', '#2af5b5'], angle: 135 },
  { id: 'sunset', name: 'Sunset', stops: ['#2b1055', '#c33764', '#ff9966'], angle: 160 },
  { id: 'ocean', name: 'Ocean', stops: ['#021b3a', '#0a5a9c', '#6dd5fa'], angle: 180 },
  { id: 'forest', name: 'Forest', stops: ['#08201a', '#1f6b4a', '#a8e063'], angle: 150 },
  { id: 'night', name: 'Night', stops: ['#05050f', '#171a3a', '#3b2f6b'], angle: 200 },
];

/** Turns the choices of the person into the options of the effects of the camera. */
@Injectable({ providedIn: 'root' })
export class CallBackgroundService {
  private readonly settings = inject(SettingsService);
  private readonly vault = inject(VaultService);
  /** The decoded picture of this session (an animation takes memory, so only the last one is kept). */
  private last: { id: string; setting: BackgroundSetting } | null = null;

  /** True when something other than the plain camera is chosen. */
  active(): boolean {
    const s = this.settings;
    return (
      s.callBackground() !== 'none' ||
      s.cameraMirror() ||
      s.cameraBrightness() !== 0 ||
      s.cameraContrast() !== 100 ||
      s.cameraSaturation() !== 100 ||
      s.cameraZoom() !== 100
    );
  }

  /** The options of the effects that match the settings. */
  async options(): Promise<CameraFxOptions> {
    const s = this.settings;
    let background: BackgroundSetting = { type: 'none' };
    try {
      background = await this.background();
    } catch {
      // The picture is not available: the camera goes without a background.
    }
    return {
      mirror: s.cameraMirror(),
      brightness: s.cameraBrightness() / 100,
      contrast: s.cameraContrast() / 100,
      saturation: s.cameraSaturation() / 100,
      zoom: s.cameraZoom() / 100,
      background,
    };
  }

  /** The background of the choice (none when the picture is not available). */
  private async background(): Promise<BackgroundSetting> {
    const choice = this.settings.callBackground();
    if (choice === 'blur' || choice === 'blur-light') {
      return { type: 'blur', amount: this.settings.callBackgroundBlur() };
    }
    if (choice === 'custom') {
      const custom = this.settings.callBackgroundCustom();
      return { type: 'gradient', stops: custom.stops, angle: custom.angle };
    }
    if (choice.startsWith('preset:')) {
      const preset = PRESET_BACKGROUNDS.find(function named(item) {
        return 'preset:' + item.id === choice;
      });
      return preset
        ? { type: 'gradient', stops: preset.stops, angle: preset.angle }
        : { type: 'none' };
    }
    if (choice.startsWith('vault:')) {
      return this.fromLibrary(choice.slice('vault:'.length));
    }
    return { type: 'none' };
  }

  /** Opens a picture or animation of the library and decodes it. */
  private async fromLibrary(id: string): Promise<BackgroundSetting> {
    if (this.last?.id === id) {
      return this.last.setting;
    }
    if (this.vault.items().length === 0) {
      await this.vault.refresh();
    }
    const item = this.vault.items().find(function mine(entry) {
      return entry.id === id;
    });
    if (!item) {
      return { type: 'none' };
    }
    const decoded = await decodeBackground(await this.vault.open(item));
    this.release();
    const setting: BackgroundSetting = { type: 'image', ...decoded };
    this.last = { id, setting };
    return setting;
  }

  /** Frees the memory of the last decoded picture. */
  private release(): void {
    if (this.last?.setting.type === 'image') {
      for (const frame of this.last.setting.frames) {
        frame.close();
      }
    }
    this.last = null;
  }
}
