/**
 * test/security/vault.mts
 * The personal library (camera backgrounds): the server only ever holds ciphertext, only the owner can reach an item,
 * the limits hold, and an erased account takes its files with it.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { check, step, type Account, makeApp, signUp, bearer, call, until } from './support.mts';

/** The personal library: ciphertext only, private to its owner, limited, and erased with the account. */
export async function checkVault(): Promise<void> {
  step('personal library: sealed, private, limited');
  const app = await makeApp();
  const alice = await signUp(app, 'vaultalice');
  const bob = await signUp(app, 'vaultbob');
  const sealedPart = function (bytes: number): { iv: string; ct: string } {
    return { iv: randomBytes(12).toString('base64'), ct: randomBytes(bytes).toString('base64') };
  };
  const send = function (who: Account | null, id: string, body: Buffer, meta = sealedPart(300)) {
    const key = sealedPart(48);
    const query = new URLSearchParams({ id, ki: key.iv, kc: key.ct, mi: meta.iv, mc: meta.ct });
    return app.inject({
      method: 'POST',
      url: '/api/vault?' + query,
      headers: { ...(who ? bearer(who) : {}), 'content-type': 'application/octet-stream' },
      payload: body,
    });
  };
  const folder = path.join(app.ctx.config.uploadDir, 'vault');

  check(
    (await send(null, randomUUID(), randomBytes(200))).statusCode === 401,
    'adding needs a session',
  );
  check((await call(app, null, 'GET', '/api/vault')).statusCode === 401, 'listing needs a session');
  check(
    (await send(alice, 'not-an-id', randomBytes(200))).statusCode === 400,
    'an id that is not a random UUID is refused (it never reaches a path)',
  );
  check(
    (await send(alice, randomUUID(), Buffer.from('tiny'))).statusCode === 400,
    'something too short to be ciphertext is refused',
  );

  const secret = randomBytes(5000);
  const id = randomUUID();
  const stored = await send(alice, id, secret);
  check(
    stored.statusCode === 201 && stored.json().id === id,
    'an item is stored under the id the browser made',
  );
  check(
    fs.readFileSync(path.join(folder, id)).equals(secret),
    'the server keeps the bytes untouched (it cannot read or rebuild them)',
  );
  check(
    (await send(alice, id, randomBytes(200))).statusCode === 409 &&
      (await send(bob, id, randomBytes(200))).statusCode === 409,
    'an id that exists cannot be used again, by its owner or by anybody else',
  );

  const listed = (await call(app, alice, 'GET', '/api/vault')).json();
  check(
    listed.items.length === 1 && listed.items[0].id === id && listed.used === secret.length,
    'the owner sees their item and what they use',
  );
  check(
    listed.items[0].key.ciphertext &&
      listed.items[0].meta.ciphertext &&
      !('name' in listed.items[0]),
    'it comes back as sealed key and sealed description only (the server knows no name or type)',
  );
  check(
    (await call(app, bob, 'GET', '/api/vault')).json().items.length === 0,
    'nobody sees the items of somebody else',
  );

  const download = await call(app, alice, 'GET', '/api/vault/' + id);
  check(
    download.statusCode === 200 && download.rawPayload.equals(secret),
    'the owner downloads the ciphertext',
  );
  check(
    String(download.headers['cache-control']).includes('no-store') &&
      String(download.headers['content-security-policy']).includes('sandbox'),
    'and it is never cached and is served sandboxed',
  );
  check(
    (await call(app, bob, 'GET', '/api/vault/' + id)).statusCode === 404,
    'another person gets nothing, as if it did not exist',
  );
  check(
    (await call(app, null, 'GET', '/api/vault/' + id)).statusCode === 401,
    'a visitor without a session gets nothing',
  );
  for (const bad of ['..%2F..%2Fsecrets.json', '..%2Fimages', 'x']) {
    const res = await call(app, alice, 'GET', '/api/vault/' + bad);
    check(
      res.statusCode === 404 || res.statusCode === 400,
      `a path in place of an id gives nothing (${bad})`,
    );
  }
  check(
    (await call(app, bob, 'DELETE', '/api/vault/' + id)).statusCode === 404 &&
      fs.existsSync(path.join(folder, id)),
    'another person cannot remove it',
  );

  // The limits. (The rows are made directly: the route has its own limit of requests per minute.)
  const insert = app.ctx.db.prepare(
    'INSERT INTO vault_items (id, owner_id, size, created_at, key_iv, key_ct, meta_iv, meta_ct) VALUES (?,?,?,?,?,?,?,?)',
  );
  for (let i = 0; i < 39; i++) {
    insert.run(
      randomUUID(),
      alice.id,
      10,
      Date.now(),
      'AAAAAAAAAAAAAAAA',
      'AAAAAAAAAAAAAAAA',
      'AAAAAAAAAAAAAAAA',
      'AAAAAAAAAAAAAAAA',
    );
  }
  const full = await send(alice, randomUUID(), randomBytes(200));
  check(
    full.statusCode === 429 && full.json().error === 'too_many_items',
    'a library has a limit of items',
  );
  check(
    (await send(bob, randomUUID(), randomBytes(200))).statusCode === 201,
    'and the limit of one person does not touch another',
  );
  app.ctx.db.prepare('DELETE FROM vault_items WHERE owner_id = ? AND id <> ?').run(alice.id, id);
  app.ctx.db.prepare('UPDATE vault_items SET size = ? WHERE id = ?').run(159 * 1024 * 1024, id);
  check(
    (await send(alice, randomUUID(), randomBytes(2 * 1024 * 1024))).statusCode === 413,
    'and a limit of bytes in all',
  );
  app.ctx.db.prepare('UPDATE vault_items SET size = ? WHERE id = ?').run(secret.length, id);

  check(
    (await call(app, alice, 'DELETE', '/api/vault/' + id)).statusCode === 204,
    'the owner removes an item',
  );
  check(!fs.existsSync(path.join(folder, id)), 'with its file');
  const again = randomUUID();
  await send(alice, again, randomBytes(200));
  check(
    (await call(app, alice, 'DELETE', '/api/vault')).statusCode === 204,
    'the owner removes everything at once',
  );
  check(
    (await call(app, alice, 'GET', '/api/vault')).json().items.length === 0 &&
      !fs.existsSync(path.join(folder, again)),
    'nothing is left, rows or files',
  );
  check(
    (await call(app, bob, 'GET', '/api/vault')).json().items.length === 1,
    'and what belongs to others stays',
  );

  const kept = randomUUID();
  await send(bob, kept, randomBytes(300));
  const erased = await call(app, bob, 'POST', '/api/me/delete', { authSecret: bob.authSecret });
  check(erased.statusCode === 204, 'a person erases their account');
  check(
    (await until(function fileGone() {
      return !fs.existsSync(path.join(folder, kept));
    })) && !app.ctx.db.prepare('SELECT 1 FROM vault_items WHERE owner_id = ?').get(bob.id),
    'and their library goes with it (rows and files)',
  );
  await app.close();
}
