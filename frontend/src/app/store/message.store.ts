/**
 * src/app/store/message.store.ts
 * Decrypted messages in memory: sending, editing, reactions and realtime events.
 */
import type { LinkPreview } from '../shared/util/link-preview';
import { Injectable, inject, signal, type WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { decryptFile, encryptFile } from '../core/crypto/files';
import { THUMB_MAX_CHARS, THUMB_PATTERN } from '../core/preset-card';
import type { ChannelRef, RawMessage, RawReaction } from '../core/models';
import { ApiError, ApiService } from '../core/services/api.service';
import { AuthService } from '../core/services/auth.service';
import { DirectoryService } from '../core/services/directory.service';
import { SettingsService } from '../core/services/settings.service';
import { SocketService, type ServerEvent } from '../core/services/socket.service';
import { SoundService } from '../core/services/sound.service';
import { ToastService } from '../core/services/toast.service';
import { replaceShortcodes } from '../shared/util/emoji';
import { ReceiptService, type MessageStatus } from '../core/services/receipt.service';
import { makeSeekable } from '../core/seekable-audio';
import { E2eeService, type AttachmentPayload, type MessagePayload } from './e2ee.service';
import { RUN_MARK, sanitizeActivity, type SpinlyActivity } from '../features/spinly/spinly-model';
import { sanitizeResult, type SpinlyResult } from '../features/spinly/spinly-result';
import { GuildStore } from './guild.store';
import { SocialStore } from './social.store';

type AttachmentKind = 'image' | 'audio' | 'video' | 'file';

/** The most decrypted files (pictures, GIFs, voice notes) kept in memory at once. */
const MAX_DECRYPTED_FILES = 120;

export interface ViewAttachment extends AttachmentPayload {
  kind: AttachmentKind;
}

export interface ViewReaction {
  emoji: string;
  users: string[];
  mine: boolean;
}

interface ReactionItem {
  id: string;
  userId: string;
  emoji: string;
}

export interface ViewMessage {
  id: string;
  seq: number;
  channelId: string;
  senderId: string;
  createdAt: number;
  editedAt: number | null;
  keyVersion: number;
  text: string;
  replyTo?: string;
  attachments: ViewAttachment[];
  spinly?: SpinlyResult;
  /** A wheel or tournament that can be run once by anyone in the conversation. */
  activity?: SpinlyActivity;
  preview?: LinkPreview;
  /** Signature checked against the sender's pinned identity key. */
  verified: boolean;
  undecryptable: boolean;
  reactions: ViewReaction[];
  reactionItems: ReactionItem[];
  /** Local-only state while the message is being encrypted/uploaded/sent. */
  pending?: { uploading: number };
  failed?: boolean;
}

/** What a message says about a preset it carries: the kind and a short name, nothing else is believed. */
function cleanPresetMark(
  raw: unknown,
): { kind: 'theme' | 'profile'; name: string; thumb?: string } | undefined {
  const mark = raw as { kind?: unknown; name?: unknown; thumb?: unknown } | undefined;
  if (
    !mark ||
    (mark.kind !== 'theme' && mark.kind !== 'profile') ||
    typeof mark.name !== 'string'
  ) {
    return undefined;
  }
  // the picture is shown as an image: only a small WebP of this form is believed
  const thumb =
    typeof mark.thumb === 'string' &&
    mark.thumb.length <= THUMB_MAX_CHARS &&
    THUMB_PATTERN.test(mark.thumb)
      ? mark.thumb
      : undefined;
  return {
    kind: mark.kind,
    name: mark.name.replace(/[\u0000-\u001f]/g, ' ').slice(0, 30),
    thumb,
  };
}

export interface OutgoingFile {
  data: Blob;
  name: string;
  mime: string;
  wave?: number[];
  durationMs?: number;
  sticker?: boolean;
  /** How an animated sticker moves (0 to 5). */
  move?: number;
  gif?: boolean;
  /** Offered for the soundboard of the others (audio and video only). */
  soundboard?: boolean;
  pack?: string;
  emoji?: string;
  /** A preset of the theme or of the profile (the people who get it can import it). */
  preset?: { kind: 'theme' | 'profile'; name: string; thumb?: string };
}

export interface ChannelState {
  messages: WritableSignal<ViewMessage[]>;
  loading: WritableSignal<boolean>;
  loaded: WritableSignal<boolean>;
  hasMore: WritableSignal<boolean>;
  typing: WritableSignal<Record<string, number>>;
}

const INLINE_MIME: Record<AttachmentKind, RegExp | null> = {
  image: /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/,
  audio: /^audio\/(webm|ogg|mpeg|mp3|wav|mp4|aac|x-m4a)(;.*)?$/,
  video: /^video\/(mp4|webm|ogg)(;.*)?$/,
  file: null,
};

/**
 * The kind of an attachment from its type (image, audio, video or plain file): it decides how the chat draws it.
 */
function attachmentKind(mime: string): AttachmentKind {
  for (const kind of ['image', 'audio', 'video'] as const) {
    if (INLINE_MIME[kind]!.test(mime)) return kind;
  }
  return 'file';
}

const PAGE = 50;

/**
 * Decrypts and holds the conversation history. Plaintext exists only here, in memory: the server
 * stores and relays ciphertext, signatures and encrypted attachment blobs.
 */
/** The text of a message without its marks of format, on one line (for a preview). */
function plainPreview(text: string): string {
  return text
    .replace(/[*_~`|>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

@Injectable({ providedIn: 'root' })
export class MessageStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly directory = inject(DirectoryService);
  private readonly e2ee = inject(E2eeService);
  private readonly guilds = inject(GuildStore);
  private readonly social = inject(SocialStore);
  private readonly socket = inject(SocketService);
  private readonly sound = inject(SoundService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly receipts = inject(ReceiptService);

  private readonly states = new Map<string, ChannelState>();
  private readonly attachmentCache = new Map<string, Promise<string>>();
  private started = false;
  private localId = 0;

  /** The last message that arrived from somebody else while its chat was not in view (the overlay shows it). */
  readonly lastIncoming = signal<{
    seq: number;
    ref: ChannelRef;
    senderId: string;
    text: string;
  } | null>(null);
  readonly unread = signal<Record<string, number>>({});
  /** The conversation currently on screen (used to suppress notifications). */
  readonly viewing = signal<string | null>(null);

  /**
   * The state of a channel (messages, typing people, loading flags); it is created the first time it is asked for so every screen shares it.
   */
  state(channelId: string): ChannelState {
    let state = this.states.get(channelId);
    if (!state) {
      state = {
        messages: signal<ViewMessage[]>([]),
        loading: signal(false),
        loaded: signal(false),
        hasMore: signal(true),
        typing: signal<Record<string, number>>({}),
      };
      this.states.set(channelId, state);
    }
    return state;
  }

  /**
   * A chat that is not on screen any more keeps only its latest messages: the longer a session lasts the more chats were opened,
   * and every message kept is memory (and, when the chat opens again, rows to draw). The older ones are asked for again if the
   * person scrolls up (`hasMore`). ! Only the newest messages stay, so what arrives later still follows them without a gap.
   */
  trim(channelId: string, keep = 60): void {
    const state = this.states.get(channelId);
    if (!state || this.viewing() === channelId) return;
    const list = state.messages();
    if (list.length <= keep * 2) return;
    state.messages.set(list.slice(-keep));
    state.hasMore.set(true);
  }

  /**
   * Starts listening to the server (new, edited and deleted messages, reactions, typing); only once, however many screens ask.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.receipts.start();
    document.addEventListener('visibilitychange', this.onVisibilityChange.bind(this));
    // A window that is visible but not in front (another one has the focus) has not been READ yet: it counts as read when it
    // gets the focus back.
    window.addEventListener('focus', this.onVisibilityChange.bind(this));
    this.socket.events$.subscribe(
      function (this: MessageStore, event: ServerEvent) {
        const e = event as unknown as Record<string, unknown>;
        switch (event.t) {
          case 'message.new':
            void this.onNew(e['message'] as RawMessage);
            break;
          case 'message.edit':
            void this.onEdit(e['message'] as RawMessage);
            break;
          case 'message.delete':
            this.removeLocal(e['channelId'] as string, e['messageId'] as string);
            break;
          case 'reaction.add':
            void this.onReactionAdd(e['channelId'] as string, e['reaction'] as RawReaction);
            break;
          case 'reaction.remove':
            this.onReactionRemove(
              e['channelId'] as string,
              e['messageId'] as string,
              e['reactionId'] as string,
            );
            break;
          case 'typing':
            this.onTyping(e['channelId'] as string, e['userId'] as string);
            break;
        }
      }.bind(this),
    );
  }

  /**
   * Forgets everything (messages, cached attachments): used when the person signs out so nothing of them stays in memory.
   */
  reset(): void {
    this.states.clear();
    this.attachmentCache.forEach(function (p) {
      return void p
        .then(function (url) {
          return URL.revokeObjectURL(url);
        })
        .catch(function () {
          return undefined;
        });
    });
    this.attachmentCache.clear();
    this.unread.set({});
    this.receipts.reset();
  }

  // ---- loading -------------------------------------------------------------------------------

  async open(channelId: string): Promise<void> {
    this.clearUnread(channelId);
    const state = this.state(channelId);
    if (!state.loaded()) await this.loadPage(channelId);
    this.markSeen(channelId);
    void this.receipts.load(channelId).catch(this.ignoreError);
  }

  /** State (sent, delivered, read) of one of your messages. */
  statusOf(message: ViewMessage): MessageStatus {
    return this.receipts.statusOf(message.channelId, message.seq, !!message.pending);
  }

  /** Tells the server that this device has received (and, if the conversation is on screen, read) the newest message. */
  private markSeen(channelId: string): void {
    const list = this.state(channelId).messages();
    let newest = 0;
    for (const message of list) {
      if (!message.pending && !message.failed && message.seq > newest) {
        newest = message.seq;
      }
    }
    this.receipts.seen(channelId, newest, this.isReading(channelId));
  }

  /**
   * True when the person can be reading the conversation: it is open, the window is visible AND it is the one in front. Otherwise the
   * message only counts as delivered (the green dot of the sender) until the window comes to the front.
   */
  private isReading(channelId: string): boolean {
    return this.viewing() === channelId && !document.hidden && document.hasFocus();
  }

  /** When the tab becomes visible again, or the window gets the focus, whatever conversation is open counts as read. */
  private onVisibilityChange(): void {
    const channelId = this.viewing();
    if (channelId && !document.hidden) {
      this.clearUnread(channelId);
      this.markSeen(channelId);
    }
  }

  /** Marks that fail to load are not worth an error message. */
  private ignoreError(): void {
    return;
  }

  /** Loads the page of messages before the oldest one shown, for the 'Load earlier messages' button. */
  async loadOlder(channelId: string): Promise<void> {
    const state = this.state(channelId);
    const first = state.messages().find(function (m) {
      return !m.pending;
    });
    if (!first || state.loading() || !state.hasMore()) return;
    await this.loadPage(channelId, first.seq);
  }

  /**
   * ? Finds the keys that open a channel; when the groups or friends are not loaded yet it loads them first, because without them nothing can be decrypted.
   */
  private async resolveRef(channelId: string): Promise<ChannelRef> {
    let ref = this.e2ee.refFor(channelId);
    if (!ref) {
      await Promise.all([this.social.refresh(), this.guilds.refresh()]);
      ref = this.e2ee.refFor(channelId);
    }
    if (!ref) throw new Error('Unknown conversation');
    return ref;
  }

  /**
   * Downloads a page of messages and decrypts each one; the order and the flags keep the list stable while it loads.
   */
  private async loadPage(channelId: string, before?: number): Promise<void> {
    const state = this.state(channelId);
    state.loading.set(true);
    try {
      const ref = await this.resolveRef(channelId);
      const res = await this.api.get<{ messages: RawMessage[]; hasMore: boolean }>(
        `/api/channels/${channelId}/messages?limit=${PAGE}${before ? `&before=${before}` : ''}`,
      );
      await this.directory.ensure(
        res.messages.map(function (m) {
          return m.senderId;
        }),
      );
      const views = await Promise.all(
        res.messages.map(
          function (this: MessageStore, m: RawMessage) {
            return this.toView(ref, m);
          }.bind(this),
        ),
      );
      state.messages.update(function (current) {
        const known = new Set(
          current.map(function (m) {
            return m.id;
          }),
        );
        const merged = [
          ...views.filter(function (v) {
            return !known.has(v.id);
          }),
          ...current,
        ];
        return merged.sort(function (a, b) {
          return (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || a.seq - b.seq;
        });
      });
      state.hasMore.set(res.hasMore);
      state.loaded.set(true);
    } finally {
      state.loading.set(false);
    }
  }

  /**
   * Turns a message of the server into one the screen can draw: decrypts it, checks its signature and decrypts its reactions.
   */
  private async toView(ref: ChannelRef, raw: RawMessage): Promise<ViewMessage> {
    const { payload, verified } = await this.e2ee.decryptMessage(ref, raw);
    const reactionItems: ReactionItem[] = [];
    for (const reaction of raw.reactions) {
      const emoji = await this.e2ee.decryptReaction(ref, raw.keyVersion, reaction);
      if (emoji) reactionItems.push({ id: reaction.id, userId: reaction.userId, emoji });
    }
    return {
      id: raw.id,
      seq: raw.seq,
      channelId: raw.channelId,
      senderId: raw.senderId,
      createdAt: raw.createdAt,
      editedAt: raw.editedAt,
      keyVersion: raw.keyVersion,
      text: payload?.text ?? '',
      replyTo: payload?.replyTo,
      attachments: (payload?.attachments ?? []).map(function (a) {
        // What comes from another person is cut to what is shown: a pack name and an emoji, nothing longer.
        return {
          ...a,
          kind: attachmentKind(a.mime),
          pack: typeof a.pack === 'string' ? a.pack.slice(0, 20) : undefined,
          emoji: typeof a.emoji === 'string' ? a.emoji.slice(0, 8) : undefined,
          preset: cleanPresetMark(a.preset),
          move: Number.isInteger(a.move) ? Math.min(5, Math.max(0, a.move!)) : undefined,
        };
      }),
      spinly: payload?.spinly ? (sanitizeResult(payload.spinly) ?? undefined) : undefined,
      activity: payload?.spinlyLive
        ? (sanitizeActivity(payload.spinlyLive) ?? undefined)
        : undefined,
      preview: payload?.preview,
      verified,
      undecryptable: !payload,
      reactions: this.group(reactionItems),
      reactionItems,
    };
  }

  /**
   * Groups the reactions of a message by emoji (who and how many), hiding the hidden mark that runs a Spinly wheel.
   */
  private group(items: ReactionItem[]): ViewReaction[] {
    const me = this.auth.user()?.id;
    const byEmoji = new Map<string, ViewReaction>();
    for (const item of items) {
      if (item.emoji === RUN_MARK) continue;
      const entry = byEmoji.get(item.emoji) ?? { emoji: item.emoji, users: [], mine: false };
      entry.users.push(item.userId);
      entry.mine ||= item.userId === me;
      byEmoji.set(item.emoji, entry);
    }
    return [...byEmoji.values()];
  }

  // ---- sending -------------------------------------------------------------------------------

  async send(
    channelId: string,
    input: { text: string; files?: OutgoingFile[]; replyTo?: string; preview?: LinkPreview },
  ): Promise<void> {
    const ref = await this.resolveRef(channelId);
    const state = this.state(channelId);
    const text = replaceShortcodes(input.text.trim());
    const files = input.files ?? [];
    if (!text && !files.length) return;

    const temp: ViewMessage = {
      id: `local-${++this.localId}`,
      seq: Number.MAX_SAFE_INTEGER,
      channelId,
      senderId: this.auth.userId,
      createdAt: Date.now(),
      editedAt: null,
      keyVersion: this.e2ee.currentKeyVersion(ref),
      text,
      replyTo: input.replyTo,
      attachments: [],
      verified: true,
      undecryptable: false,
      reactions: [],
      reactionItems: [],
      pending: { uploading: files.length },
    };
    state.messages.update(function (list) {
      return [...list, temp];
    });

    try {
      const attachments: AttachmentPayload[] = [];
      for (const file of files) {
        const { cipher, secret } = await encryptFile(await file.data.arrayBuffer());
        const { fileId } = await this.api.upload<{ fileId: string }>(
          `/api/channels/${channelId}/files`,
          cipher,
        );
        attachments.push({
          fileId,
          name: file.name,
          mime: file.mime,
          size: file.data.size,
          secret,
          wave: file.wave,
          durationMs: file.durationMs,
          sticker: file.sticker,
          move: file.move,
          gif: file.gif,
          soundboard: file.soundboard || undefined,
          pack: file.pack || undefined,
          emoji: file.emoji || undefined,
          preset: file.preset,
        });
      }
      const payload: MessagePayload = {
        v: 1,
        text,
        replyTo: input.replyTo,
        attachments: attachments.length ? attachments : undefined,
        preview: input.preview,
      };
      const raw = await this.postSealed(ref, channelId, payload);
      const view = await this.toView(ref, raw);
      state.messages.update(
        function (this: MessageStore, list: ViewMessage[]) {
          return this.upsert(
            list.filter(function (m) {
              return m.id !== temp.id;
            }),
            view,
          );
        }.bind(this),
      );
      this.sound.play('send');
    } catch (error) {
      state.messages.update(function (list) {
        return list.map(function (m) {
          return m.id === temp.id ? { ...m, pending: undefined, failed: true } : m;
        });
      });
      throw error;
    }
  }

  private async postSealed(
    ref: ChannelRef,
    channelId: string,
    payload: MessagePayload,
  ): Promise<RawMessage> {
    for (let attempt = 0; ; attempt++) {
      const sealed = await this.e2ee.encryptMessage(ref, payload);
      try {
        const res = await this.api.post<{ message: RawMessage }>(
          `/api/channels/${channelId}/messages`,
          sealed,
        );
        return res.message;
      } catch (error) {
        // The group key rotated while we were typing: fetch the new one and encrypt again.
        if (attempt === 0 && error instanceof ApiError && error.code === 'stale_key_version') {
          await this.guilds.refresh();
          continue;
        }
        throw error;
      }
    }
  }

  /** Posts the result of a Spinly wheel or tournament in the channel (encrypted like any other message). */
  async sendSpinly(channelId: string, result: SpinlyResult): Promise<void> {
    const ref = await this.resolveRef(channelId);
    const label = result.kind === 'wheel' ? '🎡 ' : '🏆 ';
    const payload: MessagePayload = { v: 1, text: label + result.winner, spinly: result };
    const raw = await this.postSealed(ref, channelId, payload);
    const view = await this.toView(ref, raw);
    this.state(channelId).messages.update(
      function (this: MessageStore, list: ViewMessage[]) {
        return this.upsert(list, view);
      }.bind(this),
    );
    this.sound.play('send');
  }

  /** Posts a wheel or tournament that everybody in the conversation can run once (encrypted like any other message). */
  async sendSpinlyActivity(channelId: string, activity: SpinlyActivity): Promise<void> {
    const ref = await this.resolveRef(channelId);
    const title = activity.kind === 'wheel' ? activity.wheel.title : activity.tournament.title;
    const payload: MessagePayload = {
      v: 1,
      text: (activity.kind === 'wheel' ? '🎡 ' : '🏆 ') + (title || 'Spinly'),
      spinlyLive: activity,
    };
    const raw = await this.postSealed(ref, channelId, payload);
    const view = await this.toView(ref, raw);
    this.state(channelId).messages.update(
      function (this: MessageStore, list: ViewMessage[]) {
        return this.upsert(list, view);
      }.bind(this),
    );
    this.sound.play('send');
  }

  /** Runs the wheel or tournament of a message: the first run is the only one that counts, and the server's random id of it decides the result. */
  async runSpinly(message: ViewMessage): Promise<void> {
    const taken = message.reactionItems.some(function isRun(item) {
      return item.emoji === RUN_MARK;
    });
    if (taken) return;
    const ref = await this.resolveRef(message.channelId);
    const sealed = await this.e2ee.encryptReaction(ref, message.id, message.keyVersion, RUN_MARK);
    await this.api.post(`/api/messages/${message.id}/reactions`, sealed);
  }

  /** Takes a message that failed to send out of the list. */
  dismissFailed(channelId: string, id: string): void {
    this.removeLocal(channelId, id);
  }

  /** Edits a message: the new text is encrypted and signed again, so the server never sees it in clear. */
  async edit(message: ViewMessage, newText: string): Promise<void> {
    const ref = await this.resolveRef(message.channelId);
    const text = replaceShortcodes(newText.trim());
    if (!text && !message.attachments.length) return;
    const payload: MessagePayload = {
      v: 1,
      text,
      replyTo: message.replyTo,
      attachments: message.attachments.length
        ? message.attachments.map(function ({ kind: _kind, ...rest }) {
            return rest;
          })
        : undefined,
    };
    // Receivers decrypt with the version stored on the row, so an edit keeps the original one.
    const sealed = await this.e2ee.encryptMessage(ref, payload, message.keyVersion);
    await this.api.patch(`/api/messages/${message.id}`, {
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      signature: sealed.signature,
    });
  }

  /**
   * Deletes a message for everybody (only the author or the owner of the group can; the server checks it).
   */
  async remove(message: ViewMessage): Promise<void> {
    await this.api.delete(`/api/messages/${message.id}`);
    this.removeLocal(message.channelId, message.id);
  }

  /** Adds the reaction of the person, or takes it away when it was already there. */
  async toggleReaction(message: ViewMessage, emoji: string): Promise<void> {
    const me = this.auth.userId;
    const mine = message.reactionItems.find(function (r) {
      return r.userId === me && r.emoji === emoji;
    });
    if (mine) {
      await this.api.delete(`/api/reactions/${mine.id}`);
      return;
    }
    const ref = await this.resolveRef(message.channelId);
    const sealed = await this.e2ee.encryptReaction(ref, message.id, message.keyVersion, emoji);
    await this.api.post(`/api/messages/${message.id}/reactions`, sealed);
  }

  /** Tells the others that the person is typing. */
  sendTyping(channelId: string): void {
    if (!this.settings.sendTyping()) return;
    this.socket.send({ t: 'typing', channelId });
  }

  // ---- attachments ---------------------------------------------------------------------------

  /**
   * Downloads, decrypts and integrity-checks an attachment and gives its bytes as a file (not through an address: the page
   * is not allowed to fetch a blob: address, and it does not need to).
   */
  async attachmentBlob(attachment: ViewAttachment): Promise<Blob> {
    const cipher = await this.api.download(`/api/files/${attachment.fileId}`);
    const plain = await decryptFile(cipher, attachment.secret);
    return new Blob([plain], { type: attachment.mime });
  }

  /** Downloads, decrypts and integrity-checks an attachment; resolves to an object URL. */
  attachmentUrl(attachment: ViewAttachment): Promise<string> {
    let promise = this.attachmentCache.get(attachment.fileId);
    if (promise) {
      // The most recently used go to the end: the ones that leave first are the ones not seen for longest.
      this.attachmentCache.delete(attachment.fileId);
      this.attachmentCache.set(attachment.fileId, promise);
    } else {
      promise = async function (this: MessageStore) {
        const cipher = await this.api.download(`/api/files/${attachment.fileId}`);
        const plain = await decryptFile(cipher, attachment.secret);
        // Anything that isn't an allow-listed media type is exposed as an opaque download.
        const type = attachment.kind === 'file' ? 'application/octet-stream' : attachment.mime;
        if (attachment.kind === 'audio') {
          // A recording made in the browser cannot be moved around as it is; it is written again so that it can.
          return URL.createObjectURL(await makeSeekable(plain, type));
        }
        return URL.createObjectURL(new Blob([plain], { type }));
      }.bind(this)();
      promise.catch(
        function (this: MessageStore) {
          return this.attachmentCache.delete(attachment.fileId);
        }.bind(this),
      );
      this.attachmentCache.set(attachment.fileId, promise);
      this.trimAttachments();
    }
    return promise;
  }

  /**
   * ! Keeps at most MAX_DECRYPTED_FILES decrypted files in memory. Every picture, GIF and voice note that was ever opened
   *   stayed there until the app closed, and a long chat full of GIFs filled the memory of a phone until the page froze.
   *   The ones not used for longest are released (opened again, they are decrypted again).
   */
  private trimAttachments(): void {
    while (this.attachmentCache.size > MAX_DECRYPTED_FILES) {
      const oldest = this.attachmentCache.keys().next().value as string;
      const promise = this.attachmentCache.get(oldest);
      this.attachmentCache.delete(oldest);
      void promise?.then(
        function revoke(url: string): void {
          URL.revokeObjectURL(url);
        },
        function ignore(): void {
          return undefined;
        },
      );
    }
  }

  // ---- realtime handlers ---------------------------------------------------------------------

  private upsert(list: ViewMessage[], view: ViewMessage): ViewMessage[] {
    if (
      list.some(function (m) {
        return m.id === view.id;
      })
    )
      return list.map(function (m) {
        return m.id === view.id ? view : m;
      });
    const pending = list.filter(function (m) {
      return m.pending || m.failed;
    });
    const settled = list.filter(function (m) {
      return !m.pending && !m.failed;
    });
    return [...settled, view]
      .sort(function (a, b) {
        return a.seq - b.seq;
      })
      .concat(pending);
  }

  /**
   * A message arrived: it is decrypted, added to the list and, if the person is not looking, counted as unread.
   */
  private async onNew(raw: RawMessage): Promise<void> {
    const mine = raw.senderId === this.auth.user()?.id;
    const state = this.states.get(raw.channelId);
    try {
      const ref = await this.resolveRef(raw.channelId);
      await this.directory.ensure([raw.senderId]);
      if (state?.loaded()) {
        const view = await this.toView(ref, raw);
        state.messages.update(
          function (this: MessageStore, list: ViewMessage[]) {
            return this.upsert(list, view);
          }.bind(this),
        );
        state.typing.update(function (t) {
          const { [raw.senderId]: _gone, ...rest } = t;
          return rest;
        });
        if (!mine) this.afterIncoming(ref, view);
      } else if (!mine) {
        this.afterIncoming(ref, await this.toView(ref, raw));
      }
      if (!mine) this.receipts.seen(raw.channelId, raw.seq, this.isReading(raw.channelId));
    } catch (error) {
      console.warn('Could not process incoming message', error);
    }
  }

  /**
   * What happens after a message from somebody else: unread counter, sound and desktop notice when the page is hidden.
   */
  private afterIncoming(ref: ChannelRef, view: ViewMessage): void {
    const visible = this.viewing() === view.channelId && !document.hidden;
    if (visible) return;
    // The overlay of the desktop app shows it over the game too (see OverlayService).
    this.lastIncoming.set({
      seq: (this.lastIncoming()?.seq ?? 0) + 1,
      ref,
      senderId: view.senderId,
      text: view.undecryptable
        ? '🔒'
        : plainPreview(view.text) || (view.attachments.length ? '📎' : ''),
    });
    this.unread.update(function (u) {
      return { ...u, [view.channelId]: (u[view.channelId] ?? 0) + 1 };
    });
    this.sound.play('message');
    const sender = this.directory.get(view.senderId);
    const where = ref.kind === 'guild' ? ` · #${ref.name}` : '';
    const preview = view.undecryptable
      ? '🔒 Encrypted message'
      : view.text || (view.attachments.length ? '📎 Attachment' : '');
    const title = `${sender?.displayName ?? 'Someone'}${where}`;
    if (!document.hidden) {
      this.toast.show({
        kind: 'message',
        title,
        body: preview.slice(0, 120),
        icon: '💬',
        action: function (this: MessageStore) {
          return this.openChannel(ref);
        }.bind(this),
      });
    } else if (
      this.settings.desktopNotifications() &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      // Deliberately generic: lock screens and notification centres are not end-to-end encrypted.
      const note = new Notification(title, {
        body: '🔒 New encrypted message',
        tag: view.channelId,
      });
      note.onclick = function (this: MessageStore) {
        window.focus();
        this.openChannel(ref);
      }.bind(this);
    }
  }

  /** Opens the screen of a channel (direct message, text channel or the call page). */
  openChannel(ref: ChannelRef): void {
    if (ref.kind === 'dm') void this.router.navigate(['/direct', ref.channelId]);
    else if (ref.type === 'voice') void this.router.navigate(['/voice']);
    else void this.router.navigate(['/guilds', ref.guildId, ref.channelId]);
  }

  /** A message was edited by its author: the copy on screen is replaced with the decrypted new one. */
  private async onEdit(raw: RawMessage): Promise<void> {
    const state = this.states.get(raw.channelId);
    if (!state?.loaded()) return;
    const existing = state.messages().find(function (m) {
      return m.id === raw.id;
    });
    const ref = await this.resolveRef(raw.channelId);
    const view = await this.toView(ref, { ...raw, reactions: [] });
    state.messages.update(function (list) {
      return list.map(function (m) {
        return m.id === raw.id
          ? {
              ...view,
              reactions: existing?.reactions ?? [],
              reactionItems: existing?.reactionItems ?? [],
            }
          : m;
      });
    });
  }

  /** Takes a message out of the list on this device only. */
  private removeLocal(channelId: string, messageId: string): void {
    this.states.get(channelId)?.messages.update(function (list) {
      return list.filter(function (m) {
        return m.id !== messageId;
      });
    });
  }

  /** A reaction arrived: it is decrypted and added to its message. */
  private async onReactionAdd(channelId: string, reaction: RawReaction): Promise<void> {
    const state = this.states.get(channelId);
    const message = state?.messages().find(function (m) {
      return m.id === reaction.messageId;
    });
    if (!state || !message) return;
    const ref = await this.resolveRef(channelId);
    await this.directory.ensure([reaction.userId]);
    const emoji = await this.e2ee.decryptReaction(ref, message.keyVersion, reaction);
    if (!emoji) return;
    state.messages.update(
      function (this: MessageStore, list: ViewMessage[]) {
        return list.map(
          function (this: MessageStore, m: ViewMessage) {
            if (
              m.id !== message.id ||
              m.reactionItems.some(function (r) {
                return r.id === reaction.id;
              })
            )
              return m;
            const reactionItems = [
              ...m.reactionItems,
              { id: reaction.id, userId: reaction.userId, emoji },
            ];
            return { ...m, reactionItems, reactions: this.group(reactionItems) };
          }.bind(this),
        );
      }.bind(this),
    );
  }

  /** A reaction was removed: it is taken out of its message. */
  private onReactionRemove(channelId: string, messageId: string, reactionId: string): void {
    this.states.get(channelId)?.messages.update(
      function (this: MessageStore, list: ViewMessage[]) {
        return list.map(
          function (this: MessageStore, m: ViewMessage) {
            if (m.id !== messageId) return m;
            const reactionItems = m.reactionItems.filter(function (r) {
              return r.id !== reactionId;
            });
            return { ...m, reactionItems, reactions: this.group(reactionItems) };
          }.bind(this),
        );
      }.bind(this),
    );
  }

  /**
   * Somebody is typing: they are remembered for four seconds and then forgotten, so the indicator disappears by itself.
   */
  private onTyping(channelId: string, userId: string): void {
    const state = this.state(channelId);
    const until = Date.now() + 4000;
    state.typing.update(function (t) {
      return { ...t, [userId]: until };
    });
    setTimeout(function () {
      state.typing.update(function (t) {
        if ((t[userId] ?? 0) > Date.now()) return t;
        const { [userId]: _expired, ...rest } = t;
        return rest;
      });
    }, 4100);
  }

  /** The person read the channel: its unread counter goes away. */
  clearUnread(channelId: string): void {
    this.unread.update(function (u) {
      if (!u[channelId]) return u;
      const { [channelId]: _read, ...rest } = u;
      return rest;
    });
  }
}
