import { describe, expect, it } from 'vitest'
import {
  CALL_TELEMETRY_VERSION,
  CallTelemetryContext,
  CallTelemetrySummary,
  TELEMETRY_AUDIO_CODECS,
  TELEMETRY_CANDIDATE_TYPES,
  TELEMETRY_INTERVAL_MS,
  TELEMETRY_LIMITS,
  TELEMETRY_QUALITY_LIMITATIONS,
  TELEMETRY_READ_FIELDS,
  TELEMETRY_RELAY_PROTOCOLS,
  TELEMETRY_VIDEO_CODECS,
  containsIpLikeString,
  summarizeStats,
} from './telemetry'

/**
 * Call telemetry (DESIGN.md v3 §3.6) — the one shape getStats may leave the phone in. What these tests pin:
 *   · ⛔ an address cannot get out: a realistic Chrome report stuffed with private/public IPv4 and IPv6, mDNS names,
 *     TURN urls by IP and an unblanked remote raddr yields a summary with none of them — and a Proxy around every
 *     stats entry proves the address-bearing fields are never even READ, nor any entry enumerated or copied;
 *   · the schema is strict and bounded (extra keys and absurd numbers are rejects), and summarizeStats can never
 *     produce anything it rejects, whatever the report holds (seeded fuzz);
 *   · the arithmetic: bytes → kbps and frames → fps over the window, ratios "since the stream began" without a prev,
 *     null (never 0) for what a browser does not report.
 */

type Stat = Record<string, unknown>

const CALL_ID = '6f1c2b0e-7a4d-4e8b-9c3f-2d5e6a7b8c9d'
/** Chrome stats timestamps are float milliseconds. */
const T0 = 1_761_036_000_000.125
const T1 = T0 + 30_000

const ctx = (over: Partial<CallTelemetryContext> = {}): CallTelemetryContext => ({
  callId: CALL_ID,
  role: 'caller',
  seq: 3,
  tSec: 90,
  final: false,
  restarts: 0,
  held: false,
  ...over,
})

/** The cumulative counters of one getStats snapshot. */
interface Counters {
  aBytesSent: number
  aBytesRecv: number
  aPktsRecv: number
  aLost: number
  aSamples: number
  aConcealed: number
  vBytesSent: number
  vFramesSent: number
  vFramesEncoded: number
  vEncodeTime: number
  vBytesRecv: number
  vFramesDecoded: number
  vDecodeTime: number
  vFreezes: number
  aRttTotal: number
  aRttCount: number
  pairRttTotal: number
  pairResponses: number
}

// ~10 s into the call…
const AT_T0: Counters = {
  aBytesSent: 50_000, aBytesRecv: 45_000, aPktsRecv: 495, aLost: 5, aSamples: 480_000, aConcealed: 2_400,
  vBytesSent: 1_500_000, vFramesSent: 290, vFramesEncoded: 300, vEncodeTime: 2.7,
  vBytesRecv: 900_000, vFramesDecoded: 240, vDecodeTime: 1.68, vFreezes: 1,
  aRttTotal: 0.5, aRttCount: 5, pairRttTotal: 0.6, pairResponses: 10,
}
// …and 30 s later. The window: +150 kB sent / +135 kB heard (40 / 36 kbit/s), 30 of 1500 packets lost (2%), 1%
// concealed, +870 frames sent (29 fps) of +900 encoded in 4.5 s (5 ms each), +720 decoded (24 fps) in 2.16 s (3 ms
// each), +2 freezes, RTCP RTT 0.62 s over 10 reports (62 ms), STUN RTT 0.915 s over 15 responses (61 ms).
const AT_T1: Counters = {
  aBytesSent: 200_000, aBytesRecv: 180_000, aPktsRecv: 1_965, aLost: 35, aSamples: 1_920_000, aConcealed: 16_800,
  vBytesSent: 6_000_000, vFramesSent: 1_160, vFramesEncoded: 1_200, vEncodeTime: 7.2,
  vBytesRecv: 3_600_000, vFramesDecoded: 960, vDecodeTime: 3.84, vFreezes: 3,
  aRttTotal: 1.12, aRttCount: 15, pairRttTotal: 1.515, pairResponses: 25,
}

const SELECTED_PAIR = 'CPI6Hk3hKf_IaB12cD3'
const LOCAL_CERT = 'CF6A:1F:0C:93:5B:77:D2:E8:41:0A:9C:3E:6B:F2:18:5D:A4:7C:20:B9:E1:33:58:6F:CA:0D:92:4E:71:B6:2F:88'
const REMOTE_CERT = 'CF9B:22:E7:14:6C:A0:5F:83:D9:3B:7E:C6:01:4A:F5:98:2D:B1:60:7F:E4:19:8C:53:A2:0E:D7:36:CB:45:F0:1A'

/**
 * A Chrome (M14x-era) report as getStats returns it, with every IP-bearing field filled — including the ones
 * relay-only would normally blank: a CGNAT and an IPv6 raddr (a build where relay-only is not in force), host
 * candidates (private IPv4, mDNS, link-local / ULA / global IPv6), a srflx candidate with its private raddr, TURN urls
 * by name and BY IP, and the far side's relay candidate with its real raddr (libwebrtc never blanks a remote raddr).
 */
function chromeReport(t: number, n: Counters): Stat[] {
  const lc = (s: Stat): Stat => ({ type: 'local-candidate', timestamp: t, transportId: 'T01', protocol: 'udp', usernameFragment: 'q8Zh', ...s })
  const rc = (s: Stat): Stat => ({ type: 'remote-candidate', timestamp: t, transportId: 'T01', protocol: 'udp', usernameFragment: 'Fq1w', ...s })
  return [
    { id: 'P', type: 'peer-connection', timestamp: t, dataChannelsOpened: 0, dataChannelsClosed: 0 },
    {
      id: 'T01', type: 'transport', timestamp: t,
      bytesSent: n.aBytesSent + n.vBytesSent, bytesReceived: n.aBytesRecv + n.vBytesRecv, packetsSent: 4_100, packetsReceived: 3_900,
      dtlsState: 'connected', dtlsRole: 'client', iceRole: 'controlling', iceState: 'connected', iceLocalUsernameFragment: 'q8Zh',
      selectedCandidatePairId: SELECTED_PAIR, selectedCandidatePairChanges: 1,
      localCertificateId: LOCAL_CERT, remoteCertificateId: REMOTE_CERT, tlsVersion: 'FEFD',
      dtlsCipher: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256', srtpCipher: 'AEAD_AES_128_GCM',
    },
    { id: LOCAL_CERT, type: 'certificate', timestamp: t, fingerprint: LOCAL_CERT.slice(2), fingerprintAlgorithm: 'sha-256', base64Certificate: 'MIIBFjCBvaADAgECAgkAqLd2QtnH8yMwCgYIKoZIzj0EAwIwETEPMA0GA1UEAwwGV2ViUlRD' },
    { id: REMOTE_CERT, type: 'certificate', timestamp: t, fingerprint: REMOTE_CERT.slice(2), fingerprintAlgorithm: 'sha-256', base64Certificate: 'MIIBFzCBvqADAgECAgkA2nRk4W0b9DMwCgYIKoZIzj0EAwIwETEPMA0GA1UEAwwGV2ViUlRD' },
    { id: 'COT01_111_minptime=10;useinbandfec=1', type: 'codec', timestamp: t, transportId: 'T01', payloadType: 111, mimeType: 'audio/opus', clockRate: 48_000, channels: 2, sdpFmtpLine: 'minptime=10;useinbandfec=1' },
    { id: 'CIT01_111_minptime=10;useinbandfec=1', type: 'codec', timestamp: t, transportId: 'T01', payloadType: 111, mimeType: 'audio/opus', clockRate: 48_000, channels: 2, sdpFmtpLine: 'minptime=10;useinbandfec=1' },
    { id: 'COT01_102_profile-level-id=42e01f', type: 'codec', timestamp: t, transportId: 'T01', payloadType: 102, mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
    { id: 'CIT01_102_profile-level-id=42e01f', type: 'codec', timestamp: t, transportId: 'T01', payloadType: 102, mimeType: 'video/H264', clockRate: 90_000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
    {
      id: SELECTED_PAIR, type: 'candidate-pair', timestamp: t, transportId: 'T01', localCandidateId: 'I6Hk3hKf', remoteCandidateId: 'IaB12cD3',
      state: 'succeeded', nominated: true, writable: true, packetsSent: 4_100, packetsReceived: 3_900, bytesSent: n.aBytesSent + n.vBytesSent,
      bytesReceived: n.aBytesRecv + n.vBytesRecv, totalRoundTripTime: n.pairRttTotal, currentRoundTripTime: 0.061, availableOutgoingBitrate: 2_512_000,
      requestsReceived: 12, requestsSent: 13, responsesReceived: n.pairResponses, responsesSent: 12, consentRequestsSent: 10,
      packetsDiscardedOnSend: 0, bytesDiscardedOnSend: 0, lastPacketReceivedTimestamp: t, lastPacketSentTimestamp: t,
    },
    // Gathered before relay-only took hold: failed now, and must never be the pair reported.
    { id: 'CPIhostV4_IrHost01', type: 'candidate-pair', timestamp: t, transportId: 'T01', localCandidateId: 'IhostV4', remoteCandidateId: 'IrHost01', state: 'failed', nominated: false, totalRoundTripTime: 0, responsesReceived: 0 },
    // Succeeded AND nominated (as after a restart) but not the transport's selected pair.
    { id: 'CPIsrflxA_IrMapped', type: 'candidate-pair', timestamp: t, transportId: 'T01', localCandidateId: 'IsrflxA', remoteCandidateId: 'IrMapped', state: 'succeeded', nominated: true, currentRoundTripTime: 0.02, availableOutgoingBitrate: 9_000_000, lastPacketReceivedTimestamp: t + 5 },
    lc({ id: 'I6Hk3hKf', address: '104.30.149.48', ip: '104.30.149.48', port: 39522, candidateType: 'relay', priority: 41_885_695, url: 'turn:turn.cloudflare.com:3478?transport=udp', relayProtocol: 'udp', foundation: '3527446432', relatedAddress: '0.0.0.0', relatedPort: 0, networkType: 'cellular', vpn: false, networkAdapterType: 'cellular', isRemote: false }),
    lc({ id: 'Itcp4Rly', address: '198.51.100.20', port: 52011, candidateType: 'relay', priority: 25_108_479, url: 'turn:198.51.100.20:3478?transport=tcp', relayProtocol: 'tcp', foundation: '1150219841', relatedAddress: '100.64.12.34', relatedPort: 40122 }),
    lc({ id: 'Itls6Rly', address: '2001:db8:4860::8888', port: 61000, candidateType: 'relay', priority: 8_331_263, url: 'turns:turn.eno.vn:443?transport=tcp', relayProtocol: 'tls', foundation: '903217465', relatedAddress: '2402:800:6371:abcd:1c2e:3f4a:5b6c:7d8e', relatedPort: 51515 }),
    lc({ id: 'IhostV4', address: '192.168.1.23', port: 54400, candidateType: 'host', priority: 2_122_260_223, foundation: '2442209286', networkType: 'wifi' }),
    lc({ id: 'IhostMd', address: '3f9d5c4e-8b1a-4c2d-9e7f-1a2b3c4d5e6f.local', port: 54401, candidateType: 'host', priority: 2_122_260_222, foundation: '2442209287' }),
    lc({ id: 'IhostLL', address: 'fe80::1c2e:3f4a:5b6c:7d8e', port: 54402, candidateType: 'host', priority: 2_122_197_247, foundation: '1795421093' }),
    lc({ id: 'IhostUL', address: 'fd12:3456:789a::1', port: 54403, candidateType: 'host', priority: 2_122_197_246, foundation: '1795421094' }),
    lc({ id: 'IhostG6', address: '2402:800:6371:abcd:1c2e:3f4a:5b6c:7d8e', port: 54404, candidateType: 'host', priority: 2_122_197_245, foundation: '1795421095' }),
    lc({ id: 'IsrflxA', address: '203.0.113.7', port: 61234, candidateType: 'srflx', priority: 1_686_052_607, url: 'stun:stun.cloudflare.com:3478', foundation: '3851231472', relatedAddress: '192.168.1.23', relatedPort: 54400 }),
    rc({ id: 'IaB12cD3', address: '172.64.149.23', port: 50112, candidateType: 'relay', priority: 41_885_439, foundation: '1867431040', relatedAddress: '113.161.72.10', relatedPort: 61234 }),
    rc({ id: 'IrHost01', address: '10.0.0.5', port: 9, protocol: 'tcp', tcpType: 'active', candidateType: 'host', priority: 1_518_280_447, foundation: '2112318209' }),
    rc({ id: 'IrMapped', address: '::ffff:10.1.2.3', port: 50000, candidateType: 'prflx', priority: 1_853_824_767, foundation: '4166418713' }),
    {
      id: 'OT01A2876543210', type: 'outbound-rtp', timestamp: t, ssrc: 2_876_543_210, kind: 'audio', transportId: 'T01',
      codecId: 'COT01_111_minptime=10;useinbandfec=1', mediaSourceId: 'SA1', remoteId: 'RIA2876543210', mid: '0',
      packetsSent: n.aBytesSent / 100, bytesSent: n.aBytesSent, headerBytesSent: n.aBytesSent / 5, retransmittedPacketsSent: 0,
      retransmittedBytesSent: 0, nackCount: 0, targetBitrate: 32_000, totalPacketSendDelay: 1.2, active: true,
    },
    {
      id: 'OT01V1122334455', type: 'outbound-rtp', timestamp: t, ssrc: 1_122_334_455, kind: 'video', transportId: 'T01',
      codecId: 'COT01_102_profile-level-id=42e01f', mediaSourceId: 'SV2', remoteId: 'RIV1122334455', mid: '1',
      packetsSent: n.vBytesSent / 1_000, bytesSent: n.vBytesSent, headerBytesSent: n.vBytesSent / 40, framesEncoded: n.vFramesEncoded,
      framesSent: n.vFramesSent, keyFramesEncoded: 3, totalEncodeTime: n.vEncodeTime, totalEncodedBytesTarget: 0, frameWidth: 960,
      frameHeight: 540, framesPerSecond: 30, qpSum: 9_000, hugeFramesSent: 0, totalPacketSendDelay: 4.4,
      qualityLimitationReason: 'bandwidth', qualityLimitationDurations: { none: 20.1, cpu: 0, bandwidth: 9.9, other: 0 },
      qualityLimitationResolutionChanges: 2, encoderImplementation: 'ExternalEncoder (MediaCodec: c2.mtk.avc.encoder)',
      powerEfficientEncoder: true, active: true, scalabilityMode: 'L1T1', targetBitrate: 1_200_000, firCount: 0, pliCount: 1, nackCount: 4,
    },
    {
      id: 'IT01A3344556677', type: 'inbound-rtp', timestamp: t, ssrc: 3_344_556_677, kind: 'audio', transportId: 'T01',
      codecId: 'CIT01_111_minptime=10;useinbandfec=1', trackIdentifier: '{d2f7c3a1-90be-4f6e-8a51-0c4d2b7e9f13}', mid: '0',
      remoteId: 'ROA3344556677', packetsReceived: n.aPktsRecv, packetsLost: n.aLost, jitter: 0.0125, bytesReceived: n.aBytesRecv,
      headerBytesReceived: n.aBytesRecv / 5, lastPacketReceivedTimestamp: t, jitterBufferDelay: 40.1, jitterBufferTargetDelay: 38.2,
      jitterBufferMinimumDelay: 30.0, jitterBufferEmittedCount: n.aSamples, totalSamplesReceived: n.aSamples, concealedSamples: n.aConcealed,
      silentConcealedSamples: 0, concealmentEvents: 3, insertedSamplesForDeceleration: 120, removedSamplesForAcceleration: 90,
      audioLevel: 0.03, totalAudioEnergy: 0.4, totalSamplesDuration: 30.2, playoutId: 'AP', fecPacketsReceived: 4, fecPacketsDiscarded: 1,
      packetsDiscarded: 0, nackCount: 0,
    },
    {
      id: 'IT01V5566778899', type: 'inbound-rtp', timestamp: t, ssrc: 5_566_778_899, kind: 'video', transportId: 'T01',
      codecId: 'CIT01_102_profile-level-id=42e01f', trackIdentifier: '{7a3e9c10-5b2d-4c8f-9e61-d0f4a2b3c5e7}', mid: '1',
      packetsReceived: n.vBytesRecv / 1_000, packetsLost: 3, jitter: 0.009, bytesReceived: n.vBytesRecv, framesDecoded: n.vFramesDecoded,
      keyFramesDecoded: 2, framesDropped: 1, frameWidth: 640, frameHeight: 360, framesPerSecond: 24, qpSum: 7_000,
      totalDecodeTime: n.vDecodeTime, totalInterFrameDelay: 40.0, totalSquaredInterFrameDelay: 1.7, pauseCount: 0, totalPausesDuration: 0,
      freezeCount: n.vFreezes, totalFreezesDuration: 0.6, framesReceived: n.vFramesDecoded + 2,
      decoderImplementation: 'ExternalDecoder (MediaCodec: c2.mtk.avc.decoder)', powerEfficientDecoder: true,
    },
    {
      id: 'RIA2876543210', type: 'remote-inbound-rtp', timestamp: t, ssrc: 2_876_543_210, kind: 'audio', transportId: 'T01',
      codecId: 'COT01_111_minptime=10;useinbandfec=1', packetsLost: 2, jitter: 0.004, localId: 'OT01A2876543210',
      roundTripTime: 0.064, totalRoundTripTime: n.aRttTotal, fractionLost: 0, roundTripTimeMeasurements: n.aRttCount,
    },
    {
      id: 'RIV1122334455', type: 'remote-inbound-rtp', timestamp: t, ssrc: 1_122_334_455, kind: 'video', transportId: 'T01',
      codecId: 'COT01_102_profile-level-id=42e01f', packetsLost: 7, jitter: 0.011, localId: 'OT01V1122334455',
      roundTripTime: 0.9, totalRoundTripTime: 9, fractionLost: 0.01, roundTripTimeMeasurements: 10,
    },
    { id: 'ROA3344556677', type: 'remote-outbound-rtp', timestamp: t, ssrc: 3_344_556_677, kind: 'audio', transportId: 'T01', localId: 'IT01A3344556677', remoteTimestamp: t - 40, reportsSent: 12, packetsSent: 2_000, bytesSent: 999_999 },
    { id: 'SA1', type: 'media-source', timestamp: t, kind: 'audio', trackIdentifier: '{8c1e2f3a-4b5c-4d6e-8f70-91a2b3c4d5e6}', audioLevel: 0.02, totalAudioEnergy: 0.3, totalSamplesDuration: 30.1, echoReturnLoss: -100, echoReturnLossEnhancement: 0.18 },
    { id: 'SV2', type: 'media-source', timestamp: t, kind: 'video', trackIdentifier: '{9d2f3a4b-5c6d-4e7f-8091-a2b3c4d5e6f7}', width: 960, height: 540, frames: n.vFramesEncoded + 10, framesPerSecond: 30 },
    { id: 'AP', type: 'media-playout', timestamp: t, kind: 'audio', synthesizedSamplesDuration: 0.05, synthesizedSamplesEvents: 2, totalSamplesDuration: 30.2, totalPlayoutDelay: 2.1, totalSamplesCount: n.aSamples },
  ]
}

const without = (s: Stat, keys: readonly string[]): Stat => Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k)))

/** The fields WebKit has been seen to omit — all at once, to prove each degrades to null rather than to 0. */
const SAFARI_LACKS: Record<string, readonly string[]> = {
  'outbound-rtp': ['powerEfficientEncoder', 'encoderImplementation', 'qualityLimitationReason', 'qualityLimitationDurations', 'qualityLimitationResolutionChanges', 'framesSent', 'active', 'scalabilityMode'],
  'inbound-rtp': ['freezeCount', 'totalFreezesDuration', 'decoderImplementation', 'powerEfficientDecoder', 'concealedSamples', 'silentConcealedSamples', 'concealmentEvents'],
  'remote-inbound-rtp': ['totalRoundTripTime', 'roundTripTimeMeasurements'],
  'candidate-pair': ['availableOutgoingBitrate', 'totalRoundTripTime', 'responsesReceived'],
  'local-candidate': ['relayProtocol', 'networkType', 'vpn', 'networkAdapterType', 'ip', 'isRemote'],
}
const safariReport = (t: number, n: Counters): Stat[] => chromeReport(t, n).map((s) => without(s, SAFARI_LACKS[String(s.type)] ?? []))

/** A minimal report around one selected path, for the transport rules. */
function pathReport(local: Stat, { viaTransport = true, pair = {} as Stat } = {}): Stat[] {
  return [
    ...(viaTransport ? [{ id: 'T1', type: 'transport', timestamp: T1, selectedCandidatePairId: 'CP1', iceLocalUsernameFragment: 'zZ9q' }] : []),
    { id: 'CP1', type: 'candidate-pair', timestamp: T1, localCandidateId: 'L1', remoteCandidateId: 'R1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05, availableOutgoingBitrate: 800_000, ...pair },
    { id: 'L1', type: 'local-candidate', timestamp: T1, port: 3478, foundation: '2093482117', usernameFragment: 'zZ9q', ...local },
    { id: 'R1', type: 'remote-candidate', timestamp: T1, address: '172.64.149.23', port: 3478, candidateType: 'relay', relatedAddress: '113.161.72.10', relatedPort: 5000 },
  ]
}

/** The fields the brief names, plus everything else in a stats report that identifies a person, device or session. */
const NEVER_READ = [
  'address', 'ip', 'port', 'url', 'relatedAddress', 'relatedPort', 'foundation', 'usernameFragment',
  'iceLocalUsernameFragment', 'fingerprint', 'base64Certificate', 'networkType', 'vpn', 'networkAdapterType',
  'encoderImplementation', 'decoderImplementation', 'trackIdentifier', 'sdpFmtpLine', 'tcpType', 'priority',
] as const
/** String values in the fixture that must never appear in a summary. */
const SENSITIVE_STRING_FIELDS = [
  'address', 'ip', 'url', 'relatedAddress', 'foundation', 'usernameFragment', 'iceLocalUsernameFragment', 'fingerprint',
  'base64Certificate', 'trackIdentifier', 'encoderImplementation', 'decoderImplementation', 'sdpFmtpLine',
] as const

function sensitiveStrings(report: Stat[]): string[] {
  const out = new Set<string>()
  for (const s of report) for (const k of SENSITIVE_STRING_FIELDS) if (typeof s[k] === 'string') out.add(s[k] as string)
  return [...out]
}

function stringLeaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) stringLeaves(x, out)
  return out
}
const ALLOWED_STRINGS = new Set<string>([
  CALL_ID, 'caller', 'callee', ...TELEMETRY_AUDIO_CODECS, ...TELEMETRY_VIDEO_CODECS, ...TELEMETRY_CANDIDATE_TYPES,
  ...TELEMETRY_RELAY_PROTOCOLS, ...TELEMETRY_QUALITY_LIMITATIONS,
])

/** Every entry behind a Proxy that records each property read (by entry), each enumeration and each write. */
function watched(report: Stat[]) {
  const reads = new Map<string, Set<string>>()
  const enumerated: string[] = []
  const writes: string[] = []
  const entries = report.map((target) => {
    const label = `${String(target.type)}:${String(target.id)}`
    const seen = new Set<string>()
    reads.set(label, seen)
    return new Proxy(target, {
      get(t, key, receiver) {
        if (typeof key === 'string') seen.add(key)
        return Reflect.get(t, key, receiver)
      },
      has(t, key) {
        if (typeof key === 'string') seen.add(key)
        return Reflect.has(t, key)
      },
      ownKeys(t) {
        enumerated.push(label)
        return Reflect.ownKeys(t)
      },
      getOwnPropertyDescriptor(t, key) {
        enumerated.push(`${label}.${String(key)}`)
        return Reflect.getOwnPropertyDescriptor(t, key)
      },
      set(_t, key) {
        writes.push(`${label}.${String(key)}`)
        return true
      },
      defineProperty(_t, key) {
        writes.push(`${label}.${String(key)}`)
        return true
      },
      deleteProperty(_t, key) {
        writes.push(`${label}.${String(key)}`)
        return true
      },
    })
  })
  return { entries, reads, enumerated, writes }
}

function expectNoLeak(summary: CallTelemetrySummary, report: Stat[]) {
  expect(CallTelemetrySummary.safeParse(summary).success).toBe(true)
  const json = JSON.stringify(summary)
  expect(containsIpLikeString(json)).toBe(false)
  for (const secret of sensitiveStrings(report)) expect(json, `leaked ${secret}`).not.toContain(secret)
  for (const s of stringLeaves(summary)) expect(ALLOWED_STRINGS.has(s), `free-form string in the summary: ${s}`).toBe(true)
}

describe('⛔ no IP address can leave the phone', () => {
  it('the fixture really is an IP store — otherwise every "no leak" below would be vacuous', () => {
    expect(containsIpLikeString(chromeReport(T1, AT_T1))).toBe(true)
    expect(sensitiveStrings(chromeReport(T1, AT_T1))).toEqual(
      expect.arrayContaining(['192.168.1.23', '203.0.113.7', '100.64.12.34', '113.161.72.10', 'fe80::1c2e:3f4a:5b6c:7d8e', '3f9d5c4e-8b1a-4c2d-9e7f-1a2b3c4d5e6f.local', 'turn:198.51.100.20:3478?transport=tcp']),
    )
  })

  it('a realistic Chrome report with private/public IPv4 + IPv6, mDNS, TURN urls by IP and a remote raddr → none of it in the summary', () => {
    const prev = chromeReport(T0, AT_T0)
    const report = chromeReport(T1, AT_T1)
    expectNoLeak(summarizeStats(report, prev, ctx()), [...report, ...prev])
    expectNoLeak(summarizeStats(report, undefined, ctx({ final: true })), report)
  })

  it('the same holds when the SELECTED path is a host or srflx candidate (a future direct-call opt-in)', () => {
    for (const local of ['IhostV4', 'IhostMd', 'IhostG6', 'IsrflxA']) {
      const report = chromeReport(T1, AT_T1).map((s) => (s.id === SELECTED_PAIR ? { ...s, localCandidateId: local } : s))
      const summary = summarizeStats(report, chromeReport(T0, AT_T0), ctx())
      expect(summary.transport.candidateType).toBe(local === 'IsrflxA' ? 'srflx' : 'host')
      expect(summary.transport.relayProtocol).toBeNull()
      expectNoLeak(summary, report)
    }
  })

  it('never reads an address-bearing field, never enumerates, copies or writes a stats entry', () => {
    const allowed = new Set<string>(TELEMETRY_READ_FIELDS)
    const scenarios: [string, Stat[], Stat[] | undefined][] = [
      ['chrome, windowed', chromeReport(T1, AT_T1), chromeReport(T0, AT_T0)],
      ['chrome, first sample', chromeReport(T1, AT_T1), undefined],
      ['safari', safariReport(T1, AT_T1), safariReport(T0, AT_T0)],
    ]
    for (const [name, report, prev] of scenarios) {
      const cur = watched(report)
      const old = prev && watched(prev)
      summarizeStats(cur.entries, old?.entries, ctx())
      // The Map shape too: an RTCStatsReport iterates as [id, stats] pairs.
      summarizeStats(new Map(cur.entries.map((e, i) => [String(report[i].id), e])), old?.entries, ctx())
      for (const w of old ? [cur, old] : [cur]) {
        expect(w.enumerated, name).toEqual([])
        expect(w.writes, name).toEqual([])
        for (const [label, keys] of w.reads) {
          for (const k of keys) {
            expect(allowed.has(k), `${name}: read ${label}.${k}`).toBe(true)
            expect((NEVER_READ as readonly string[]).includes(k), `${name}: read ${label}.${k}`).toBe(false)
          }
          // Of a candidate: the selected LOCAL one gives candidateType + relayProtocol; every other only its id/type.
          if (label === 'local-candidate:I6Hk3hKf') expect([...keys].every((k) => ['id', 'type', 'candidateType', 'relayProtocol'].includes(k)), `${name}: ${[...keys]}`).toBe(true)
          else if (label.startsWith('local-candidate:') || label.startsWith('remote-candidate:') || label.startsWith('certificate:')) {
            expect([...keys].every((k) => k === 'id' || k === 'type'), `${name}: ${label} ${[...keys]}`).toBe(true)
          }
        }
      }
    }
  })

  it('relayProtocol is not even asked of a non-relay candidate', () => {
    const w = watched(pathReport({ candidateType: 'host', relayProtocol: 'udp', address: '192.168.1.23' }))
    summarizeStats(w.entries, undefined, ctx())
    expect(w.reads.get('local-candidate:L1')).toEqual(new Set(['id', 'type', 'candidateType']))
  })

  it('TELEMETRY_READ_FIELDS itself names no address-bearing field', () => {
    for (const k of NEVER_READ) expect(TELEMETRY_READ_FIELDS as readonly string[]).not.toContain(k)
  })

  it('hostile strings in the fields it DOES read are compared, never copied', () => {
    const report: Stat[] = [
      { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
      { id: 'P', type: 'candidate-pair', localCandidateId: 'L', state: 'succeeded', nominated: true },
      { id: 'L', type: 'local-candidate', candidateType: '192.168.1.23', relayProtocol: 'fe80::1' },
      { id: 'OA', type: 'outbound-rtp', kind: 'audio', codecId: 'CA', bytesSent: 1 },
      { id: 'CA', type: 'codec', mimeType: 'audio/192.168.1.23' },
      { id: 'OV', type: 'outbound-rtp', kind: 'video', codecId: 'CV', qualityLimitationReason: '2001:db8::1', bytesSent: 1 },
      { id: 'CV', type: 'codec', mimeType: 'video/__proto__' },
    ]
    const summary = summarizeStats(report, undefined, ctx())
    expect(summary.transport).toEqual({ candidateType: 'unknown', relayProtocol: null, rttMs: null, availableOutgoingKbps: null })
    expect(summary.audio?.codec).toBe('other')
    expect(summary.video?.codec).toBe('other')
    expect(summary.video?.qualityLimitation).toBe('other')
    expectNoLeak(summary, report)
  })

  it('Object.prototype names cannot resolve through the lookup tables', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const report: Stat[] = [
        { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
        { id: 'P', type: 'candidate-pair', localCandidateId: 'L' },
        { id: 'L', type: 'local-candidate', candidateType: name, relayProtocol: name },
        { id: 'OA', type: 'outbound-rtp', kind: 'audio', codecId: 'CA' },
        { id: 'CA', type: 'codec', mimeType: `audio/${name}` },
        { id: 'OV', type: 'outbound-rtp', kind: 'video', codecId: 'CV', qualityLimitationReason: name },
        { id: 'CV', type: 'codec', mimeType: `video/${name}` },
      ]
      const summary = summarizeStats(report, undefined, ctx())
      expect(summary.transport.candidateType).toBe('unknown')
      expect(summary.audio?.codec).toBe('other')
      expect(summary.video?.codec).toBe('other')
      expect(summary.video?.qualityLimitation).toBe('other')
      expect(CallTelemetrySummary.safeParse(summary).success).toBe(true)
      // relayProtocol is consulted only for a relay candidate, so give it one.
      const relay = summarizeStats(pathReport({ candidateType: 'relay', relayProtocol: name }), undefined, ctx())
      expect(relay.transport).toMatchObject({ candidateType: 'relay', relayProtocol: null })
    }
  })

  it('garbage in, schema-valid and address-free out (seeded fuzz)', () => {
    let seed = 0x5eed_ca11
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
    const TYPES = ['transport', 'candidate-pair', 'local-candidate', 'remote-candidate', 'codec', 'outbound-rtp', 'inbound-rtp', 'remote-inbound-rtp', 'certificate']
    const IDS = ['a', 'b', 'c', 'd', '__proto__', 'constructor']
    const NASTY: unknown[] = [
      '192.168.1.23', '10.0.0.1', 'fe80::1', '2001:db8::1', '::ffff:10.1.2.3', 'abcd.local', 'turn:198.51.100.20:3478?transport=udp',
      'relay', 'RELAY', 'tls', 'udp', 'tcp', 'srflx', 'host', 'audio', 'video', 'audio/opus', 'video/H264', 'video/AV1',
      'audio/__proto__', '__proto__', 'constructor', 'bandwidth', 'succeeded', ...TYPES, ...IDS,
      NaN, Infinity, -Infinity, -1, 0, 1, 0.5, 30_000, 1e9, 1e300, -0, 2 ** 53, true, false, null, undefined, {}, [], ['x', 'y'],
      { address: '1.2.3.4' },
    ]
    const keys = [...TELEMETRY_READ_FIELDS, ...NEVER_READ]
    for (let i = 0; i < 400; i++) {
      let report: Stat[]
      if (i % 2 === 0) {
        report = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => {
          const e: Stat = { id: pick(IDS), type: rnd() < 0.8 ? pick(TYPES) : pick(NASTY), kind: pick(['audio', 'video', ...NASTY]), timestamp: pick([0, 1_000, 31_000, NaN, -5, 1e300]) }
          for (let k = 0; k < 8; k++) e[pick(keys)] = rnd() < 0.3 ? pick(IDS) : rnd() < 0.5 ? rnd() * pick([1, 100, 1e4, 1e7]) : pick(NASTY)
          return e
        })
      } else {
        // A real report with random fields corrupted: reaches the deep paths (pair → candidate, stream → codec).
        report = chromeReport(T1, AT_T1).map((s) => {
          if (rnd() > 0.4) return s
          const e = { ...s }
          for (let k = 0; k < 3; k++) e[pick(keys)] = pick(NASTY)
          return e
        })
      }
      const prev = pick([undefined, report, chromeReport(T0, AT_T0), report.slice(0, 3)])
      const summary = summarizeStats(report, prev, ctx({ seq: i }))
      const parsed = CallTelemetrySummary.safeParse(summary)
      expect(parsed.success, `iteration ${i}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
      expect(containsIpLikeString(summary), `iteration ${i}`).toBe(false)
      for (const s of stringLeaves(summary)) expect(ALLOWED_STRINGS.has(s), `iteration ${i}: ${s}`).toBe(true)
    }
  })

  it('a report that is not iterable at all reads as empty instead of throwing', () => {
    for (const junk of [null, undefined, 42, {}, { values: 1 }]) {
      const summary = summarizeStats(junk as never, junk as never, ctx())
      expect(summary.audio).toBeNull()
      expect(summary.transport.candidateType).toBe('unknown')
    }
  })
})

describe('the schema — strict, bounded, numbers and enums only', () => {
  const valid = (): CallTelemetrySummary => summarizeStats(chromeReport(T1, AT_T1), chromeReport(T0, AT_T0), ctx())
  const rejects = (mutate: (s: Record<string, any>) => void) => {
    const s = structuredClone(valid()) as Record<string, any>
    mutate(s)
    return CallTelemetrySummary.safeParse(s)
  }

  it('accepts what summarizeStats produces, and the minimal summary of a call that never connected', () => {
    expect(CallTelemetrySummary.safeParse(valid()).success).toBe(true)
    expect(CallTelemetrySummary.safeParse(summarizeStats([], undefined, ctx({ final: true }))).success).toBe(true)
  })

  it('rejects an extra key at every level — an unknown key is a reject, never a pass-through to the jsonb column', () => {
    const extra: [string, (s: Record<string, any>) => void][] = [
      ['top', (s) => { s.ip = '203.0.113.7' }],
      ['audio', (s) => { s.audio.trackIdentifier = 'x' }],
      ['video', (s) => { s.video.encoderImplementation = 'c2.mtk.avc.encoder' }],
      ['transport', (s) => { s.transport.address = '104.30.149.48' }],
      ['transport', (s) => { s.transport.url = 'turn:turn.cloudflare.com:3478' }],
      ['transport', (s) => { s.transport.relatedAddress = '113.161.72.10' }],
    ]
    for (const [where, mutate] of extra) {
      const r = rejects(mutate)
      expect(r.success, where).toBe(false)
      expect(r.error?.issues[0].code, where).toBe('unrecognized_keys')
    }
  })

  it('rejects out-of-range, non-integer, non-finite and stringly numbers', () => {
    const bad: ((s: Record<string, any>) => void)[] = [
      (s) => { s.audio.packetsLostPct = 100.01 },
      (s) => { s.audio.concealedPct = -0.5 },
      (s) => { s.audio.sendKbps = TELEMETRY_LIMITS.audioKbps + 1 },
      (s) => { s.audio.jitterMs = Infinity },
      (s) => { s.audio.rttMs = NaN },
      (s) => { s.audio.recvKbps = '36' },
      (s) => { s.video.sendHeight = 540.5 },
      (s) => { s.video.recvHeight = 99_999 },
      (s) => { s.video.sendFps = 1_000 },
      (s) => { s.video.freezeCount = -1 },
      (s) => { s.video.encodeMsPerFrame = 1e9 },
      (s) => { s.transport.availableOutgoingKbps = -1 },
      (s) => { s.transport.rttMs = TELEMETRY_LIMITS.ms + 1 },
      (s) => { s.seq = -1 },
      (s) => { s.seq = 1.5 },
      (s) => { s.tSec = TELEMETRY_LIMITS.tSec + 1 },
      (s) => { s.restarts = 2 ** 40 },
    ]
    for (const [i, mutate] of bad.entries()) expect(rejects(mutate).success, `case ${i}`).toBe(false)
  })

  it('rejects anything outside the enums — no free-form string has a field to live in', () => {
    const bad: ((s: Record<string, any>) => void)[] = [
      (s) => { s.v = CALL_TELEMETRY_VERSION + 1 },
      (s) => { s.role = 'admin' },
      (s) => { s.callId = '192.168.1.23' },
      (s) => { s.callId = 'not-a-uuid' },
      (s) => { s.audio.codec = 'OPUS' },
      (s) => { s.video.codec = 'h264' },
      (s) => { s.video.qualityLimitation = 'thermal' },
      (s) => { s.transport.candidateType = 'relayed' },
      (s) => { s.transport.relayProtocol = 'dtls' },
      (s) => { s.transport.candidateType = '104.30.149.48' },
      (s) => { s.video.hardwareEncoder = 'true' },
      (s) => { s.final = 1 },
    ]
    for (const [i, mutate] of bad.entries()) expect(rejects(mutate).success, `case ${i}`).toBe(false)
  })

  it('rejects a relay protocol on a path that has no relay leg', () => {
    const r = rejects((s) => { s.transport = { candidateType: 'host', relayProtocol: 'udp', rttMs: 5, availableOutgoingKbps: 100 } })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].path).toEqual(['transport', 'relayProtocol'])
  })

  it('every bound holds a whole 2 h call at the 30 s cadence, plus the final summary', () => {
    const summaries = Math.ceil((2 * 3600 * 1000) / TELEMETRY_INTERVAL_MS) + 1
    expect(summaries).toBeLessThanOrEqual(TELEMETRY_LIMITS.seq)
    const last = summarizeStats(chromeReport(T1, AT_T1), chromeReport(T0, AT_T0), ctx({ seq: summaries, tSec: 2 * 3600 + 60, final: true }))
    expect(CallTelemetrySummary.safeParse(last).success).toBe(true)
  })
})

describe('the arithmetic — rates over the window, ratios since the stream began', () => {
  it('bytes → kbps, frames → fps, seconds → ms per frame, all against prev (a realistic 30 s window)', () => {
    expect(summarizeStats(chromeReport(T1, AT_T1), chromeReport(T0, AT_T0), ctx())).toEqual({
      v: CALL_TELEMETRY_VERSION,
      callId: CALL_ID,
      role: 'caller',
      seq: 3,
      tSec: 90,
      final: false,
      audio: { codec: 'opus', sendKbps: 40, recvKbps: 36, packetsLostPct: 2, jitterMs: 12.5, concealedPct: 1, rttMs: 62 },
      video: {
        codec: 'H264', sendHeight: 540, recvHeight: 360, sendFps: 29, recvFps: 24, freezeCount: 2,
        qualityLimitation: 'bandwidth', encodeMsPerFrame: 5, decodeMsPerFrame: 3, hardwareEncoder: true, paused: false,
      },
      transport: { candidateType: 'relay', relayProtocol: 'udp', rttMs: 61, availableOutgoingKbps: 2512 },
      restarts: 0,
      held: false,
    })
  })

  it('first sample without prev: rates are null, ratios and gauges are "since the stream began"', () => {
    const s = summarizeStats(chromeReport(T0, AT_T0), undefined, ctx({ seq: 0, tSec: 10 }))
    expect(s.audio).toEqual({ codec: 'opus', sendKbps: null, recvKbps: null, packetsLostPct: 1, jitterMs: 12.5, concealedPct: 0.5, rttMs: 100 })
    expect(s.video).toEqual({
      codec: 'H264', sendHeight: 540, recvHeight: 360, sendFps: null, recvFps: null, freezeCount: 1,
      qualityLimitation: 'bandwidth', encodeMsPerFrame: 9, decodeMsPerFrame: 7, hardwareEncoder: true, paused: false,
    })
    expect(s.transport).toEqual({ candidateType: 'relay', relayProtocol: 'udp', rttMs: 60, availableOutgoingKbps: 2512 })
  })

  it('a stream that did not exist in prev (video added mid-call): its rates null, its counts since it began', () => {
    const prev = chromeReport(T0, AT_T0).filter((s) => s.kind !== 'video')
    const s = summarizeStats(chromeReport(T1, AT_T1), prev, ctx())
    expect(s.audio?.sendKbps).toBe(40)
    expect(s.video).toMatchObject({ sendFps: null, recvFps: null, freezeCount: 3, encodeMsPerFrame: 6, decodeMsPerFrame: 4 })
  })

  it('a counter that went BACKWARDS (a replaced stream) is null for the window — never negative', () => {
    const s = summarizeStats(chromeReport(T1, AT_T0), chromeReport(T0, AT_T1), ctx())
    expect(s.audio).toEqual({ codec: 'opus', sendKbps: null, recvKbps: null, packetsLostPct: null, jitterMs: 12.5, concealedPct: null, rttMs: 64 })
    expect(s.video).toMatchObject({ sendFps: null, recvFps: null, freezeCount: null, encodeMsPerFrame: null, decodeMsPerFrame: null, sendHeight: 540 })
    expect(s.transport.rttMs).toBe(61) // the totals are unusable, so the latest reading stands in
  })

  it('a window whose clock did not move forward has no rates', () => {
    const s = summarizeStats(chromeReport(T0, AT_T1), chromeReport(T0, AT_T0), ctx())
    expect(s.audio?.sendKbps).toBeNull()
    expect(s.video?.sendFps).toBeNull()
    expect(s.audio?.packetsLostPct).toBe(2) // ratios need no duration
  })

  it('nothing measured in the window: no loss share, no RTT — a stale "latest" from a dead path must not read as healthy', () => {
    const s = summarizeStats(chromeReport(T1, AT_T0), chromeReport(T0, AT_T0), ctx())
    expect(s.audio?.packetsLostPct).toBeNull()
    expect(s.audio?.concealedPct).toBeNull()
    expect(s.audio?.rttMs).toBeNull()
    expect(s.transport.rttMs).toBeNull()
    expect(s.video?.freezeCount).toBe(0)
    expect(s.audio?.sendKbps).toBe(0)
  })

  it('an absurd reading is null — never clamped into a believable-looking number', () => {
    const report = chromeReport(T1, { ...AT_T1, aBytesSent: AT_T0.aBytesSent + 1e12 }).map((s) =>
      s.id === 'OT01V1122334455' ? { ...s, frameHeight: 99_999 } : s,
    )
    const s = summarizeStats(report, chromeReport(T0, AT_T0), ctx())
    expect(s.audio?.sendKbps).toBeNull()
    expect(s.video?.sendHeight).toBeNull()
    expect(s.audio?.recvKbps).toBe(36) // the rest of the summary is unaffected
  })

  it('finds the audio RTCP report by remoteId, else by its back-reference, else by kind — never the video one', () => {
    // The video report (RTT 900 ms) goes first, so "the first remote-inbound-rtp" would be visibly wrong.
    const variant = (t: number, n: Counters, dropRemoteId: boolean, dropLocalId: boolean) => {
      const r = chromeReport(t, n).map((s) => {
        if (dropRemoteId && s.id === 'OT01A2876543210') return without(s, ['remoteId'])
        if (dropLocalId && s.type === 'remote-inbound-rtp') return without(s, ['localId'])
        return s
      })
      return [...r.filter((s) => s.id === 'RIV1122334455'), ...r.filter((s) => s.id !== 'RIV1122334455')]
    }
    for (const [dropRemoteId, dropLocalId] of [[false, false], [true, false], [true, true]]) {
      const s = summarizeStats(variant(T1, AT_T1, dropRemoteId, dropLocalId), variant(T0, AT_T0, dropRemoteId, dropLocalId), ctx())
      expect(s.audio?.rttMs, `remoteId dropped: ${dropRemoteId}, localId dropped: ${dropLocalId}`).toBe(62)
    }
  })

  it('maps codec names case-insensitively, aliases included; an unplanned codec, or one of the wrong kind, is "other"', () => {
    const codecs = (audio: string, video: string) => {
      const report = chromeReport(T1, AT_T1).map((s) =>
        s.id === 'COT01_111_minptime=10;useinbandfec=1' ? { ...s, mimeType: audio } : s.id === 'COT01_102_profile-level-id=42e01f' ? { ...s, mimeType: video } : s,
      )
      const summary = summarizeStats(report, undefined, ctx())
      return [summary.audio?.codec, summary.video?.codec]
    }
    expect(codecs('audio/red', 'video/AV1X')).toEqual(['red', 'AV1'])
    expect(codecs('audio/PCMU', 'video/HEVC')).toEqual(['pcmu', 'H265'])
    expect(codecs('audio/G722', 'video/h264')).toEqual(['g722', 'H264'])
    expect(codecs('audio/PCMA', 'video/VVC')).toEqual(['pcma', 'other'])
    expect(codecs('audio/L16', 'video/rtx')).toEqual(['other', 'other'])
    expect(codecs('video/H264', 'audio/opus')).toEqual(['other', 'other'])
  })

  it('negative cumulative loss (RFC 3550: duplicates) is 0% loss, not negative loss', () => {
    const at = (c: Counters, lost: number) => chromeReport(c === AT_T0 ? T0 : T1, { ...c, aLost: lost })
    expect(summarizeStats(at(AT_T1, -5), at(AT_T0, -3), ctx()).audio?.packetsLostPct).toBe(0)
    expect(summarizeStats(at(AT_T0, -3), undefined, ctx()).audio?.packetsLostPct).toBe(0)
  })

  it('the ladder states: paused (active:false), a software encoder, a cpu limit, a VP8 fallback, AV1 and HEVC', () => {
    const tweak = (video: Stat, mime: string) =>
      chromeReport(T1, AT_T1).map((s) =>
        s.id === 'OT01V1122334455' ? { ...s, ...video } : s.id === 'COT01_102_profile-level-id=42e01f' ? { ...s, mimeType: mime } : s,
      )
    const v = (r: Stat[]) => summarizeStats(r, chromeReport(T0, AT_T0), ctx()).video
    expect(v(tweak({ active: false }, 'video/H264'))).toMatchObject({ paused: true })
    expect(v(tweak({ powerEfficientEncoder: false, qualityLimitationReason: 'cpu' }, 'video/VP8'))).toMatchObject({ hardwareEncoder: false, qualityLimitation: 'cpu', codec: 'VP8' })
    expect(v(tweak({ qualityLimitationReason: 'none' }, 'video/AV1'))).toMatchObject({ qualityLimitation: 'none', codec: 'AV1' })
    expect(v(tweak({}, 'video/H265'))?.codec).toBe('H265')
    expect(v(tweak({}, 'video/VP9'))?.codec).toBe('VP9')
  })

  it('ctx passes through: final, held, restarts, role', () => {
    const s = summarizeStats(chromeReport(T1, AT_T1), chromeReport(T0, AT_T0), ctx({ final: true, held: true, restarts: 2, role: 'callee', seq: 7, tSec: 211 }))
    expect(s).toMatchObject({ final: true, held: true, restarts: 2, role: 'callee', seq: 7, tSec: 211, callId: CALL_ID, v: CALL_TELEMETRY_VERSION })
  })

  it('an invalid ctx is a caller bug and throws — it never produces a summary the server would refuse', () => {
    expect(() => summarizeStats([], undefined, ctx({ callId: '192.168.1.23' }))).toThrow()
    expect(() => summarizeStats([], undefined, ctx({ seq: -1 }))).toThrow()
    expect(() => summarizeStats([], undefined, ctx({ tSec: 1.5 }))).toThrow()
    expect(() => summarizeStats([], undefined, { ...ctx(), media: 'video' } as CallTelemetryContext)).toThrow()
    expect(CallTelemetryContext.safeParse(ctx()).success).toBe(true)
  })
})

describe('report shapes and call shapes', () => {
  it('an RTCStatsReport/Map (iterates as [id, stats] pairs), its pairs as an array, its values, and a plain array agree', () => {
    const report = chromeReport(T1, AT_T1)
    const prev = chromeReport(T0, AT_T0)
    const asMap = (r: Stat[]) => new Map(r.map((s) => [String(s.id), s]))
    const expected = summarizeStats(report, prev, ctx())
    expect(summarizeStats(asMap(report), asMap(prev), ctx())).toEqual(expected)
    expect(summarizeStats(Array.from(asMap(report)), Array.from(asMap(prev)), ctx())).toEqual(expected)
    expect(summarizeStats(asMap(report).values(), asMap(prev).values(), ctx())).toEqual(expected)
  })

  it('reads without mutating: a deep-frozen report works', () => {
    const frozen = chromeReport(T1, AT_T1).map((s) => Object.freeze(s))
    expect(() => summarizeStats(frozen, Object.freeze(chromeReport(T0, AT_T0)), ctx())).not.toThrow()
  })

  it('a call that never connected (empty report, final) is still a valid summary — the setup-failure signal', () => {
    expect(summarizeStats([], undefined, ctx({ final: true }))).toEqual({
      v: CALL_TELEMETRY_VERSION, callId: CALL_ID, role: 'caller', seq: 3, tSec: 90, final: true,
      audio: null, video: null, transport: { candidateType: 'unknown', relayProtocol: null, rttMs: null, availableOutgoingKbps: null },
      restarts: 0, held: false,
    })
  })

  it('an audio call has video: null; ICE still checking has candidateType "unknown"', () => {
    const audioOnly = chromeReport(T1, AT_T1).filter((s) => s.kind !== 'video' && !String(s.mimeType ?? '').startsWith('video/'))
    expect(summarizeStats(audioOnly, undefined, ctx()).video).toBeNull()
    const checking = chromeReport(T1, AT_T1)
      .filter((s) => s.type !== 'transport')
      .map((s) => (s.type === 'candidate-pair' ? { ...s, state: 'in-progress', nominated: false } : s))
    expect(summarizeStats(checking, undefined, ctx()).transport.candidateType).toBe('unknown')
  })

  it('a stale stream left listed after renegotiation loses to the one that moved bytes', () => {
    const stale: Stat = { id: 'OT01A9999', type: 'outbound-rtp', kind: 'audio', timestamp: T1, codecId: 'COLD', bytesSent: 9_999_999 }
    const staleCodec: Stat = { id: 'COLD', type: 'codec', mimeType: 'audio/PCMU' }
    // Listed FIRST, with the bigger cumulative count — "the first one" or "the most bytes ever" would both pick it.
    const prev = [{ ...stale, timestamp: T0 }, staleCodec, ...chromeReport(T0, AT_T0)]
    const s = summarizeStats([stale, staleCodec, ...chromeReport(T1, AT_T1)], prev, ctx())
    expect(s.audio).toMatchObject({ codec: 'opus', sendKbps: 40 })
  })
})

describe('the selected path — candidate type and relay protocol from the selected pair\'s LOCAL candidate', () => {
  it.each(['udp', 'tcp', 'tls'] as const)('relay over %s', (p) => {
    const url = { udp: 'turn:104.30.149.48:3478?transport=udp', tcp: 'turn:104.30.149.48:3478?transport=tcp', tls: 'turns:turn.eno.vn:443?transport=tcp' }[p]
    const report = pathReport({ candidateType: 'relay', relayProtocol: p, address: '104.30.149.48', url, relatedAddress: '100.64.12.34' })
    const s = summarizeStats(report, undefined, ctx())
    expect(s.transport).toEqual({ candidateType: 'relay', relayProtocol: p, rttMs: 50, availableOutgoingKbps: 800 })
    expectNoLeak(s, report)
  })

  it('normalises case; an unknown relay protocol is null; a missing one (Safari) is null', () => {
    const proto = (relayProtocol: unknown) => summarizeStats(pathReport({ candidateType: 'relay', relayProtocol }), undefined, ctx()).transport.relayProtocol
    expect(proto('TLS')).toBe('tls')
    expect(proto('dtls')).toBeNull()
    expect(proto(undefined)).toBeNull()
    expect(proto(17)).toBeNull()
  })

  it('maps every standard candidate type, the first-draft spellings, and anything else to "unknown"', () => {
    const type = (candidateType: unknown) => summarizeStats(pathReport({ candidateType }), undefined, ctx()).transport.candidateType
    expect([type('relay'), type('srflx'), type('host'), type('prflx')]).toEqual(['relay', 'srflx', 'host', 'prflx'])
    expect([type('relayed'), type('serverreflexive'), type('peerreflexive')]).toEqual(['relay', 'srflx', 'prflx'])
    expect([type('HOST'), type('turn'), type(undefined), type(3)]).toEqual(['host', 'unknown', 'unknown', 'unknown'])
  })

  it('the transport\'s selectedCandidatePairId wins over another nominated, succeeded, more recently active pair', () => {
    expect(summarizeStats(chromeReport(T1, AT_T1), undefined, ctx()).transport.candidateType).toBe('relay')
  })

  it('Firefox (no transport stats): the pair flagged selected:true', () => {
    const report: Stat[] = [
      { id: 'A', type: 'candidate-pair', localCandidateId: 'LA', state: 'succeeded', nominated: true, selected: false, lastPacketReceivedTimestamp: T1 + 9 },
      { id: 'B', type: 'candidate-pair', localCandidateId: 'LB', state: 'succeeded', nominated: true, selected: true, currentRoundTripTime: 0.07 },
      { id: 'LA', type: 'local-candidate', candidateType: 'host', address: '192.168.1.23' },
      { id: 'LB', type: 'local-candidate', candidateType: 'relay', relayProtocol: 'tcp', address: '104.30.149.48' },
    ]
    expect(summarizeStats(report, undefined, ctx()).transport).toEqual({ candidateType: 'relay', relayProtocol: 'tcp', rttMs: 70, availableOutgoingKbps: null })
  })

  it('neither: the nominated, succeeded pair that heard from the far side most recently', () => {
    const report: Stat[] = [
      { id: 'X', type: 'candidate-pair', localCandidateId: 'LX', state: 'succeeded', nominated: true, lastPacketReceivedTimestamp: T1 - 10_000 },
      { id: 'Y', type: 'candidate-pair', localCandidateId: 'LY', state: 'succeeded', nominated: true, lastPacketReceivedTimestamp: T1 },
      { id: 'Z', type: 'candidate-pair', localCandidateId: 'LZ', state: 'failed', nominated: true, lastPacketReceivedTimestamp: T1 + 1 },
      { id: 'LX', type: 'local-candidate', candidateType: 'srflx' },
      { id: 'LY', type: 'local-candidate', candidateType: 'relay', relayProtocol: 'tls' },
      { id: 'LZ', type: 'local-candidate', candidateType: 'host' },
    ]
    expect(summarizeStats(report, undefined, ctx()).transport).toMatchObject({ candidateType: 'relay', relayProtocol: 'tls' })
  })

  it('a dangling or mistyped localCandidateId is "unknown", never another entry\'s fields', () => {
    const dangling = pathReport({ candidateType: 'relay' }, { pair: { localCandidateId: 'nope' } })
    expect(summarizeStats(dangling, undefined, ctx()).transport.candidateType).toBe('unknown')
    const mistyped = pathReport({ candidateType: 'relay' }, { pair: { localCandidateId: 'R1' } }) // R1 is the REMOTE candidate
    expect(summarizeStats(mistyped, undefined, ctx()).transport.candidateType).toBe('unknown')
  })
})

describe('Safari-style reports — what WebKit omits is null, never 0', () => {
  it('missing optional fields degrade one by one; framesEncoded stands in for framesSent', () => {
    const report = safariReport(T1, AT_T1)
    const s = summarizeStats(report, safariReport(T0, AT_T0), ctx())
    expect(s.audio).toEqual({ codec: 'opus', sendKbps: 40, recvKbps: 36, packetsLostPct: 2, jitterMs: 12.5, concealedPct: null, rttMs: 64 })
    expect(s.video).toEqual({
      codec: 'H264', sendHeight: 540, recvHeight: 360, sendFps: 30, recvFps: 24, freezeCount: null,
      qualityLimitation: null, encodeMsPerFrame: 5, decodeMsPerFrame: 3, hardwareEncoder: null, paused: null,
    })
    expect(s.transport).toEqual({ candidateType: 'relay', relayProtocol: null, rttMs: 61, availableOutgoingKbps: null })
    expectNoLeak(s, report)
  })

  it('no codec entries at all: codec null, not "other"', () => {
    const s = summarizeStats(safariReport(T1, AT_T1).filter((e) => e.type !== 'codec'), undefined, ctx())
    expect(s.audio?.codec).toBeNull()
    expect(s.video?.codec).toBeNull()
  })

  it('pre-2020 engines that say mediaType instead of kind still resolve their streams', () => {
    const legacy = chromeReport(T1, AT_T1).map((s) => (s.kind ? { ...without(s, ['kind']), mediaType: s.kind } : s))
    const s = summarizeStats(legacy, undefined, ctx())
    expect(s.audio?.codec).toBe('opus')
    expect(s.video?.codec).toBe('H264')
  })
})

describe('containsIpLikeString — the oracle, and the server route\'s last check', () => {
  it.each([
    '192.168.1.23', '10.0.0.1', '0.0.0.0', '100.64.12.34', '203.0.113.7:3478', 'turn:198.51.100.20:3478?transport=udp',
    '999.999.999.999', '2001:db8::1', '::1', '::', 'fe80::1%en0', '[2402:800:6371::1]:443', '::ffff:192.0.2.1',
    '2001:0db8:85a3:0000:0000:8a2e:0370:7334', '2402:800:6371:abcd:1c2e:3f4a:5b6c:7d8e', '3f9d5c4e-8b1a-4c2d-9e7f-1a2b3c4d5e6f.local',
  ])('flags %s — bare and inside JSON', (s) => {
    expect(containsIpLikeString(s)).toBe(true)
    expect(containsIpLikeString(JSON.stringify({ transport: { note: s } }))).toBe(true)
    expect(containsIpLikeString({ nested: [s] })).toBe(true)
  })

  it.each([
    CALL_ID, '10:30:00', 'aa:bb:cc:dd:ee:ff', '1.2.3', '1.5', 'H264', 'opus', 'relay', 'turn.eno.vn', 'local', '{"a":1,"b":{"c":2.5}}',
  ])('does not flag %s', (s) => {
    expect(containsIpLikeString(s)).toBe(false)
  })

  it('never flags a valid summary (Chrome, Safari, first sample, empty)', () => {
    for (const s of [
      summarizeStats(chromeReport(T1, AT_T1), chromeReport(T0, AT_T0), ctx()),
      summarizeStats(safariReport(T1, AT_T1), safariReport(T0, AT_T0), ctx()),
      summarizeStats(chromeReport(T0, AT_T0), undefined, ctx()),
      summarizeStats([], undefined, ctx({ final: true })),
    ]) {
      expect(containsIpLikeString(s)).toBe(false)
      expect(containsIpLikeString(JSON.stringify(s))).toBe(false)
    }
  })

  it('sees through JSON \\u escapes in a raw body (the raw text alone holds no dot or colon to match)', () => {
    expect(containsIpLikeString('{"x":"192\\u002e168\\u002e1\\u002e23"}')).toBe(true)
    expect(containsIpLikeString('{"x":"fe80\\u003a\\u003a1"}')).toBe(true)
    expect(containsIpLikeString('{"x":"\\u0048264"}')).toBe(false)
  })

  it('is deliberately broad: a DTLS fingerprint (colon-joined hex pairs) is flagged too', () => {
    expect(containsIpLikeString(LOCAL_CERT.slice(2))).toBe(true)
  })

  it('fails closed on what it cannot serialise, and passes what would send nothing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(containsIpLikeString(cyclic)).toBe(true)
    expect(containsIpLikeString({ n: BigInt(10) })).toBe(true) // the repo targets ES2017: no 10n literal
    expect(containsIpLikeString(undefined)).toBe(false)
  })
})
