/**
 * test/security/sockets.mts
 * WebSocket abuse: origins, frames, rooms and relayed signals.
 */
import {
  check,
  step,
  sleep,
  until,
  makeApp,
  signUp,
  call,
  befriend,
  blob,
  openSocket,
  WebSocket,
} from './support.mts';

/** WebSocket abuse: origins, frames, rooms and relayed signals. */
export async function checkSockets(): Promise<void> {
  step('realtime: authentication, origins and signaling');
  const app = await makeApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');
  const mallory = await signUp(app, 'mallory');
  const dm = await befriend(app, alice, bob);

  const evil = await openSocket(port, alice.access, {
    origin: 'http://evil.test',
  });
  check((await evil.closed) === 1008, 'a page of another site cannot open the socket');
  const silent = await openSocket(port, null);
  await silent.open;
  silent.send({ t: 'ping' });
  check((await silent.closed) === 4401, 'a first frame that is not the login closes the socket');
  const bad = await openSocket(port, 'not-a-token');
  check((await bad.closed) === 4401, 'an invalid token closes the socket');
  const junk = await openSocket(port, alice.access);
  await junk.ready;
  junk.raw('this is not json');
  check((await junk.closed) === 1003, 'a frame that is not JSON closes the socket');
  const huge = await openSocket(port, alice.access);
  await huge.ready;
  huge.raw(JSON.stringify({ t: 'typing', filler: 'x'.repeat(70_000) }));
  const hugeCode = await huge.closed;
  check(
    hugeCode === 1009 || hugeCode === 1006,
    `a frame over 64 KB closes the socket (code ${hugeCode})`,
  );

  const a = await openSocket(port, alice.access);
  const b = await openSocket(port, bob.access);
  const m = await openSocket(port, mallory.access);
  await Promise.all([a.ready, b.ready, m.ready]);
  m.send({ t: 'call.join', roomId: dm });
  check(
    await until(function refused() {
      return m.frames.some(function isError(f) {
        return f['t'] === 'error' && f['code'] === 'room_not_found';
      });
    }),
    'an unrelated account cannot join the call of a direct chat',
  );
  m.send({ t: 'typing', channelId: dm });
  a.send({ t: 'call.join', roomId: dm });
  check(
    await until(function ringing() {
      return b.frames.some(function isIncoming(f) {
        return f['t'] === 'call.incoming';
      });
    }),
    'the friend is told about the call',
  );
  check(
    !b.frames.some(function isTyping(f) {
      return f['t'] === 'typing' && f['userId'] === mallory.id;
    }),
    'typing in a channel that is not yours reaches nobody',
  );
  m.send({ t: 'rtc.signal', roomId: dm, to: bob.id, payload: { sdp: 'evil' } });
  b.send({ t: 'call.join', roomId: dm });
  await until(function bothIn() {
    return a.frames.some(function isState(f) {
      return f['t'] === 'call.state' && (f['participants'] as unknown[]).length === 2;
    });
  });
  await sleep(150);
  check(
    !b.frames.some(function isSignal(f) {
      return f['t'] === 'rtc.signal' && f['from'] === mallory.id;
    }),
    'a signal from somebody who is not in the room is not relayed',
  );
  a.send({ t: 'rtc.signal', roomId: dm, to: bob.id, payload: { sdp: 'ok' } });
  check(
    await until(function relayed() {
      return b.frames.some(function isSignal(f) {
        return f['t'] === 'rtc.signal' && f['from'] === alice.id;
      });
    }),
    'a signal between two people of the room is relayed, and carries the real sender',
  );
  const signals = function (): number {
    return b.frames.filter(function isSignal(f) {
      return f['t'] === 'rtc.signal';
    }).length;
  };
  const before = signals();
  a.send({
    t: 'rtc.signal',
    roomId: dm,
    to: bob.id,
    payload: { blob: 'x'.repeat(50_000) },
  });
  a.send({
    t: 'rtc.signal',
    roomId: dm,
    to: mallory.id,
    payload: { sdp: 'leak' },
  });
  a.send({ t: 'rtc.signal', roomId: dm, to: bob.id, payload: 'not an object' });
  await sleep(200);
  check(signals() === before, 'oversized, misdirected and malformed signals are dropped');
  check(
    !m.frames.some(function isSignal(f) {
      return f['t'] === 'rtc.signal';
    }),
    'a signal addressed to somebody outside the room is not delivered to them',
  );
  await checkFloods(alice, bob, dm, a, b);
  await checkSettingsNotice(app, alice, a, b);
  await checkOneDevicePerCall(port, alice, bob, dm, a, b);
  await app.close();
}

/** Saving the settings tells the other devices of the same person (only the version), and nobody else. */
async function checkSettingsNotice(
  app: Awaited<ReturnType<typeof makeApp>>,
  alice: Awaited<ReturnType<typeof signUp>>,
  a: Awaited<ReturnType<typeof openSocket>>,
  b: Awaited<ReturnType<typeof openSocket>>,
): Promise<void> {
  const saved = await call(app, alice, 'PUT', '/api/me/settings', {
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'A'.repeat(32),
    base: 0,
  });
  const version = saved.json().updatedAt;
  check(
    await until(function told() {
      return a.frames.some(function isNotice(f) {
        return f['t'] === 'settings.changed' && f['updatedAt'] === version;
      });
    }),
    'a device of the person hears that the settings changed (with the new version only)',
  );
  check(
    a.frames.every(function noBlob(f) {
      return f['t'] !== 'settings.changed' || !('ciphertext' in f);
    }) &&
      !b.frames.some(function isNotice(f) {
        return f['t'] === 'settings.changed';
      }),
    'the notice carries no settings and reaches nobody else',
  );
}

/** A client repeating "typing" or the same status cannot make the server flood the others with them. */
async function checkFloods(
  alice: { id: string },
  bob: { id: string },
  dm: string,
  a: Awaited<ReturnType<typeof openSocket>>,
  b: Awaited<ReturnType<typeof openSocket>>,
): Promise<void> {
  const typingOfBob = function (): number {
    return a.frames.filter(function isTyping(f) {
      return f['t'] === 'typing' && f['userId'] === bob.id;
    }).length;
  };
  const typingBefore = typingOfBob();
  for (let i = 0; i < 30; i++) b.send({ t: 'typing', channelId: dm });
  await sleep(250);
  check(typingOfBob() - typingBefore === 1, '30 "typing" in a row reach the others once');
  const presenceOfAlice = function (): number {
    return b.frames.filter(function isPresence(f) {
      return f['t'] === 'presence' && f['userId'] === alice.id;
    }).length;
  };
  a.send({ t: 'presence.set', status: 'dnd' });
  await until(function changed() {
    return presenceOfAlice() > 0;
  });
  const presenceBefore = presenceOfAlice();
  for (let i = 0; i < 30; i++) a.send({ t: 'presence.set', status: 'dnd' });
  await sleep(250);
  check(
    presenceOfAlice() === presenceBefore,
    'the same status again is not sent to the friends again',
  );
  a.send({ t: 'presence.set', status: 'online' });
}

/**
 * A person signed in on two devices is in a call on only one of them: joining from the second moves the place there,
 * the first is told and can no longer send signals nor end the call, and signals reach only the device in the call.
 */
async function checkOneDevicePerCall(
  port: number,
  alice: { id: string; access: string },
  bob: { id: string },
  dm: string,
  a: Awaited<ReturnType<typeof openSocket>>,
  b: Awaited<ReturnType<typeof openSocket>>,
): Promise<void> {
  step(
    'realtime: one device per person in a call (moving the call from the phone to the computer)',
  );
  const second = await openSocket(port, alice.access);
  await second.ready;
  second.send({ t: 'call.join', roomId: dm });
  check(
    await until(function moved() {
      return a.frames.some(function isMoved(f) {
        return f['t'] === 'call.transferred' && f['roomId'] === dm;
      });
    }),
    'the first device is told that its call moved to the other device',
  );
  check(
    await until(function joinedHere() {
      return second.frames.some(function isJoined(f) {
        return f['t'] === 'call.joined' && f['roomId'] === dm;
      });
    }),
    'the second device is in the call',
  );
  const countFrom = function (socket: typeof a, from: string): number {
    return socket.frames.filter(function isSignal(f) {
      return f['t'] === 'rtc.signal' && f['from'] === from;
    }).length;
  };
  const oldBefore = a.frames.filter(function isSignal(f) {
    return f['t'] === 'rtc.signal';
  }).length;
  b.send({ t: 'rtc.signal', roomId: dm, to: alice.id, payload: { sdp: 'to the new device' } });
  check(
    await until(function arrived() {
      return countFrom(second, bob.id) === 1;
    }),
    'a signal for the person reaches the device that is in the call',
  );
  await sleep(150);
  check(
    a.frames.filter(function isSignal(f) {
      return f['t'] === 'rtc.signal';
    }).length === oldBefore,
    'the device that left the call no longer gets its signals',
  );
  const bobBefore = countFrom(b, alice.id);
  a.send({ t: 'rtc.signal', roomId: dm, to: bob.id, payload: { sdp: 'stale' } });
  a.send({ t: 'call.leave' });
  await sleep(200);
  check(countFrom(b, alice.id) === bobBefore, 'the old device cannot send signals any more');
  const stateHasAlice = function (): boolean {
    const states = b.frames.filter(function isState(f) {
      return f['t'] === 'call.state' && f['roomId'] === dm;
    });
    const last = states[states.length - 1] as { participants: { userId: string }[] } | undefined;
    return !!last?.participants.some(function isAlice(p) {
      return p.userId === alice.id;
    });
  };
  check(
    stateHasAlice(),
    'a late "leave" from the old device does not take the person out of the call',
  );
  second.close();
  // ! The place is KEPT for a while after the connection drops (a phone in the background or on another network comes back): the
  //   person is still in the call, and a connection that asks for it with call.resume gets it again.
  await sleep(500);
  check(
    stateHasAlice(),
    'closing the connection that is in the call keeps the place of the person for a while',
  );
  const third = await openSocket(port, alice.access);
  await third.ready;
  third.send({ t: 'call.resume', roomId: 'no-such-room' });
  check(
    await until(function refused() {
      return third.frames.some(function isRefused(f) {
        return f['t'] === 'call.resume.failed';
      });
    }),
    'a resume for a room the person does not hold is refused',
  );
  third.send({ t: 'call.resume', roomId: dm });
  check(
    await until(function resumed() {
      return third.frames.some(function isResumed(f) {
        return f['t'] === 'call.resumed' && f['roomId'] === dm;
      });
    }),
    'a connection that asks for the kept place gets it back (call.resumed)',
  );
  third.send({ t: 'call.leave' });
  check(
    await until(function left() {
      return !stateHasAlice();
    }),
    'after resuming, leaving takes the person out of the call as always',
  );
  const fourth = await openSocket(port, alice.access);
  await fourth.ready;
  fourth.send({ t: 'call.resume', roomId: dm });
  check(
    await until(function refusedAgain() {
      return fourth.frames.some(function isRefused(f) {
        return f['t'] === 'call.resume.failed';
      });
    }),
    'nothing is kept after the person left: resuming is refused',
  );
  third.close();
  fourth.close();
}
