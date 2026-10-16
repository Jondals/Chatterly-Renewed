# Changelog

Spanish version: [CHANGELOG.es.md](CHANGELOG.es.md) (translated from this file; this one is updated first).

## 2.34.1

- **A section just for calls.** Settings > Calls gathers what is about calls: the call ringtone and the opening of the soundboard (before in Sounds & notifications; its volume is in the soundboard itself), what the menu of sharing the screen starts with (quality and sound) and, on Android, calls in the background and over the lock screen (before in Appearance). Devices, microphone and camera stay in Voice & video.
- **Screen-sharing quality as you like it.** You choose the size and the pictures per second: 720p, 1080p and, on a computer, 2K, each at 30 or 60 (in Settings > Calls and in the sharing menu). What you had chosen still works. On Android the 60 qualities send up to 60 pictures per second; only one picture is in flight, so a slower phone sends fewer instead of stuttering.
- **Simpler and more complete sync.** Settings > Sync has one choice for this device (follow my account, or only this device) that covers everything: settings, stickers, presets, the sounds of your soundboard and camera backgrounds. Below it, the status, the space used and a button to sync now; the configurations are folded away.
- **The sounds you upload reach all your devices.** The sounds of the soundboard (with their name, emoji, category and cut) are kept in your account end-to-end encrypted, like the stickers; deleting one on a device deletes it on the others.
- **GIFs that always load, faster.** More GIFs are asked for at once, a failed one is asked again by itself (and pressing its thumbnail retries), and the server sends WebP previews (a third of the weight) and no longer rejects the thumbnails of a page when you scroll fast (needs the new backend).
- **Phone: the actions of a message appear when you hold it.** A tap on a message no longer opens its bar of actions: it shows when you hold the message (with a short vibration), and goes away when you tap elsewhere.

## 2.34.0

- **A new game overlay, like the one of Discord.** Your call over your game in widgets you place where you want: the call controls (mute, deafen, camera, screen, hang up, how long and the ping), the people of the voice channel (who talks, who is muted, who is LIVE), the cameras (yours too, now on by default), the activity (the registered game that is open and for how long), the screens they share (with their volume) and the messages you get. The shortcut (Ctrl+Shift+O) unlocks it: the screen dims, every widget shows its title and a pin (a pinned widget stays while you play), they are dragged one by one and the buttons work; a click outside, Esc, the cross or going back to Chatterly give the mouse back to the game. It never keeps the clicks of the game: the "let the mouse through" style of the window is set again after it is shown or resized. Checked in the real desktop app with a camera.
- **Desktop: sharing a window.** The windows of Chatterly that are not for sharing (the transparent overlay showed as a black "Chatterly") are left out, and a Refresh button reads the list again: Windows does not offer a minimized window (it cannot be captured), so restore it and press Refresh.
- **Desktop: Direct3D 12.** Settings > Voice & video > graphics layer offers Direct3D 12 (ANGLE's D3D11-on-12 layer) next to Direct3D 11, OpenGL and Vulkan.
- **macOS app.** One universal app (Intel and Apple Silicon), Chatterly-<version>.dmg, built and published with the others. It is not signed by Apple (that needs a paid account): the first time, allow it in System Settings > Privacy & Security. It updates from inside the app: it checks the signed manifest like the others, downloads the disk image, checks its SHA-512 and opens it to drag Chatterly to Applications.
- **Releases in order, all at once.** A release is published only when every platform built well, and its files go up in this order: Windows (.exe), Linux (.AppImage), macOS (.dmg), Android (.apk), then the update files.
- **Your stickers and presets are no longer lost.** When the session ended by itself (an update that restarted the app in the middle of renewing it, a session closed elsewhere) the app erased everything on the device, sticker packs and presets included. Now only the session and the keys go; what you made stays for your next sign in, and if ANOTHER account signs in on the device everything is erased first. Signing out keeps them too in the apps (Settings > Sync > Keep them on this device when I sign out; off in a browser). And they are now also kept in your account, end-to-end encrypted like your library (Settings > Sync > Stickers and presets > Keep a copy in my account, on by default): they reach every device you sign in on and come back if one loses them.
- **The update channel stays where you put it.** A failed request to the server (no connection, a renewal of the session in the middle) counted as "not a tester any more" and switched the desktop app back to Release by itself. The Android channel no longer follows the synced settings of another device, and the start check of Android waits until the server says whether you are a tester.
- **Administration, renewed.** Five tabs: Overview (accounts, people online, calls, messages, the disk, the version and uptime of the server), People (search, roles, sessions; suspend and restore an account, sign it out everywhere, make it a tester or an administrator), Beta program, Server (open or close the sign-up, and an announcement every person sees on top of the app at once) and Record (who did what, and when). A suspended account cannot sign in and loses its sessions at once (it is told why); nobody acts on themselves or on an owner; only an owner makes administrators or acts on another one. The server only shows what it already knows in clear: names, dates and totals, never a message, a file or a key.
- **Right click on a stream.** The tile of a screen someone shares opens its own menu with its volume (and mute), without having to find the person.
- **Every window covers the whole app.** A window opened from the call (the lock of the call, for example) only darkened the call: it now covers the whole app.
- **Calls.** The lock of the call is a plain button like the others of the bar. The delay chip ("42 ms") sits in the same row as the muted and deafened marks and never covers them. The microphone and speaker lists can no longer be open at the same time. The call data panel has the same glass as the rest of the call (it was nearly black).
- **The camera window, tidier.** The preview with what is on now and the quick switches (mirror, no background, reset) under it, and the options in three tabs (Background, Your library, Image) instead of three long folds.
- **Android: sharing the screen at up to 30 pictures per second.** The pictures and the sound reach the page over a binary channel of the WebView instead of base64 text through the bridge, which capped the sharing at about 15 pictures per second whatever the quality and made the whole phone stutter. If the sound of the app on screen only comes as silence (an app can forbid capturing its sound) you are told.
- **Android: swiping the app away no longer takes you out of the call.** Like in Discord, the call goes on (with its notification); opening the app again takes the call over without leaving it.
- **Android: a nicer call notification.** Smaller buttons when folded, and open it is bigger: who, how long, and wide buttons with their names (Mute, Deafen, Hang up).
- **Android: no text selection in the chat.** A finger no longer starts selecting the text of a message: a long press opens its menu, and Copy is there.

- **Game overlay: you can see it, and edit it like in Discord.** "Hide it from recordings and shared screens" is off by default (and turned off once for everybody): on some computers Windows hid the overlay from the screen too, so the window took the clicks and showed nothing. The shortcut (Ctrl+Shift+O by default) now dims the screen and shows a bar on top to change the size, show only who talks or the names, while the panel is dragged and resized; the shortcut again, Esc or Done give the game back.
- **Android: sharing the screen follows the phone.** Turning the phone to landscape no longer squeezes the picture into a portrait frame (it looked tiny): the shared screen turns with it. The sound of the phone can be shared too (Android 10+; the sound of Chatterly, the voices of the call, is left out), and the screen button opens the same menu as on the computer (quality and sound) before Android asks what to share.
- **Android: copy and paste.** A long press in a text box shows the menu of the phone (Paste, Select all...), and so does a long press on text you selected (Copy, Share...), instead of nothing.
- **The volume of a stream on the phone.** A long press on a person of a call also has the volume of the screen they share (when it has sound), apart from their voice.
- **Sounds in the chat from the "+" menu.** Sending your sounds is now in the "+" of the chat (Sounds): one press sends a sound, and with a category chosen you can send the whole category as a pack. The soundboard no longer has those buttons.
- **The sound editor matches the app.** Its sliders, the wave and the emoji choices use the colors of the app (the sliders had the look of the browser).
- **Any number of emoji without a bubble.** A message of only emoji never gets a bubble, however many there are.
- **Settings sync at once.** A change is saved a moment after it is made (and at once when the page is hidden or closed), and the other devices of the account load it at once: the server tells them, and a device that comes back to the front also looks for a newer copy. Before, a change was saved every 4 seconds and the other devices only saw it after signing in again.
- **Lighter chat.** A message builds its bar of buttons only while it is under the pointer, tapped or focused (a long chat kept about 25 hidden elements in every message), and the Spinly cards of the history no longer listen to every key press.
- **Android: emoji are visible again.** The Android web view loaded the emoji font of the web but drew every emoji empty (in the chat, the picker and the soundboard). The Android app no longer carries that font and uses the one of Android, which is the same Noto design; the APK is about 4.5 MB smaller.
- **Emoji on the phone.** Choosing an emoji no longer opens the keyboard (it opens when you tap the box) and the picker stays open, so the same emoji can be pressed several times: the "Frequently used" list no longer moves under the finger while the picker is open. A message of only emoji also recognises the flags of Scotland, England and Wales and ignores the invisible marks some keyboards add, so it shows without a bubble.
- **Android: a clearer call notification.** Its own design with mute, deafen and hang up buttons of small corners and colors for a light or a dark phone (the buttons Android draws by itself looked white on a dark phone); the mute and deafen buttons turn red when on. The "Connected" notification is gone by default: Settings > Appearance > Performance > Calls in the background turns it on for whoever wants calls to ring with the app minimized.
- **Android: speaker or phone from the headphones button.** The arrow next to the headphones button of a call chooses Phone, Speaker, Headphones or Bluetooth; the separate button is gone.
- **Settings.** Performance (power mode) only shows in the Android app. The intro option is one line, "Intro when Chatterly opens", with a button to watch it.
- **Stickers cannot be saved.** Save is no longer offered for a sticker, and the save menu of the browser or of a long press does not appear on them.
- **Game overlay on by default.** It appears in every call without turning it on first; alone in a call you see yourself (before, with nobody else, it had nothing to draw and did not appear). The shortcut (Ctrl+Shift+O by default) moves the panel, and opens the overlay if it was waiting for a registered game.
- **The server cannot be used to flood people.** "Typing" is passed on at most once every 2 seconds per device and chat, and the same status sent again is not sent to every friend again.
- **Desktop: the beta channel no longer gets stuck.** The app asked the server for a new beta access token every time the update screen changed, dozens in a few seconds, until the server refused them; after switching Release and Beta the app was left without access and only said "The update could not be downloaded". Now the token is asked for only when the channel or the account changes (and again a while later if the server did not answer), a look or download waits for it instead of failing, and the real reason of a failure is shown under the message.
- **Android: clearer update messages.** On the Beta channel the app says when no Android beta has been published yet, or when the newest beta is older than the installed version (Android only installs it after uninstalling), instead of "up to date".
- **Android: change to an older version.** Going back from a beta to the release (or to a beta older than the installed release) cannot be done over the installed app: Android never installs a lower version. Settings > Updates now offers **Change to v…**: the app downloads that version with the same checks (Chatterly, signed by the same author), keeps it in the Downloads folder, opens the uninstaller of Android, and you install the file from Downloads and sign in again (what the app keeps on the phone is erased). Every failure of an update now says what happened (no connection, version not published, another signature, no space...) instead of only "it could not be done".
- **Fewer files in a release.** A release carries the Windows installer, the Linux AppImage and the Android APK (uploaded in that order) plus the update files of the desktop apps; the separate `.apk.sha256` (Android checks the signature of the APK itself) and the separate `.yml.sig` (the signature is inside every `.yml` since 2.33.0) are gone. A desktop app of 2.32.0 or before therefore no longer updates by itself: install the new version by hand once.

- **Moving a call from the phone to the computer (and back).** A person is in a call from one device only: joining from another moves the call there and the first one leaves by itself with a notice, instead of both being in and the call breaking. The server sends the signals of a call only to the device that is in it, and answering on one device stops the ringing on the others.
- **Smoother calls.** The camera has a bitrate ceiling by quality and a regulator that lowers it as soon as the line fills up (the ping that grew until the call broke was the queue of the TCP relay) and raises it slowly when it clears; the picture gets smaller before it stutters. Voice levels no longer redraw the whole call screen 12 times a second.
- **Less lag when clicking.** Messages, drop-down lists, folding sections and menus no longer listen to every click of the page while closed (hundreds per click in a long chat or in Settings). Decrypted files kept in memory have a limit.
- **Power mode (Settings > Appearance > Performance).** Automatic (everything on; it saves only with low battery or on a device that cannot keep up), Maximum and Saver (still decorations, no blur, camera at 480p and 15 fps). Phones no longer start in light mode: they get every animation, aura and profile effect like the computer (whoever had "quick" animations for being a phone goes back to "full" once).
- **The same emoji everywhere.** The emoji font loads on phones too, so emoji look and animate like on the web and the desktop (and the eye in a speech bubble is no longer split in two). A message that is only emoji (up to 80, spaces allowed) shows without a bubble and bigger, and wraps without leaving the screen.
- **Verify a contact once.** Verification travels sealed with your account: a contact verified on the phone is verified on the computer. A new device also pins the verified key, so it catches a key change even for a contact it never saw. The verification window no longer overflows on phones.
- **Download GIFs and files.** Right click (or long press on a phone) on a message: Save GIF, Save image or Download. On Android they go to the Downloads folder.
- **Profile from the chat header.** The picture and the name at the top of a chat open the profile.
- **Introduction.** It can be turned off at start (Settings > Appearance), it is drawn with fewer pixels on touch screens and on Android it plays its sound from the start.
- **Game overlay fixed.** It did not appear until Settings had been opened in that session: the part of the page that tells it who is in the call was only made there. It now starts with the app (checked with a real call in the desktop app).
- **Android: calls like phone calls.** A call that rings with the app minimized or the screen off shows as a call notification with Answer and Decline (full screen over the lock screen if you allow it) and the ringtone of the phone; the app stays connected in the background with a quiet notification (it can be turned off in Performance). With the app fully closed (swiped away) a call cannot ring: that needs push notifications. The call in progress is in the notifications of the phone with the name, the time and Mute, Deafen and Hang up (the floating call panel no longer shows on Android), and a new call button chooses Phone, Speaker, Headphones or Bluetooth.
- **Android: back key and screenshots.** Back closes what is open (a menu, a window, a section of Settings back to the list) before leaving. Screenshots are allowed only in the chat or the call with verified contacts; recent apps never show the app.
- **Android: one-word option buttons** of equal width in Settings (pop-up notices, power mode, privacy, background shuffle).
- **Android: a frozen WebView recovers.** A renderer stuck for about 10 seconds is ended and the screen opens again instead of staying frozen; if it crashes, the screen reopens instead of the app closing.
- **Android: more privacy.** The WebView no longer asks Safe Browsing or sends metrics to Google, and it has no `file://`, location or script-opened windows.

## 2.33.0

- **Betas without GitHub.** The beta versions are no longer published in GitHub: they are served by the Chatterly server only to the accounts an administrator made testers (a token of two hours per account, checked again on every download). They are numbered 1, 2, 3 for each version, and the server keeps only the newest and the app deletes the installer it downloaded after updating.
- **Signed updates.** Every update manifest carries an Ed25519 signature that the app verifies before downloading anything (one file per platform: the signature is the last line of `latest.yml`). The installed app can only connect to its own server, and the signing and publishing run in a job apart from the builds.
- **Camera background.** The cutout of the person is much better (the model sees only the part of the picture where you are, and the edge follows the real edge of the picture), the blurred background no longer carries a dark halo, the **Soft edge** slider really changes the edge, and the effect lightens itself when the computer cannot keep up or the screen is being shared.
- **Screen sharing.** The video is sent for movement or for reading depending on the quality chosen, with a ceiling on the bitrate. The list of windows no longer shows the overlay of the graphics card.
- **Overlay and messages.** The game overlay no longer appears in Alt+Tab and never keeps the focus. A message counts as read only when the window is in front; until then the sender sees the green dot.
- **Android app (first part).** The base of the Android app is in `mobile/` (Capacitor 8): the web app goes inside the APK, every call must use the relay over TLS (`turns:`) whatever the server answers, the page may only talk to the exact address of the server and shows no third-party frames, only the app itself may use the microphone and the camera, nothing goes to backups or to a new phone, screenshots are blocked and there is nothing of Google in it. The signed APK (`Chatterly-<v>.apk`, with its SHA-256) is attached to every stable release next to the Windows and Linux apps; how to check it is in DOCS.md.
- **Android app: updates and betas.** Settings > Updates is in the Android app too: it looks for a new version (the server tells which one, so GitHub is not asked until you download), downloads it and opens the installer of Android, which you confirm. Before that the app checks that the file is Chatterly, newer and signed by the same author. Beta testers can choose the Beta channel, and the betas now include the Android app. The game overlay stays desktop only.
- **Desktop: version 2.32.0 can update again.** The apps up to 2.32.0 only read the signature of an update from a separate file, and a stale one left on the server made them refuse every beta ("The update could not be downloaded"). That file is now published again next to every manifest.
- **Android app: made for the phone.** The logo of the app is the one of the web and the desktop app (icon and start screen). Nothing is drawn under the status bar or the navigation bar any more (the chat box was hidden behind the buttons of the phone until the keyboard opened), the text is a step smaller and no longer grows with the font scale of the system, and the settings switch between the list and a section with a short fade. Sharing the screen is not possible in the Android web view: its button now says so instead of doing nothing. These changes only apply to the Android app.
- **Android app: calls keep going with the screen off.** While a call is on, the Android app runs a foreground service for the microphone with a generic notification ("Call in progress", never a name), and it stops when the call ends. When the app comes back to the front, the relay credentials and dropped connections are renewed at once. The layout also respects the bars of the system on every Android version.
- **A server can no longer ask for a weak password key.** The number of rounds used to stretch the password comes from the server; the app already refused fewer than allowed when signing in, and now also when changing the password or erasing the account, and the floor is 600 000 rounds (the cost every account already uses).
- **A call is only shown as encrypted with proof.** The lock of a call needs frames of yours that went through the end-to-end encryption and frames of the other person that authenticate; if after 12 seconds there is no such proof (a browser whose encryption does not work, keys that were never agreed), the connection is closed and you are told why, instead of going on protected only by DTLS-SRTP.
- **Signing out erases the account from the device.** Before, signing out only removed the session and the keys; now it removes everything the app keeps on the device (stickers, sounds, fonts, wallpaper, presets, the encrypted library, the pinned keys of contacts and the preferences), like erasing the account, and loads the page again so nothing stays in memory. Signing in again works as on a new device.
- **A lost answer no longer signs you out everywhere.** If the answer of a session renewal got lost (no network, the app closed by the phone), trying again looked like a stolen token and closed every session of the account. Now the app keeps a one-time key for each renewal and, for 10 minutes, the same request gets the same answer; a copy of the token is still caught at once.
- **Android app: settings fixed.** The section of keyboard shortcuts is gone from the Android app, the thin lines between the groups of the settings list are back, the options of the pop-up notices and the sound pickers no longer touch each other or get squeezed by a long name (Typewriter), and the button to save a preset just says Save. **About** now lists the technologies of the platform you are on (Electron on the desktop app, Capacitor and Android on the Android app).
- **Android app: share the screen.** The button now works. The Android web view cannot capture the screen, so the app does it itself (a foreground service of type media projection, started only after you accept the dialog of Android, every time) and sends pictures to the page, which turns them into the video of the call. The quality of the menu sets the size and the pace (up to 1280 px and 15 pictures per second). Only the rest of the phone is shown: the window of Chatterly is blocked from capture. The sound of the phone is not shared. The small previews of the backgrounds in Settings > Appearance move again on phones (the light mode had paused them).
- **Smooth switch between sign in and register.** The form slides in from its side and fades in, on every platform (it applies to the web, the desktop and the Android app).

## 2.32.0

- **Game overlay (desktop app).** The cameras and pictures of the people in your call, with their names and a ring while they talk, are drawn **over the game you are playing**, like the overlay of Discord. A new section, **Settings > Game overlay**, turns it on and has the shortcut to grab the panel and move or resize it with the mouse (Ctrl+Shift+O by default; Esc gives the mouse back to the game), the screen it covers, the size of each person, the transparency, names on or off, only the people who are talking, showing yourself, and **hiding it from recordings and shared screens**. It is one more window of the app (transparent, always on top, it never takes the focus and the mouse goes through it), so it does not touch the game and there is nothing for an anti-cheat to flag. It works over games in window or borderless mode; a game in exclusive full screen owns the monitor and nothing can be drawn over it. The video reaches the overlay through a connection that never leaves the computer.
- **Animated names no longer freeze half way.** Switching to another window or tab (or a name going off the screen) could leave the letters of an animated name stopped in the middle of a jump or a flicker, some lit and some not. Now they always go back to rest, and start again when the window is back or the pointer comes over the name. It applies to every platform, because it is the same page.
- **Share a screen or a window from a menu inside the app.** The window to choose what to share could open empty and black; now the menu is part of the app (the screens and the windows with their pictures, two tabs and the box for the sound), with no separate window.
- **The overlay can be tied to your games.** In Settings > Game overlay you choose to show it in every call or only while one of your **registered games** is open (you add them from the open windows or by typing part of the name of the window), and when it appears a small notice says which keys open it.
- **Beta program.** There is a new branch, **beta**: what is pushed to it is built as a pre-release (`v2.32.0-beta.N`) and only reaches the apps of the **beta testers**. The administrator (the usernames in `ADMIN_USERS` of the server) has a new section, **Settings > Administration**, to add and remove testers by username, and to make other people administrators from the app (the owners named in `ADMIN_USERS` stay fixed). A tester sees the selector **Update channel** (Release or Beta) in Settings > Updates; the app of someone who is no longer a tester goes back to Release by itself. The releases are named like `v2.32.0` and the betas `v2.32.0-b1`, `-b2`... The stable release is still the one from master and it replaces every beta.
- **A version for Linux.** The apps are now built for **Windows and Linux** (an AppImage) on every push, and both are attached to the same release. The AppImage updates itself like the Windows app.
- **Everything about the apps in one workflow.** The steps both builds share live in one place, the release notes know about betas and Linux, and the old systemd, update-script and non-Docker Caddy files of `deploy/` are gone (the server runs with Docker).
- **One document instead of many.** The ARCHITECTURE, DEPLOY, desktop README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.es and sounds README files, and the overlay experiment, are now **DOCS.md** (in Spanish): the app, the design decisions, the apps, the server and the tests, in one place.
- **Cleaning.** Removed the Tenor integration (its API is closed), the unused functions, exports, styles, animations and translations that nothing used, the unused `@angular/forms` package and the files of the old way of running without Docker.

## 2.31.3

- **Desktop app: the introduction sounds at once.** The sound of the introduction needed a click first. The app opens before its sounds are loaded and the audio was dropped when it was not ready; now the introduction fetches its sound right away and starts it as soon as it is ready, with no click.

## 2.31.2

- **Desktop app: the menu to share the screen opens on a normal click.** What to share (a screen or a window), the quality and the sound were only on the right click, so nobody found them; now pressing the button of the screen opens that menu (in a browser it still starts at once, because the browser asks).
- **Ringtones renamed.** The ringtone that was called "Classic" is now **Chatterly Renewed** (the default one), and the one called "The old one" (the ringtone of the first Chatterly) is now **Classic**. Only the names change: whoever had one chosen keeps the same sound.

## 2.31.1

- **Desktop app: sharing a screen opens no window.** What you choose in the menu of the call decides it: **a screen** (the one the app is on) is shared **at once**, and only **a window** (or "anything") opens a picker, with just the windows when you chose a window.
- **A rounded icon.** The logo of the app (the icon of the desktop, the taskbar and the installed app) has rounded corners, like the logo of the page, instead of a black square.
- **The animation of a name repeats the same way every time.** The first time the pointer went over a name its letters moved one after another, but from the second time they all moved together (the wave of each animation was lost). Now the letters start again, with their own delays, every time.

## 2.31.0

- **Camera: move it when zoomed, soft edge and one more background.** In the window of the camera, once the zoom is above 100% you can **drag the preview** to move where the camera looks (it is sent to the others as you see it; **Reset** puts it back). A new **Soft edge** slider (Background section) sets how soft the line between you and the background is. A new ready-made background, **Candy**.
- **Desktop app: share a screen or a window, with the sound, and a volume for each stream.** Sharing the screen now always asks, in a picker with two tabs (**Entire screen** and **A window**) and a box to **share the sound of the computer** (it no longer shares a lone screen without asking, and the menu of the call offers the sound switch in the app too). The sound leaves out the voices of the call (`restrictOwnAudio`), so nobody hears themselves back. The sound of a shared screen is no longer mixed with the voice of the person: it has its own chain, and everybody who watches has a **volume slider on the stream** (0 to 200%, remembered per person), and it follows when you deafen yourself.
- **Message marks everywhere.** The dot under your messages (empty ring: sent; green: arrived but not read; blue: read) was only drawn on the first message of a run; now every message of yours has it, the green one glows a little, and its tooltip says "Delivered, not read yet".

## 2.30.0

- **The camera, rebuilt (no more lag).** The effects of the camera (background, mirror and the new adjustments) are now made **in a worker, off the main thread, drawing on the graphics card (WebGL 2)**, so the mouse, the chat and the animations never wait for them; where the browser cannot, the old way with a canvas is used. The **blur** is one choice with a **strength slider**, drawn on the card. The window of the camera has a **live preview** of how the others see you, folded sections in the style of the app (Background, Your library, Image), a **Custom** background in the place of "Studio" (your own color or gradient, with the gradient editor), and a round mark for the choice in use. **More options:** brightness, contrast, color and zoom. **The mirror now reaches everybody:** the others see you mirrored, in real time, and your own tile shows exactly what is sent.
- **Graphics (desktop app).** Settings > Voice & video has a new card: **hardware acceleration** on or off and the **graphics layer** (Automatic, Direct3D 11, OpenGL or Vulkan on Windows; Metal or OpenGL on a Mac). It applies when the app starts again (there is a button to restart). Only values of a fixed list are ever used.
- **Notification volume.** A new slider in Settings > Sounds: the ping of a message, the tones of people joining and leaving and the ring of a call have their own volume.
- **The voice mode of the call, tidier.** In the drawer of the call the four modes are a list with a round mark, and only the chosen one shows its explanation.
- **A preset you already have cannot be imported twice.** The card of the chat says "You already have it" (and the library refuses it too), even if it has another name.
- **A new font for names.** "Display" is now Righteous (before it was almost the same as the default one).
- **More fixes.** Colors and gradients are written short and readable: `[c=red]` or `[c=rojo]`, `[c=f06]`, `[d=red,blue]`, `[d=f06,0cf]` (the old long tags are still read). **Ctrl+B, Ctrl+I and Ctrl+Shift+X** make bold, italic and strikethrough. In the gradient editor the + and - are always there: when one does not apply it is dimmed and cannot be pressed. An audio now has the wave level with its buttons and a square play button. **Only one menu of the message box is open at a time** (text style, emoji or +). The animation of a name plays everywhere the name is shown (up to 30 at once, only while on the screen) and its letters are only made when they are needed. The window to change the picture or banner opens at once (its code is brought in when the pointer comes near, and pressing twice does not open two), the GIFs appear a few at a time and are only downloaded when they come near the screen. The voice screen, the group windows and Spinly are only loaded when they are needed, and the emoji list is prepared a few seconds after the app opens, not at the start.
- **Fixes after trying 2.30.0.** The color wheel has no white border now and the round color buttons grow much less on hover; the **+** is on the right and the **-** on the left; **an audio or voice note** shows where it is playing frame by frame, can be moved by pressing or dragging on its wave (and with the arrow keys), and a recording made in the browser can be moved too; **a lone emoji** only settles in when it arrives and plays its show **when you press it**; the themed cursor looks at the page once per frame (it did it for every mouse event); the library of backgrounds is only started when a camera is, and the desktop app no longer asks Chromium for extra graphics switches.
- **More fixes after trying 2.30.0.** **Name animation:** it no longer plays by itself in the chat, in the friends list, in your own panel at the bottom or in the side lists; there it only moves while the pointer is over the name (the profile preview, profile cards, calls and incoming calls keep it as before). **Ringtones:** two new ones, **The old one** (the ringtone of the first Chatterly, converted from WAV to OGG: 35 KB instead of 1.7 MB) and **Chime**, and the tiles in Settings > Sounds now all wear the accent color of the theme instead of five fixed colors. **Message marks:** the dot of a sent message is an empty ring, **delivered is now green** and **read is blue**. **Audio in the chat:** more room above the wave and a taller wave to grab. **A lone emoji** settles in when it arrives and then does its show on its own, again and again with a **rest of 5 seconds** between shows (only while it is on the screen, and never with animations off).
- **Voice notes can be moved again, and new ringtones.** A voice note recorded in the browser has no length or index inside it, so the player ignored every jump (playing or not); it is now decoded and written as plain PCM when it arrives, so dragging or tapping the wave (and the arrow keys) moves it anywhere, like in WhatsApp. **Ringtones:** new melodies for **Classic** (an electric-piano call), **Chime** (wind chimes), **Christmas** (We Wish You a Merry Christmas) and **New Year** (Auld Lang Syne), plus a new one, **Arcade** (an 8-bit chip-tune); and the tiles in Settings > Sounds have their colors back, one for each melody (the automatic one wears the color of today's).
- **One default font, the same everywhere.** The app now brings its own default font (Open Sans, a humanist sans close to Segoe UI) instead of depending on what each system or browser calls "system font", so the web and the desktop app look the same; the old default stays as **Inter** and **System** is still there, in Settings > Appearance. **Camera effects in Firefox and Safari:** they now use the same worker and graphics card as Chrome (the page sends each frame to the worker and draws what comes back), so blur, background, brightness, contrast, color and zoom all work and the page no longer stutters; an animated GIF background is read by the app itself where the browser cannot (Firefox) and keeps moving. **Group tag:** the list of icons is gone; the icon is chosen with the same emoji picker as the chat.
- **Camera backgrounds in calls (like Discord).** In a call, the arrow next to the camera has a new **Camera background** window: no effect, a slight blur or a strong blur, six ready-made backgrounds, or **a picture or GIF of your own** (a file, or a GIF found with the search of the chat). It is applied at once, even with the camera on, and the other people see it as they see any video (encrypted like the rest of the call). The person is cut out **on your device** (a small model of 250 KB and its engine are files of the app itself, never loaded from the internet, and nothing about your camera is sent anywhere to do it). The page now allows WebAssembly to run it (`wasm-unsafe-eval` in its security policy; evaluating text as code is still not allowed).
- **Your library, encrypted and in your account.** What you add for your camera is kept in a personal library that follows your account to every device. Each file is encrypted on your device with its own random key, and that key and the description (name, type, a small thumbnail) are sealed with a key that only your identity has; the server only holds three things it cannot read, and the identifier of every item is bound into the encryption, so a server that swapped the parts of two items would make them fail to open instead of showing the wrong one. Limits per person: 40 items, 12 MB each, 160 MB in all. In **Settings > Sync** there is a new card: keep the library **in your account** or **only on this device**, how much you use, move what is only on this device to your account, and **remove everything from your account**. An erased account takes its library with it.
- **Profile picture, banner and group icon: file or GIF.** Pressing to change any of them now opens a window with two tabs: **Upload a file** (choose it, or drop it there) or **GIF** (the search of the chat). A GIF keeps moving. It works the same for the picture of a new group.
- **The color wheel and the hovers.** The button of "any color" in the chat is now a real color wheel (it had a black circle in the middle), and the round color buttons, the gradient presets and the picker grow and light up slowly instead of snapping. **The system cursor no longer shows up** when you move over the colors: a button that grows on hover was taken for a scrollbar by the themed cursor.
- **Gradient colors: the + stays, the - is new.** The **+** never changes place, a **-** that removes the chosen color is at its right, and both fade in and out instead of appearing and disappearing. The buttons to turn the hue are gone.
- **Shorter tags for colors and gradients.** `[d=ff0066,00ccff]text[/d]` (gradient), `[c=ff5577]text[/c]` (color) and, by name, `[d=rainbow]`, `[d=sunset]`, `[d=ocean]`. The old tags are still read as always.
- **Desktop app: faster.** The graphics card is used for drawing and video even where the browser would play it safe, pictures go to it without a copy, and a window that is behind or minimized keeps its full speed (calls, animations).
- **Releases: only what is needed.** The release now uploads **only the installer** (and the few hundred bytes of `latest.yml` that installed apps need to find the update), not the blockmap; its notes are a short summary with a link to this changelog; it is made as a draft and published when everything is built; the build reuses downloads between runs (faster); and the actions are up to date, so the Node 20 warnings are gone. The workflow is ready to add Android, macOS and iOS to the same release.
- **Everything updated.** Angular 22, TypeScript 7 in the server (6 in the web app, the one Angular 22 supports), better-sqlite3 13, Playwright 1.64, concurrently 10, `@electron/fuses` 2, Tailwind and Prettier, the plugins of Fastify, and the Docker image on Node 24.

## 2.29.0

- **A friend's name font is now seen by everybody.** If you choose a font for your name, your friends see your name in it, even if they do not have it. The font is sent like a picture is: encrypted before it leaves your device, with its key sealed for each person who can see it, so the server only holds an unreadable blob. It is read in a sandboxed font loader, and a person can turn it off in Settings > Security (**Show the fonts of other people**). The database goes to **schema 4** (a new `name_font_image` column and the `font` kind of encrypted file) on the first start; old clients keep working.
- **Colour or gradient is one clear choice.** The plain checkbox is now a **Color | Gradient** selector in the style of the web (the same one the settings use elsewhere), and "All the colors together" is a normal switch. Nothing jumps any more: the colour swatch stays where it is (dimmed while the gradient is on) and the gradient controls unfold and fold smoothly instead of popping in. **A name that went from a gradient back to a plain colour no longer disappears** (its animated letters kept painting the gradient that was gone).
- **A custom title bar (desktop app).** The Windows bar with the name and the minimize / maximize / close buttons is now drawn by the app, in the colours of your theme, with the app name and a drag area; the three buttons are still the native ones of the system (snap layouts of Windows 11 included) and follow the theme. Without the desktop app nothing changes.
- **Spinly starters.** The Spinly composer offers ready-made starters to begin a game with one click; the menu is tidier.
- **Lighter web and app.** The old `.woff` fonts are dropped at build time (every browser and Electron read `.woff2`), which makes the web and the installer smaller.
- **Desktop app: "Update by itself" (Settings > Updates, off by default).** With it on, a new version is downloaded as soon as it is found and installed silently when you close the app. It never restarts the app on its own, so a call is never cut, and "Restart and update" is still there if you want it sooner. The page can only send true or false for it (anything else is refused), and the tests cover the download without pressing anything and that nothing restarts.
- **Shared presets: the three buttons now match.** "Try", "Import" and "Import and use" (in the card of a chat and in the profile preview) used a dark button, a solid block of the accent colour and another dark one. They are now an outline, a tinted button and a deeper tinted one with a soft glow, all of the same weight.
- **Quieter browser console.** The dev server no longer tries to pre-bundle the emoji data (`prebundle.exclude` for `emojibase-data`, which wrote three "Cannot optimize dependency" lines), and the interface sounds wait for a real press **in this page** before starting the audio context (Firefox counts it for each page load, so a reload used to write two "AudioContext was prevented" warnings). The desktop app, which always allows sound, is not affected.
- **Experiment: an in-game overlay.** `desktop/experiments/overlay/` shows that a friend's video can reach a transparent, always-on-top, click-through window over a game (30 frames per second, about 2% of one core). It works for windowed and borderless games, not for exclusive fullscreen; the report with sources, limits and effort is in its README. Nothing of it is part of the app yet.
- Reminder: **Spinly has to be deployed** (see 2.28.0) for the desktop integration.

## 2.28.0

- **Any emoji on the tag of a group.** The owner of a group is no longer limited to 16 icons: the quick list is still there, and **Any emoji** opens a panel with every emoji (search and categories). The server checks that it is exactly one emoji (a flag, a keycap, a family or a skin tone count as one) and refuses text, markup or two emoji.
- **A better "Watch together" and "Listen together".** The form says which sites it accepts and lights up the one you pasted, has a **Paste** button (and a clear button), tells you **as you type** whether the link is good ("YouTube video, ready") or not, and the actions are two clear buttons, play for everybody and add to the queue.
- **A better "+" menu of the chat.** **Photo or video**, **File** and **Voice note** are tiles (the photo one opens the picture chooser directly), with a line that says they are encrypted before leaving the device and that you can also paste or drop them; Spinly and Share a preset stay below.
- **The lone emoji, redone.** It was always the same hop and, when a chat opened, all of them turned at once. Now an emoji that has just arrived makes **one of eight entrances** (from the sides, a zoom, a flip, a jelly, a drop, a spin...) and then a short show of **its own kind**: there are about forty (a heart beats and throws hearts, a party popper throws confetti, a rocket takes off, an animal hops, a car drives off, the sun turns, flowers sway, a gift shakes and opens, music dances with notes, the eyes look around...) and the rest get one of four general movements chosen per message, so the same emoji does not always move the same way. The show runs a few times and **stops**: nothing loops for ever. The emoji that were already there when you open the chat only settle in softly, and pressing one plays its show again. A weak machine (light mode) gets the entrance only, and reduced motion gets none.
- **Desktop app: it opens maximized** the first time and stays that way until you restore the window; then it opens as you left it (the size and place are remembered, and a window that was left on a screen that is gone is brought back).
- **Desktop app: the intro and every sound play at once**, with no need to click first (it is an app, not a web page).
- **Desktop app: sharing the screen uses the menu of the call.** What you choose in it (a screen or a window) decides what the picker offers; with one screen and "a screen" chosen it is shared **at once**, with no second step. The picker follows the language of the system, "a tab" (a browser idea) and "share the sound" (which would echo the call) are not offered, and the **Paste** button of the link forms can read the clipboard.
- **Desktop app: Spinly works again.** Spinly refused to be shown inside the app for two reasons: its page allowed only web addresses to frame it (`frame-ancestors`), and its bridge only accepted web addresses as the origin of Chatterly. The app now announces itself as `app://chatterly` and the Spinly project accepts exactly that (in `vercel.json` and in `chatterly-bridge.ts`). **Spinly has to be deployed again** (push that project) for it to take effect; the test shows that a page that allows `app://chatterly` is framed and its messages arrive, and one that does not stays blocked.
- **Settings > Updates, tidier:** how often to look is a drop-down of the app's own style instead of six buttons next to each other, and the About page no longer has a "Check for updates" button (it lives in Settings > Updates).
- Tests: the desktop test (about 310 checks) covers the window state, the sounds, what the share menu chooses, and a Spinly-like frame under `app://chatterly`; `pnpm test` covers the any-emoji tag, the new forms and menus, and that a lone emoji makes its entrance, stops, and only settles when the chat is opened again.

## 2.27.0

- **The desktop app moves from Electron 39 to Electron 44, the newest supported version.** Electron ships its own Chromium, and 39 was out of support and had six known high-severity advisories (sandbox rules not inherited by pop-ups and windows opened from a sandboxed page, protocol handlers that allowed cross-origin reads, `webview` enabling Node in workers, and others). Only the build tools' dependency `sprintf-js` (moderate, no fix yet) remains in the audit; it is not part of the app.
- **An installed desktop app refuses to start with switches that weaken it:** a debugging port, no certificate checks, no same-origin policy, no sandbox, another proxy or host rules. The tests check each one. `CHATTERLY_TRACE` writes only a plain text file at an absolute path.
- **The desktop release pipeline is fixed and hardened.** Version 2.26.0 never got its installer: the build tried to publish and GitHub answered "Published releases must have a valid tag". Now the workflow creates the release itself (and its tag, on that commit) with the CHANGELOG section as its notes, builds **without any token** (only the last step, the GitHub CLI, has one), finishes a release that was left without `latest.yml`, and every action (also the SSH deploy one, which receives the server key) is pinned to its exact commit. The installer is named `Chatterly-Setup-<version>.exe`, the name `latest.yml` uses. **Installed 2.25 apps will update straight to 2.27.0** (2.26.0 has no desktop release; 2.27.0 has everything it had).
- **The desktop tests run out of sight:** their windows open far off screen, outside the taskbar and without taking the focus, so they no longer get in the way while you work (`CHATTERLY_TEST_QUIET`, ignored by an installed app).
- Docs: a Security section in `desktop/README.md` (what protects the app, the Electron policy and the risk that is still open: whoever can publish a release can publish an update until the installer is signed) and a line in `SECURITY.md`.
- Tests: the desktop test (about 270 checks) now also checks the refused switches in the installed build and that it starts from its asar.

## 2.26.0

- **Settings > Updates (desktop app only).** The state of the update with its buttons (check, download, restart and update), when it last looked, **how often it looks** (every hour, 6 hours, 12 hours, every day, only when the app starts, or only when you ask) and **whether it tells you** about new versions. With notices off the bell shows nothing about the update, and you can still update from Settings. The choices are kept in the profile folder, and the app only accepts the fixed list of values (anything else sent by the page is refused). Nothing is ever downloaded or installed without you pressing a button.
- **A better update card in the bell:** the size of the download, the amount downloaded next to the progress bar, **Later** (hides it for that version) and a link to the update settings.
- **The desktop app starts lighter.** The scripts of the app are compiled once and cached (V8 code cache for `app://chatterly`), the first page is prepared once, the update code loads 5 seconds after the window opens instead of competing with it, and Windows' window-occlusion detection is off so a call in a window behind another one is not slowed down. `CHATTERLY_TRACE=<file>` writes the start-up timings to measure it (see `desktop/README.md`). The start was already fast on the development machine (window ready in about 0.27 s, first paint in about 0.35 s, no long tasks, 180 frames per second); if it still stutters on yours, send that file.
- **The desktop build on GitHub works again:** the workflow installs the browser that the web build uses to draw the sign-in screen (it failed in version 2.25.0 with "Executable doesn't exist").
- Tests: the desktop test (about 260 checks) covers the choices (defaults, valid values, refused values, kept after restarting, "only when I ask" not checking at start, a damaged file), and `pnpm test` drives the real Settings > Updates, the notices on and off, "Later" and a second start.

## 2.25.0

- **The desktop app updates from inside the app, and only when you say so.** It looks for a new version at start and every 6 hours and only tells you: a notice "A new version is available" and a card in the notifications of the Home bell. You press **Download** (a progress bar shows it), and when it is ready **Restart and update**; Chatterly closes, installs silently and opens again. Nothing is downloaded, installed or restarted behind your back, and nothing is installed just because the app closes. _Settings > About_ has a **Check for updates** button. A download whose hash does not match is refused and the card says so. The page talks to the app through four fixed commands and one event (`desktop/src/preload.cjs`), usable only by the main page of the app and never by an embedded frame. The Microsoft Store version is updated by the Store and shows no card.
- **Closing the desktop window closes the app.** It no longer stays running in the background: the tray icon is gone.
- **One release for the whole project.** You raise the version, commit and push: the server updates (`deploy.yml`) and `desktop.yml` publishes the Windows installer as the release `v<version>` by itself (nothing is built if that version already has a release). No tags to create by hand.
- The desktop profile now lives in `%APPDATA%\Chatterly` (`Chatterly-dev` when run from the source) instead of under the package name.
- `CONTRIBUTING` (English and Spanish, linked to each other) now covers the desktop app and how to release.
- Tests: the desktop test (about 230 checks) covers the new update flow, the list of channels the page may use and that closing the window ends the process, and `pnpm test` drives the real UI: the notice in the bell, the download and the restart.

## 2.24.0

- **Desktop app for Windows (new, `desktop/`).** The same encrypted web app in an Electron window that carries the web build inside it (served as `app://chatterly`), so the code that handles your keys is the one in the installer, not whatever a server sends on each start. Camera, microphone, notifications and screen capture go to the app itself and never to an embedded frame; links open in your browser; the page cannot reach Node (sandbox, context isolation, fuses, asar integrity); screen sharing has its own picker (without system audio, which would echo the call); closing the window keeps a call alive in the tray; with no server it shows an offline page and retries. The installed app looks for updates at start and every 6 hours and installs them by itself, with no questions (at once if it arrives right after starting, otherwise when it closes or when the window has been hidden and silent for 10 minutes; a call is never cut), reading the GitHub Releases (`desktop.yml` builds them when a `v*` tag is pushed), the Microsoft Store package comes from `pnpm --dir desktop dist:store`, and the installer is not signed yet (Windows shows its SmartScreen warning; the Store route signs it). `docker-compose.yml` now lets the origin `app://chatterly` in (CORS and WebSocket); `deploy.yml` ignores `desktop/` and `mobile/`.
- Tests (desktop): `pnpm --dir desktop test` (about 200 checks of the shell, the `app://` server and the packaged build) also runs inside `pnpm test`, plus a new step where the desktop app signs up against the real backend from `app://chatterly`.

- **What a group is called is sealed now.** The name of the group, the name of each channel and each tag (with its color) were kept in clear on the server; they are now sealed in the browser of the owner with the key of the group (`g1.<key version>.<iv>.<data>`), bound to the group, to what the text names and to the version of the key, so the server cannot read them, and cannot give the name of one channel to another. The server refuses a name in clear and a name sealed with a key version the group does not have. A new key (somebody left) seals all the names again, so whoever comes later can read them. The names of a group made before are sealed by its owner the next time the owner opens the app (until then they show as they were). The tag of the group that people choose to show on their profile stays public, because it is shown to people outside the group. The emoji of a group (never shown, and kept in clear) is removed from the database.
- **The floating call has its camera at full width:** the camera or the screen of the other person fills the panel (no black bars, it covers its window), and the whole block is resized from the corner far from the edge it rests on.
- **The delay of the call is a small signal** (bars and the milliseconds, green when it is good, amber when it lags, red when it is bad) instead of plain gray text.
- **The send button is only for phones:** on a computer Enter sends.
- **The animation of a name no longer stays stuck:** when the pointer left, the name stopped when the last letter ended its turn, but the other letters were in the middle of theirs and stayed frozen in the air. Now every letter waits for the end of its own turn and rests there.
- **A profile preset no longer takes the banner picture:** only a banner color or gradient goes with a profile preset (as before, neither the profile photo nor the banner picture are touched when one is applied).
- **Going from one group to another no longer jumps.** `groups`, `groups/:guild` and `groups/:guild/:channel` were three routes, so adding the channel to the address (which the screen does by itself) destroyed the screen and built it again. They are one route now (`direct` too).
- **Phones start in light mode** (no blur behind panels, a quieter arrival: the circle that opens is a fade, the aurora stays still, the dark layer of the HTML does not sway), so the first seconds on a phone do not stutter.
- **The soundboard, redone:** a header with a mark, the categories as pills, a slim volume slider that matches the app (also used by the music and the timeline), a dashed "add a sound" tile and more room around the sounds.
- **The card of listening together:** wider, with a soft accent light, and a timeline and a volume slider that match the app.
- **The Activities menu has more room** (wider, more padding, more space between the cards; the same cards of the "+" menu of the chat).
- **Spinly starts with values:** a new wheel or tournament has three options already written ("Option 1", "Option 2", "Option 3"), so it can be sent as it is.
- **The tournament, in a new look:** a scoreboard with hairlines and small corners (no pills and no big roundness), a color stripe for each side, diamond pips and a flatter bracket.
- **Documentation:** [ARCHITECTURE.md](ARCHITECTURE.md) explains how the project is put together and why; Spanish versions of the architecture, the security policy, the contributing guide and the code of conduct.
- **The test is split by topic** (still one command, `pnpm test`): `test/run.mjs` runs `test/e2e/` (one file per step of the browser test) and `test/security.mts` runs `test/security/` (one file per topic) instead of two files of 2,000 and 2,700 lines.
- **SEO: the page you test is the page that is indexable.** `robots.txt` blocked `/direct`, `/groups` and `/voice` (so Lighthouse, run on a signed-in page, said "Page is blocked from indexing" and gave 61) and the canonical link always pointed at the home page. A crawler can open those pages now (it only ever sees the sign-in screen: everything private is behind a login; the API, the socket and the sounds stay closed) and the canonical link follows the page that is open.
- **The sounds of the interface load a little later** (1.5 s after the page is shown, 5 s on a phone, or at the first press), so fifty small files no longer compete with the first paint on a slow connection.
- **Security:** an account that writes too much in an hour (messages of the largest size, one after another) is stopped, so one account cannot fill the disk; the color of the cursor is only used when it is a hex color (it goes into the drawing of the cursor).

## 2.23.1

- **The card of listening together, redone:** a badge with the dancing bars, the title, the timeline under it, and a row with the queue on the left, a big round play and the skip in the middle and the volume on the right (rounded chips, not square buttons).
- **The timeline of listening and watching together moves by the clock** between two reports of the player (it reported a couple of times a second and looked late), and the pause button of the floating bar of the call changes at once. The floating bar no longer shows the title of what plays (it made the bar long).
- **A name with a script font was cut** by its own box (the swash of a letter reaches outside it): the animated name has room above, below and at the sides.
- **The tournament in the chat** uses the colors of the app: a card with an accent border and light, a header with the accent, neutral sides with the accent of the one who leads.
- **A profile preset does not touch the profile picture:** it does not keep it and it does not change it (the banner and the rest of the profile still go with it).
- **Typing no longer moves the composer:** the send button keeps its place (it fades in) instead of appearing and pushing the other buttons, and the emoji window stays where it is.
- **The emoji window is lighter:** its cells have no transition, and nothing reacts to the pointer while the list scrolls (fast scrolling lagged because hundreds of cells changed state under the pointer). The emoji that the browser cannot draw (a version of Emoji it does not know, as in Opera GX) are left out of the list instead of showing empty boxes (it draws one emoji of each version to know, with the same emoji font the page uses; a protected canvas that cannot be read leaves the list whole).
- **Several emoji in a message are not tiny:** up to ten emoji are drawn big (the fewer, the bigger), not only up to three.
- **The floating bar of the call** shows only the screen that somebody shares or the camera of somebody else, steady (it does not change to whoever talks); with neither it shows no window.
- **Stickers no longer make the page lag.** The animated stickers of the starter pack moved _inside_ their picture, which the browser draws again every frame (fifty of them in the picker, and every one in the chat). The picture is still now and the page moves it with a transform, which the graphics chip does by itself: in the pickers a sticker moves only under the pointer, and in a message it moves all the time (how it moves travels with the sticker). The stickers you already had are made still when they are read, and keep their movement.
- **The loops of a lone emoji went too fast with "Quick" animations:** that setting cut the duration of every animation of the bubble (also its endless loop) to a fraction of a second. The emoji and the stickers of the chat are out of it.
- **Name animations, rebuilt:** now the LETTERS move, one after another, with the principles of animation (anticipation, squash and stretch, overshoot, follow-through): Bounce, Jump, Wave, Jelly, Pop, Swing, Flip, and two lights, Glow and Neon (a blurred copy of the name behind it, of which only the opacity moves). Names with a gradient keep it, painted letter by letter. Only transform and opacity change, a name that is off the screen does not move, and when the pointer leaves the letters finish the movement they are in. (The first version animated filters of every name in the chat, which is expensive.)
- **Presets:** each one has a small picture (a tiny chat with its colors, bubbles, corners and wallpaper; a tiny profile card with its banner, picture and name), and they are at the end of their section (under About me; under the cursor).
- **Listening together:** the card has a body that folds away and comes back with the same smooth movement (it only folded smoothly before), the timeline has room, the buttons are in a row of their own under it with a round play button, and the volume is a small round popover with a short slider.
- **The minimized call** (the floating bar) is no longer as long as the title of the video: the title is cut and the bar has a maximum width.
- **Watching together:** the black bands and circle that covered YouTube's own marks for three seconds are gone; those moments (just started, moved, paused) are covered by a blur, without shapes.
- **The audio and voice-note card** is back to the quiet one-row layout (play, waveform with the times under it, and two small quiet buttons for the speed and the soundboard).
- **Bounce and Jump are different and smoother:** Bounce is a small soft ball that never stops; Jump waits, crouches, leaps high with a twist and settles, with the ease of each stretch following gravity. The name animation is not shown in the messages of the chat any more. The audio card has square buttons with rounded corners for the speed and the soundboard, and the color picker of the text of the chat is a rainbow ring (any color).
- **The name animations that looked alike are really different now:** Bounce is a quick low rubber ball; Jump is a somersault (a high leap that turns over in the air); Wave is a smooth sine above and below the line; Drift makes the letters rise like bubbles, fading in and out; Glow is a wide soft light that breathes while the letters stay as they are; Neon lights the letters white-hot with a tight halo, and the tubes flicker one by one. A test checks that every animation has a movement of its own.
- **A theme preset keeps the whole look:** also the size of the text, the animations level, the background blur and the minutes of the shuffle (the typeface and the movement of the background were already there).
- **Name animations that looked alike are different:** Wave leans the letters like a slanted wave; Drift moves them in small circles; Pop makes each letter shrink away and pop back with a rebound.
- **The queue of the videos closes with a press anywhere else** (a press that a floating tile stopped on its way did not reach it).
- **The emoji picker of the status in the profile** is drawn in the top layer of the browser, next to its button: no section is above it and no card cuts it. The cells of the emoji picker that are off the screen are not drawn, which makes changing the skin tone and the category lighter.
- **The floating bar of the call** shows the camera or the screen of anybody (also yours) whenever it is on, not only while its owner talks; the title of the video or the audio is cut to a width.
- **A right click on your own panel opens your profile, big**, and a press on the picture of a profile (the profile card, your own panel) opens the picture big (a press anywhere or Esc closes it).
- **Going back after trying or applying a theme with a wallpaper failed** ("the operation failed for reasons unrelated to the database state"): the file that IndexedDB gave for the old wallpaper stops being valid when its record is replaced, so it could not be put back. The wallpaper is copied to memory before it is replaced. The card of a preset in the chat is lower: the picture and the name above, the three buttons in one row below.
- **Presets in the chat** have three buttons: Try, Import and Import and use, for themes and for profiles. Trying a theme puts it on the app with a bar to keep it or go back to yours; trying a profile opens it in a window. "Import and use" a profile saves it on your profile at once.
- **Names:** two new animations (Drift, Twinkle); only Bounce and Jump are jumps now (Wave sways from side to side); all of them ease more smoothly; and the letters have room above and below in lists that cut names (they were clipped). An animation that stopped while the pointer was still over the name goes on.
- **Settings > Sync** speaks of _configurations_ (not "sets of settings"), with more room above the button to make a new one.
- **A picture that moves** (a GIF as the icon of a server or a profile picture) moves only under the pointer; the rest of the time it shows its first frame.
- **The lock of the call** is bigger. Glacier goes before Tangerine's Pop. The card of listening together and the floating bar of the call are as they were before.
- **Background blur goes to 100 at most** (it went to 120); a larger value kept from before is read as 100.
- **Name animations in a folded section** showed nothing (a name painted with a gradient was measured while the section was closed and had no width): the letters are measured again when they get a size.
- **Presets:** each one can have a picture the person uploads (or goes back to the default one: a drawn tiny chat or tiny profile card, never the wallpaper: it can be a heavy animation). The picture travels with the preset and shows in the message that offers it. Sharing moved to the "+" menu of the chat ("Share a preset": choose profile or theme of the app, then the preset).
- **A new theme, Glacier**, after Tangerine's Pop (which is now the second to last).
- **Hovering anything pressable is smoother** (color, border and shadow ease in and out, for every button, link, menu row and card).
- **Gradients can turn the hue** of every color together or of the chosen one only.
- **Watching together:** the bar has a round play button with room around it, subtitles on and off (off by default, whatever was chosen in YouTube) and the volume (a small round popover).
- The typefaces start to download when the Appearance settings open, so their previews are ready when the fold is. The custom color of the text of the chat is aligned with the other swatches.

## 2.23.0

- **Presets of the theme and of the profile.** A new fold (Appearance > "Theme presets", My profile > "Profile presets") saves what you have now with a name: colors, fonts, wallpaper, cursor and bubbles for the theme; colors, effect, name animation, About me, banner and picture for the profile. Each preset can be applied in one press, updated with what you have now, renamed, deleted and **shared in the chat that is open**: a friend gets a card with "Import" (and "Import and use" for a theme). The custom pieces (wallpaper, uploaded fonts, pictures) travel inside the file, as bytes (no base64), up to 11 MB. What comes from another person is checked piece by piece: only the settings that belong to a preset are read, each value must be short and without markup or styles, pictures must be pictures, and every piece has a size limit.
- **Server tags.** The owner of a group makes a tag in its settings (up to four letters or numbers, a color and an icon) and every member chooses in My profile whether to show it next to their name (messages, member list, profile card). It goes away when the person leaves the group, is removed, or the group is deleted, and it follows when the owner changes it. The server only accepts one icon of a fixed list.
- **Removing a friend erases what the two had.** The direct chat is deleted with its messages, files and reactions; the person leaves the groups you own (their messages and files there are deleted and the group key is marked to be renewed) and the keys of the pictures you shared are dropped. Declining or cancelling a request only deletes the request.
- **Watching videos together:** the timeline could not be dragged (a handler of the tile of the call that returned `false` made Angular cancel the press on the bar, so the thumb never moved); it is fixed and the test now drags the thumb with the mouse. YouTube draws its title, buttons and logo for a moment when a video starts or jumps: a blur covers the picture for three seconds after that, as it already did while paused.
- **The card of the music** minimizes to a narrow bar (it kept the width of the full card), and a test presses the button.
- **Call menu:** the options of the microphone and the camera open and close smoothly, and the voice modes wrap instead of leaving the screen. The "More options" of a gradient folds smoothly too.
- **Chat:** any color can be chosen for a text again (a picker next to the swatches). The audio and voice-note card has the buttons on a row of their own (the waveform was squeezed). Settings: the line that doubled under "Actions over a message" is gone.
- **Spinly:** the background grid no longer drifts.
- **Sync** says what it does: a header with its state, two cards for what this device does, and sets of settings explained with an example.
- **Intro animation:** lighter on a phone: the rings no longer scale a blurred shadow nine times (a baked glow, drawn once and scaled by the compositor) and, on a phone or a slow device, the 3D floor, the extra rings and the light that sweeps every letter are left out.
- **Group icons are end-to-end encrypted.** The browser of the owner encrypts the icon with a random key, the server keeps only ciphertext and gives it only to the members of the group, and the key of the icon travels with the group, sealed with the key of the group (it is sealed again, by the owner, every time the key of the group is renewed, so a member who joins later can open it). An old icon that was not encrypted is encrypted by its owner's browser the next time the app opens; one that nobody encrypts is erased after 30 days. The server no longer has any code that reads or rebuilds a picture (the picture checker is gone: it only served the icons), and the test checks that no picture on the disk is a picture.
- **Spinly:** the window of a tournament has its own summary on the left (players, duels, rounds and the list of names) instead of a wheel that had nothing to do with it, and the tabs Wheel and Tournament are above both columns. The duel of the card (chat and call) shows each side with a disc, its name and its wins, and the score between them; in the narrow card of the chat the score goes on top and the two sides below.
- **A secret call:** one call in ten thousand rings with a joke tone (`ringtones/secret.ogg`, OGG Vorbis) that cannot be chosen anywhere.
- **The identity fingerprint is one line** (the letters shrink with the box; on a narrow screen it breaks in two balanced lines).
- **Tests in Firefox:** the whole test also runs in Firefox (`CHATTERLY_BROWSER=firefox`) and passes; the check of mute and deafen was wrong (undeafening also unmutes) and only passed in Chromium by luck. `CHATTERLY_STOP_BEFORE=<text>` stops the test at a step, to work on one part.
- **Residual code removed:** unused functions, variables and styles (`sha256Hex`, the old KDF constant, the drawing of emoji of the sticker store, helpers of the profile and of Spinly, three cursor classes, the drifting grid), 178 translations of texts that no longer exist, and the dependency `autoprefixer` (Tailwind 4 does it).
- **Security:** a group icon is now given only to the members of its group (it was given to any signed-in person who knew its id), and a security check covers it. Taking a sound or a pack from the chat to the soundboard failed in a browser that follows the page policy (it read the file through a `blob:` address, which the policy does not allow); the file is now handed over directly.
- **Privacy:** the title of a YouTube or Spotify link shared in a call was asked of YouTube or Spotify by the browser of everybody who saw it (it told them their address and what they looked at); it is asked of our own server now, and those two addresses are out of the `connect-src` of the page policy.
- The starter pack of stickers has 50 (it had 24).
- **Relay (TURN):** `TURN_TTL_SEC` (300 s to 7 days, default one hour; with 86400 a call never has to renew its credentials); `deploy/turn-setup.sh --tls` (relay only over `turns:`, TCP 5349, with the certificate of Caddy; `deploy/turn-cert-sync.sh` copies it) and `--no-logs`; documented in DEPLOY.md.
- Tests: a real drag of the timeline, the minimizing of the music card, presets shared between two browsers, friend removal and server tags in the security checks.

## 2.22.0

- **Your settings live on your account.** Sign in on the phone and everything is as on the computer. They are sealed in the browser with a key that comes from your identity before they leave it: the server keeps something it cannot read. The microphone, speakers, camera and the files you uploaded stay on each device. New section "Sync": keep several sets of settings (computer, phone...) and choose which one each device follows, or keep a device on its own.
- **Name animations** (ten) in My profile: they play when the pointer is over the name or when you are in the chat, and are seen in the friends panel, direct messages and chats. Two new profile effects (comet and nebula).
- **Watching videos together:** the YouTube player is fully hidden (no title, logo or more videos); the bar of the call seeks, and a cover shows play when paused. The permissions of the frame no longer print warnings.
- **Your voice** is reworked: modes that are easy to hear and explained (microphone and camera folds in the call menu). The "hear yourself" option is gone: you hear yourself while you test the microphone.
- **Mirror camera** follows the switch in real time; mouse options are hidden on mobile; sharing the screen starts directly with a press (right click for options).
- **Audio speeds** 1.25, 1.5, 2, 3 and 5. Short messages no longer leave a wide bubble. A lone emoji is animated by mood (kiss, heart...). Stickers of the starter pack are animated.
- **Soundboard:** same-size tiles, built-in and your own categories that fold like the emojis, and what is hidden is not drawn.
- **Mobile:** the chat fills the screen, the helper text under the input is gone and the gradient menu is one line. The call has a minimized window that can be resized and shows who speaks; the music-together panel and the call can be minimized.
- **About me:** the gradient menu is compact. Faster intro animation (a worker draws it off the main thread).
- Fix: the server did not allow PUT from the browser (CORS), and "nothing saved yet" is an empty answer instead of a 404 so the console stays clean.
- Tests: Firefox switch, real YouTube seek, camera stress, settings sync, name animations.

## 2.21.1

- **The camera works when it is turned on while the other person has theirs on, and when it is turned off and on again.** The test of the app now reproduces what happened (a camera that was turned on while the other one was already on never reached the other person) and passes with the fix of 2.21.0: a camera or a screen goes through a new transceiver each time. The test turns the camera off and on four times at different speeds, then both cameras on at once, and turns both off and on together three times, and checks that each person sees the other one move every time.

## 2.21.0

- **A long string without spaces no longer leaves its bubble** (`aaaa…`): the bubble breaks it at any point.
- **My profile keeps what you write.** The name, status, pronouns, colors, banner, effect and About me are kept when the settings are closed (or you go to another section) and are applied only when you press Save; "Reset" throws them away. They are kept in memory only (never written to the disk of the browser) and belong to the person who wrote them.
- **Sounds from the chat to the soundboard.** Every voice note, audio and video of a chat has the button "Add to my soundboard" (before, only the ones marked by the sender), and it opens the editor to cut it, name it and give it an emoji.
- **Share your sounds.** Every sound of yours has a button to send it to the chat that is open (the people who get it can add it with one button), and a category has "Share as a pack": it sends all its sounds in one message and whoever gets it has "Add the pack to my soundboard", which makes a category with the name of the pack and adds them all at once. What comes with a sound (pack name, emoji) is cut to 20 and 8 characters when it is received.
- **Camera:** turning the camera off and on again (or the screen) sometimes left the other people with a frozen or missing picture until it was toggled twice. A camera or a screen goes now through a new transceiver each time and, when it stops, the other side hears that the track ended and drops the picture.
- **Spinly in a call:** a wheel or tournament that a friend started was lost when you joined the call from another page, because the part that listens to it was made only when a screen asked for it. It is made when the app starts.
- Call: the chip of the encryption is a lock (a shield while it is being set up) and says it with the pointer; the cipher is shown short ("AES-128-GCM", it overflowed its box); the counters of the encryption say "Sent, encrypted" and "Received, decrypted" (each is its own direction, so they are not equal); the ring of the profile effect on the big picture of a call is half as thick.
- Direct messages: bigger names, state ("In a call") and titles.
- Tests: an unsaved status survives closing the settings.

## 2.20.4

- **Watching videos together is fully custom.** The player of YouTube cannot be touched any more (nothing of it is shown or answers a press): the picture is only a picture, a press on it plays or pauses for everybody, and the bar of the call has play and pause, the time and the timeline. The +10 and −10 buttons were removed.
- **The timeline moves the video, and everybody follows.** The messages to the player carry the channel that YouTube expects and the ask to report its time is repeated for ten seconds until it answers. Pressing the bar and letting go without moving it left it frozen (it did not follow the player again); now it does. The test of the app plays a real video, jumps to second 120 on one window and checks that the player jumped and that the other window is taken to the same second.

## 2.20.3

- **Watching videos together has one set of controls: the one of the call.** The player of YouTube kept its own bar (on a Short it hid itself in some browsers, and what it did was not shared with the others), so there were two sets of buttons. YouTube's controls, keyboard and full-screen button are off now; the bar of the call has play and pause, −10 and +10 seconds, the time and the timeline.
- The timeline did not move the video when the player had not told its length yet (it stayed disabled): the app asks the player again, up to three times, until it answers.

## 2.20.2

- **The soundboard sounds at the first press.** The six effects were loaded only when one was pressed (that press stayed silent, and so did the next ones until the file arrived), and your own sounds were decoded at the first press too. Now the effects load when the page starts, your sounds are decoded as soon as the soundboard has them, and a press on an effect that is still loading plays it as soon as it arrives instead of being lost.

## 2.20.1

- **My profile no longer narrows while the page is scrolled or a fold opens.** The cause was the close button of the settings: it was a sticky float, and a grid next to a float is made narrower by it, so when the float followed the scroll over the page the columns shrank. The button now lives in a box with no height, so nothing gives way to it.
- Corner style: the slider is back, under the seven choices and with the same design as the other sliders (the names Sharp, Soft and Round under their steps).

## 2.20.0

- **Security: rate limits.** The counter of the rate limit was kept per address and shared by every route, so a route with a limit of its own (20 uploads or link previews a minute) was refused as soon as the same address had made 20 requests of any kind. Each route with its own limit has its own counter now (a test covers it).
- **Security: profile pictures.** A person who is no longer a friend, does not share a server and has no conversation with the owner loses the picture at once, even if the key that was sealed for them is still stored (before, the key was enough). The endpoint of the key alone was removed (the picture and its key come in one answer). The dependencies have no known vulnerabilities (`pnpm audit`).
- **Sounds as OGG.** Every sound is an OGG Vorbis file now (513 KB became 299 KB): the interface sounds are about 4 to 6 KB each, the ringtones 33 to 80 KB. The README of the folder says how to replace one. There are no images of the site that gain with WebP: the icons must be PNG (the phone and the manifest ask for it), the share picture JPG (the networks that read it do not all understand WebP) and the logo is a 481 byte SVG.
- **The first press sounds.** The sounds are downloaded and decoded while the page starts (an audio context that only decodes needs no press), so the first click has its sound. Before, they started loading with that first press and it stayed silent.
- Voice & video settings: the duplicate "Call sound effects" slider is gone (the volume of the soundboard is in Sounds & notifications and in the soundboard itself).
- Camera: with "Mirror my camera" on, the corners of the tile stay rounded.
- Settings: more room under the titles of the cards and under the last row.
- Call, drawer of data: it shows three small figures (loss, jitter, cipher), a small graph of the latency, and the microphone and the camera as closed folds with a summary (the level; the quality and the frames per second), instead of every option at once.
- Chat: the gradient of the bar of formatting is now the same editor as About me (quick gradients, up to five colors, markers to drag) in a panel under the bar, with Apply.
- Code: unused functions removed (`allMatches`, `sanitizeSpin`, `colorTag`, `gradientTag`, `CURSOR_NAMES`, `initialRingtone` and some variables).

## 2.19.1

- Soundboard: the volume goes from 0 to 100 %.
- Chats: opening another conversation shows it at its end at once (it was gliding from the top to the bottom, because its messages arrived before the list was hidden).
- Folds inside a card (Cursor, Theme, Background, Name font, Profile effect) are rows of the card now. They were still boxes, because the utility classes of the fold won over the rule of the card; the rule is important now.
- Name fonts: pressing one no longer turns all of them into that font (every preview was given the chosen font); each shows its own.
- Gradients: the quick angles are gone, the bar is thin, its markers stay inside the box, and when the gradient of the name or the banner is on, the single color square disappears (the gradient is the color). In About me the panels of color and gradient open in the flow under the toolbar, so they do not fall out of the page and the text that is being written stays in sight.
- My profile: the page keeps the room of the scroll bar (it shrank when a fold made the page longer and the bar appeared).
- Call, drawer of data: it is "Call data"; the spatial position is gone; the microphone has the toggles of the browser, the voice options (clear voice, extra noise removal, leveler), the level, the volume of the microphone and the gate; the camera has quality, frames per second and the mirror.
- Call: while the encryption is being set up the chip shows a shield (it said "Securing…").
- Introduction: it plays once each time the browser is opened (the first visit and a new window), not when the page is reloaded. Settings > Appearance > Motion has "Watch it again".
- Groups: the names of the tags in the list of members are shown as they were written (they were forced to capitals).

## 2.19.0

- **Soundboard with your own categories.** The "Default" tab is gone and the app brings only **six** effects (air horn, boing, sad trombone, ta-da, rimshot, applause). You can create categories (the "+" next to "All"), rename or delete them, and move a sound to one from its tile. "All" shows the six, your sounds without a category and then each category with its title. Nothing is drawn all at once: a screen of tiles first and more while you scroll.
- **Emoji picker:** every list draws one screen and only more when the end is near (before, a category filled itself little by little in the background and a change of tab lagged). The tab "All" has "Frequently used" at the top.
- **Sounds & notifications:** the order of the volumes is now interface sounds, music, effects and soundboard.
- **Sliders with words:** one component (`step-slider`) puts each word exactly under the place where the thumb stops; the first and the last line up with the ends and nothing hangs out of the box. The blur and the text size show only the ends and the value. **Text size** changes the page when the slider is let go (before everything, the slider included, grew and shrank under the thumb while it was dragged).
- **Corner style:** a preview and seven choices (the slider repeated them). A fold inside a card is now a row of the card (a line above it) instead of a second box inside the box (Cursor, Name font, Profile effect, Theme...). The theme cards no longer pile up their text when one is chosen (the name has its own line and the check mark does not take its room).
- **My profile:** the profile effects and the name fonts show **three per row**, "Delete account" is under the preview, and the folds no longer narrow the page when they open.
- **Chat:** the bubbles have more room at the bottom. The option "Message style" (bubbles or flat) was removed: it is always bubbles. The "Latest" button glides down in a fixed time (slow start, fast middle, soft landing) and fades and sinks while it does.
- **Cursor:** over the members of a group the system cursor showed (a Tailwind `!cursor-pointer` was stronger than the themed cursor); now the themed one stays.
- **About:** the links to CHANGELOG and CONTRIBUTING pointed to a branch that does not exist (`main`; the repository uses `master`): they go to `HEAD` now.
- **Spinly (Integrations):** only the number of themes and presets imported is shown, not each one. A title of a fold can use two lines ("How do I get my WhatsApp stickers?" lost its question mark).
- The encryption fingerprints (safety number, raw fingerprints and the one in Privacy & security) are in bold again.
- Animations: the lit grid of the background (two layers of a mask that was animated and painted the whole screen on every frame) is now a still mask with a band of light that slides (a transform).
- Phone: the soundboard, the sliders and the profile page fit in 390 px.
- Comments: more Better Comments tags (`?` for the reasons).

## 2.18.0

- **Profile pictures and banners are now really end-to-end encrypted.** Until now they were stored in clear (the old text said so, but it was easy to think otherwise). Now the browser encrypts each picture with its own random AES-256-GCM key before uploading it; the server keeps only ciphertext and refuses to hand it to anybody who does not hold a key. The key is sealed, in the browser of the owner, for every person who may see the picture (friends, people who share a server, direct conversations) with the same pair key the direct messages use, and the viewer's browser opens it and decrypts the picture. A new contact gets the key the next time the owner is online (the browser offers it every few minutes while the page is open). Pictures and banners uploaded before this release were erased by the server at start (nothing can encrypt them without their owner): upload them again. Group icons stay readable by the members (documented in the README and SECURITY).
- **Sounds are files now.** Every sound of the app (clicks, messages, calls, ringtones, the animations of signing in and out, the effects of the soundboard) is an audio file in `frontend/public/sounds/` in folders by use (`ui`, `call`, `auth`, `ringtones`, `soundboard`) with names that say what each one is, compressed (MP3 for the long ones, OGG and WAV for the very short ones) and a README that explains how to replace any of them. The list of files is one place (`core/sound-library.ts`). The default ringtones are files too.
- Sounds, softer: the "Pop" click is gone (the default is "Soft"); mute and unmute, deafen and undeafen, joining and leaving a call, and the sign-in (a padlock that opens) and sign-out (a padlock that shuts) animations were remade, each with a quiet background. The sound of a slider follows the chosen click style.
- **Soundboard:** the tabs are now **All**, **Default** and **Yours**, and changing between them fades the grid instead of cutting. It has a **volume slider** inside, and the same slider is in Settings > Sounds & notifications. Any **audio or video** you attach in a chat can be marked "For the soundboard": the people who receive it get a button to add it to their own soundboard (a short sound is added at once, a longer one opens the editor to cut it) and they can edit it afterwards.
- **Ringtone:** when "Your own" is chosen, the upload button appears. The file can be as long as you like (up to 25 MB): the editor opens to choose the part (up to 30 seconds), name it and listen to it, as for the soundboard.
- **Voice & video settings:** microphone volume (0 to 200 %), extra noise removal (off, light, strong: a filter for rumble and hiss and, in strong, a gate that learns how loud your room is), a voice leveler (gentle, strong), a clearer voice option, hearing yourself while you test the microphone, camera quality (480p, 720p, 1080p), frames per second (15, 30, 60) and a mirror option for your own camera.
- **Watching a video together:** the video of the stage has its own bar (play and pause, time, and a timeline that moves everybody's video), because in some browsers a YouTube Short hides the controls of YouTube and could not be moved forward.
- Settings: every block is a card with its title, like "Visibility" (a single `settings-card` style). The profile page is wider (it used a narrow column), its preview is smaller and the effect of the avatar is thicker with a stronger glow, so it is easy to see. The gradient editor has a taller bar, bigger markers, a lighter panel and buttons for the usual angles.
- Emoji: the picker opens in **All**, with "Frequently used" as its first part. The language cards are tidier.
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` moved to `.github/` (the root keeps what a deployment needs: `Dockerfile` and `docker-compose.yml`).
- **Styles in files by topic.** The 3,700 lines of `styles.css` are now `src/styles/` (tokens, cursors, components, avatars, chat, social, settings, pickers, soundboard, call, spinly, scenes and keyframes) imported by `styles.css`. The order of the rules that touch the same element was kept (checked by a script), and the built CSS has exactly the same rules as before, minus the ones nothing used (the language card, the busy cursor and an unused keyframe).
- Animations: the moving grid of the Spinly cards slides a layer (the browser moves it) instead of drawing the background again on every frame; the blurred glass behind the big panels is one pass lighter (no saturation filter, 10 px blur); five `transition-all` became transitions of the properties that really change.
- Phone: in a conversation the picture of the sender goes small next to the name, so the column of empty space at the left of every message is gone and the messages use the whole width.
- Comments use the tags of Better Comments (`!`, `*`, `?`, `TODO`) more widely in the code.
- Tests: a friend must see the encrypted profile picture of another person; the checks of the server cover keys, the audience, strangers and the erasure of the old pictures.

## 2.17.1

- Calls: the microphone and the camera buttons have an arrow (like Discord) that opens the list of devices: microphone and speakers on one, cameras on the other. Choosing one switches at once, also in the middle of a call (the camera restarts with the new one; a camera that is gone falls back to the default).
- Right click on a person in a call: a **volume slider from 0 to 200 %** for that person (double click resets it; it is kept for the next calls with them), the menu opens next to the cursor in the top layer of the browser (it was far from it because a container moved it), can be **dragged** by its title and closes with a press anywhere else, with Escape or with the cross.
- Groups: the profile card of a member no longer shows "@username".
- Spinly tournaments look better in the chat and in the call: the round as a chip, side cards with a colored edge, a glassy score, and a bracket with connecting lines, check marks on the winners and faded losers.
- Sounds, softer: the sounds of joining and leaving a call were far too sharp (measured: their brightness was around 12 000 to 14 000 Hz, a whistle). Every recorded sound was measured (loudness and brightness) and only soft ones were kept; each one has a gain that brings it to the same loudness, and all of them go through a low-pass filter. Joining a call and leaving it yourself have their own deeper sounds; deafen and undeafen are two soft drops going down or up; mute and unmute are short and low.
- Sign in and sign out: now it is a padlock that opens (sign in) or shuts (sign out), made of soft clicks and a thump, with a background of a breath of air and a slow pad of low notes that rise or fall, and a small glint of glass. The loud boom and the high sweeps are gone and the whole animation is much quieter.
- Calls: the headphones button has its own arrow with the speakers; the microphone arrow now only lists microphones.

## 2.17.0

- Emoji picker: changing category no longer freezes the page. A category draws its first screenful at once and the rest follows in small steps while the browser is idle (before, 100 to 390 emoji were created in one go). There is a new tab, "All emoji" (🌐), that shows all of them (about 1900), also drawn little by little so it never hurts performance, and it stops when the picker closes.
- Animations: a monitor now watches the real frames of the page for the first minute and, if the device stutters (more than a third of the frames under 30 per second in two windows of 3 seconds in a row), switches to the light mode by itself: no blur, decorative animations of the avatar rings and of the scenes paused. Changing tab never counts as lag. The rainbow ring no longer animates a colour filter (it repainted on every frame; the colours already cover the whole wheel), and the rings are kept on their own layer.
- Sign-in and sign-up: the button of the password uses an eye when the password is visible and a crossed-out eye when it is hidden (before, a padlock). The sign-up form has the button in both password fields.
- Privacy, in the order it is shown (Settings > Privacy & security): **Visibility** (who can see you online: everybody, friends only or nobody; whether you appear in searches), **Contact** (who can send you friend requests) and **Conversations** (read receipts, typing indicator, message marks). The server enforces the first three: somebody who is not allowed sees you offline, whatever your real state is, and a closed request is refused with an error. "Delete account" moved to Settings > My profile; its text now says that a group you own goes to its longest-standing member.
- About me: the gradient panel uses the same editor as the banner and the name (up to five colors, add and remove them, drag the markers). The gradient editor has **one** bar: it shows the gradient and, with "More options", the same bar gets its markers; the color, the place and the buttons are tidier. The custom color picker opens next to its button (below when it fits, above when it does not), not at the top of the page.
- Sounds: the interface sounds now use small recorded sounds (Kenney "Interface Sounds", CC0, 5 to 18 KB each, about 250 KB in all, loaded once after the first interaction) with the synthesized ones as the fallback; five new click styles (Pop, which is the new default, Tap, Switch, Pluck and Bubble). The sound of a slider follows the chosen click style (the recorded click gets higher as the slider goes up; the other styles tick in their own way). The animations of arriving (padlock, chimes, fireworks) have recorded layers.
- Chats: opening another conversation no longer starts at the top and falls to the bottom: it is shown already at its end and fades in.
- Text size: the whole interface follows it (before only the text that inherited from the page did; everything sized in rem or in pixels stayed). Text sizes written in pixels were converted to rem.
- Languages: the card of a language shows its own name and, under it, its name in the language of the interface (and nothing when both would be the same, so no more "Español / Spanish").
- Emoji: "All emoji" does not fill by itself: it draws the first rows and more as you scroll.
- Search engines and social networks: canonical address, Open Graph and Twitter cards with a share picture, structured data (WebApplication), web manifest and PNG icons, `sitemap.xml` and a `robots.txt` that lets crawlers see the sign-in and registration pages and nothing private. The public address comes from `SITE_URL` when building (default: the public site).
- README in Spanish (`README.es.md`).
- Comments of the audited code use the tags of the Better Comments extension (red `!` for what must never be relaxed, green `*`, blue `?`); the extension is recommended in `.vscode/extensions.json`.

## 2.16.0

Security audit release. Nothing changes in how the app is used, except that the "Hide my IP address" switch is gone: whether calls must use the relay is now decided only by the server (`RELAY_ONLY=1`).

- **Calls fail closed.** `RELAY_ONLY=1` used to switch itself off silently when the relay (TURN) was not configured, and the browser fell back to Google STUN or a direct connection whenever `/api/rtc/config` failed: the call worked and the addresses leaked. Now the server answers 503 and the browser refuses to start the call with a clear message; the relay policy lives in the configuration of every connection and is kept through reconnections; the credentials of the relay are renewed before they expire (a call of more than an hour used to lose its relay); a connection that is found to use a direct path in a private call is closed; a non-relayed candidate is never sent. No public STUN server is listed in relay-only mode.
- **Calls and a server that cannot be trusted.** A contact whose identity key changed is no longer called with the new key until the person reviews it (before, only a warning was shown); the first signal of a session must be recent, so a recording of an old one cannot tear down a live call; the "End-to-end encrypted" label now needs a frame that really authenticated, not only the keys.
- **Sessions.** Access tokens name their session: signing out, changing the password, erasing the account or reusing a refresh token stops the token at once (before it worked for up to 15 minutes) and closes the open sockets of that session. Sockets also check their session every 30 seconds.
- **Link previews (SSRF).** A link to an IPv6 address (`https://[::1]/`, `https://[::ffff:127.0.0.1]/`) skipped the check and the server connected to its own network. Fixed with a complete range list, only port 443, and a check on every redirect. The reading of the page could also be made to stall the whole server with a page of unclosed `<meta` tags; it is now linear.
- **Uploaded pictures** are validated and rebuilt without metadata (EXIF/GPS, text chunks, comments) on the server, with limits on the size in pixels; abandoned uploads are cleaned up. Profile pictures are still readable by every signed-in user and are NOT end-to-end encrypted (as before): send private photos as chat attachments, which are encrypted in the browser.
- **Deleting an account** no longer destroys the groups it owned when other people are in them: the group passes to its longest-standing member, its key is marked for renewal, its icon stays. A group with nobody else is erased. The whole deletion is one transaction.
- **Database:** deleted content is overwritten (`secure_delete`), the schema version is recorded and a database from a newer version is refused, expired sessions and used refresh tokens are cleaned every hour. `scripts/backup.mjs` makes consistent, optionally encrypted backups.
- **Web server:** a malformed address (`/%E0%A4%A`) crashed the whole process; fixed, and only GET/HEAD are served. The CSP no longer allows connections to any host (a deployment with the API on another origin must add it to `connect-src` in `index.html`). Secrets shorter than 32 characters (or identical) are refused at start. `TRUST_PROXY=1` now trusts exactly one proxy.
- **Deployment:** the TURN relay reads its settings (and secret) from a generated file instead of the command line, with no built-in addresses, limits per credential, no TCP relaying and more denied ranges (cloud metadata, link-local, carrier NAT); images are pinned (`coturn 4.18.0`, `caddy 2.11.7`, `node 22.22`); Docker logs rotate; the systemd unit is sandboxed; `.gitignore` covers data, keys and generated files. `bash deploy/turn-setup.sh --rotate-secret` makes a new relay secret.
- **Dependencies:** Angular 21.2.25 (several XSS and denial-of-service advisories), the unused `@angular-devkit/build-angular` removed (87 advisories, all build-time, down to 3 in a build-time dependency of Autoprefixer).
- A pre-existing console error after deleting an account (the sidebar read the user after sign-out) is fixed.
- Tests: `test/security.mts` runs inside `pnpm test` (no browser).

## 2.15.1

- Deleting the account now erases the row of the person too: nothing of them stays in the database (before a stub without name, password or keys stayed). To make that possible the key envelopes that a person wrapped for others no longer depend on that person's row: the public key of the wrapper (public data) is written into the envelope when the account is erased, and the app uses it. Older databases are updated by themselves when the server starts. The groups where the person was a member are marked so their owner renews the group key.

## 2.15.0

- Delete the account (Settings > Privacy & security): asks for the username and the password again (the server checks the proof of the password; a stolen session is not enough, and a wrong password does not sign anybody out). It erases the messages, reactions, files and pictures of the person from the server and from the disk, their friendships, their direct chats and the groups they own (in the others they just leave), closes every session and connection, and then erases everything kept on the device (keys, preferences, stickers, sounds, fonts). What stays is a stub row with no name, no password and no private keys: the people of the groups they were in hold keys wrapped by them, and without that row they could not read their own groups. The old tokens stop working at once.
- Calls, more private: the effects of the soundboard travel sealed inside the encrypted signals (before, the server saw which effect was played); when the server has its own relay, Google is no longer asked for STUN (it would learn the address of every caller) and the relay itself answers; `bash deploy/turn-setup.sh --private` makes every call go through the relay, so no person learns the address of another one and no third party sees any. The media was already encrypted end to end (the relay only sees encrypted frames) and the signals sealed and signed between the two people.
- Server log: it keeps no address of anybody and no query of the address (it could carry a name), only the method, the path and the status. Caddy sends HSTS and the other defensive headers.
- Cursor "soft": the hand is drawn with a thinner outline so the fingers do not fuse into one blob.
- Animations: the letters of the title do not blur while they rise, and the canvas of lights is drawn at most at 1.5 pixels per pixel (1 on weak devices).

## 2.14.0

- Sounds in the animations: the introduction has a rising sweep while the lights gather, the click of the padlock when it shuts, a deep boom with the flash and a shimmer of notes; signing in plays the click and spring of the padlock opening and the shimmer; signing out, the padlock shutting; creating an account, a fanfare and the pops of the fireworks. They are made with Web Audio (no files), follow the interface sounds of the settings and the volume, and wait for the first press of the person (before it the browser allows no sound, so the introduction of a reload is silent).
- Stickers that came out as a flat color (Opera and other browsers that protect against fingerprinting give back one single color instead of what was drawn on a canvas): a sticker that goes through the canvas is checked, and if it came out flat the picture that was chosen is kept as it is; the emoji of the starter pack that cannot be drawn become vector pictures (they are drawn by the font of whoever sees them). Vector pictures (SVG) are shown as images in the chat.
- Emoji picker: the categories work now. Only the category that is open is drawn (100 to 390 emoji) instead of all of them (about 1900), so pressing a tab is instant and the picker is light on weak computers.
- Text can be marked with the mouse only where something is typed (boxes and the composer); messages are copied with their menu.

## 2.13.0

- Deploy: the automatic update failed at the end with `KeyError: 'ContainerConfig'` because it recreated the TURN relay with docker-compose 1.x. The relay is now only started when it is not running (`--no-recreate`), and `deploy/turn-setup.sh` replaces it by removing it first. The app was already replaced that way. The update also runs one at a time and with the minimum permissions of GitHub (`contents: read`). The four secrets of GitHub (`SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PORT`) are the right and only ones.
- Security of the container: the app runs with a read-only file system (it writes only in its data volume and in memory), without any Linux capability, without the right to gain privileges, with an init process and a limit of processes. In the server, `@fastify/jwt` is updated and `fast-jwt` forced to 6.3.4 (an advisory about expired tokens in the verifier cache); `pnpm audit --prod` of the backend finds nothing. The encryption (end to end, keys derived in the browser, hash with a pepper of the server, sealed session) is untouched and the tests that check it pass.
- Emoji starter pack, in every browser: in Chrome and Edge the web font of the emoji draws nothing on a canvas, so the pack came out blank or with the wrong squares. Each emoji is drawn with the emoji font of the system first and with the web font only if that gives nothing; a blank square is never saved, and when nothing can be drawn a notice says so. Tested in Chromium, Firefox and WebKit (24 stickers each).
- Large text: the button of the emoji pack, the header of each pack and its buttons wrap instead of leaving their box; the icons of the settings menu no longer turn when the pointer is over them.
- Weak devices (4 cores or fewer, 4 GB or less, or "save data"; also any device that cannot keep up while the introduction plays): the blur behind the panels is turned off, motion is "quick" by default, the background particles run at 30 frames per second, the web fonts of emoji and names are not downloaded, and the lights of the animations are fewer. With the processor slowed down 6 times, the introduction goes from 39.5 ms per frame to 19 ms in the light mode.
- Animations: the lines of the floor of the introduction slide as one layer (no repaint every frame) and the exit does not use a full screen blur filter. Pictures of GIFs and stickers decode off the main thread.

## 2.12.0

- Friends: pressing a friend opens the chat at once (the buttons on the right still do their own thing).
- The animations (introduction, sign-in, creating an account, signing out) use the colors of the theme the person chose: the aurora, the logo, the rings, the shockwaves, the lights and the first dark layer take the accent color, the second color and the mix of both. The chosen accent is applied from the first paint, so the first layer already has it.
- Flags of the language cards are pictures now (they look the same in any browser and system, Opera included, without depending on a font).
- Emoji picker, much lighter: one listener for the whole grid instead of one per emoji (about 2000 less), no hover growth and no container-query sizing on every glyph, and the scroll is followed once per frame at most.
- Emoji starter pack: it no longer waits for ever for the emoji font in browsers where that font never answers (it waits 1.5 seconds per emoji at most and then draws with the system font).

## 2.11.0

- Calls on the server: the signalling (messages, ringing, the sounds of the soundboard) went through but the media (audio, camera, screen) did not connect when the two people could not reach each other directly (two people behind the same router, mobile data, firewalls; no setting of the browsers fixes it). The Docker setup now includes a TURN relay (coturn) that is set up with one command, `bash deploy/turn-setup.sh`: it writes the TURN variables of `.env` (secret, public and private IP, addresses), opens the ports of the machine and starts the relay and the app. The three rules of the Oracle Cloud network (UDP 3478, TCP 3478, UDP 49152-49252) still have to be added in the Oracle console; `deploy/DEPLOY.md` says where. The media stays end-to-end encrypted: the relay only sees encrypted frames. The automatic update also keeps the relay running.
- Pictures: browsers that protect against fingerprinting (Firefox with that option, Brave) hand back a blank canvas, which made a banner or a picture upload as an empty image; now, when the result is blank, the picture that was chosen is uploaded as it is (up to 8 MB).

## 2.10.0

- Pictures: the profile picture, the banner and the group icon can be up to 8 MB (moving ones, GIF or animated WebP, are kept as they are up to that size; before it was 2 MB).
- Emoji starter pack: some emoji came out blank and others drawn with another style, because the emoji font arrives in pieces and the pack was drawn before the piece of each emoji had loaded. Each emoji now waits for its piece first, and the coffee cup has the symbol that tells browsers to draw it as a picture. If your pack has empty squares, delete it and add it again.
- Browsers: stickers, sounds and ringtones kept on the device are saved as bytes instead of as files, because some browsers (Safari, private windows) fail with "Error preparing Blob/File data to be stored in object store" when a file is put into IndexedDB; what was saved before still opens.
- Flags: on Windows the flag font is always used, whatever the browser (Brave, Opera and others scramble what a canvas returns, which fooled the test that decides it, so flags showed as letters: GB, ES).
- The help of the stickers tab breaks long file paths, so the text no longer leaves its box in browsers that do not break after a slash.
- Tested on Chromium, Firefox and WebKit (the engine of Safari). Emoji do not look the same in every browser because each one draws them with its own font when it does not support ours; the same goes for the style of the flags on systems that have their own.

## 2.9.0

- Soundboard, your sounds: no more limit of 8 seconds. Choose any audio file (up to 25 MB) and a window opens to prepare it: see its wave, cut the part you want (drag on the wave or use the Start and End sliders; up to 30 seconds are kept), listen to it, give it a name and an emoji, and save. Every sound has a pencil to edit it again later (the whole file is kept, so the cut can be changed), and the tile shows its emoji. An edited sound gets a new identity, so the people in a call receive the new version.
- Calls: the sounds of the soundboard travel in up to 100 pieces (30 seconds), and the server allows more frames per 10 seconds so a long sound sent to several people is not taken for abuse.
- Calls on a server behind a proxy: the WebSocket (where calls, messages and presence travel) now also accepts the page that was served from the same address as the socket, so it no longer depends on `CORS_ORIGINS` being written for the real domain (a forgotten `DOMAIN` in `.env` left the socket closed with "origin not allowed" and nothing in real time worked). When the media of a call cannot connect, a notice says that the two networks may need a TURN relay server (see `deploy/DEPLOY.md`).

## 2.8.0

- Adjust your pictures: after choosing a profile picture, a banner or a group icon, a window shows exactly what will be kept (a circle for pictures, a wide frame for banners). Drag the picture to move it, scroll or use the slider to zoom, then save. Pictures that move (GIF, animated WebP) are still kept as they are.
- Fixed: the profile could not be saved ("Some values are not valid") after choosing the font you uploaded for your name, because the server did not accept that value. It does now.
- The warning limit of the first download is 520 kB (it was 500 kB and the new windows loaded only when needed still add a little to the shared code); the first download is 500.3 kB.

## 2.7.0

- Fonts you upload (for the interface and for your name) can weigh up to 5 MB, instead of 2 MB. They stay on your device, so the server is not involved.

## 2.6.7

- Deploy: the automatic update failed with `KeyError: 'ContainerConfig'`, a bug of docker-compose 1.29 when it recreates a container made from an image built by a newer Docker. The workflow now builds the image, removes the old container (the data volume stays) and starts the new one, which works with docker-compose 1.x and with `docker compose`.
- No more warnings in the build: the group page no longer needs the `?.` that Angular flagged (the id of the group is computed in the class), and the warning limit for the size of a component's styles is 8 kB (the error limit 12 kB), because the animations of arriving are big on purpose and load only when they play.

## 2.6.6

- Deploy: the automatic update never ran because the workflow listened to the branch `main` and the repository uses `master`; it listens to both now, can be started by hand, and replaces the code of the server with `git reset --hard` (a file edited by hand on the server, like the Dockerfile, made `git pull` stop).
- Docker: the app publishes the API on 127.0.0.1:3000 and the web app on 127.0.0.1:3001 for a Caddy that already runs on the machine (`deploy/Caddyfile.host`); the Caddy inside Docker is now optional (`--profile caddy`). Sending only the web port to Caddy made sign-in fail with "JSON.parse: unexpected character".

## 2.6.5

- The handoff from the first layer of the page to the introduction is exact now. Measuring the opacity frame by frame showed that the aurora of the animation started at full strength while the one of the first layer was still at 2%: a jump from almost black to full aurora a few milliseconds after load. The animation now reads the point where the first layer's animations are and continues from there (aurora and glow), so the two are the same picture and nothing jumps.

## 2.6.4

- The big words of the sign-in page: more space between the two lines (1.38 times the size) so that the blocks drawn when selecting them never touch, not even with Segoe UI or other fonts that are taller than Inter (measured: with Segoe UI the blocks used to touch or overlap).
- The introduction has no more "pops": the lights fade in when they are born (and the ring that bursts keeps its light instead of restarting), the dust fades near the top and bottom edges where it wraps around, the layer of lights fades in as a whole, and the flash and the shockwaves start from nothing and rise quickly instead of appearing at full strength.

## 2.6.3

- Animations, background: the aurora no longer turns (a turning square showed its edge as a cut); it sways gently and the layer is larger than the screen, so no edge is ever seen. The first layer of the page and the animation share the same sway, so the handoff is not seen.
- No more "pops": the glow in the center is the same circle in the first layer and in the animation (same size, place and breathing), the logo sits at the same height in every scene, and the floor grid fades in slowly instead of appearing at once.
- More life: slow dust floats upward and twinkles all through the show (90 motes), and soft rings of color spread out from the logo again and again.

## 2.6.2

- The introduction starts on the very first frame, also when you run the app with `pnpm dev`: the dark layer with the aurora and a breathing light now lives in `index.html` of the source (before it only existed in the production build), it is visible from the first paint, and the animation continues the same aurora (same turn, no fade) instead of starting over. Measured in a production build: the layer is on top from the first 30 ms and the animation from about 90 ms on a warm load, with no frame of the sign-in page in between.
- The glow behind the logo is its own circle now, not part of the spinning logo, so no dark rectangle shows while the logo turns.

## 2.6.1

- Signing out: the padlock really closes now (the animation ended on the open pose by mistake).
- The dark layer that covers the page until the introduction starts is plain dark now, with no aurora or glow of its own, so there is no change of brightness when the animation takes over; measured in a production build, the layer is on top from the first 30 ms until the animation is.
- The subtitle "Private by design" is gone from the introduction.
- Docker: the build now installs Playwright and Chromium in the build stage (the build takes the pictures of the sign-in page with them), and the post-build step no longer stops when Playwright is missing: it skips the pictures and finishes the rest.

## 2.6.0

- The introduction is now the first thing on screen when the page loads: a dark layer with a soft aurora comes inside the HTML itself, so the sign-in page (or the empty page) is never seen before it. The animation takes over from that layer without a flash, and the layer is not drawn at all for people who reduce motion.
- Signing out: the padlock of the logo now snaps shut earlier, while the iris is still opening, so the closing is seen.

## 2.5.0

- The introduction plays every time the page is loaded (not only the first visit), starting at once; a click skips it. It still respects "reduce motion".
- The big words of the sign-in page ("Talk freely. Nobody is listening.") have more space between lines, so selecting them no longer draws overlapping blocks, and the selection color is a little stronger.

## 2.4.0

- The page is no longer black while it starts: people who are already signed in see the logo of Chatterly-Renewed breathing (drawn in the HTML itself, so it shows at once) until the app appears, on every reload.
- The animations use the real logo of Chatterly-Renewed (the bubble with two eyes) instead of a made-up one. It spins in, its outline draws itself, it fills with the gradient, blinks, and carries a padlock that snaps shut (introduction, sign-out) or opens (sign-in). The first light of the introduction shows up sooner, so there is no empty black moment.
- Performance of the animations: the lights are drawn from one small picture per color instead of a new gradient for every light on every frame, and the moving aurora no longer uses a blur filter.

## 2.3.0

- The introduction plays again for everyone: the mark that remembers it was seen has a new name, so devices that saw the old, weak one see the new one once.
- Signing out has its own animation: the iris closes over the app, the lock of the logo snaps shut, the lights gather and the screen says "See you soon, {name}" while the app is cleaned under the cover.
- The sign-in and sign-out scenes have a bigger logo with two rings of light that turn in opposite directions, a keyhole in the lock and a lock that opens (or closes) with a spring.
- Docker: a `Dockerfile` (ARM and x86), a `docker-compose.yml` with Caddy for HTTPS and an optional TURN server, and a Docker section in `deploy/DEPLOY.md`. One command (`docker compose up -d --build`) puts the server up.
- Fixed the build on Linux: five type annotations had been written with an absolute path of Windows (`D:/dev/...`) by the editor; they are normal imports now.

## 2.2.0

- New arrival animations, much bigger. The first visit opens with an aurora of moving light over a glowing floor in perspective; a hundred and fifty points of light spiral in from the edges of the screen and gather into a ring around the logo, which spins in from the side while its outline draws itself in a gradient; the lock snaps shut, and the ring explodes in a flash, a shockwave and a burst of sparks; the name rises letter by letter with a shine that sweeps across it, and the whole scene leaves with a zoom. Signing in opens like an iris from the centre, the lock of the logo opens and the lights burst out as the app appears. Creating an account ends with fireworks over the aurora, a gradient check mark and the welcome. They are still only code (CSS, SVG and a small canvas), load only when they play and are skipped for people who asked for no motion.
- The warning limit for the style size of a component was raised from 4 kB to 6 kB for these animations (the error limit stays at 8 kB).

## 2.1.0

- Arriving in the app, with animation: the very first visit opens with an introduction (a chat bubble with a lock that draws itself, the name rising letter by letter, rings of light; a click skips it); signing in opens the app behind a wipe with a lock that opens and a welcome by name; creating an account ends in a celebration (a check that draws itself, a burst of confetti and the words "your keys were made on this device and never left it"). They are made only of CSS and SVG, load only when they play, are not shown to people who asked for no motion, and the page underneath changes while they cover it.
- Passwords: the proof of the password is now mixed with a secret of the server (a "pepper" that is not in the database) before the slow hash, so a stolen database alone can not even be attacked by guessing passwords. Accounts made before get their hash upgraded the next time they sign in. (The password itself still never leaves the browser: it is stretched 600,000 times there, and the server only ever sees and stores a hash of a proof derived from it.)
- Session: the tokens kept on the device are encrypted with a key that cannot be copied out of the browser (stored in IndexedDB as a non-extractable key), so a copy of the files of the browser shows nothing usable. The app sets no cookies at all, so there is nothing to steal or to forge from another site.
- Speed of the first visit: the font of the first paint is requested at once, the app starts right after the page is painted, and unused styles were removed. Lighthouse of the sign-in page in a production build: Accessibility, Best practices and SEO 100; Performance 100 on a fresh server start (94 to 95 on repeated runs on the same machine, because of how Lighthouse simulates a phone over localhost).

## 2.0.1

- Code: every function of the app, the server and the test now says what it does and why (about 340 were missing it); the names that were in Spanish are in English; the pieces that were written twice were unified (the class of the font of a name, the decibels of a level, the nickname window, the id of the caller and the cleaning of texts in the server).
- Security, a second full pass over the server and the browser:
  - an access token of an account that no longer exists stops working at once, not after 15 minutes;
  - a person keeps at most 20 open sessions (the oldest close);
  - guessing the old password through "change password" with a stolen session is locked like the sign-in is;
  - in a direct chat that is no longer between friends nobody can edit or react;
  - the picture of an uploaded animated cursor is checked before it is written in the page.
- Checked on screen, on a computer and on a phone (390 px), with no sideways scroll: the friends, the chat, the tournament of Spinly in the chat (the wheel is there from the start), the call, the soundboard, the Spinly panel of the call (the Space key spins it) and the settings.

## 2.0.0

- **Chatterly 2.0.** The look is the one you chose; this version gathers and polishes the work of the 1.x line.
- Cursors: Solid, Soft and Elegant have silhouettes of their own now (a folded corner, a drop and a ring on a stick, next to the classic arrow, the neon dart, Halo and Pixel), and over something that can be pressed every family shows a hand in its own style, drawn on the same point as the arrow so the pointer never jumps.
- Soundboard: three columns, always full rows (12 effects and 6 ambient sounds; the "Bubbles" sound is gone).
- Groups: the Administrator section is there from the moment the group is created, not only once a tag exists. Going from one group to another has a soft entrance.
- Spinly: the tournament of the chat shows the wheel from the start and spins it slowly enough to follow; the bracket of a finished tournament folds and unfolds smoothly; the background of its windows is darker and blurred.
- The titles of the settings no longer show up in English as a tooltip when the language is Spanish.
- Lighthouse of the sign-in page in a production build: Accessibility 100, Best practices 100, SEO 100, Performance 94 (the first paint takes about 2 s on the throttled phone profile; the initial bundle is 500 kB, the one that sets the limit).

## 1.26.0

- Cursors, redone: every family has an arrow of its own (Classic, a neon dart, a bold one, a chubby one, a thin outline, plus the dot of Halo and the pixels). Over a link the arrow lights up in the same place, so the pointer does not seem to jump; the cards of the settings show them.
- Calls: the call bar and the music card move the same way (they follow the pointer while you drag, the free place lights up and they glide into it when you let go; an entrance animation was holding the call bar). The call bar cannot be selected as text. The music card has more room for its buttons and a button to fold it to one line.
- The side bar stays on the group when you join one of its voice channels (it used to jump to Home), and the group stays marked in the left bar.
- The soundboard and the Activities menu cannot be open at the same time.
- "Your messages" in the chat bubbles uses the gradient controls of the profile (two to five colors on a thin bar, angle).
- Spinly: the background of its windows is a grid of lines that moves by itself; the cards of the chat and the call have a band of color in their heads.
- The channels of a group have calmer rows and hover.
- Deploying: the guide explains how to run your own STUN and TURN (coturn) in the same machine, how the signalling and the encryption fit, and a table of the usual failures (CORS, proxy, microphone, calls).

## 1.25.0

- Spinly: Space spins the wheel and the tournament again (the cursor drawn by the page was counted as an open window and blocked the key); the background of the Spinly windows moves by itself (a drifting glow and a grid that lights up in waves) and no longer follows the pointer; the score has a clean type and the button just says "Spin"; the wheel takes less room and needs no scrolling; the cards of the chat appear with a soft entrance.
- Groups: the tags are in a list you order (up and down), and that order is the order of the sections; the administrator is always the first section. In the window of tags, opened from the menu of a member, each tag is a switch for that person and a tag you create there is given to them at once. The tags are squarer and the color picker opens next to its button.
- Music: the bar of the shared player has a whole row for the timeline; any video of a playlist can be taken out (for everybody). The cards of the menus of activities are more compact. The soundboard has two categories (Effects and Ambient) plus yours, and it keeps its size when you change category.
- The cursor goes back to the real one as soon as the window loses the pointer or the focus (it vanished when another window was in front). The call bar and the music card glide to the place they are dropped on.
- Looks: the icons of the settings menu turn and shine again on hover; the links to the documents of the encryption systems are in About too; the effect ring of the avatars grows with their size, and the dot of the state sits on the edge of the picture; the stickers card is smaller and does not stretch; Plum and Tangerine's Pop swapped places.
- Deploying: `deploy/` has the guide to run the app on a free Oracle Cloud server with HTTPS (Caddy), a systemd service and a GitHub Action that updates the server after every push to main.

## 1.24.0

- Effects (the ring of the profile): only your own avatar (bottom left) and the profile cards show them; the friends, the chats list and the members list do not. The dot of the state sits outside the ring so it no longer eats part of it, and the card with your name at the top of the state menu is gone (the name is already below).
- Groups: right click a member and choose their tags straight from the menu (the ones they have show a check); "Manage tags" makes or deletes tags. The members list has more space between people and a section for each tag.
- Calls: joining a group while you are in a call now switches the call at once: the late answer of the server to the old call no longer ends the new one, and the call page no longer sends you home in the middle of the switch.
- The music card only rests on the top corners, the top middle and, when the stage is wide enough, at the left or the right of the bar of controls (otherwise just above it, and above the strip of small tiles when somebody is pinned). Dropping it chooses the nearest of those places and it glides there smoothly.
- Gradients (name and banner): from two to five colors; each color is a marker on a thin bar that can be chosen and dragged, with its own color and the angle. The controls are folded away until you press Edit.
- About me: Control+Z and Control+Y (or Control+Shift+Z) undo and redo, also after formatting.
- Cursors: every family now has every state (text, hand, grab, forbidden, wait, help, zoom, move, resize, crosshair) drawn in its own style, and Solid and Sleek no longer look alike. The default cursor is the Classic one (first in the list, called Default) and the old "Themed" is called Neon.

## 1.23.0

- Listen together: the music card can no longer be resized; it is dropped on the corners of the stage (and the middle of the top and the bottom) like the bar of the call, with targets while you drag, and it stays above the strip of small tiles when somebody is pinned. It no longer slides under the edges, and times with hours (2:34:02) are aligned. The link window has no "Paste" button. The Activities menu and the "+" menu of the chat have richer cards.
- Soundboard: in a call it opens upward from its button, smoothly, and the categories wrap instead of being cut.
- In full screen the right click on a person works (the menu lives inside the full-screen stage) and only the people showing a camera or a screen float over the big tile.
- Messages: a deleted message fades and folds away for everybody instead of popping out.
- Spinly: Space spins the wheel and the tournament of the call even when a button has the focus; the window to make a wheel or a tournament and the Spinly panel of the call have the glowing, pointer-following grid of the real Spinly; the tournament in the chat has a fixed, readable width on a computer and fits a phone.
- Names: the color, the gradient and the font of a name show everywhere it appears (chat header, call, friends, groups, replies, incoming calls). The avatar of the bar at the bottom left, the chats and the members shows the profile effect too.
- Gradients (name and banner): the second color, an optional third color in the middle, the angle and where the gradient starts and ends (instead of the opacity). The color picker has no quick colors, no color dot and squarer corners.
- Groups: tags show in the members list (a section for each tag, like Discord) and in the profile of a member; the owner makes them with the color picker.
- Looks: the friends page has the tabs in one dark bar, a darker "Add friend" and a better search; the stickers import is a big drop card; Settings > Privacy & security names the encryption systems as links inside its texts (the "Encryption used" card of About is gone).
- Cursors: the themed cursor is now the neon one; Glass and Neon are gone and Solid (the old themed one) and Sleek are new. New melodies with a bass line for the call (Deck the Halls, Ode to Joy, a spooky waltz and a bouncy classic).
- The wallpaper is drawn as an image element, so a GIF keeps moving.

## 1.22.0

- Listen together: the music card can be dragged anywhere on the screen by its header and made bigger (never smaller) from its corner; where it is stays remembered. The queue button counts everything still to come (a playlist is counted too, it showed 0 before). The link window lost the "Paste" button and looks better.
- Soundboard: the categories are a row of pills on top and the sounds of the chosen one open below, like Discord.
- Shortcuts: any single key or any combination can be used (a bare Space or Enter on a button still presses the button; inside a text field a plain key does not trigger anything).
- Settings: the four sliders of Motion have the same size and go in the order Background visibility, Background blur, Background motion, Animations; the sections of Appearance and of Sounds are grouped under titles (Interface: corner style and text size; Chat: message style, actions over a message and bubbles; Cursor; Volume, Sounds and Notifications), and a section opens smoothly the first time too.
- The backgrounds Topography (lines of height that breathe), Sunset (a low sun, clouds and hills) and Waves (with a bright crest) were redrawn; the cursors Glass, Neon and Classic too.
- Add friend sits at the end of the row of tabs of the friends page. A GIF or an animated WebP (up to 2 MB) can be a profile picture, a banner or a group icon and keeps moving.
- Groups: only the owner creates tags and gives them to the members (right click a member, Tags); they show under the name in the members list. The server checks it is the owner, the limits (12 tags per group, 5 per member) and the color.
- On a phone a block of code no longer makes its message wider than the screen. New melodies for the call (Silent Night, Auld Lang Syne, a music box waltz and a lighter classic).
- Security: the link-preview address check was widened, each person can keep at most eight connections, and the upload of files has a daily quota (done in 1.21.0).

## 1.21.0

- Chat: when something new arrives (a sticker, a GIF, a picture, a block of code) the conversation glides to the end by itself, smoothly and without jerks, if you were at the end, if you sent it, or if you are writing; if you scroll up it leaves you alone. The Spinly tournament in the chat is shown with its champion, the number of participants and duels, and a button to see or hide the bracket.
- Emoji: a message of only emoji enters with one of six animations (a different one for each message) and does not tremble when you point at it. The emoji picker opens at once (the list is downloaded in advance when the browser is idle and drawn section by section), and the soundboard uses the same emoji and the same look as the chat.
- Groups: drag them in the bar at the far left to put them in the order you like (it is remembered). Pointing at a group, at a member or at anything inside a button shows the themed cursor, and the themed and the system cursor no longer show together over a scrollbar.
- Wallpaper: GIFs, animated WebP and short videos (MP4 or WebM, up to 25 MB; pictures up to 12 MB) can be used as the background and they move. They are kept only on the device.
- Link previews that play in the chat without signing in: Instagram, X (and its mirrors, Nitter among them), TikTok, Bluesky, Reddit, Twitch, SoundCloud, Dailymotion and Streamable, besides YouTube, Vimeo and Spotify.
- Looks: the "Add friend" button follows the theme; the friends in the list rest in a slightly darker tone; the hover of servers, groups and channels is calmer; the dot of the state in the profile preview sits on the picture's edge; Shortcuts is before Integrations in Settings; the music note is for Listen together and the soundboard has its own icon. Every place where a file can be uploaded now says its size limit.
- Security: the link-preview server refuses more reserved addresses (IPv4 inside IPv6 in hexadecimal, translation and documentation ranges, multicast); each person can keep at most eight open connections; and the upload of files has a daily quota per person (bytes and number of files).

## 1.20.0

- Settings: the motion of the background no longer turns off the other animations. "Background motion" (Off, Slow, Normal, Fast) only moves or freezes the background, and the new "Animations" (Off, Quick, Full) controls the transitions and movement of the interface. A new slider, "Background visibility" (Solid to Open), sets how much of the animated background shows through the big blocks of the interface; the list of the settings is opaque again. The theme is "Tangerine's Pop" and sits second to last. The new Shortcuts section lets you choose the keys to mute, deafen, turn the camera on or off, share the screen, open the soundboard and hang up (they work while the tab is in front).
- Menus and windows leave smoothly: the Spinly window, the soundboard, the menus of the call, the lists and the pickers fade out instead of vanishing.
- Calls: the floating bar of the call (when you are on another page) no longer sits over the box where you write: it rests at the top right and can be dragged to six places (the corners and the middle of the top and the bottom), with targets shown while you drag; it also shows what is playing, with a pause button. Names with a color or a gradient show it in the call, in the sidebars, in the friends and in the groups too.
- Calls, Listen together and Watch together: skipping only exists when there is something to skip to, and a song or video that ends with nothing queued simply ends. Videos can be queued too, and a YouTube playlist is shown as a list (with the one that plays marked, and any of them can be chosen). The activities menu is opaque and roomier, with a "Paste" button.
- Sharing the screen opens a menu of the page first: what to share (a screen, a window or a tab), the quality (720p, 1080p, 1080p at 60) and whether to share the sound; the browser then asks to confirm, already narrowed to that. (The picker of the browser itself cannot be replaced.)
- Spinly: its logo is an SVG inside the page (no request, so it never waits to load) and is used everywhere. The tournament in a call was redone like the real Spinly: round, progress, a card for each side with its color and points, the bracket with colors and scores, and a champion card with confetti and the podium.
- The color picker no longer closes by itself when you press inside it in the Spinly window.
- About: a card lists every encryption system the app uses with a link to its specification.
- It also works in browsers without Web Audio: the app stays silent instead of stopping (it was checked in Firefox, WebKit and phones).

## 1.19.0

- Calls: the call keeps running when you leave its page (the music, the video, Spinly and the shared screens go on, and everything is there when you come back): the call now lives in the layout and its page only hides it. The bar of buttons is mute and deafen | camera and screen | activities and soundboard | hang up (a red phone button, no word, no crossed phone), and its buttons stay still on hover. A tile shows a red icon for muted or deafened instead of the word "Muted", does not say "(you)" and has its name lower and further from the edge; the buttons over a tile (pin and full screen) light up softly instead of jumping.
- Music card: a volume button with a slider that clings to 0, 25, 50, 75 and 100 and moves freely in between; the card only sits at the left of the controls when there is room for it.
- Soundboard: 19 effects in folding categories (alerts, fun, drums and crowd, nature, magic) and your own sounds (any audio file, up to 8 seconds). Everybody in the call hears your sounds: they are sent once, encrypted, to each person and kept only on their device while the call lasts.
- Color picker: redone and smooth to open and close; no number arrows, a round hue handle, an RGB row of plain fields. A press outside closes only the picker, and so does Escape (the menu or window under it stays); the click that closes it is not passed to what is under it. In the Spinly window, pressing a slice, the arrow or the lights opens this normal picker where you pressed.
- Settings: the Sand theme is gone; the new Tangerine Pop (orange) is there instead. The backgrounds are clearly visible now (the big blocks of the interface are translucent over them, and the scenes are brighter); the grid is a lit grid whose lines light up in waves; the motion of the background is a slider (Off, Slow, Normal, Fast).
- Buttons and cards no longer move when you point at them (they only change color or glow): a hover that lifts the element made it flicker when the pointer was on its edge, and it was the "dance" of some buttons.
- Other: the default voice channel is called "Voice"; the video call button is gone from a chat (call and turn the camera on); "Clear styles" is gone from About me; the logo of Spinly is fetched early; flag emojis are drawn with a flag font on systems that draw only letters (Windows); the sticker packs can be opened in browsers without 'deflate-raw' in DecompressionStream (older Safari) thanks to an own decoder.

## 1.18.1

- Everything made to open the app from another computer (VPN, LAN) is gone: the https door with its own certificate, the proxy of `/api` and `/ws`, the door in front of `pnpm dev`, the extra allowed origin and the message about plain http. `pnpm app` serves the build on port 4200 and `pnpm dev` works as it did.

## 1.18.0

- Spinly in a call: the wheel (and the duel wheel of a tournament) shrinks to the height of its tile, so the button that appears after a spin no longer makes the tile scroll. The space bar spins the wheel or the next duel (not while you type, or when a window or a menu is open).
- Drop-down lists (microphone, speakers, trail, click point) are drawn by the page, not by the browser: they keep the themed cursor, look like the rest of the interface and work with the keyboard. The list of devices updates when one is plugged in or taken out, and asks for the microphone once (if the browser has not given the names yet) so that every input and output shows up.
- The diagnostics panel of a call slides in and out smoothly instead of disappearing at once.
- New switch in Settings > Appearance, "Actions over a message", to remove the bar of reactions and options that shows when you point at a message.
- The buttons of the friends list are rounded less. The themed cursor now leaves with the mouse: when the pointer goes out of the window it hides at once, and no frame that was already due brings it back.

## 1.17.0

- Calls, buttons: the soundboard sits with the microphone and the headphones on the left, and Activities with the camera and the screen on the right.
- Listen together now has a queue everybody shares: anybody adds a song or a playlist (from the Activities form or from the card), anybody takes one out, and a vote of more than half of the call skips the song that plays; when a song ends the next one starts by itself. The titles are shown when YouTube or Spotify give them. The music card is no longer a bar in the middle: it sits at the bottom left, beside the controls (above them on a narrow screen), with pause, the vote to skip, the queue and the timeline.
- A video to watch together is as big as its 16:9 picture allows (the tile has the shape of the video instead of black sides) and sits in the middle of the stage.
- Calls: a right click on a person, a camera or a shared screen hides it from your screen only; a "Show hidden" button brings everything back. Full screen shows everybody who is not the big tile as a small window, whether they have the camera on or not.
- Cursor: the themed cursor no longer stays frozen when the pointer goes into a YouTube video (the page of another site hides where the pointer went; the cursor now notices the frame), and the wheel, the floating tiles and the other places that asked for a plain `pointer` or `grab` cursor now use the themed ones, so the system cursor does not show up there.
- Settings > Sounds & notifications uses a speaker instead of a bell. In a server, the people in a voice channel are listed under it with more room and a guide line. In the friends list the buttons are always visible and the row lights up with the accent when you point at it, and presses in.
- Spinly: "Write at least two" is gone and the wheel has a little more room above it.

## 1.16.2

- Spinly: a tournament that has a champion shows only the champion (the bracket and the rest go away). The rows of options and participants no longer have a color dot (the color is changed by pressing the slice on the wheel), the title field is gone, and the window is only as tall as its content (it scrolls when there is a lot), so it looks right at any screen size. In the plain wheel the result and the button have their own reserved space, so the wheel no longer jumps up when they appear.

## 1.16.0

- Settings > Sounds: you can upload your own click sound (a short audio file up to 1 MB and 3 seconds; it is kept on this device only), and the Mechanical click is gone.
- Settings > Appearance: two more mouse cursors, Neon (a hollow glowing arrow) and Pixel (a blocky retro arrow).
- Profile: the "Upload photo" button is gone (pressing the picture already changes it). The Name font and Profile effect menus have more room: they use fewer, wider cards depending on the space they really have.
- Spinly window: the "Add option / Add participant" button moved up next to Recolor, so it no longer moves down with every new row; the list of rows scrolls inside a fixed height. The text on the wheel is bigger, and so is the preview of the wheel.

## 1.15.0

- Listen together / Watch together: pausing, resuming, jumping on the timeline and changing song in a playlist are shared by everybody, from the same second; deafening only mutes the sound, so the player keeps going and never falls behind. The music bar has a timeline to move forward or back (on a phone it takes its own row). Playlists work: long playlist links are accepted, and a video that belongs to a playlist plays it. A jump made on the timeline of the YouTube player of a video is shared too.
- Calls in full screen: pressing full screen puts the whole stage on the screen, with the shared screen or video big and everybody else (cameras, Spinly) as small windows at the top right. They can be dragged and resized by any corner (also with a finger), and stay where you leave them. Spinly cannot be put in full screen (it is pinned big by itself when it starts, with the others small).
- Spinly window: the color of a slice opens the real color picker in place (no placeholder swatches); the pointer and the lights are colored by tapping the arrow or the rim of the wheel (the rows for them are gone); Recolor really shuffles the colors; Look and Your Spinly presets are two sections that open and close, one under the other; a tournament offers just its three modes (Fast, Classic, Epic).
- Spinly in a call: "Play them all" is gone; the champion has a proper card; the content is centered in its tile instead of leaving the empty black space; when the tile is wide the wheel and the bracket sit side by side.

## 1.14.1

- Calls: the first spin of a tournament in a call now turns (the wheel was drawn already at its final position and stood still). The tournament tile uses two columns when it is wide (the wheel and its buttons, and the bracket beside it) instead of squeezing the bracket under the wheel.
- Listen together and Watch together: pausing or resuming (from the music bar, or in the YouTube player of the video) pauses or resumes it for everybody, from the same second. Closing it with the X now only closes it for the person who pressed it; "Stop" in the Activities menu still ends it for everybody.
- The music bar is thinner and no longer shows the YouTube picture: only the title, who put it, a play/pause button and the close button. The player is invisible, so it never catches the mouse.

## 1.14.0

- Calls: "Listen together" is only sound now. Music no longer takes a tile of the stage: it plays in a small player (with a moving equalizer and the stop button) above the controls, and the tiles make room for it smoothly. A video to watch together keeps a true 16:9 picture inside its tile, as big as the tile allows and never cropped or stretched, in the grid, enlarged, in full screen and on a phone.
- Spinly window: when you click a slice of the wheel the others dim, so it is clear which one you are editing; its color is edited right below with a bigger palette, the live color and the name of the option. "Paste a list" is gone (it was clutter next to the rows).
- Settings > Integrations: the Spinly card follows the colors of the app (the amber tint is gone; it uses the accent), shows whether the account is linked, the themes and presets that came over as two big numbers with a preview of each, the buttons to update or unlink, and what Spinly does in a chat and in a call. Before linking it is a single sentence and one button. It also fits a phone.
- The Spanish dictionary is downloaded only for people who use Spanish (the first page is no longer slowed for everybody else); the initial bundle went from 515 kB to 466 kB.

## 1.13.0

- Calls: Listen together, Watch together and Spinly now start from one "Activities" menu in the call bar. Each activity becomes a tile of the stage, laid out and animated like the camera tiles, so nothing opens stretched any more: the wheel, the video and the music adapt to the space they get, in the grid, in the focus strip and on a phone. A video or a wheel takes the stage by itself when it starts, and the music stays as a small tile.
- Watch together: share a YouTube video and everybody sees it in sync (the music player no longer stretches over the screen either). Starting a video replaces the music, and the other way round.
- Spinly window: click a slice of the wheel to pick it and change its color right under the wheel. The tournament is split in two tabs, Participants and Rules, so each one fits without scrolling.
- Ringtones: pressing one ringtone and then another no longer plays both; the notes already queued are silenced at once. Pressing the one that plays stops it. The cards show which one plays (dancing bars) and what Automatic plays today.
- Settings > Audio: a slider for the volume of the sound effects of a call.
- Mobile: the call stage, the Activities menu and the Spinly tile adapt to small screens.

## 1.11.0

- Calls: the tiles are laid out like Discord. Everybody gets a tile of the same size, the biggest that fits, in a symmetric grid (the last row centered). Click a tile (or its pin button) to enlarge it: it fills the stage and everybody else, webcams included, becomes a small strip below; click it again to go back to the grid. A shared screen takes the stage by itself when it starts (and again whenever someone shares a new one), and you can still go back to the grid. Double click a tile, or use its button, to see it in full screen. Every tile moves to its new place smoothly (when someone joins or leaves, when you enlarge one, when the layout changes), and follows the window at once while you resize it. The buttons of a tile show on hover (always on a touch screen).
- Messages: the bar of actions over a message is as it was before (smaller radius, on the side of the message), keeping only its short spring-in.
- Side bars: more air between the Friends entry, the lists and their titles, and between the items of a list.
- "Members", "Groups in common" and the other list titles use a count pill instead of a dash.

## 1.10.0

- About: every card leads somewhere (Zero knowledge opens Privacy & security, Open source and No tracking open the repository and its security notes, every technology opens its own site); the page keeps its stacked layout, a little more compact so that it, like Privacy & security, fits a 2K screen without scrolling.
- Integrations: shorter and tidier (the real Spinly logo, the themes and presets that came over as two numbers, one line about privacy, and two small cards for the chat and the call). The "Open Spinly" button is gone, and so is "Open the full Spinly" in the window that makes a wheel: Spinly is used from Chatterly, and the panel with the real Spinly only appears to link the account.
- Spinly window: the tournament rules follow Spinly's own (ready-made Fast, Classic and Epic rules, a stepper for the duels and another for the final with the points needed, who plays who, equal chances, third place, quick spins and a summary line); every theme is listed once (they were repeated); the window is as tall as the screen allows and the form scrolls as one piece (the rules were hidden below a small inner scroll); the ready-made rules show their whole description; "Skip to the result" is a real button; the preset chips show the colors of their theme; themes, presets and the numbers in Integrations have a smaller radius.
- About me: the "How it looks" box is gone (the profile card already shows it).
- Messages: the bar of actions over a message is anchored to the right edge for every message, springs in and its quick reactions grow under the pointer; while you type code only one preview shows (the code block); the formatted-text preview no longer repeats it.
- Friends: the tabs and count pills follow the corner style instead of being fully round, the search bar is flat (a line instead of a rounded box), list titles show a count pill instead of a dash, and Pending is two cards (received and sent) with their own icons and friendly empty states.
- Appearance: corner style is a folding section like its neighbours (with the shape of the chosen corner as its preview), motion speeds are Fast, Normal, Slow and Off, the bubble styles Pill and Floating became Gloss (a glossy 3D bubble) and Block (a hard-edged block with an offset shadow), and the cursor previews no longer blink when you choose one (they are still, and drawn once).
- Sounds: "Off" is translated as "Desactivado".

## 1.9.0

- Phones: the page height follows the visible area (it used to be taller than the screen, so the message box, the settings button and the end of pages hid behind the browser bar); the settings open as a list of sections with a back button (the strip that hid most sections is gone); the emoji picker is a sheet over the bottom; a tap on a message shows its actions; a long press opens the same menu as a right click (friends, messages and so on); setting rows wrap instead of overflowing; the Spinly window puts the form first with a small wheel.
- Call ringtones: a new "Automatic" ringtone (the default) that follows the season: Halloween in October, Christmas in December, New Year until the 6th of January and the classic one the rest of the year. All melodies were rewritten (a music box for the classic one, the full Jingle Bells, a haunted music box, the first lines of Auld Lang Syne) and every note now has an echo, so they sound like a room and not like a beep.
- Click sounds: choosing a click style played the sound twice; now once.
- Hover effects: icons no longer tilt. The tiles of the settings menu lift, glow in their own color and a band of light sweeps across them; flags lift with a soft shadow; the padlock of About rises.
- Corner style (Appearance): the preview is on top, as a small piece of the app (a message, a reply, an input and a button) that follows the slider, with a tile for each of the seven steps, the name in big letters and the slider with its guides.
- Spinly window: it keeps one size when switching between wheel and tournament (the form scrolls inside), the tabs have a sliding thumb, the wheel sits on a glow of its own colors and the themes are cards with their names. Spinly has its own wheel icon everywhere (it used to be a refresh arrow).
- Messages: when what you type looks like code, a preview shows it formatted, "It will be sent as code" (with a button to send it as plain text), and it is sent as a code block; more kinds of code are recognized (JSON, shell commands, Python blocks, prints).
- Friends: the tabs are pills inside the page (they used to be cut off at the right edge), with an icon and a count; Pending uses the same list as the friends, with round accept and decline buttons.
- Listen together: YouTube refused to play ("configuration error 153") because the player was embedded without telling YouTube who shows it; it now sends the referrer and the origin, and the player has the minimum size YouTube asks for.
- The text style button is now at the left of the message box (it used to be inside the "+" menu).

## 1.8.0

- Spinly is always the same Spinly (https://spinly-psi.vercel.app/): the address setting is gone, and so is "open in a window". Spinly is shown inside Chatterly, in its own panel; if it cannot load, the panel offers to try again.
- Linking the account is done inside that panel: sign in to Spinly there if you want your account and press "Use my themes and presets"; only the names and colors of your themes and presets come over.
- The window that makes a wheel or tournament is new: the wheel is drawn live while you build it, every option and participant is a row with its own color (pick any color), a name, and a remove button; you can paste a list, recolor everything from a theme, change the pointer and lights colors, pick Spinly's themes or your own, load your Spinly presets (with their colors), and the tournament rules are plain buttons and switches.
- The wheel now looks like Spinly's: same colors, rim with its wave of lights, hub, pointer and the names across each sector.
- About me (Settings, Profile): a tidier toolbar (bold, italic, strikethrough, a Color panel and a Gradient panel instead of a row of dots), a text box that grows as you write, a friendly placeholder, a counter that warns near the limit, "Clear styles", and a live "How it looks" preview.
- Spinly (the app): it answers Chatterly's request for the themes and presets (only from the page that framed it); the "&link=1" window mode is gone.
- Housekeeping: more dead strings out of the Spanish dictionary.

## 1.7.0

- Spinly is now part of Chatterly: wheels and tournaments are native, they do not need the Spinly app or its address, and anyone can use them.
- In a chat, the "+" menu opens a window to make a wheel (options one per line, a title, a theme) or a tournament (participants, best of N duels, third place, odds by seed) and sends it as a message, like a poll. Anyone in the conversation can run it, only once: it spins for everybody at the same time, lands on the same result everywhere and the result stays in the message. A tournament is started once and plays out duel by duel for everybody (or skips to the result).
- In a call, the Spinly button puts a wheel or a tournament right in the call screen for everybody. There everybody can spin it again, edit it, play the tournament duel by duel or all at once, start it over, send the result to the chat or close it. Late joiners get the current one. Everything travels inside the encrypted call signaling.
- Link your Spinly account in Settings, Integrations: Spinly hands over only the names and colors of your themes and presets, which then appear in the window that makes a wheel or tournament (presets fill in the options, themes color the wheel). The login never leaves Spinly. Two themes are built in for everybody.
- The whole Spinly app is still one click away ("Open the full Spinly" in the window, or Integrations) and its results still go to the chat. The old call mirroring of the framed Spinly is gone, replaced by the native wheel.
- Fixed the real spin being decided by whoever pressed: the result comes from a seed that nobody can choose beforehand (the random id the server gives the run).
- Spinly (the app): it can be opened to link the account (`&link=1`) and no longer carries the call mirroring code.
- Housekeeping: dead Spanish strings of removed features are gone from the dictionary, which also keeps the initial bundle under 500 kB.

## 1.6.0

- Spinly now lives inside Chatterly: the "+" menu of a chat and the Spinly button of a call open it in a large panel over the conversation (nothing of Spinly is copied here, it is the real app framed, with its own account and presets). "Send ... to the chat" posts the winner, and in a call "Show it to the call" shares it with everybody. If a Spinly does not allow being framed, the panel offers to open it in its own window. Spinly itself now accepts being framed by Chatterly.
- In a call, Spinly is shared with everybody without sharing the screen: when someone opens it the panel opens for the others too, and every spin of the wheel is replayed on their side with the same options, the same landing angle and the same winner (sent encrypted and signed like the rest of the call signaling). Tournaments are not mirrored live: their champion still goes to the chat. The call also opens the microphone more forgivingly (a missing chosen device no longer ends in "Constraints could not be satisfied").
- Settings menu: new order (profile, appearance, sounds and notifications, voice and video, stickers, language, integrations, privacy and security, about), no more small titles, a colored tile on every entry and thin lines between clusters.
- Sounds: every control of the settings menu has its sound; the sound keeps the chosen style but changes pitch and level with the importance of the button (main actions brighter, destructive lower, quiet icon buttons softer); sliders tick as they move, rising in pitch.
- Messages: the sent, delivered and read mark is a tiny dot beside the time (hover it for the word) instead of a caption; a message of one to three emoji is drawn big, without a bubble, with a springy pop (like WhatsApp); sent text is trimmed so a trailing line never makes a bubble taller; names no longer underline or glow on hover.
- The "End-to-end encrypted" label moved inside the shield button (its tooltip says it and whether the contact is verified); the group header uses the same shield.
- Friends page redone as a clean list: All is the first tab, a search box, rows with quick actions that appear on hover, and less rounded tabs and search.
- Members: the owner always stays first (nobody can be moved above them) and the list has more room under its title.
- Groups: more room above the group bar; the group menu has colored icons and descriptions; the status menu fits inside the side bar, no longer gets cut by the chat and opens with a stagger; the side bar text can no longer be selected by accident.
- Cursor: the system cursor no longer comes back in the gap between two items of a list that re-renders; more controls show the pointer on hover.
- Appearance: the shuffle menu has room to breathe, the custom color button is a multicolor wheel, the corner slider shows the name and size of the chosen step with tick marks, the old three names as a guide and a live sample.
- Language: cards with a big flag in a grid, and the time format in its own card. Ringtone cards use icons instead of emoji.
- About: a new animated logo (drawn stroke by stroke, a spinning star, ripples, orbiting sparks and a light sweep), a smaller name, more links (source, changelog, contributing) and the real GitHub address.
- Performance: the emoji, script and serif fonts are a separate stylesheet switched on when idle, so the initial bundle is under 500 kB again.
- The test output is in English, and the changelog now starts at the first upload.

## 1.5.0

- Chat: a message that is only a link no longer shows the link twice (the preview card replaces it). Messages that are clearly code are formatted as a code block automatically. YouTube players now work (they were refused for lacking a referrer). The "load videos automatically" option is gone: a video loads when you press play.
- The "Encrypted - key vN" label is now a lock button in the header (the tooltip says what it is and opens Privacy & security). Day separators ("Today", "Yesterday") and the About texts follow the language of the app.
- Message status is now a small word under your messages (Sent, Delivered, Read) that changes color as it travels, instead of the linked rings.
- Calls: the security code is eight digits ("1234 5678") instead of emoji, and it only appears in the "Verify this call" window, no longer on every tile.
- Ringtones: four melodies for incoming calls (Normal, Christmas, Halloween and New Year) and the option to upload your own sound (up to 2 MB and 30 seconds, kept on your device).
- Sounds are louder (more headroom plus a limiter so they never distort). Click sounds are down to Soft, Drop, Glass, Mechanical, Typewriter, Marimba and Kalimba (the last two are new, warm ones).
- Appearance: the typeface list is nine cards (System and the most used ones) with a last card to upload your own font, and the extra fonts are no longer bundled, so the page loads less. Corner style is a seven-step slider with the old names (Sharp, Soft, Round) as guides. Neon bubbles use a single color, and the previews of the other bubble styles no longer change when you pick one. Cursor shapes Prism and Tile are gone (they looked like the others).
- Name font: five fonts plus one to upload (only you see an uploaded font). Profile effects: ten distinct ones (Spin, Pulse, Orbit, Dashed, Double, Glow, Ticks, Glitch, Rainbow and None); all but Rainbow take two colors of your choice, saved in your profile.
- Profile: the About you section is redone with a status card and an editor with its toolbar on top.
- Friends page redone: pill tabs, a search box and cards with the friend's banner color and quick actions.
- Settings: the section list is grouped (Account, App, Calls & privacy, Chatterly); the version line under it is gone. About has the Jondals logo, principle cards and no copy button.
- Group settings: Save sits next to the name field, the "create channel" window opens on top of the settings window, and the placeholder is "General chat".
- The three buttons under your panel have a smooth hover; the status menu opens with an animation and no longer pushes the panel up.
- Collapsible sections open and fold smoothly and close when you press outside them. The emoji in the picker are bigger and only the emoji grows on hover.
- Project: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY and issue/pull request templates were added; the docs folder with screenshots was removed.
- The app version shown in Settings and About is 1.5.0.

## 1.4.0

- Spinly integration: the composer "+" menu now has "Spinly" instead of "Poll". It opens Spinly (https://spinly-psi.vercel.app/) in a pop-up, normal wheel or tournament, and the winner can be shared in the chat as a card. It works from a call too. Spinly is not part of Chatterly: only a small, origin-checked message bridge connects them, and Settings > Integrations shows whether your Spinly account (presets) is connected. The Spinly side (`src/scripts/chatterly-bridge.ts`) also plays the Chatterly tick and win sounds.
- Link previews with video (YouTube, Instagram, X...) are one block: the player on top, the link below. It plays on click, or at once if videos auto-load.
- Message status marks (sent, delivered, read) drawn as small elegant dots instead of ticks. Settings > Privacy has switches for the marks and for read receipts; turning receipts off hides your reads and theirs, and unread counts still work.
- Names and times in messages are bigger and more spaced; "End-to-end encrypted" and "Encrypted - key vN" moved to a quiet, less rounded label. The "Verified" tag is gone: the shield next to the name is marked instead.
- The group owner can drag members to reorder them.
- Clicking outside the settings menu closes it. No more background flash when moving between Home, groups and chats.
- Cursor: every state (links, text, busy, resize, drag...) is themed, none falls back to the Windows default.
- 12-hour time shows AM or PM after the time.
- Performance: pre-rendered login and register pages, inline critical CSS, delayed preloading of lazy routes and a stricter CSP; Lighthouse 100 on mobile and 100 on desktop for login and register.
- Code: all in English, a header comment in every script and a comment on functions, no lambda expressions, dead code removed (polls, unused helpers). One test: `pnpm test` or `test/chatterly-test.exe`.
- The app version shown in Settings and About is 1.4.0.

## 1.3.0

- Channels keep their order of arrival, and the group owner can reorder them: drag a channel up or down (text with text, voice with voice) or right-click it and pick "Move channel up/down". The order is saved on the server for everyone. The members list also follows order of arrival (no more reshuffling by online status).
- Cursor: the hover state is now the same arrow with a soft glow and a brighter fill (same hot spot, so it never jumps), and the two shapes cross-fade and scale smoothly instead of swapping. New "Cursor color" setting (also colors the trail), with a button to go back to the theme color.
- Emoji picker: bigger emoji (7 columns, larger glyphs) and a soft hover that only scales the emoji instead of a big button.
- Closing Settings no longer fades the dark backdrop away to the bare animated background; only the content fades.
- The channel sidebar has more color: a tinted group header, accent-colored text channels, a second color for voice channels, and colored hover and active rows.
- Appearance: the cursor try-it area is gone, and the collapsible sections are spaced apart with roomier headers.
- Cursor: the custom cursor and trail now go back on top whenever a menu, picker or dialog opens (checked after every click, key press and now and then while moving), so they never end up under the browser top layer.
- Cursor: over browser extensions and password-manager panels (iframes the page cannot track) the system cursor is shown again, so you can see and click them; the custom cursor comes back as soon as you return to the page. The cursor no longer re-checks the top layer while moving.
- Fixed: opening the site at the root (`/`) while signed out left the login box empty; it now goes to the login. The test covers it.
- Settings now open on top of the screen you were on (a secondary route), so the chat or call behind stays visible instead of vanishing; switching sections never touches it.
- Profile: the display name moved into "Name style" with its own row, pronouns are gone, the status has an emoji picker, "About me" allows 1000 characters and has the same 3 colours, 3 gradients and custom gradient as the chat (the caret lands inside the tag so you can type right away). The unsaved-changes bar now sticks to the bottom of the screen with Save and Reset side by side.
- Themes: Slate removed; the custom theme can now also set panels, text, soft text and the second accent.
- Hovers use a gentler curve and last longer; the cursor trails are shorter and drawn segment by segment, so they never glitch when they cross themselves.
- Sounds are much louder, with separate Effects and Music volume (Music controls YouTube; Spotify has its own volume). The upload icon is a cloud with an arrow.
- About: the closing line is replaced by an animated GitHub link (a lock that opens). The shared-media panel in direct chats is gone; "End-to-end encrypted" and "Encrypted - key vN" now link to Privacy & security; image and GIF captions appear as an overlay on hover; chat names light up on hover and the time is brighter with more space.
- The status menu opens right above your panel instead of jumping.
- Twelve chat bubble styles (new: Glass, Neon, Leaf, Ticket, Floating, Dashed).
- New colour picker window: bigger square, vertical hue bar, eyedropper, HEX and R/G/B fields, in the style of the site, and you can drag it anywhere by its title bar.
- Mouse wheel over any slider moves it one step up or down.
- The app version shown in Settings and About is 1.3.0.

## 1.2.0

- Comet, ribbon and rainbow trails are drawn as one smooth shape (no more beads); new Prism cursor; the custom cursor and trail now sit on the browser's top layer, so menus and pickers no longer cover them, and message text no longer hides them; the `+` menu icons no longer rotate.
- Cursor menu redesigned: a try-it area, shapes first, then behaviour rows; the pulsing outline is subtle and the trail has separate thickness and length sliders. About shows the technology logos; the composer `+` menu has coloured icons and descriptions.
- Cursor settings tidied into rows (animation, trail picker, trail size slider, cursor size); the animation is now an outline that pulses around the whole cursor shape instead of a ring at the tip.
- Composer: Ctrl+Z undoes and Ctrl+Y (or Ctrl+Shift+Z) redoes, also after formatting or inserting emoji; picking a colour with no text leaves the cursor inside it ready to type; the link bar is one slim line and the format preview no longer appears just for a link; bigger emoji; the user panel has two roomier rows.
- Cursors v2: pointer families that match the site (Themed, Soft, Glass, Tile, Halo, Classic), a Static/Animated switch for every one, adjustable size (16-56 px) and a separate trail picker with 8 smooth trails (comet, ribbon, glow, ink, rainbow, stardust, bubbles, fire). The trail now comes out of the body of the cursor, not from its tip.
- Link previews are opt-in per message: type a link and choose "Add preview". The server opens the link once (https only, private addresses blocked) and the card travels inside the encrypted message. YouTube and Spotify use their official oEmbed, so they work too.
- Messages show the name first, then the time; clicking your name opens your profile settings, clicking someone else's opens their profile card. New Settings > Language > Time format (Automatic, 12 h, 24 h).
- Right-click a channel to rename or delete it (owner only); six bubble styles; pop-up notices are smaller, shorter and can be turned off; after a call you return to the screen you were on; the composer shrinks back after sending long text; code blocks no longer show lines when selected.
- Backgrounds: shuffle mode, a configurable solid colour, more scenes; 8 more typefaces and 6 more themes plus a custom theme from one colour.
- Polls (encrypted, votes are encrypted reactions), right-click menus (messages, groups, friends), friend nicknames that only you see, and listening to a YouTube or Spotify link together in a call.
- Login and register share one frame (no reload between them); the route loop that froze the page when already signed in is fixed. Lightweight particle background that reacts to the mouse (no trails, no parallax), much darker.
- Composer: one `+` menu on the right (attach, voice note, poll, text style and colours), 3 colours + 3 gradients + 1 custom gradient, opaque emoji picker with smaller cells, tidier message hover menu.
- Backgrounds: shuffle mode (on every reload or every N minutes) plus new scenes; solid first; waves and nebula redone.
- Cursors: new nicer presets (orb, sleek), cursors with trails (comet, ribbon, stardust), smaller size, and your own `.cur`, `.ani` and animated GIF/WebP cursors.
- Profile: name style above "About you", which now has formatting buttons and a live preview. Settings open and close with a fade. Custom accent colour is labelled.
- Soundboard opens centred, new softer built-in sounds and a general volume reduction; calm mute and deafen sounds.
- Calls: the lobby is gone; when a call ends you go back to the home screen. Channel names show as readable text ("Chat general").
- Security: refresh-token reuse detection, `Cache-Control: no-store`, `Permissions-Policy`.
- Every source file now starts with a comment saying what it does.

- Earlier in this release line: auth screens back to the original look with an animated particle network; colour picker fixed (it opened off-screen inside the chat; panels now use the browser top layer); gradients for the name colour and a custom gradient builder in the chat; density option removed; 9 more click sounds; 8 more animated backgrounds; cursor presets reworked and uploaded cursors are named entries; global tooltips that never get clipped; call grid sizes tiles to the available height and any participant can be pinned; About redesigned; GIFs through GIPHY (+ optional Tenor) merged; refresh-token reuse detection, `Cache-Control: no-store` and `Permissions-Policy` on the API; `pnpm app` serves the production build.

## 1.1.0

- End-to-end encrypted calls (voice and video frames), with a security code to verify.
- New interface: less rounded, themed cursor, UI sounds, smoother hovers, blurred animated background, settings menu, languages, animated credit.
- Profile pictures, banners and group icons are uploaded images; fonts and more profile options.
- Text and voice channel creation, own emoji picker, coloured text, GIF picker (GIPHY, needs `GIPHY_API_KEY`), stickers with WhatsApp import. Guilds are now called groups.
- Fix: the production build lost all styles under the strict CSP (critical CSS inlining uses an inline handler); it is now disabled.
- Fix: Tenor discontinued its API, so GIFs now use GIPHY.
- Performance: no backdrop blur anywhere and a GPU-only animated background (11 scenes, faster and more visible, blur softens the shapes); menus no longer stutter.
- Own colour picker with eyedropper that works in every browser (screen-capture fallback), used everywhere a colour is chosen.
- Banner gradients with opacity, 13 name fonts, 15 avatar rings, 5 more themes, 5 more interface fonts; fonts, themes, backgrounds and cursors are compact dropdowns with previews.
- Cursor presets (ring, dot, pixel, neon) and your own uploaded cursor.
- Mute and deafen work outside calls; soundboard reachable from the left bar with uploadable sounds; call screen redesigned (fixed 16:9 tiles that never jump, side drawer for chat, media and stats); voice lobby redesigned.
- Old login look restored; right click blocked; copy works when the clipboard API is blocked; search palette removed; fixed stray horizontal scrollbars and green pixels.
- All previous tests were replaced by a single self-cleaning test (`pnpm test`).

## 1.0.0 — Chatterly-Renewed 2026-09-04

First complete release.

- Zero-knowledge accounts (PBKDF2 → HKDF split, scrypt on the server, wrapped ECDH/ECDSA identity keys).
- End-to-end encrypted, signed direct messages and guild channels with group-key rotation.
- Encrypted attachments, voice notes, reactions, replies, edits, typing indicators.
- Friends, presence, guilds, voice channels and DM calls over full-mesh WebRTC with encrypted, signed signaling.
- Spatial audio, live call telemetry, screen sharing, soundboard.
- Angular 21 / Tailwind 4 UI with animated backgrounds, accent themes and aura frames.
- 117 automated tests plus a Playwright browser smoke test.

## 0.4.0 - 2026-05-23

- The three packages (root, backend and frontend) moved from npm to pnpm, with workspace files and a lockfile for each.

## 0.3.0 - 2026-05-16

- The signed-in layout: a social bar (friends and direct messages) and a user bar (avatar, status and quick settings). The first components were removed and rewritten around the new main layout.

## 0.2.0 - 2026-05-14

- Sign-in and registration pages rebuilt with Tailwind, and an auth guard that keeps signed-out visitors away from the private area.

## 0.1.0 - 2026-05-05

- First upload: the Angular frontend and the Fastify backend that later became Chatterly-Renewed.
