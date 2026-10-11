/**
 * src/app/store/e2ee.service.ts
 * Encrypts and decrypts messages and reactions according to the kind of conversation (direct or group).
 */
import type { SpinlyActivity } from '../features/spinly/spinly-model';
import type { SpinlyResult } from '../features/spinly/spinly-result';
import type { LinkPreview } from '../shared/util/link-preview';
import { Injectable, inject } from '@angular/core';
import type { FileSecret } from '../core/crypto/files';
import {
  derivePairKey,
  messageContext,
  open,
  reactionContext,
  seal,
  signSealed,
  verifySealed,
  type Sealed,
} from '../core/crypto/pairwise';
import type { ChannelRef, RawMessage, RawReaction } from '../core/models';
import { AuthService } from '../core/services/auth.service';
import { DirectoryService } from '../core/services/directory.service';
import { GuildStore } from './guild.store';
import { SocialStore } from './social.store';

/** What lives inside the encrypted envelope of a message. */
export interface MessagePayload {
  v: 1;
  text: string;
  replyTo?: string;
  attachments?: AttachmentPayload[];
  /** Result of a Spinly wheel or tournament shared in the chat. */
  spinly?: SpinlyResult;
  /** A wheel or tournament everybody in the conversation can run once. */
  spinlyLive?: SpinlyActivity;
  /** Card of the link, only when the sender decided to attach it. */
  preview?: LinkPreview;
}

export interface AttachmentPayload {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  secret: FileSecret;
  /** Optional waveform (0-1 samples) for voice notes. */
  wave?: number[];
  durationMs?: number;
  /** Sent from the sticker tab: shown large, without a bubble. */
  sticker?: boolean;
  /** How an animated sticker moves (0 to 5). */
  move?: number;
  /** Picked from the GIF tab (downloaded via the server, then re-encrypted like any file). */
  gif?: boolean;
  /** The sender offers this audio or video for the soundboard: the others get a button to add it to theirs. */
  soundboard?: boolean;
  /** The name of the pack of sounds this one belongs to (the people who receive it can add the whole pack). */
  pack?: string;
  /** The emoji of a sound that is shared for the soundboard. */
  emoji?: string;
  /** A preset of the theme or of the profile: the people who get it have a button to import it. */
  preset?: { kind: 'theme' | 'profile'; name: string; thumb?: string };
}

export interface SealedForServer extends Sealed {
  signature: string;
  keyVersion: number;
}

/** Turns plaintext into signed ciphertext (and back) for a given conversation. */
@Injectable({ providedIn: 'root' })
export class E2eeService {
  private readonly auth = inject(AuthService);
  private readonly directory = inject(DirectoryService);
  private readonly social = inject(SocialStore);
  private readonly guilds = inject(GuildStore);

  private readonly dmKeys = new Map<string, Promise<CryptoKey>>();

  /** How to open a channel (direct chat or group) from its id. */
  refFor(channelId: string): ChannelRef | undefined {
    const dm = this.social.dmByChannel(channelId);
    if (dm) return { kind: 'dm', channelId, otherUserId: dm.userId };
    return this.guilds.channelRef(channelId);
  }

  /** The version of the key a channel uses now. */
  currentKeyVersion(ref: ChannelRef): number {
    return ref.kind === 'guild' ? this.guilds.currentVersion(ref.guildId) : 1;
  }

  /** The key of a channel: the group key, or the one shared with the friend (derived once and kept). */
  private async keyFor(ref: ChannelRef, version: number): Promise<CryptoKey> {
    if (ref.kind === 'guild') return this.guilds.keyFor(ref.guildId, version);
    const other = await this.directory.require(ref.otherUserId);
    const cacheKey = `${ref.channelId}|${other.publicKeys.ecdh}`;
    let promise = this.dmKeys.get(cacheKey);
    if (!promise) {
      promise = derivePairKey(
        this.auth.identity.ecdhPrivate,
        this.auth.identity.publicKeys.ecdh,
        other.publicKeys.ecdh,
        ref.channelId,
      );
      this.dmKeys.set(cacheKey, promise);
    }
    return promise;
  }

  /** `keyVersion` defaults to the channel's current key; edits must keep the original version. */
  async encryptMessage(
    ref: ChannelRef,
    payload: MessagePayload,
    keyVersion = this.currentKeyVersion(ref),
  ): Promise<SealedForServer> {
    const context = messageContext(ref.channelId, this.auth.userId, keyVersion);
    const sealed = await seal(await this.keyFor(ref, keyVersion), payload, context);
    const signature = await signSealed(this.auth.identity.ecdsaPrivate, context, sealed);
    return { ...sealed, signature, keyVersion };
  }

  async decryptMessage(
    ref: ChannelRef,
    raw: Pick<
      RawMessage,
      'channelId' | 'senderId' | 'keyVersion' | 'iv' | 'ciphertext' | 'signature'
    >,
  ): Promise<{ payload: MessagePayload | null; verified: boolean }> {
    const context = messageContext(raw.channelId, raw.senderId, raw.keyVersion);
    const sealed = { iv: raw.iv, ciphertext: raw.ciphertext };
    let payload: MessagePayload | null = null;
    try {
      payload = await open<MessagePayload>(await this.keyFor(ref, raw.keyVersion), sealed, context);
    } catch {
      return { payload: null, verified: false };
    }
    const sender = await this.directory.require(raw.senderId);
    const verified = await verifySealed(sender.publicKeys.ecdsa, context, sealed, raw.signature);
    return { payload, verified };
  }

  /**
   * Encrypts a reaction with the key of the channel, tied to its message so it cannot be moved to another.
   */
  async encryptReaction(ref: ChannelRef, messageId: string, keyVersion: number, emoji: string) {
    const context = reactionContext(ref.channelId, messageId, this.auth.userId, keyVersion);
    const sealed = await seal(await this.keyFor(ref, keyVersion), { emoji }, context);
    return {
      ...sealed,
      signature: await signSealed(this.auth.identity.ecdsaPrivate, context, sealed),
    };
  }

  async decryptReaction(
    ref: ChannelRef,
    keyVersion: number,
    reaction: RawReaction,
  ): Promise<string | null> {
    const context = reactionContext(ref.channelId, reaction.messageId, reaction.userId, keyVersion);
    const sealed = { iv: reaction.iv, ciphertext: reaction.ciphertext };
    try {
      const { emoji } = await open<{ emoji: string }>(
        await this.keyFor(ref, keyVersion),
        sealed,
        context,
      );
      const user = await this.directory.require(reaction.userId);
      return (await verifySealed(user.publicKeys.ecdsa, context, sealed, reaction.signature))
        ? emoji
        : null;
    } catch {
      return null;
    }
  }
}
