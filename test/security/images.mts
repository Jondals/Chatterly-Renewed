/**
 * test/security/images.mts
 * Every picture is uploaded as ciphertext; a group icon goes only to the members of its group; ids cannot reach other files.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runMaintenance, IMAGE_GRACE_MS } from '../../backend/src/maintenance';
import { canSeeProfile } from '../../backend/src/models';
import {
  check,
  step,
  type Account,
  makeApp,
  signUp,
  bearer,
  call,
  befriend,
  blob,
  sealed,
  envelope,
  metaOf,
  makeGuild,
} from './support.mts';

/** Every picture is uploaded as ciphertext; a group icon goes only to the members of its group; ids cannot reach other files. */
export async function checkImages(): Promise<void> {
  step('pictures: the routes');
  // (the global limit of requests is lifted here: this block makes more than the real limit allows in a minute)
  const app = await makeApp({
    rateLimit: { max: 100000, authMax: 100000, windowMs: 60_000 },
  });
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const upload = async function (who: Account | null, body: Buffer, kind = 'avatar', guild = '') {
    return app.inject({
      method: 'POST',
      url: '/api/images?kind=' + kind + (guild ? '&guild=' + guild : ''),
      headers: {
        ...(who ? bearer(who) : {}),
        'content-type': 'application/octet-stream',
      },
      payload: body,
    });
  };
  check((await upload(null, randomBytes(64))).statusCode === 401, 'uploading needs a session');
  check(
    (await upload(alice, randomBytes(64), 'wallpaper')).statusCode === 400,
    'an unknown kind is refused',
  );
  step('group icons are end-to-end encrypted and only for the members');
  const club = await makeGuild(app, alice);
  check(
    (await upload(alice, randomBytes(64), 'group')).statusCode === 403,
    'a group icon says which group it is for',
  );
  check(
    (await upload(bob, randomBytes(64), 'group', club.id)).statusCode === 403,
    'only the owner of the group uploads its icon',
  );
  check(
    (await upload(alice, Buffer.from('tiny'), 'group', club.id)).statusCode === 400,
    'something too short to be ciphertext is refused',
  );
  const secretIcon = randomBytes(300);
  const stored = await upload(alice, secretIcon, 'group', club.id);
  check(stored.statusCode === 201, 'the owner uploads the icon as the ciphertext it is');
  const imageId = stored.json().id;
  check(
    fs.readFileSync(path.join(app.ctx.config.uploadDir, 'images', imageId)).equals(secretIcon),
    'the server keeps the bytes untouched (it cannot read or rebuild them)',
  );
  check(
    (await call(app, bob, 'GET', `/api/images/${imageId}`)).statusCode === 404,
    'a group icon is not given to somebody who is not in its group',
  );
  const iconKey = { version: 1, iv: blob(12), data: blob(48) };
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, {
        iconImage: imageId,
      })
    ).statusCode === 400,
    'an icon needs the key that opens it',
  );
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, {
        iconImage: imageId,
        iconKey: { ...iconKey, version: 7 },
      })
    ).statusCode === 400,
    'and that key is sealed with the key the group has now',
  );
  const otherClub = await makeGuild(app, alice);
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${otherClub.id}`, {
        iconImage: imageId,
        iconKey,
      })
    ).statusCode === 400,
    'an icon of one group cannot be used by another',
  );
  const attached = await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, {
    iconImage: imageId,
    iconKey,
  });
  check(
    attached.statusCode === 200 && attached.json().guild.iconKey.data === iconKey.data,
    'the owner makes it the icon, with its sealed key',
  );
  const member = await signUp(app, 'iconmember');
  await befriend(app, alice, member);
  await call(app, alice, 'POST', `/api/guilds/${club.id}/members`, {
    userId: member.id,
    envelope: envelope(),
  });
  const downloaded = await call(app, member, 'GET', `/api/images/${imageId}`);
  check(
    downloaded.statusCode === 200 && downloaded.rawPayload.equals(secretIcon),
    'the members of the group read the icon (still ciphertext)',
  );
  check(
    (await call(app, member, 'GET', '/api/guilds')).json().guilds[0].iconKey.keyVersion === 1,
    'and the sealed key of the icon comes with the group',
  );
  const newKeys = [
    { userId: alice.id, ...envelope() },
    { userId: member.id, ...envelope() },
  ];
  check(
    (
      await call(app, alice, 'POST', `/api/guilds/${club.id}/rotate`, {
        keyVersion: 2,
        meta: await metaOf(app, alice, club.id, 2),
        envelopes: newKeys,
      })
    ).statusCode === 400,
    'a new key of the group needs the key of the icon sealed again with it',
  );
  check(
    (
      await call(app, alice, 'POST', `/api/guilds/${club.id}/rotate`, {
        keyVersion: 2,
        iconKey: { iv: blob(12), data: blob(48) },
        meta: await metaOf(app, alice, club.id, 2),
        envelopes: newKeys,
      })
    ).statusCode === 200,
    'and with it the new key is accepted',
  );
  check(
    (await call(app, member, 'GET', '/api/guilds')).json().guilds[0].iconKey.keyVersion === 2,
    'the key of the icon follows the key of the group',
  );
  // (the member is sent away again, so that the pictures tests below still start with nobody around the owner)
  await call(app, alice, 'DELETE', `/api/friends/${member.id}`);
  check(
    (await call(app, member, 'GET', `/api/images/${imageId}`)).statusCode === 404,
    'whoever leaves the group is not given the icon any more',
  );
  check(
    String(downloaded.headers['content-security-policy']).includes('sandbox'),
    'and the pictures are served sandboxed',
  );
  check(downloaded.headers['x-content-type-options'] === 'nosniff', 'and with nosniff');
  check(
    (await call(app, null, 'GET', `/api/images/${imageId}`)).statusCode === 401,
    'a visitor without a session gets no picture',
  );
  check(
    (await call(app, bob, 'GET', `/api/images/${randomUUID()}`)).statusCode === 404,
    'an unknown picture is 404',
  );
  for (const bad of ['..%2F..%2Fsecrets.json', '..%2Fimages%2F' + imageId + '%2F..%2F..']) {
    const res = await call(app, bob, 'GET', `/api/images/${bad}`);
    check(
      res.statusCode === 404 || res.statusCode === 400,
      `a path in place of an id gives nothing (${bad.slice(0, 18)})`,
    );
  }
  step('profile pictures are end-to-end encrypted');
  const secretPicture = randomBytes(300);
  const avatarUp = await upload(alice, secretPicture, 'avatar');
  check(avatarUp.statusCode === 201, 'a profile picture is stored as the ciphertext it arrives as');
  const avatarId = avatarUp.json().id;
  check(
    fs.readFileSync(path.join(app.ctx.config.uploadDir, 'images', avatarId)).equals(secretPicture),
    'the server keeps the bytes untouched (it cannot read or rebuild them)',
  );
  check(
    (await upload(alice, Buffer.from('tiny'), 'avatar')).statusCode === 400,
    'too short to be ciphertext is refused',
  );
  check(
    (await call(app, bob, 'GET', `/api/images/${avatarId}`)).statusCode === 404,
    'a person without a key gets nothing, as if it did not exist',
  );
  check(
    (await call(app, alice, 'GET', `/api/images/${avatarId}`)).statusCode === 404,
    'not even the owner reads it before a key exists (their browser seals one for them)',
  );
  check(
    (await call(app, bob, 'GET', `/api/images/${avatarId}/audience`)).statusCode === 404,
    'only the owner asks who is missing a key',
  );
  const audience0 = (await call(app, alice, 'GET', `/api/images/${avatarId}/audience`)).json();
  check(
    audience0.missing.length === 1 && audience0.missing[0].id === alice.id,
    'a stranger is not in the audience; the owner is',
  );
  const mutual = await befriend(app, alice, bob);
  void mutual;
  const audience1 = (await call(app, alice, 'GET', `/api/images/${avatarId}/audience`)).json();
  check(
    audience1.missing.some(function (m: { id: string }) {
      return m.id === bob.id;
    }),
    'a friend joins the audience',
  );
  const keyFor = function (viewer: Account) {
    return {
      viewerId: viewer.id,
      iv: Buffer.alloc(12, 1).toString('base64'),
      ciphertext: Buffer.alloc(48, 2).toString('base64'),
    };
  };
  check(
    (
      await call(app, bob, 'PUT', `/api/images/${avatarId}/keys`, {
        keys: [keyFor(bob)],
      })
    ).statusCode === 404,
    'only the owner can seal keys',
  );
  const carolStranger = await signUp(app, 'carol2');
  const sealedKeys = await call(app, alice, 'PUT', `/api/images/${avatarId}/keys`, {
    keys: [keyFor(alice), keyFor(bob), keyFor(carolStranger)],
  });
  check(sealedKeys.json().stored === 2, 'keys for people outside the audience are dropped');
  check(
    (await call(app, bob, 'GET', `/api/images/${avatarId}`)).rawPayload.equals(secretPicture),
    'with a key sealed for them, a friend downloads the ciphertext',
  );
  const opened = (await call(app, bob, 'GET', `/api/images/${avatarId}/open`)).json();
  check(
    opened.ownerEcdh ===
      (
        app.ctx.db.prepare('SELECT pub_ecdh AS k FROM users WHERE id = ?').get(alice.id) as {
          k: string;
        }
      ).k && Buffer.from(opened.data, 'base64').equals(secretPicture),
    'and gets, in one answer, the picture and the key sealed for them with the public key of the owner',
  );
  check(
    (await call(app, carolStranger, 'GET', `/api/images/${avatarId}`)).statusCode === 404,
    'a stranger still gets nothing',
  );
  check(
    (await call(app, carolStranger, 'GET', `/api/images/${avatarId}/open`)).statusCode === 404,
    'and no key',
  );
  check(canSeeProfile(app.ctx.db, alice.id, bob.id), 'a friend may see the pictures');
  await call(app, alice, 'DELETE', `/api/friends/${bob.id}`);
  // (the direct conversation of the two is kept after the friendship ends, and it also counts: take it out for this check)
  app.ctx.db.prepare('DELETE FROM dm_members WHERE user_id IN (?, ?)').run(alice.id, bob.id);
  check(
    !canSeeProfile(app.ctx.db, alice.id, bob.id),
    'a person who is no longer a friend may not see them, although their key is still stored',
  );
  await befriend(app, alice, bob);
  check(
    (await call(app, bob, 'PATCH', '/api/me', { avatarImage: avatarId })).statusCode === 400,
    "nobody can use another person's picture as theirs",
  );
  check(
    (await call(app, alice, 'PATCH', '/api/me', { avatarImage: avatarId })).statusCode === 200,
    'the owner can use their picture',
  );
  check(
    (await call(app, alice, 'PATCH', '/api/me', { nameFx: '<script>' })).statusCode === 400,
    'an animation of the name that is not in the list is refused',
  );
  const animated = await call(app, alice, 'PATCH', '/api/me', {
    nameFx: 'glow',
  });
  check(
    animated.statusCode === 200 && animated.json().user.nameFx === 'glow',
    'the animation of the name is saved and comes back with the profile',
  );
  app.ctx.db
    .prepare(
      "INSERT INTO images (id, owner_id, kind, mime, size, created_at, encrypted) VALUES ('old-plain', ?, 'avatar', 'image/png', 3, ?, 0)",
    )
    .run(bob.id, Date.now());
  app.ctx.db.prepare("UPDATE users SET avatar_image = 'old-plain' WHERE id = ?").run(bob.id);
  check(
    runMaintenance(app.ctx).plainPictures === 1,
    'a picture stored before the encryption is erased',
  );
  check(
    !app.ctx.db.prepare("SELECT 1 FROM images WHERE id = 'old-plain'").get() &&
      (
        app.ctx.db.prepare('SELECT avatar_image AS a FROM users WHERE id = ?').get(bob.id) as {
          a: string | null;
        }
      ).a === null,
    'and its owner is left without it, to upload it again',
  );

  step('rate limits: a route with a limit of its own has its own counter');
  const limited = await makeApp();
  const heavy = await signUp(limited, 'heavy');
  for (let i = 0; i < 30; i++) await call(limited, heavy, 'GET', '/api/friends');
  const uploaded = await limited.inject({
    method: 'POST',
    url: '/api/images?kind=avatar',
    headers: { ...bearer(heavy), 'content-type': 'application/octet-stream' },
    payload: randomBytes(64),
  });
  check(
    uploaded.statusCode === 201,
    'an upload is not refused because the same address made 30 other requests in the minute',
  );
  await limited.close();

  step('settings of the account: sealed, versioned, private');
  const sealedSettings = {
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
  };
  check(
    (
      await call(app, null, 'PUT', '/api/me/settings', {
        ...sealedSettings,
        base: 0,
      })
    ).statusCode === 401,
    'saving settings needs a session',
  );
  check(
    (await call(app, alice, 'GET', '/api/me/settings')).json().empty === true,
    'a person with none saved gets an empty answer',
  );
  const first = await call(app, alice, 'PUT', '/api/me/settings', {
    ...sealedSettings,
    base: 0,
  });
  check(first.statusCode === 200 && first.json().updatedAt > 0, 'the first save works');
  check(
    (await call(app, alice, 'GET', '/api/me/settings')).json().ciphertext ===
      sealedSettings.ciphertext,
    'and comes back as it was sealed (the server keeps no plain text)',
  );
  check(
    (
      await call(app, alice, 'PUT', '/api/me/settings', {
        ...sealedSettings,
        base: 0,
      })
    ).statusCode === 409,
    'a save made on an old version is refused (409), so nothing is lost silently',
  );
  const second = await call(app, alice, 'PUT', '/api/me/settings', {
    ...sealedSettings,
    base: first.json().updatedAt,
  });
  check(
    second.statusCode === 200 && second.json().updatedAt > first.json().updatedAt,
    'a save made on the last version works',
  );
  check(
    (
      await call(app, alice, 'PUT', '/api/me/settings', {
        iv: '<b>',
        ciphertext: 'x',
        base: second.json().updatedAt,
      })
    ).statusCode === 400,
    'something that is not sealed base64 is refused',
  );
  check(
    (await call(app, bob, 'GET', '/api/me/settings')).json().empty === true,
    'nobody sees the settings of another person',
  );

  step('maintenance: abandoned uploads and dead sessions');
  const addPicture = function (age: number): string {
    const id = randomUUID();
    fs.writeFileSync(path.join(app.ctx.config.uploadDir, 'images', id), randomBytes(64));
    app.ctx.db
      .prepare(
        "INSERT INTO images (id, owner_id, kind, mime, size, created_at, encrypted) VALUES (?, ?, 'banner', 'application/octet-stream', 64, ?, 1)",
      )
      .run(id, alice.id, Date.now() - age);
    return id;
  };
  const abandoned = addPicture(IMAGE_GRACE_MS + 1000);
  const recent = addPicture(0);
  const report = runMaintenance(app.ctx);
  check(report.images === 1, 'an old picture that nothing uses is removed ');
  check(!fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', abandoned)), 'with its file');
  check(
    fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', recent)) &&
      fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', avatarId)),
    'a new upload and a picture in use stay',
  );
  app.ctx.db.prepare('UPDATE sessions SET expires_at = 1 WHERE user_id = ?').run(bob.id);
  check(runMaintenance(app.ctx).sessions >= 1, 'expired sessions are removed');
  await app.close();
}
