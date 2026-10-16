/**
 * src/app/core/services/overlay.service.ts
 * The in-game overlay (desktop app only), like the one of Discord: while you are in a call it tells the desktop shell who is
 * there (name, picture, who talks, who is muted or live), the state of the call for its controls, the screens other people
 * share and the messages that arrive, and it sends the video of the cameras and of those screens to the overlay window, a
 * transparent window that stays on top of your game. The buttons of the overlay (mute, deafen, camera, screen, hang up, open a
 * message, the volume of a stream) come back here and do what the same buttons of the app do.
 *
 * * The video does not leave the computer: the overlay window is another window of the app, and a MediaStream cannot be handed
 *   to another window, so the two connect with WebRTC on this machine (no STUN, no TURN, no network). The frames are already
 *   decrypted here, travel inside the computer and stop in the overlay. This connection is separate from the calls and never
 *   touches their relay-only policy.
 * ! Only pictures made small here and fixed shapes cross over; the shell checks every one of them again, and it passes an
 *   action of the overlay only while the overlay is unlocked (the person is there, with the mouse on it). A message is opened
 *   by an id that only this page knows the meaning of: the overlay never names a chat.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  desktopBridge,
  type DesktopOverlay,
  type OverlayAction,
  type OverlayCall,
  type OverlayEvent,
  type OverlaySettings,
  type OverlayState,
  type OverlayStream,
  type OverlayTile,
} from '../desktop-bridge';
import type { ChannelRef } from '../models';
import { AuthService } from './auth.service';
import { CallService } from './call.service';
import { DirectoryService } from './directory.service';
import { ImageService } from './image.service';
import { SettingsService } from './settings.service';
import { MessageStore } from '../../store/message.store';
import { GuildStore } from '../../store/guild.store';
import { SocialStore } from '../../store/social.store';

/** The size of the small pictures sent to the overlay. */
const AVATAR_PIXELS = 96;
/** What the video of a camera tile is limited to: a tile never needs more. */
const VIDEO_BITRATE = 600_000;
const VIDEO_FPS = 24;
/** A shared screen in the overlay is a thumbnail: small, light and a little slower. */
const SCREEN_BITRATE = 700_000;
const SCREEN_FPS = 12;
/** How many messages the overlay can still open. */
const MAX_NOTICES = 20;

const INITIAL: OverlayState = {
  settings: {
    enabled: true,
    hotkey: 'CommandOrControl+Shift+O',
    size: 'medium',
    opacity: 100,
    onlySpeaking: false,
    showSelf: true,
    showNames: true,
    hideFromCapture: false,
    display: 'primary',
    mode: 'always',
    games: [],
    notifyText: true,
    x: 0.02,
    y: 0.42,
    scale: 1,
    videoPinned: true,
    widgets: {
      notifications: { x: 0.02, y: 0.03, pinned: true },
      voice: { x: 0.02, y: 0.24, pinned: true },
      controls: { x: 0.36, y: 0.8, pinned: false },
      activity: { x: 0.8, y: 0.44, pinned: false },
      streams: { x: 0.8, y: 0.6, pinned: true },
    },
  },
  editing: false,
  hotkeyOk: true,
  running: false,
};

/** One video sent to the overlay: our stream (the id the overlay knows it by) and the sender that carries it. */
interface Outgoing {
  stream: MediaStream;
  track: MediaStreamTrack;
  sender: RTCRtpSender;
}

/** The overlay of the desktop app: its choices, and what the page feeds it during a call. */
@Injectable({ providedIn: 'root' })
export class OverlayService {
  private readonly bridge: DesktopOverlay | undefined = desktopBridge()?.overlay;
  private readonly auth = inject(AuthService);
  private readonly call = inject(CallService);
  private readonly directory = inject(DirectoryService);
  private readonly images = inject(ImageService);
  private readonly settings = inject(SettingsService);
  private readonly messages = inject(MessageStore);
  private readonly guilds = inject(GuildStore);
  private readonly social = inject(SocialStore);

  /** True inside the desktop app. */
  readonly supported = Boolean(this.bridge);
  readonly state = signal<OverlayState>(INITIAL);

  /** Small pictures already made, by the address of the original. */
  private readonly avatars = signal<Record<string, string>>({});
  private readonly avatarsAsked = new Set<string>();
  private connection: RTCPeerConnection | null = null;
  /** The videos sent: the camera of a person by their id, the screen they share by 'screen:' and their id. */
  private readonly outgoing = new Map<string, Outgoing>();
  /** The last lists sent to the shell (to send them again only when they change). */
  private lastSent = '';
  private lastCall = '';
  /** The chats the messages shown in the overlay belong to, by the id the overlay knows them by. */
  private readonly notices = new Map<string, ChannelRef>();
  private lastNotice = 0;

  constructor() {
    if (!this.bridge) {
      return;
    }
    this.bridge.onEvent(this.onEvent.bind(this));
    this.bridge.get().then(this.apply.bind(this), this.ignore);
    effect(this.loadAvatars.bind(this));
    effect(this.feed.bind(this));
    effect(this.forwardMessage.bind(this));
  }

  /** Changes some choices. The shell checks and keeps them. */
  set(patch: Partial<OverlaySettings>): void {
    if (this.bridge) {
      this.bridge.set(patch).then(this.apply.bind(this), this.ignore);
    }
  }

  /** The names of the windows that are open now. */
  async openWindows(): Promise<string[]> {
    try {
      return (await this.bridge?.windows()) ?? [];
    } catch {
      return [];
    }
  }

  /** Registers a game (the name of its window, or part of it). */
  addGame(name: string): void {
    const games = this.state().settings.games;
    this.set({ games: [...games, name.trim()] });
  }

  /** Stops using the overlay with a game. */
  removeGame(name: string): void {
    this.set({
      games: this.state().settings.games.filter(function keep(game) {
        return game !== name;
      }),
    });
  }

  // ── What the page tells the shell ──────────────────────────────────────────────────────────────

  /** True while there is a call to show. */
  private active(): boolean {
    return this.state().settings.enabled && this.call.status() === 'connected';
  }

  /** The people of the call as the overlay draws them, with the id of their camera stream in the local connection. */
  private buildTiles(): OverlayTile[] {
    if (!this.active()) {
      return [];
    }
    const settings = this.state().settings;
    const me = this.auth.userId;
    const speaking = this.call.speaking();
    const peers = this.call.peers();
    const tiles: OverlayTile[] = [];
    const alone = this.alone();
    for (const participant of this.call.participants()) {
      const isMe = participant.userId === me;
      if (isMe && !settings.showSelf && !alone) {
        continue;
      }
      const person = this.personOf(participant.userId);
      tiles.push({
        id: participant.userId,
        ...person,
        speaking: speaking.has(participant.userId),
        muted: participant.muted,
        deafened: participant.deafened,
        camera: participant.video,
        screen: participant.screen,
        streamId: this.streamIdOf(
          participant.userId,
          isMe ? this.call.localCamera() : (peers[participant.userId]?.camera ?? null),
        ),
      });
    }
    return tiles;
  }

  /** The name, small picture and color of a person. */
  private personOf(userId: string): { name: string; avatar: string; color: string } {
    const user = this.directory.users().get(userId);
    const picture = this.images.url(user?.avatarImage ?? null);
    return {
      name: user?.displayName ?? user?.username ?? '',
      avatar: (picture && this.avatars()[picture]) || '',
      color: user?.avatarColor ?? '#2ef2b0',
    };
  }

  /** The call as the controls draw it. */
  private buildCall(): OverlayCall | null {
    if (!this.active()) {
      return null;
    }
    const me = this.auth.userId;
    const mine = this.call.participants().find(function isMe(participant) {
      return participant.userId === me;
    });
    const video = this.call.participants().some(function hasVideo(participant) {
      return participant.video || participant.screen;
    });
    return {
      room: this.roomName(),
      since: mine?.joinedAt ?? 0,
      muted: this.call.muted(),
      deafened: this.call.deafened(),
      camera: this.call.cameraOn(),
      screen: this.call.screenOn(),
      video,
      ping: this.call.stats().rttMs ?? -1,
    };
  }

  /** The name of the call: the person of a direct call, or the voice channel. */
  private roomName(): string {
    const id = this.call.roomId();
    if (!id) return '';
    const dm = this.social.dmByChannel(id);
    if (dm) return this.directory.get(dm.userId)?.displayName ?? '';
    return this.guilds.channel(id)?.name ?? '';
  }

  /** The screens other people share, with their volume for this device. */
  private buildStreams(): OverlayStream[] {
    if (!this.active()) {
      return [];
    }
    const peers = this.call.peers();
    const sound = this.call.screenSound();
    const volumes = this.settings.screenVolumes();
    const out: OverlayStream[] = [];
    for (const [userId, peer] of Object.entries(peers)) {
      if (!peer.screen) continue;
      out.push({
        id: userId,
        name: this.personOf(userId).name,
        streamId: this.streamIdOf('screen:' + userId, peer.screen),
        sound: sound[userId] === true,
        volume: volumes[userId] ?? 100,
      });
    }
    return out;
  }

  /**
   * True when nobody else is in the call. Then you see yourself in the overlay: otherwise it would have nobody to draw and
   * would not appear at all.
   */
  private alone(): boolean {
    const me = this.auth.userId;
    return !this.call.participants().some(function other(participant) {
      return participant.userId !== me;
    });
  }

  /** The id of the stream that carries a video to the overlay ('' when there is no live video). */
  private streamIdOf(key: string, media: MediaStream | null): string {
    const track = media?.getVideoTracks().find(this.isLive) ?? null;
    const known = this.outgoing.get(key);
    if (!track) {
      return '';
    }
    return known && known.track === track ? known.stream.id : '';
  }

  private isLive(track: MediaStreamTrack): boolean {
    return track.readyState === 'live';
  }

  /** Makes the small picture of everybody who has one (once per picture). */
  private loadAvatars(): void {
    for (const user of this.directory.users().values()) {
      const url = this.images.url(user.avatarImage);
      if (url && !this.avatarsAsked.has(url)) {
        this.avatarsAsked.add(url);
        void this.shrink(url);
      }
    }
  }

  /** Draws a picture at AVATAR_PIXELS and keeps it as a data address. */
  private async shrink(url: string): Promise<void> {
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_PIXELS;
      canvas.height = AVATAR_PIXELS;
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const context = canvas.getContext('2d');
      if (!context || side === 0) {
        return;
      }
      context.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        AVATAR_PIXELS,
        AVATAR_PIXELS,
      );
      const data = canvas.toDataURL('image/jpeg', 0.8);
      this.avatars.update(function add(all) {
        return { ...all, [url]: data };
      });
    } catch {
      // The picture is not drawn in the overlay: the initials are shown instead.
    }
  }

  /** Keeps the videos that go to the overlay up to date, and sends the people, the call and the streams when they change. */
  private feed(): void {
    // The cameras and screens that change are read here so the effect follows them.
    const peers = this.call.peers();
    const local = this.call.localCamera();
    const settings = this.state().settings;
    const connected = this.active();
    untracked(this.syncVideo.bind(this, connected, peers, local, settings.showSelf));
    const list = this.buildTiles();
    const text = JSON.stringify(list);
    if (text !== this.lastSent && this.bridge) {
      this.lastSent = text;
      this.bridge.setTiles(list).catch(this.ignore);
    }
    const scene = { call: this.buildCall(), streams: this.buildStreams() };
    const sceneText = JSON.stringify(scene);
    if (sceneText !== this.lastCall && this.bridge?.setCall) {
      this.lastCall = sceneText;
      this.bridge.setCall(scene).catch(this.ignore);
    }
  }

  // ── The messages that arrive ───────────────────────────────────────────────────────────────────

  /** A message arrived while its chat was not in view: the overlay shows who wrote it (and what, if the person wants). */
  private forwardMessage(): void {
    const incoming = this.messages.lastIncoming();
    if (!incoming || incoming.seq === this.lastNotice) {
      return;
    }
    this.lastNotice = incoming.seq;
    if (!this.active() || !this.bridge?.notify) {
      return;
    }
    untracked(this.sendNotice.bind(this, incoming));
  }

  private sendNotice(incoming: NonNullable<ReturnType<MessageStore['lastIncoming']>>): void {
    const id = 'n' + incoming.seq;
    this.notices.set(id, incoming.ref);
    while (this.notices.size > MAX_NOTICES) {
      this.notices.delete(this.notices.keys().next().value as string);
    }
    const person = this.personOf(incoming.senderId);
    this.bridge!.notify!({
      id,
      name: person.name,
      avatar: person.avatar,
      color: person.color,
      where: incoming.ref.kind === 'guild' ? '#' + incoming.ref.name : '',
      text: incoming.text,
    }).catch(this.ignore);
  }

  // ── What the buttons of the overlay ask ────────────────────────────────────────────────────────

  /** A button of the overlay was pressed (the shell passed it: the overlay was unlocked). It does what the app's button does. */
  private onAction(action: OverlayAction): void {
    if (this.call.status() !== 'connected' && action.type !== 'open-chat') {
      return;
    }
    switch (action.type) {
      case 'mute':
        this.call.toggleMute();
        break;
      case 'deafen':
        this.call.toggleDeafen();
        break;
      case 'camera':
        void this.call.toggleCamera();
        break;
      case 'screen':
        void this.call.toggleScreen();
        break;
      case 'leave':
        void this.call.leave();
        break;
      case 'open-chat': {
        const ref = this.notices.get(action.id);
        if (ref) this.messages.openChannel(ref);
        break;
      }
      case 'stream-volume':
        if (this.call.peers()[action.id]) this.call.setScreenVolume(action.id, action.volume);
        break;
    }
  }

  // ── The video to the overlay ───────────────────────────────────────────────────────────────────

  /** Adds the cameras and screens that are live and removes the ones that stopped. */
  private syncVideo(
    connected: boolean,
    peers: ReturnType<CallService['peers']>,
    local: MediaStream | null,
    showSelf: boolean,
  ): void {
    const wanted = new Map<string, { track: MediaStreamTrack; screen: boolean }>();
    if (connected) {
      const me = this.auth.userId;
      const alone = this.alone();
      for (const participant of this.call.participants()) {
        const camera =
          participant.userId === me
            ? showSelf || alone
              ? local
              : null
            : peers[participant.userId]?.camera;
        const track = camera?.getVideoTracks().find(this.isLive);
        if (track) {
          wanted.set(participant.userId, { track, screen: false });
        }
      }
      for (const [userId, peer] of Object.entries(peers)) {
        const track = peer.screen?.getVideoTracks().find(this.isLive);
        if (track) {
          wanted.set('screen:' + userId, { track, screen: true });
        }
      }
    }
    for (const [key, known] of [...this.outgoing]) {
      if (wanted.get(key)?.track !== known.track) {
        this.dropVideo(key);
      }
    }
    if (!this.connection) {
      return;
    }
    for (const [key, item] of wanted) {
      if (!this.outgoing.has(key)) {
        this.addVideo(this.connection, key, item.track, item.screen);
      }
    }
  }

  /** Sends one video to the overlay (small and light). */
  private addVideo(
    pc: RTCPeerConnection,
    key: string,
    track: MediaStreamTrack,
    screen: boolean,
  ): void {
    const stream = new MediaStream();
    const sender = pc.addTrack(track, stream);
    this.outgoing.set(key, { stream, track, sender });
    const parameters = sender.getParameters();
    if (!parameters.encodings || parameters.encodings.length === 0) {
      parameters.encodings = [{}];
    }
    parameters.encodings[0]!.scaleResolutionDownBy = screen ? 3 : 2;
    parameters.encodings[0]!.maxBitrate = screen ? SCREEN_BITRATE : VIDEO_BITRATE;
    parameters.encodings[0]!.maxFramerate = screen ? SCREEN_FPS : VIDEO_FPS;
    sender.setParameters(parameters).catch(this.ignore);
  }

  /** Stops sending one video. */
  private dropVideo(key: string): void {
    const known = this.outgoing.get(key);
    this.outgoing.delete(key);
    if (known && this.connection && this.connection.signalingState !== 'closed') {
      this.connection.removeTrack(known.sender);
    }
  }

  /** The overlay window is ready (or came back): open a fresh local connection and offer the videos. */
  private openConnection(): void {
    this.closeConnection();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.connection = pc;
    pc.onicecandidate = this.onCandidate.bind(this);
    pc.onnegotiationneeded = this.offer.bind(this, pc);
    // The videos are added again on the new connection; their ids change, so the lists are sent again.
    this.lastSent = '';
    this.lastCall = '';
    this.feed();
  }

  /** Throws the local connection away. */
  private closeConnection(): void {
    this.outgoing.clear();
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
  }

  private onCandidate(event: RTCPeerConnectionIceEvent): void {
    if (event.candidate && this.bridge) {
      this.bridge.signal({ candidate: event.candidate.toJSON() }).catch(this.ignore);
    }
  }

  /** Offers the videos to the overlay (it only ever answers, so the two never offer at the same time). */
  private async offer(pc: RTCPeerConnection): Promise<void> {
    if (pc !== this.connection || !this.bridge) {
      return;
    }
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.localDescription) {
        await this.bridge.signal({ offer: pc.localDescription.toJSON() });
      }
    } catch {
      // The connection was closed meanwhile.
    }
  }

  /** What the shell says: a new state, the overlay window opened or closed, an answer of the local connection, a button. */
  private onEvent(event: OverlayEvent): void {
    switch (event.type) {
      case 'state':
        this.apply(event.state);
        break;
      case 'ready':
        this.openConnection();
        break;
      case 'closed':
        this.closeConnection();
        this.lastSent = '';
        this.lastCall = '';
        break;
      case 'signal':
        void this.onSignal(event.message);
        break;
      case 'action':
        this.onAction(event.action);
        break;
    }
  }

  private async onSignal(message: {
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }): Promise<void> {
    const pc = this.connection;
    if (!pc) {
      return;
    }
    try {
      if (message.answer) {
        await pc.setRemoteDescription(message.answer);
      } else if (message.candidate) {
        await pc.addIceCandidate(message.candidate);
      }
    } catch {
      // A late message of a connection that no longer exists.
    }
  }

  private apply(next: OverlayState | null): void {
    if (next) {
      this.state.set(next);
    }
  }

  private ignore(): void {
    // The shell did not answer: the page keeps what it had.
  }
}
