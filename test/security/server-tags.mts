/**
 * test/security/server-tags.mts
 * The tag of a group: the owner makes it, a member chooses to show it, and it goes when they leave.
 */
import {
  check,
  step,
  until,
  makeApp,
  signUp,
  call,
  befriend,
  envelope,
  makeGuild,
} from './support.mts';

/** The tag of a group: the owner makes it, a member chooses to show it, and it goes when they leave. */
export async function checkServerTags(): Promise<void> {
  step('groups: the tag of a group');
  const app = await makeApp();
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const eve = await signUp(app, 'eve');
  await befriend(app, alice, bob);
  const club = await makeGuild(app, alice);
  await call(app, alice, 'POST', `/api/guilds/${club.id}/members`, {
    userId: bob.id,
    envelope: envelope(),
  });
  check(
    (await call(app, bob, 'PATCH', `/api/guilds/${club.id}`, { tag: 'BOB' })).statusCode === 403,
    'only the owner makes the tag',
  );
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, {
        tag: 'TOO LONG',
      })
    ).statusCode === 400,
    'a tag is up to four letters or numbers',
  );
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, {
        tagIcon: '<b>',
      })
    ).statusCode === 400,
    'the icon of a tag is one of a fixed list',
  );
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, {
        tag: 'devl',
        tagColor: '#ff0066',
        tagIcon: '💎',
      })
    ).statusCode === 200,
    'the owner makes the tag',
  );
  const none = (await call(app, bob, 'GET', '/api/me')).json().user;
  check(none.serverTag === null, 'a member shows nothing until they choose');
  check(
    (await call(app, eve, 'PATCH', '/api/me', { tagGuild: club.id })).json().user.serverTag ===
      null,
    'somebody who is not in the group cannot show its tag',
  );
  const chosen = (await call(app, bob, 'PATCH', '/api/me', { tagGuild: club.id })).json().user;
  check(
    chosen.serverTag?.text === 'DEVL' && chosen.serverTag.icon === '💎',
    'a member shows it when they choose',
  );
  await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, { tag: 'NEW' });
  check(
    (await call(app, bob, 'GET', '/api/me')).json().user.serverTag?.text === 'NEW',
    'when the owner changes the tag, the ones who show it follow',
  );
  await call(app, alice, 'DELETE', `/api/guilds/${club.id}/members/${bob.id}`);
  check(
    (await call(app, bob, 'GET', '/api/me')).json().user.serverTag === null,
    'whoever leaves the group stops showing its tag',
  );
}
