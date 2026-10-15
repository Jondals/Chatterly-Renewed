/**
 * src/ws/socket.ts
 * The /ws route: authenticates the connection and handles the realtime messages (typing, calls, signaling).
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context';
import { areFriends, canAccessChannel, channelAudience, getChannel } from '../models';
import { isSessionLive } from '../security/sessions';
import type { Client, Presence } from './hub';

const PRESENCE_VALUES: Presence[] = ['online', 'idle', 'dnd', 'invisible'];
const MAX_SIGNAL_BYTES = 48 * 1024;

/**
 * Whether a page was served from the same address that opens the socket (a browser cannot forge the Host header, so
 * this is as safe as the list of origins, and it keeps working when the list was not written for the real domain).
 */
function isSameHost(origin: string, host: string | undefined): boolean {
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Json = Record<string, unknown>;

/**
 * WebSocket protocol (JSON frames, `t` discriminates):
 *   -> { t: 'auth', token }               first frame, must arrive within 5 s
 *   <- { t: 'ready', userId, presence }
 * After that the server pushes events (message.*, presence, call.*, ...) and accepts
 * typing / presence.set / call.* / rtc.signal frames. `rtc.signal` payloads are opaque,
 * end-to-end encrypted blobs that the server only relays.
 */
export function registerSocket(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub, config } = ctx;

  const announceRoom = function (roomId: string) {
    const channel = getChannel(db, roomId);
    if (!channel) return;
    hub.sendToMany(channelAudience(db, channel), {
      t: 'call.state',
      roomId,
      participants: hub.participants(roomId),
    });
  };
  hub.onRoomChange = announceRoom;

  app.get('/ws', { websocket: true }, function (socket: WebSocket, req) {
    // ! Cross-site WebSocket hijacking guard. Non-browser clients send no Origin.
    const origin = req.headers.origin;
    if (origin && !config.corsOrigins.includes(origin) && !isSameHost(origin, req.headers.host)) {
      socket.close(1008, 'origin not allowed');
      return;
    }

    const send = function (message: unknown) {
      if (socket.readyState === 1) socket.send(JSON.stringify(message));
    };
    let client: Client | undefined;
    const authTimer = setTimeout(function () {
      return socket.close(4401, 'auth timeout');
    }, 5000);
    let budget = 1500; // frames per 10 s window (a 30 s sound is sent to each person in about 80 frames)
    const budgetTimer = setInterval(function () {
      return (budget = 1500);
    }, 10_000);
    let alive = true;
    let sessionId = '';
    const heartbeat = setInterval(function () {
      if (!alive) return socket.terminate();
      // ! A connection must not outlive its session (sign out from another device, password change, erased account).
      if (client && !isSessionLive(db, sessionId, client.userId)) {
        return socket.close(4401, 'session ended');
      }
      alive = false;
      socket.ping();
    }, 30_000);
    socket.on('pong', function () {
      return (alive = true);
    });

    const cleanup = function () {
      clearTimeout(authTimer);
      clearInterval(budgetTimer);
      clearInterval(heartbeat);
      if (client) hub.detach(client);
      client = undefined;
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);

    socket.on('message', function (raw: Buffer) {
      if (--budget < 0) return socket.close(1008, 'rate limit');
      let msg: Json;
      try {
        msg = JSON.parse(raw.toString());
        if (typeof msg !== 'object' || msg === null || typeof msg['t'] !== 'string')
          throw new Error();
      } catch {
        return socket.close(1003, 'bad frame');
      }

      if (!client) {
        if (msg['t'] !== 'auth' || typeof msg['token'] !== 'string')
          return socket.close(4401, 'unauthenticated');
        let userId: string;
        try {
          const claims = app.jwt.verify(msg['token']) as {
            sub: string;
            sid?: string;
          };
          userId = claims.sub;
          sessionId = claims.sid ?? '';
        } catch {
          return socket.close(4401, 'invalid token');
        }
        if (!sessionId || !isSessionLive(db, sessionId, userId))
          return socket.close(4401, 'session ended');
        clearTimeout(authTimer);
        client = {
          id: randomUUID(),
          userId,
          sessionId,
          send,
          close: function (code, reason) {
            return socket.close(code, reason);
          },
        };
        hub.attach(client);
        send({
          t: 'ready',
          userId,
          presence: hub.snapshotFor(userId),
          serverTime: Date.now(),
        });
        // Let the client see who is already in the voice channels / calls it has access to.
        for (const roomId of hub.activeRoomIds()) {
          const channel = getChannel(db, roomId);
          if (channel && canAccessChannel(db, channel, userId)) {
            send({
              t: 'call.state',
              roomId,
              participants: hub.participants(roomId),
            });
          }
        }
        return;
      }

      handle(client, msg, send);
    });
  });

  /**
   * Handles a frame of an authenticated connection: typing, presence, joining and leaving calls and relaying signals between people of the same room.
   */
  function handle(client: Client, msg: Json, send: (m: unknown) => void): void {
    const userId = client.userId;
    switch (msg['t']) {
      case 'ping':
        send({ t: 'pong', ts: msg['ts'] ?? null });
        return;

      case 'presence.set':
        if (PRESENCE_VALUES.includes(msg['status'] as Presence))
          hub.setStatus(userId, msg['status'] as Presence);
        return;

      case 'typing': {
        const channel =
          typeof msg['channelId'] === 'string' ? getChannel(db, msg['channelId']) : undefined;
        if (!channel || !canAccessChannel(db, channel, userId)) return;
        hub.sendToMany(
          channelAudience(db, channel),
          { t: 'typing', channelId: channel.id, userId },
          userId,
        );
        return;
      }

      case 'call.join': {
        const channel =
          typeof msg['roomId'] === 'string' ? getChannel(db, msg['roomId']) : undefined;
        if (!channel || channel.type === 'text' || !canAccessChannel(db, channel, userId)) {
          return send({ t: 'error', code: 'room_not_found' });
        }
        if (channel.type === 'dm') {
          const other = channelAudience(db, channel).find(function (id) {
            return id !== userId;
          });
          if (!other || !areFriends(db, userId, other))
            return send({ t: 'error', code: 'not_friends' });
        }
        const wasEmpty = hub.participants(channel.id).length === 0;
        const heldRoom = hub.roomOf(userId);
        const joined = hub.joinRoom(channel.id, client);
        if (!joined.ok) return send({ t: 'error', code: 'room_full' });
        // ! The person joined from another of their devices: that one leaves the call quietly (it must not send "leave",
        //   which would take away the place that has just moved here).
        if (joined.replaced && heldRoom) {
          joined.replaced.send({ t: 'call.transferred', roomId: heldRoom });
        }
        send({
          t: 'call.joined',
          roomId: channel.id,
          participants: hub.participants(channel.id),
        });
        announceRoom(channel.id);
        if (channel.type === 'dm' && wasEmpty) {
          for (const id of channelAudience(db, channel)) {
            if (id !== userId)
              hub.sendTo(id, {
                t: 'call.incoming',
                roomId: channel.id,
                from: userId,
              });
          }
        }
        return;
      }

      case 'call.leave': {
        // A device whose call already moved to another one cannot end it there.
        if (!hub.isCallClient(client)) return;
        const room = hub.leaveRoom(userId);
        if (room) send({ t: 'call.left', roomId: room });
        return;
      }

      case 'call.update': {
        if (!hub.isCallClient(client)) return;
        const room = hub.roomOf(userId);
        if (!room) return;
        const patch: Record<string, boolean> = {};
        for (const key of ['muted', 'deafened', 'video', 'screen']) {
          if (typeof msg[key] === 'boolean') patch[key] = msg[key] as boolean;
        }
        if (hub.updateParticipant(room, userId, patch)) announceRoom(room);
        return;
      }

      case 'rtc.signal': {
        const roomId = msg['roomId'];
        const to = msg['to'];
        const payload = msg['payload'];
        if (
          typeof roomId !== 'string' ||
          typeof to !== 'string' ||
          typeof payload !== 'object' ||
          !payload
        )
          return;
        if (JSON.stringify(payload).length > MAX_SIGNAL_BYTES) return;
        if (!hub.isCallClient(client) || !hub.inSameRoom(roomId, userId, to)) return;
        hub.sendToCall(to, { t: 'rtc.signal', roomId, from: userId, payload });
        return;
      }

      default:
        return;
    }
  }
}
