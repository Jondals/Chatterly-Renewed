/**
 * test/e2e/14-end-to-end-encrypted-call-with-video.mjs
 * End-to-end encrypted call with video.
 */
import { shot, step, check } from './support.mjs';

/** End-to-end encrypted call with video. */
export async function step14(world) {
  const { a, b } = world;
  step('end-to-end encrypted call with video');
  const directChat = a.url();
  await a.click('[data-tip="Voice call"]');
  await a.waitForURL('**/voice');
  await b.waitForSelector('text=Incoming encrypted call', { timeout: 10000 });
  await b.click('button[aria-label=Accept]');
  await b.waitForURL('**/voice');
  await a.waitForSelector('button[data-tip="End-to-end encrypted"]', {
    timeout: 40000,
  });
  await b.waitForSelector('button[data-tip="End-to-end encrypted"]', {
    timeout: 40000,
  });
  await a.waitForTimeout(4500);
  await shot(a, '02-llamada-a');
  await shot(b, '03-llamada-b');
  // The arrows with the devices, and the menu of a person (volume, next to the cursor, closes with a press elsewhere).
  check(
    (await a.locator('app-device-menu').count()) === 3,
    'the microphone, the speakers and the camera have an arrow with their devices',
  );
  await a.locator('app-device-menu button').first().click();
  await a.waitForSelector('app-device-menu [role=menu]', { timeout: 5000 });
  check(
    await a.locator('app-device-menu [role=menu]').first().isVisible(),
    'the arrow of the microphone opens the list of devices',
  );
  await a.keyboard.press('Escape');
  await a.waitForTimeout(300);
  check(
    (await a.locator('app-device-menu [role=menu]').count()) === 0,
    'Escape closes the list of devices',
  );
  const bobTile = a.locator('.stage-host').getByText('bob', { exact: true }).first();
  const bobBox = await bobTile.boundingBox();
  await bobTile.click({ button: 'right' });
  await a.waitForSelector('app-person-menu input[type=range]');
  const menuBox = await a.locator('app-person-menu').boundingBox();
  check(
    Math.abs(menuBox.x - (bobBox.x + bobBox.width / 2)) < 280 &&
      Math.abs(menuBox.y - (bobBox.y + bobBox.height / 2)) < 280,
    'the menu of a person opens next to the cursor',
  );
  await a.locator('app-person-menu input[type=range]').fill('150');
  // (the preferences are saved by an effect, a moment after the change)
  await a
    .waitForFunction(
      function () {
        return Object.values(
          JSON.parse(localStorage.getItem('chatterly.pref.peerVolumes') ?? '{}'),
        ).includes(150);
      },
      null,
      { timeout: 3000 },
    )
    .catch(function () {
      return undefined;
    });
  const volumes = await a.evaluate(function () {
    return JSON.parse(localStorage.getItem('chatterly.pref.peerVolumes') ?? '{}');
  });
  check(
    Object.values(volumes).includes(150),
    'the volume of a person can be raised (150 %) and is kept',
  );
  await a.mouse.click(4, 4);
  await a.waitForTimeout(300);
  check(
    (await a.locator('app-person-menu').count()) === 0,
    'a press anywhere else closes the menu of a person',
  );
  await a.click('button[data-tip="End-to-end encrypted"]');
  await b.click('button[data-tip="End-to-end encrypted"]');
  await a.waitForSelector('text=Verify this call');
  const codeOf = async function (p) {
    return (await p.locator('[role=dialog] .font-mono.tracking-widest').first().innerText()).trim();
  };
  const [codeA, codeB] = [await codeOf(a), await codeOf(b)];
  check(!!codeA && codeA === codeB, `identical security codes on both sides (${codeA})`);
  const stats = await a.locator('text=Sent, encrypted').first().innerText();
  const sent = Number(/encrypted: (\d+)/.exec(stats)?.[1] ?? 0);
  const received = Number(/decrypted: (\d+)/.exec(stats)?.[1] ?? 0);
  check(
    sent >= 20 && received >= 20,
    `encrypted frames flowing (sent ${sent}, decrypted ${received})`,
  );
  check(!/rejected: [1-9]/.test(stats), 'no frame rejected');
  await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  // The activities of a call (listening, watching, Spinly) start from one menu and become tiles of the stage.
  await a.click('[data-tip="Activities"]');
  await a.waitForSelector('.menu-card:has-text("Spinly")');
  check(
    (await a.locator('.menu-card:has-text("Listen together")').count()) === 1 &&
      (await a.locator('.menu-card:has-text("Watch together")').count()) === 1 &&
      (await a.locator('.menu-card:has-text("Spinly")').count()) === 1,
    'the Activities menu offers listening, watching and Spinly',
  );
  await a.click('.menu-card:has-text("Listen together") button >> nth=0');
  await a.fill('form.act-form input', 'https://example.com/nope');
  // The form says at once that this is not a link it accepts (not only after pressing the button).
  await a.waitForSelector('form.act-form >> text=That is not a valid YouTube or Spotify link.', {
    timeout: 3000,
  });
  check(true, 'the link form says at once that the link is not valid');
  await a.click('button:has-text("Play for everyone")');
  await a.waitForSelector('text=That is not a valid YouTube or Spotify link.');
  await a.fill('form.act-form input', 'https://youtu.be/dQw4w9WgXcQ');
  await a.waitForSelector('form.act-form >> text=YouTube video, ready', { timeout: 3000 });
  check(true, 'a good link is recognized as it is typed');
  await shot(a, '14a-listen-form');
  await a.click('button:has-text("Play for everyone")');
  await b.waitForSelector('text=Listening together', { timeout: 15000 });
  check(
    (await b.locator('iframe[title="Music"]').count()) === 1,
    'the shared music reaches Bob encrypted and plays in a small player',
  );
  check(
    (await b.locator('.music-card').count()) === 1 &&
      (await b.locator('.call-tile iframe').count()) === 0,
    'music is only sound: a small player, not a tile of the stage',
  );
  // The card of the music can be made small and big again (its body folds away and comes back).
  const bodyHeight = function () {
    return b.locator('.music-card .mc-inner').evaluate(function (e) {
      return e.getBoundingClientRect().height;
    });
  };
  await b.waitForFunction(
    function () {
      const inner = document.querySelector('.music-card .mc-inner');
      return !!inner && inner.getBoundingClientRect().height > 20;
    },
    null,
    { timeout: 5000 },
  );
  check(true, 'the card of the music shows its controls');
  await shot(b, '11a-musica-juntos');
  await b.click('.music-card button[aria-label="Minimize"]');
  await b.waitForTimeout(700);
  check((await bodyHeight()) < 2, 'the card of the music can be minimized');
  await b.click('.music-card button[aria-label="Expand"]');
  await b.waitForTimeout(700);
  check((await bodyHeight()) > 20, 'and made big again');
  // Anybody can queue a song, and a vote of everybody skips to the next one.
  await a.click('.music-card button[aria-label="Queue"]');
  await a.fill('.music-card form input', 'https://youtu.be/jNQXAC9IVRw');
  await a.click('.music-card form button[type=submit]');
  await b.waitForSelector('.music-card button[aria-label="Queue"]:has-text("1")', {
    timeout: 15000,
  });
  check(true, 'a song queued by Alice shows up in the queue of Bob');
  // a press anywhere else closes the queue
  await a.mouse.click(5, 5);
  await a.waitForTimeout(500);
  check((await a.locator('[data-queue]').count()) === 0, 'a press anywhere else closes the queue');
  await a.click('.music-card button[aria-label="Vote to skip"]');
  await b.click('.music-card button[aria-label="Vote to skip"]');
  await b.waitForSelector('.music-card button[aria-label="Queue"]:has-text("0")', {
    timeout: 15000,
  });
  check(true, 'when everybody votes to skip, the next song of the queue starts');
  await a.click('[data-tip="Activities"]');
  await a.click('.menu-card:has-text("Watch together") button >> nth=0');
  await a.fill('form.act-form input', 'https://youtu.be/dQw4w9WgXcQ');
  await a.click('button:has-text("Play for everyone")');
  await b.waitForSelector('text=Watching together', { timeout: 15000 });
  await b.waitForTimeout(600);
  check(
    (await b.locator('iframe[title="Video"]').count()) === 1 &&
      (await b.locator('iframe[title="Music"]').count()) === 0,
    'a video replaces the music instead of playing on top of it',
  );
  await shot(b, '11c-ver-juntos');
  // The bar of the call controls the video (needs the network: the player reports its length only when it plays).
  await b.waitForSelector('.timeline input[type=range]:not([disabled])', {
    timeout: 25000,
  });
  check(true, 'the timeline of the video is enabled once the player reports its length');
  const videoFrom = Number(await b.locator('.timeline input[type=range]').inputValue());
  // a real drag of the thumb with the mouse (not a value written by the test)
  const bar = await b.locator('.timeline input[type=range]').boundingBox();
  await b.mouse.move(bar.x + 8, bar.y + bar.height / 2);
  await b.mouse.down();
  await b.mouse.move(bar.x + bar.width * 0.5, bar.y + bar.height / 2, {
    steps: 12,
  });
  await b.mouse.up();
  await b.waitForFunction(
    function (from) {
      return Number(document.querySelector('.timeline input[type=range]').value) >= from;
    },
    20,
    { timeout: 8000 },
  );
  // The player itself must have jumped (the bar follows what the player says: if the jump had not happened it would go back).
  await b.waitForTimeout(2500);
  check(
    videoFrom < 100 && Number(await b.locator('.timeline input[type=range]').inputValue()) >= 30,
    'the timeline moves the video',
  );
  await a.waitForFunction(
    function () {
      const bar = document.querySelector('.timeline input[type=range]');
      return !!bar && Number(bar.value) >= 20;
    },
    null,
    { timeout: 12000 },
  );
  check(true, 'and everybody else is taken to the same second');
  // Closing is personal; stopping from the Activities menu ends it for everybody.
  await b.click('button[aria-label="Close for me"]');
  await b.waitForSelector('text=Watching together', {
    state: 'detached',
    timeout: 15000,
  });
  check(
    (await a.locator('iframe[title="Video"]').count()) === 1,
    'closing the video only closes it for the person who pressed it',
  );
  await a.click('[data-tip="Activities"]');
  await a.click('.menu-card:has-text("Watch together") button:has-text("Stop")');
  await a.waitForSelector('iframe[title="Video"]', {
    state: 'detached',
    timeout: 15000,
  });
  await a.click('[data-tip="Activities"]');
  await a.click('.menu-card:has-text("Spinly") button >> nth=0');
  await a.waitForSelector('[role=dialog][aria-label="Spinly"]');
  const callRows = a.locator('[role=dialog][aria-label="Spinly"] input[data-entry]');
  await callRows.nth(0).fill('Red');
  await callRows.nth(1).fill('Blue');
  await callRows.nth(2).fill('Green');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Start for everybody")');
  await b.waitForSelector('app-spinly-call-panel', { timeout: 15000 });
  await a.waitForSelector('app-spinly-call-panel', { timeout: 15000 });
  check(true, 'in the call, the wheel appears right in the call screen for everybody');
  await b.click('app-spinly-call-panel button:has-text("Spin the wheel")');
  await a.waitForSelector('app-spinly-call-panel:has-text("The wheel says")', {
    timeout: 15000,
  });
  await b.waitForSelector('app-spinly-call-panel:has-text("The wheel says")', {
    timeout: 15000,
  });
  const callWinnerA = (
    await a.locator('app-spinly-call-panel .text-xl').first().innerText()
  ).trim();
  const callWinnerB = (
    await b.locator('app-spinly-call-panel .text-xl').first().innerText()
  ).trim();
  check(
    callWinnerA === callWinnerB && ['Red', 'Blue', 'Green'].includes(callWinnerA),
    'Bob spins in the call and both see the same winner (' + callWinnerA + ')',
  );
  await shot(a, '11b-spinly-call');
  await a.waitForSelector('app-spinly-call-panel button:has-text("Spin again")');
  check(true, 'in the call the wheel can be spun again');
  await a.click('app-spinly-call-panel button:has-text("Spin again")');
  await b.waitForSelector('app-spinly-call-panel:has-text("Spinning…")', {
    timeout: 15000,
  });
  await b.waitForSelector('app-spinly-call-panel button:has-text("Spin again")', {
    timeout: 15000,
  });
  await a.click('app-spinly-call-panel button:has-text("Edit")');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Add option")');
  await a.locator('[role=dialog][aria-label="Spinly"] input[data-entry]').nth(2).fill('Green');
  await a.click('[role=dialog][aria-label="Spinly"] button:has-text("Apply for everybody")');
  await b.waitForFunction(function () {
    return document.querySelectorAll('app-spinly-call-panel svg text').length === 3;
  });
  check(true, 'editing the wheel in the call changes it for everybody');
  await a.click('app-spinly-call-panel button[aria-label=Close]');
  await a.waitForSelector('app-spinly-call-panel', { state: 'detached' });
  await b.waitForSelector('app-spinly-call-panel', {
    state: 'detached',
    timeout: 15000,
  });
  await a.click('[data-tip="Turn camera on"]');
  await a.waitForTimeout(3000);
  check(
    await b.evaluate(function () {
      return [...document.querySelectorAll('video')].some(function (v) {
        return v.readyState >= 2 && v.videoWidth > 0;
      });
    }),
    'Bob decrypts and shows the video of Alice',
  );
  // The camera is turned off and on again several times, quickly and slowly: every time the other person must see it move.
  const movingVideo = async function (page, label) {
    const ok = await page
      .waitForFunction(
        function () {
          return [...document.querySelectorAll('video')].some(function (v) {
            if (v.readyState < 2 || v.videoWidth === 0) return false;
            const now = v.currentTime;
            if (v.__last === undefined || v.__last === now) {
              v.__last = now;
              return false;
            }
            return true;
          });
        },
        null,
        { timeout: 9000, polling: 400 },
      )
      .then(
        function () {
          return true;
        },
        function () {
          return false;
        },
      );
    check(ok, label);
  };
  for (const pause of [1200, 150, 600, 150]) {
    await a.click('[data-tip="Turn camera off"]');
    await a.waitForTimeout(pause);
    await a.click('[data-tip="Turn camera on"]');
    await movingVideo(
      b,
      'Bob sees the camera of Alice move after turning it off and on (' + pause + ' ms)',
    );
  }
  // The background of the camera (like Discord): chosen from the arrow of the camera, applied at once to a camera that is
  // on, while the other person keeps seeing the video move. The pictures of the library are kept (encrypted) in the account.
  await a.locator('app-device-menu button').nth(2).click();
  await a.click('app-device-menu [role=menuitem]:has-text("Camera background")');
  await a.waitForSelector('[role=dialog]:has(.cs-layout) .cs-tile');
  const tile = function (name) {
    return '[role=dialog]:has(.cs-layout) .cs-tile:has(.cs-name:text-is("' + name + '"))';
  };
  const background = function () {
    return a.evaluate(function () {
      return localStorage.getItem('chatterly.pref.callBackground');
    });
  };
  await a.click(tile('Blur'));
  await a.waitForTimeout(600);
  check((await background()) === '"blur"', 'choosing a blur is kept as a setting');
  await movingVideo(b, 'Bob keeps seeing the camera of Alice move with the blur on');
  // the preview of the window shows the camera that the others get
  check(
    await a.evaluate(function () {
      const video = document.querySelector('[role=dialog]:has(.cs-layout) video');
      return !!video && video.videoWidth > 0;
    }),
    'the window of the camera has a live preview',
  );
  // the mirror reaches the others: it is part of the video that is sent
  await a.click('[role=dialog]:has(.cs-layout) .cs-row [role=switch]');
  await a.waitForTimeout(700);
  check(
    (await a.evaluate(function () {
      return localStorage.getItem('chatterly.pref.cameraMirrorAll');
    })) === 'true',
    'the mirror is turned on',
  );
  await movingVideo(b, 'Bob keeps seeing the camera of Alice move with the mirror on');
  await a.click('[role=dialog]:has(.cs-layout) .cs-row [role=switch]');
  await a.waitForTimeout(500);
  await a.click(tile('Aurora'));
  await a.waitForTimeout(600);
  check((await background()) === '"preset:aurora"', 'a ready-made background is chosen');
  await movingVideo(b, 'Bob keeps seeing the camera of Alice move with a ready-made background');
  await a.click('[role=dialog]:has(.cs-layout) [role=radio]:has-text("Your library")');
  await a.waitForTimeout(600);
  const backgroundChooser = a.waitForEvent('filechooser');
  await a.click('[role=dialog]:has(.cs-layout) .cs-add');
  await a.waitForSelector('.isrc-drop');
  await a.click('.isrc-drop');
  (await backgroundChooser).setFiles(world.pngPath);
  await a.waitForSelector('[role=dialog]:has(.cs-layout) .cs-remove', {
    state: 'attached',
    timeout: 20000,
  });
  check(
    ((await background()) ?? '').startsWith('"vault:'),
    'a picture added to the library is chosen at once',
  );
  await movingVideo(b, 'Bob keeps seeing the camera of Alice move with a picture of her library');
  await shot(a, '14b-camera-background');
  await a.click('[role=dialog]:has(.cs-layout) [role=radio]:has-text("Background")');
  await a.click(tile('None'));
  await a.keyboard.press('Escape');
  await a.waitForSelector('app-background-picker', { state: 'detached', timeout: 5000 });
  // Both cameras at the same time, turned off and on together (the two sides negotiate at once).
  const remoteMoving = function (page, label) {
    return page
      .waitForFunction(
        function () {
          return [...document.querySelectorAll('video')].some(function (v) {
            if (v.muted || v.readyState < 2 || v.videoWidth === 0) return false;
            const now = v.currentTime;
            const moved = v.__seen !== undefined && v.__seen !== now;
            v.__seen = now;
            return moved;
          });
        },
        null,
        { timeout: 9000, polling: 400 },
      )
      .then(
        function () {
          return check(true, label);
        },
        function () {
          return check(false, label);
        },
      );
  };
  await b.click('[data-tip="Turn camera on"]');
  await remoteMoving(a, 'Alice sees the camera of Bob');
  for (const pause of [900, 100, 400]) {
    await Promise.all([
      a.click('[data-tip="Turn camera off"]'),
      b.click('[data-tip="Turn camera off"]'),
    ]);
    await a.waitForTimeout(pause);
    await Promise.all([
      a.click('[data-tip="Turn camera on"]'),
      b.click('[data-tip="Turn camera on"]'),
    ]);
    await remoteMoving(
      a,
      'Alice sees Bob after both turned the camera off and on together (' + pause + ' ms)',
    );
    await remoteMoving(
      b,
      'Bob sees Alice after both turned the camera off and on together (' + pause + ' ms)',
    );
  }
  // The floating panel on another page: the camera of the other person fills its width (no bars), the whole block resizes from a
  // corner, and the delay of the call is a colored signal.
  await a.click('a[href="/direct"]');
  await a.waitForSelector('app-call-dock .dock-view video', { timeout: 15000 });
  await a.waitForTimeout(600);
  const dockPanel = await a.locator('app-call-dock .panel').boundingBox();
  const dockVideo = await a.locator('app-call-dock .dock-view video').boundingBox();
  check(
    !!dockPanel && !!dockVideo && Math.abs(dockPanel.width - dockVideo.width) <= 4,
    'the camera in the floating panel fills its whole width',
  );
  check(
    (await a.locator('app-call-dock .dock-view video').evaluate(function (v) {
      return getComputedStyle(v).objectFit;
    })) === 'cover',
    'the camera in the floating panel has no black bars (it covers its window)',
  );
  const ping = await a.locator('app-call-dock .dock-ping').innerText();
  check(
    /\d+ ms|— ms/.test(ping) &&
      ['good', 'ok', 'bad', 'none'].includes(
        await a.locator('app-call-dock .dock-ping').getAttribute('data-level'),
      ),
    'the delay of the call is a colored signal (' + ping.trim() + ')',
  );
  const handle = await a.locator('app-call-dock .dock-resize').boundingBox();
  await a.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await a.mouse.down();
  await a.mouse.move(handle.x + handle.width / 2 - 90, handle.y + handle.height / 2 + 60, {
    steps: 6,
  });
  await a.mouse.up();
  await a.waitForTimeout(200);
  const dockBigger = await a.locator('app-call-dock .panel').boundingBox();
  check(
    !!dockBigger &&
      dockBigger.width > dockPanel.width + 60 &&
      dockBigger.height > dockPanel.height + 40,
    'the whole floating block is resized from its corner (' +
      Math.round(dockPanel.width) +
      ' to ' +
      Math.round(dockBigger.width) +
      ')',
  );
  await shot(a, '11d-dock-camara');
  await a.click('app-call-dock a[aria-label="Back to the call"]');
  await a.waitForURL('**/voice');
  await b.click('[data-tip="Turn camera off"]');
  await a.click('button[aria-label="Hang up"]');
  await b.waitForTimeout(800);
  await b.click('button[aria-label="Hang up"]');

  step('a call whose frame encryption does not work is never shown as encrypted, and is closed');
  // ! Bob's browser is broken on purpose: the encryption of his outgoing frames is never attached (as on a browser
  // whose RTCRtpScriptTransform does nothing), so his audio would travel protected by DTLS-SRTP alone.
  await b.evaluate(function breakSenderEncryption() {
    const proto = RTCRtpSender.prototype;
    window.__chatterlySenderTransform = Object.getOwnPropertyDescriptor(proto, 'transform');
    Object.defineProperty(proto, 'transform', {
      configurable: true,
      get: function none() {
        return null;
      },
      set: function ignore() {
        return undefined;
      },
    });
  });
  await a.goto(directChat);
  await a.waitForSelector('[data-tip="Voice call"]');
  await a.click('[data-tip="Voice call"]');
  await b.waitForSelector('text=Incoming encrypted call', { timeout: 15000 });
  await b.click('button[aria-label=Accept]');
  const encryptedChip = 'button[data-tip="End-to-end encrypted"]';
  let shownAsEncrypted = false;
  const deadline = Date.now() + 45000;
  let closedA = false;
  let closedB = false;
  while (Date.now() < deadline && !(closedA && closedB)) {
    if ((await a.locator(encryptedChip).count()) || (await b.locator(encryptedChip).count())) {
      shownAsEncrypted = true;
    }
    closedA ||= (await a.locator('text=could not be confirmed').count()) > 0;
    closedB ||= (await b.locator('text=could not be confirmed').count()) > 0;
    await a.waitForTimeout(500);
  }
  check(!shownAsEncrypted, 'neither side ever shows the call as end-to-end encrypted');
  check(closedB, 'the side whose frames are not encrypted closes the connection and says why');
  check(closedA, 'the side that receives frames that do not authenticate closes it too');
  await shot(b, '11e-cifrado-no-confirmado');
  await b.evaluate(function restoreSenderEncryption() {
    Object.defineProperty(RTCRtpSender.prototype, 'transform', window.__chatterlySenderTransform);
  });
  for (const page of [a, b]) {
    const hangUp = page.locator('button[aria-label="Hang up"]');
    if (await hangUp.count()) await hangUp.first().click();
  }
  await b.waitForTimeout(800);
}
