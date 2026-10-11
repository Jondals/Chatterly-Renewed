/**
 * test/security/sessions.mts
 * Access tokens die with their session; refresh tokens work once; passwords and sockets follow.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { check, step, makeApp, signUp, call, blob, openSocket } from './support.mts';

/** Access tokens die with their session; refresh tokens work once; passwords and sockets follow. */
export async function checkSessions(): Promise<void> {
  step('sessions: revocation is immediate');
  const app = await makeApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const alice = await signUp(app, 'alice');

  check((await call(app, alice, 'GET', '/api/me')).statusCode === 200, 'a new access token works');
  const legacy = app.jwt.sign({ sub: alice.id } as never, { expiresIn: 600 });
  const old = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { authorization: 'Bearer ' + legacy },
  });
  check(old.statusCode === 401, 'a token that names no session is refused');
  const forged = app.jwt.sign({ sub: alice.id, sid: randomUUID() } as never, {
    expiresIn: 600,
  });
  const unknown = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { authorization: 'Bearer ' + forged },
  });
  check(unknown.statusCode === 401, 'a signed token for a session that does not exist is refused');

  const rotated = (
    await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: alice.refresh },
    })
  ).json();
  check(Boolean(rotated.accessToken && rotated.refreshToken), 'a refresh token gives new tokens');
  check(
    (await call(app, alice, 'GET', '/api/me')).statusCode === 200,
    'the access token in flight survives the rotation of its session',
  );

  const live = await openSocket(port, rotated.accessToken);
  check(await live.ready, 'a socket opens with a valid access token');
  const reuse = await app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    payload: { refreshToken: alice.refresh },
  });
  check(reuse.statusCode === 401, 'a refresh token used twice is refused');
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + rotated.accessToken },
      })
    ).statusCode === 401,
    'reusing a refresh token closes the session: its access token stops working at once',
  );
  check((await live.closed) === 4401, 'and the open socket of that session is closed');

  const login = async function (): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: alice.username, authSecret: alice.authSecret },
    });
    return res.json();
  };
  const first = await login();
  const second = await login();
  const firstSocket = await openSocket(port, first.accessToken);
  await firstSocket.ready;
  await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    payload: { refreshToken: first.refreshToken },
  });
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + first.accessToken },
      })
    ).statusCode === 401,
    'logging out stops the access token at once, not after 15 minutes',
  );
  check((await firstSocket.closed) === 4401, 'logging out closes the socket of that session');
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + second.accessToken },
      })
    ).statusCode === 200,
    'another session of the same person is not affected',
  );

  const secondSocket = await openSocket(port, second.accessToken);
  await secondSocket.ready;
  const third = await login();
  const changed = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: { authorization: 'Bearer ' + third.accessToken },
    payload: {
      oldAuthSecret: alice.authSecret,
      newAuthSecret: randomBytes(32).toString('base64'),
      kdfSalt: randomBytes(16).toString('base64'),
      kdfIterations: 600_000,
      wrappedKeys: { ecdh: blob(128), ecdsa: blob(128) },
    },
  });
  check(changed.statusCode === 200, 'the password can be changed with the old proof');
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + third.accessToken },
      })
    ).statusCode === 401,
    'a password change ends every old session, including the one that asked',
  );
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + changed.json().accessToken },
      })
    ).statusCode === 200,
    'and gives the caller a new one',
  );
  check(
    (await secondSocket.closed) === 4401,
    'a password change closes the sockets of the other devices',
  );

  step('sessions: expiry and brute force');
  const dying = await signUp(app, 'dying');
  app.ctx.db
    .prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?')
    .run(Date.now() - 1, dying.id);
  check(
    (await call(app, dying, 'GET', '/api/me')).statusCode === 401,
    'an access token whose session expired is refused',
  );
  check(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: dying.refresh },
      })
    ).statusCode === 401,
    'an expired refresh token is refused',
  );
  const target = await signUp(app, 'target');
  let last = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: target.username,
        authSecret: randomBytes(32).toString('base64'),
      },
    });
    last = res.statusCode;
  }
  check(last === 429, 'six wrong passwords lock the account for a while');
  const stranger = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      username: 'nobody_here',
      authSecret: randomBytes(32).toString('base64'),
    },
  });
  check(stranger.statusCode === 401, 'an unknown user and a wrong password look the same');
  await app.close();
}
