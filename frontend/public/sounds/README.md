# Sounds of Chatterly-Renewed

Every sound of the app is a file in this folder, organised by what it is for. **To change one, replace the file with
another one of the same name** (OGG, MP3 and WAV all work; if the extension changes, change it too in
`frontend/src/app/core/sound-library.ts`, the only place that lists them). Nothing else needs to change.

The files start loading when the page starts (before any press), once, and are kept by the browser (a week). They are small on
purpose: every sound is an OGG Vorbis file (the best format for the web at this size: about 4 to 6 KB for an interface sound, 30 to 80 KB for a ringtone, 300 KB in all).

**Loudness:** the sounds of the interface are quiet before the volume of the settings is applied (about −38 dB). If a
sound you add is louder than the others, lower its `trim` in `sound-library.ts` (1 = as it is, 0.5 = half as loud).

## `ui/` — the interface

| File                   | When it plays                                         |
| ---------------------- | ----------------------------------------------------- |
| `message-received.ogg` | A message arrives in a chat you are not looking at    |
| `message-sent.ogg`     | You send a message                                    |
| `menu-open.ogg`        | A menu opens                                          |
| `toggle-switch.ogg`    | A switch is turned on or off                          |
| `notice-success.ogg`   | Something went well (copied, saved…)                  |
| `notice-error.ogg`     | Something went wrong                                  |
| `click-*.ogg`         | The sound of pressing a button; one file per style, chosen in Settings > Sounds. The same sound is the tick of a slider (higher as the slider goes up). |

## `call/` — calls

| File                       | When it plays                                  |
| -------------------------- | ---------------------------------------------- |
| `you-join.ogg`             | You join a call                                |
| `you-leave.ogg`            | You hang up                                    |
| `user-joined.ogg`          | Somebody else joins your call                  |
| `user-left.ogg`            | Somebody else leaves your call                 |
| `mic-mute.ogg`             | You mute your microphone                       |
| `mic-unmute.ogg`           | You unmute your microphone                     |
| `headphones-deafen.ogg`    | You deafen (stop hearing the call)             |
| `headphones-undeafen.ogg`  | You hear the call again                        |

## `ringtones/` — the default ringtones (they repeat while a call rings)

`classic.ogg`, `christmas.ogg`, `halloween.ogg` and `newyear.ogg`. The pause between repetitions is `gap` in
`sound-library.ts`. The person can also upload their own ringtone in Settings > Sounds & notifications.

`secret.ogg` is a joke tone that cannot be chosen anywhere: an incoming call rings with it once in ten thousand (`SECRET_RING_CHANCE` in `sound.service.ts`).

## `auth/` — the animations of arriving (each file is the whole soundtrack of its animation)

| File                     | Animation                                          |
| ------------------------ | -------------------------------------------------- |
| `intro.ogg`              | The introduction when the page opens               |
| `sign-in-unlock.ogg`     | Signing in: the padlock opens                      |
| `sign-out-lock.ogg`      | Signing out: the padlock shuts                     |
| `sign-up-fireworks.ogg`  | Creating an account: the fireworks                 |

## `soundboard/` — the default effects of the soundboard of a call

`air-horn`, `boing`, `sad-trombone`, `ta-da`, `rimshot` and `applause`: the six effects that come with the app. The rest of the soundboard is the
person's own sounds, kept on their device. Everybody in the call hears the one that is played.

## Origin and licence

The four button clicks `ui/click-tap.ogg`, `click-switch.ogg`, `click-pluck.ogg` and `click-bubble.ogg` are from
"Interface Sounds" by Kenney (<https://www.kenney.nl>), Creative Commons Zero (CC0). All the other files were generated
for this project (synthesised and rendered to files) and are covered by the licence of the project.
