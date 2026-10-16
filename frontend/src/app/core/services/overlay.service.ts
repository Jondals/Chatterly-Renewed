/**
 * src/app/core/services/overlay.service.ts
 * The in-game overlay (desktop app only): while you are in a call it tells the desktop shell who is there (name, picture, who
 * is talking) and sends the video of their cameras to the overlay window, a transparent window that stays on top of your game.
 *
 * * The video does not leave the computer: the overlay window is another window of the app, and a MediaStream cannot be handed
 *   to another window, so the two connect with WebRTC on this machine (no STUN, no TURN, no network). The frames are already
 *   decrypted here, travel inside the computer and stop in the overlay. This connection is separate from the calls and never
 *   touches their relay-only policy.
 * ! Only pictures made small here and fixed shapes cross over; the shell checks every one of them again.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  desktopBridge,
  type DesktopOverlay,
  type OverlayEvent,
  type OverlaySettings,
  type OverlayState,
  type OverlayTile,
} from '../desktop-bridge';
import { AuthService } from './auth.service';
import { CallService } from './call.service';
import { DirectoryService } from './directory.service';
import { ImageService } from './image.service';

/** The size of the small pictures sent to the overlay. */
const AVATAR_PIXELS = 96;
/** What the video of a tile is limited to: a tile never needs more. */
const VIDEO_BITRATE = 600_000;
const VIDEO_FPS = 24;

const INITIAL: OverlayState = {
  settings: {
    enabled: true,
    hotkey: 'CommandOrControl+Shift+O',
    size: 'medium',
    opacity: 100,
    onlySpeaking: false,
    showSelf: false,
    showNames: true,
    hideFromCapture: true,
    display: 'primary',
    mode: 'always',
    games: [],
    x: 0.02,
    y: 0.08,
    scale: 1,
  },
  editing: false,
  hotkeyOk: true,
  running: false,
};

/** One camera sent to the overlay: our stream (the id the overlay knows it by) and the sender that carries it. */
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

  /** True inside the desktop app. */
  readonly supported = Boolean(this.bridge);
  readonly state = signal<OverlayState>(INITIAL);

  /** Small pictures already made, by the address of the original. */
  private readonly avatars = signal<Record<string, string>>({});
  private readonly avatarsAsked = new Set<string>();
  private connection: RTCPeerConnection | null = null;
  private readonly outgoing = new Map<string, Outgoing>();
  /** The last list sent to the shell (to send it again only when it changes). */
  private lastSent = '';

  constructor() {
    if (!this.bridge) {
      return;
    }
    this.bridge.onEvent(this.onEvent.bind(this));
    this.bridge.get().then(this.apply.bind(this), this.ignore);
    effect(this.loadAvatars.bind(this));
    effect(this.feed.bind(this));
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

  /** The people of the call as the overlay draws them, with the id of their stream in the local connection (nobody when the overlay is off or there is no call). */
  private buildTiles(): OverlayTile[] {
    const settings = this.state().settings;
    if (!settings.enabled || this.call.status() !== 'connected') {
      return [];
    }
    const me = this.auth.userId;
    const users = this.directory.users();
    const speaking = this.call.speaking();
    const peers = this.call.peers();
    const avatars = this.avatars();
    const tiles: OverlayTile[] = [];
    const alone = this.alone();
    for (const participant of this.call.participants()) {
      const isMe = participant.userId === me;
      if (isMe && !settings.showSelf && !alone) {
        continue;
      }
      const user = users.get(participant.userId);
      const picture = this.images.url(user?.avatarImage ?? null);
      tiles.push({
        id: participant.userId,
        name: user?.displayName ?? user?.username ?? '',
        avatar: (picture && avatars[picture]) || '',
        color: user?.avatarColor ?? '#2ef2b0',
        speaking: speaking.has(participant.userId),
        muted: participant.muted,
        streamId: this.streamIdOf(
          participant.userId,
          isMe ? this.call.localCamera() : (peers[participant.userId]?.camera ?? null),
        ),
      });
    }
    return tiles;
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

  /** The id of the stream that carries the camera of a person to the overlay ('' when they have no live camera). */
  private streamIdOf(userId: string, camera: MediaStream | null): string {
    const track = camera?.getVideoTracks().find(this.isLive) ?? null;
    const known = this.outgoing.get(userId);
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

  /** Keeps the cameras that go to the overlay up to date, and sends the list of people when it changes. */
  private feed(): void {
    // The cameras that change are read here so the effect follows them.
    const peers = this.call.peers();
    const local = this.call.localCamera();
    const settings = this.state().settings;
    const connected = this.call.status() === 'connected' && settings.enabled;
    untracked(this.syncVideo.bind(this, connected, peers, local, settings.showSelf));
    const list = this.buildTiles();
    const text = JSON.stringify(list);
    if (text !== this.lastSent && this.bridge) {
      this.lastSent = text;
      this.bridge.setTiles(list).catch(this.ignore);
    }
  }

  // ── The video to the overlay ───────────────────────────────────────────────────────────────────

  /** Adds the cameras that are live and removes the ones that stopped. */
  private syncVideo(
    connected: boolean,
    peers: ReturnType<CallService['peers']>,
    local: MediaStream | null,
    showSelf: boolean,
  ): void {
    const wanted = new Map<string, MediaStreamTrack>();
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
          wanted.set(participant.userId, track);
        }
      }
    }
    for (const [userId, known] of [...this.outgoing]) {
      if (wanted.get(userId) !== known.track) {
        this.dropVideo(userId);
      }
    }
    if (!this.connection) {
      return;
    }
    for (const [userId, track] of wanted) {
      if (!this.outgoing.has(userId)) {
        this.addVideo(this.connection, userId, track);
      }
    }
  }

  /** Sends one camera to the overlay (small and light). */
  private addVideo(pc: RTCPeerConnection, userId: string, track: MediaStreamTrack): void {
    const stream = new MediaStream();
    const sender = pc.addTrack(track, stream);
    this.outgoing.set(userId, { stream, track, sender });
    const parameters = sender.getParameters();
    if (!parameters.encodings || parameters.encodings.length === 0) {
      parameters.encodings = [{}];
    }
    parameters.encodings[0].scaleResolutionDownBy = 2;
    parameters.encodings[0].maxBitrate = VIDEO_BITRATE;
    parameters.encodings[0].maxFramerate = VIDEO_FPS;
    sender.setParameters(parameters).catch(this.ignore);
  }

  /** Stops sending one camera. */
  private dropVideo(userId: string): void {
    const known = this.outgoing.get(userId);
    this.outgoing.delete(userId);
    if (known && this.connection && this.connection.signalingState !== 'closed') {
      this.connection.removeTrack(known.sender);
    }
  }

  /** The overlay window is ready (or came back): open a fresh local connection and offer the cameras. */
  private openConnection(): void {
    this.closeConnection();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.connection = pc;
    pc.onicecandidate = this.onCandidate.bind(this);
    pc.onnegotiationneeded = this.offer.bind(this, pc);
    // The cameras are added again on the new connection; their ids change, so the list is sent again.
    this.lastSent = '';
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

  /** Offers the cameras to the overlay (it only ever answers, so the two never offer at the same time). */
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

  /** What the shell says: a new state, the overlay window opened or closed, or an answer of the local connection. */
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
        break;
      case 'signal':
        void this.onSignal(event.message);
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
