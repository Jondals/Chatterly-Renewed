/**
 * test/security/deletion.mts
 * Deleting an account removes the person and keeps what belongs to other people.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  check,
  step,
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

/** Deleting an account removes the person and keeps what belongs to other people. */
export async function checkDeletion(): Promise<void> {
  step('account deletion: groups of other people survive');
  const app = await makeApp();
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const carol = await signUp(app, 'carol');
  const dm = await befriend(app, alice, bob);
  await befriend(app, alice, carol);

  const club = await makeGuild(app, alice);
  await call(app, alice, 'POST', `/api/guilds/${club.id}/members`, {
    userId: bob.id,
    envelope: envelope(),
  });
  await call(app, bob, 'POST', `/api/guild-invites/${club.id}/accept`);
  app.ctx.db
    .prepare('UPDATE guild_members SET joined_at = 1000 WHERE guild_id = ? AND user_id = ?')
    .run(club.id, alice.id);
  app.ctx.db
    .prepare('UPDATE guild_members SET joined_at = 2000 WHERE guild_id = ? AND user_id = ?')
    .run(club.id, bob.id);
  await call(app, alice, 'POST', `/api/guilds/${club.id}/members`, {
    userId: carol.id,
    envelope: envelope(),
  });
  await call(app, carol, 'POST', `/api/guild-invites/${club.id}/accept`);
  app.ctx.db
    .prepare('UPDATE guild_members SET joined_at = 3000 WHERE guild_id = ? AND user_id = ?')
    .run(club.id, carol.id);
  const alone = await makeGuild(app, alice);
  const icon = await app.inject({
    method: 'POST',
    url: `/api/images?kind=group&guild=${club.id}`,
    headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
    payload: randomBytes(64),
  });
  const iconId = icon.json().id;
  await call(app, alice, 'PATCH', `/api/guilds/${club.id}`, {
    iconImage: iconId,
    iconKey: { version: 1, iv: blob(12), data: blob(48) },
  });
  const avatar = (
    await app.inject({
      method: 'POST',
      url: '/api/images?kind=avatar',
      headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
      payload: randomBytes(64),
    })
  ).json().id;
  await call(app, alice, 'PATCH', '/api/me', { avatarImage: avatar });
  await call(app, alice, 'POST', `/api/channels/${club.text}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });
  await call(app, bob, 'POST', `/api/channels/${club.text}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });
  const aliceFile = (
    await app.inject({
      method: 'POST',
      url: `/api/channels/${club.text}/files`,
      headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
      payload: randomBytes(64),
    })
  ).json().fileId;
  await call(app, alice, 'POST', `/api/channels/${dm}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });

  step('account deletion: a failed deletion changes nothing');
  app.ctx.db.exec(
    "CREATE TRIGGER block_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'blocked'); END",
  );
  const failed = await call(app, alice, 'POST', '/api/me/delete', {
    authSecret: alice.authSecret,
  });
  check(
    failed.statusCode === 500,
    'when the database refuses, the request fails (and shows no internals)',
  );
  check(
    failed.json().error === 'internal_error' && !failed.body.includes('blocked'),
    'the error says nothing about the cause',
  );
  const db = app.ctx.db;
  check(
    (
      db.prepare('SELECT owner_id FROM guilds WHERE id = ?').get(club.id) as {
        owner_id: string;
      }
    ).owner_id === alice.id,
    'the group still belongs to its owner after the failure',
  );
  check(
    (
      db.prepare('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ?').get(club.text) as {
        n: number;
      }
    ).n === 2,
    'no message was lost',
  );
  check(
    Boolean(db.prepare('SELECT 1 FROM files WHERE id = ?').get(aliceFile)),
    'no file row was lost',
  );
  check(
    Boolean(db.prepare('SELECT 1 FROM sessions WHERE user_id = ?').get(alice.id)),
    'the session survived the failure',
  );
  db.exec('DROP TRIGGER block_user_delete');

  step('account deletion: the wrong password, then the right one');
  const wrong = await call(app, alice, 'POST', '/api/me/delete', {
    authSecret: randomBytes(32).toString('base64'),
  });
  check(wrong.statusCode === 401, 'a wrong proof of the password does not delete anything');
  check(
    (await call(app, alice, 'GET', '/api/me')).statusCode === 200,
    'the account is still there',
  );
  const gone = await call(app, alice, 'POST', '/api/me/delete', {
    authSecret: alice.authSecret,
  });
  check(gone.statusCode === 204, 'the right proof deletes the account');
  check(
    (await call(app, alice, 'GET', '/api/me')).statusCode === 401,
    'the old access token is dead',
  );
  check(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: alice.refresh },
      })
    ).statusCode === 401,
    'the old refresh token is dead',
  );
  check(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: alice.username, authSecret: alice.authSecret },
      })
    ).statusCode === 401,
    'the name cannot sign in',
  );
  check(!db.prepare('SELECT 1 FROM users WHERE id = ?').get(alice.id), 'the account row is gone');
  for (const table of [
    'sessions',
    'spent_tokens',
    'friendships',
    'guild_members',
    'guild_keys',
    'dm_members',
    'messages',
    'reactions',
    'files',
    'images',
    'channel_receipts',
    'guild_member_tags',
  ]) {
    const column =
      table === 'friendships'
        ? 'user_a = ? OR user_b = ?'
        : table === 'messages'
          ? 'sender_id = ?'
          : table === 'files'
            ? 'uploader_id = ?'
            : table === 'images'
              ? 'owner_id = ?'
              : 'user_id = ?';
    const args = table === 'friendships' ? [alice.id, alice.id] : [alice.id];
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}`).get(...args) as {
      n: number;
    };
    check(row.n === 0, `nothing of the account stays in ${table}`);
  }
  check(
    !db.prepare('SELECT 1 FROM channels WHERE id = ?').get(dm),
    'the direct conversation is erased',
  );
  check(
    !fs.existsSync(path.join(app.ctx.config.uploadDir, aliceFile)),
    'the files of the person are erased from the disk',
  );
  check(
    !fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', avatar)),
    'their profile picture is erased from the disk',
  );

  step('account deletion: what belongs to other people stays usable');
  const guild = db
    .prepare('SELECT owner_id, needs_rotation, icon_image FROM guilds WHERE id = ?')
    .get(club.id) as
    { owner_id: string; needs_rotation: number; icon_image: string | null } | undefined;
  check(guild !== undefined, 'a group with other members is NOT destroyed when its owner leaves');
  check(guild?.owner_id === bob.id, 'it passes to the member who has been in it the longest');
  check(
    guild?.needs_rotation === 1,
    'and its key is marked for renewal, because the old owner held it',
  );
  check(
    (
      db
        .prepare('SELECT role FROM guild_members WHERE guild_id = ? AND user_id = ?')
        .get(club.id, bob.id) as { role: string }
    ).role === 'owner',
    'the new owner has the owner role',
  );
  check(
    (
      db.prepare('SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?').get(club.id) as {
        n: number;
      }
    ).n === 2,
    'the group has no ghost member',
  );
  check(
    guild?.icon_image === iconId &&
      fs.existsSync(path.join(app.ctx.config.uploadDir, 'images', iconId)),
    'the icon of the group stays',
  );
  check(
    (
      db.prepare('SELECT owner_id FROM images WHERE id = ?').get(iconId) as {
        owner_id: string;
      }
    ).owner_id === bob.id,
    'and now belongs to the new owner',
  );
  const bobView = (await call(app, bob, 'GET', '/api/guilds')).json();
  const mine = bobView.guilds.find(function isClub(g: { id: string }) {
    return g.id === club.id;
  });
  check(
    Boolean(mine) && mine.ownerId === bob.id && mine.keys.length >= 1,
    'the new owner still has the key envelopes of the group',
  );
  check(
    mine.keys.every(function wrapped(k: { wrapperId: string; wrapperPub: string | null }) {
      return k.wrapperId !== alice.id || Boolean(k.wrapperPub);
    }),
    'envelopes wrapped by the erased person carry their public key, so they can still be opened',
  );
  check(
    (await call(app, carol, 'GET', `/api/channels/${club.text}/messages`)).statusCode === 200,
    'other members still read the group',
  );
  const remaining = (await call(app, carol, 'GET', `/api/channels/${club.text}/messages`)).json()
    .messages;
  check(
    remaining.length === 1 && remaining[0].senderId === bob.id,
    "only the erased person's messages disappeared",
  );
  check(
    (
      await call(app, bob, 'POST', `/api/channels/${club.text}/messages`, {
        ...sealed(),
        keyVersion: 1,
      })
    ).statusCode === 201,
    'the group can still be used',
  );
  check(
    !db.prepare('SELECT 1 FROM guilds WHERE id = ?').get(alone.id),
    'a group with nobody else in it is erased',
  );
  check(
    (
      await call(app, bob, 'POST', `/api/guilds/${club.id}/rotate`, {
        keyVersion: 2,
        iconKey: { iv: blob(12), data: blob(48) },
        meta: await metaOf(app, bob, club.id, 2),
        envelopes: [
          { userId: bob.id, ...envelope() },
          { userId: carol.id, ...envelope() },
        ],
      })
    ).statusCode === 200,
    'the new owner can renew the key and clear the warning',
  );
  check(
    (
      db.prepare('SELECT needs_rotation FROM guilds WHERE id = ?').get(club.id) as {
        needs_rotation: number;
      }
    ).needs_rotation === 0,
    'the renewal is recorded',
  );
  await app.close();
}
