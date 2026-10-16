/**
 * mobile/test/mobile.mjs
 * Checks of the Android app that need no Android SDK: the Capacitor settings, the web folder that goes inside the APK
 * (its CSP and native-config.js) and, once the Android project exists, its manifest and network settings. It also runs
 * inside the single test of the project (pnpm test).
 *
 *   node test/mobile.mjs [--web <web build>]
 *
 * ! What needs the SDK, an emulator or a phone (building and signing the APK, a real call in the WebView) is NOT
 *   checked here; it is reported as "OMITIDO: falta ..." and never as passed.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";

const MOBILE = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(MOBILE, "..");
const API = "https://chat.example.test";
let passed = 0;
const skipped = [];

/** Fails the test with a message when the condition is false. */
function check(condition, message) {
  if (!condition) throw new Error("FAILED: " + message);
  passed++;
  if (process.env["CHATTERLY_TEST_QUIET"] !== "1")
    console.log("  ok  " + message);
}

/** Prints the title of a group of checks. */
function step(title) {
  console.log("\n== " + title);
}

/** Records a check that could not run, with the tool or device that is missing. */
function skip(what) {
  skipped.push("OMITIDO: falta " + what);
  console.log("  OMITIDO: falta " + what);
}

/** Runs prepare-web.mjs and returns its exit code and output. */
function prepare(from, to, url) {
  const env = { ...process.env, CHATTERLY_URL: url };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(
    process.execPath,
    [
      path.join(MOBILE, "scripts", "prepare-web.mjs"),
      "--from",
      from,
      "--to",
      to,
    ],
    { env, encoding: "utf8" },
  );
  return { code: run.status, output: (run.stdout || "") + (run.stderr || "") };
}

/** The directives of the CSP of an index.html, as a map from name to list of sources. */
function cspOf(html) {
  const match =
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(
      html,
    );
  const map = new Map();
  if (!match) return map;
  for (const part of match[1].split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length) map.set(tokens[0], tokens.slice(1));
  }
  return map;
}

/** A web build to work on: the one given with --web, else a small one made from the source index.html. */
function webBuild(work) {
  const at = process.argv.indexOf("--web");
  if (at >= 0 && process.argv[at + 1])
    return path.resolve(process.argv[at + 1]);
  const fake = path.join(work, "fake-build");
  fs.mkdirSync(fake, { recursive: true });
  const source = fs.readFileSync(
    path.join(ROOT, "frontend", "src", "index.html"),
    "utf8",
  );
  // Like the real build: the app is a module script at the end of the body.
  const html = source.replace(
    "</body>",
    '<script src="main-ABCDEFGH.js" type="module"></script></body>',
  );
  fs.writeFileSync(path.join(fake, "index.html"), html);
  fs.writeFileSync(path.join(fake, "main-ABCDEFGH.js"), "");
  // Like the real build: the lazy fonts, with the web emoji font that prepare-web.mjs takes out, and a name font it keeps.
  fs.writeFileSync(
    path.join(fake, "lazy-fonts-ABCDEFGH.css"),
    '@font-face{font-family:"Noto Color Emoji";src:url(media/noto-color-emoji-0-400-normal-X.woff2) format("woff2")}' +
      '@font-face{font-family:Pacifico;src:url(media/pacifico-Y.woff2) format("woff2")}',
  );
  fs.mkdirSync(path.join(fake, "media"), { recursive: true });
  fs.writeFileSync(
    path.join(fake, "media", "noto-color-emoji-0-400-normal-X.woff2"),
    "x",
  );
  fs.writeFileSync(path.join(fake, "media", "pacifico-Y.woff2"), "y");
  return fake;
}

/** Capacitor settings: the web is packed in the APK and the WebView is closed. */
function checkCapacitorConfig() {
  step("android: Capacitor settings");
  const config = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "capacitor.config.json"), "utf8"),
  );
  check(
    !config.server || config.server.url === undefined,
    "no server.url: the code that holds the keys is the one inside the APK, never downloaded",
  );
  check(
    config.server?.androidScheme === "https",
    "the app is served as https (a secure context)",
  );
  check(config.server?.cleartext === false, "no clear-text HTTP");
  check(
    Array.isArray(config.server?.allowNavigation) &&
      config.server.allowNavigation.length === 0,
    "the WebView may not navigate to any other site",
  );
  check(config.android?.allowMixedContent === false, "no mixed content");
  check(
    config.android?.webContentsDebuggingEnabled !== true,
    "the WebView is never forced debuggable (Capacitor allows it only in a debuggable build; the release APK is checked below)",
  );
  check(
    config.loggingBehavior === "none",
    "Capacitor writes nothing to Logcat",
  );
  const pkg = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "package.json"), "utf8"),
  );
  const web = JSON.parse(
    fs.readFileSync(path.join(ROOT, "frontend", "package.json"), "utf8"),
  );
  check(
    pkg.version === web.version,
    "the Android app has the version of the web app",
  );
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  check(
    Object.values(all).every(function exact(version) {
      return /^\d+\.\d+\.\d+$/.test(version);
    }),
    "every dependency is pinned to an exact version",
  );
  check(
    Object.keys(all).every(function allowed(name) {
      return [
        "@capacitor/android",
        "@capacitor/core",
        "@capacitor/cli",
      ].includes(name);
    }),
    "no dependency besides Capacitor itself (a new one needs a review)",
  );
}

/** The web folder that goes inside the APK. */
function checkWebFolder(work) {
  step("android: the web app inside the APK");
  const build = webBuild(work);
  const target = path.join(work, "web");
  const run = prepare(build, target, API);
  check(
    run.code === 0,
    "the web build is prepared for Android (" + run.output.trim() + ")",
  );
  const html = fs.readFileSync(path.join(target, "index.html"), "utf8");
  const csp = cspOf(html);
  if (!process.argv.includes("--web")) {
    const fonts = fs.readFileSync(
      path.join(target, "lazy-fonts-ABCDEFGH.css"),
      "utf8",
    );
    check(
      !fonts.includes("Noto Color Emoji") &&
        fonts.includes("Pacifico") &&
        !fs.existsSync(
          path.join(target, "media", "noto-color-emoji-0-400-normal-X.woff2"),
        ) &&
        fs.existsSync(path.join(target, "media", "pacifico-Y.woff2")),
      "the web emoji font is taken out (rules and files) and the other lazy fonts stay",
    );
  }

  check(
    (csp.get("connect-src") ?? []).join(" ") ===
      "'self' " + API + " wss://chat.example.test",
    "the page may connect only to itself and to the exact API origin (https and wss)",
  );
  check(
    (csp.get("frame-src") ?? []).join(" ") === "'none'",
    "no third-party frames (embedded players)",
  );
  check((csp.get("object-src") ?? []).join(" ") === "'none'", "no plugins");
  // ! Every source of every directive is on a closed list: a scheme alone (https:, wss:), a wildcard or localhost is
  // a door to any server, so it fails the test.
  const allowed = new Set([
    "'self'",
    "'none'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    "blob:",
    "data:",
    "mediastream:",
    API,
    "wss://chat.example.test",
  ]);
  const unexpected = [];
  for (const [name, sources] of csp) {
    for (const source of sources) {
      const hash = /^'sha(256|384|512)-[A-Za-z0-9+/=]+'$/.test(source);
      if (!allowed.has(source) && !hash) unexpected.push(name + " " + source);
      if (source === "'unsafe-inline'" && name !== "style-src")
        unexpected.push(name + " " + source);
    }
  }
  check(
    unexpected.length === 0,
    "no directive allows any other server or inline script (" +
      unexpected.join(", ") +
      ")",
  );
  check(
    html.indexOf("native-config.js") >
      html.indexOf("Content-Security-Policy") &&
      html.indexOf("native-config.js") < html.indexOf('type="module"'),
    "native-config.js loads after the CSP and before the app",
  );

  // native-config.js is run as the WebView would run it, in an empty window.
  const window = {};
  const marks = {};
  const document = {
    documentElement: {
      setAttribute: function mark(name, value) {
        marks[name] = value;
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(target, "native-config.js"), "utf8"),
    {
      window,
      document,
      Object,
    },
  );
  check(
    window.CHATTERLY_API === API,
    "native-config.js gives the app the API address",
  );
  check(
    marks["data-platform"] === "android",
    "native-config.js marks the page as the Android app (the styles of the phone apply only there)",
  );
  check(
    /<meta\s+name="viewport"\s+content="[^"]*"/i.test(html) &&
      !/viewport-fit=cover/.test(
        /<meta\s+name="viewport"\s+content="([^"]*)"/i.exec(html)[1],
      ),
    "the APK has no viewport-fit=cover: the WebView stays out of the bars of the system and the keyboard",
  );
  check(
    window.CHATTERLY_NATIVE?.strictRelay === true,
    "native-config.js turns on the strict relay policy",
  );
  let replaced = true;
  try {
    vm.runInNewContext(
      "'use strict'; window.CHATTERLY_NATIVE = { strictRelay: false };",
      {
        window,
      },
    );
  } catch {
    replaced = false;
  }
  let changed = true;
  try {
    vm.runInNewContext(
      "'use strict'; window.CHATTERLY_NATIVE.strictRelay = false;",
      { window },
    );
  } catch {
    changed = false;
  }
  check(
    !replaced && !changed && window.CHATTERLY_NATIVE.strictRelay === true,
    "a script that runs later cannot turn the strict relay policy off",
  );

  step("android: only a safe API address is accepted");
  const refused = [
    "http://chat.example.test",
    "https://user:pass@chat.example.test",
    "https://chat.example.test/api",
    "https://chat.example.test/?x=1",
    "javascript:alert(1)",
    "not an address",
  ];
  check(
    refused.every(function refuses(url) {
      return prepare(build, path.join(work, "refused"), url).code !== 0;
    }),
    "an http address, credentials, a path, a query or a non-web scheme stop the build",
  );
  const again = prepare(target, path.join(work, "twice"), API);
  check(
    again.code !== 0,
    "a folder that was already prepared is not prepared twice",
  );
}

/** The Android project: manifest, network and backup rules. */
function checkAndroidProject() {
  step("android: manifest, network and backups");
  const manifestPath = path.join(
    MOBILE,
    "android",
    "app",
    "src",
    "main",
    "AndroidManifest.xml",
  );
  if (!fs.existsSync(manifestPath)) {
    skip('el proyecto Android (mobile/android, se crea con "cap add android")');
    return;
  }
  const manifest = fs.readFileSync(manifestPath, "utf8");
  const res = path.join(MOBILE, "android", "app", "src", "main", "res", "xml");
  check(
    /android:allowBackup="false"/.test(manifest),
    "no Android backups of the app data",
  );
  check(
    /android:usesCleartextTraffic="false"/.test(manifest),
    "no clear-text traffic",
  );
  check(
    !/android:debuggable="true"/.test(manifest),
    "the app is not debuggable by its manifest",
  );
  const network = /android:networkSecurityConfig="@xml\/([a-z_]+)"/.exec(
    manifest,
  );
  check(Boolean(network), "a network security configuration is set");
  if (network) {
    const xml = fs.readFileSync(path.join(res, network[1] + ".xml"), "utf8");
    check(
      /cleartextTrafficPermitted="false"/.test(xml),
      "the network configuration forbids clear text",
    );
    check(
      !/src="user"/.test(xml),
      "certificates added by the user are not trusted (no interception)",
    );
  }
  const extraction = /android:dataExtractionRules="@xml\/([a-z_]+)"/.exec(
    manifest,
  );
  const fullBackup = /android:fullBackupContent="@xml\/([a-z_]+)"/.exec(
    manifest,
  );
  check(
    Boolean(extraction && fullBackup),
    "backup and device-transfer rules are set (old and new Android)",
  );
  if (extraction && fullBackup) {
    const rules = fs.readFileSync(
      path.join(res, extraction[1] + ".xml"),
      "utf8",
    );
    const legacy = fs.readFileSync(
      path.join(res, fullBackup[1] + ".xml"),
      "utf8",
    );
    check(
      /<cloud-backup[\s\S]*?<exclude domain="root"/.test(rules) &&
        /<device-transfer[\s\S]*?<exclude domain="root"/.test(rules),
      "cloud backups and device transfers exclude all the app data",
    );
    check(
      /<exclude domain="root"/.test(legacy),
      "the old backup rules exclude all the app data too",
    );
  }
  const permissions = [
    ...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g),
  ]
    .map(function name(match) {
      return match[1];
    })
    .sort();
  const allowedPermissions = [
    "android.permission.CAMERA",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
    "android.permission.INTERNET",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.RECORD_AUDIO",
    "android.permission.REQUEST_DELETE_PACKAGES",
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.USE_FULL_SCREEN_INTENT",
    "android.permission.VIBRATE",
  ];
  check(
    permissions.every(function known(permission) {
      return allowedPermissions.includes(permission);
    }),
    "only the permissions calls (notifications, sharing the screen) and updates need are asked (" +
      permissions.join(", ") +
      ")",
  );
  const exported = [
    ...manifest.matchAll(
      /<(activity|service|receiver|provider)\b[^>]*android:exported="true"[^>]*>/g,
    ),
  ];
  check(
    exported.length === 1 &&
      /android:name="\.MainActivity"/.test(exported[0][0]),
    "only the main screen is exported (no service, receiver or provider open to other apps)",
  );
  const services = [...manifest.matchAll(/<service\b[^>]*>/g)].map(
    function tag(match) {
      return match[0];
    },
  );
  check(
    services.length === 2 &&
      services.every(function closed(tag) {
        return /android:exported="false"/.test(tag);
      }) &&
      services.some(function call(tag) {
        return (
          /android:name="\.CallForegroundService"/.test(tag) &&
          /android:foregroundServiceType="microphone\|specialUse"/.test(tag)
        );
      }) &&
      services.some(function screen(tag) {
        return (
          /android:name="\.ScreenForegroundService"/.test(tag) &&
          /android:foregroundServiceType="mediaProjection"/.test(tag)
        );
      }),
    "two services only, none exported: the calls (microphone, and the optional connection in the background) and the shared screen (mediaProjection)",
  );
  check(
    /PROPERTY_SPECIAL_USE_FGS_SUBTYPE/.test(manifest) &&
      /onTaskRemoved[\s\S]*?stopSelf/.test(
        fs.readFileSync(
          path.join(
            MOBILE,
            "android",
            "app",
            "src",
            "main",
            "java",
            "app",
            "chatterly",
            "renewed",
            "CallForegroundService.java",
          ),
          "utf8",
        ),
      ),
    "the connection kept in the background says why (special use) and stops when the app is swiped away",
  );
  const receivers = [...manifest.matchAll(/<receiver\b[^>]*>/g)]
    .map(function tag(match) {
      return match[0];
    })
    .filter(function ours(tag) {
      return !/tools:node="remove"/.test(tag);
    });
  check(
    receivers.length === 1 &&
      /android:name="\.CallActionReceiver"/.test(receivers[0]) &&
      /android:exported="false"/.test(receivers[0]),
    "one receiver of the app (the Decline button of a ringing call), not exported",
  );
  check(
    /android\.webkit\.WebView\.EnableSafeBrowsing"\s+android:value="false"/.test(
      manifest,
    ) &&
      /android\.webkit\.WebView\.MetricsOptOut"\s+android:value="true"/.test(
        manifest,
      ),
    "the WebView sends no Safe Browsing lookups or usage metrics to Google",
  );
  const strings = ["values", "values-es"].map(function read(folder) {
    return fs.readFileSync(
      path.join(
        MOBILE,
        "android",
        "app",
        "src",
        "main",
        "res",
        folder,
        "strings.xml",
      ),
      "utf8",
    );
  });
  check(
    strings.every(function generic(xml) {
      const text = /<string name="call_in_progress">([^<]*)<\/string>/.exec(
        xml,
      );
      return text && !/%|\$|\{/.test(text[1]);
    }),
    "the notification of a call is a fixed generic text (no place for a name, a group or a channel)",
  );

  const certificate = fs.readFileSync(
    path.join(MOBILE, "release-certificate.sha256"),
    "utf8",
  );
  const workflow = fs.readFileSync(
    path.join(ROOT, ".github", "workflows", "desktop.yml"),
    "utf8",
  );
  check(
    /^[0-9a-f]{64}\r?\n?$/.test(certificate) &&
      workflow.includes("mobile/release-certificate.sha256") &&
      /if \[ "\$ACTUAL" != "\$EXPECTED" \]; then[\s\S]*?exit 1/.test(workflow),
    "the release only publishes an APK signed with the certificate of the app (mobile/release-certificate.sha256)",
  );
  check(
    !/secrets\./.test(
      workflow.slice(
        workflow.indexOf("\n  android:"),
        workflow.indexOf("\n  release:"),
      ),
    ),
    "the job that builds the APK (npm, Gradle) gets no secret: only the release job signs it",
  );

  step("android: updates (download and install)");
  const updater = fs.readFileSync(
    path.join(
      MOBILE,
      "android",
      "app",
      "src",
      "main",
      "java",
      "app",
      "chatterly",
      "renewed",
      "UpdatePlugin.java",
    ),
    "utf8",
  );
  check(
    updater.includes("^/api/beta/dl/Chatterly-[0-9A-Za-z.-]{1,60}\\\\.apk$") &&
      updater.includes(
        "^/Jondals/ChatterlyRenewed/releases/download/v[0-9A-Za-z.-]{1,60}/Chatterly-[0-9A-Za-z.-]{1,60}\\\\.apk$",
      ) &&
      /host\.equals\(BuildConfig\.CHATTERLY_API_HOST\)/.test(updater) &&
      /"https"\.equals\(parsed\.getProtocol\(\)\)/.test(updater),
    "an update is downloaded only from the beta server of the app or a release of this repository, over https",
  );
  check(
    /if \(hop == 0 && token != null\)/.test(updater) &&
      /GITHUB_STORAGE\.contains/.test(updater) &&
      /host\.equals\("github\.com"\) && parsed\.getPort\(\) == -1 && token == null/.test(
        updater,
      ),
    "the beta token goes only to the beta server, never to GitHub or where it redirects",
  );
  check(
    /versionCode\(update\) <= versionCode\(installed\)/.test(updater) &&
      /!wanted\.equals\(certificates\(update\)\)/.test(updater) &&
      /context\.getPackageName\(\)\.equals\(update\.packageName\)/.test(
        updater,
      ) &&
      /String problem = apk\.exists\(\) \? check\(context, apk, false\)/.test(
        updater,
      ),
    "before the installer opens, the APK must be this app, newer, and signed with the certificate of the installed app",
  );
  // An older version (changing channel) is only kept in Downloads after the same checks, never handed to the installer.
  const installBody = updater.slice(
    updater.indexOf("public void install("),
    updater.indexOf("File apkFile()"),
  );
  const keepBody = updater.slice(
    updater.indexOf("public void keepInDownloads("),
    updater.indexOf("public void uninstall("),
  );
  check(
    installBody.includes("check(context, apk, false)") &&
      !installBody.includes("check(context, apk, true)") &&
      keepBody.includes("check(context, apk, true)") &&
      !keepBody.includes("ACTION_VIEW") &&
      /versionCode\(update\) == versionCode\(installed\)/.test(updater),
    "an older version is never given to the installer: it only goes to Downloads, as this app signed by the same author",
  );
  check(
    /canRequestPackageInstalls/.test(updater) &&
      /ACTION_VIEW/.test(updater) &&
      !/PackageInstaller/.test(updater),
    "the installer of Android opens and the person confirms: nothing is installed silently",
  );

  step("android: build files and the main screen");
  const android = path.join(MOBILE, "android");
  const rootGradle = fs.readFileSync(
    path.join(android, "build.gradle"),
    "utf8",
  );
  const appGradle = fs.readFileSync(
    path.join(android, "app", "build.gradle"),
    "utf8",
  );
  const code = function withoutComments(text) {
    return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  };
  check(
    !/com\.google\.gms|com\.google\.firebase|com\.google\.android\.gms|play-services-/i.test(
      code(rootGradle) + code(appGradle),
    ),
    "no Google services, Firebase or Play services in the build (complements the inspection of the APK)",
  );
  check(
    /if \(file\('google-services\.json'\)\.exists\(\)\)\s*\{\s*throw new GradleException/.test(
      appGradle,
    ),
    "a google-services.json dropped in the app folder stops the build instead of turning Firebase on",
  );
  check(
    /versionCode chatterlyVersion\(\)\.code/.test(appGradle) &&
      /versionName chatterlyVersion\(\)\.name/.test(appGradle),
    "the version of the APK comes from package.json (one version for the project)",
  );
  const wrapper = fs.readFileSync(
    path.join(android, "gradle", "wrapper", "gradle-wrapper.properties"),
    "utf8",
  );
  check(
    /^distributionSha256Sum=[0-9a-f]{64}$/m.test(wrapper),
    "the download of Gradle is checked against its official SHA-256",
  );
  const jar = fs.readFileSync(
    path.join(android, "gradle", "wrapper", "gradle-wrapper.jar"),
  );
  check(
    createHash("sha256").update(jar).digest("hex") ===
      "7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172",
    "gradle-wrapper.jar is the official one of Gradle 8.14.3 (a changed jar runs code on every build)",
  );
  const activity = fs.readFileSync(
    path.join(
      android,
      "app",
      "src",
      "main",
      "java",
      "app",
      "chatterly",
      "renewed",
      "MainActivity.java",
    ),
    "utf8",
  );
  const secure = activity.indexOf("FLAG_SECURE");
  const created = activity.indexOf("super.onCreate");
  check(
    secure > 0 &&
      created > secure &&
      /setRecentsScreenshotEnabled\(false\)/.test(activity),
    "FLAG_SECURE is set before the screen is created, and the recent apps never show the app",
  );
  const callPlugin = fs.readFileSync(
    path.join(
      android,
      "app",
      "src",
      "main",
      "java",
      "app",
      "chatterly",
      "renewed",
      "CallServicePlugin.java",
    ),
    "utf8",
  );
  check(
    (
      activity.match(
        /clearFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/g,
      ) ?? []
    ).length === 0 &&
      (
        callPlugin.match(
          /clearFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/g,
        ) ?? []
      ).length === 1,
    "screenshots are allowed only through setSecure (the page allows them only with verified contacts)",
  );
  check(
    /setAllowFileAccess\(false\)/.test(activity) &&
      /setGeolocationEnabled\(false\)/.test(activity) &&
      /setJavaScriptCanOpenWindowsAutomatically\(false\)/.test(activity),
    "the WebView gets no file:// access, no location and no windows opened by script",
  );
  const chrome = fs.readFileSync(
    path.join(
      android,
      "app",
      "src",
      "main",
      "java",
      "app",
      "chatterly",
      "renewed",
      "SecureWebChromeClient.java",
    ),
    "utf8",
  );
  check(
    /getOnBackPressedDispatcher\(\)\.addCallback\(this, new WebHistoryBack\(\)\)/.test(
      activity,
    ) &&
      /if \(view != null && view\.canGoBack\(\)\) \{\s*view\.goBack\(\);/.test(
        activity,
      ),
    "the back key goes back inside the app and leaves it only from the first page",
  );
  check(
    activity.indexOf("setWebChromeClient(new SecureWebChromeClient(") > created,
    "the stricter WebView client replaces the one of Capacitor once the bridge exists",
  );
  check(
    /if \(!isAppOrigin\(request\.getOrigin\(\)\) \|\| !onlyAllowedResources\(request\.getResources\(\)\)\) \{\s*request\.deny\(\);\s*return;/.test(
      chrome,
    ) && /callback\.invoke\(origin, false, false\)/.test(chrome),
    "camera and microphone only for the app itself, nothing else is granted, and the location is always refused",
  );
}

/** The Android SDK of this computer: ANDROID_HOME, ANDROID_SDK_ROOT or sdk.dir of android/local.properties. */
function androidSdk() {
  const fromEnv =
    process.env["ANDROID_HOME"] || process.env["ANDROID_SDK_ROOT"];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const local = path.join(MOBILE, "android", "local.properties");
  if (!fs.existsSync(local)) return null;
  const line = /^sdk\.dir=(.+)$/m.exec(fs.readFileSync(local, "utf8"));
  if (!line) return null;
  const dir = line[1].trim().replace(/\\:/g, ":").replace(/\\\\/g, "\\");
  return fs.existsSync(dir) ? dir : null;
}

/** A tool of the newest build-tools of the SDK (aapt2, dexdump), or null. */
function buildTool(sdk, name) {
  const root = path.join(sdk, "build-tools");
  if (!fs.existsSync(root)) return null;
  const versions = fs.readdirSync(root).sort().reverse();
  for (const version of versions) {
    for (const file of [name + ".exe", name]) {
      const full = path.join(root, version, file);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

/** The files of a zip (an APK), name to bytes: a small reader of the central directory (stored and deflated entries). */
function unzip(file) {
  const data = fs.readFileSync(file);
  let end = data.length - 22;
  while (end >= 0 && data.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip: " + file);
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = data.readUInt16LE(at + 10);
    const size = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString("utf8", at + 46, at + 46 + nameLength);
    const start =
      local +
      30 +
      data.readUInt16LE(local + 26) +
      data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + size);
    files.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** The components of a manifest dumped by aapt2 (xmltree), with their name and whether they are exported. */
function components(xmltree) {
  const found = [];
  let current = null;
  for (const line of xmltree.split("\n")) {
    const element =
      /E: (activity|activity-alias|service|receiver|provider) /.exec(line);
    if (element) {
      current = { kind: element[1], name: "", exported: false };
      found.push(current);
      continue;
    }
    if (
      / E: /.test(line) &&
      !/E: (intent-filter|action|category|data|meta-data)/.test(line)
    )
      current = null;
    if (!current) continue;
    const name = /android:name\([^)]*\)="([^"]+)"/.exec(line);
    if (name && !current.name) current.name = name[1];
    if (/android:exported\([^)]*\)=true/.test(line)) current.exported = true;
  }
  return found;
}

/** The release APK that Gradle built: what really ships, not the source files. */
function checkBuiltApk() {
  step("android: the release APK (what really ships)");
  const sdk = androidSdk();
  const aapt2 = sdk && buildTool(sdk, "aapt2");
  const dexdump = sdk && buildTool(sdk, "dexdump");
  if (!aapt2 || !dexdump) {
    skip("JDK y Android SDK (compilar e inspeccionar el APK)");
    return;
  }
  const folder = path.join(
    MOBILE,
    "android",
    "app",
    "build",
    "outputs",
    "apk",
    "release",
  );
  const apk = fs.existsSync(folder)
    ? fs
        .readdirSync(folder)
        .filter(function isApk(name) {
          return name.endsWith(".apk");
        })
        .map(function full(name) {
          return path.join(folder, name);
        })[0]
    : null;
  const sources = [
    path.join(MOBILE, "android", "app", "src", "main", "AndroidManifest.xml"),
    path.join(MOBILE, "android", "app", "build.gradle"),
    path.join(MOBILE, "capacitor.config.json"),
    path.join(MOBILE, "package.json"),
  ];
  const newest = Math.max(
    ...sources.map(function modified(file) {
      return fs.statSync(file).mtimeMs;
    }),
  );
  if (!apk || fs.statSync(apk).mtimeMs < newest) {
    skip(
      "compilar de nuevo el APK de release (gradlew assembleRelease): el que hay es anterior al código",
    );
    return;
  }
  const tool = function run(command, args) {
    return (
      spawnSync(command, args, {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }).stdout || ""
    );
  };
  const badging = tool(aapt2, ["dump", "badging", apk]);
  const manifest = tool(aapt2, [
    "dump",
    "xmltree",
    "--file",
    "AndroidManifest.xml",
    apk,
  ]);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "package.json"), "utf8"),
  );
  // A beta build is labelled "2.33.0-b3" (CHATTERLY_LABEL, like Gradle reads it); a release is the version itself.
  const label = process.env["CHATTERLY_LABEL"] || pkg.version;
  const parts = /^(\d+)\.(\d+)\.(\d+)(?:-b(\d+))?$/.exec(label) ?? [];
  const code =
    Number(parts[1]) * 1000000 +
    Number(parts[2]) * 10000 +
    Number(parts[3]) * 100 +
    Number(parts[4] ?? 99);
  check(
    label.startsWith(pkg.version) &&
      badging.includes("versionName='" + label + "'") &&
      badging.includes("versionCode='" + code + "'"),
    "the APK has the version of the project (" + label + ", code " + code + ")",
  );
  check(
    !/application-debuggable/.test(badging),
    "the release APK is not debuggable (so neither is its WebView)",
  );
  check(
    /allowBackup\([^)]*\)=false/.test(manifest),
    'the merged manifest keeps allowBackup="false"',
  );
  check(
    /usesCleartextTraffic\([^)]*\)=false/.test(manifest),
    "the merged manifest keeps clear text off",
  );
  check(
    /dataExtractionRules\(/.test(manifest) &&
      /fullBackupContent\(/.test(manifest),
    "the merged manifest keeps the backup and device-transfer rules",
  );
  const all = components(manifest);
  const exported = all.filter(function open(component) {
    return component.exported;
  });
  check(
    exported.length === 1 && exported[0].name.endsWith(".MainActivity"),
    "in the merged manifest (libraries included) only the main screen is exported (" +
      exported
        .map(function name(component) {
          return component.kind + " " + component.name;
        })
        .join(", ") +
      ")",
  );
  const permissions = [
    ...badging.matchAll(/uses-permission: name='([^']+)'/g),
  ].map(function name(match) {
    return match[1];
  });
  const allowed = [
    "android.permission.CAMERA",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
    "android.permission.INTERNET",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.RECORD_AUDIO",
    "android.permission.REQUEST_DELETE_PACKAGES",
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.USE_FULL_SCREEN_INTENT",
    "android.permission.VIBRATE",
    // AndroidX defines this one for the app itself (signature level): it guards its own non-exported receivers.
    "app.chatterly.renewed.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
  ];
  check(
    permissions.every(function known(permission) {
      return allowed.includes(permission);
    }),
    "the merged manifest asks only the permissions of a call (" +
      permissions.join(", ") +
      ")",
  );

  const files = unzip(apk);
  const dexes = [...files.keys()].filter(function isDex(name) {
    return /^classes\d*\.dex$/.test(name);
  });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "chatterly-dex-"));
  const classes = [];
  try {
    for (const name of dexes) {
      const out = path.join(work, name);
      fs.writeFileSync(out, files.get(name));
      for (const match of tool(dexdump, [out]).matchAll(
        /Class descriptor\s*:\s*'L([^;]+);'/g,
      )) {
        classes.push(match[1]);
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  check(
    classes.length > 1000,
    "the classes of the APK were read (" + classes.length + ")",
  );
  // ! Known SDKs of Google services, analytics, crash reporting, ads and attribution. A name match is only a part of
  // the proof: the dependency tree and the network traffic of the app are checked too (see DOCS.md).
  const denied =
    /^(com\/google\/firebase|com\/google\/android\/gms|com\/google\/android\/play|com\/google\/android\/datatransport|com\/crashlytics|io\/sentry|com\/facebook|com\/appsflyer|com\/adjust\/sdk|com\/onesignal|com\/segment\/analytics|com\/amplitude|com\/mixpanel|io\/branch|com\/bugsnag|com\/newrelic|com\/datadog|com\/microsoft\/appcenter|com\/instabug|com\/flurry|com\/applovin|com\/unity3d\/ads|com\/ironsource)\//;
  const tracked = classes.filter(function isDenied(name) {
    return denied.test(name);
  });
  check(
    tracked.length === 0,
    "no Firebase, Play services, analytics, crash reporting or ad SDK in the code of the APK" +
      (tracked.length ? " (" + tracked.slice(0, 5).join(", ") + ")" : ""),
  );

  const config =
    files.get("assets/public/native-config.js")?.toString("utf8") ?? "";
  const index = files.get("assets/public/index.html")?.toString("utf8") ?? "";
  const window = {};
  try {
    vm.runInNewContext(config, {
      window,
      Object,
      document: { documentElement: { setAttribute: function ignore() {} } },
    });
  } catch {
    /* checked below */
  }
  check(
    /^https:\/\/[^/]+$/.test(window.CHATTERLY_API ?? "") &&
      window.CHATTERLY_NATIVE?.strictRelay === true,
    "the web app inside the APK talks to an https server and has the strict relay policy (" +
      (window.CHATTERLY_API ?? "no native-config.js") +
      ")",
  );
  check(
    ![...files.keys()].some(function emojiFont(name) {
      return /^assets\/public\/media\/noto-color-emoji-/.test(name);
    }),
    "the APK carries no web emoji font (the WebView draws it empty; Android has its own Noto)",
  );
  const connect = (cspOf(index).get("connect-src") ?? []).join(" ");
  check(
    connect ===
      "'self' " +
        window.CHATTERLY_API +
        " " +
        String(window.CHATTERLY_API).replace(/^https:/, "wss:"),
    "the CSP inside the APK allows only that server (" + connect + ")",
  );
  check(
    ![...files.keys()].some(function secretFile(name) {
      return /(^|\/)(\.env|.*\.(jks|keystore|pem|p12|key)|google-services\.json|keystore\.properties)$/i.test(
        name,
      );
    }),
    "no keys, keystores, .env or google-services.json inside the APK",
  );
}

/** Runs every check. */
function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "chatterly-mobile-"));
  try {
    checkCapacitorConfig();
    checkWebFolder(work);
    checkAndroidProject();
    checkBuiltApk();
    skip(
      "un dispositivo Android real (la emulación no sustituye a un teléfono: radio, Bluetooth, batería, WebView del fabricante)",
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(
    "\n" + passed + " mobile checks passed, " + skipped.length + " skipped",
  );
  console.log("MOBILE CHECKS CORRECT");
}

main();
