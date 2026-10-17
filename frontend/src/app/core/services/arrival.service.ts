/**
 * src/app/core/services/arrival.service.ts
 * The moments of arriving in the app: the introduction (every time the page loads), the transition after signing in, the
 * celebration after creating an account and the goodbye when signing out. This file only decides when they play and tells the caller when the
 * page underneath may change; the animations themselves live in a component that is loaded only when needed.
 */
import { Injectable, signal } from '@angular/core';
import { ANDROID_APP } from '../config';
import { isDesktopApp } from '../desktop-bridge';
import { preloadSounds } from '../sound-library';

/** Which animation plays. */
export type ArrivalKind = 'intro' | 'login' | 'register' | 'logout' | 'enter' | 'leave';
// ('enter' and 'leave' are the ones of the first page of the web: going into the app from it, and signing out or going back to it.
// They look different from 'login' and 'logout' on purpose: the person who signs in or out is shown those, and the first page
// must not repeat the same animation right after.)

/** The animation that is on screen and the name of the person it greets. */
export interface Arrival {
  kind: ArrivalKind;
  name: string;
}

/** The longest the caller waits for the animation to reach its reveal point (if the component fails to load). */
const GIVE_UP_MS = 4000;

/** The mark that says the introduction already played in this session of the browser. */
const INTRO_SEEN = 'chatterly.introSeen';
/** The setting "show the introduction when the app starts" (Settings > Appearance), read here before the settings exist. */
const INTRO_ON_START = 'chatterly.pref.introOnStart';

/** Plays the arrival animations and says when the page underneath can change. */
@Injectable({ providedIn: 'root' })
export class ArrivalService {
  /** The animation on screen, or null. */
  readonly current = signal<Arrival | null>(null);
  private waiting: (() => void) | null = null;
  private giveUp: ReturnType<typeof setTimeout> | undefined;

  /**
   * Whether animations are wanted: not for people who asked for no motion, and not for automatic browsers (tests,
   * audits), which would only be slowed down by them (unless `chatterly.motion` is set to look at them).
   */
  private wanted(): boolean {
    const automatic = navigator.webdriver && !localStorage.getItem('chatterly.motion');
    return (
      !automatic &&
      document.documentElement.dataset['motion'] !== 'reduced' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /** Starts an animation. The promise ends when the page underneath may change (the animation covers the change). */
  play(kind: ArrivalKind, name = ''): Promise<void> {
    if (!this.wanted()) {
      return Promise.resolve();
    }
    this.current.set({ kind, name });
    return new Promise<void>(this.keepResolver.bind(this));
  }

  /** Keeps the way to end the wait, and gives up after a while so nobody waits for ever. */
  private keepResolver(resolve: () => void): void {
    this.waiting = resolve;
    clearTimeout(this.giveUp);
    this.giveUp = setTimeout(this.reveal.bind(this), GIVE_UP_MS);
  }

  /** The animation reached the point where the page underneath can change. */
  reveal(): void {
    clearTimeout(this.giveUp);
    this.waiting?.();
    this.waiting = null;
  }

  /** The animation ended. */
  finish(): void {
    this.reveal();
    this.current.set(null);
  }

  /**
   * The introduction plays once each time the browser is opened (the first visit, a new window): not when the page is
   * reloaded, which keeps the mark of the session. Until it is on screen the page is covered by a dark layer that comes
   * inside the HTML, so the first thing seen is never the sign-in page.
   */
  maybeIntro(): void {
    let seen = false;
    try {
      seen = sessionStorage.getItem(INTRO_SEEN) === '1';
      sessionStorage.setItem(INTRO_SEEN, '1');
    } catch {
      /* no storage: the introduction plays, as it would the first time */
    }
    if (this.wanted() && !seen && this.onStart()) {
      if (isDesktopApp() || ANDROID_APP) {
        // The apps play the introduction with sound: start fetching it now, before the animation is on screen.
        void preloadSounds(['authIntro']);
      }
      void this.play('intro');
      setTimeout(this.dropCover, 6000);
    } else {
      this.dropCover();
    }
  }

  /** Whether the person wants the introduction when the app starts (on unless they turned it off). */
  private onStart(): boolean {
    try {
      return localStorage.getItem(INTRO_ON_START) !== 'false';
    } catch {
      return true;
    }
  }

  /** Plays the introduction again, because the person asked for it (in the settings). */
  replayIntro(): Promise<void> {
    return this.play('intro');
  }

  /** Removes the dark layer of the HTML (the animation took its place, or there will be none). */
  dropCover(): void {
    const cover = document.getElementById('boot-cover');
    if (cover) {
      cover.style.transition = 'opacity 0.4s';
      cover.style.opacity = '0';
      setTimeout(cover.remove.bind(cover), 450);
    }
  }
}
