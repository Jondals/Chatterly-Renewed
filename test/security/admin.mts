/**
 * test/security/admin.mts
 * The administration of the server: only administrators reach it (404 for everybody else), the owners are above everybody,
 * nobody acts on themselves, a suspended account cannot sign in and loses its sessions at once, closing the sign-up stops new
 * accounts (but not the owners), the announcement is plain text for everybody, and every change is in the record.
 */
import { check, step, makeApp, signUp, call, registration } from './support.mts';
import { randomBytes } from 'node:crypto';

/** Who may use the administration, and what it does. */
export async function checkAdmin(): Promise<void> {
  step('administration: only administrators, owners above everybody, a record of every change');
  const app = await makeApp();
  const owner = await signUp(app, 'adminowner');
  const helper = await signUp(app, 'adminhelper');
  const person = await signUp(app, 'adminperson');
  const other = await signUp(app, 'adminother');
  app.ctx.config.adminUsers = [owner.username.toLowerCase()];

  for (const [method, url] of [
    ['GET', '/api/admin/overview'],
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/audit'],
    ['POST', '/api/admin/users/' + person.id + '/suspend'],
    ['PUT', '/api/admin/registrations'],
    ['PUT', '/api/admin/announcement'],
  ] as const) {
    const answer = await call(
      app,
      other,
      method,
      url,
      method === 'GET' ? undefined : method === 'PUT' ? { open: false, text: 'x' } : {},
    );
    check(
      answer.statusCode === 404 || answer.statusCode === 400,
      `a normal account gets nothing from ${method} ${url}`,
    );
  }
  check(
    (await call(app, null, 'GET', '/api/admin/overview')).statusCode === 401,
    'the administration needs a session',
  );

  const overview = (await call(app, owner, 'GET', '/api/admin/overview')).json();
  check(
    overview.users.total >= 4 && overview.owner === true && overview.registrations === 'open',
    'an owner sees the numbers of the server',
  );
  check(
    !JSON.stringify(overview).includes(person.authSecret),
    'the overview carries nothing private',
  );

  // Only an owner makes administrators.
  check(
    (await call(app, owner, 'POST', '/api/beta/admins', { username: helper.username }))
      .statusCode === 201,
    'the owner makes an administrator',
  );
  check(
    (await call(app, helper, 'POST', '/api/beta/admins', { username: other.username }))
      .statusCode === 403,
    'an administrator who is not an owner cannot make more administrators',
  );

  // Searching: names only, wildcards are plain characters.
  const found = (await call(app, helper, 'GET', '/api/admin/users?q=' + person.username)).json();
  check(
    found.users.length === 1 && found.users[0].id === person.id && !('authHash' in found.users[0]),
    'an administrator finds an account by its name',
  );
  check(
    (await call(app, helper, 'GET', '/api/admin/users?q=%25')).json().users.length === 0,
    'a "%" in the search is a plain character, not "everything"',
  );

  // Nobody on themselves, nobody on an owner, another administrator only by an owner.
  check(
    (await call(app, helper, 'POST', '/api/admin/users/' + helper.id + '/suspend', {}))
      .statusCode === 403,
    'an administrator cannot suspend themselves',
  );
  check(
    (await call(app, helper, 'POST', '/api/admin/users/' + owner.id + '/suspend', {}))
      .statusCode === 403,
    'nobody can suspend an owner',
  );
  const second = await signUp(app, 'adminsecond');
  await call(app, owner, 'POST', '/api/beta/admins', { username: second.username });
  check(
    (await call(app, helper, 'POST', '/api/admin/users/' + second.id + '/sign-out')).statusCode ===
      403,
    'an administrator cannot act on another administrator (only an owner can)',
  );

  // A suspension ends the sessions at once and stops the sign-in.
  check((await call(app, person, 'GET', '/api/me')).statusCode === 200, 'the account works before');
  check(
    (
      await call(app, helper, 'POST', '/api/admin/users/' + person.id + '/suspend', {
        reason: 'spam',
      })
    ).statusCode === 200,
    'an administrator suspends an account',
  );
  check(
    (await call(app, person, 'GET', '/api/me')).statusCode === 401,
    'its access token stops working at once',
  );
  const refresh = await app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    payload: { refreshToken: person.refresh },
  });
  check(refresh.statusCode === 401, 'and its session cannot be renewed');
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: person.username, authSecret: person.authSecret },
  });
  check(
    login.statusCode === 403 &&
      login.json().error === 'account_suspended' &&
      login.json().reason === 'spam',
    'a suspended account cannot sign in, and is told why',
  );
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: person.username, authSecret: randomBytes(32).toString('base64') },
  });
  check(
    wrong.statusCode === 401,
    'without the password nobody can tell a suspended account from a wrong password',
  );
  await call(app, helper, 'POST', '/api/admin/users/' + person.id + '/restore');
  const back = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: person.username, authSecret: person.authSecret },
  });
  check(back.statusCode === 200, 'a restored account signs in again');

  // Closing the sign-up.
  check(
    (await call(app, helper, 'PUT', '/api/admin/registrations', { open: false })).json()
      .registrations === 'closed',
    'an administrator closes the sign-up',
  );
  const closed = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: registration(
      'newcomer_' + randomBytes(3).toString('hex'),
      randomBytes(32).toString('base64'),
    ),
  });
  check(
    closed.statusCode === 403 && closed.json().error === 'registrations_closed',
    'nobody can make an account while it is closed',
  );
  await call(app, helper, 'PUT', '/api/admin/registrations', { open: true });

  // The announcement: plain text, for every signed-in person.
  const put = await call(app, helper, 'PUT', '/api/admin/announcement', {
    text: 'Maintenance at 22:00\u0007',
    tone: 'warning',
  });
  check(put.statusCode === 200, 'an administrator puts an announcement');
  const seen = (await call(app, other, 'GET', '/api/announcement')).json().announcement;
  check(
    seen && seen.text === 'Maintenance at 22:00' && seen.tone === 'warning',
    'every person sees it, without control characters',
  );
  check(
    (await call(app, helper, 'PUT', '/api/admin/announcement', { text: 'x'.repeat(301) }))
      .statusCode === 400,
    'an announcement has a limit of length',
  );
  await call(app, helper, 'PUT', '/api/admin/announcement', { text: '' });
  check(
    (await call(app, other, 'GET', '/api/announcement')).json().announcement === null,
    'an empty text takes it away',
  );

  // The record.
  const entries = (await call(app, owner, 'GET', '/api/admin/audit')).json().entries as {
    action: string;
    actor: string;
    target: string;
  }[];
  check(
    entries.some(function suspended(entry) {
      return (
        entry.action === 'suspend' &&
        entry.actor === helper.username &&
        entry.target === person.username
      );
    }) &&
      entries.some(function opened(entry) {
        return entry.action === 'admin-add' && entry.actor === owner.username;
      }),
    'the record says who did what to whom',
  );
  await app.close();
}
