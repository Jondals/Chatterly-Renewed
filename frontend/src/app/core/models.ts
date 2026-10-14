/**
 * src/app/core/models.ts
 * Data types shared by the client: users, groups, channels, messages and the values used to personalize a profile.
 */
import type { PublicKeys } from './crypto/identity';

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type SelfPresence = 'online' | 'idle' | 'dnd' | 'invisible';
export type AccentId =
  | 'mint'
  | 'violet'
  | 'coral'
  | 'quantum'
  | 'obsidian'
  | 'rose'
  | 'amber'
  | 'lime'
  | 'indigo'
  | 'custom';
/** A built-in font, 'custom' (the own uploaded font, on the own device) or "custom:<id>" (an uploaded font that friends see). */
export type NameFont =
  'default' | 'display' | 'serif' | 'mono' | 'script' | 'custom' | `custom:${string}`;
export type AuraId =
  | 'void'
  | 'prism'
  | 'pulse'
  | 'orbit'
  | 'dashed'
  | 'double'
  | 'glow'
  | 'ticks'
  | 'glitch'
  | 'rainbow'
  | 'comet'
  | 'nebula';

/** The tag of a group that a person shows next to their name. */
export interface ServerTag {
  guildId: string;
  text: string;
  color: string;
  icon: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  /** Real name while a nickname is being shown instead (only on the client). */
  realName?: string;
  bio: string;
  statusText: string;
  accent: AccentId;
  aura: AuraId;
  /** The two colors of the profile effect as "#rrggbb,#rrggbb", or empty to follow the theme. */
  auraColor: string;
  pronouns: string;
  avatarImage: string | null;
  bannerImage: string | null;
  bannerColor: string;
  profileColor: string;
  nameFont: NameFont;
  /** The encrypted font file of the own name (only the person themselves get it). */
  nameFontImage?: string | null;
  /** The animation of the name (see NAME_FX). */
  nameFx?: string;
  /** The tag of a group that the person chose to show (null: none). */
  serverTag?: ServerTag | null;
  avatarColor: string;
  publicKeys: PublicKeys;
  createdAt: number;
  /** The privacy choices of the person. The server sends them only to the person themselves. */
  privacy?: PrivacyChoices;
}

/** Who sees what: the choices that the server itself enforces. */
interface PrivacyChoices {
  /** Who sees that the person is online. */
  presenceVisibility: 'everyone' | 'friends' | 'nobody';
  /** Who may send them a friend request. */
  friendRequests: 'everyone' | 'nobody';
  /** Whether they appear when somebody searches for people. */
  searchable: boolean;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface GuildChannel {
  id: string;
  name: string;
  type: 'text' | 'voice';
  position: number;
}

interface GuildKeyRow {
  keyVersion: number;
  wrapperId: string;
  /** Public key of the wrapper when that person erased their account (their row is gone, the key is kept here). */
  wrapperPub?: string | null;
  iv: string;
  data: string;
}

/** A tag of a group, shown next to the name of the members who have it. */
export interface GuildTag {
  id: string;
  name: string;
  color: string;
}

export interface Guild {
  id: string;
  name: string;
  iconImage: string | null;
  ownerId: string;
  keyVersion: number;
  needsRotation: boolean;
  /** The tag of the group (empty text: it has none). */
  tag?: { text: string; color: string; icon: string };
  /** The key of the encrypted icon, sealed with the key of the group (null: an old icon that is not encrypted yet). */
  iconKey?: { keyVersion: number; iv: string; data: string } | null;
  channels: GuildChannel[];
  members: { userId: string; role: 'owner' | 'member'; tags: string[] }[];
  /** The tags of the group (only its owner creates them and gives them). */
  tags: GuildTag[];
  keys: GuildKeyRow[];
}

export interface DmSummary {
  channelId: string;
  userId: string;
  lastMessageAt: number | null;
}

export interface RawReaction {
  id: string;
  messageId: string;
  userId: string;
  iv: string;
  ciphertext: string;
  signature: string;
}

export interface RawMessage {
  id: string;
  seq: number;
  channelId: string;
  senderId: string;
  iv: string;
  ciphertext: string;
  keyVersion: number;
  signature: string;
  createdAt: number;
  editedAt: number | null;
  reactions: RawReaction[];
}

export interface CallParticipant {
  userId: string;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
  joinedAt: number;
}

/** Where a channel id points: a DM with one person, or a channel of a guild. */
export type ChannelRef =
  | { kind: 'dm'; channelId: string; otherUserId: string }
  | { kind: 'guild'; channelId: string; guildId: string; name: string; type: 'text' | 'voice' };
