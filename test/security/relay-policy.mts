/**
 * test/security/relay-policy.mts
 * The relay-only policy of the browser side.
 */
import {
  RelayUnavailableError,
  buildPeerConfiguration,
  credentialExpiry,
  earliestExpiry,
  isFreshSignal,
  isRelayCandidate,
  needsIceRefresh,
  selectedPathKind,
} from '../../frontend/src/app/core/rtc-policy';
import fs from 'node:fs';
import path from 'node:path';
import { check, step, call } from './support.mts';

/** The source folder of the app. */
const FRONTEND = path.join(import.meta.dirname, '..', '..', 'frontend', 'src', 'app');

/** Every TypeScript file of the app (not the tests of Angular). */
function findFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) found.push(full);
  }
  return found;
}

/** The relay-only policy of the browser side. */
export async function checkRelayPolicy(): Promise<void> {
  step('calls: relay-only policy in the browser (fail closed)');
  const now = Date.now();
  const future = Math.floor(now / 1000) + 3600;
  const turnServer = function (expiry = future): RTCIceServer {
    return {
      urls: [
        'turn:relay.test:3478?transport=udp',
        'turn:relay.test:3478?transport=tcp',
        'stun:relay.test:3478',
      ],
      username: `${expiry}:user`,
      credential: 'cred',
    };
  };
  const stunServer: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };
  /** True when building the configuration throws the relay error. */
  const refuses = function (response: never, at = now): boolean {
    try {
      buildPeerConfiguration(response, at);
      return false;
    } catch (error) {
      return error instanceof RelayUnavailableError;
    }
  };

  const strict = buildPeerConfiguration(
    { iceServers: [stunServer, turnServer()], relayOnly: true },
    now,
  );
  check(
    strict.configuration.iceTransportPolicy === 'relay' && strict.relayRequired,
    'relay-only gives iceTransportPolicy "relay"',
  );
  check(strict.configuration.iceServers!.length === 1, 'only the relay server is kept (no STUN)');
  check(
    (strict.configuration.iceServers![0]!.urls as string[]).every(function isTurn(url) {
      return url.startsWith('turn:');
    }),
    'and only its TURN addresses',
  );
  check(
    buildPeerConfiguration({ iceServers: [stunServer], relayOnly: false }, now).configuration
      .iceTransportPolicy === 'all',
    'without a requirement, the normal policy is used',
  );
  check(
    refuses({ iceServers: [], relayOnly: true } as never),
    'relay-only with no ICE server at all does not start the call',
  );
  check(
    refuses({ iceServers: [stunServer], relayOnly: true } as never),
    'relay-only with only STUN does not start the call (no direct fallback)',
  );
  check(
    refuses({
      iceServers: [{ urls: ['turn:relay.test:3478'] }],
      relayOnly: true,
    } as never),
    'a relay without credentials is not usable',
  );
  check(
    refuses({
      iceServers: [{ urls: 'turn:relay.test:3478', username: 'u', credential: '' }],
      relayOnly: true,
    } as never),
    'a relay with an empty credential is not usable',
  );
  check(
    refuses({
      iceServers: [turnServer(Math.floor(now / 1000) - 10)],
      relayOnly: true,
    } as never),
    'expired relay credentials do not start the call',
  );
  check(
    refuses({
      iceServers: [turnServer(Math.floor(now / 1000) + 5)],
      relayOnly: true,
    } as never),
    'credentials about to expire do not start the call',
  );
  check(refuses(undefined as never), 'a missing answer does not start the call');
  check(refuses({ relayOnly: true } as never), 'an answer without servers does not start the call');
  check(
    refuses({ iceServers: 'turn:x', relayOnly: true } as never),
    'a malformed answer does not start the call',
  );

  check(
    credentialExpiry(turnServer(future)) === future * 1000,
    'the expiry of a credential is read from its username',
  );
  check(
    credentialExpiry({ urls: 'turn:x', username: 'plain', credential: 'c' }) === null,
    'a username without expiry has none',
  );
  check(
    earliestExpiry([turnServer(future), turnServer(future + 100), stunServer]) === future * 1000,
    'the earliest expiry is used for the renewal',
  );
  check(earliestExpiry([stunServer]) === null, 'no relay means nothing to renew');
  check(
    needsIceRefresh(now + 5 * 60_000, now) &&
      !needsIceRefresh(now + 30 * 60_000, now) &&
      !needsIceRefresh(null, now),
    'credentials are renewed ten minutes before they expire',
  );

  check(
    isRelayCandidate(
      'candidate:1 1 udp 41885439 203.0.113.5 50000 typ relay raddr 0.0.0.0 rport 0',
    ),
    'a relay candidate is recognised',
  );
  check(
    !isRelayCandidate('candidate:2 1 udp 2113937151 192.168.1.5 50000 typ host'),
    'a host candidate is not relayed',
  );
  check(
    !isRelayCandidate(
      'candidate:3 1 udp 1677729535 198.51.100.7 50000 typ srflx raddr 192.168.1.5 rport 50000',
    ),
    'a server reflexive candidate is not relayed',
  );
  check(
    !isRelayCandidate('candidate:4 1 tcp 1 192.0.2.1 9 typ host tcptype active'),
    'a TCP host candidate is not relayed',
  );

  /** A statistics report like the ones of the browsers. */
  const report = function (entries: Record<string, unknown>[]) {
    return {
      forEach: function each(callback: (entry: never) => void) {
        for (const entry of entries) callback(entry as never);
      },
    };
  };
  check(
    selectedPathKind(
      report([
        { type: 'transport', id: 'T', selectedCandidatePairId: 'P' },
        { type: 'candidate-pair', id: 'P', localCandidateId: 'L' },
        { type: 'local-candidate', id: 'L', candidateType: 'relay' },
      ]),
    ) === 'relay',
    'a selected relay candidate is reported as relay (Chrome statistics)',
  );
  check(
    selectedPathKind(
      report([
        { type: 'transport', id: 'T', selectedCandidatePairId: 'P' },
        { type: 'candidate-pair', id: 'P', localCandidateId: 'L' },
        { type: 'local-candidate', id: 'L', candidateType: 'srflx' },
      ]),
    ) === 'direct',
    'a selected server-reflexive candidate is reported as direct',
  );
  check(
    selectedPathKind(
      report([
        {
          type: 'candidate-pair',
          id: 'P',
          selected: true,
          localCandidateId: 'L',
        },
        { type: 'local-candidate', id: 'L', candidateType: 'host' },
      ]),
    ) === 'direct',
    'a host candidate is reported as direct (Firefox statistics)',
  );
  check(
    selectedPathKind(report([])) === 'unknown',
    'before the connection is made nothing is claimed',
  );

  step('calls: the native apps require the relay over TLS whatever the server says');
  const tlsServer = function (expiry = future): RTCIceServer {
    return {
      urls: [
        'turns:relay.test:5349?transport=tcp',
        'turn:relay.test:3478?transport=udp',
        'stun:relay.test:3478',
      ],
      username: `${expiry}:user`,
      credential: 'cred',
    };
  };
  /** The configuration of the native apps for an answer of the server. */
  const native = function (response: never, at = now) {
    return buildPeerConfiguration(response, at, true);
  };
  /** True when the strict policy refuses to start the call. */
  const nativeRefuses = function (response: never, at = now): boolean {
    try {
      native(response, at);
      return false;
    } catch (error) {
      return error instanceof RelayUnavailableError;
    }
  };
  /** Every address a configuration lets the browser use. */
  const addresses = function (configuration: RTCConfiguration): string[] {
    return (configuration.iceServers ?? []).flatMap(function urls(server) {
      return Array.isArray(server.urls) ? server.urls : [server.urls];
    });
  };
  const hostile = native({ iceServers: [stunServer, tlsServer()], relayOnly: false } as never);
  check(
    hostile.relayRequired && hostile.configuration.iceTransportPolicy === 'relay',
    'a server that answers relayOnly:false cannot turn off the relay of a native app',
  );
  check(
    addresses(hostile.configuration).length === 1 &&
      addresses(hostile.configuration)[0] === 'turns:relay.test:5349?transport=tcp',
    'only the turns: address is kept: no STUN and no turn: in clear',
  );
  const silent = native({ iceServers: [tlsServer()] } as never);
  check(
    silent.relayRequired && silent.configuration.iceTransportPolicy === 'relay',
    'an answer that says nothing about the relay still gets the relay',
  );
  check(
    nativeRefuses({ iceServers: [turnServer()], relayOnly: true } as never),
    'a relay offered only as turn: (in clear) does not start the call',
  );
  check(
    nativeRefuses({ iceServers: [stunServer, turnServer()], relayOnly: false } as never),
    'STUN plus turn: in clear with relayOnly:false does not start the call (no direct fallback)',
  );
  check(
    nativeRefuses({ iceServers: [stunServer], relayOnly: false } as never),
    'only STUN does not start the call',
  );
  check(
    nativeRefuses({ iceServers: [], relayOnly: false } as never),
    'no ICE server does not start it',
  );
  check(
    nativeRefuses({ iceServers: [tlsServer(Math.floor(now / 1000) - 10)] } as never),
    'expired turns: credentials do not start the call',
  );
  check(
    nativeRefuses({
      iceServers: [{ urls: 'turns:relay.test:5349', username: 'u', credential: '' }],
    } as never),
    'a turns: relay without a credential is not usable',
  );
  check(
    nativeRefuses({
      iceServers: [
        { urls: ['turns:', 'turns: relay.test'], username: `${future}:u`, credential: 'c' },
      ],
    } as never),
    'an empty or malformed turns: address is not usable',
  );
  check(
    buildPeerConfiguration({ iceServers: [turnServer()], relayOnly: true }, now, false)
      .configuration.iceTransportPolicy === 'relay' &&
      buildPeerConfiguration({ iceServers: [stunServer], relayOnly: false }, now, false)
        .configuration.iceTransportPolicy === 'all',
    'the web and desktop apps keep their behaviour (the server decides, turn: is accepted)',
  );

  step('calls: every connection of a call is built by the relay policy');
  const source = fs.readFileSync(
    path.join(FRONTEND, 'core', 'services', 'call.service.ts'),
    'utf8',
  );
  const makers = findFiles(FRONTEND).filter(function makesConnections(file) {
    return /new\s+RTCPeerConnection\s*\(/.test(fs.readFileSync(file, 'utf8'));
  });
  check(
    makers
      .map(function relative(file) {
        return path.relative(FRONTEND, file).split(path.sep).join('/');
      })
      .sort()
      .join(',') === 'core/services/call.service.ts,core/services/overlay.service.ts',
    'only the call service and the local desktop overlay open WebRTC connections (a new one needs a review)',
  );
  check(
    (source.match(/new\s+RTCPeerConnection\s*\(/g) ?? []).length === 1 &&
      /new\s+RTCPeerConnection\(this\.peerConfiguration\)/.test(source),
    'the call service opens connections only with the configuration that the policy built',
  );
  const builds = source.match(/buildPeerConfiguration\([^;]*\)/g) ?? [];
  check(
    builds.length === 2 &&
      builds.every(function strict(text) {
        return text.includes('STRICT_RELAY');
      }),
    'both places that build the configuration (start and renewal) pass the native policy',
  );
  const overlay = fs.readFileSync(
    path.join(FRONTEND, 'core', 'services', 'overlay.service.ts'),
    'utf8',
  );
  check(
    /new RTCPeerConnection\(\{ iceServers: \[\] \}\)/.test(overlay),
    'the overlay connection has no ICE server at all (it never leaves the computer)',
  );

  check(
    isFreshSignal(now, now) &&
      isFreshSignal(now - 4 * 60_000, now) &&
      isFreshSignal(now + 4 * 60_000, now),
    'a recent signal is accepted',
  );
  check(
    !isFreshSignal(now - 10 * 60_000, now) && !isFreshSignal(now + 10 * 60_000, now),
    'a recording of an old signal is refused',
  );
  check(
    !isFreshSignal(undefined, now) && !isFreshSignal('now', now) && !isFreshSignal(NaN, now),
    'a signal without a valid time is refused',
  );
}
