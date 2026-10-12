# Chatterly desktop (Electron)

[Español](README.es.md)

The Chatterly web app in its own Windows window. The installer carries the web build inside it, so the code that handles your keys is the one that was installed, not whatever a server sends on each start. The shell adds no way to read messages and sends nothing anywhere: encryption, calls and the relay-only policy all run in the web code, exactly as in a browser.

macOS and Linux use the same code (only the packaging differs; see the end).

## What it does

- **Bundled web app.** The web build lives in `web/` inside the installer and is served as `app://chatterly`. The window talks to the server only for the API (`https://…/api`, `wss://…/ws`).
- **Hardened window.** Sandboxed renderer, context isolation, no Node in the page, developer tools off when installed. The page sees only `window.chatterlyDesktop` (`isDesktop`, `platform`) and `window.CHATTERLY_API`.
- **Links never leave the app.** Other sites open in your default browser; pop-ups are denied.
- **Permissions.** Camera, microphone, notifications and screen capture are granted to the app itself only, never to an embedded frame (YouTube and the like).
- **Screen sharing** always asks first, in the app's own picker: **Entire screen** and **A window** are two tabs (the share menu of the call decides which one opens), and a box shares **the sound of the computer** too (it starts as the menu has it). Nothing is shared without choosing. The sound is asked with `restrictOwnAudio`, so the voices of the call (the sound of the app itself) are left out and nobody hears themselves back; Windows cannot give the sound of one window alone, so it is the sound of the whole computer.
- **Closing the window closes the app.** Nothing stays running in the background (there is no tray).
- **It opens maximized** the first time and stays that way until you restore the window; then it opens as you left it (`window-state.json` in the profile folder).
- **Sounds play at once**, with no click needed first (the intro, the rings).
- **Spinly** is shown inside the app. Spinly has to allow the origin `app://chatterly` (in its `frame-ancestors` and in its Chatterly bridge): the Spinly project already does, but it must be deployed.
- **Offline page** (remote mode only): if the server is unreachable it shows a page and retries every 5 seconds.
- **Updates from inside the app** (a notice in the bell, then you download and restart when you choose; see [Updates](#updates)).
- **Electron fuses** are set at build time: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, asar integrity checked, loads only from the asar, no extra `file://` privileges.

## What you need

| For                            | You need                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Everything                     | Git, Node.js 22 or newer (24 is what it is tested with), pnpm 12.9.1 (`corepack enable`)         |
| Building the Windows installer | Windows 10/11 (the installer is built on Windows)                                                |
| Running it from the source     | The repository installed (below)                                                                 |
| The Microsoft Store package    | A free Partner Center account (see [Microsoft Store](#microsoft-store-free-signed-by-microsoft)) |
| macOS builds (later)           | A Mac and an Apple Developer account (99 USD/year)                                               |

## Install the project once

From the repository root:

```
pnpm install
pnpm --dir backend install
pnpm --dir frontend install
pnpm --dir desktop install
```

## Run it while developing

```
pnpm --dir desktop start
```

With nothing else set it opens the **public site** in a window (remote mode). To work against your own server:

```
# PowerShell
$env:CHATTERLY_URL = "http://localhost:3000"; $env:CHATTERLY_MODE = "remote"; pnpm --dir desktop start
```

Or run the **bundled** mode with a fresh web build (what the installer does):

```
pnpm build                                   # at the root: builds backend and frontend
$env:CHATTERLY_URL = "http://localhost:3000" # the API
$env:CHATTERLY_WEB_DIR = "..\frontend\dist\frontend\browser"
pnpm --dir desktop start
```

The server must accept the origin `app://chatterly` (see [Server side](#server-side)).

### Environment variables

| Variable                 | What it does                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `CHATTERLY_URL`          | The server (API). Default: the public site. An installed app only accepts `https`; `http` only for `localhost` while developing          |
| `CHATTERLY_MODE=remote`  | Development only: load the server itself instead of the packed web app                                                                   |
| `CHATTERLY_WEB_DIR`      | Development only: use this web build instead of `desktop/web`                                                                            |
| `CHATTERLY_NO_UPDATE=1`  | Turns the self-update off                                                                                                                |
| `CHATTERLY_TRACE=<file>` | Writes the start-up timings (milliseconds since the process started) to that file, one line per step. For measuring, see [Speed](#speed) |
| `CHATTERLY_UPDATE_URL`   | Development only: a folder with `latest.yml` to check and download from (it never installs). Used by the tests                           |

An installed app ignores `CHATTERLY_MODE`, `CHATTERLY_WEB_DIR` and `CHATTERLY_UPDATE_URL`, so an environment variable cannot swap the code that holds the keys.

## Test it

```
pnpm --dir desktop test
```

About 230 checks of the shell: dangerous settings in the source, the rule for the server address, the running app (no Node in the page, navigation, permissions, microphone and camera, screen picker, one copy only, closing the window closes the app), the `app://` server (what it serves and refuses, path traversal), the updater (announces, downloads on request, refuses a wrong hash) and, if you built one, the installed app (fuses, starts from its asar).

It is also part of the root `pnpm test`, which adds a step where this app signs up against the real backend from `app://chatterly`.

## Build the installer

```
pnpm build                    # at the root: the web app the installer will carry
pnpm --dir desktop dist
```

1. `pnpm build` leaves the web app in `frontend/dist/frontend/browser`.
2. `pnpm --dir desktop dist` copies it to `desktop/web` (it refuses if the web and desktop versions differ), then runs electron-builder.

What you get in `desktop/dist/`:

| File                            | What it is                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Chatterly Setup <version>.exe` | **The installer** to give to people (about 100 MB). One click, per user, no administrator rights; installs in `%LOCALAPPDATA%\Programs\Chatterly` |
| `latest.yml` and `*.blockmap`   | What the self-update reads. Upload them together with the installer (the release does it for you)                                                 |
| `win-unpacked/`                 | The same app without installer, for trying it (`Chatterly.exe`)                                                                                   |

The installer is **not signed**. Windows SmartScreen shows "Windows protected your PC" the first time: _More info_, then _Run anyway_. To avoid that without paying for a subscription, publish through the Microsoft Store.

Your data (the keys of your account, settings) lives in `%APPDATA%\Chatterly`. Uninstalling from Windows settings keeps it; delete the folder to wipe everything.

## Updates

The installed app looks for a new version **a few seconds after it starts and then as often as you choose**, and only **tells you**. Nothing is downloaded, installed or restarted behind your back:

1. A notice "A new version is available" appears, and the **notifications of the bell** (Home) show a card with the new version.
2. You press **Download**. A progress bar shows how it goes.
3. When it is ready you press **Restart and update**. Chatterly closes, installs silently and opens again.

**Settings > Updates** (only in the desktop app) has what you need to control it:

- The state, the version, when it last looked, and the buttons **Check for updates**, **Download** and **Restart and update**.
- **Look for updates**: every hour, every 6 hours (the default), every 12 hours, every day, only when the app starts, or only when you ask.
- **Update by itself** (off by default): downloads a new version as soon as it is found and installs it silently when you close the app. It never restarts the app on its own, so a call is never cut.
- **Tell me about new versions**: on shows the notice and the card in the bell; off shows nothing in the bell (the new version is still in Settings > Updates).

In the bell, the card also has **Later** (hides it for that version) and a link to these settings. The choices are saved in `update-settings.json` in the profile folder (`%APPDATA%\Chatterly`). If you never press anything and "Update by itself" is off, the app stays as it is.

It reads the **GitHub Releases** of the repository and checks the sha512 of the download against `latest.yml`; a file whose hash does not match is refused and the card says so. Until the installer is signed there is no publisher check on top of that, which is the reason to sign it or use the Store. The Microsoft Store version is updated by the Store and shows no card.

The page talks to the app through fixed commands (`getState`, `check`, `download`, `install`, `setSettings`) and one event, all in `src/preload.cjs`. Only the main page of the app can use them, never an embedded frame, and `setSettings` accepts only the two keys above with values from a fixed list.

### Publish a version (so installed apps see it)

There is **one release for the whole project**, not one per platform:

1. Raise the version **everywhere, to the same number**: `package.json`, `backend/package.json`, `frontend/package.json`, `frontend/src/app/version.ts` and `desktop/package.json`. Add the entry in `CHANGELOG.md`.
2. Commit and push.

That is all. The same push updates the server (`deploy.yml`) and the workflow [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) builds the web app, runs the desktop tests, builds the installer and publishes it as the release `v<version>` with `Chatterly-Setup-<version>.exe`, `latest.yml` and the blockmap; the notes of the release are the section of that version in `CHANGELOG.md`. If that version already has a complete release (a push that did not raise it), nothing is built; a release that was left without `latest.yml` (a failed one) is finished by the next push. Installed apps find it within hours and show it in the bell.

The repository (or at least its Releases) must be **public**, or the apps cannot download updates.

By hand instead of the workflow (with the [GitHub CLI](https://cli.github.com), logged in):

```
pnpm build
pnpm --dir desktop dist
node desktop/scripts/release-notes.mjs 2.27.0 > notes.md
gh release create v2.27.0 --target master --title "Chatterly 2.27.0" --notes-file notes.md
gh release upload v2.27.0 "desktop/dist/Chatterly-Setup-2.27.0.exe" "desktop/dist/Chatterly-Setup-2.27.0.exe.blockmap" desktop/dist/latest.yml
```

## Security

What protects the app, and what is left to know:

- **The code that handles your keys is the code in the installer.** It is not downloaded on each start. The page cannot reach Node or the system, other sites cannot use the update commands, and permissions go to the app only.
- **Electron is kept on a supported version.** Electron ships its own Chromium, so an old Electron is an old browser with known holes. The project follows the newest stable major (44 now); older majors stop receiving security fixes. Before each release run `pnpm --dir desktop audit`: the only known advisory left is `sprintf-js` (moderate), a build-time dependency of the packaging tools that is not part of the app and has no fix yet.
- **An installed app refuses to start with switches that open it up** (`--remote-debugging-port`, `--ignore-certificate-errors`, `--disable-web-security`, `--no-sandbox`, `--proxy-server`, `--host-resolver-rules` and similar). Nothing in the app registers a protocol or a file type, so a web page cannot start it with arguments; this is a second lock. `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are turned off in the build itself (fuses).
- **The release pipeline** builds without any token (only the last step, the GitHub CLI, has one), pins every action to its exact commit, runs only for pushes to this repository, and never leaves the token in the folder.

**What is not covered yet: who can publish an update.** An update is trusted because it comes from this repository's GitHub Releases over https and matches the sha512 in `latest.yml`. Whoever can write releases in the repository (or steals a token that can) could publish an update that every installed app would offer to its owner (who still has to press Download and Restart). The only complete fix is to sign the installer and make the app check the signature (`publisherName`, see _Signing the direct installer_ below), or to ship through the Microsoft Store. Until then: protect the GitHub account with two-factor authentication and a hardware key, keep the number of people who can write to the repository to the minimum, and keep `contents: write` only in the workflow job that needs it.

Report a vulnerability as described in [SECURITY.md](../SECURITY.md).

## Speed

What the app does so it starts and runs fast:

- The web app is read from the installer, not downloaded, and its scripts are **compiled once and cached** (V8 code cache for `app://chatterly`), so the second start skips most of that work.
- The page that starts everything is read and prepared once, not on every route.
- The update code is loaded **5 seconds after the window opens**, so it does not compete with the start of the app.
- Windows' window-occlusion detection is turned off, so a call in a window that is behind another one is not slowed down.
- The window opens as soon as its first frame is ready, with the dark background already in place.

It does not move the work of the page itself: the animations and effects of the web app are the same as in a browser (and its low-power mode, `data-perf="low"`, switches on by itself on weak machines).

To measure on your machine:

```
$env:CHATTERLY_TRACE = "$env:TEMP\chatterly-trace.txt"
& "$env:LOCALAPPDATA\Programs\Chatterly\Chatterly.exe"
Get-Content $env:CHATTERLY_TRACE
```

It prints lines like `273 ready-to-show`: the milliseconds since the process started. On the development machine the window is ready at about 0.27 s and the first paint at about 0.35 s, with no long tasks and a steady frame rate. If yours is much slower, send that file.

## Server side

The window's origin is `app://chatterly`, so the server must list it in `CORS_ORIGINS` (it is also checked on the WebSocket). `docker-compose.yml` already does:

```
CORS_ORIGINS: https://your.domain,app://chatterly
```

Without Docker, add `app://chatterly` to the list and restart the server. If sign-in fails with a CORS error, or the WebSocket closes at once (code 1008), this is the cause.

## Microsoft Store (free, signed by Microsoft)

No certificate and no subscription: the Store signs the package.

1. Create a Microsoft Partner Center account (free for individuals and companies).
2. Reserve the app name. In _Product identity_ copy the three values: **Package/Identity/Name**, **Package/Identity/Publisher** and **PublisherDisplayName**.
3. Build the package:

   ```
   pnpm build
   $env:STORE_IDENTITY_NAME = "<Identity/Name>"
   $env:STORE_PUBLISHER = "CN=<Identity/Publisher>"
   $env:STORE_PUBLISHER_DISPLAY_NAME = "<PublisherDisplayName>"
   pnpm --dir desktop dist:store
   ```

   You get `desktop/dist/Chatterly <version>.appx`. (In GitHub: _Actions_, _Build the desktop app_, _Run workflow_, after saving those three values as repository secrets with the same names.)

4. Upload it in Partner Center, fill in the store page, a privacy policy and the age rating, and submit it.
5. Before submitting, replace the default tile images with your own in `desktop/build/appx/` (`StoreLogo.png` 50x50, `Square44x44Logo.png`, `Square150x150Logo.png`, `Wide310x150Logo.png`).

The Store version does not use the self-update: the Store updates it.

## Signing the direct installer (optional)

Only if you do not want the SmartScreen warning on direct downloads and do not use the Store:

- **Azure Artifact Signing** (9.99 USD/month, signs Windows files; check it accepts you).
- A **code signing certificate** from a certificate authority (paid yearly; since 2026 the key must sit on a hardware token or a cloud signing service). electron-builder reads `CSC_LINK` and `CSC_KEY_PASSWORD`.

Once signed, add `publisherName` under `build.win` in `package.json` so the updater also checks who signed each update.

## macOS and Linux (not built yet)

The code is the same. For macOS add a `mac` target (dmg) to `build` in `package.json`, build on a Mac (or a macOS runner), and sign and notarize with an Apple Developer account. For Linux add `AppImage` or `deb`. The picker and menu already handle both.

## Troubleshooting

| Symptom                                                                                                      | Cause and fix                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron starts as plain Node and fails with `Cannot read properties of undefined (reading 'enableSandbox')` | `ELECTRON_RUN_AS_NODE` is set in your terminal (some editors do it). `pnpm --dir desktop start` and the tests remove it; if you run `electron .` yourself, unset it |
| `pnpm dist` says there is no web build                                                                       | Run `pnpm build` at the root first                                                                                                                                  |
| `pnpm dist` says the versions differ                                                                         | `desktop/package.json` must have the same version as `frontend/package.json`                                                                                        |
| electron-builder prints `Cannot create symbolic link` while extracting `winCodeSign`                         | A warning on Windows without developer mode; the build still finishes. Turn on _Developer Mode_ in Windows settings to silence it                                   |
| The installed app cannot sign in                                                                             | The server does not list `app://chatterly` in `CORS_ORIGINS` (see Server side)                                                                                      |
| Windows SmartScreen blocks the installer                                                                     | It is not signed: _More info_, _Run anyway_, or use the Store                                                                                                       |
| The update never arrives                                                                                     | The release is not public, it lacks `latest.yml`, or its version is not higher than the installed one                                                               |

## What is in this folder

```
desktop/
  src/main.cjs           the app: window, permissions, screen picker, navigation lock
  src/preload.cjs        the only thing the page sees (isDesktop, platform, the API address)
  src/bundle.cjs         serves the packed web app as app://chatterly
  src/updater.cjs        the self-update
  src/server-url.cjs     which server, and the https rule
  src/trace.cjs          optional start-up timings (CHATTERLY_TRACE)
  src/picker.html        the "share your screen" window (+ picker-preload.cjs)
  src/offline.html       the page shown when the server cannot be reached
  scripts/start.mjs      starts it for development
  scripts/copy-web.mjs   copies the web build into desktop/web
  scripts/dist-store.mjs builds the Microsoft Store package
  test/desktop.mjs       the checks
  build/icon.png         the icon (the installer and the window)
  web/  dist/            made by the build; never committed
```
