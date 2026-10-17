/**
 * src/app/core/warm-app.ts
 * Starts downloading the screens that open right after signing in (the frame of the app and the first screen), as soon as
 * the person starts to fill the sign-in or the registration form. ! The other screens are asked for later (see
 * delayed-preload.ts), so the first page stays light: but these two must be there when the animation of arriving ends the
 * wait, or the page underneath loads while the animation plays and the lights stutter or never appear.
 */
let started = false;

export function warmApp(): void {
  if (started) return;
  started = true;
  void import('../layout/main-layout.component');
  void import('../features/direct/direct-hub.component');
}
