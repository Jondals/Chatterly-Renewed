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
import { check, step, call } from './support.mts';

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
