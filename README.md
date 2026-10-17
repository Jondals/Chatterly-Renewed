<div align="center">

<img src="frontend/public/favicon.svg" width="84" alt="Chatterly-Renewed logo" />

# Chatterly-Renewed

**End-to-end encrypted chat, guilds and peer-to-peer WebRTC calls — with a UI that feels alive.**

**English** · [Español](README.es.md)

![version](https://img.shields.io/badge/version-2.35.2-2ef2b0?style=flat-square)
![encryption](https://img.shields.io/badge/E2EE-AES--256--GCM%20%C2%B7%20ECDH%20P--256%20%C2%B7%20ECDSA-8b5cf6?style=flat-square)
![calls](https://img.shields.io/badge/calls-WebRTC%20mesh%20%C2%B7%20DTLS--SRTP-38e8ff?style=flat-square)
![tests](https://img.shields.io/badge/test-1%20completo-2ef2b0?style=flat-square)

</div>

Chatterly-Renewed is a Discord-style app — direct messages, friends, guilds with text and voice channels,
file sharing, voice notes, emoji reactions, voice/video calls and screen sharing — built so that **the
server cannot read your conversations or listen to your calls**. Keys are generated in your browser and
never leave it unencrypted.

## Arriving

Every load of the page opens with an animated introduction (aurora, lights that gather into the logo, a lock that snaps shut and a shockwave), signing in opens the app like an iris and creating an account ends in fireworks. They only load when they play and are skipped with reduced motion.

## What is new in 2.0

Chatterly 2.0 gathers everything of the 1.x line: calls that keep going while you use the rest of the app (the
music, the videos, Spinly and the shared screens go on), a soundboard, shortcuts, groups with tags that the owner
orders, gradients of up to five colors for names, banners and bubbles, animated GIFs and videos as pictures and
wallpapers, seven families of cursors, link previews that play in the chat, and a guide to put it all on a free
server (`deploy/`). The look is the same; the changes of 2.0 are in how it works and in the details listed in
the [changelog](CHANGELOG.md).

## Features

- 🔐 **Zero-knowledge accounts** — your password never reaches the server.
- 💬 **E2EE direct messages & guild channels**, signed per message (shield mark on verified contacts).
- 📞 **Peer-to-peer voice, video and screen sharing** (full-mesh WebRTC, up to 8 people), Opus 48 kHz,
  HRTF spatial audio, real telemetry (RTT, jitter, loss, bitrate, SRTP cipher), soundboard.
- ✓ **Message status marks** (sent, delivered, read) with privacy switches.
- 👥 **Friends** (requests, presence, TOFU key pinning, safety-number verification).
- 🛰️ **Groups** with owner-managed channels, invitations, member removal and **automatic group-key rotation**.
- 📎 **Encrypted attachments** (per-file key, SHA-256 verified), 🎙️ voice notes, 😀 emoji picker,
  `:shortcodes:`, reactions (also encrypted), replies, edit/delete, typing indicators, markdown-lite with code blocks.
- 🎡 **Spinly wheels and tournaments built in**: send one from the `+` menu like a poll (anyone runs it once, everybody sees the same result) or put one in a call for everybody to spin, edit and play again; link your Spinly account for your own themes and presets. Also right-click menus, friend nicknames, and an "Activities" menu in calls to **listen to YouTube/Spotify together** (with a shared queue, playlists and votes to skip), **watch YouTube videos together** or spin a Spinly, each one a tile of the stage. Keyboard shortcuts for the call (mute, deafen, camera, screen, soundboard, hang up) can be changed in Settings; the soundboard has the tabs All, Default and Yours, a volume slider, your own sounds (which everybody in the call hears) and any audio or video that somebody marks "for the soundboard" in a chat can be added with one button. Group owners can make tags for the members (shown as sections of the members list), and names and banners can use gradients with a third color and their own start and end. Groups can be reordered by dragging them in the side bar, and the wallpaper can be a GIF or a short video that moves.
- 🧩 **Presets and server tags** — save the look of the app or of your profile (wallpaper, fonts and pictures included) with a name and share it in a chat: a friend imports it with one button (everything that comes from another person is checked first). The owner of a group makes a tag that members can show next to their name. Removing a friend deletes the chat and takes them out of your groups.
- 🎨 **Living UI** — 20+ animated backgrounds (with shuffle), aura rings, 10 themes, custom colour picker with
  eyedropper, animated and trailing cursors (your own `.cur`/`.ani` too), UI sounds that are audio files you can replace (organized in `frontend/public/sounds`), four call ringtones (or your own, cut to the part you want), your own fonts, soundboard,
  smooth transitions, reduced-motion support.

## Quick start

Requirements: **Node.js 20+** and **pnpm**.

```bash
pnpm run install:all       # root + backend + frontend
pnpm dev                # backend on :3000, frontend on :4200
```

Open <http://localhost:4200>, create two identities in two browsers (or one normal + one private window),
add each other as friends and call. Chromium/Edge/Firefox work; microphone access needs `localhost` or HTTPS.

```bash
pnpm test                   # el único test: tipos, idiomas, navegador real, E2EE y API
pnpm build              # production builds (backend -> dist/, frontend -> frontend/dist/)
pnpm typecheck
```

`pnpm test` runs [`test/run.mjs`](test/run.mjs), the single test. It needs Chromium once: `pnpm exec playwright install chromium`.
GIF search needs a free GIPHY key in `backend/.env` (`GIPHY_API_KEY=...`, see `.env.example`); a Tenor key is optional and merged when present (Tenor shut its API down).

`pnpm dev` runs the unoptimised dev server (menus can feel slow). For the real speed run `pnpm app` (builds and serves the production version on :4200 + :3000).

### Configuration

All backend settings are environment variables (see [`backend/.env.example`](backend/.env.example)):

| Variable                            | Default                                       | Purpose                                                                                  |
| ----------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `PORT` / `HOST`                     | `3000` / `0.0.0.0`                            | Listen address                                                                           |
| `CORS_ORIGINS`                      | `http://localhost:4200,http://127.0.0.1:4200` | Allowed web origins (also checked on WebSocket upgrade)                                  |
| `JWT_SECRET`, `SERVER_SECRET`       | auto-generated in `data/secrets.json`         | **Set both in production**                                                               |
| `DATA_DIR`, `DB_PATH`, `UPLOAD_DIR` | `./data`                                      | SQLite database and encrypted blobs                                                      |
| `STUN_URLS`                         | Google STUN (none with a relay)               | ICE servers for calls                                                                    |
| `RELAY_ONLY`                        | –                                             | `1` = every call must use the TURN relay; calls are **refused** if it is down            |
| `TURN_URLS`, `TURN_SECRET`          | –                                             | coturn (`use-auth-secret`) — issues short-lived credentials per user                     |
| `TLS_KEY`, `TLS_CERT`               | –                                             | Serve HTTPS directly (otherwise terminate TLS in a reverse proxy)                        |
| `TRUST_PROXY`                       | –                                             | Number of reverse proxies in front (`1` for Caddy): correct client IPs for rate limiting |

The frontend finds the API at `<page-host>:3000`. To point elsewhere without rebuilding, define
`window.CHATTERLY_API = 'https://api.example.com'` in a `<script>` before the app boots.

> **Production checklist:** serve everything over HTTPS/WSS, set `JWT_SECRET`/`SERVER_SECRET`, restrict
> `CORS_ORIGINS`, run a TURN server (without one, peers behind symmetric NATs cannot connect), and back up `data/`.

## How the security works

### Accounts (zero-knowledge)

```
password ──PBKDF2-SHA256 (600k, per-user salt)──► master ──HKDF──┬─► authSecret  → sent to server
                                                                 └─► wrappingKey → never leaves the browser
```

- The server stores `scrypt(authSecret)`. A database leak reveals neither the password nor the wrapping key,
  and HKDF-splitting keeps the full PBKDF2 cost for anyone attacking the auth hash.
- At registration the browser generates an **ECDH P-256** identity (encryption) and an **ECDSA P-256**
  identity (signatures). The private keys are stored on the server only as `AES-256-GCM(wrappingKey, PKCS#8)`,
  so you can sign in on another device — and the server can never use them.
- On the device, unlocked keys are re-imported as **non-extractable** `CryptoKey`s in IndexedDB: scripts can
  use them but cannot read the key bytes. On unlock the client verifies the private key really matches the
  advertised public key, and refuses servers that request a weaker KDF than 200k rounds.
- Sessions are 15-minute JWTs that name their session (closing the session stops the token at once) plus single-use rotating refresh tokens (stored hashed). Per-IP rate limits,
  per-account lockout after repeated failures, constant-time responses for unknown users and a fake-salt
  endpoint prevent account enumeration.

### Messages

| Conversation   | Key                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Direct message | `HKDF(ECDH(myPrivate, theirPublic))`, bound to both public keys and the channel id                                        |
| Guild channel  | One shared AES-256-GCM group key per _key version_, delivered to each member as an envelope wrapped with the pairwise key |

- Every message is `AES-256-GCM` with a fresh 96-bit IV, padded to 64-byte buckets, and the channel,
  sender and key version are bound as **additional authenticated data**.
- The sealed blob is also **ECDSA-signed** with the sender's identity key, so even a malicious server (or a
  fellow guild member) cannot forge, edit, re-attribute or replay messages into another chat.
- When a member leaves or is removed, the owner generates a **new group key** for the remaining members;
  the removed member can neither fetch nor decrypt anything new.
- Attachments get their own random key and are uploaded as ciphertext; the key, IV and SHA-256 travel
  _inside_ the encrypted message and are verified after download. Only allow-listed media types render inline.
- Reactions, edits and voice notes use the same envelope. Message text is rendered from typed segments, never
  as HTML, and the app ships a strict CSP with no third-party origins.

### Calls

- Media is **peer-to-peer** over WebRTC (DTLS-SRTP). There is no media server: the backend never touches audio or video.
- Signaling (SDP offers/answers, ICE candidates) travels through the server but is **encrypted with the pairwise
  key and signed** with each peer's identity key, with per-session ids and counters against replay. The server
  cannot read it or swap DTLS fingerprints to mount a man-in-the-middle attack.
- With `RELAY_ONLY=1` every connection is created with `iceTransportPolicy: "relay"` and only your TURN relay as ICE server, so the other people in the call never learn your address. It **fails closed**: if the relay is missing, down or its credentials are expired, the call is not started (it never falls back to direct or public STUN), and a connection that is found to use a non-relayed path is closed. The relay (and its host) still sees addresses and traffic volume, but not the content.
- A contact whose identity key changed is not called until you review the change; signals that open a session must be recent.

### Verifying your contacts

The first identity fingerprint seen for a contact is pinned (trust-on-first-use); if it changes you get a
warning. For high-stakes conversations compare the **safety number** (🛡 in the chat header) over a trusted channel.

### What the server still sees (honest threat model)

Profile pictures and banners are **end-to-end encrypted** (since 2.18.0): the browser encrypts each one with its own random key, the server keeps only ciphertext, and the key is sealed for each person who may see it (friends, people who share a server, direct conversations) with the pair key of the owner and that person. A person who is not in that circle gets nothing, and the server cannot open any of them. Limits: someone who saw a picture keeps what they saw, a new friend sees the picture the next time its owner is online (their browser seals the key then), and the server still knows who has a picture and its size. **Group icons are encrypted too** (since 2.23.0): the owner's browser encrypts the icon, the key travels with the group sealed with the group key, and the server hands the icon only to the members of the group. Photos that are private belong in chat attachments.

The application cannot protect you from a server that serves you malicious JavaScript: the end-to-end guarantees assume the code you load is the code in this repository.

Usernames, profile fields, friend graph, guild membership (**not** the names of guilds, channels and member tags: since 2.24.0 they are sealed with the group key; the tag a person chooses to show on their profile is public), message timestamps, sizes (bucketed)
and sender/recipient ids, file sizes, who is online and who is in which call. It sees **no** message text,
attachment content, reaction emoji, call audio/video or call signaling content.

Known limitations: DM keys are static pairwise keys (no per-message forward secrecy / double ratchet yet);
a user who loses their password cannot recover their identity; a compromised _client_ (malicious frontend
build, XSS) is outside what E2EE can protect. Deploy the frontend from a source you trust and pin it.

How the pieces fit together, and why they are the way they are, is explained in [DOCS.md](DOCS.md) (in Spanish).

## Desktop app (Windows)

The same app in its own window, with the web build inside it and a self-update that installs by itself. Everything to run, test, build the installer, publish updates and ship to the Microsoft Store is in [DOCS.md](DOCS.md):

```
pnpm build                  # the web app the installer carries
pnpm --dir desktop install
pnpm --dir desktop dist     # desktop/dist/Chatterly Setup <version>.exe
```

The server must list `app://chatterly` in `CORS_ORIGINS` (`docker-compose.yml` already does).

## Project layout

```
backend/                 Fastify 5 + SQLite (better-sqlite3) + WebSocket
  src/app.ts             server, security headers, CORS, JWT
  src/db.ts              schema and migrations
  src/routes/            auth, messages and receipts, guilds, social, gifs, images, link preview
  src/security/          password hashing, login throttle
  src/ws/                realtime socket (typing, calls, signaling)
frontend/                Angular 21 (signals) + Tailwind 4
  src/app/core/crypto    WebCrypto library (KDF, identity, E2EE, files, fingerprints)
  src/app/core/services  auth, socket, WebRTC calls, sound, settings, cursor, Spinly bridge, receipts
  src/app/store          friends, guilds, messages (decrypt pipeline)
  src/app/features       auth, chat, direct, guild, settings, spinly, voice
  src/app/layout         rail, sidebar, dialogs, call dock
  src/app/shared         components, pipes, utilities
  public/sounds          every sound of the app as an audio file in organized folders (see DOCS.md)
  scripts/postbuild.mjs  pre-render and CSP hash
scripts/                 production server used by the test and Lighthouse
test/                    the single test, split by topic: run.mjs + e2e/ (browser), security.mts + security/ (no browser), chatterly-test.exe
deploy/                  server and deployment: Caddy, coturn, .env template (see DOCS.md)
.github/                 issue and pull request templates, workflows (server and apps)
Dockerfile, docker-compose.yml   stay at the root: the server and its deployment build from here
```

## Spinly

The wheel and the tournament are native: they work for everybody without Spinly. In a chat, a wheel or tournament is a message with a hidden, encrypted "run" reaction; the first run wins, and the random id the server gives that reaction seeds the spin, so every device shows the same result and nobody can pick it. In a call, the current wheel or tournament is copied between participants through the encrypted call signaling (newest change wins), and every spin carries its own seed.

The real Spinly app is still reachable (Settings, Integrations, or "Open the full Spinly" in the composer): Chatterly frames it in a panel and listens to `postMessage` results from its origin; results are validated before they become a chat card. Linking the account opens that panel and asks Spinly (`send-profile`) for the names and colors of the person's themes and presets (never the login), which Chatterly keeps on this device. Spinly must be deployed with its `chatterly-bridge` and a `frame-ancestors` that allows Chatterly.

## Tech stack

Angular 21 · Tailwind CSS 4 · WebCrypto · WebRTC · Fastify 5 · @fastify/websocket · @fastify/jwt · @fastify/helmet ·
@fastify/rate-limit · better-sqlite3 · Playwright.

## Testing

There is one test, `pnpm test` (or run `test/chatterly-test.exe`), and it leaves nothing behind (temporary build, database and servers are deleted at the end). It checks:

- type checking of backend and frontend, and that every UI string is translated;
- two real Chromium browsers: register, friends, chat with colours, emoji and stickers, GIF tab, **end-to-end encrypted call with video** (identical security codes and encrypted frames flowing), groups with text and voice channels;
- settings: profile picture and banner upload, fonts, appearance, language, WhatsApp sticker import, themed cursor, UI sounds, animated credit, mobile layout;
- that the server never stores message text or passwords in the clear, rejects requests without a session and refuses foreign CORS origins.

## Contributing

Read the contributing section of [DOCS.md](DOCS.md) first (it also holds the code of conduct). Security problems go through [SECURITY.md](SECURITY.md).

## License

ISC © Chatterly-Renewed contributors. See [CHANGELOG.md](CHANGELOG.md) for release notes.
