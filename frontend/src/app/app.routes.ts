/**
 * src/app/app.routes.ts
 * Routes of the application: the sign-in frame (login and register), the private area and the redirects.
 * The settings are a secondary route ("settings" outlet) that opens on top of whatever screen is showing.
 */
import type { Route, Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { authGuard, guestOnlyGuard, webOnlyGuard } from './core/guards/auth-guard';
import { AuthShellComponent } from './features/auth/auth-shell.component';
import { LoginComponent } from './features/auth/login.component';
import { RegisterComponent } from './features/auth/register.component';

/**
 * A route for a screen that has a path with optional parts (`groups`, `groups/:guildId`, `groups/:guildId/:channelId`).
 * ? It is ONE route, not one per shape of the address: with several routes, going from `groups/a` to `groups/a/b` (which the
 * screen does to put the channel in the address) destroyed the screen and built it again, and the page jumped.
 */
function optionalParams(
  prefix: string,
  names: string[],
  loadComponent: NonNullable<Route['loadComponent']>,
): Route {
  return {
    matcher: function match(segments: UrlSegment[]): UrlMatchResult | null {
      if (segments[0]?.path !== prefix || segments.length > names.length + 1) {
        return null;
      }
      const posParams: Record<string, UrlSegment> = {};
      names.forEach(function take(name, index) {
        const segment = segments[index + 1];
        if (segment) {
          posParams[name] = segment;
        }
      });
      return { consumed: segments, posParams };
    },
    loadComponent,
  };
}

/** Loads the shell of the private area (side bars and the page that changes). */
function loadMainLayout() {
  return import('./layout/main-layout.component').then(function pick(module) {
    return module.MainLayoutComponent;
  });
}

/** Loads the screen with friends and direct messages. */
function loadDirectHub() {
  return import('./features/direct/direct-hub.component').then(function pick(module) {
    return module.DirectHubComponent;
  });
}

/** Loads the screen of a group and its channels. */
function loadGroupView() {
  return import('./features/guild/group-view.component').then(function pick(module) {
    return module.GroupViewComponent;
  });
}

/** Loads the screen of a voice call. */
function loadVoiceStage() {
  return import('./features/voice/voice-route.component').then(function pick(module) {
    return module.VoiceRouteComponent;
  });
}

/** Loads the first page of the web. */
function loadLanding() {
  return import('./features/auth/landing.component').then(function pick(module) {
    return module.LandingComponent;
  });
}

/** Loads the settings window. */
function loadSettings() {
  return import('./features/settings/settings.component').then(function pick(module) {
    return module.SettingsComponent;
  });
}

export const routes: Routes = [
  {
    // The first page of the web: what Chatterly is, the download that fits the device and the way into the app (also for who is
    // signed in: it wears their theme and has the button to open the app). Only at the root address, and only in a browser
    // (the apps skip it and the root address goes to the sign-in or to the chat, below).
    path: '',
    pathMatch: 'full',
    canMatch: [webOnlyGuard],
    loadComponent: loadLanding,
  },
  {
    path: '',
    canMatch: [guestOnlyGuard],
    component: AuthShellComponent,
    children: [
      // ? Signed out, the root address goes to the sign-in page (otherwise the frame would stay empty).
      { path: '', pathMatch: 'full', redirectTo: 'login' },
      { path: 'login', component: LoginComponent },
      { path: 'register', component: RegisterComponent },
    ],
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: loadMainLayout,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'direct' },
      optionalParams('direct', ['channelId'], loadDirectHub),
      optionalParams('groups', ['guildId', 'channelId'], loadGroupView),
      { path: 'voice', loadComponent: loadVoiceStage },
      // The settings open in a secondary outlet, on top of the current screen (which is not unloaded).
      { path: 'settings', outlet: 'settings', pathMatch: 'full', redirectTo: 'settings/profile' },
      { path: 'settings/:section', outlet: 'settings', loadComponent: loadSettings },
      { path: 'profile', redirectTo: 'direct' },
      { path: 'guilds', redirectTo: 'groups' },
    ],
  },
  { path: 'login', redirectTo: 'direct' },
  { path: 'register', redirectTo: 'direct' },
  { path: '**', redirectTo: 'login' },
];
