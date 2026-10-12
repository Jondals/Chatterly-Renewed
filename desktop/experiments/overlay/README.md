# In-game overlay: is it possible?

[Español](README.es.md)

The question: like Discord, show the cameras (and who is talking) of your friends **on top of the game you are playing**, pinned where you want them, movable and resizable. Desktop app only.

**Short answer: yes, for games in windowed or borderless mode (most games today); no for "exclusive fullscreen"; and without touching the game, so it does not look like cheating.** An experiment in this folder proves the hardest technical part.

## Two ways to build an overlay

| | What it is | Games it works in | Risk |
|---|---|---|---|
| **Injection** (what Discord does) | A DLL is loaded inside the game and hooks its graphics API (DirectX, OpenGL, Vulkan) to draw on each frame | Also exclusive fullscreen | Anti-cheat systems detect hooks and injected DLLs and can ban; Discord needs the vendors to allow it. Native code, signed, per-API. **Not realistic for this project** |
| **A window on top** (what this experiment does) | A transparent window, without frame, always on top, that never takes the focus and lets the mouse through. It is another window of the app: it does not read or change the game | Windowed and borderless (the "fullscreen optimizations" of Windows 10/11 make many "fullscreen" games borderless too) | An exclusive-fullscreen game takes over the monitor and no other window can be drawn over it. No injection, so nothing for an anti-cheat to flag (it cannot be guaranteed for every game: test the ones that matter) |

## What the experiment proves

`node desktop/experiments/overlay/run.mjs` (add `OVERLAY_VISIBLE=1` to see the two windows for a few seconds; without it they stay off screen, and an off-screen window is not drawn, so the frame rate only means something when visible).

It makes a live video in a "call" window and shows it in an overlay window through a **local WebRTC loopback** (both ends on the same computer, no STUN, no TURN, nothing on the network). On the development machine (Electron 44):

- the first picture reaches the overlay in **about 0.45 s**;
- **30 frames per second**, steady, at 320x180 (the call sends the picture at half size to the overlay: a tile does not need more);
- the whole app (5 processes, both windows) uses **about 2% of one core** and 12 MB less than a normal call window would;
- the overlay window is created as it has to be: `alwaysOnTop` at the `screen-saver` level, `focusable: false`, transparent, without frame, outside the taskbar, `setIgnoreMouseEvents(true, { forward: true })`.

Why a loopback: a `MediaStream` cannot be handed to another window (each window is its own process), and the Document Picture-in-Picture API, which would let the page draw into a window of its own, is a feature of the Chrome browser itself that Electron does not have. The loopback is the usual way, and it keeps the end-to-end encryption model intact: the frames are already decrypted in the call window, travel inside the computer, and never leave it.

## How it would work in Chatterly

1. **The overlay window**: one per screen, as big as the screen, transparent and click-through. It draws the tiles (camera or avatar, name, microphone state) of the people in the call.
2. **A hotkey** (for example Ctrl+Shift+O, chosen by the person) turns on *edit mode*: the window stops letting the mouse through, and the tiles can be dragged, resized, pinned and hidden. When edit mode ends, the window is click-through again and the focus goes back to the game.
3. **Layout per screen**, remembered (the same idea as `window-state.json`).
4. **The video** reaches the overlay through the loopback of the experiment, only for the tiles that are on show, at low resolution.
5. **When to show it**: first by hand (hotkey and a setting), then automatically when a game is running. Detecting the game needs the process list or the foreground window; Electron has no API for it, so it needs either a periodic query of the system (PowerShell, heavy and slow) or a small native module (for example `electron-overlay-window`, which also keeps the overlay attached to the window of the game: it needs to be built for the Electron version, which is one more thing to keep updated and one more dependency to review).
6. **Privacy**: the overlay is one more window of the app, with the same sandbox and the same rules; it can be left out of screen recordings (`setContentProtection(true)`, so friends' cameras do not appear in your stream) with a setting.

## Limits and risks, honestly

- **Exclusive fullscreen**: impossible with this approach. The person has to play in borderless mode (most games have that option).
- **Another window over the game** can stop Windows from presenting the game directly on the screen (a small cost in frame time on some machines) and some games re-assert their own "topmost" status: the overlay has to claim its level again now and then.
- **Anti-cheat**: no injection and no memory reading, so nothing in this design is what anti-cheats look for. But each one has its own rules for other windows and some do not like overlays; it cannot be promised for every game.
- **Edit mode** needs the window to take the mouse for a moment, which makes the game lose the focus: the focus must go back when it ends.
- **Windows first**: macOS needs `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` (full-screen apps are their own Spaces) and Linux with Wayland cannot promise always-on-top or click-through.

## Effort

About **1.5 to 2.5 weeks** for a first version (the overlay window, the hotkey and edit mode, the tiles, the layout per screen, the loopback with low resolution, a setting, tests). Automatic detection of the game, with a native module, is **one more week**.

## Sources

- [electron-overlay-window](https://github.com/SnosMe/electron-overlay-window): the usual library to attach an overlay to a game window (finds it by title and follows its place; Windows and Linux X11).
- Electron issues about overlays over full-screen applications: [#5994](https://github.com/electron/electron/issues/5994) and [#10078](https://github.com/electron/electron/issues/10078).
- [Daily: a video call overlay with Electron](https://www.daily.co/blog/building-a-video-call-overlay-app-with-electron-and-daily-part-1/).
- On injection and anti-cheat: a [Discord support thread](https://support.discord.com/hc/da/community/posts/360049720374-CS-GO-Overlay-not-working-after-update) about an anti-cheat update that blocked the DLL of the overlay, the warning of [HydraHook](https://github.com/nefarius/HydraHook) (a DirectX hooking framework) that hooks and injected DLLs can be detected and lead to bans, and [a Blizzard forum thread](https://us.forums.blizzard.com/en/overwatch/t/integrity-question-will-this-overlay-get-players-banned/670648) where nobody can confirm a general whitelist.
- On exclusive and borderless fullscreen: [winit issue 717](https://github.com/rust-windowing/winit/issues/717) (in exclusive fullscreen the window takes over drawing to the monitor and no other window can draw on it).
