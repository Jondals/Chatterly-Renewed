/**
 * src/app/core/services/call.service.ts
 * WebRTC call engine: encrypted and signed signaling, encryption of every media frame, level meters, screen
 * sharing, camera and the music everybody in the call listens to together.
 */
import { parseMusicLink, type MusicLink } from '../../shared/util/music-link';
import { Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { toB64 } from '../crypto/bytes';
import { importEcdhPublic } from '../crypto/identity';
import { deriveLinkSecrets, securityCode } from '../crypto/media-cipher';
import {
  derivePairKey,
  open,
  seal,
  signSealed,
  signalContext,
  verifySealed,
  type Sealed,
} from '../crypto/pairwise';
import type { CallParticipant } from '../models';
import {
  RelayUnavailableError,
  buildPeerConfiguration,
  earliestExpiry,
  isRelayCandidate,
  isFreshSignal,
  needsIceRefresh,
  selectedPathKind,
  type RtcConfigResponse,
} from '../rtc-policy';
import { AuthService } from './auth.service';
import { DirectoryService } from './directory.service';
import { ApiError, ApiService } from './api.service';
import { screenQuality } from '../screen-quality';
import { SettingsService } from './settings.service';
import { CallBackgroundService } from './call-background.service';
import { canChangeCamera, isNeutral, startCameraFx, type CameraFx } from './camera-fx';
import { SocketService, type ServerEvent } from './socket.service';
import { buildVoiceChain } from '../audio-chain';
import { desktopBridge } from '../desktop-bridge';
import { ANDROID_APP, STRICT_RELAY } from '../config';
import {
  androidScreenAvailable,
  onScreenSilent,
  startAndroidScreen,
  stopAndroidScreen,
} from '../android-screen';
import { SoundService, type SfxId } from './sound.service';
import { ToastService } from './toast.service';

/** One song waiting in the queue of the call. */
export interface QueueItem {
  id: string;
  url: string;
  link: MusicLink;
  by: string;
  /** True when it is a video to watch (it takes the stage), false for music. */
  video: boolean;
}

export interface PeerView {
  userId: string;
  connection: RTCPeerConnectionState | 'new';
  audio: MediaStream | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
  rttMs: number | null;
  /** Frame-level end-to-end encryption is negotiated and flowing for this peer. */
  encrypted: boolean;
  /** 4 emojis both sides can compare aloud to prove nobody tampered with the key exchange. */
  securityCode: string | null;
  mediaStats: {
    encrypted: number;
    decrypted: number;
    failed: number;
    dropped: number;
    received?: number;
    lastError?: string;
  };
}

export interface CallStats {
  rttMs: number | null;
  jitterMs: number | null;
  lossPct: number;
  outKbps: number;
  inKbps: number;
  /** e.g. "AES_CM_128_HMAC_SHA1_80" as reported by the browser for the media transport. */
  srtpCipher: string | null;
  dtlsState: string | null;
  connectedPeers: number;
}

const EMPTY_STATS: CallStats = {
  rttMs: null,
  jitterMs: null,
  lossPct: 0,
  outKbps: 0,
  inKbps: 0,
  srtpCipher: null,
  dtlsState: null,
  connectedPeers: 0,
};

interface SignalBody {
  sid: string;
  n: number;
  /** When the sender made the message (milliseconds since 1970): a message that opens a session must be recent. */
  ts?: number;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  /** Id of the MediaStream that carries the sender's screen share, so the receiver can label it. */
  screen?: string;
  /** Ephemeral ECDH public key (base64 raw P-256) for the media-encryption key agreement. */
  eph?: string;
  /** "Listen together": a YouTube/Spotify link and the second it is at, or `stop`. It travels encrypted and signed like the rest. */
  music?: {
    url?: string;
    pos?: number;
    stop?: boolean;
    video?: boolean;
    paused?: boolean;
    index?: number;
    /** The whole queue (newest `qrev` wins). */
    queue?: { id?: string; url?: string; by?: string; video?: boolean }[];
    qrev?: number;
    /** The sender takes a video out of the playlist (its id). */
    remove?: string;
    /** The sender votes to skip what is playing. */
    skip?: boolean;
  };
  /** An effect of the soundboard of the sender (its name; the sound is made here). */
  sfx?: string;
  /** A sound of the soundboard of the sender: its pieces (sent once) and the order to play it. */
  clip?: { id: string; name?: string; part?: number; of?: number; data?: string; play?: boolean };
  /** The wheel or tournament shared with the call (plain data, checked by the receiver); `fresh` is false for a snapshot sent to someone who just joined. */
  spinly?: { state?: unknown; fresh?: boolean };
}

interface SignalPayload extends Sealed {
  signature: string;
}

interface Link {
  userId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  sid: string;
  remoteSid: string | null;
  sendCounter: number;
  lastReceived: number;
  screenStreamId: string | undefined;
  screenStreamIdRemote?: string;
  candidates: RTCIceCandidateInit[];
  sendQueue: Promise<void>;
  receiveQueue: Promise<void>;
  senders: { camera?: RTCRtpSender[]; screen?: RTCRtpSender[] };
  audioIn?: AudioChain;
  /** The id of the stream that carries the voice of the person (any other audio stream of theirs is a shared screen). */
  voiceStreamId?: string;
  /** The sound of the screen the person shares, with its own volume. */
  screenAudioIn?: ScreenAudioChain;
  lastBytes: { in: number; out: number; at: number };
  lost: number;
  received: number;
  /** Per-call, per-peer ephemeral ECDH pair: gives the media keys forward secrecy. */
  eph: CryptoKeyPair | null;
  ephPub: string;
  ephReady: Promise<void>;
  remoteEph: string | null;
  protectedReceivers: WeakSet<RTCRtpReceiver>;
  /** This connection may only use the relay: a candidate that is not relayed is never sent to the other person. */
  relayRequired: boolean;
  /** When the connection was first connected (ms since 1970): the frame encryption must be proven soon after. */
  connectedAt?: number;
  /** The share (0.15 to 1) of the highest bitrate the video towards this person may use now (see adaptVideo). */
  videoScale: number;
  /** The lowest round trip seen on this connection (ms): the line without a queue. */
  baseRtt: number;
  /** Seconds in a row that the line looked clear (the video goes up again after a while). */
  clearSeconds: number;
  /** Packets of our video the other side reported lost and sent, at the last measure. */
  lastVideoLoss: { lost: number; sent: number };
  /** The most pictures per second the camera sent to this person may use now: it goes down while the computer cannot keep up (see adaptCpu). */
  fpsCap?: number;
  /** Seconds in a row the encoder said it was limited by the processor, and seconds in a row it said it was not limited at all. */
  cpuSeconds: number;
  freeSeconds: number;
}

/**
 * ! The most a camera may send, by the height of its picture (bits per second). In production every call goes through
 * the relay over TLS, that is over TCP: whatever the line cannot carry is queued, and the queue shows as a round trip that
 * keeps growing until the call breaks. A ceiling, plus adaptVideo lowering it as soon as the queue appears, keeps the
 * picture moving instead.
 */
const CAMERA_BITRATE: Record<string, number> = {
  '480': 700_000,
  '720': 1_500_000,
  '1080': 3_000_000,
};
/** The lowest share of the ceiling the video goes down to when the line is full. */
const MIN_VIDEO_SCALE = 0.12;
/** Seconds of a clear line before the video goes up a step again. */
const CLEAR_SECONDS_TO_RISE = 6;

/**
 * ! How long a connected call may go without proof that the frame encryption works before it is closed: at least one
 * frame of ours through the encryption, and the frames of the other person not all failing to authenticate.
 */
const SECURE_MEDIA_PROOF_MS = 12_000;

interface ScreenAudioChain {
  element: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
}

interface AudioChain {
  element: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  panner: PannerNode;
  analyser: AnalyserNode;
  spatial: boolean;
}

/**
 * ! Full-mesh WebRTC calls. Media flows peer-to-peer over DTLS-SRTP, so the server never touches
 * audio/video. The signaling that sets those sessions up goes through the server but is encrypted
 * with the pair key and signed with each peer's identity key: the server can neither read it nor
 * swap DTLS fingerprints to mount a man-in-the-middle attack.
 */
@Injectable({ providedIn: 'root' })
export class CallService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly directory = inject(DirectoryService);
  private readonly socket = inject(SocketService);
  private readonly sound = inject(SoundService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);

  readonly roomId = signal<string | null>(null);
  readonly status = signal<'idle' | 'connecting' | 'connected'>('idle');
  readonly participants = signal<CallParticipant[]>([]);
  /** Participants of every room I can see (for "who's in this voice channel"). */
  readonly rooms = signal<Record<string, CallParticipant[]>>({});
  readonly peers = signal<Record<string, PeerView>>({});
  readonly incoming = signal<{ roomId: string; from: string } | null>(null);

  /** Music or a video shared in the call (every participant plays it on their own device, starting together). */
  readonly music = signal<{
    url: string;
    link: MusicLink;
    by: string;
    receivedAt: number;
    pos: number;
    /** True when it is a video to watch together (the stage shows it big), false for music. */
    video: boolean;
  } | null>(null);
  /**
   * The latest pause or resume of the shared player, by this person (remote false) or by somebody else (remote true,
   * which the player must obey). `pos` is the second it happened at.
   */
  readonly musicControl = signal<{
    paused: boolean;
    pos: number;
    /** Position in a YouTube playlist, when it changed. */
    index?: number;
    remote: boolean;
    seq: number;
  } | null>(null);
  private controlSeq = 0;
  /** What waits to be played after the current song, for everybody in the call. */
  readonly musicQueue = signal<QueueItem[]>([]);
  /** The people who voted to skip the current song. */
  readonly skipVotes = signal<string[]>([]);
  /** Titles of the songs and videos, found when somebody shares them (best effort). */
  readonly musicTitles = signal<Record<string, string>>({});
  private queueRev = 0;
  private readonly titleRequests = new Set<string>();
  readonly muted = signal(false);
  readonly deafened = signal(false);
  readonly cameraOn = signal(false);
  readonly screenOn = signal(false);
  readonly localCamera = signal<MediaStream | null>(null);
  readonly localScreen = signal<MediaStream | null>(null);
  /** The people whose shared screen has sound (user id to true), so the stage can offer a volume for it. */
  readonly screenSound = signal<Record<string, boolean>>({});

  /** 0..1 voice levels per user id, refreshed ~12 times a second. */
  readonly levels = signal<Record<string, number>>({});
  readonly speaking = signal<ReadonlySet<string>>(new Set());
  readonly stats = signal<CallStats>(EMPTY_STATS);
  readonly rttHistory = signal<number[]>([]);
  /** Binaural spread multiplier for spatial audio (1 = ±70°). */
  readonly spread = signal(1);
  readonly angles = computed(
    function (this: CallService) {
      const ids = this.participants()
        .map(function (p) {
          return p.userId;
        })
        .filter(
          function (this: CallService, id: string) {
            return id !== this.auth.user()?.id;
          }.bind(this),
        );
      const span = 70 * this.spread();
      return Object.fromEntries(
        ids.map(function (id, i) {
          return [id, ids.length === 1 ? 0 : -span + (2 * span * i) / (ids.length - 1)];
        }),
      ) as Record<string, number>;
    }.bind(this),
  );

  readonly inCall = computed(
    function (this: CallService) {
      return this.roomId() !== null;
    }.bind(this),
  );

  /**
   * ! How peer connections are configured for the current call. Null until `loadIce` succeeds: there is deliberately
   * no default (a built-in public STUN server would reveal the addresses of everybody in the call).
   */
  private peerConfiguration: RTCConfiguration | null = null;
  /** Every connection of this call must use the relay (the server requires it, or the person asked for it). */
  private relayRequired = false;
  /** When the relay credentials stop working, in milliseconds since 1970 (null without a relay). */
  private iceExpiresAt: number | null = null;
  private refreshingIce = false;
  private readonly links = new Map<string, Link>();
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private gate: GainNode | null = null;
  private sendDest: MediaStreamAudioDestinationNode | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private sendTrack: MediaStreamTrack | null = null;
  private meterTimer: ReturnType<typeof setInterval> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private stopRing: (() => void) | null = null;
  private lastSpeech = new Map<string, number>();
  private started = false;
  private previousParticipants = new Set<string>();
  private worker: Worker | null = null;

  /** 'active' once every connected peer exchanged keys and frames decrypt cleanly. */
  readonly mediaEncryption = computed<'none' | 'pending' | 'active' | 'failing'>(
    function (this: CallService) {
      const peers = Object.values(this.peers());
      if (!this.inCall() || !peers.length) return 'none';
      if (
        peers.some(function (p) {
          return p.mediaStats.failed > 20 && p.mediaStats.failed > p.mediaStats.decrypted;
        })
      )
        return 'failing';
      // * 'active' needs proof, not only keys: at least one frame from every person authenticated under their key, and
      // at least one frame of ours went through the encryption towards them.
      return peers.every(function (p) {
        return p.encrypted && p.mediaStats.decrypted > 0 && p.mediaStats.encrypted > 0;
      })
        ? 'active'
        : 'pending';
    }.bind(this),
  );

  /** Keeps the spatial audio and the output device in sync with the settings. */
  constructor() {
    effect(
      function (this: CallService) {
        const spatial = this.settings.spatialAudio();
        const angles = this.angles();
        const deaf = this.deafened();
        // The volumes of the people are read here so the chains follow them when somebody moves a slider.
        this.settings.peerVolumes();
        this.settings.screenVolumes();
        for (const link of this.links.values()) {
          this.configureChain(link, spatial, angles[link.userId] ?? 0, deaf);
          this.configureScreenChain(link, deaf);
        }
      }.bind(this),
    );
    effect(
      function (this: CallService) {
        const id = this.settings.outputDeviceId();
        const ctx = this.sound.context as AudioContext & {
          setSinkId?: (id: string) => Promise<void>;
        };
        if (this.inCall() && ctx.setSinkId && id !== 'default')
          void ctx.setSinkId(id).catch(function () {
            return undefined;
          });
      }.bind(this),
    );
  }

  /** Starts listening to the server events that drive calls (joined, state, left, incoming, signals, sound effects). */
  start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisibility.bind(this));
    this.socket.events$.subscribe(
      function (this: CallService, event: ServerEvent) {
        const e = event as unknown as Record<string, unknown>;
        switch (event.t) {
          case 'call.joined':
            void this.onJoined(e['roomId'] as string, e['participants'] as CallParticipant[]);
            break;
          case 'call.state':
            this.onState(e['roomId'] as string, e['participants'] as CallParticipant[]);
            break;
          case 'call.left':
            // ! The answer to our own "leave" arrives late; it must not end the call we are joining now.
            if (e['roomId'] === this.roomId()) {
              this.teardown();
            }
            break;
          case 'call.incoming':
            this.onIncoming(e['roomId'] as string, e['from'] as string);
            break;
          case 'call.transferred':
            this.onTransferred(e['roomId'] as string);
            break;
          case 'rtc.signal':
            this.onSignal(
              e['roomId'] as string,
              e['from'] as string,
              e['payload'] as SignalPayload,
            );
            break;
          case 'socket.closed':
            this.rooms.set({});
            if (this.inCall()) {
              this.teardown();
              this.toast.error('Call disconnected', 'The connection to the server dropped.');
            }
            break;
          case 'error':
            if (this.status() === 'connecting') {
              this.teardown();
              this.toast.error('Could not join the call', String(e['code']));
            }
            break;
        }
      }.bind(this),
    );
  }

  // ---- public controls -----------------------------------------------------------------------

  async join(roomId: string): Promise<void> {
    if (this.roomId() === roomId) return;
    if (this.inCall() || this.status() === 'connecting') await this.leave();
    this.dismissIncoming();
    if (typeof RTCRtpScriptTransform === 'undefined') {
      this.toast.error(
        'Browser not supported for secure calls',
        'End-to-end encrypted media needs RTCRtpScriptTransform (Chrome, Edge and Android WebView 141+, Firefox 117+, Safari 15.4+). Update your browser or the Android System WebView.',
      );
      return;
    }
    this.status.set('connecting');
    try {
      this.startWorker();
      this.sound.context; // creates/resumes the AudioContext inside the user gesture
      await Promise.all([this.loadIce(), this.startMic()]);
    } catch (error) {
      this.teardown();
      if (error instanceof RelayUnavailableError) {
        this.toast.error('Private call unavailable', error.message);
        return;
      }
      const denied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      this.toast.error(
        denied ? 'Microphone blocked' : 'Could not start the call',
        denied
          ? 'Allow microphone access in your browser to talk.'
          : String((error as Error).message ?? error),
      );
      return;
    }
    this.pendingRoom = roomId;
    if (!this.socket.send({ t: 'call.join', roomId })) {
      this.teardown();
      this.toast.error('Offline', 'Reconnect to the server before joining a call.');
    }
  }

  private pendingRoom: string | null = null;

  /** Leaves the current call and plays the leave sound. */
  async leave(): Promise<void> {
    if (this.roomId() || this.status() === 'connecting') this.socket.send({ t: 'call.leave' });
    this.teardown();
    this.sound.play('exit');
  }

  /**
   * Starts listening to a YouTube or Spotify link (or watching a YouTube video) together with everybody in the call.
   * Whatever was playing stops for everybody. Returns false when the link is not valid.
   */
  startMusic(text: string, video = false): boolean {
    const musicLink = parseMusicLink(text);
    if (!musicLink || !this.roomId() || (video && musicLink.kind !== 'youtube')) return false;
    const url = text.trim();
    this.musicControl.set(null);
    this.skipVotes.set([]);
    this.playlist.set({ ids: [], index: 0 });
    this.findTitle(url);
    this.music.set({
      url,
      link: musicLink,
      by: this.auth.userId,
      receivedAt: Date.now(),
      pos: 0,
      video,
    });
    for (const link of this.links.values())
      this.sendSignal(link, { music: { url, pos: 0, video } });
    return true;
  }

  /** Called with what somebody else shared about Spinly (set by SpinlyService; the data is checked there). */
  /** What was shared about the wheel or tournament before anybody was listening (it is handed over by `flushSpinly`). */
  private readonly pendingSpinly: { from: string; share: { state?: unknown; fresh?: boolean } }[] =
    [];

  /** Hands over what arrived about the wheel or tournament while nobody was listening. */
  flushSpinly(): void {
    for (const item of this.pendingSpinly.splice(0)) {
      this.onSpinlyShared?.(item.from, item.share);
    }
  }

  onSpinlyShared: ((from: string, share: { state?: unknown; fresh?: boolean }) => void) | null =
    null;
  /** Gives the wheel or tournament the call has right now, to tell whoever just joined (set by SpinlyService). */
  spinlySnapshot: (() => unknown) | null = null;
  /** Called when the call ends, so the shared wheel is forgotten (set by SpinlyService). */
  onSpinlyReset: (() => void) | null = null;

  /** Tells everybody in the call the new state of the shared wheel or tournament. Does nothing outside a call. */
  shareSpinly(state: unknown): void {
    if (!this.roomId()) return;
    for (const link of this.links.values())
      this.sendSignal(link, { spinly: { state, fresh: true } });
  }

  /** Tells somebody who just connected what the call is spinning, if anything. */
  private tellSpinlyTo(link: Link): void {
    const state = this.spinlySnapshot?.();
    if (state) this.sendSignal(link, { spinly: { state, fresh: false } });
  }

  /** Everybody in the call, me included. */
  private participantIds(): string[] {
    return [this.auth.userId, ...Object.keys(this.peers())];
  }

  /** True for exactly one person of the call (the one with the lowest id): the one who moves the queue on. */
  private isQueueKeeper(): boolean {
    const ids = this.participantIds().sort();
    return ids[0] === this.auth.userId;
  }

  /** Votes needed to skip a song: more than half of the call. */
  skipNeeded(): number {
    return Math.floor(this.participantIds().length / 2) + 1;
  }

  /** Looks the title of a YouTube or Spotify link up (it is only a label; nothing depends on it). */
  findTitle(url: string): void {
    if (this.titleRequests.has(url) || this.musicTitles()[url]) return;
    if (!parseMusicLink(url)) return;
    this.titleRequests.add(url);
    // The title is asked of our own server, which asks the service: this browser never talks to YouTube or Spotify about it
    // (it would tell them the address of the person and what they are looking at).
    this.api
      .get<{ title?: unknown }>('/api/preview?url=' + encodeURIComponent(url))
      .then(this.keepTitle.bind(this, url))
      .catch(function ignore() {
        return undefined;
      });
  }

  /** Remembers a title that was found. */
  private keepTitle(url: string, data: { title?: unknown }): void {
    if (typeof data.title === 'string' && data.title) {
      this.musicTitles.update(function put(all) {
        return { ...all, [url]: String(data.title).slice(0, 90) };
      });
    }
  }

  /** Adds a link to the end of the queue (or plays it right away when nothing is playing). Returns false when the link is not valid. */
  queueMusic(text: string, video = false): boolean {
    const link = parseMusicLink(text);
    if (!link || !this.roomId() || (video && link.kind !== 'youtube')) return false;
    if (!this.music()) return this.startMusic(text, video);
    const url = text.trim();
    this.findTitle(url);
    const item: QueueItem = {
      id: Math.random().toString(36).slice(2, 10),
      url,
      link,
      by: this.auth.userId,
      video,
    };
    this.setQueue([...this.musicQueue(), item].slice(0, 50));
    return true;
  }

  /** Takes a song out of the queue (anybody can). */
  removeFromQueue(id: string): void {
    this.setQueue(
      this.musicQueue().filter(function keep(item) {
        return item.id !== id;
      }),
    );
  }

  /** Replaces the queue and tells everybody. */
  private setQueue(items: QueueItem[]): void {
    this.queueRev = Math.max(Date.now(), this.queueRev + 1);
    this.musicQueue.set(items);
    this.sendQueueToAll();
  }

  /** Sends the whole queue to everybody in the call. */
  private sendQueueToAll(): void {
    const queue = this.queuePayload();
    for (const link of this.links.values())
      this.sendSignal(link, { music: { queue, qrev: this.queueRev } });
  }

  /** The queue as it travels: only the link, who added it and its id. */
  private queuePayload(): { id: string; url: string; by: string; video: boolean }[] {
    return this.musicQueue().map(function plain(item) {
      return { id: item.id, url: item.url, by: item.by, video: item.video };
    });
  }

  /** The person votes to skip the song that is playing (pressing again takes the vote back). */
  voteSkip(): void {
    if (!this.music()) return;
    const me = this.auth.userId;
    const has = this.skipVotes().includes(me);
    this.skipVotes.set(
      has
        ? this.skipVotes().filter(function other(id) {
            return id !== me;
          })
        : [...this.skipVotes(), me],
    );
    for (const link of this.links.values()) this.sendSignal(link, { music: { skip: !has } });
    this.checkSkip();
  }

  /** When enough people voted, the keeper of the queue moves on. */
  private checkSkip(): void {
    if (this.music() && this.skipVotes().length >= this.skipNeeded() && this.isQueueKeeper()) {
      this.skipNow();
    }
  }

  /** True while the shared player is paused (the stage keeps it up to date, the floating bar reads it). */
  readonly musicPaused = signal(false);
  /** Counts the times somebody outside the stage asks to pause or resume the shared player. */
  readonly pauseRequest = signal(0);
  /** What the player of the stage reports about the playlist it plays (empty when it is not one). */
  readonly playlist = signal<{ ids: string[]; index: number }>({ ids: [], index: 0 });
  /** Counts the times the player of the stage must go to the next video of its playlist. */
  readonly playlistNext = signal(0);
  /** The latest video taken out of the playlist (by this person or by somebody else): the player must drop it. */
  readonly playlistRemoval = signal<{ id: string; seq: number } | null>(null);
  private removalSeq = 0;

  /** Takes a video out of the playlist for everybody in the call. */
  removeFromPlaylist(id: string): void {
    if (!this.music() || !/^[\w-]{6,20}$/.test(id)) return;
    this.playlistRemoval.set({ id, seq: ++this.removalSeq });
    for (const link of this.links.values()) this.sendSignal(link, { music: { remove: id } });
  }

  /** True when there is something to skip to: a song in the queue or the next video of a playlist. */
  hasNext(): boolean {
    const list = this.playlist();
    return (
      this.musicQueue().length > 0 || (list.ids.length > 0 && list.index < list.ids.length - 1)
    );
  }

  /** Goes on to the next video of the playlist, or to the next of the queue. */
  private skipNow(): void {
    const list = this.playlist();
    if (list.ids.length > 0 && list.index < list.ids.length - 1) {
      this.skipVotes.set([]);
      this.playlistNext.update(function more(n) {
        return n + 1;
      });
    } else {
      this.playNext();
    }
  }

  /** The player reports that the song ended: the keeper of the queue plays the next one. */
  musicEnded(): void {
    const list = this.playlist();
    if (list.ids.length > 0 && list.index < list.ids.length - 1) return;
    if (this.music() && this.isQueueKeeper()) this.playNext();
  }

  /** Starts the next song of the queue for everybody, or ends the music when there is none. */
  private playNext(): void {
    const [next, ...rest] = this.musicQueue();
    if (!next) {
      this.stopMusic();
      return;
    }
    this.queueRev = Math.max(Date.now(), this.queueRev + 1);
    this.musicQueue.set(rest);
    this.startMusic(next.url, next.video);
    this.sendQueueToAll();
  }

  /** Tells everybody that the shared player was paused or resumed at a second. */
  setMusicPaused(paused: boolean, pos: number, index?: number): void {
    if (!this.music()) return;
    this.musicControl.set({ paused, pos, index, remote: false, seq: ++this.controlSeq });
    for (const link of this.links.values())
      this.sendSignal(link, { music: { paused, pos, index } });
  }

  /** Closes the shared music or video only for this person; the others keep it. */
  dismissMusic(): void {
    this.music.set(null);
    this.musicControl.set(null);
  }

  /** Stops the shared music for everybody in the call. */
  stopMusic(): void {
    this.music.set(null);
    this.musicControl.set(null);
    this.skipVotes.set([]);
    for (const link of this.links.values()) this.sendSignal(link, { music: { stop: true } });
  }

  /** Somebody started or stopped the music: the link is checked here too (the sender is not trusted). */
  private onMusicReceived(sender: string, data: NonNullable<SignalBody['music']>): void {
    if (data.stop) {
      this.music.set(null);
      this.musicControl.set(null);
      this.skipVotes.set([]);
      return;
    }
    if (Array.isArray(data.queue)) {
      this.takeQueue(data.queue, Number(data.qrev) || 0);
      return;
    }
    if (typeof data.remove === 'string') {
      if (this.music() && /^[\w-]{6,20}$/.test(data.remove)) {
        this.playlistRemoval.set({ id: data.remove, seq: ++this.removalSeq });
      }
      return;
    }
    if (data.skip !== undefined) {
      this.takeVote(sender, data.skip === true);
      return;
    }
    if (typeof data.paused === 'boolean') {
      if (this.music()) {
        this.musicControl.set({
          paused: data.paused,
          pos: Math.max(0, Math.min(Number(data.pos) || 0, 86400)),
          index:
            typeof data.index === 'number'
              ? Math.max(0, Math.min(Math.floor(data.index), 5000))
              : undefined,
          remote: true,
          seq: ++this.controlSeq,
        });
      }
      return;
    }
    const musicLink = data.url ? parseMusicLink(data.url) : null;
    if (!musicLink || !data.url) return;
    this.musicControl.set(null);
    this.skipVotes.set([]);
    this.playlist.set({ ids: [], index: 0 });
    this.findTitle(data.url);
    this.music.set({
      url: data.url,
      link: musicLink,
      by: sender,
      receivedAt: Date.now(),
      pos: Math.max(0, Math.min(Number(data.pos) || 0, 86400)),
      video: data.video === true && musicLink.kind === 'youtube',
    });
  }

  /** A queue arrived: it is checked here too (links are re-parsed) and the newest one wins. */
  private takeQueue(
    raw: { id?: string; url?: string; by?: string; video?: boolean }[],
    rev: number,
  ): void {
    if (rev < this.queueRev) return;
    const items: QueueItem[] = [];
    for (const entry of raw.slice(0, 50)) {
      const link = typeof entry.url === 'string' ? parseMusicLink(entry.url) : null;
      if (!link || !entry.url) continue;
      items.push({
        id: String(entry.id ?? '').slice(0, 16) || Math.random().toString(36).slice(2, 10),
        url: entry.url,
        link,
        by: String(entry.by ?? '').slice(0, 64),
        video: entry.video === true && link.kind === 'youtube',
      });
      this.findTitle(entry.url);
    }
    this.queueRev = rev;
    this.musicQueue.set(items);
  }

  /** Somebody voted (or took the vote back). */
  private takeVote(sender: string, voted: boolean): void {
    const others = this.skipVotes().filter(function other(id) {
      return id !== sender;
    });
    this.skipVotes.set(voted ? [...others, sender] : others);
    this.checkSkip();
  }

  /** The person who started the music tells whoever just connected, from the point it has reached. */
  private tellMusicTo(link: Link): void {
    const current = this.music();
    if (this.isQueueKeeper() && this.musicQueue().length) {
      this.sendSignal(link, { music: { queue: this.queuePayload(), qrev: this.queueRev } });
    }
    if (!current || current.by !== this.auth.userId) return;
    this.sendSignal(link, {
      music: {
        url: current.url,
        pos: current.pos + (Date.now() - current.receivedAt) / 1000,
        video: current.video,
      },
    });
  }

  /** Mutes or unmutes the microphone (unmuting also undeafens). */
  toggleMute(): void {
    const next = !this.muted();
    this.muted.set(next);
    if (!next && this.deafened()) this.setDeafened(false);
    this.applyMute();
    if (this.roomId()) this.socket.send({ t: 'call.update', muted: next });
    this.sound.play(next ? 'mute' : 'unmute');
  }

  /** Deafens or undeafens (deafening also mutes). */
  toggleDeafen(): void {
    this.setDeafened(!this.deafened());
  }

  /** Applies the deafened state, the mute that goes with it, and tells the room. */
  private setDeafened(value: boolean): void {
    this.deafened.set(value);
    if (value) this.muted.set(true);
    else if (this.muted()) this.muted.set(false);
    this.applyMute();
    if (this.roomId()) this.socket.send({ t: 'call.update', deafened: value, muted: this.muted() });
    this.sound.play(value ? 'deafen' : 'undeafen');
  }

  /** Turns the camera on or off and adds or removes its video for every person in the call. */
  async toggleCamera(): Promise<void> {
    if (this.cameraOn()) {
      this.stopStream(this.localCamera());
      for (const link of this.links.values()) this.removeSenders(link, 'camera');
      this.localCamera.set(null);
      this.cameraOn.set(false);
    } else {
      try {
        const stream = await this.openCamera();
        this.localCamera.set(stream);
        this.cameraOn.set(true);
        for (const link of this.links.values()) this.addVideo(link, stream, 'camera');
      } catch {
        this.toast.error('Camera unavailable', 'Check your browser permissions.');
        return;
      }
    }
    this.socket.send({ t: 'call.update', video: this.cameraOn() });
  }

  /**
   * Opens the camera and, when the person chose a background (a blur, a color, a picture), gives back the processed video
   * instead of the raw one. If the background cannot be made (the engine does not load) the plain camera is used.
   */
  private async openCamera(): Promise<MediaStream> {
    const raw = await this.openRawCamera();
    if (!this.backgrounds.active() || !canChangeCamera()) {
      return raw;
    }
    try {
      const options = await this.backgrounds.options();
      const fx = await startCameraFx(raw, options, this.fxProblem.bind(this));
      if (!fx) {
        return raw;
      }
      this.fxs.set(fx.stream, fx);
      return fx.stream;
    } catch {
      this.toast.error('Background unavailable', 'The camera is shown without it.');
      return raw;
    }
  }

  /** The worker of the effects said it could not do something (no graphics, no model): the person is told once. */
  private fxProblem(reason: string): void {
    if (reason === 'model') {
      this.toast.error('Background unavailable', 'The camera is shown without it.');
    }
  }

  /** The camera with effects, by the stream the call sends (to stop the effects with it). */
  private readonly fxs = new Map<MediaStream, CameraFx>();
  private readonly injector = inject(Injector);
  /** The backgrounds are only needed when a camera starts: nothing of them is made when the app opens. */
  private get backgrounds(): CallBackgroundService {
    return this.injector.get(CallBackgroundService);
  }

  /**
   * The background chosen in the settings changed: a camera that is on follows it at once when only the picture behind
   * the person changes, and restarts when it has to start or stop the processing.
   */
  async applyBackground(): Promise<void> {
    const stream = this.localCamera();
    if (!this.cameraOn() || !stream) {
      return;
    }
    const fx = this.fxs.get(stream);
    const options = await this.backgrounds.options();
    if (fx) {
      // Once the effects run they stay on until the camera restarts (a slider coming back to zero does not blink the camera).
      fx.setOptions(options);
    } else if (!isNeutral(options)) {
      await this.changeCamera();
    }
  }

  /** While the screen is shared the effects of the camera take it easier (less work for the model and the blur), and go back after. */
  private lightenCameraFx(busy: boolean): void {
    this.backgrounds.busy = busy;
    void this.applyBackground();
  }

  /** Opens the camera for a preview (the window of the camera): the same camera the call would use, with no effects. */
  openPreviewCamera(): Promise<MediaStream> {
    return this.openRawCamera();
  }

  /**
   * Opens the camera the person chose. If that device is gone (unplugged, another computer) the default one is used
   * instead of failing, and the choice goes back to "default".
   */
  private async openRawCamera(): Promise<MediaStream> {
    const { height, fps } = this.cameraShape();
    const quality = {
      width: { ideal: Math.round((height * 16) / 9) },
      height: { ideal: height },
      frameRate: { ideal: fps, max: fps },
    };
    const id = this.settings.cameraDeviceId();
    if (id !== 'default') {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { ...quality, deviceId: { exact: id } },
        });
      } catch {
        this.settings.cameraDeviceId.set('default');
      }
    }
    return navigator.mediaDevices.getUserMedia({ video: quality });
  }

  /** The height and the pictures per second of the camera: the chosen ones, or 480p at 15 with the battery saver. */
  private cameraShape(): { height: number; fps: number } {
    const height = Number(this.settings.cameraQuality());
    const fps = Number(this.settings.cameraFps());
    return this.settings.saving()
      ? { height: Math.min(height, 480), fps: Math.min(fps, 15) }
      : { height, fps };
  }

  /** The person chose another camera: if the camera is on it restarts with the new one (the others see it change). */
  async changeCamera(): Promise<void> {
    if (!this.cameraOn()) {
      return;
    }
    await this.toggleCamera();
    await this.toggleCamera();
  }

  /** Starts or stops sharing the screen. */
  async toggleScreen(): Promise<void> {
    if (this.screenOn()) {
      this.stopScreen();
      return;
    }
    const choice = this.settings.screenShare();
    const size = screenQuality(choice.quality, androidScreenAvailable());
    const video: MediaTrackConstraints & { displaySurface?: string } = {
      width: { ideal: size.width },
      height: { ideal: size.height },
      frameRate: { ideal: size.fps },
    };
    if (choice.surface !== 'any') {
      video.displaySurface = choice.surface;
    }
    if (androidScreenAvailable()) {
      await this.shareAndroidScreen(choice.quality, choice.audio);
      return;
    }
    try {
      // In the desktop app the picker has the screens and the windows in tabs (what the person chose in the menu is the
      // tab it opens in) and a box for the sound that starts as the menu has it.
      const bridge = desktopBridge();
      await bridge?.screen?.setSurface(choice.surface, choice.audio).catch(function ignore(): void {
        return undefined;
      });
      // ! restrictOwnAudio keeps the sound of this app (the voices of the call) out of the sound that is shared, so the
      //   others do not hear themselves back; the desktop app asks for the audio always and the picker decides.
      const audio: MediaTrackConstraints & {
        restrictOwnAudio?: boolean;
        suppressLocalAudioPlayback?: boolean;
      } = {
        restrictOwnAudio: true,
        suppressLocalAudioPlayback: true,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video,
        audio: bridge ? audio : choice.audio ? audio : false,
      });
      // What was really shared is what the menu offers next time.
      const sound = stream.getAudioTracks().length > 0;
      if (bridge && sound !== choice.audio) {
        this.settings.screenShare.update(function remember(current) {
          return { ...current, audio: sound };
        });
      }
      this.localScreen.set(stream);
      this.screenOn.set(true);
      this.lightenCameraFx(true);
      stream.getVideoTracks()[0]?.addEventListener(
        'ended',
        function (this: CallService) {
          return this.stopScreen();
        }.bind(this),
      );
      for (const link of this.links.values()) {
        link.screenStreamId = stream.id;
        this.addVideo(link, stream, 'screen');
      }
      this.socket.send({ t: 'call.update', screen: true });
    } catch {
      /* the user cancelled the picker */
    }
  }

  /**
   * The Android app: the system captures the screen (after asking) and the pictures become the video of the call; with
   * `withSound` the sound of the other apps of the phone goes with it (Android 10+).
   */
  private async shareAndroidScreen(quality: string, withSound: boolean): Promise<void> {
    // The apps on screen may forbid capturing their sound: the person is told instead of thinking the others hear it.
    onScreenSilent(
      function (this: CallService) {
        this.toast.info(
          'The others do not hear the sound of that app',
          'Android lets each app forbid capturing its sound, and this one does. The picture is still shared.',
          '🔇',
        );
      }.bind(this),
    );
    try {
      const stream = await startAndroidScreen(quality, withSound, this.sound.context);
      this.localScreen.set(stream);
      this.screenOn.set(true);
      this.lightenCameraFx(true);
      stream.getVideoTracks()[0]?.addEventListener(
        'ended',
        function (this: CallService) {
          return this.stopScreen();
        }.bind(this),
      );
      for (const link of this.links.values()) {
        link.screenStreamId = stream.id;
        this.addVideo(link, stream, 'screen');
      }
      this.socket.send({ t: 'call.update', screen: true });
    } catch {
      /* the person cancelled the dialog of Android */
    }
  }

  /** Stops sharing the screen and removes its video for every person in the call. */
  private stopScreen(): void {
    if (!this.screenOn()) return;
    stopAndroidScreen();
    this.stopStream(this.localScreen());
    for (const link of this.links.values()) {
      this.removeSenders(link, 'screen');
      link.screenStreamId = undefined;
    }
    this.localScreen.set(null);
    this.screenOn.set(false);
    this.lightenCameraFx(false);
    this.socket.send({ t: 'call.update', screen: false });
  }

  /** The sounds of the soundboard that were already prepared to be sent (pieces of base64). */
  private readonly preparedClips = new Map<string, string[]>();
  /** Which sounds each person already has. */
  private readonly clipsSentTo = new Map<string, Set<string>>();
  /** Sounds that arrive in pieces. */
  private readonly incomingClips = new Map<string, { parts: string[]; of: number; got: number }>();
  /** Sounds of the others that are complete. */
  private readonly receivedClips = new Map<string, Blob>();

  /** Plays a sound of the person's soundboard here and sends it (once) and plays it for everybody in the call. */
  async sendClip(clip: { id: string; name: string; blob: Blob }): Promise<void> {
    void this.sound.playBlob(clip.id, clip.blob);
    if (!this.inCall() || this.links.size === 0) return;
    let parts = this.preparedClips.get(clip.id);
    if (!parts) {
      const made = await this.prepareClip(clip.blob);
      if (!made) return;
      parts = made;
      this.preparedClips.set(clip.id, parts);
    }
    const pieces = parts;
    for (const link of this.links.values()) {
      let sent = this.clipsSentTo.get(link.userId);
      if (!sent) {
        sent = new Set<string>();
        this.clipsSentTo.set(link.userId, sent);
      }
      if (!sent.has(clip.id)) {
        sent.add(clip.id);
        pieces.forEach(
          function piece(this: CallService, data: string, index: number) {
            this.sendSignal(link, {
              clip: {
                id: clip.id,
                name: clip.name.slice(0, 24),
                part: index,
                of: pieces.length,
                data,
              },
            });
          }.bind(this),
        );
      }
      this.sendSignal(link, { clip: { id: clip.id, play: true } });
    }
  }

  /** Turns a sound into a short mono WAV (up to 30 seconds) cut into pieces small enough for the signalling. */
  private async prepareClip(blob: Blob): Promise<string[] | null> {
    try {
      const decoded = await this.sound.context.decodeAudioData(await blob.arrayBuffer());
      const rate = 16000;
      const frames = Math.max(1, Math.min(Math.ceil(decoded.duration * rate), rate * 30));
      const offline = new OfflineAudioContext(1, frames, rate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0);
      const bytes = new Uint8Array(44 + frames * 2);
      const view = new DataView(bytes.buffer);
      const text = function writeText(offset: number, value: string): void {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
      };
      text(0, 'RIFF');
      view.setUint32(4, 36 + frames * 2, true);
      text(8, 'WAVEfmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      text(36, 'data');
      view.setUint32(40, frames * 2, true);
      for (let i = 0; i < frames; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      }
      const pieces: string[] = [];
      for (let start = 0; start < bytes.length; start += 12000) {
        let binary = '';
        const end = Math.min(start + 12000, bytes.length);
        for (let i = start; i < end; i++) binary += String.fromCharCode(bytes[i]);
        pieces.push(btoa(binary));
      }
      return pieces.length <= 100 ? pieces : null;
    } catch {
      return null;
    }
  }

  /** A piece of a sound of somebody else arrived, or the order to play it. Everything is checked here. */
  private onClipReceived(from: string, clip: NonNullable<SignalBody['clip']>): void {
    if (typeof clip.id !== 'string' || clip.id.length === 0 || clip.id.length > 40) return;
    const key = from + ':' + clip.id;
    if (
      typeof clip.data === 'string' &&
      typeof clip.part === 'number' &&
      typeof clip.of === 'number'
    ) {
      if (clip.of < 1 || clip.of > 100 || clip.part < 0 || clip.part >= clip.of) return;
      if (clip.data.length > 20000 || this.receivedClips.has(key)) return;
      let entry = this.incomingClips.get(key);
      if (!entry) {
        if (this.incomingClips.size >= 12) return;
        entry = { parts: new Array<string>(clip.of).fill(''), of: clip.of, got: 0 };
        this.incomingClips.set(key, entry);
      }
      if (!entry.parts[clip.part]) {
        entry.parts[clip.part] = clip.data;
        entry.got++;
      }
      if (entry.got === entry.of) {
        this.incomingClips.delete(key);
        this.finishClip(key, entry.parts);
      }
      return;
    }
    if (clip.play === true && !this.deafened()) {
      const blob = this.receivedClips.get(key);
      if (blob) void this.sound.playBlob(key, blob);
    }
  }

  /** Puts the pieces of a sound together. */
  private finishClip(key: string, parts: string[]): void {
    try {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      for (const part of parts) {
        const binary = atob(part);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        chunks.push(bytes);
      }
      this.receivedClips.set(key, new Blob(chunks, { type: 'audio/wav' }));
      if (this.receivedClips.size > 40) {
        const oldest = this.receivedClips.keys().next().value;
        if (oldest !== undefined) {
          this.receivedClips.delete(oldest);
          this.sound.forgetClip(oldest);
        }
      }
    } catch {
      // A damaged sound is ignored.
    }
  }

  /** Plays a soundboard effect here and sends it to everybody in the call. */
  sendSfx(id: SfxId): void {
    this.sound.sfx(id);
    // Sealed for each person like everything else of the call: the server does not learn which effect was played.
    for (const link of this.links.values()) this.sendSignal(link, { sfx: id });
  }

  /** Joins the call that is ringing. */
  acceptIncoming(): Promise<void> {
    const call = this.incoming();
    return call ? this.join(call.roomId) : Promise.resolve();
  }

  /** Stops the ringing and hides the incoming call notice. */
  dismissIncoming(): void {
    this.stopRing?.();
    this.stopRing = null;
    this.incoming.set(null);
  }

  /** Swaps the microphone without renegotiating (e.g. user picked another input device). */
  async changeInputDevice(): Promise<void> {
    if (!this.inCall() && this.status() !== 'connecting') return;
    this.micStream?.getTracks().forEach(function (t) {
      return t.stop();
    });
    this.micSource?.disconnect();
    await this.openMic();
  }

  // ---- microphone pipeline -------------------------------------------------------------------

  /**
   * Asks the server how to connect and builds the configuration of the peer connections of this call.
   * ! FAIL CLOSED: if the configuration cannot be loaded, or a relay is required and there is none with valid
   * credentials, this throws and the call does not start. It never falls back to a public STUN server or to a direct
   * connection, because that would silently show the address of every person in the call.
   */
  private async loadIce(): Promise<void> {
    const response = await this.fetchRtcConfig();
    const built = buildPeerConfiguration(response, Date.now(), STRICT_RELAY);
    this.peerConfiguration = built.configuration;
    this.relayRequired = built.relayRequired;
    this.iceExpiresAt = earliestExpiry(built.configuration.iceServers ?? []);
  }

  /** Downloads `/api/rtc/config`; any failure becomes a `RelayUnavailableError` with a message for the person. */
  private async fetchRtcConfig(): Promise<RtcConfigResponse> {
    try {
      return await this.api.get<RtcConfigResponse>('/api/rtc/config');
    } catch (error) {
      const refused = error instanceof ApiError && error.code === 'relay_unavailable';
      throw new RelayUnavailableError(
        refused
          ? 'The server asks for private calls but its relay is not working, so the call was not started.'
          : 'The call configuration could not be loaded from the server, so the call was not started.',
      );
    }
  }

  /**
   * Gets fresh relay credentials and gives them to every open connection. The relay stops accepting credentials when
   * they expire (one hour), which would end a long call; the policy of the connections does not change.
   */
  private async refreshIce(): Promise<void> {
    if (this.refreshingIce || !this.peerConfiguration) return;
    this.refreshingIce = true;
    try {
      const built = buildPeerConfiguration(await this.fetchRtcConfig(), Date.now(), STRICT_RELAY);
      if (built.relayRequired !== this.relayRequired) {
        throw new RelayUnavailableError('The relay policy changed during the call.');
      }
      this.peerConfiguration = built.configuration;
      this.iceExpiresAt = earliestExpiry(built.configuration.iceServers ?? []);
      for (const link of this.links.values()) link.pc.setConfiguration(built.configuration);
    } catch (error) {
      console.warn('could not renew the relay credentials', error);
    } finally {
      this.refreshingIce = false;
    }
  }

  /**
   * ! Checks, from the statistics of a connection, that it really goes through the relay when one is required. A direct
   * path in a private call means the address was exposed: the connection is closed instead of being kept.
   */
  private enforceRelay(link: Link, report: RTCStatsReport): void {
    if (!link.relayRequired || selectedPathKind(report) !== 'direct') return;
    console.warn('closing a connection that did not use the relay');
    this.closeLink(link.userId);
    this.toast.error(
      'Call stopped',
      'A connection did not go through the relay, so it was closed to protect your address.',
    );
  }

  /**
   * ! Fails closed on the frame encryption itself, so DTLS-SRTP alone is never what keeps a call going. A connection
   * that has been connected for SECURE_MEDIA_PROOF_MS without a single frame of ours through the encryption (the
   * transform is not running, or the keys were never agreed), or whose incoming frames all fail to authenticate (the
   * other side sends them unencrypted or with another key), is closed and the person is told why.
   * A muted microphone still sends silence through the encryption, so muting never trips it.
   *
   * @returns False when the connection was closed.
   */
  private enforceFrameEncryption(link: Link): boolean {
    if (link.pc.connectionState !== 'connected' || link.connectedAt === undefined) return true;
    if (Date.now() - link.connectedAt < SECURE_MEDIA_PROOF_MS) return true;
    const stats = this.peers()[link.userId]?.mediaStats;
    if (!stats) return true;
    const sending = stats.encrypted > 0;
    const rejected = stats.decrypted === 0 && stats.failed > 0;
    if (sending && !rejected) return true;
    console.warn('closing a connection whose frame encryption could not be confirmed');
    this.closeLink(link.userId);
    this.toast.error(
      'Call stopped',
      'The end-to-end encryption of the media could not be confirmed with a participant, so the connection was closed.',
    );
    return false;
  }

  /** Builds the audio graph (level meter, voice gate, outgoing track) and starts the meters and the statistics. */
  private async startMic(): Promise<void> {
    const ctx = this.sound.context;
    this.sendDest = ctx.createMediaStreamDestination();
    this.gate = ctx.createGain();
    this.localAnalyser = ctx.createAnalyser();
    this.localAnalyser.fftSize = 512;
    this.gate.connect(this.sendDest);
    await this.openMic();
    this.sendTrack = this.sendDest.stream.getAudioTracks()[0] ?? null;
    this.meterTimer = setInterval(
      function (this: CallService) {
        return this.measure();
      }.bind(this),
      // 10 times a second is as much as an eye follows a level meter; 12 (every 80 ms) woke the screen of the call more often.
      100,
    );
    this.statsTimer = setInterval(
      function (this: CallService) {
        return void this.collectStats();
      }.bind(this),
      1000,
    );
  }

  /** How loud the room is when nobody speaks (0 to 1), learned while the call goes on. */
  private noiseFloor = 0;

  /** Opens the chosen microphone and connects it to the meter and to the outgoing track. */
  private async openMic(): Promise<void> {
    const deviceId = this.settings.inputDeviceId();
    const processing = {
      echoCancellation: this.settings.echoCancellation(),
      noiseSuppression: this.settings.noiseSuppression(),
      autoGainControl: this.settings.autoGain(),
    };
    // ! The chosen device may be gone (unplugged, or a different browser) and some browsers refuse some options:
    // ! each try asks for less, so the call never fails only because of a preference.
    const attempts: MediaStreamConstraints[] = [
      {
        audio: {
          ...processing,
          channelCount: 1,
          deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
        },
      },
      { audio: { ...processing, channelCount: 1 } },
      { audio: processing },
      { audio: true },
    ];
    let lastError: unknown = null;
    for (const constraints of attempts) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const name = (error as { name?: string }).name;
        if (name !== 'OverconstrainedError' && name !== 'NotFoundError') {
          break;
        }
      }
    }
    if (!this.micStream || lastError) {
      throw lastError ?? new Error('No microphone');
    }
    const ctx = this.sound.context;
    this.micSource = ctx.createMediaStreamSource(this.micStream);
    // mic → voice chain (volume, rumble filter, clarity, leveler) → analyser (level meter) and → gate → outgoing track
    const chain = buildVoiceChain(ctx, {
      inputVolume: this.settings.inputVolume(),
      mode: this.settings.voiceMode(),
    });
    this.micSource.connect(chain.input);
    chain.output.connect(this.localAnalyser!);
    chain.output.connect(this.gate!);
  }

  /** Enables or disables the outgoing audio track according to the mute state. */
  private applyMute(): void {
    if (this.sendTrack) this.sendTrack.enabled = !this.muted();
  }

  /** Voice-activity gate + level meters for everyone (runs every 80 ms). */
  private measure(): void {
    const me = this.auth.user()?.id;
    if (!me) return;
    const levels: Record<string, number> = {};
    const now = performance.now();
    const speaking = new Set<string>();
    const ownLevel = this.muted() ? 0 : this.rms(this.localAnalyser);
    levels[me] = ownLevel;
    let gateThreshold = (this.settings.inputGate() / 100) * 0.12;
    // The noisy-room mode learns how loud the room is when nobody speaks and keeps the gate above it.
    if (this.settings.voiceMode() === 'noisy') {
      this.noiseFloor +=
        (Math.min(ownLevel, 0.2) - this.noiseFloor) * (ownLevel < this.noiseFloor ? 0.3 : 0.01);
      gateThreshold = Math.max(gateThreshold, this.noiseFloor * 2.2);
    }
    const open = ownLevel > gateThreshold;
    if (open) this.lastSpeech.set(me, now);
    const holding = now - (this.lastSpeech.get(me) ?? 0) < 400;
    this.gate?.gain.setTargetAtTime(
      holding || gateThreshold === 0 ? 1 : 0,
      this.sound.context.currentTime,
      0.02,
    );
    if (holding && !this.muted()) speaking.add(me);

    for (const link of this.links.values()) {
      const level = this.deafened() ? 0 : this.rms(link.audioIn?.analyser ?? null);
      levels[link.userId] = level;
      if (level > 0.015) this.lastSpeech.set(link.userId, now);
      if (now - (this.lastSpeech.get(link.userId) ?? 0) < 300) speaking.add(link.userId);
    }
    // * The meters are drawn only when somebody can see them, and only when a level moved enough to show: an unchanged
    //   signal does not wake the screen of the call 12 times a second (that kept a phone busy for nothing).
    if (!document.hidden && this.levelsMoved(levels)) this.levels.set(levels);
    const prev = this.speaking();
    if (
      prev.size !== speaking.size ||
      [...speaking].some(function (id) {
        return !prev.has(id);
      })
    )
      this.speaking.set(speaking);
  }

  /** Whether any level differs from the ones on screen by more than can be seen (or a person came or went). */
  private levelsMoved(next: Record<string, number>): boolean {
    const shown = this.levels();
    const ids = Object.keys(next);
    if (ids.length !== Object.keys(shown).length) return true;
    for (const id of ids) {
      if (Math.abs((shown[id] ?? -1) - next[id]!) > 0.035) return true;
    }
    return false;
  }

  /** One buffer per analyser, reused at every measure instead of a new one 12 times a second. */
  private readonly meterBuffers = new WeakMap<AnalyserNode, Uint8Array<ArrayBuffer>>();

  /** Loudness (0 to 1) of an audio analyser. */
  private rms(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;
    let data = this.meterBuffers.get(analyser);
    if (!data || data.length !== analyser.fftSize) {
      data = new Uint8Array(analyser.fftSize);
      this.meterBuffers.set(analyser, data);
    }
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 2.2);
  }

  // ---- room state ----------------------------------------------------------------------------

  private async onJoined(roomId: string, participants: CallParticipant[]): Promise<void> {
    if (this.pendingRoom !== roomId && this.roomId() !== roomId) return;
    this.pendingRoom = null;
    this.roomId.set(roomId);
    this.participants.set(participants);
    this.previousParticipants = new Set(
      participants.map(function (p) {
        return p.userId;
      }),
    );
    // (On Android, NativeCallService follows this status: the notification of the call and the service that keeps the
    // microphone alive with the screen off.)
    this.status.set('connected');
    // Mute/deafen are personal and persist between calls: tell the room how we joined.
    this.applyMute();
    if (this.muted() || this.deafened())
      this.socket.send({ t: 'call.update', muted: this.muted(), deafened: this.deafened() });
    this.sound.play('connect');
    this.dismissIncoming();
    const me = this.auth.user()!.id;
    await this.directory.ensure(
      participants.map(function (p) {
        return p.userId;
      }),
    );
    // The newcomer always opens the connection to everyone already present: no glare, no ambiguity.
    for (const participant of participants) {
      if (participant.userId !== me) this.ensureLink(participant.userId);
    }
  }

  /** The state of a call room changed: update the lists, play join and leave sounds and close links of people who left. */
  private onState(roomId: string, participants: CallParticipant[]): void {
    this.rooms.update(function (rooms) {
      const next = { ...rooms };
      if (participants.length) next[roomId] = participants;
      else delete next[roomId];
      return next;
    });
    if (!participants.length && this.incoming()?.roomId === roomId) this.dismissIncoming();
    // The call was answered on another device of this person: this one stops ringing.
    if (
      this.incoming()?.roomId === roomId &&
      roomId !== this.roomId() &&
      this.includesMe(participants)
    )
      this.dismissIncoming();
    if (roomId !== this.roomId()) return;
    this.participants.set(participants);
    const now = new Set(
      participants.map(function (p) {
        return p.userId;
      }),
    );
    const me = this.auth.user()?.id;
    for (const id of now)
      if (!this.previousParticipants.has(id) && id !== me) this.sound.play('join');
    for (const id of this.previousParticipants) {
      if (!now.has(id)) {
        this.sound.play('leave');
        this.closeLink(id);
      }
    }
    this.previousParticipants = now;
    void this.directory.ensure(now);
  }

  /** Whether this person is in a list of participants (maybe from another of their devices). */
  private includesMe(participants: CallParticipant[]): boolean {
    const me = this.auth.user()?.id;
    return participants.some(function isMe(p) {
      return p.userId === me;
    });
  }

  /**
   * The person joined this call from another of their devices (the phone and then the computer, or the other way round):
   * the call goes on there, so here it ends quietly. Nothing is sent to the server: a "leave" would take away the place
   * that has just moved.
   */
  private onTransferred(roomId: string): void {
    if (roomId !== this.roomId() && roomId !== this.pendingRoom) return;
    this.teardown();
    this.toast.info('Call moved to another device', 'You are in this call on another device now.');
  }

  /** A call is ringing: show it, ring, and dismiss it after 45 seconds. */
  private onIncoming(roomId: string, from: string): void {
    if (this.roomId() === roomId) return;
    this.incoming.set({ roomId, from });
    void this.directory.ensure([from]);
    this.stopRing?.();
    // On a hidden Android app the call notification rings with the ringtone of the phone (NativeCallService).
    this.stopRing = ANDROID_APP && document.hidden ? null : this.sound.ring();
    setTimeout(
      function (this: CallService) {
        if (this.incoming()?.roomId === roomId) this.dismissIncoming();
      }.bind(this),
      45_000,
    );
  }

  // ---- peer connections ----------------------------------------------------------------------

  private ensureLink(userId: string): Link {
    const existing = this.links.get(userId);
    if (existing) return existing;
    const me = this.auth.user()!.id;
    // ! No configuration means `loadIce` did not succeed: a connection is never opened with default (open) settings.
    if (!this.peerConfiguration) throw new RelayUnavailableError('The call is not configured.');
    const pc = new RTCPeerConnection(this.peerConfiguration);
    const link: Link = {
      userId,
      pc,
      polite: me < userId,
      makingOffer: false,
      ignoreOffer: false,
      sid: crypto.randomUUID(),
      remoteSid: null,
      sendCounter: 0,
      lastReceived: 0,
      screenStreamId: this.localScreen()?.id,
      candidates: [],
      sendQueue: Promise.resolve(),
      receiveQueue: Promise.resolve(),
      senders: {},
      lastBytes: { in: 0, out: 0, at: performance.now() },
      lost: 0,
      received: 0,
      eph: null,
      ephPub: '',
      ephReady: Promise.resolve(),
      remoteEph: null,
      protectedReceivers: new WeakSet(),
      relayRequired: this.relayRequired,
      videoScale: 1,
      baseRtt: Infinity,
      clearSeconds: 0,
      lastVideoLoss: { lost: 0, sent: 0 },
      cpuSeconds: 0,
      freeSeconds: 0,
    };
    link.ephReady = crypto.subtle
      .generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
      .then(async function (pair) {
        link.eph = pair;
        link.ephPub = toB64(await crypto.subtle.exportKey('raw', pair.publicKey));
      });
    this.links.set(userId, link);
    this.setPeer(userId, {
      userId,
      connection: 'new',
      audio: null,
      camera: null,
      screen: null,
      rttMs: null,
      encrypted: false,
      securityCode: null,
      mediaStats: { encrypted: 0, decrypted: 0, failed: 0, dropped: 0 },
    });

    pc.onnegotiationneeded = async function (this: CallService) {
      try {
        link.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal(link, { description: pc.localDescription!.toJSON() });
      } catch (error) {
        console.warn('negotiation failed', error);
      } finally {
        link.makingOffer = false;
      }
    }.bind(this);
    pc.onicecandidate = function (this: CallService, { candidate }: RTCPeerConnectionIceEvent) {
      if (!candidate) return;
      // ! Defence in depth: with a relay-only policy the browser gathers nothing else, but if it ever did, an address
      // ! that is not relayed must not leave this device.
      if (link.relayRequired && !isRelayCandidate(candidate.candidate)) return;
      this.sendSignal(link, { candidate: candidate.toJSON() });
    }.bind(this);
    pc.onconnectionstatechange = function (this: CallService) {
      this.updatePeer(userId, { connection: pc.connectionState });
      if (pc.connectionState === 'failed') void this.recoverConnection(link);
      if (pc.connectionState === 'connected') {
        link.connectedAt ??= Date.now();
        this.tuneAudioSender(link);
        this.tellMusicTo(link);
        this.tellSpinlyTo(link);
      }
    }.bind(this);
    pc.ontrack = function (
      this: CallService,
      { track, streams, receiver, transceiver }: RTCTrackEvent,
    ) {
      // Receivers of transceivers we created with addTrack were protected right away (see protectTrack);
      // this covers the ones the remote offer created. Fail-closed: nothing reaches the decoder unless it
      // authenticates under this peer's key.
      if (!link.protectedReceivers.has(receiver))
        this.protect(link, receiver, track.kind as 'audio' | 'video', 'recv');
      if (track.kind === 'video') this.preferVp8(transceiver);
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === 'video') {
        // The sender stopped (camera or screen turned off): that picture is not there any more, and a new one will come with a new track.
        track.addEventListener(
          'ended',
          function gone(this: CallService) {
            const peer = this.peers()[userId];
            if (peer?.camera === stream) this.updatePeer(userId, { camera: null });
            if (peer?.screen === stream) this.updatePeer(userId, { screen: null });
          }.bind(this),
        );
      }
      if (track.kind === 'audio') {
        if (this.isScreenAudio(link, stream)) {
          // The sound of a shared screen is not a voice: it has its own volume and never replaces the voice of the person.
          this.attachScreenAudio(link, stream, track);
        } else {
          link.voiceStreamId = stream.id;
          this.attachAudio(link, stream);
          this.updatePeer(userId, { audio: stream });
        }
      } else if (stream.id === link.screenStreamId) {
        this.updatePeer(userId, { screen: stream });
      } else {
        this.updatePeer(userId, { camera: stream });
      }
    }.bind(this);

    if (this.sendTrack)
      this.protectTrack(link, pc.addTrack(this.sendTrack, this.sendDest!.stream), 'audio');
    const camera = this.localCamera();
    if (camera) this.addVideo(link, camera, 'camera');
    const screen = this.localScreen();
    if (screen) this.addVideo(link, screen, 'screen');
    return link;
  }

  /**
   * The page came back to the front (a phone that was locked, or the app that was in the background). Timers barely ran
   * meanwhile, so the relay credentials may be about to expire and a connection may have dropped when the network
   * changed: both are renewed now, under the same policy, instead of waiting for the next tick of the statistics.
   */
  private onVisibility(): void {
    if (document.visibilityState !== 'visible' || !this.inCall()) return;
    if (needsIceRefresh(this.iceExpiresAt, Date.now())) void this.refreshIce();
    for (const link of this.links.values()) {
      if (link.pc.connectionState === 'failed' || link.pc.connectionState === 'disconnected') {
        void this.recoverConnection(link);
      }
    }
  }

  /**
   * Tries again after a connection failed: relay credentials are renewed first (an expired credential is a common
   * reason for a relay connection to fail), then ICE restarts under the SAME policy as before (the policy lives in
   * the configuration of the connection and is never relaxed to recover).
   */
  private async recoverConnection(link: Link): Promise<void> {
    await this.refreshIce();
    if (this.links.get(link.userId) === link) link.pc.restartIce();
  }

  /** Sends a camera or screen stream to a person, protected with frame encryption. */
  private addVideo(link: Link, stream: MediaStream, kind: 'camera' | 'screen'): void {
    const isScreen = kind === 'screen';
    const senders = stream.getTracks().map(
      function (this: CallService, track: MediaStreamTrack) {
        // ? A NEW transceiver each time (addTrack reuses an old one that stopped sending, and then the other person never gets
        // a new "track" event: the camera that was turned off and on again stayed frozen or missing until it was toggled again).
        const sender = link.pc.addTransceiver(track, {
          direction: 'sendrecv',
          streams: [stream],
        }).sender;
        const kind = track.kind === 'video' ? 'video' : 'audio';
        const transceiver = this.protectTrack(link, sender, kind);
        if (kind === 'video' && transceiver) this.preferVp8(transceiver);
        if (kind === 'video' && isScreen) this.tuneScreenSender(sender, track);
        if (kind === 'video' && !isScreen) this.tuneCameraSender(link, sender, track);
        return sender;
      }.bind(this),
    );
    link.senders[kind] = [...(link.senders[kind] ?? []), ...senders];
  }

  /**
   * How the shared screen is sent depends on what is on it, and the browser cannot tell a game from a document. The 60 fps
   * qualities are for movement: the picture is kept moving and gets less sharp before it lags (maintain-framerate). The others are for
   * reading: text stays sharp (the frame rate drops first). A ceiling on the bitrate keeps a busy screen from filling the line,
   * which is what made it lag, since every frame is also encrypted.
   */
  private tuneScreenSender(sender: RTCRtpSender, track: MediaStreamTrack): void {
    const motion = screenQuality(this.settings.screenShare().quality).fps >= 60;
    track.contentHint = motion ? 'motion' : 'detail';
    const params = sender.getParameters() as RTCRtpSendParameters & {
      degradationPreference?: string;
    };
    if (!params.encodings?.length) return;
    params.encodings[0]!.maxBitrate = this.screenCeiling();
    params.degradationPreference = motion ? 'maintain-framerate' : 'maintain-resolution';
    void sender.setParameters(params).catch(function ignore(): void {
      return undefined;
    });
  }

  /** The highest bitrate of the shared screen, by the quality chosen. */
  private screenCeiling(): number {
    return screenQuality(this.settings.screenShare().quality).bitrate;
  }

  /** The highest bitrate of the camera, by its height (lower with the battery saver). */
  private cameraCeiling(): number {
    const { height } = this.cameraShape();
    return CAMERA_BITRATE[String(height)] ?? CAMERA_BITRATE['720']!;
  }

  /**
   * The camera keeps moving before it keeps its sharpness: under pressure the picture gets smaller, not slower (that was
   * the stutter). It starts at the share of the ceiling the line allows now (adaptVideo moves it).
   */
  private tuneCameraSender(link: Link, sender: RTCRtpSender, track: MediaStreamTrack): void {
    track.contentHint = 'motion';
    const params = sender.getParameters() as RTCRtpSendParameters & {
      degradationPreference?: string;
    };
    if (!params.encodings?.length) return;
    params.encodings[0]!.maxBitrate = Math.round(this.cameraCeiling() * link.videoScale);
    params.encodings[0]!.maxFramerate = Math.min(link.fpsCap ?? 60, this.cameraShape().fps);
    params.degradationPreference = 'maintain-framerate';
    void sender.setParameters(params).catch(function ignore(): void {
      return undefined;
    });
  }

  /**
   * ! Keeps the video inside what the line carries, from the statistics of every second. A round trip well above the
   * lowest one seen means packets are queuing (on the TCP relay that is how a full line shows) and a loss of more than
   * 5 % means they are dropped: the video goes down by a third at once. After some seconds of a clear line it goes up
   * a fifth at a time, to its ceiling. The voice is never touched (it is small and it matters most).
   */
  private adaptVideo(link: Link, rttMs: number | null, loss: { lost: number; sent: number }): void {
    const lostNow = Math.max(0, loss.lost - link.lastVideoLoss.lost);
    const sentNow = Math.max(0, loss.sent - link.lastVideoLoss.sent);
    link.lastVideoLoss = loss;
    if (rttMs !== null && rttMs > 0) link.baseRtt = Math.min(link.baseRtt, rttMs);
    const queued =
      rttMs !== null &&
      Number.isFinite(link.baseRtt) &&
      rttMs > Math.max(link.baseRtt * 2, link.baseRtt + 120);
    const dropping = sentNow > 20 && lostNow / sentNow > 0.05;
    let next = link.videoScale;
    if (queued || dropping) {
      link.clearSeconds = 0;
      next = Math.max(MIN_VIDEO_SCALE, link.videoScale * 0.66);
    } else if (++link.clearSeconds >= CLEAR_SECONDS_TO_RISE) {
      link.clearSeconds = 0;
      next = Math.min(1, link.videoScale * 1.2);
    }
    if (Math.abs(next - link.videoScale) < 0.01) return;
    link.videoScale = next;
    this.applyVideoCeilings(link);
  }

  /**
   * The camera follows the processor, not only the line: when the encoder says it is limited by the processor (a phone doing 720p at
   * 60 with the frame cipher on top) the pictures per second come down a step, and they go back up when it has room again. The call
   * keeps its sound and its delay instead of the camera making the whole phone, and so the call, late.
   */
  private async adaptCpu(link: Link): Promise<void> {
    const STEPS = [60, 45, 30, 24, 15];
    const wanted = this.cameraShape().fps;
    for (const sender of link.senders.camera ?? []) {
      if (sender.track?.kind !== 'video') continue;
      let reason = 'none';
      try {
        (await sender.getStats()).forEach(function read(stat) {
          if (stat.type === 'outbound-rtp' && typeof stat.qualityLimitationReason === 'string') {
            reason = stat.qualityLimitationReason;
          }
        });
      } catch {
        return;
      }
      link.cpuSeconds = reason === 'cpu' ? link.cpuSeconds + 1 : 0;
      link.freeSeconds = reason === 'none' ? link.freeSeconds + 1 : 0;
      let cap = link.fpsCap ?? wanted;
      if (link.cpuSeconds >= 3) {
        const lower = STEPS.find(function below(step) {
          return step < cap;
        });
        if (lower !== undefined) cap = lower;
        link.cpuSeconds = 0;
      } else if (link.freeSeconds >= 20 && cap < wanted) {
        const higher = [...STEPS].reverse().find(function above(step) {
          return step > cap;
        });
        cap = Math.min(wanted, higher ?? wanted);
        link.freeSeconds = 0;
      }
      if (cap === (link.fpsCap ?? wanted)) continue;
      link.fpsCap = cap;
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      params.encodings[0]!.maxFramerate = cap;
      void sender.setParameters(params).catch(function ignore(): void {
        return undefined;
      });
    }
  }

  /** Puts the current share of the ceilings on the camera and the screen sent to a person. */
  private applyVideoCeilings(link: Link): void {
    const ceilings: [RTCRtpSender[] | undefined, number][] = [
      [link.senders.camera, this.cameraCeiling()],
      [link.senders.screen, this.screenCeiling()],
    ];
    for (const [senders, ceiling] of ceilings) {
      for (const sender of senders ?? []) {
        if (sender.track?.kind !== 'video') continue;
        const params = sender.getParameters();
        if (!params.encodings?.length) continue;
        params.encodings[0]!.maxBitrate = Math.max(100_000, Math.round(ceiling * link.videoScale));
        void sender.setParameters(params).catch(function ignore(): void {
          return undefined;
        });
      }
    }
  }

  /** Stops sending the camera or screen video to a person. */
  private removeSenders(link: Link, kind: 'camera' | 'screen'): void {
    for (const sender of link.senders[kind] ?? []) {
      try {
        // Stopping the transceiver ends the track of the other person (they hear "ended") and frees its line for good.
        const transceiver = link.pc.getTransceivers().find(function mine(t) {
          return t.sender === sender;
        });
        if (transceiver) {
          transceiver.stop();
        } else {
          link.pc.removeTrack(sender);
        }
      } catch {
        /* connection already closed */
      }
    }
    link.senders[kind] = [];
  }

  /** Sets the voice encoding parameters (Opus 48 kHz, priority) of the audio sent to a person. */
  private tuneAudioSender(link: Link): void {
    const sender = link.pc.getSenders().find(function (s) {
      return s.track?.kind === 'audio';
    });
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0]!.maxBitrate = 96_000;
    void sender.setParameters(params).catch(function () {
      return undefined;
    });
  }

  /** Closes the connection with a person and forgets everything about it. */
  private closeLink(userId: string): void {
    const link = this.links.get(userId);
    if (!link) return;
    this.links.delete(userId);
    link.pc.onnegotiationneeded = null;
    link.pc.onicecandidate = null;
    link.pc.ontrack = null;
    link.pc.close();
    this.destroyChain(link);
    this.destroyScreenChain(link);
    this.worker?.postMessage({ type: 'drop', peerId: userId });
    this.peers.update(function (p) {
      const { [userId]: _gone, ...rest } = p;
      return rest;
    });
  }

  /** Stores the view of a person in the call. */
  private setPeer(userId: string, view: PeerView): void {
    this.peers.update(function (p) {
      return { ...p, [userId]: view };
    });
  }

  /** Changes some fields of the view of a person in the call. */
  private updatePeer(userId: string, patch: Partial<PeerView>): void {
    this.peers.update(function (p) {
      return p[userId] ? { ...p, [userId]: { ...p[userId]!, ...patch } } : p;
    });
  }

  // ---- encrypted, signed signaling -----------------------------------------------------------

  private async pairKey(otherId: string, roomId: string): Promise<CryptoKey> {
    const other = await this.directory.require(otherId);
    return derivePairKey(
      this.auth.identity.ecdhPrivate,
      this.auth.identity.publicKeys.ecdh,
      other.publicKeys.ecdh,
      `rtc|${roomId}`,
    );
  }

  /** Sends a signaling message to a person, encrypted with the pair key and signed with this device's identity key. */
  private sendSignal(
    link: Link,
    body: Pick<SignalBody, 'description' | 'candidate' | 'music' | 'spinly' | 'clip' | 'sfx'>,
  ): void {
    const roomId = this.roomId() ?? this.pendingRoom;
    if (!roomId) return;
    const counter = ++link.sendCounter;
    // Serialised so descriptions/candidates keep their order despite async crypto.
    link.sendQueue = link.sendQueue.then(
      async function (this: CallService) {
        try {
          await link.ephReady;
          // Nothing is encrypted to an identity key that changed since it was first seen (see rejectUntrusted).
          if (!(await this.directory.isIdentityTrusted(link.userId))) {
            this.rejectUntrusted(link.userId);
            return;
          }
          const full: SignalBody = {
            sid: link.sid,
            n: counter,
            ts: Date.now(),
            screen: link.screenStreamId,
            eph: link.ephPub,
            ...body,
          };
          const me = this.auth.userId;
          const aad = signalContext(roomId, me, link.userId);
          const sealed = await seal(await this.pairKey(link.userId, roomId), full, aad);
          const signature = await signSealed(this.auth.identity.ecdsaPrivate, aad, sealed);
          this.socket.send({
            t: 'rtc.signal',
            roomId,
            to: link.userId,
            payload: { ...sealed, signature },
          });
        } catch (error) {
          console.warn('could not send signal', error);
        }
      }.bind(this),
    );
  }

  /** Receives a signaling message: checks the signature, decrypts it in order and applies it. */
  private onSignal(roomId: string, from: string, payload: SignalPayload): void {
    if (roomId !== this.roomId()) return;
    // Decrypt strictly in arrival order per peer.
    const gate = this.links.get(from);
    const run = async function (this: CallService) {
      const aad = signalContext(roomId, from, this.auth.userId);
      // ! A changed identity key is not trusted for calls: the server could have swapped it to listen in.
      if (!(await this.directory.isIdentityTrusted(from))) {
        this.rejectUntrusted(from);
        return;
      }
      const sender = await this.directory.require(from);
      if (!(await verifySealed(sender.publicKeys.ecdsa, aad, payload, payload.signature))) {
        console.warn('dropping signal with an invalid signature from', from);
        return;
      }
      const body = await open<SignalBody>(await this.pairKey(from, roomId), payload, aad);
      let link = this.links.get(from);
      if (link && link.remoteSid && body.sid !== link.remoteSid) {
        if (body.n !== 1) return; // stale traffic from a previous session
        // A message that replaces a live session must be recent: a recording of an old first message is not enough.
        if (!isFreshSignal(body.ts)) return;
        this.closeLink(from);
        link = undefined;
      }
      if (!link && !isFreshSignal(body.ts)) return;
      link ??= this.ensureLink(from);
      link.remoteSid ??= body.sid;
      if (body.n <= link.lastReceived) return; // replayed or duplicated frame
      link.lastReceived = body.n;
      await this.applySignal(link, body);
    }.bind(this);
    const chain = (gate?.receiveQueue ?? Promise.resolve()).then(run).catch(function (e) {
      return console.warn('signal error', e);
    });
    if (gate) gate.receiveQueue = chain;
    else
      void chain.then(function () {
        return undefined;
      });
  }

  /** People whose changed key was already reported in this call (one warning each). */
  private readonly untrustedWarned = new Set<string>();

  /**
   * ! Refuses to set up a call with a person whose identity key is not the one that was pinned. The connection with
   * them is closed and the person is told once. They can review the new key in the chat with that contact; until
   * they accept it, no call is set up with that key.
   */
  private rejectUntrusted(userId: string): void {
    this.closeLink(userId);
    if (this.untrustedWarned.has(userId)) return;
    this.untrustedWarned.add(userId);
    this.toast.error(
      'Call blocked',
      'The security key of a participant changed. Review it in your chat with them before calling.',
    );
  }

  /** "Perfect negotiation": both sides can renegotiate at any time without deadlocking. */
  private async applySignal(link: Link, body: SignalBody): Promise<void> {
    const { pc } = link;
    if (body.screen !== link.screenStreamIdRemote) this.noteRemoteScreen(link, body.screen);
    if (body.music) this.onMusicReceived(link.userId, body.music);
    if (body.clip) this.onClipReceived(link.userId, body.clip);
    if (typeof body.sfx === 'string' && body.sfx.length <= 16 && !this.deafened()) {
      this.sound.sfx(body.sfx as SfxId);
    }
    if (body.spinly) {
      // ? The part that listens (SpinlyService) is made when a screen asks for it: what arrives before is kept for it.
      if (this.onSpinlyShared) this.onSpinlyShared(link.userId, body.spinly);
      else this.pendingSpinly.push({ from: link.userId, share: body.spinly });
    }
    // The key agreement must finish before any media (or answer) leaves this device.
    if (body.eph && !link.remoteEph) await this.agreeMediaKeys(link, body.eph);
    try {
      if (body.description) {
        const collision =
          body.description.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable');
        link.ignoreOffer = !link.polite && collision;
        if (link.ignoreOffer) return;
        await pc.setRemoteDescription(body.description);
        for (const candidate of link.candidates.splice(0))
          await pc.addIceCandidate(candidate).catch(function () {
            return undefined;
          });
        if (body.description.type === 'offer') {
          await pc.setLocalDescription();
          this.sendSignal(link, { description: pc.localDescription!.toJSON() });
        }
      } else if (body.candidate) {
        if (!pc.remoteDescription) link.candidates.push(body.candidate);
        else {
          try {
            await pc.addIceCandidate(body.candidate);
          } catch (error) {
            if (!link.ignoreOffer) throw error;
          }
        }
      }
    } catch (error) {
      console.warn('could not apply signal', error);
    }
  }

  /** Remembers which stream of a person is their screen share, so it can be labeled. */
  private noteRemoteScreen(link: Link, streamId: string | undefined): void {
    link.screenStreamIdRemote = streamId;
    link.screenStreamId = streamId ?? link.screenStreamId;
    if (!streamId) this.updatePeer(link.userId, { screen: null });
  }

  // ---- end-to-end media encryption ------------------------------------------------------------

  private startWorker(): void {
    this.worker?.terminate();
    const worker = new Worker(new URL('./media-crypto.worker', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = function (this: CallService, event: MessageEvent) {
      const msg = event.data as
        | { type: 'ready'; peerId: string }
        | { type: 'stats'; peerId: string; stats: PeerView['mediaStats'] };
      if (msg.type === 'ready') this.updatePeer(msg.peerId, { encrypted: true });
      else if (msg.type === 'stats') this.updatePeer(msg.peerId, { mediaStats: msg.stats });
    }.bind(this);
    this.worker = worker;
  }

  /** ECDH(ephemeral, ephemeral) -> directional ratcheting keys, handed to the worker. */
  private async agreeMediaKeys(link: Link, remoteEph: string): Promise<void> {
    try {
      await link.ephReady;
      const remote = await importEcdhPublic(remoteEph); // rejects points that are not on P-256
      const shared = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: remote },
        link.eph!.privateKey,
        256,
      );
      const secrets = await deriveLinkSecrets(shared, this.auth.userId, link.userId);
      link.remoteEph = remoteEph;
      this.worker?.postMessage(
        { type: 'keys', peerId: link.userId, send: secrets.send.buffer, recv: secrets.recv.buffer },
        [secrets.send.buffer, secrets.recv.buffer],
      );
      this.updatePeer(link.userId, { securityCode: await securityCode(link.ephPub, remoteEph) });
    } catch (error) {
      console.warn('media key agreement failed', error);
      this.toast.error(
        'Secure call setup failed',
        'Could not agree on media encryption keys with a participant.',
      );
    }
  }

  /**
   * Chromium only feeds a receiver's transform if it is attached when the transceiver is created, so for
   * transceivers born from addTrack() the sender AND receiver transforms are set immediately.
   */
  private protectTrack(
    link: Link,
    sender: RTCRtpSender,
    kind: 'audio' | 'video',
  ): RTCRtpTransceiver | undefined {
    this.protect(link, sender, kind, 'send');
    const transceiver = link.pc.getTransceivers().find(function (t) {
      return t.sender === sender;
    });
    if (transceiver) this.protect(link, transceiver.receiver, kind, 'recv');
    return transceiver;
  }

  /** Attaches the frame-encryption worker to a sender or receiver. */
  private protect(
    link: Link,
    endpoint: RTCRtpSender | RTCRtpReceiver,
    kind: 'audio' | 'video',
    role: 'send' | 'recv',
  ): void {
    if (!this.worker) throw new Error('media encryption worker missing');
    if (role === 'recv') link.protectedReceivers.add(endpoint as RTCRtpReceiver);
    endpoint.transform = new RTCRtpScriptTransform(this.worker, {
      peerId: link.userId,
      role,
      kind,
    });
  }

  /** Our frame cipher keeps VP8's descriptor bytes in clear; other codecs use different layouts. */
  private preferVp8(transceiver: RTCRtpTransceiver): void {
    try {
      const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
      const wanted = codecs.filter(function (c) {
        return ['video/VP8', 'video/rtx', 'video/red', 'video/ulpfec'].includes(c.mimeType);
      });
      if (
        wanted.some(function (c) {
          return c.mimeType === 'video/VP8';
        })
      )
        transceiver.setCodecPreferences(wanted);
    } catch {
      /* unsupported: negotiation falls back to the browser default */
    }
  }

  // ---- remote audio --------------------------------------------------------------------------

  private attachAudio(link: Link, stream: MediaStream): void {
    this.destroyChain(link);
    const ctx = this.sound.context;
    // Chromium only delivers remote WebRTC audio to WebAudio if the stream is also attached to an element.
    const element = new Audio();
    element.srcObject = stream;
    element.muted = true;
    void element.play().catch(function () {
      return undefined;
    });
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    link.audioIn = { element, source, gain, panner, analyser, spatial: false };
    this.configureChain(
      link,
      this.settings.spatialAudio(),
      this.angles()[link.userId] ?? 0,
      this.deafened(),
    );
  }

  /** Sets up the audio chain of a person (gain, spatial position, analyser) for the current settings. */
  private configureChain(link: Link, spatial: boolean, angleDeg: number, deafened: boolean): void {
    const chain = link.audioIn;
    if (!chain) return;
    const ctx = this.sound.context;
    // disconnect() throws when nothing is connected yet (first run), so each call is guarded.
    for (const [from, to] of [
      [chain.source, chain.gain],
      [chain.gain, undefined],
      [chain.panner, undefined],
    ] as const) {
      try {
        if (to) from.disconnect(to);
        else from.disconnect();
      } catch {
        /* not connected */
      }
    }
    chain.source.connect(chain.gain);
    if (spatial) {
      const rad = (angleDeg * Math.PI) / 180;
      chain.panner.positionX.value = Math.sin(rad) * 2;
      chain.panner.positionY.value = 0;
      chain.panner.positionZ.value = -Math.cos(rad) * 2;
      chain.gain.connect(chain.panner).connect(ctx.destination);
    } else {
      chain.gain.connect(ctx.destination);
    }
    chain.spatial = spatial;
    chain.gain.gain.value = deafened ? 0 : this.volumeOf(link.userId);
  }

  /** Whether an audio stream that just arrived belongs to a shared screen (not to the voice of the person). */
  private isScreenAudio(link: Link, stream: MediaStream): boolean {
    if (stream.id === link.screenStreamId) {
      return true;
    }
    return link.voiceStreamId !== undefined && stream.id !== link.voiceStreamId;
  }

  /** Plays the sound of the screen a person shares, through its own volume. */
  private attachScreenAudio(link: Link, stream: MediaStream, track: MediaStreamTrack): void {
    this.destroyScreenChain(link);
    const ctx = this.sound.context;
    // Chromium only delivers remote WebRTC audio to WebAudio if the stream is also attached to an element.
    const element = new Audio();
    element.srcObject = stream;
    element.muted = true;
    void element.play().catch(function () {
      return undefined;
    });
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    link.screenAudioIn = { element, source, gain };
    this.configureScreenChain(link, this.deafened());
    this.screenSound.update(function add(now) {
      return { ...now, [link.userId]: true };
    });
    track.addEventListener(
      'ended',
      function gone(this: CallService) {
        if (link.screenAudioIn?.source.mediaStream === stream) {
          this.destroyScreenChain(link);
        }
      }.bind(this),
    );
  }

  /** Sets the volume of the sound of the screen of a person (zero while the person is deafened). */
  private configureScreenChain(link: Link, deafened: boolean): void {
    const chain = link.screenAudioIn;
    if (chain) {
      chain.gain.gain.value = deafened ? 0 : this.screenVolumeOf(link.userId);
    }
  }

  /** The volume of the shared screen of a person as a gain (1 is the normal level, 2 is double). */
  private screenVolumeOf(userId: string): number {
    const percent = this.settings.screenVolumes()[userId] ?? 100;
    return Math.max(0, Math.min(200, percent)) / 100;
  }

  /** Sets how loud the shared screen of a person is for this device, from 0 to 200 percent (remembered for the next calls). */
  setScreenVolume(userId: string, percent: number): void {
    const value = Math.max(0, Math.min(200, Math.round(percent)));
    const volumes = { ...this.settings.screenVolumes() };
    if (value === 100) delete volumes[userId];
    else volumes[userId] = value;
    this.settings.screenVolumes.set(volumes);
    const link = this.links.get(userId);
    if (link?.screenAudioIn && !this.deafened()) link.screenAudioIn.gain.gain.value = value / 100;
  }

  /** Disconnects and removes the sound of the screen of a person. */
  private destroyScreenChain(link: Link): void {
    const chain = link.screenAudioIn;
    if (!chain) return;
    chain.source.disconnect();
    chain.gain.disconnect();
    chain.element.srcObject = null;
    link.screenAudioIn = undefined;
    this.screenSound.update(function drop(now) {
      const { [link.userId]: _gone, ...rest } = now;
      return rest;
    });
  }

  /** The volume of a person as the gain of the audio chain (1 is the normal level, 2 is double). */
  private volumeOf(userId: string): number {
    const percent = this.settings.peerVolumes()[userId] ?? 100;
    return Math.max(0, Math.min(200, percent)) / 100;
  }

  /**
   * Sets how loud a person is for this device, from 0 to 200 percent. It applies right away to the call that is going
   * on (even if they are speaking) and is remembered for the next calls with them.
   */
  setPeerVolume(userId: string, percent: number): void {
    const value = Math.max(0, Math.min(200, Math.round(percent)));
    const volumes = { ...this.settings.peerVolumes() };
    if (value === 100) delete volumes[userId];
    else volumes[userId] = value;
    this.settings.peerVolumes.set(volumes);
    const link = this.links.get(userId);
    if (link?.audioIn && !this.deafened()) link.audioIn.gain.gain.value = value / 100;
  }

  /** Disconnects and removes the audio chain of a person. */
  private destroyChain(link: Link): void {
    const chain = link.audioIn;
    if (!chain) return;
    chain.source.disconnect();
    chain.gain.disconnect();
    chain.panner.disconnect();
    chain.element.srcObject = null;
    link.audioIn = undefined;
  }

  // ---- telemetry (real numbers from getStats) -----------------------------------------------

  private async collectStats(): Promise<void> {
    if (needsIceRefresh(this.iceExpiresAt, Date.now())) void this.refreshIce();
    if (!this.links.size) {
      this.stats.set({ ...EMPTY_STATS });
      return;
    }
    const rtts: number[] = [];
    const jitters: number[] = [];
    let out = 0;
    let inn = 0;
    let lost = 0;
    let received = 0;
    let cipher: string | null = null;
    let dtls: string | null = null;
    let connected = 0;

    for (const link of this.links.values()) {
      if (link.pc.connectionState === 'connected') connected++;
      const report = await link.pc.getStats().catch(function () {
        return null;
      });
      if (!report) continue;
      this.enforceRelay(link, report);
      if (!this.enforceFrameEncryption(link)) continue;
      const now = performance.now();
      let bytesIn = 0;
      let bytesOut = 0;
      let linkRtt: number | null = null;
      const videoLoss = { lost: 0, sent: 0 };
      let selectedPair: string | undefined;
      report.forEach(function (s) {
        if (s.type === 'transport') {
          selectedPair = s.selectedCandidatePairId ?? selectedPair;
          cipher = s.srtpCipher ?? cipher;
          dtls = s.dtlsState ?? dtls;
        }
      });
      report.forEach(
        function (this: CallService, s: any) {
          if (
            s.type === 'candidate-pair' &&
            (s.id === selectedPair || (s.nominated && s.state === 'succeeded'))
          ) {
            if (typeof s.currentRoundTripTime === 'number') {
              rtts.push(s.currentRoundTripTime * 1000);
              linkRtt = s.currentRoundTripTime * 1000;
              const rounded = Math.round(linkRtt);
              // Only a real change wakes the screen of the call.
              if (this.peers()[link.userId]?.rttMs !== rounded)
                this.updatePeer(link.userId, { rttMs: rounded });
            }
          } else if (s.type === 'inbound-rtp') {
            bytesIn += s.bytesReceived ?? 0;
            if (s.kind === 'audio') {
              if (typeof s.jitter === 'number') jitters.push(s.jitter * 1000);
              lost += s.packetsLost ?? 0;
              received += s.packetsReceived ?? 0;
            }
          } else if (s.type === 'outbound-rtp') {
            bytesOut += s.bytesSent ?? 0;
            if (s.kind === 'video') videoLoss.sent += s.packetsSent ?? 0;
          } else if (s.type === 'remote-inbound-rtp' && s.kind === 'video') {
            videoLoss.lost += Math.max(0, s.packetsLost ?? 0);
          }
        }.bind(this),
      );
      if (link.senders.camera?.length || link.senders.screen?.length) {
        this.adaptVideo(link, linkRtt, videoLoss);
        void this.adaptCpu(link);
      }
      const seconds = Math.max(0.2, (now - link.lastBytes.at) / 1000);
      inn += Math.max(0, ((bytesIn - link.lastBytes.in) * 8) / 1000 / seconds);
      out += Math.max(0, ((bytesOut - link.lastBytes.out) * 8) / 1000 / seconds);
      link.lastBytes = { in: bytesIn, out: bytesOut, at: now };
    }

    const avg = function (list: number[]) {
      return list.length
        ? list.reduce(function (a, b) {
            return a + b;
          }, 0) / list.length
        : null;
    };
    const rtt = avg(rtts);
    this.stats.set({
      rttMs: rtt === null ? null : Math.round(rtt * 10) / 10,
      jitterMs: jitters.length ? Math.round(Math.max(...jitters) * 100) / 100 : null,
      lossPct: lost + received > 0 ? Math.round((lost / (lost + received)) * 1000) / 10 : 0,
      outKbps: Math.round(out),
      inKbps: Math.round(inn),
      srtpCipher: cipher,
      dtlsState: dtls,
      connectedPeers: connected,
    });
    if (rtt !== null)
      this.rttHistory.update(function (h) {
        return [...h.slice(-59), Math.round(rtt * 10) / 10];
      });
  }

  // ---- cleanup -------------------------------------------------------------------------------

  private stopStream(stream: MediaStream | null): void {
    if (stream && this.fxs.has(stream)) {
      // The camera with effects: stopping it also stops the raw camera behind it (its light goes off).
      this.fxs.get(stream)!.stop();
      this.fxs.delete(stream);
    }
    stream?.getTracks().forEach(function (t) {
      return t.stop();
    });
  }

  /** Ends everything about the call: timers, connections, microphone, camera and screen. */
  private teardown(): void {
    this.clipsSentTo.clear();
    this.incomingClips.clear();
    this.receivedClips.clear();
    this.music.set(null);
    this.musicControl.set(null);
    this.musicQueue.set([]);
    this.skipVotes.set([]);
    this.onSpinlyReset?.();
    clearInterval(this.meterTimer);
    clearInterval(this.statsTimer);
    for (const id of [...this.links.keys()]) this.closeLink(id);
    this.stopStream(this.micStream);
    this.stopStream(this.localCamera());
    stopAndroidScreen();
    this.stopStream(this.localScreen());
    this.micSource?.disconnect();
    this.gate?.disconnect();
    this.micStream = null;
    this.micSource = null;
    this.gate = null;
    this.sendDest = null;
    this.sendTrack = null;
    this.localAnalyser = null;
    this.localCamera.set(null);
    this.localScreen.set(null);
    this.cameraOn.set(false);
    this.screenOn.set(false);
    this.roomId.set(null);
    this.pendingRoom = null;
    this.participants.set([]);
    this.peers.set({});
    this.levels.set({});
    this.speaking.set(new Set());
    this.stats.set({ ...EMPTY_STATS });
    this.rttHistory.set([]);
    this.previousParticipants = new Set();
    this.status.set('idle');
    this.worker?.terminate();
    this.worker = null;
    // The next call asks the server again: nothing about how to connect is remembered between calls.
    this.peerConfiguration = null;
    this.relayRequired = false;
    this.iceExpiresAt = null;
    this.untrustedWarned.clear();
  }
}
