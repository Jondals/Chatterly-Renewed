/**
 * test/e2e/19-the-server-stores-nothing-in-clear.mjs
 * The server stores nothing in clear.
 */
import fs from 'node:fs';
import path from 'node:path';
import { step, check } from './support.mjs';

/** The server stores nothing in clear. */
export async function step19(world) {
  const { A, B, a, dataDir } = world;
  step('the server stores nothing in clear');
  await a.waitForTimeout(1500);
  const blob = fs
    .readdirSync(dataDir, { recursive: true })
    .map(function (f) {
      return path.join(dataDir, f);
    })
    .filter(function (f) {
      return fs.statSync(f).isFile();
    })
    .map(function (f) {
      return fs.readFileSync(f).toString('latin1');
    })
    .join('\n');
  for (const secret of ['Hello Bob', 'colourful reply', 'First message in the group', A.pw, B.pw]) {
    check(
      !blob.includes(secret),
      `"${secret.slice(0, 18)}" does not appear in the database or in the files`,
    );
  }

  // every picture on the disk is ciphertext (profile pictures, banners and the icon of the group): none starts like an image
  const pictures = fs.readdirSync(path.join(dataDir, 'uploads', 'images'));
  check(
    pictures.length > 0,
    'there are pictures stored (the icon, the profile picture and the banner)',
  );
  check(
    pictures.every(function (name) {
      const head = fs.readFileSync(path.join(dataDir, 'uploads', 'images', name)).subarray(0, 4);
      return head.toString('latin1') !== 'PNG' && head.toString('latin1') !== 'RIFF';
    }),
    'no picture is stored as a picture: the group icon is ciphertext too',
  );
}
