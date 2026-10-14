# Security policy

Chatterly-Renewed is built so that the server cannot read messages or listen to calls. If you find a way around that, or any other vulnerability, please tell us privately.

## What the app guarantees (and what it does not)

- Messages, reactions and attachments are encrypted in the browser; the server stores only ciphertext. Call media is encrypted frame by frame in the browser, and the signaling that sets calls up is encrypted and signed between the two people.
- With `RELAY_ONLY=1` calls use only your TURN relay and fail instead of connecting directly. The relay and the machine that hosts it can see network addresses and traffic volume.
- Profile pictures and banners are end-to-end encrypted: the server stores ciphertext, and the key of each picture is sealed for the people who may see it (friends, people who share a server, direct conversations). The server still knows who has a picture and how big it is, someone who saw a picture keeps what they saw, and a new contact gets the key the next time the owner is online. Group icons are encrypted too (since 2.23.0): the key of the icon travels with the group, sealed with the group key, and the server gives the icon only to the members of the group. Private photographs are best sent as attachments.
- **The names of groups, of their channels and of member tags are sealed with the group key (since 2.24.0):** the server cannot read them, and every text is bound to its group, to what it names and to the key version. (The tag a person chooses to show on their profile is public, because it is shown to people outside the group.) Groups made before are sealed by their owner the next time the owner opens the app.
- **The personal library (camera backgrounds) is end-to-end encrypted (since 2.30.0):** each file has its own random AES-256-GCM key; that key and the description of the file (name, type, thumbnail) are sealed with a key derived from the identity of the person, and the identifier of the item is part of what every encryption is bound to, so the server cannot swap the parts of two items. The server holds ciphertext and knows only the size and the time; it is limited per person (40 items, 12 MB each, 160 MB in all) and erased with the account. The cutout of the background runs on the device with files of the app (no network, no CDN); the page allows WebAssembly for it (`wasm-unsafe-eval`), not the evaluation of text as code.
- An account that writes too much in an hour (largest messages, one after another) is stopped, so one account cannot fill the disk.
- Keys of contacts are pinned the first time they are seen; calls with a changed key are refused until reviewed. Compare the safety number for high-stakes conversations.
- A server that serves malicious JavaScript can defeat any of this: the guarantees assume the code you load is this repository's.
- **The Windows app (`desktop/`) carries that code inside its installer**, so a server cannot swap it. It is a sandboxed window with no access to Node, it refuses to start with switches that weaken it, and it follows a supported Electron (Chromium) version. The installed app may connect only to its own server. **Every update is signed (Ed25519)** with a key that only the publishing job of the workflow holds; the app checks that signature, then the hash of the installer, before it downloads anything, so neither GitHub nor the server can pass off another installer, and an app never goes down in version (the only exception is a beta that goes back to the release channel). The stable releases come from this repository's GitHub Releases; the **beta versions are not published there**: they are served by the Chatterly server only to the accounts an administrator made testers (a token of two hours per account, checked again on every download, so taking a tester off the list stops them at once), and the server keeps no record of who downloads what. The installer is not yet signed by Windows (Authenticode), so Windows shows its SmartScreen warning on a direct download. Details: [DOCS.md](DOCS.md#9-versiones-ramas-y-programa-beta) and [DOCS.md](DOCS.md#10-compilar-y-publicar-las-apps).

## How to report

Use the private vulnerability reporting of the repository (Security tab), or write to the maintainer through the contact in the repository profile. Please include the steps to reproduce it, the version (Settings > About) and what an attacker gains.

Please do not open a public issue for a vulnerability and do not test against servers you do not own.

## What to expect

We acknowledge reports as soon as we can, fix confirmed problems in the next release and credit you in the changelog if you wish.

## Supported versions

Only the latest release receives security fixes.
