/**
 * test/security/static-server.mts
 * Static server: bad addresses must not crash it or leave the folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createStaticHandler, resolveFile } from '../../scripts/static-server.mjs';
import { check, step, TMP } from './support.mts';

/** Static server: bad addresses must not crash it or leave the folder. */
export async function checkStaticServer(): Promise<void> {
  step('web server: malformed addresses and paths');
  const dir = fs.mkdtempSync(path.join(TMP, 'dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>app</html>');
  fs.writeFileSync(path.join(dir, 'main-ABCDEFGH.js'), 'console.log(1)');
  fs.writeFileSync(path.join(TMP, 'outside.txt'), 'private');
  check(
    resolveFile(dir, '/%E0%A4%A') === null,
    'an invalid escape is a bad request, not an exception',
  );
  check(resolveFile(dir, '/a%00b') === null, 'a NUL byte is a bad request');
  check(
    resolveFile(dir, '/direct/abd26c23-be5f-437c-9e2d-177d591f7092') ===
      path.join(dir, 'index.html'),
    'an app route gets index.html',
  );
  check(
    resolveFile(dir, '/main-ABCDEFGH.js') === path.join(dir, 'main-ABCDEFGH.js'),
    'a real file is served',
  );
  for (const attempt of [
    '/../outside.txt',
    '/..%2foutside.txt',
    '/%2e%2e/outside.txt',
    '/..\\outside.txt',
  ]) {
    const found = resolveFile(dir, attempt);
    check(
      found === null || found === path.join(dir, 'index.html'),
      `${attempt} never reaches a file outside the folder`,
    );
  }
  const sibling = dir + '-evil';
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'private');
  const siblingName = path.basename(sibling);
  const viaSibling = resolveFile(dir, '/..%2f' + siblingName + '%2fsecret.txt');
  check(
    viaSibling === null || viaSibling === path.join(dir, 'index.html'),
    'a sibling folder with the same prefix is not served',
  );

  const handler = createStaticHandler(dir);
  /** Runs the handler with a fake request and returns what it answered. */
  const answer = function (
    method: string,
    url: string,
  ): { status: number; headers: Record<string, unknown>; body: string } {
    const result = {
      status: 0,
      headers: {} as Record<string, unknown>,
      body: '',
    };
    handler(
      { method, url, headers: {} } as never,
      {
        writeHead: function writeHead(status: number, headers: Record<string, unknown>) {
          result.status = status;
          result.headers = headers;
        },
        end: function end(body?: Buffer | string) {
          result.body = body ? String(body) : '';
        },
      } as never,
    );
    return result;
  };
  check(
    answer('GET', '/%E0%A4%A').status === 400,
    'the handler answers 400 to a malformed address',
  );
  check(answer('POST', '/').status === 405, 'the handler refuses other methods');
  check(
    answer('GET', '/missing.json').status === 404,
    'a file that does not exist is a 404, not the page of the app',
  );
  check(
    answer('GET', '/.well-known/ai-catalog.json').status === 404,
    'nothing under /.well-known/ is answered with the app page',
  );
  check(
    answer('GET', '/').status === 200 && answer('GET', '/direct/abc').status === 200,
    'the routes of the app still get the page',
  );
  const page = answer('GET', '/direct/x');
  check(page.status === 200 && page.body.includes('app'), 'an app route gets the page');
  check(
    page.headers['x-content-type-options'] === 'nosniff' &&
      page.headers['x-frame-options'] === 'DENY',
    'with the security headers',
  );
  check(
    String(answer('GET', '/main-ABCDEFGH.js').headers['cache-control']).includes('immutable'),
    'hashed files are cached for good',
  );
  check(answer('HEAD', '/').body === '', 'HEAD sends no body');
}
