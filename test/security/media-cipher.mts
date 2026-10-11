/**
 * test/security/media-cipher.mts
 * The frame cipher of the calls.
 */
import { randomBytes } from 'node:crypto';
import {
  MediaKeyChain,
  RATCHET_MS,
  TAG_BYTES,
  TRAILER_BYTES,
  deriveLinkSecrets,
  securityCode,
} from '../../frontend/src/app/core/crypto/media-cipher';
import { check, step } from './support.mts';

/** The frame cipher of the calls. */
export async function checkMediaCipher(): Promise<void> {
  step('calls: end-to-end frame encryption');
  const shared = randomBytes(32);
  const alice = await deriveLinkSecrets(
    shared.buffer.slice(shared.byteOffset, shared.byteOffset + 32),
    'alice',
    'bob',
  );
  const bob = await deriveLinkSecrets(
    shared.buffer.slice(shared.byteOffset, shared.byteOffset + 32),
    'bob',
    'alice',
  );
  check(
    Buffer.from(alice.send).equals(Buffer.from(bob.recv)),
    'each side derives the key the other one sends with',
  );
  check(
    Buffer.from(alice.send).equals(Buffer.from(alice.recv)) === false,
    'the two directions use different keys',
  );

  const frame = function (size = 120): ArrayBuffer {
    const bytes = randomBytes(size);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + size);
  };
  const copy = function (secret: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    return new Uint8Array(secret);
  };
  const sender = await MediaKeyChain.create(copy(alice.send));
  const receiver = await MediaKeyChain.create(copy(bob.recv));
  const plain = frame();
  const sealedFrame = await sender.encrypt(plain, 1);
  check(
    sealedFrame.byteLength === plain.byteLength + TAG_BYTES + TRAILER_BYTES,
    'a frame grows by the tag and the trailer only',
  );
  check(
    Buffer.from(sealedFrame).subarray(0, 1).equals(Buffer.from(plain).subarray(0, 1)),
    'the codec header stays readable',
  );
  check(
    !Buffer.from(sealedFrame).subarray(1, 100).equals(Buffer.from(plain).subarray(1, 100)),
    'the payload is not readable',
  );
  const opened = await receiver.decrypt(sealedFrame, 1);
  check(Buffer.from(opened).equals(Buffer.from(plain)), 'the other side recovers the exact frame');

  /** True when decrypting the frame fails. */
  const fails = async function (
    chain: MediaKeyChain,
    data: ArrayBuffer,
    header = 1,
  ): Promise<boolean> {
    try {
      await chain.decrypt(data, header);
      return false;
    } catch {
      return true;
    }
  };
  const fresh = async function (): Promise<MediaKeyChain> {
    return MediaKeyChain.create(copy(bob.recv));
  };
  const flip = function (data: ArrayBuffer, index: number): ArrayBuffer {
    const bytes = new Uint8Array(data.slice(0));
    bytes[index] = bytes[index]! ^ 0x01;
    return bytes.buffer;
  };
  const next = await sender.encrypt(frame(), 1);
  check(await fails(await fresh(), flip(next, 40)), 'a changed byte of the payload is detected');
  check(
    await fails(await fresh(), flip(next, 0)),
    'a changed header byte is detected (it is authenticated)',
  );
  check(
    await fails(await fresh(), flip(next, next.byteLength - 3)),
    'a changed counter is detected',
  );
  check(
    await fails(await fresh(), flip(next, next.byteLength - 1)),
    'a changed key id is detected',
  );
  check(await fails(await fresh(), next.slice(0, next.byteLength - 5)), 'a cut frame is detected');
  check(
    await fails(await fresh(), new ArrayBuffer(10)),
    'a frame shorter than the tag is detected',
  );
  check(
    await fails(await MediaKeyChain.create(copy(alice.recv)), next),
    'a frame reflected back to its sender is refused (the two directions use different keys)',
  );
  const stranger = await MediaKeyChain.create(new Uint8Array(randomBytes(32)));
  check(await fails(stranger, next), 'a frame cannot be opened with an unrelated key');

  const once = await sender.encrypt(frame(), 1);
  await receiver.decrypt(once, 1);
  check(await fails(receiver, once), 'a frame played again is refused (replay)');
  const batch = [
    await sender.encrypt(frame(), 1),
    await sender.encrypt(frame(), 1),
    await sender.encrypt(frame(), 1),
  ];
  let reordered = true;
  for (const index of [2, 0, 1]) {
    try {
      await receiver.decrypt(batch[index]!, 1);
    } catch {
      reordered = false;
    }
  }
  check(reordered, 'frames that arrive out of order are still accepted once');

  const counters = new Set<number>();
  const ivs = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const out = new Uint8Array(await sender.encrypt(frame(30), 1));
    const trailer = out.subarray(out.length - TRAILER_BYTES);
    const view = new DataView(trailer.buffer, trailer.byteOffset, TRAILER_BYTES);
    counters.add(view.getUint32(0) * 2 ** 32 + view.getUint32(4));
    ivs.add(Buffer.from(trailer.subarray(0, 8)).toString('hex') + trailer[8]);
  }
  check(counters.size === 200 && ivs.size === 200, 'the nonce of a key is never repeated');

  const rotating = await MediaKeyChain.create(copy(alice.send));
  const peer = await MediaKeyChain.create(copy(bob.recv));
  const early = await rotating.encrypt(frame(), 1);
  await rotating.maybeRatchet(Date.now() + RATCHET_MS + 1);
  check(rotating.keyId === 1, 'the sender moves to a new key after the interval');
  const late = await rotating.encrypt(frame(), 1);
  check(!(await fails(peer, late)), 'the receiver follows the key change');
  check(
    !(await fails(peer, early)),
    'a frame of the previous key still opens right after the change',
  );
  const forged = new Uint8Array(await rotating.encrypt(frame(), 1));
  forged[forged.length - 1] = (forged[forged.length - 1]! + 3) & 0xff;
  check(await fails(peer, forged.buffer), 'a frame with a made-up key id is refused');
  check(
    !(await fails(peer, await rotating.encrypt(frame(), 1))),
    'and the receiver keeps working afterwards (a forgery cannot desynchronise it)',
  );
  const far = await MediaKeyChain.create(copy(alice.send));
  for (let i = 0; i < 40; i++) await far.maybeRatchet(Date.now() + RATCHET_MS + 1);
  check(
    await fails(await fresh(), await far.encrypt(frame(), 1)),
    'a key far in the future is refused',
  );

  const left = (await securityCode('AAA=', 'BBB=')).replace(' ', '');
  check(/^\d{8}$/.test(left), 'the security code has eight digits');
  check(
    (await securityCode('AAA=', 'BBB=')) === (await securityCode('BBB=', 'AAA=')),
    'both people compute the same code',
  );
  check(
    (await securityCode('AAA=', 'BBB=')) !== (await securityCode('AAA=', 'CCC=')),
    'a different key exchange gives a different code',
  );
}
