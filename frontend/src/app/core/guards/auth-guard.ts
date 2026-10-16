/**
 * src/app/core/guards/auth-guard.ts
 * Route guards: the private area is only for signed-in people, and the sign-in frame only for people who are
 * not signed in.
 */
import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { isWebTab } from '../web-tab';
import { AuthService } from '../services/auth.service';

/** Only signed-in people with an unlocked identity may enter the app; everybody else goes to the sign-in page. */
export const authGuard: CanMatchFn = function authGuard() {
  const auth = inject(AuthService);
  return auth.isAuthenticated() ? true : inject(Router).createUrlTree(['/login']);
};

/**
 * For the sign-in frame: it only matches when nobody is signed in. When somebody is, the route is simply
 * skipped without a redirect (which avoids redirect loops).
 */
export const guestOnlyGuard: CanMatchFn = function guestOnlyGuard() {
  return !inject(AuthService).isAuthenticated();
};

/** The landing page is for people in a browser: the apps (desktop, Android, iPhone) open straight into the sign-in. */
export const webOnlyGuard: CanMatchFn = function webOnlyGuard() {
  return isWebTab();
};
