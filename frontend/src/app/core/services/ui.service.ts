/**
 * src/app/core/services/ui.service.ts
 * Shared interface state: which side panels and windows are open, the last normal screen the person was on,
 * and the commands that open and close the settings on top of the current screen.
 */
import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';

/** Screens that are not remembered as "where the person was" (they are temporary or outside the app). */
const TEMPORARY_ROUTES = /^\/(voice|settings|login|register)(\/|\?|$)/;

/** Cross-component UI state (side panels, global windows) and navigation helpers. */
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly sidebarOpen = signal(false);
  readonly soundboardOpen = signal(false);
  /** The last page that was not the call (where "minimize the call" goes back to). */
  readonly lastPage = signal('/direct');
  /** Where the button that opened the soundboard is (it opens upward from there); null opens it as a window. */
  readonly soundboardAnchor = signal<DOMRect | null>(null);
  /** Person whose profile is shown in the profile window (null = closed). */
  readonly profileUserId = signal<string | null>(null);
  readonly createGuildOpen = signal(false);
  readonly guildSettingsOpen = signal(false);
  readonly inviteOpen = signal(false);
  readonly addChannelOpen = signal<'text' | 'voice' | null>(null);
  /** Last normal screen the person was on (a group, a chat...), to go back to it when a call ends. */
  lastRoute = '/direct';

  private readonly router = inject(Router);

  /** Starts remembering the last normal screen. */
  constructor() {
    this.router.events.subscribe(this.rememberRoute.bind(this));
  }

  /** True when the settings were opened without a section: a phone starts with the list of sections. */
  settingsList = false;

  /** Opens the settings on top of the current screen (which is neither changed nor unloaded). */
  openSettings(section?: string): void {
    // Without a section, a phone shows the list of sections first.
    this.settingsList = section === undefined;
    void this.router.navigate([{ outlets: { settings: ['settings', section ?? 'profile'] } }]);
  }

  /** Closes the settings: the screen that was underneath is visible again, exactly as it was. */
  closeSettings(): void {
    void this.router.navigate([{ outlets: { settings: null } }]);
  }

  /** Remembers the current route unless it is the call, the settings or the sign-in pages. */
  private rememberRoute(event: unknown): void {
    if (!(event instanceof NavigationEnd)) {
      return;
    }
    // * Only the main part of the address counts: what is in parentheses are windows on top (the settings).
    const url = event.urlAfterRedirects.split('(')[0];
    if (!TEMPORARY_ROUTES.test(url)) {
      this.lastRoute = url;
    }
  }
}
