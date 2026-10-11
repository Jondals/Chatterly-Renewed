# Architecture

This page explains how Chatterly-Renewed is put together and, above all, **why** each piece is the way it is. Spanish version: [ARCHITECTURE.es.md](ARCHITECTURE.es.md).

## The idea in one paragraph

The server is a post office that cannot open the letters. Everything that is private (message text, reactions, attachments, call media, the names of groups and channels, profile pictures) is encrypted **in the browser** with keys that never leave it in clear. The server stores ciphertext, checks **who may ask for what**, and relays real-time events. Because of that, almost all the interesting logic is in the frontend, and the backend is deliberately small and strict.

## Map of the repository

```
backend/    Fastify 5 + SQLite (better-sqlite3) + WebSocket        the post office
frontend/   Angular 21 (signals, standalone) + Tailwind 4          where keys live and everything is drawn
deploy/     Caddy, coturn, systemd, update script                  how it runs on a server
scripts/    production server (static files), backup               small tools, no dependencies
test/       ONE test: `pnpm test`                                  see "Tests"
```

## Backend (`backend/src`)

| Piece            | What it does                                                                       | Why it is like this                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `app.ts`         | Builds the server: headers, CORS, rate limits, JWT, error handler                  | One function builds everything, so the tests build the _real_ server in memory (no mocks that could drift from production)      |
| `db.ts`          | Schema and migrations of SQLite                                                    | SQLite is one file, easy to back up and enough for a self-hosted chat; migrations are additive and refuse a newer database      |
| `routes/*.ts`    | One file per area: auth, social, guilds, messages, images, settings, gifs, preview | A route checks **who is asking** before it touches anything. A missing or foreign id answers 404 (so ids cannot be probed)      |
| `validation.ts`  | Shapes of the fields (base64, sealed texts, ids)                                   | Every body is validated by schema; the server never trusts the client's format                                                  |
| `security/`      | Password hashing, login throttle, sessions                                         | Tokens are valid only while their session is open: signing out, changing the password or erasing the account kills them at once |
| `ws/`            | The real-time socket: presence, typing, calls                                      | The server only relays opaque, encrypted signaling between people who are in the same room                                      |
| `maintenance.ts` | Hourly cleanup of what nothing can reach                                           | Without it, abandoned uploads and dead sessions would stay forever                                                              |

### What the server stores (and cannot read)

- **Sealed with a key the server never has:** message text, reactions, file content, the names of groups, channels and member tags (since 2.24.0), profile pictures, banners, group icons, the user's settings blob.
- **In clear, because the server needs it to work:** usernames, who is friends with whom, who belongs to which group, timestamps, sizes (bucketed), who is online. This is listed honestly in the README ("What the server still sees").

## Frontend (`frontend/src/app`)

| Folder           | What is in it                                                                          | Why                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `core/crypto/`   | WebCrypto code: key derivation, identity, pairwise and group keys, files, media cipher | Pure functions with no Angular, so the same code is used by the app and by the security test |
| `core/services/` | Auth, socket, WebRTC calls, sound, settings, cursor, presets, images                   | One service per concern; state is in signals                                                 |
| `store/`         | Friends, guilds, messages (the decrypt pipeline)                                       | The only place that turns server payloads into things the screens can show                   |
| `features/`      | One folder per screen: auth, chat, direct, guild, settings, spinly, voice              | Screens are lazy-loaded: the sign-in page does not pay for the call screen                   |
| `layout/`        | Rail, sidebar, dock, dialogs                                                           | The frame that stays while the page changes                                                  |
| `shared/`        | Components, pipes, directives, utilities                                               | Reusable pieces with no knowledge of the features                                            |
| `styles/`        | Global CSS by area                                                                     | Tailwind for layout, plain CSS where an effect needs it                                      |

### Cryptography in four lines

1. **Identity:** each person has an ECDH and an ECDSA key pair made in the browser and wrapped with a key derived from the password (the password never reaches the server).
2. **Direct chats:** ECDH between the two identities, expanded with HKDF into an AES-256-GCM key bound to the conversation; every message is also signed.
3. **Groups:** one AES-256-GCM key per group and version. Each member holds it wrapped for their own key pair. When somebody leaves, the owner makes a new version and **seals again everything that depends on it** (messages use the new key from then on; the icon key and the names are sealed again in the same request).
4. **Calls:** the media is encrypted frame by frame with keys that renew themselves; the signaling is encrypted and signed.

Every sealed text is **bound to its context** (group, kind of text, id of the thing it names, key version). This is why the server cannot give the name of one channel to another channel, nor move a sealed text between groups.

### Decisions worth knowing

- **Signals, not RxJS state.** The UI state is `signal`/`computed`; RxJS is only used where a stream is the natural shape (socket events, router events).
- **No arrow functions.** The project uses `function` + `.bind` everywhere (a style choice made early and kept so the whole code reads the same way).
- **One route per screen, with optional parts.** `groups`, `groups/:guild` and `groups/:guild/:channel` are a single route (`app.routes.ts`, `optionalParams`). With one route per address shape, Angular destroyed and rebuilt the screen when the channel was added to the address, and the page jumped.
- **Animations only move `transform` and `opacity`.** Those two are done by the graphics chip; anything else (filters, clip-path, background position) is drawn again by the page every frame. The animated names, the stickers and the dock follow this rule; the few exceptions are drawn once and only their opacity moves.
- **A "light mode" for weak devices.** `main.ts` marks phones and weak machines (`data-perf="low"`): no blur behind panels, a quieter arrival animation, quick motion. A frame monitor can switch it on later if the page stutters.
- **Heavy work off the page.** The light show of the arrival runs in a worker with an `OffscreenCanvas`; the media cipher of calls runs in a worker too.
- **Everything is self-hosted.** No third-party scripts, fonts or trackers; the CSP lists only what the page really talks to (the players that can be embedded in a message are opt-in).
- **Texts go through one dictionary.** Every visible string is in `core/i18n/es.ts` and a script (`scripts/i18n.mjs --check`) fails the build when one is missing.

## Tests

There is **one command**, `pnpm test`, and it leaves nothing behind. It is split by topic so each file is readable:

```
test/run.mjs          the runner: runs the steps in order
test/e2e/             the browser test: one file per step (sign-up, friends, chat, calls, groups, settings...)
test/e2e/support.mjs  what the steps share (temporary folder, ports, cleanup)
test/security.mts     the runner of the security checks (no browser)
test/security/        one file per topic: sessions, authorization, images, sockets, deletion, headers...
```

The security checks build the real backend in memory and **attack it the way a hostile account would**; the browser test drives two real Chromium windows (and, with `CHATTERLY_BROWSER=firefox`, Firefox).

## Where it is _not_ perfect

These are known and written down, not hidden: direct-message keys are static (no per-message forward secrecy yet); a server that serves malicious JavaScript defeats any end-to-end promise; the server still sees the social graph and timestamps. See [SECURITY.md](SECURITY.md).
