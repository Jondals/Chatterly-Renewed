/**
 * test/security/beta.mts
 * The beta program: only the administrators named in ADMIN_USERS can see or change the list of testers (everybody else gets
 * 404, as if the routes did not exist), anybody can ask whether they are a tester, and erasing an account takes it off the list.
 */
import { check, step, makeApp, signUp, call } from './support.mts';

/** Who may manage the beta testers, and what a normal account can learn. */
export async function checkBeta(): Promise<void> {
  step('beta program: only the administrators manage it');
  const app = await makeApp();
  const admin = await signUp(app, 'betaadmin');
  const tester = await signUp(app, 'betatester');
  const other = await signUp(app, 'betaother');
  app.ctx.config.adminUsers = [admin.username.toLowerCase()];

  check(
    (await call(app, null, 'GET', '/api/beta/me')).statusCode === 401,
    'asking the beta state needs a session',
  );
  check(
    (await call(app, null, 'GET', '/api/beta/testers')).statusCode === 401,
    'the list of testers needs a session',
  );
  const adminMe = (await call(app, admin, 'GET', '/api/beta/me')).json();
  check(adminMe.admin === true && adminMe.beta === false, 'an administrator is told so');
  const otherMe = (await call(app, other, 'GET', '/api/beta/me')).json();
  check(otherMe.admin === false && otherMe.beta === false, 'a normal account is neither');

  check(
    (await call(app, other, 'GET', '/api/beta/testers')).statusCode === 404,
    'a normal account gets 404 on the list',
  );
  check(
    (await call(app, other, 'POST', '/api/beta/testers', { username: tester.username }))
      .statusCode === 404,
    'a normal account cannot add a tester',
  );
  check(
    (await call(app, other, 'DELETE', '/api/beta/testers/' + tester.id)).statusCode === 404,
    'a normal account cannot remove a tester',
  );

  check(
    (await call(app, admin, 'POST', '/api/beta/testers', { username: 'nobody_at_all' }))
      .statusCode === 404,
    'adding a name that does not exist is refused',
  );
  check(
    (await call(app, admin, 'POST', '/api/beta/testers', { username: 'bad name!' })).statusCode ===
      400,
    'a username with a wrong shape is refused',
  );
  check(
    (await call(app, admin, 'POST', '/api/beta/testers', { username: tester.username }))
      .statusCode === 201,
    'the administrator adds a tester',
  );
  check(
    (await call(app, admin, 'POST', '/api/beta/testers', { username: tester.username }))
      .statusCode === 201,
    'adding the same tester twice is harmless',
  );
  check(
    (await call(app, tester, 'GET', '/api/beta/me')).json().beta === true,
    'the tester is told they are one',
  );
  const list = (await call(app, admin, 'GET', '/api/beta/testers')).json();
  check(
    list.testers.length === 1 &&
      list.testers[0].id === tester.id &&
      !('authHash' in list.testers[0]),
    'the administrator sees the tester (and nothing private)',
  );

  check(
    (await call(app, admin, 'DELETE', '/api/beta/testers/' + tester.id)).statusCode === 200 &&
      (await call(app, tester, 'GET', '/api/beta/me')).json().beta === false,
    'removing a tester takes the access away',
  );

  await call(app, admin, 'POST', '/api/beta/testers', { username: tester.username });
  const erased = await call(app, tester, 'POST', '/api/me/delete', {
    authSecret: tester.authSecret,
  });
  check(erased.statusCode === 204, 'the tester erases their account');
  check(
    (await call(app, admin, 'GET', '/api/beta/testers')).json().testers.length === 0,
    'an erased account leaves the list',
  );
  const third = await signUp(app, 'betathird');
  check(
    (await call(app, other, 'POST', '/api/beta/admins', { username: third.username }))
      .statusCode === 404,
    'a normal account cannot make anybody an administrator',
  );
  check(
    (await call(app, admin, 'POST', '/api/beta/admins', { username: other.username }))
      .statusCode === 201,
    'an administrator makes another person an administrator from the app',
  );
  check(
    (await call(app, other, 'GET', '/api/beta/me')).json().admin === true &&
      (await call(app, other, 'GET', '/api/beta/testers')).statusCode === 200,
    'the new administrator can manage the testers',
  );
  const adminList = (await call(app, other, 'GET', '/api/beta/admins')).json().admins;
  check(
    adminList.length === 2 &&
      adminList.find(function owner(a: { id: string }) {
        return a.id === admin.id;
      }).fixed === true,
    'the list shows the owner of the server (fixed) and the one added',
  );
  check(
    (await call(app, other, 'DELETE', '/api/beta/admins/' + admin.id)).statusCode === 403,
    'an owner named in the server settings cannot be removed from the app',
  );
  check(
    (await call(app, admin, 'DELETE', '/api/beta/admins/' + other.id)).statusCode === 200 &&
      (await call(app, other, 'GET', '/api/beta/testers')).statusCode === 404,
    'removing an administrator takes the access away',
  );
  await app.close();
}
