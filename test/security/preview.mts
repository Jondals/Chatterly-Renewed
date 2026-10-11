/**
 * test/security/preview.mts
 * The link preview must not be usable to reach the network of the server.
 */
import { assertFetchable, isPrivateAddress, metaTags } from '../../backend/src/routes/preview';
import { check, step, makeApp, signUp, call } from './support.mts';

/** The link preview must not be usable to reach the network of the server. */
export async function checkPreview(): Promise<void> {
  step('link preview: the server never connects to its own network');
  const blocked = [
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
    '198.18.0.1',
    '::1',
    '::',
    '[::1]',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    'fd00::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1',
    'not-an-address',
  ];
  for (const ip of blocked) check(isPrivateAddress(ip), `${ip} is refused`);
  for (const ip of [
    '8.8.8.8',
    '93.184.216.34',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '[2606:4700:4700::1111]',
  ]) {
    check(!isPrivateAddress(ip), `${ip} is allowed`);
  }
  const refusedUrls = [
    'http://example.com/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[fd00::1]/',
    'https://2130706433/',
    'https://0x7f.1/',
    'https://169.254.169.254/latest/meta-data/',
    'https://example.com:8443/',
    'https://example.com:22/',
    'https://user:pass@example.com/',
    'ftp://example.com/',
  ];
  for (const text of refusedUrls) {
    let refused = false;
    try {
      assertFetchable(new URL(text));
    } catch {
      refused = true;
    }
    check(refused, `${text} is refused before any connection`);
  }
  assertFetchable(new URL('https://example.com/page?x=1'));
  check(true, 'an ordinary https address passes the check');

  const app = await makeApp();
  const alice = await signUp(app, 'alice');
  for (const target of [
    'https://[::1]/',
    'https://[::ffff:7f00:1]/',
    'https://127.0.0.1/',
    'https://localhost/',
  ]) {
    const res = await call(app, alice, 'GET', '/api/preview?url=' + encodeURIComponent(target));
    check(
      res.statusCode === 502 || res.statusCode === 422,
      `the preview of ${target} fails without a connection`,
    );
  }
  check(
    (await call(app, alice, 'GET', '/api/preview?url=' + encodeURIComponent('http://example.com')))
      .statusCode === 400,
    'http is refused',
  );
  check(
    (await call(app, null, 'GET', '/api/preview?url=https://example.com')).statusCode === 401,
    'the preview needs a session',
  );
  await app.close();

  step('link preview: hostile pages cannot stall the server');
  const hostile = '<meta '.repeat(66_000);
  let started = Date.now();
  metaTags(hostile);
  check(Date.now() - started < 1500, 'a page of 66000 unclosed <meta> is read in linear time');
  started = Date.now();
  metaTags('<meta name="a" content="' + 'x'.repeat(390_000));
  check(Date.now() - started < 1500, 'a page with one huge unfinished tag is read in linear time');
  const tags = metaTags(
    '<meta property="og:title" content="Hi &amp; bye"><meta name="description" content="d">',
  );
  check(
    tags.get('og:title') === 'Hi & bye' && tags.get('description') === 'd',
    'the tags of a normal page are still read',
  );
}
