/**
 * mobile/scripts/build-apk.mjs
 * Builds the signed APK of the Android app on this computer, from scratch, and keeps only the newest one:
 *
 *   pnpm --dir mobile apk
 *
 * Steps: web build (frontend) > web folder of the APK (prepare-web.mjs) > cap sync > Gradle assembleRelease > apksigner
 * (v2 + v3) > the certificate must be the one of mobile/release-certificate.sha256 > the old APKs of mobile/dist are
 * deleted > mobile/dist/Chatterly-<version>.apk and its .sha256.
 *
 * * Where the tools and the key are: mobile/android/local.properties (only on this computer, never in Git):
 *     sdk.dir=...                          the Android SDK
 *     chatterly.javaHome=...               a JDK 21 (Gradle 8.14 does not run on newer ones)
 *     chatterly.keystore=...               the .p12 of the release key (outside the repository)
 *     chatterly.keystorePasswordFile=...   a file with its password (outside the repository)
 * ! The password goes to apksigner through an environment variable of the child process only, never on a command line,
 *   and an APK signed with any other certificate is deleted instead of kept.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MOBILE = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(MOBILE, '..');
const ANDROID = path.join(MOBILE, 'android');
const DIST = path.join(MOBILE, 'dist');
const WINDOWS = process.platform === 'win32';

/** Stops the build with a message. */
function fail(message) {
  console.error('\n' + message);
  process.exit(1);
}

/** The settings of android/local.properties (key=value; "\:" and "\\" are the escapes of Java properties). */
function localProperties() {
  const file = path.join(ANDROID, 'local.properties');
  if (!fs.existsSync(file)) fail('There is no ' + file + ' (see the header of this script).');
  const settings = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([^#!=\s][^=]*?)\s*=\s*(.*)$/.exec(line);
    if (match) settings[match[1]] = match[2].replace(/\\:/g, ':').replace(/\\\\/g, '\\').trim();
  }
  return settings;
}

/** Runs a command with its output on screen (options.shell for pnpm and gradlew.bat on Windows); stops the build if it fails. */
function run(title, command, args, options = {}) {
  console.log('\n> ' + title);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) fail(title + ' failed.');
}

/** The newest build-tools folder of the SDK. */
function buildTools(sdk) {
  const root = path.join(sdk, 'build-tools');
  const versions = fs.existsSync(root) ? fs.readdirSync(root).sort().reverse() : [];
  if (!versions.length) fail('The Android SDK at ' + sdk + ' has no build-tools.');
  return path.join(root, versions[0]);
}

/** The SHA-256 of a file, in hex. */
function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** The whole build. */
function main() {
  const settings = localProperties();
  const sdk = settings['sdk.dir'];
  const javaHome = settings['chatterly.javaHome'];
  const keystore = settings['chatterly.keystore'];
  const passwordFile = settings['chatterly.keystorePasswordFile'];
  for (const [name, value] of Object.entries({
    'sdk.dir': sdk,
    'chatterly.javaHome': javaHome,
    'chatterly.keystore': keystore,
    'chatterly.keystorePasswordFile': passwordFile,
  })) {
    if (!value || !fs.existsSync(value))
      fail(name + ' in local.properties is missing or does not exist: ' + value);
  }
  const version = JSON.parse(fs.readFileSync(path.join(MOBILE, 'package.json'), 'utf8')).version;
  const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
  delete env['ELECTRON_RUN_AS_NODE'];

  run('web build', 'pnpm', ['--dir', path.join(ROOT, 'frontend'), 'build'], {
    env,
    shell: WINDOWS,
  });
  fs.rmSync(path.join(MOBILE, 'web'), { recursive: true, force: true });
  run(
    'web folder of the APK',
    process.execPath,
    [path.join(MOBILE, 'scripts', 'prepare-web.mjs')],
    { env },
  );
  run('cap sync android', 'pnpm', ['--dir', MOBILE, 'exec', 'cap', 'sync', 'android'], {
    env,
    shell: WINDOWS,
  });
  run(
    'Gradle assembleRelease',
    path.join(ANDROID, WINDOWS ? 'gradlew.bat' : 'gradlew'),
    ['--no-daemon', 'assembleRelease'],
    { env, cwd: ANDROID, shell: WINDOWS },
  );

  const unsigned = path.join(
    ANDROID,
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'app-release-unsigned.apk',
  );
  if (!fs.existsSync(unsigned)) fail('Gradle did not leave ' + unsigned);
  fs.mkdirSync(DIST, { recursive: true });
  const signed = path.join(DIST, 'Chatterly-' + version + '.apk');
  const next = signed + '.new';
  const apksigner = path.join(buildTools(sdk), 'lib', 'apksigner.jar');
  const java = path.join(javaHome, 'bin', WINDOWS ? 'java.exe' : 'java');
  const signEnv = {
    ...env,
    CHATTERLY_KEYSTORE_PASSWORD: fs.readFileSync(passwordFile, 'utf8').trim(),
  };
  console.log('\n> sign (apksigner)');
  const sign = spawnSync(
    java,
    [
      '-jar',
      apksigner,
      'sign',
      '--ks',
      keystore,
      '--ks-pass',
      'env:CHATTERLY_KEYSTORE_PASSWORD',
      '--ks-key-alias',
      'chatterly',
      '--out',
      next,
      unsigned,
    ],
    { stdio: 'inherit', env: signEnv },
  );
  if (sign.status !== 0) fail('Signing failed.');
  fs.rmSync(next + '.idsig', { force: true });

  const verify = spawnSync(
    java,
    ['-jar', apksigner, 'verify', '--verbose', '--print-certs', next],
    { encoding: 'utf8' },
  );
  const expected = fs.readFileSync(path.join(MOBILE, 'release-certificate.sha256'), 'utf8').trim();
  const actual = /certificate SHA-256 digest: ([0-9a-f]{64})/.exec(verify.stdout || '')?.[1];
  if (
    verify.status !== 0 ||
    !/Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(verify.stdout) ||
    actual !== expected
  ) {
    fs.rmSync(next, { force: true });
    fail(
      'The APK is not signed with the certificate of the app (' +
        actual +
        ' instead of ' +
        expected +
        '): it was deleted.',
    );
  }

  // Only the newest APK stays: the old ones (any version) go.
  for (const name of fs.readdirSync(DIST)) {
    const file = path.join(DIST, name);
    if (file !== next && /\.apk(\.sha256)?$/.test(name)) fs.rmSync(file, { force: true });
  }
  fs.renameSync(next, signed);
  fs.writeFileSync(signed + '.sha256', sha256(signed) + '  ' + path.basename(signed) + '\n');
  console.log('\nAPK ready: ' + signed);
  console.log('SHA-256:   ' + sha256(signed));
  console.log('Signed by: ' + actual);
}

main();
