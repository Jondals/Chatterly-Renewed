/**
 * test/e2e/04-mobile-no-horizontal-overflow.mjs
 * Mobile: no horizontal overflow.
 */
import { errors, shot, step, check } from './support.mjs';

/** Mobile: no horizontal overflow. */
export async function step04(world) {
  const { WEB, a, newUser } = world;
  step('mobile: no horizontal overflow');
  const m = await newUser('movil', { width: 390, height: 800 });
  await m.goto(WEB + '/register');
  await m.waitForSelector('input[name=username]');
  await shot(m, '01-movil');
  check(
    await m.evaluate(function () {
      return document.documentElement.scrollWidth <= window.innerWidth + 1;
    }),
    'the register screen fits in 390px',
  );
  await m.context().close();
  // Opening the root without a session shows the first page of the web: what Chatterly is, the download that fits this
  // device and the way into the web app (it used to leave an empty box).
  await a.goto(WEB + '/');
  await a.waitForSelector('app-landing h1', { timeout: 10000 });
  check(
    (await a.locator('app-landing button[aria-pressed]').count()) === 5,
    'the first page lets you choose among the five apps',
  );
  const download = a.locator('app-landing a.btn-primary[href*="/api/download/"]');
  check(
    ((await download.getAttribute('href')) ?? '').endsWith('/api/download/windows'),
    'the button on top downloads the app that fits this device (Windows here)',
  );
  // Nothing may move when another system is chosen (the note under the buttons only fades in).
  const place = function () {
    return a.evaluate(function () {
      const box = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
      };
      return ['app-landing a.btn-primary[href*="/api/download/"]', 'app-landing button[aria-pressed]'].map(box).join('|');
    });
  };
  await a.waitForTimeout(1500); // the page is whole (the first picture of the HTML has given way to the live one)
  const before = await place();
  await a.click('app-landing button[aria-pressed]:has-text("Android")');
  await a.waitForTimeout(400);
  const afterAndroid = await place();
  check(afterAndroid === before, 'choosing another system moves nothing on the page (' + before + ' -> ' + afterAndroid + ')');
  await a.click('app-landing button[aria-pressed]:has-text("iOS")');
  await a.waitForTimeout(400);
  check((await place()) === before, 'not even for the systems with a note (iOS)');
  await a.click('app-landing button[aria-pressed]:has-text("Android")');
  await a.waitForTimeout(300);
  check(
    ((await download.getAttribute('href')) ?? '').endsWith('/api/download/android') &&
      (await a.locator('app-landing button[aria-pressed="true"]').count()) === 1,
    'choosing another system below changes the button on top',
  );
  // It is detected from the browser: an iPhone gets the iPhone app first.
  const phone = await a.context().browser().newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(WEB + '/');
  await phonePage.waitForSelector('app-landing h1', { timeout: 10000 });
  check(
    ((await phonePage.locator('app-landing a.btn-primary[href*="/api/download/"]').getAttribute('href')) ?? '').endsWith('/api/download/ios'),
    'an iPhone is offered the iOS app',
  );
  check(
    await phonePage.evaluate(function fits() {
      return document.documentElement.scrollWidth <= window.innerWidth + 1;
    }),
    'the first page fits in 390px',
  );
  await phone.close();
  await a.click('app-landing button:has-text("Open in your browser"), app-landing button:has-text("Abrir en el navegador")');
  await a.waitForSelector('input[name=username]', { timeout: 10000 });
  check(
    new URL(a.url()).pathname === '/login',
    'from there the web app opens in the browser at the sign-in (' + a.url() + ')',
  );
  // The guest: a temporary account to try the app. It enters, sees the notice, and when it leaves nothing is left.
  const guest = await newUser('invitado', { width: 1280, height: 800 });
  let token = '';
  guest.on('request', function (request) {
    const bearer = request.headers()['authorization'];
    if (bearer) token = bearer.replace(/^Bearer /, '');
  });
  await guest.goto(WEB + '/');
  await guest.waitForSelector('app-landing h1', { timeout: 10000 });
  await guest.click('app-landing button:has-text("Try it as a guest"), app-landing button:has-text("Probar como invitado")');
  await guest.waitForSelector('app-guest-bar [role=status]', { timeout: 60000 }).catch(async function (error) {
    const alert = await guest.locator('app-landing [role=alert]').allTextContents();
    throw new Error('the guest did not get in: ' + guest.url() + ' ' + JSON.stringify(alert) + ' ' + error.message.slice(0, 80));
  });
  check(
    new URL(guest.url()).pathname.startsWith('/direct'),
    'a guest enters the app (' + guest.url() + ')',
  );
  await guest.click('app-guest-bar button:has-text("Leave"), app-guest-bar button:has-text("Salir")');
  await guest.waitForSelector('app-landing h1', { timeout: 15000 });
  check(token !== '', 'the guest made requests with a session');
  check(
    (await guest.evaluate(function left() {
      return localStorage.getItem('chatterly.session');
    })) === null,
    'a guest that leaves keeps nothing on the device',
  );
  const after = await guest.evaluate(async function ask(bearer) {
    const response = await fetch(window.CHATTERLY_API + '/api/me/guest/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + bearer } });
    return response.status;
  }, token);
  check(after === 401, 'the guest account is gone from the server (its token no longer works: ' + after + ')');
  // The probe above is a refused request on purpose: its line in the console is not an error of the app.
  for (let at = errors.length - 1; at >= 0; at--) {
    if (errors[at].startsWith('[invitado]') && errors[at].includes('/api/me/guest/leave')) errors.splice(at, 1);
  }
  await guest.context().close();
  await shot(a, '00-login', 1500);
}
