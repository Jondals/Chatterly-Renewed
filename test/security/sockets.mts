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
  await app.close();
}
