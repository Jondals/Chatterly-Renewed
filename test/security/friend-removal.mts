/**
 * test/security/friend-removal.mts
 * Runs every group.
 */
import {
  check,
  step,
  until,
  makeApp,
  signUp,
  call,
  befriend,
  sealed,
  envelope,
  makeGuild,
} from './support.mts';

/** Runs every group. */
/** Removing a friend erases the chat and takes them out of the groups of whoever removed them. */
export async function checkFriendRemoval(): Promise<void> {
  step('friends: removing one erases what the two had');
  const app = await makeApp();
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const channel = await befriend(app, alice, bob);
  const club = await makeGuild(app, alice);
  await call(app, alice, 'POST', `/api/guilds/${club.id}/members`, {
    userId: bob.id,
    envelope: envelope(),
  });
  const spoken = await call(app, bob, 'POST', `/api/channels/${club.text}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });
  check(spoken.statusCode === 201, 'the friend wrote in the group');
  await call(app, alice, 'POST', `/api/channels/${channel}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });
  check(
    (await call(app, alice, 'DELETE', `/api/friends/${bob.id}`)).statusCode === 204,
    'a friend is removed',
  );
  check(
    (await call(app, alice, 'GET', `/api/channels/${channel}/messages`)).statusCode === 404 ||
      (await call(app, alice, 'GET', `/api/channels/${channel}/messages`)).statusCode === 403,
    'the direct chat is gone',
  );
  const left = (await call(app, alice, 'GET', `/api/channels/${club.text}/messages`)).json();
  check(
    !(left.messages ?? []).some(function theirs(m: { senderId: string }) {
      return m.senderId === bob.id;
    }),
    'their messages in the group of the remover are gone',
  );
  check(
    (await call(app, bob, 'GET', `/api/channels/${club.text}/messages`)).statusCode >= 400,
    'and they cannot read that group any more',
  );
  check(
    (await call(app, bob, 'POST', '/api/dms', { userId: alice.id })).statusCode === 403,
    'they cannot open a chat again until they are friends again',
  );
}
