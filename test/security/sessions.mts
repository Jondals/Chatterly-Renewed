/**
 * test/security/sessions.mts
 * Access tokens die with their session; refresh tokens work once; passwords and sockets follow.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { check, step, makeApp, signUp, call, blob, openSocket, type TestApp } from './support.mts';

/** Asks for new tokens with a refresh token (and the retry key of this request, like the current app). */
function refresh(app: TestApp, refreshToken: string, key?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    payload: key ? { refreshToken, retryKey: key } : { refreshToken },
  });
}

/** A fresh retry key: 32 random bytes in base64url, made by the app before each renewal. */
function retryKey(): string {
  return randomBytes(32).toString('base64url');
}

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

  const firstKey = retryKey();
  const rotated = (await refresh(app, alice.refresh, firstKey)).json();
  check(Boolean(rotated.accessToken && rotated.refreshToken), 'a refresh token gives new tokens');
  check(
    (await call(app, alice, 'GET', '/api/me')).statusCode === 200,
    'the access token in flight survives the rotation of its session',
  );

  // * A phone can lose the answer of a renewal (no network, the app killed): it then presents the old token again,
  // with the retry key it saved before asking.
  const retry = await refresh(app, alice.refresh, firstKey);
  check(
    retry.statusCode === 200 && retry.json().refreshToken === rotated.refreshToken,
    'a renewal whose answer was lost can be asked again: it gives the SAME new token (no second branch of the session)',
  );
  const racingKey = retryKey();
  const racing = await Promise.all([
    refresh(app, rotated.refreshToken, racingKey),
    refresh(app, rotated.refreshToken, racingKey),
  ]);
  check(
    racing[0].statusCode === 200 &&
      racing[1].statusCode === 200 &&
      racing[0].json().refreshToken === racing[1].json().refreshToken,
    'two renewals at the same time with the same token both get the same new token',
  );
  const confirmed = (await refresh(app, racing[0].json().refreshToken, retryKey())).json();
  const live = await openSocket(port, confirmed.accessToken);
  check(await live.ready, 'a socket opens with a valid access token');
  const reuse = await refresh(app, rotated.refreshToken, racingKey);
  check(
    reuse.statusCode === 401,
    'once the next token was used, the old one is refused (it can only mean a copy)',
  );
  check(
    (
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { authorization: 'Bearer ' + confirmed.accessToken },
      })
    ).statusCode === 401,
    'reusing a refresh token closes the session: its access token stops working at once',
  );
  check((await live.closed) === 4401, 'and the open socket of that session is closed');

  step('sessions: the second chance of a renewal never brings a session back');
  const timed = await signUp(app, 'timed');
  const timedKey = retryKey();
  const timedNext = (await refresh(app, timed.refresh, timedKey)).json();
  app.ctx.db
    .prepare('UPDATE spent_tokens SET spent_at = ? WHERE user_id = ?')
    .run(Date.now() - 11 * 60_000, timed.id);
  check(
    (await refresh(app, timed.refresh, timedKey)).statusCode === 401 &&
      (
        await app.inject({
          method: 'GET',
          url: '/api/me',
          headers: { authorization: 'Bearer ' + timedNext.accessToken },
        })
      ).statusCode === 401,
    'after ten minutes the old token is a copy again: refused, and the sessions are closed',
  );

  // ! A copy of the token (from a backup, a stolen phone...) does not have the retry key of the request that rotated it.
  const thief = await signUp(app, 'thief_target');
  const ownNext = (await refresh(app, thief.refresh, retryKey())).json();
  check(
    (await refresh(app, thief.refresh, retryKey())).statusCode === 401 &&
      (
        await app.inject({
          method: 'GET',
          url: '/api/me',
          headers: { authorization: 'Bearer ' + ownNext.accessToken },
        })
      ).statusCode === 401,
    'a copy of the old token with another retry key is detected at once and every session is closed',
  );
  const bare = await signUp(app, 'bare_copy');
  const bareNext = (await refresh(app, bare.refresh, retryKey())).json();
  check(
    (await refresh(app, bare.refresh)).statusCode === 401 &&
      (
        await app.inject({
          method: 'GET',
          url: '/api/me',
          headers: { authorization: 'Bearer ' + bareNext.accessToken },
        })
      ).statusCode === 401,
    'a copy of the old token without any retry key is detected at once too',
  );
  const thiefFirst = await signUp(app, 'thief_first');
  const stolenTurn = (await refresh(app, thiefFirst.refresh, retryKey())).json();
  check(
    (await refresh(app, thiefFirst.refresh, retryKey())).statusCode === 401 &&
      (
        await app.inject({
          method: 'GET',
          url: '/api/me',
          headers: { authorization: 'Bearer ' + stolenTurn.accessToken },
        })
      ).statusCode === 401,
    'when the copy renews first, the owner asking next closes every session (the copy is cut off too)',
  );

  const oldClient = await signUp(app, 'old_client');
  const oldNext = (await refresh(app, oldClient.refresh)).json();
  check(
    Boolean(oldNext.refreshToken) && (await refresh(app, oldClient.refresh)).statusCode === 401,
    'an app of an older version (no retry key) works and keeps the old rule: a reuse is refused',
  );

  const leaving = await signUp(app, 'leaving');
  const leavingKey = retryKey();
  const leavingNext = (await refresh(app, leaving.refresh, leavingKey)).json();
  await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    payload: { refreshToken: leavingNext.refreshToken },
  });
  check(
    (await refresh(app, leaving.refresh, leavingKey)).statusCode === 401,
    'after signing out, the old token is refused even within the grace (a closed session stays closed)',
  );

  const changing = await signUp(app, 'changing');
  const changingKey = retryKey();
  const changingNext = (await refresh(app, changing.refresh, changingKey)).json();
  const afterChange = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: { authorization: 'Bearer ' + changingNext.accessToken },
    payload: {
      oldAuthSecret: changing.authSecret,
      newAuthSecret: randomBytes(32).toString('base64'),
      kdfSalt: randomBytes(16).toString('base64'),
      kdfIterations: 600_000,
      wrappedKeys: { ecdh: blob(128), ecdsa: blob(128) },
    },
  });
  check(
    afterChange.statusCode === 200 &&
      (await refresh(app, changing.refresh, changingKey)).statusCode === 401,
    'after a password change, the old token is refused even with its retry key',
  );

  const lost = await signUp(app, 'lost_answer');
  const lostKey = retryKey();
  await refresh(app, lost.refresh, lostKey);
  await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    payload: { refreshToken: lost.refresh, retryKey: retryKey() },
  });
  check(
    (await call(app, lost, 'GET', '/api/me')).statusCode === 200,
    'a copy of the old token cannot sign the owner out (wrong retry key)',
  );
  await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    payload: { refreshToken: lost.refresh, retryKey: lostKey },
  });
  check(
    (await call(app, lost, 'GET', '/api/me')).statusCode === 401,
    'signing out with the token whose renewal answer was lost still closes the session',
  );

  const expiring = await signUp(app, 'expiring');
  const expiringKey = retryKey();
  await refresh(app, expiring.refresh, expiringKey);
  app.ctx.db
    .prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?')
    .run(Date.now() - 1, expiring.id);
  check(
    (await refresh(app, expiring.refresh, expiringKey)).statusCode === 401,
    'an expired session cannot be renewed through the grace',
  );
  check(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: randomBytes(32).toString('base64url'), retryKey: 'short' },
      })
    ).statusCode === 400,
    'a malformed retry key is refused by the schema',
  );

  const legacyRow = await signUp(app, 'legacy_row');
  const legacyToken = randomBytes(32).toString('base64url');
  app.ctx.db
    .prepare('INSERT INTO spent_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(createHash('sha256').update(legacyToken).digest('hex'), legacyRow.id, Date.now() + 60_000);
  check(
    (await refresh(app, legacyToken)).statusCode === 401 &&
      (await call(app, legacyRow, 'GET', '/api/me')).statusCode === 401,
    'a token spent before this version (no session recorded) is treated as a copy, as before',
  );
  check(
    (await refresh(app, randomBytes(32).toString('base64url'))).statusCode === 401,
    'an unknown token is refused',
  );

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
