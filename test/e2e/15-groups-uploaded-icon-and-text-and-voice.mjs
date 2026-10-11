/**
 * test/e2e/15-groups-uploaded-icon-and-text-and-voice.mjs
 * Groups, uploaded icon, and text and voice channels.
 */
import { step, check, saveAdjusted } from './support.mjs';

/** Groups, uploaded icon, and text and voice channels. */
export async function step15(world) {
  const { WEB, a, b, pngPath } = world;
  step('groups, uploaded icon, and text and voice channels');
  await a.goto(WEB + '/groups');
  await a.click('text=Create your first group');
  await a.fill('input[placeholder="e.g. Game night"]', 'Rust Crew');
  const iconChooser = a.waitForEvent('filechooser');
  await a.click('button[aria-label="Upload an icon"]');
  (await iconChooser).setFiles(pngPath);
  await saveAdjusted(a);
  await a.waitForSelector('img[src^="blob:"]');
  await a.click('button:has-text("Create group")');
  await a.waitForSelector('a[data-tip="Rust Crew"] img[src^="blob:"]', {
    timeout: 20000,
  });
  check(true, 'the encrypted icon of the group is opened and shown');
  await a.waitForURL('**/groups/**/**', { timeout: 20000 });
  await a.waitForTimeout(800);
  await a.fill('textarea[aria-label=Message]', 'First message in the group');
  await a.keyboard.press('Enter');
  await a.waitForSelector('text=First message in the group', {
    timeout: 10000,
  });
  await a.click('[data-tip="Create text channel"]');
  await a.fill('input[placeholder="General chat"]', 'dev talk');
  await a.click('button:has-text("Create channel")');
  await a.waitForSelector('a:has-text("Dev talk")', { timeout: 10000 });
  await a.click('[data-tip="Create voice channel"]');
  await a.fill('input[placeholder="Lounge"]', 'Stage');
  await a.click('button:has-text("Create channel")');
  await a.waitForSelector('button:has-text("Stage")', { timeout: 10000 });
  await a.click('a:has-text("Dev talk")', { button: 'right' });
  await a.click('[role=menuitem]:has-text("Rename channel")');
  await a.fill('input[maxlength="32"]', 'ideas');
  await a.click('button:has-text("Save")');
  await a.waitForSelector('a:has-text("Ideas")', { timeout: 10000 });
  check(true, 'right click on a channel: rename');
  // order of the channels: they are born in order of arrival and the owner reorders them (menu and drag)
  const ordenCanales = async function () {
    return await a.$$eval('a.chan-text', function (els) {
      return els.map(function (e) {
        return (e.textContent || '').toLowerCase();
      });
    });
  };
  const ordenInicial = await ordenCanales();
  check(
    ordenInicial.length === 2 &&
      ordenInicial[0].includes('general') &&
      ordenInicial[1].includes('ideas'),
    'channels in order of arrival: ' + ordenInicial.join(' | '),
  );
  await a.click('a.chan-text:has-text("Ideas")', { button: 'right' });
  await a.click('[role=menuitem]:has-text("Move channel up")');
  await a.waitForFunction(
    function () {
      return (document.querySelector('a.chan-text')?.textContent || '')
        .toLowerCase()
        .includes('ideas');
    },
    null,
    { timeout: 8000 },
  );
  check(true, 'move a channel up from the menu');
  await a.dragAndDrop('a.chan-text:has-text("Ideas")', 'a.chan-text:has-text("General")');
  await a.waitForFunction(
    function () {
      return (document.querySelector('a.chan-text')?.textContent || '')
        .toLowerCase()
        .includes('general');
    },
    null,
    { timeout: 8000 },
  );
  check(true, 'drag a channel to change its order');
  check(true, 'group with its own icon and text and voice channels created');
  // what the group is called never reaches the server in clear: it is sealed with the key of the group
  let listing = '';
  await a.route('**/api/guilds', async function keepBody(route) {
    const reply = await route.fetch();
    if (route.request().method() === 'GET') {
      listing = await reply.text();
    }
    await route.fulfill({ response: reply });
  });
  await a.reload();
  await a.waitForSelector('a[data-tip="Rust Crew"]', { timeout: 20000 });
  await a.unroute('**/api/guilds');
  check(
    !/"name":"(?!g1\.)/.test(listing) &&
      !listing.includes('Rust Crew') &&
      listing.includes('"name":"g1.'),
    'the name of the group and of its channels travel sealed (the server cannot read them)',
  );
  check(true, 'and they are read again here with the key of the group');
  await a.click('[data-tip="Invite people"]');
  await a.click('.nav-item:has-text("bob") button:has-text("Invite")');
  await a.waitForTimeout(1500);
  await a.keyboard.press('Escape');
  await b.goto(WEB + '/groups');
  await b.waitForSelector('text=First message in the group', {
    timeout: 15000,
  });
  check(true, 'Bob joins the group and decrypts with the key envelope');
  const memberRows = async function () {
    return a.$$eval('aside.anim-slide-right .chan-item', function (els) {
      return els.map(function (e) {
        return (e.textContent || '').toLowerCase();
      });
    });
  };
  await a.waitForSelector('aside.anim-slide-right .chan-item:has-text("bob")', {
    timeout: 15000,
  });
  const rowsBefore = await memberRows();
  check(
    rowsBefore[0].includes('alice') && rowsBefore[1].includes('bob'),
    'members appear in order of arrival: ' + rowsBefore.length,
  );
  await a.dragAndDrop(
    'aside.anim-slide-right .chan-item:has-text("bob")',
    'aside.anim-slide-right .chan-item:has-text("alice")',
  );
  await a.waitForTimeout(1200);
  const rowsAfter = await memberRows();
  check(
    rowsAfter[0].includes('alice'),
    'nobody can be placed above the owner: the owner stays first',
  );
}
