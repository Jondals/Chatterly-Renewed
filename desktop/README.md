# Chatterly desktop (Electron)

[Español](README.es.md)

The Chatterly web app in its own Windows window. The installer carries the web build inside it, so the code that handles your keys is the one that was installed, not whatever a server sends on each start. The shell adds no way to read messages and sends nothing anywhere: encryption, calls and the relay-only policy all run in the web code, exactly as in a browser.

macOS and Linux use the same code (only the packaging differs; see the end).

## What it does

- **Bundled web app.** The web build lives in `web/` inside the installer and is served as `app://chatterly`. The window talks to the server only for the API (`https://…/api`, `wss://…/ws`).
- **Hardened window.** Sandboxed renderer, context isolation, no Node in the page, developer tools off when installed. The page sees only `window.chatterlyDesktop` (`isDesktop`, `platform`) and `window.CHATTERLY_API`.
- **Links never leave the app.** Other sites open in your default browser; pop-ups are denied.
- **Permissions.** Camera, microphone, notifications and screen capture are granted to the app itself only, never to an embedded frame (YouTube and the like).
- **Screen sharing** has its own picker. System audio is not shared on purpose: on Windows it would also capture the voices of the call and echo them to everyone.
- **Tray.** Closing the window hides it and a call keeps going; the tray menu quits for real.
- **Offline page** (remote mode only): if the server is unreachable it shows a page and retries every 5 seconds.
- **Updates by itself** (see [Updates](#updates-they-install-by-themselves)).
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

| Variable                | What it does                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CHATTERLY_URL`         | The server (API). Default: the public site. An installed app only accepts `https`; `http` only for `localhost` while developing |
| `CHATTERLY_MODE=remote` | Development only: load the server itself instead of the packed web app                                                          |
| `CHATTERLY_WEB_DIR`     | Development only: use this web build instead of `desktop/web`                                                                   |
| `CHATTERLY_NO_UPDATE=1` | Turns the self-update off                                                                                                       |
| `CHATTERLY_UPDATE_URL`  | Development only: a folder with `latest.yml` to check and download from (it never installs). Used by the tests                  |

An installed app ignores `CHATTERLY_MODE`, `CHATTERLY_WEB_DIR` and `CHATTERLY_UPDATE_URL`, so an environment variable cannot swap the code that holds the keys.

## Test it

```
pnpm --dir desktop test
```

About 200 checks of the shell: dangerous settings in the source, the rule for the server address, the running app (no Node in the page, navigation, permissions, microphone and camera, screen picker, one copy only, tray), the `app://` server (what it serves and refuses, path traversal), the updater (finds, downloads, refuses a wrong hash) and, if you built one, the installed app (fuses, starts from its asar).

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

## Updates (they install by themselves)

The installed app looks for a new version **at start and every 6 hours**, downloads it in the background and installs it **without asking anything**:

1. If it arrives in the first 3 minutes after starting (nobody can be in a call yet), the app restarts at once.
2. Otherwise it installs when the app closes.
3. If the window is hidden in the tray and nothing has been playing for 10 minutes, it restarts then. It never restarts while the window is visible or something is playing, so a call is not cut.

It reads the **GitHub Releases** of the repository, and it checks the sha512 of the download against `latest.yml`. Until the installer is signed there is no publisher check on top of that, which is the reason to sign it or use the Store. The Microsoft Store version is updated by the Store, not by this.

### Publish a version (so installed apps update)

1. Raise the version **everywhere, to the same number**: `package.json`, `backend/package.json`, `frontend/package.json`, `frontend/src/app/version.ts` and `desktop/package.json`. Add the entry in `CHANGELOG.md`.
2. Commit and push.
3. Push a tag with that number:

   ```
   git tag v2.25.0
   git push origin v2.25.0
   ```

4. The workflow [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) builds the web app, runs the desktop tests, builds the installer and attaches `Chatterly Setup …exe`, `latest.yml` and the blockmap to the release of that tag. Installed apps find it within hours.

The repository (or at least its Releases) must be **public**, or the apps cannot download updates. The tag push does not deploy the server (`deploy.yml` ignores `desktop/` and tags).

By hand instead of the workflow (needs a GitHub token with write access to the repository):

```
$env:GH_TOKEN = "<token>"
pnpm build
pnpm --dir desktop release
```

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

The code is the same. For macOS add a `mac` target (dmg) to `build` in `package.json`, build on a Mac (or a macOS runner), and sign and notarize with an Apple Developer account. For Linux add `AppImage` or `deb`. The tray, picker and menu already handle both.

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
  src/main.cjs           the app: window, tray, permissions, screen picker, navigation lock
  src/preload.cjs        the only thing the page sees (isDesktop, platform, the API address)
  src/bundle.cjs         serves the packed web app as app://chatterly
  src/updater.cjs        the self-update
  src/server-url.cjs     which server, and the https rule
  src/picker.html        the "share your screen" window (+ picker-preload.cjs)
  src/offline.html       the page shown when the server cannot be reached
  scripts/start.mjs      starts it for development
  scripts/copy-web.mjs   copies the web build into desktop/web
  scripts/dist-store.mjs builds the Microsoft Store package
  test/desktop.mjs       the checks
  build/icon.png         the icon (the installer and the tray)
  web/  dist/            made by the build; never committed
```
