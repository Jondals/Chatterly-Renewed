# Contributing to Chatterly-Renewed

[Español](CONTRIBUTING.es.md)

Thank you for wanting to help. This guide is short on purpose.

## Set up

1. Install Node.js 20 or newer and pnpm.
2. `pnpm install:all` installs the root, backend and frontend packages.
3. `pnpm dev` starts the backend (port 3000) and the frontend (port 4200) together.

## Before you open a pull request

- `pnpm typecheck` must pass for both projects.
- `pnpm test` runs the single end-to-end test (two real browsers, a real call). It must end with `ALL CORRECT`. On Windows you can also run `test/chatterly-test.exe`.
- Keep the changes small and focused: one idea per pull request.

## Code style

- All code, identifiers and comments are in English. User-facing text goes through the translation pipe, and every new string needs an entry in `frontend/src/app/core/i18n/es.ts` (`node frontend/scripts/i18n.mjs --check` lists what is missing).
- Every file starts with a header comment saying what it does, and every function has a short comment.
- No lambda (arrow) functions: use named functions or `bind`.
- Format with Prettier (`pnpm --dir frontend exec prettier --write .`).
- Keep the cursor, the animations and the hover states consistent with the rest of the interface.

## Security

Never log, store or send message text, passwords or keys. If you find a vulnerability do not open a public issue: read [SECURITY.md](SECURITY.md).

## Adding a language

Translations live in one dictionary per language in `frontend/src/app/core/i18n/`. Copy `es.ts`, translate the values and register the language in `i18n.service.ts`.

## Desktop app (Windows)

The Windows app lives in `desktop/` (Electron) and carries the web build inside it.

```
pnpm --dir desktop install
pnpm --dir desktop start      # run it from the source
pnpm --dir desktop test       # about 230 checks of the shell (also part of pnpm test)
pnpm build && pnpm --dir desktop dist   # builds the installer in desktop/dist
```

How to run, test, build the installer, update and publish to the Microsoft Store is in [desktop/README.md](../desktop/README.md) (Spanish: [desktop/README.es.md](../desktop/README.es.md)). Two rules for this folder:

- The page may talk to the desktop shell only through the fixed commands in `desktop/src/preload.cjs`. A new command or channel needs a security review and its entry in the list that `desktop/test/desktop.mjs` checks.
- The same code style applies: English, a header comment per file, no arrow functions, Prettier.

## Releases

There is one version for the whole project (web, server and desktop app). To release:

1. Raise the version, to the same number, in `package.json`, `backend/package.json`, `frontend/package.json`, `frontend/src/app/version.ts` and `desktop/package.json`, and add the entry to `CHANGELOG.md`.
2. Commit and push.

The server updates itself from that push (`deploy.yml`), and the Windows installer is published by the `desktop.yml` workflow as the release `v<version>`. Nobody needs to create tags by hand. People using the desktop app see "A new version is available" in the notifications of the bell, download it and restart when they choose.
