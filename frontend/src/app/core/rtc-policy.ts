/**
 * src/app/core/rtc-policy.ts
 * Decides how a call may connect (which ICE servers it may use, and whether only a relay is allowed) and checks
 * that the connection that was really made follows that decision.
 *
 * ? Why it exists: hiding the addresses of the people in a call only works if the browser is forbidden to connect
 * in any other way. If the relay is missing, broken or its credentials have expired, the dangerous behaviour is to
 * quietly fall back to STUN or to a direct connection: the call works and the addresses leak. These functions make
 * ! that impossible to do by accident: when a relay is required and cannot be used they throw, and the call is not
 * started.
 *
 * Pure functions with no Angular, so they run in the single test without a browser.
 */

/** What `/api/rtc/config` answers. */
export interface RtcConfigResponse {
  iceServers: RTCIceServer[];
  /** The server requires every call to go through its relay. */
  relayOnly?: boolean;
  /** Lifetime of the relay credentials in seconds (0 when there is no relay). */
  ttlSec?: number;
  /** When the relay credentials stop working, in milliseconds since 1970 (0 when there is no relay). */
  expiresAt?: number;
}

/** The relay is required but there is no usable relay: the call must not start, and no direct fallback is allowed. */
export class RelayUnavailableError extends Error {
  /** Creates the error with a message that tells the person why the call was refused. */
  constructor(reason: string) {
    super(reason);
    this.name = 'RelayUnavailableError';
  }
}

/** The most the clock of a computer may differ from the server before credentials look expired. */
const CLOCK_MARGIN_MS = 60_000;

/** The urls of an ICE server as a list. */
function urlsOf(server: RTCIceServer): string[] {
  return Array.isArray(server.urls) ? server.urls : [server.urls];
}

/** True for the address of a TURN relay (`turn:` or `turns:`); STUN addresses cannot relay anything. */
function isTurnUrl(url: string): boolean {
  return /^turns?:/i.test(url);
}

/** True for the address of a TURN relay reached over TLS (`turns:`): the only kind the strict policy accepts. */
function isTlsTurnUrl(url: string): boolean {
  return /^turns:\S+$/i.test(url);
}

/**
 * When the credentials of a TURN server stop working, from the coturn scheme (`username = "<expiry seconds>:<user>"`),
 * in milliseconds since 1970. Null when the username does not follow the scheme.
 */
export function credentialExpiry(server: RTCIceServer): number | null {
  const expiry = Number((server.username ?? '').split(':')[0]);
  return Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : null;
}

/** True when a server is a TURN relay with credentials that have not expired. */
function isUsableRelay(server: RTCIceServer, now: number): boolean {
  if (!urlsOf(server).some(isTurnUrl)) return false;
  if (!server.username || typeof server.credential !== 'string' || !server.credential) return false;
  const expiry = credentialExpiry(server);
  return expiry === null || expiry - CLOCK_MARGIN_MS > now;
}

/**
 * Builds the configuration of an RTCPeerConnection from the answer of the server.
 *
 * ! When a relay is required (the server says so) the configuration contains
 * ONLY relay servers and `iceTransportPolicy: 'relay'`, so the browser cannot even gather a direct candidate. If there
 * is no relay with valid credentials the function throws `RelayUnavailableError`: it never lowers the policy to
 * `all`, and never adds a STUN server of its own.
 *
 * ! With `strictRelay` (the native apps, see STRICT_RELAY in config.ts) the server is not asked: the relay is ALWAYS
 * required and only `turns:` addresses are kept, so a hostile or misconfigured server cannot turn a call into a direct
 * one (by answering `relayOnly: false`, listing STUN, or offering only `turn:` in clear).
 *
 * @param response The answer of `/api/rtc/config`: without `strictRelay` the server decides whether a relay is required.
 * @param now Current time in milliseconds (injectable for tests).
 * @param strictRelay Require the relay over TLS whatever the server answers.
 */
export function buildPeerConfiguration(
  response: RtcConfigResponse,
  now = Date.now(),
  strictRelay = false,
): { configuration: RTCConfiguration; relayRequired: boolean } {
  if (!response || !Array.isArray(response.iceServers)) {
    throw new RelayUnavailableError('The server sent an unusable call configuration.');
  }
  const relayRequired = strictRelay || response.relayOnly === true;
  if (!relayRequired) {
    return {
      configuration: {
        iceServers: response.iceServers,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
      },
      relayRequired,
    };
  }
  const allowed = strictRelay ? isTlsTurnUrl : isTurnUrl;
  const relays = response.iceServers
    .filter(function usable(server) {
      return isUsableRelay(server, now);
    })
    .map(function onlyRelayUrls(server) {
      return { ...server, urls: urlsOf(server).filter(allowed) };
    })
    .filter(function hasUrls(server) {
      return server.urls.length > 0;
    });
  if (!relays.length) {
    throw new RelayUnavailableError(
      strictRelay
        ? 'A private call needs the encrypted relay (turns:) of the server, and it is not available. Your address would be exposed, so the call was not started.'
        : 'A private call needs the relay server, and it is not available. Your address would be exposed, so the call was not started.',
    );
  }
  return {
    configuration: { iceServers: relays, iceTransportPolicy: 'relay', bundlePolicy: 'max-bundle' },
    relayRequired,
  };
}

/** The soonest time at which any TURN credential of the list stops working (null when there is none). */
export function earliestExpiry(servers: RTCIceServer[]): number | null {
  const times = servers.map(credentialExpiry).filter(function known(time): time is number {
    return time !== null;
  });
  return times.length ? Math.min(...times) : null;
}

/** True when the credentials expire within the margin and should be requested again. */
export function needsIceRefresh(
  expiresAt: number | null,
  now: number,
  marginMs = 10 * 60_000,
): boolean {
  return expiresAt !== null && expiresAt - now <= marginMs;
}

/** True for a candidate line that describes a relayed address (`typ relay`). */
export function isRelayCandidate(candidate: string): boolean {
  return / typ relay( |$)/.test(candidate);
}

/** How far from the present the timestamp of the first signal of a session may be, in milliseconds. */
const SIGNAL_MAX_SKEW_MS = 5 * 60_000;

/**
 * Whether the timestamp of a signaling message is recent. A message that starts or replaces a session must be fresh,
 * so a recording of an old one (replayed by a server that cannot forge new ones) cannot tear down a live call.
 *
 * @param timestamp The `ts` field of the message (milliseconds since 1970).
 * @param now Current time in milliseconds (injectable for tests).
 */
export function isFreshSignal(timestamp: unknown, now = Date.now()): boolean {
  return typeof timestamp === 'number' && Math.abs(now - timestamp) <= SIGNAL_MAX_SKEW_MS;
}

/** The kind of path a connection really uses. */
export type PathKind = 'relay' | 'direct' | 'unknown';

/** Minimal shape of a statistics entry (the standard `RTCStats`, plus the fields read here). */
interface StatsEntry {
  type?: string;
  id?: string;
  selected?: boolean;
  nominated?: boolean;
  state?: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  candidateType?: string;
}

/**
 * Looks at the statistics of a connection and says whether the pair of candidates in use goes through a relay.
 * Used as a runtime check that the relay policy was really obeyed: a relay-only call whose selected local candidate
 * is not `relay` has leaked the address and must be closed.
 *
 * @param report The result of `RTCPeerConnection.getStats()`.
 */
export function selectedPathKind(report: {
  forEach(callback: (entry: StatsEntry) => void): void;
}): PathKind {
  const entries = new Map<string, StatsEntry>();
  let selectedPairId: string | undefined;
  report.forEach(function collect(entry) {
    if (entry.id) entries.set(entry.id, entry);
    if (entry.type === 'transport' && entry.selectedCandidatePairId) {
      selectedPairId = entry.selectedCandidatePairId;
    }
  });
  let pair = selectedPairId ? entries.get(selectedPairId) : undefined;
  if (!pair) {
    // Firefox does not name the selected pair in the transport entry: it marks the pair itself.
    for (const entry of entries.values()) {
      if (
        entry.type === 'candidate-pair' &&
        (entry.selected || (entry.nominated && entry.state === 'succeeded'))
      ) {
        pair = entry;
        break;
      }
    }
  }
  const local = pair?.localCandidateId ? entries.get(pair.localCandidateId) : undefined;
  if (!local?.candidateType) return 'unknown';
  return local.candidateType === 'relay' ? 'relay' : 'direct';
}
