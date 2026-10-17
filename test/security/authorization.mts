/**
 * test/security/authorization.mts
 * Other people's channels, files, groups and pictures cannot be reached by guessing or changing an id.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  check,
  step,
  until,
  makeApp,
  signUp,
  bearer,
  call,
  befriend,
  sealed,
  envelope,
  sealedName,
  metaOf,
  makeGuild,
} from './support.mts';

/** Other people's channels, files, groups and pictures cannot be reached by guessing or changing an id. */
export async function checkAuthorization(): Promise<void> {
  step('authorization: ids of other people');
  const app = await makeApp();
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const mallory = await signUp(app, 'mallory');
  const channel = await befriend(app, alice, bob);
  const mallory2 = await signUp(app, 'writer');
  const quotaChannel = await befriend(app, alice, mallory2);

  const posted = await call(app, alice, 'POST', `/api/channels/${channel}/messages`, {
    ...sealed(),
    keyVersion: 1,
  });
  check(posted.statusCode === 201, 'a member can post in their direct channel');
  // one account cannot fill the disk with messages of the largest size
  const heavy = { ...sealed(), ciphertext: 'A'.repeat(90_000), keyVersion: 1 };
  let refusedAt = 0;
  for (let n = 1; n <= 110 && !refusedAt; n++) {
    const res = await call(app, mallory2, 'POST', `/api/channels/${quotaChannel}/messages`, heavy);
    if (res.statusCode === 429) {
      refusedAt = n;
      check(
        res.json().error === 'write_quota',
        'the answer says it is the limit of what was written',
      );
    }
  }
  check(
    refusedAt > 20 && refusedAt < 110,
    'an account that writes too much in an hour is stopped (at ' + refusedAt + ')',
  );
  const messageId = posted.json().message.id;
  const upload = await app.inject({
    method: 'POST',
    url: `/api/channels/${channel}/files`,
    headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
    payload: randomBytes(64),
  });
  check(upload.statusCode === 201, 'a member can upload an encrypted attachment');
  const fileId = upload.json().fileId;
  check(
    (await call(app, bob, 'GET', `/api/files/${fileId}`)).statusCode === 200,
    'the other member downloads it',
  );

  const missing = randomUUID();
  const probes: [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?][] = [
    ['read the messages of a channel', 'GET', `/api/channels/${channel}/messages`],
    [
      'post in a channel',
      'POST',
      `/api/channels/${channel}/messages`,
      { ...sealed(), keyVersion: 1 },
    ],
    ['read the receipts of a channel', 'GET', `/api/channels/${channel}/receipts`],
    ['mark a channel as read', 'POST', `/api/channels/${channel}/receipt`, { read: 1 }],
    ['download an attachment', 'GET', `/api/files/${fileId}`],
    ['edit a message', 'PATCH', `/api/messages/${messageId}`, sealed()],
    ['delete a message', 'DELETE', `/api/messages/${messageId}`],
    ['react to a message', 'POST', `/api/messages/${messageId}/reactions`, sealed()],
  ];
  for (const [what, method, url, payload] of probes) {
    const outsider = await call(app, mallory, method, url, payload);
    const nobody = await call(
      app,
      mallory,
      method,
      url.replace(channel, missing).replace(messageId, missing).replace(fileId, missing),
      payload,
    );
    check(outsider.statusCode === 404, `an unrelated account cannot ${what} (404)`);
    check(
      outsider.statusCode === nobody.statusCode && outsider.body === nobody.body,
      `...and it cannot tell it from an id that does not exist (${what})`,
    );
    const anonymous = await call(app, null, method, url, payload);
    check(anonymous.statusCode === 401, `without a session nobody can ${what} (401)`);
  }
  const upload2 = await app.inject({
    method: 'POST',
    url: `/api/channels/${channel}/files`,
    headers: { ...bearer(mallory), 'content-type': 'application/octet-stream' },
    payload: randomBytes(64),
  });
  check(upload2.statusCode === 404, 'an unrelated account cannot upload into a channel');
  check(
    (await call(app, mallory, 'POST', '/api/dms', { userId: alice.id })).statusCode === 403,
    'direct chats only exist between friends',
  );
  for (const bad of ['..%2F..%2Fsecrets.json', '%00', 'x'.repeat(300), "1' OR '1'='1"]) {
    const res = await call(app, mallory, 'GET', `/api/files/${bad}`);
    check(
      [400, 404, 414].includes(res.statusCode),
      `a hostile file id is refused (${bad.slice(0, 16)}: ${res.statusCode})`,
    );
  }

  step('authorization: groups, and access that is taken away');
  const guild = await makeGuild(app, alice);
  check(
    (
      await call(app, bob, 'POST', `/api/guilds/${guild.id}/members`, {
        userId: mallory.id,
        envelope: envelope(),
      })
    ).statusCode === 404,
    'a person outside a group cannot bring anybody in',
  );
  const added = await call(app, alice, 'POST', `/api/guilds/${guild.id}/members`, {
    userId: bob.id,
    envelope: envelope(),
  });
  check(added.statusCode === 201, 'the owner invites a friend to the group');
  check(
    (await call(app, bob, 'GET', '/api/guilds')).json().guilds.length === 0,
    'an invited friend is not in the group until they accept',
  );
  const waiting = (await call(app, bob, 'GET', '/api/guild-invites')).json();
  check(
    waiting.invites.length === 1 &&
      waiting.invites[0].guildId === guild.id &&
      waiting.invites[0].inviterId === alice.id &&
      !!waiting.invites[0].envelope,
    'the invited friend sees the invitation with the key wrapped for them',
  );
  check(
    (await call(app, mallory, 'POST', `/api/guild-invites/${guild.id}/accept`)).statusCode === 404,
    'only the invited person can accept',
  );
  check(
    (await call(app, bob, 'POST', `/api/guild-invites/${guild.id}/decline`)).statusCode === 204 &&
      (await call(app, bob, 'GET', '/api/guild-invites')).json().invites.length === 0,
    'declining leaves nothing of the invitation',
  );
  await call(app, alice, 'POST', `/api/guilds/${guild.id}/members`, {
    userId: bob.id,
    envelope: envelope(),
  });
  check(
    (await call(app, bob, 'POST', `/api/guild-invites/${guild.id}/accept`)).statusCode === 200 &&
      (await call(app, bob, 'GET', '/api/guilds')).json().guilds.length === 1,
    'accepting puts the friend in the group',
  );
  const groupFile = await app.inject({
    method: 'POST',
    url: `/api/channels/${guild.text}/files`,
    headers: { ...bearer(alice), 'content-type': 'application/octet-stream' },
    payload: randomBytes(64),
  });
  const groupFileId = groupFile.json().fileId;
  check(
    (await call(app, bob, 'GET', `/api/files/${groupFileId}`)).statusCode === 200,
    'a member downloads the group file',
  );
  check(
    (await call(app, mallory, 'GET', `/api/files/${groupFileId}`)).statusCode === 404,
    'an outsider cannot download it',
  );
  check(
    (await call(app, bob, 'DELETE', `/api/guilds/${guild.id}`)).statusCode === 403,
    'a member cannot delete the group',
  );
  check(
    (
      await call(app, bob, 'POST', `/api/guilds/${guild.id}/channels`, {
        id: randomUUID(),
        name: sealedName(),
        type: 'text',
      })
    ).statusCode === 403,
    'a member cannot create channels',
  );
  // what a group is called is sealed in the browsers of its members: the server refuses text it could read
  check(
    (
      await call(app, alice, 'POST', `/api/guilds/${guild.id}/channels`, {
        id: randomUUID(),
        name: 'plain-channel',
        type: 'text',
      })
    ).statusCode === 400,
    'a channel name in clear is refused',
  );
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${guild.id}`, {
        name: 'In clear',
      })
    ).statusCode === 400,
    'a group name in clear is refused',
  );
  check(
    (
      await call(app, alice, 'POST', `/api/guilds`, {
        id: randomUUID(),
        name: 'In clear',
        envelope: envelope(),
        channels: [
          { id: randomUUID(), name: 'general', type: 'text' },
          { id: randomUUID(), name: 'Voice', type: 'voice' },
        ],
      })
    ).statusCode === 400,
    'a new group with names in clear is refused',
  );
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${guild.id}`, {
        name: sealedName(7),
      })
    ).statusCode === 409,
    'a name sealed with a key version the group does not have is refused',
  );
  check(
    (
      await call(app, alice, 'PATCH', `/api/guilds/${guild.id}`, {
        name: sealedName(1),
      })
    ).statusCode === 200,
    'a name sealed with the key of the group is accepted',
  );
  const tagged = await call(app, alice, 'POST', `/api/guilds/${guild.id}/tags`, {
    id: randomUUID(),
    name: sealedName(1),
  });
  check(tagged.statusCode === 201, 'a tag is created with its name and color sealed');
  check(
    (
      await call(app, alice, 'POST', `/api/guilds/${guild.id}/tags`, {
        id: randomUUID(),
        name: 'Plain',
        color: '#ff0000',
      })
    ).statusCode === 400,
    'a tag with its name in clear is refused',
  );
  const wholeMeta = await metaOf(app, alice, guild.id, 1);
  check(
    (await call(app, bob, 'PUT', `/api/guilds/${guild.id}/meta`, wholeMeta)).statusCode === 403,
    'a member cannot replace the names of the group',
  );
  check(
    (
      await call(app, alice, 'PUT', `/api/guilds/${guild.id}/meta`, {
        ...wholeMeta,
        channels: (wholeMeta.channels as { id: string; name: string }[]).slice(1),
      })
    ).statusCode === 409,
    'the names of the group are replaced all together (a channel missing is refused)',
  );
  check(
    (await call(app, alice, 'PUT', `/api/guilds/${guild.id}/meta`, wholeMeta)).statusCode === 200,
    'the owner replaces the names of the group by sealed ones',
  );
  const names = app.ctx.db
    .prepare(
      'SELECT name FROM channels WHERE guild_id = ? UNION ALL SELECT name FROM guild_tags WHERE guild_id = ? UNION ALL SELECT name FROM guilds WHERE id = ?',
    )
    .all(guild.id, guild.id, guild.id) as { name: string }[];
  check(
    names.length > 0 &&
      names.every(function sealed(row) {
        return row.name.startsWith('g1.');
      }),
    'in the database every name of the group is sealed',
  );
  check(
    (await call(app, bob, 'DELETE', `/api/guilds/${guild.id}/members/${alice.id}`)).statusCode ===
      400,
    'nobody removes the owner',
  );
  const left = await call(app, bob, 'DELETE', `/api/guilds/${guild.id}/members/${bob.id}`);
  check(left.statusCode === 204, 'a member can leave');
  check(
    (await call(app, bob, 'GET', `/api/files/${groupFileId}`)).statusCode === 404,
    'after leaving, the files of the group are closed',
  );
  check(
    (await call(app, bob, 'GET', `/api/channels/${guild.text}/messages`)).statusCode === 404,
    'after leaving, the messages of the group are closed',
  );
  const after = (await call(app, alice, 'GET', '/api/guilds')).json().guilds[0];
  check(after.needsRotation === true, 'after somebody leaves, the group key must be renewed');
  check(
    (
      await call(app, alice, 'POST', `/api/guilds/${guild.id}/members`, {
        userId: bob.id,
        envelope: envelope(),
      })
    ).statusCode === 409,
    'nobody can be added until the key is renewed',
  );

  step('direct links: /direct/<id> is only a screen; the data behind it is private');
  check(
    (await call(app, mallory, 'GET', `/api/channels/${channel}/messages`)).statusCode === 404,
    'the channel id of a /direct/<id> address gives an unrelated account nothing',
  );
  check(
    (await call(app, null, 'GET', `/api/channels/${channel}/messages`)).statusCode === 401,
    'and gives a visitor without a session nothing',
  );
  check(
    (await call(app, alice, 'GET', `/api/channels/${channel}/messages`)).statusCode === 200,
    'while the owner of the conversation reads it',
  );
  await app.close();
}
