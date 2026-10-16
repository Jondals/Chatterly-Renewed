/**
 * src/app/core/services/screen-picker.service.ts
 * The menu to choose what to share (desktop app only): when the person starts sharing, the desktop shell sends the screens and the
 * windows it can capture, with a small picture of each, and this service holds that question until the person chooses a source
 * or closes the menu. The menu itself is drawn by ScreenPickerComponent, inside the app.
 */
import { Injectable, computed, signal } from '@angular/core';
import {
  desktopBridge,
  type DesktopScreen,
  type ScreenPickItem,
  type ScreenPickRequest,
} from '../desktop-bridge';

/** The question of the shell: what can be shared, and what to show first. */
@Injectable({ providedIn: 'root' })
export class ScreenPickerService {
  private readonly bridge: DesktopScreen | undefined = desktopBridge()?.screen;

  /** The question waiting for an answer (null when the menu is closed). */
  readonly request = signal<ScreenPickRequest | null>(null);
  /** The tab on show: screens or windows. */
  readonly tab = signal<'screen' | 'window'>('screen');
  /** The box to share the sound of the computer. */
  readonly audio = signal(false);

  /** The sources of the tab on show. */
  readonly shown = computed(this.readShown.bind(this));
  /** True when there are both screens and windows to choose from (only then the tabs are needed). */
  readonly bothKinds = computed(this.readBothKinds.bind(this));

  constructor() {
    if (this.bridge) {
      this.bridge.onPick(this.onRequest.bind(this));
    }
  }

  /** Shares a source. */
  choose(item: ScreenPickItem): void {
    const audio = this.audio();
    this.request.set(null);
    this.bridge?.choose(item.id, audio).catch(this.ignore);
  }

  /** True when the shell can read the list again (the button "Refresh"). */
  readonly canRefresh = Boolean(this.bridge?.refresh);
  /** A new reading of the list was asked: it keeps the tab and the box as they are. */
  private refreshing = false;

  /**
   * Reads the screens and windows again. Windows does not offer a minimized window (it cannot be captured), so a person who
   * misses one restores it and presses this.
   */
  refresh(): void {
    if (!this.request() || !this.bridge?.refresh) return;
    this.refreshing = true;
    this.bridge.refresh().catch(this.ignore);
  }

  /** Closes the menu without sharing. */
  cancel(): void {
    if (this.request()) {
      this.request.set(null);
      this.bridge?.cancel().catch(this.ignore);
    }
  }

  private onRequest(request: ScreenPickRequest): void {
    if (this.refreshing && this.request()) {
      this.refreshing = false;
      this.request.set(request);
      return;
    }
    this.refreshing = false;
    const kinds = new Set(request.items.map(this.kindOf));
    this.tab.set(kinds.size === 1 ? [...kinds][0]! : request.kind);
    this.audio.set(request.audio);
    this.request.set(request);
  }

  private kindOf(item: ScreenPickItem): 'screen' | 'window' {
    return item.type;
  }

  private readShown(): ScreenPickItem[] {
    const tab = this.tab();
    return (this.request()?.items ?? []).filter(function ofTab(item) {
      return item.type === tab;
    });
  }

  private readBothKinds(): boolean {
    const items = this.request()?.items ?? [];
    return (
      items.some(function isScreen(item) {
        return item.type === 'screen';
      }) &&
      items.some(function isWindow(item) {
        return item.type === 'window';
      })
    );
  }

  private ignore(): void {
    // The shell did not answer: the menu is already closed.
  }
}
