/**
 * src/ws/hub.ts
 * Registry of WebSocket connections, presence and call rooms; it delivers the events to whoever should get them.
 */
import type { Db } from '../db';
import { areFriends, presenceAudience } from '../models';

export type Presence = 'online' | 'idle' | 'dnd' | 'invisible';
export type PublicPresence = 'online' | 'idle' | 'dnd' | 'offline';

export interface Client {
  id: string;
  userId: string;
  /** The session the connection was opened with; closing that session closes the connection. */
  sessionId: string;
  send(message: unknown): void;
  close(code?: number, reason?: string): void;
}

export interface Participant {
  userId: string;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
  joinedAt: number;
}

const MAX_ROOM_SIZE = 8; // full-mesh P2P: every extra peer adds an upstream per participant.

/** The most connections (tabs, devices) one person can keep open at once. */
const MAX_CONNECTIONS_PER_USER = 8;
/** How long a person keeps their place in a call after their connection drops (the app asks for it back when it reconnects). */
const HELD_CALL_MS = 25_000;

/**
 * ! Tracks live sockets, presence and call rooms. It never inspects payloads of `rtc.signal`
 * messages: those are end-to-end encrypted between peers.
 */
export class Hub {
  private readonly clients = new Map<string, Set<Client>>();
  private readonly statuses = new Map<string, Presence>();
  private readonly rooms = new Map<string, Map<string, Participant>>();
  private readonly userRoom = new Map<string, string>();
  /**
   * ! The one connection (device) that holds the place of each person in their call. A person can be signed in on the
   * phone and on the computer at once, but only one of them is in the call: signals go only to that connection, and only
   * it may change or leave the place. Joining from another device moves the place there (see joinRoom).
   */
  private readonly callClient = new Map<string, Client>();
  /**
   * People whose connection dropped while they were in a call: they keep their place for a while (the media of a call does not go
   * through this server, so it may go on) and take it back with 'call.resume' when the app reconnects. A phone that goes to the
   * background, or changes network, closes its connection for a few seconds and used to be taken out of the call.
   */
  private readonly heldCalls = new Map<string, ReturnType<typeof setTimeout>>();

  private closed = false;

  constructor(private readonly db: Db) {}

  /** Disconnects everyone; later detach/broadcast calls become no-ops (the DB is about to close). */
  shutdown(): void {
    this.closed = true;
    for (const timer of this.heldCalls.values()) clearTimeout(timer);
    this.heldCalls.clear();
    for (const set of this.clients.values())
      for (const client of set) client.close(1001, 'server shutting down');
    this.clients.clear();
    this.rooms.clear();
    this.userRoom.clear();
    this.callClient.clear();
  }

  // ---- connections -------------------------------------------------------------------------

  attach(client: Client): void {
    const set = this.clients.get(client.userId) ?? new Set<Client>();
    const first = set.size === 0;
    // A person has a few open tabs, not hundreds: the oldest connection leaves when there are too many.
    while (set.size >= MAX_CONNECTIONS_PER_USER) {
      const oldest = set.values().next().value as Client;
      set.delete(oldest);
      oldest.close(4429, 'too many connections');
    }
    set.add(client);
    this.clients.set(client.userId, set);
    if (first) this.broadcastPresence(client.userId);
  }

  /**
   * A connection closed. When it held the place of the person in a call, they leave it (the app ends the call when its
   * connection drops, so the place would stay empty otherwise); when it was their last connection they go offline.
   */
  detach(client: Client): void {
    if (this.closed) return;
    const set = this.clients.get(client.userId);
    if (!set) return;
    set.delete(client);
    const held = this.callClient.get(client.userId) === client;
    if (held) this.holdCall(client.userId);
    if (set.size === 0) {
      this.clients.delete(client.userId);
      if (!held) this.leaveRoom(client.userId);
      this.statuses.delete(client.userId);
      this.broadcastPresence(client.userId);
    }
  }

  /**
   * The connection that held the place of a person in a call dropped: the place is kept for HELD_CALL_MS. If they come back and
   * ask (resume) it is theirs again; if not, they leave the call as before.
   */
  private holdCall(userId: string): void {
    this.callClient.delete(userId);
    if (!this.userRoom.has(userId)) return;
    clearTimeout(this.heldCalls.get(userId));
    this.heldCalls.set(
      userId,
      setTimeout(this.expireHeld.bind(this, userId), HELD_CALL_MS),
    );
  }

  /** The time to come back ran out: the person leaves the call. */
  private expireHeld(userId: string): void {
    this.heldCalls.delete(userId);
    this.leaveRoom(userId);
  }

  /** Forgets a kept place (the person joined again, left or came back). */
  private clearHeld(userId: string): void {
    clearTimeout(this.heldCalls.get(userId));
    this.heldCalls.delete(userId);
  }

  /**
   * A connection asks for the place its person kept in a call: true (and the place is theirs again, with the state they had) when
   * that place is still there and it is in the room they name.
   */
  resume(client: Client, roomId: string): boolean {
    const userId = client.userId;
    if (!this.heldCalls.has(userId) || this.userRoom.get(userId) !== roomId) return false;
    this.clearHeld(userId);
    this.callClient.set(userId, client);
    return true;
  }

  /** Closes every connection of a person (their account was erased) and takes them out of their call. */
  dropUser(userId: string): void {
    this.leaveRoom(userId);
    for (const client of [...(this.clients.get(userId) ?? [])])
      client.close(4401, 'account deleted');
  }

  /**
   * * Closes the connections of a person that belong to revoked sessions: all of them, or all except the session
   * that is being kept (the one that has just changed the password).
   *
   * @param userId Owner of the sessions.
   * @param keepSessionId Session whose connections stay open, if any.
   */
  closeSessions(userId: string, keepSessionId?: string): void {
    for (const client of [...(this.clients.get(userId) ?? [])]) {
      if (client.sessionId !== keepSessionId) client.close(4401, 'session ended');
    }
  }

  /** Closes the connections opened with one session (it was signed out). */
  closeSession(userId: string, sessionId: string): void {
    for (const client of [...(this.clients.get(userId) ?? [])]) {
      if (client.sessionId === sessionId) client.close(4401, 'session ended');
    }
  }

  /** Whether a connection opened with this session is open now. */
  isSessionOnline(userId: string, sessionId: string): boolean {
    for (const client of this.clients.get(userId) ?? []) {
      if (client.sessionId === sessionId) return true;
    }
    return false;
  }

  /** How many connections are open. */
  connectionCount(): number {
    let n = 0;
    for (const set of this.clients.values()) n += set.size;
    return n;
  }

  /** Sends a message to every open connection (an announcement of the server). */
  broadcast(message: unknown): void {
    for (const set of this.clients.values()) for (const client of set) client.send(message);
  }

  /** How many people have at least one connection open. */
  onlineCount(): number {
    return this.clients.size;
  }

  /** How many calls are going on, and how many people are in them. */
  callCounts(): { calls: number; people: number } {
    let people = 0;
    for (const room of this.rooms.values()) people += room.size;
    return { calls: this.rooms.size, people };
  }

  /** Sends a message to every connection of a person (their tabs and devices). */
  sendTo(userId: string, message: unknown): void {
    const set = this.clients.get(userId);
    if (!set) return;
    for (const client of set) client.send(message);
  }

  /**
   * Sends a message about a call to the one connection that is in it for that person (the signals of a call must reach a
   * single device: two devices answering the same offer broke the call). Nothing is sent when they are not in a call.
   */
  sendToCall(userId: string, message: unknown): void {
    this.callClient.get(userId)?.send(message);
  }

  /** Whether this connection is the one that holds the place of its person in a call. */
  isCallClient(client: Client): boolean {
    return this.callClient.get(client.userId) === client;
  }

  /** Sends a message to several people, except one if asked. */
  sendToMany(userIds: Iterable<string>, message: unknown, except?: string): void {
    for (const id of userIds) if (id !== except) this.sendTo(id, message);
  }

  // ---- presence ----------------------------------------------------------------------------

  setStatus(userId: string, status: Presence): void {
    if (!this.clients.has(userId)) return;
    // ! The same status again changes nothing: it is not sent to every friend again (a client could repeat it to flood them).
    if ((this.statuses.get(userId) ?? 'online') === status) return;
    this.statuses.set(userId, status);
    this.broadcastPresence(userId);
  }

  /** What other people get to see: invisible looks offline. */
  presenceOf(userId: string): PublicPresence {
    if (!this.clients.has(userId)) return 'offline';
    const status = this.statuses.get(userId) ?? 'online';
    return status === 'invisible' ? 'offline' : status;
  }

  /**
   * Whether `viewerId` may see the online status of `targetId`, by the choice of the second one: everybody (the default),
   * only their friends, or nobody (they look offline to everybody else).
   */
  canSeePresence(targetId: string, viewerId: string): boolean {
    const row = this.db
      .prepare('SELECT presence_visibility AS choice FROM users WHERE id = ?')
      .get(targetId) as { choice: string } | undefined;
    const choice = row?.choice ?? 'everyone';
    if (choice === 'nobody') return false;
    if (choice === 'friends') return areFriends(this.db, targetId, viewerId);
    return true;
  }

  /** The presence of the people the person may see (each one's own privacy choice applies), to send it when they connect. */
  snapshotFor(userId: string): { userId: string; status: PublicPresence }[] {
    return presenceAudience(this.db, userId)
      .map(
        function (this: Hub, id: string) {
          return {
            userId: id,
            status: this.canSeePresence(id, userId) ? this.presenceOf(id) : ('offline' as const),
          };
        }.bind(this),
      )
      .filter(function (p) {
        return p.status !== 'offline';
      });
  }

  /**
   * Tells the people around a person that their presence changed. Each one gets what the person allows them to see:
   * somebody who is not allowed gets "offline", whatever the real state is (also right after the choice changes).
   */
  refreshPresence(userId: string): void {
    this.broadcastPresence(userId);
  }

  /** Sends the presence of a person to each one who may know it (and "offline" to those who may not). */
  private broadcastPresence(userId: string): void {
    const real = this.presenceOf(userId);
    for (const id of presenceAudience(this.db, userId)) {
      const status = this.canSeePresence(userId, id) ? real : 'offline';
      this.sendTo(id, { t: 'presence', userId, status });
    }
    // The user's other devices should also reflect the new state.
    this.sendTo(userId, { t: 'presence', userId, status: real });
  }

  // ---- call rooms --------------------------------------------------------------------------

  activeRoomIds(): string[] {
    return [...this.rooms.keys()];
  }

  /** Who is in a call room. */
  participants(roomId: string): Participant[] {
    return [...(this.rooms.get(roomId)?.values() ?? [])];
  }

  /** The room a person is in. */
  roomOf(userId: string): string | undefined {
    return this.userRoom.get(userId);
  }

  /** Whether two people are in the same room: calls only relay signals between them. */
  inSameRoom(roomId: string, a: string, b: string): boolean {
    const room = this.rooms.get(roomId);
    return !!room && room.has(a) && room.has(b);
  }

  /**
   * Puts a connection of a person in a room. Returns false when the room is full. Leaves any previous room first.
   * When another connection of the same person held their place (in this room or another one), the place moves to this
   * one and that connection is returned as `replaced`, to be told that its call goes on somewhere else.
   */
  joinRoom(
    roomId: string,
    client: Client,
  ): { ok: boolean; previousRoom?: string; replaced?: Client } {
    const userId = client.userId;
    this.clearHeld(userId);
    const existing = this.rooms.get(roomId);
    if (existing && !existing.has(userId) && existing.size >= MAX_ROOM_SIZE) return { ok: false };
    const holder = this.callClient.get(userId);
    const replaced = holder && holder !== client ? holder : undefined;
    const previous = this.userRoom.get(userId);
    if (previous && previous !== roomId) this.leaveRoom(userId);
    const room = existing ?? new Map<string, Participant>();
    room.set(userId, {
      userId,
      muted: false,
      deafened: false,
      video: false,
      screen: false,
      joinedAt: Date.now(),
    });
    this.rooms.set(roomId, room);
    this.userRoom.set(userId, roomId);
    this.callClient.set(userId, client);
    return {
      ok: true,
      previousRoom: previous && previous !== roomId ? previous : undefined,
      replaced,
    };
  }

  updateParticipant(
    roomId: string,
    userId: string,
    patch: Partial<Pick<Participant, 'muted' | 'deafened' | 'video' | 'screen'>>,
  ): boolean {
    const participant = this.rooms.get(roomId)?.get(userId);
    if (!participant) return false;
    Object.assign(participant, patch);
    return true;
  }

  /** Removes the user from their room; returns the room id they left (if any). */
  leaveRoom(userId: string): string | undefined {
    this.clearHeld(userId);
    this.callClient.delete(userId);
    const roomId = this.userRoom.get(userId);
    if (!roomId) return undefined;
    this.userRoom.delete(userId);
    const room = this.rooms.get(roomId);
    room?.delete(userId);
    if (room && room.size === 0) this.rooms.delete(roomId);
    this.onRoomChange?.(roomId);
    return roomId;
  }

  /** Set by the socket layer so room changes are announced to the right audience. */
  onRoomChange?: (roomId: string) => void;
}
