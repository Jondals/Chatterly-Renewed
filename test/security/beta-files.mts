/**
 * test/security/beta-files.mts
 * The beta installers: only a tester or an administrator gets a download token, the token stops working the moment the account
 * leaves the program or after it expires, nobody can download a name that is not an installer or a manifest, and only the build
 * (with its secret) can upload, count betas and, with a new manifest, make the old installers disappear.
 */
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { check, step, makeApp, signUp, call, TMP } from './support.mts';

const BUILD = 'b'.repeat(40);

/** Who may download, how the token behaves and who may upload. */
export async function checkBetaFiles(): Promise<void> {
  step('beta files: download only for testers, upload only for the build');
  const dir = path.join(TMP, 'beta-' + Date.now());
  const app = await makeApp({ betaDir: dir, betaUploadToken: BUILD });
  const admin = await signUp(app, 'filesadmin');
  const tester = await signUp(app, 'filestester');
  const other = await signUp(app, 'filesother');
  app.ctx.config.adminUsers = [admin.username.toLowerCase()];
  await call(app, admin, 'POST', '/api/beta/testers', { username: tester.username });

  const asBuild = { authorization: 'Bearer ' + BUILD };
  const upload = function (target: typeof app, name: string, body: string, headers = asBuild) {
    return target.inject({
      method: 'PUT',
      url: '/api/beta/upload/' + name,
      headers: { ...headers, 'content-type': 'application/x-chatterly-beta' },
      payload: Buffer.from(body),
    });
  };
  const put = function (name: string, body: string, headers: Record<string, string> = asBuild) {
    return upload(app, name, body, headers);
  };
  const download = function (name: string, token: string | null) {
    return app.inject({
      method: 'GET',
      url: '/api/beta/dl/' + name,
      headers: token === null ? {} : { authorization: 'Bearer ' + token },
    });
  };

  check(
    (await put('Chatterly-2.32.0-b1.exe', 'x', {})).statusCode === 404,
    'an upload without the build secret is refused',
  );
  check(
    (await put('Chatterly-2.32.0-b1.exe', 'x', { authorization: 'Bearer ' + 'c'.repeat(40) }))
      .statusCode === 404,
    'an upload with a wrong secret is refused',
  );
  check(
    (await put('..%2Fchatterly.db', 'x')).statusCode === 400 &&
      (await put('evil.sh', 'x')).statusCode === 400,
    'an upload with a name that is not an installer or a manifest is refused',
  );
  check(
    (await put('Chatterly-2.32.0-b1.exe', 'installer-one')).statusCode === 201 &&
      (await put('beta.yml.sig', 'signature')).statusCode === 201 &&
      (await put('beta.yml', 'version: 2.32.0-beta.1\npath: Chatterly-2.32.0-b1.exe\n'))
        .statusCode === 201,
    'the build uploads an installer, a signature and a manifest',
  );

  const big = 'z'.repeat(3 * 1024 * 1024);
  check(
    (await put('Chatterly-2.32.0-big.exe', big)).statusCode === 201 &&
      fs.statSync(path.join(dir, 'Chatterly-2.32.0-big.exe')).size === big.length,
    'an installer of several megabytes (more than the normal limit of the API) is uploaded whole',
  );
  fs.rmSync(path.join(dir, 'Chatterly-2.32.0-big.exe'));
  check(
    (await call(app, null, 'GET', '/api/beta/feed')).statusCode === 401,
    'the download token needs a session',
  );
  check(
    (await call(app, other, 'GET', '/api/beta/feed')).statusCode === 404,
    'an account that is not in the program gets no token',
  );
  const token = (await call(app, tester, 'GET', '/api/beta/feed')).json().token as string;
  check(typeof token === 'string' && token.length > 20, 'a tester gets a token');
  check(
    typeof (await call(app, admin, 'GET', '/api/beta/feed')).json().token === 'string',
    'an administrator gets a token too',
  );

  check((await download('beta.yml', null)).statusCode === 404, 'no token, no download');
  check((await download('beta.yml', 'junk')).statusCode === 404, 'a made-up token is refused');
  const own = await download('Chatterly-2.32.0-b1.exe', token);
  check(
    own.statusCode === 200 && own.body === 'installer-one',
    'a tester downloads the installer with the token',
  );
  const tampered = token.replace(/\.[^.]+$/, '.' + 'A'.repeat(43));
  check(
    (await download('beta.yml', tampered)).statusCode === 404,
    'a token with another signature is refused',
  );
  const swapped = tester.id + '.' + (Date.now() + 1e9) + '.' + token.split('.')[2];
  check(
    (await download('beta.yml', swapped)).statusCode === 404,
    'a token with a longer life is refused',
  );
  check(
    (await download('..%2Fchatterly.db', token)).statusCode === 404 &&
      (await download('counter.json', token)).statusCode === 404,
    'a name that is not an installer or a manifest cannot be downloaded',
  );

  // A token made with the secret of the server for an account outside the program, and an expired one.
  const key = createHmac('sha256', 's'.repeat(48)).update('beta-download-v1').digest();
  const signed = function (body: string): string {
    return body + '.' + createHmac('sha256', key).update(body).digest('base64url');
  };
  check(
    (await download('beta.yml', signed(other.id + '.' + (Date.now() + 60_000)))).statusCode === 404,
    'a valid token of an account outside the program gets nothing',
  );
  check(
    (await download('beta.yml', signed(tester.id + '.' + (Date.now() - 1000)))).statusCode === 404,
    'an expired token is refused',
  );

  check(
    (await call(app, admin, 'DELETE', '/api/beta/testers/' + tester.id)).statusCode === 200 &&
      (await download('beta.yml', token)).statusCode === 404,
    'taking a tester off the list stops their token at once',
  );

  check(
    (await app.inject({ method: 'GET', url: '/api/beta/next?base=2.32.0&sha=' + 'a'.repeat(40) }))
      .statusCode === 404,
    'the beta counter is only for the build',
  );
  const next = async function (sha: string): Promise<number> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/beta/next?base=2.32.0&sha=' + sha,
      headers: asBuild,
    });
    return res.json().number;
  };
  check(
    (await next('a'.repeat(40))) === 1 &&
      (await next('a'.repeat(40))) === 1 &&
      (await next('d'.repeat(40))) === 2,
    'the counter gives 1, 2... and the same number to the same commit',
  );

  // Old installers disappear once nobody points to them (after the hour of grace).
  await put('Chatterly-2.32.0-b2.exe', 'installer-two');
  await put('beta.yml', 'version: 2.32.0-beta.2\npath: Chatterly-2.32.0-b2.exe\n');
  check(
    fs.existsSync(path.join(dir, 'Chatterly-2.32.0-b1.exe')),
    'a fresh installer that no manifest points to is kept for an hour',
  );
  const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(path.join(dir, 'Chatterly-2.32.0-b1.exe'), longAgo, longAgo);
  await put('beta.yml', 'version: 2.32.0-beta.2\npath: Chatterly-2.32.0-b2.exe\n');
  check(
    !fs.existsSync(path.join(dir, 'Chatterly-2.32.0-b1.exe')) &&
      fs.existsSync(path.join(dir, 'Chatterly-2.32.0-b2.exe')),
    'the installer of the old beta is deleted, the one a manifest points to stays',
  );
  await app.close();

  const off = await makeApp({ betaDir: dir });
  check(
    (await upload(off, 'beta.yml', 'x')).statusCode === 404,
    'without BETA_UPLOAD_TOKEN on the server nobody can upload',
  );
  await off.close();
}
