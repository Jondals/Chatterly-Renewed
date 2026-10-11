/**
 * test/security/privacy.mts
 * The privacy choices are enforced by the server, not only hidden by the screen.
 */
import {
  check,
  step,
  until,
  type Account,
  makeApp,
  signUp,
  call,
  befriend,
  envelope,
  makeGuild,
  type TestSocket,
  openSocket,
} from './support.mts';

/** The privacy choices are enforced by the server, not only hidden by the screen. */
export async function checkPrivacy(): Promise<void> {
  step('privacy: online status, friend requests and search');
  const app = await makeApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const dave = await signUp(app, 'dave');
  await befriend(app, alice, bob);
  // Dave shares a group with Alice but is not her friend (he was, to be added, and then was removed from her friends).
  await befriend(app, alice, dave);
  await befriend(app, bob, dave);
  const club = await makeGuild(app, bob);
  for (const member of [alice, dave]) {
    await call(app, bob, 'POST', `/api/guilds/${club.id}/members`, {
      userId: member.id,
      envelope: envelope(),
    });
  }
  await call(app, alice, 'DELETE', `/api/friends/${dave.id}`);

  const sockets = {
    alice: await openSocket(port, alice.access),
    bob: await openSocket(port, bob.access),
    dave: await openSocket(port, dave.access),
  };
  await Promise.all([sockets.alice.ready, sockets.bob.ready, sockets.dave.ready]);
  /** The last status of Alice that a socket was told (or null when it was not told anything). */
  const lastSeen = function (socket: TestSocket): string | null {
    let status: string | null = null;
    for (const frame of socket.frames) {
      if (frame['t'] === 'presence' && frame['userId'] === alice.id)
        status = String(frame['status']);
    }
    return status;
  };
  const snapshot = async function (who: Account): Promise<string[]> {
    const res = await call(app, who, 'GET', '/api/presence');
    return res.json().presence.map(function id(p: { userId: string }) {
      return p.userId;
    });
  };

  check((await snapshot(bob)).includes(alice.id), 'by default a friend sees the person online');
  check(
    (await snapshot(dave)).includes(alice.id),
    'by default somebody who shares a group sees them too',
  );
  const own = (await call(app, alice, 'GET', '/api/me')).json().user;
  check(
    own.privacy.presenceVisibility === 'everyone' &&
      own.privacy.friendRequests === 'everyone' &&
      own.privacy.searchable === true,
    'the defaults are open',
  );
  const others = (await call(app, bob, 'GET', `/api/users/${alice.id}`)).json().user;
  check(others.privacy === undefined, "other people never receive somebody's privacy choices");

  const set = async function (patch: Record<string, unknown>) {
    return call(app, alice, 'PATCH', '/api/me', patch);
  };
  check(
    (await set({ presenceVisibility: 'friends' })).statusCode === 200,
    'the person can choose to be seen online by friends only',
  );
  check(
    await until(function hidden() {
      return lastSeen(sockets.dave) === 'offline';
    }),
    'somebody who is not a friend is told at once that the person went offline',
  );
  check(lastSeen(sockets.bob) === 'online', 'a friend keeps seeing them online');
  check(
    !(await snapshot(dave)).includes(alice.id) && (await snapshot(bob)).includes(alice.id),
    'the list of who is online follows the same rule',
  );

  check(
    (await set({ presenceVisibility: 'nobody' })).statusCode === 200,
    'the person can choose to be seen by nobody',
  );
  check(
    await until(function hiddenFromFriends() {
      return lastSeen(sockets.bob) === 'offline';
    }),
    'then friends see them offline too',
  );
  check(!(await snapshot(bob)).includes(alice.id), 'and the list of who is online leaves them out');
  check(
    (await call(app, alice, 'GET', '/api/me')).json().user.privacy.presenceVisibility === 'nobody',
    'the person still sees their own choice',
  );
  await set({ presenceVisibility: 'everyone' });
  check(
    await until(function visibleAgain() {
      return lastSeen(sockets.dave) === 'online';
    }),
    'going back to everybody shows them again',
  );
  check(
    (await set({ presenceVisibility: 'strangers' })).statusCode === 400,
    'a value that does not exist is refused',
  );

  step('privacy: friend requests and search');
  const eve = await signUp(app, 'eve');
  check(
    (await set({ friendRequests: 'nobody' })).statusCode === 200,
    'the person closes their friend requests',
  );
  const refused = await call(app, eve, 'POST', '/api/friends/request', {
    username: alice.username,
  });
  check(
    refused.statusCode === 403 && refused.json().error === 'requests_closed',
    'a request to them is refused by the server',
  );
  check(
    (await call(app, bob, 'GET', '/api/friends')).json().friends.includes(alice.id),
    'friends they already have are not affected',
  );
  await set({ friendRequests: 'everyone' });
  check(
    (
      await call(app, eve, 'POST', '/api/friends/request', {
        username: alice.username,
      })
    ).statusCode === 201,
    'opening them again allows requests',
  );

  const found = async function (who: Account, text: string): Promise<boolean> {
    const res = await call(app, who, 'GET', '/api/users/search?q=' + text);
    return res.json().users.some(function isAlice(u: { id: string }) {
      return u.id === alice.id;
    });
  };
  const prefix = alice.username.slice(0, 5);
  check(await found(bob, prefix), 'by default they are found by a search');
  check((await set({ searchable: false })).statusCode === 200, 'the person can leave the search');
  check(!(await found(bob, prefix)), 'then a search does not list them');
  const frank = await signUp(app, 'frank');
  check(
    (
      await call(app, frank, 'POST', '/api/friends/request', {
        username: alice.username,
      })
    ).statusCode === 201,
    'but their exact username still works',
  );
  await app.close();
}
