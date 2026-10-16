/**
 * src/app/core/delayed-preload.ts
 * Route preloading strategy: the screens of the app are downloaded in the background, but only after the page
 * has had time to paint and become interactive. Someone who is already signed in gets them right away, since
 * they are about to need them; on the sign-in page they wait a few seconds so they do not compete with it.
 */
import { Injectable } from '@angular/core';
import type { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, switchMap, timer } from 'rxjs';

/** Milliseconds to wait before preloading when nobody is signed in. */
const SIGNED_OUT_DELAY = 12000;

/** Preloads every lazy route, later when nobody is signed in. */
@Injectable({ providedIn: 'root' })
export class DelayedPreloadStrategy implements PreloadingStrategy {
  /**
   * ? Returns the stream that loads a route: right away for a signed-in person, after a delay otherwise.
   * @param route The route being considered.
   * @param load Function that downloads the route.
   */
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (!route.loadComponent && !route.loadChildren) {
      return of(null);
    }
    const delay = this.hasSession() ? 0 : SIGNED_OUT_DELAY;
    return timer(delay).pipe(switchMap(load));
  }

  /** True when a session is stored in this browser. */
  private hasSession(): boolean {
    try {
      return localStorage.getItem('chatterly.session') !== null;
    } catch {
      return false;
    }
  }
}
