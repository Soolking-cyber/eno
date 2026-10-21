/**
 * Call-quality telemetry — the ONE shape in which a call's getStats() may leave the phone (DESIGN.md v3 §3.6).
 *
 * The exit metrics (setup success ≥ 95%, concealed audio < 2%, freeze rate, the share of TCP/TLS relays per carrier
 * and hour, time to full resolution) need numbers from RTCPeerConnection.getStats(). getStats is also the richest IP
 * store on the phone: every local-candidate / remote-candidate entry carries `address` (+ the legacy `ip`), `port`,
 * `relatedAddress` (raddr), `relatedPort`, `url` (the TURN/STUN server, sometimes BY IP), `foundation` and
 * `usernameFragment`; `transport` carries the ICE ufrag; `certificate` carries the DTLS fingerprints the safety code
 * is built from. So this module is an ALLOWLIST READER, not a filter:
 *   · it reaches into a stats entry ONLY through read(entry, field), whose `field` is typed to TELEMETRY_READ_FIELDS
 *     — the compiler refuses `entry.address` — and nothing ever enumerates, spreads, clones or stringifies an entry
 *     (the tests wrap every entry in a Proxy and fail on any other read, on any key enumeration, on any write);
 *   · its output holds NO free-form string: numbers, booleans, null, and enum members it picked itself. A string
 *     from the browser (candidateType, relayProtocol, mimeType, qualityLimitationReason) is only ever COMPARED and
 *     mapped to an enum member, never copied, so even a hostile value has nothing to ride out in;
 *   · the server validates with this same CallTelemetrySummary (.strict() at every level, plus the "__proto__" check
 *     zod itself skips: an extra key is a reject, not a silently dropped field), re-checks with containsIpLikeString,
 *     and writes the PARSED output to the call_telemetry row, never the raw body.
 * A filter ("delete address, port, …") fails OPEN the day a browser adds a field; an allowlist fails closed.
 *
 * ⚠️ "RELAY-ONLY HIDES THE IPs" IS TRUE OF THE SDP AND ONLY MOSTLY TRUE OF getStats. Under iceTransportPolicy
 * 'relay', libwebrtc blanks the user's own raddr in local candidates and their stats (port_allocator.cc:311-334,
 * p2p_transport_channel.cc:1603-1606) — but REMOTE candidates keep their raddr (SanitizeRemoteCandidate passes
 * filter_related_address=false), and any non-relay path — a future direct-call opt-in, an 'all' fallback for WebKit
 * bug 312332, a debug flag — puts BOTH parties' private and public addresses into the report
 * (rtc_stats_collector.cc:1025-1037). Telemetry must stay clean on the day relay-only is not in force, so nothing
 * here relies on it. networkType / vpn are not read either: device detail no metric needs.
 *
 * ⚠️ UNKNOWN IS null, NEVER 0. Safari omits powerEfficientEncoder and (depending on the version) freezeCount,
 * qualityLimitationReason, relayProtocol, the RTT totals; a first sample has no time window. Each of those is null,
 * so a Safari fleet cannot read as "never limited, never froze", and a missing field cannot drag a median. A counter
 * that went BACKWARDS (a replaced stream) is null for that window too, never negative.
 *
 * ⚠️ RATES NEED A WINDOW, RATIOS DO NOT. kbps and fps are Δcounter / Δtimestamp against `prev` — pass the report you
 * summarised LAST time (keep it; it never leaves the phone), not some newer intermediate one, or windows overlap
 * and the server double-counts. Keep the REPORT (an RTCStatsReport or an array), not report.values(): a one-shot
 * iterator is already spent when it comes back as prev, and every later window silently has none. A rebuilt
 * RTCPeerConnection (§3.2 step 6) starts with no prev. With no prev, or for a stream that did not exist in prev,
 * rates are null — but the ratios (loss %, concealed %, ms per frame, freezes, average RTT) are still exact,
 * because every counter starts at zero with its stream: the window is simply "since the stream began".
 *
 * ⚠️ AN RTCStatsReport IS MAPLIKE: iterating it yields [id, stats] PAIRS, not stats. Both shapes are accepted, so
 * summarizeStats(await pc.getStats(), …) and summarizeStats([...report.values()], …) mean the same thing.
 *
 * ⚠️ TAKE THE HANG-UP REPORT BEFORE pc.close(): close stops every sender, receiver and transport, so whatever getStats
 * still returns afterwards (where it does not reject outright) no longer describes the call. A call that never
 * connected still gets a valid final summary (audio/video null, candidateType 'unknown') — that IS the setup-failure
 * signal.
 *
 * Units, because getStats mixes them: jitter, RTT and encode/decode time arrive in SECONDS and leave in ms;
 * availableOutgoingBitrate arrives in bit/s and leaves in kbit/s; bytesSent/bytesReceived are RTP payload bytes
 * (headers excluded, retransmissions included), so audio kbps is comparable with the Opus maxBitrate of §2.
 *
 * Cadence, enforced by the engine and the route, not here: one summary per 30 s riding the heartbeat over HTTP —
 * never Realtime (§3.3), never Google Analytics (§3.6) — plus one with final:true at hang-up via sendBeacon. Rows
 * live in call_telemetry (jsonb payload keyed (call_id, role, seq)); retention is counsel's.
 *
 * Pure: no clock, no fetch, no DOM. The context (callId, seq, tSec, …) comes from the call engine.
 */
import { z } from 'zod'
import type { CallRole, CodecName } from './types'

/**
 * Bump when the summary's shape changes. Deliberately NOT CALL_PROTOCOL_VERSION: peers never exchange telemetry —
 * only the server reads it — so a telemetry change must not force "reload to call" on every open tab.
 */
export const CALL_TELEMETRY_VERSION = 1

/** One summary per 30 s, plus one with final:true at hang-up (§3.6). The engine schedules; nothing here reads a clock. */
export const TELEMETRY_INTERVAL_MS = 30_000

/**
 * The range every number must sit in. They refuse NONSENSE (negative, absurd, a wrapped counter), not bad calls: each
 * is far beyond anything physical, so a real reading never meets one. A derived value outside its range means the
 * inputs were inconsistent, and summarizeStats reports it as null (unknown) rather than clamping it into a
 * believable-looking number.
 */
export const TELEMETRY_LIMITS = {
  /** The 2 h hard cap (§3.2 step 9) ÷ 30 s = 240 summaries + the final one; the rest is margin. */
  seq: 10_000,
  /** Seconds: twice the 2 h hard cap. */
  tSec: 4 * 60 * 60,
  restarts: 1_000,
  /** Opus tops out at 510 kbit/s and RED at most doubles it. */
  audioKbps: 2_000,
  /** Jitter and RTT, in ms. */
  ms: 10_000,
  /** A frame's SHORT side (8K UHD is 7680×4320) — the "height" of codec-plan.ts. */
  frameHeight: 4_320,
  fps: 240,
  /** Freezes within one window. */
  freezes: 10_000,
  msPerFrame: 10_000,
  /** The send-side bandwidth estimate, kbit/s (1 Gbit/s). */
  outgoingKbps: 1_000_000,
} as const

// The enums. Every string in a summary is one of these, or the callId uuid, or the role — nothing else exists.
export const TELEMETRY_AUDIO_CODECS = ['opus', 'red', 'g722', 'pcmu', 'pcma', 'other'] as const
/** The codec plan's names (types.ts CodecName) + 'other': a codec nobody planned for is worth seeing, not hiding. */
export const TELEMETRY_VIDEO_CODECS = ['H264', 'VP8', 'VP9', 'AV1', 'H265', 'other'] as const
export const TELEMETRY_CANDIDATE_TYPES = ['relay', 'srflx', 'host', 'prflx', 'unknown'] as const
export const TELEMETRY_RELAY_PROTOCOLS = ['udp', 'tcp', 'tls'] as const
export const TELEMETRY_QUALITY_LIMITATIONS = ['none', 'bandwidth', 'cpu', 'other'] as const
const ROLES = ['caller', 'callee'] as const satisfies readonly CallRole[]

export type TelemetryAudioCodec = (typeof TELEMETRY_AUDIO_CODECS)[number]
export type TelemetryVideoCodec = (typeof TELEMETRY_VIDEO_CODECS)[number]
export type TelemetryCandidateType = (typeof TELEMETRY_CANDIDATE_TYPES)[number]
export type TelemetryRelayProtocol = (typeof TELEMETRY_RELAY_PROTOCOLS)[number]
export type TelemetryQualityLimitation = (typeof TELEMETRY_QUALITY_LIMITATIONS)[number]

// Compile-time: types.ts gains a codec or a role → this file stops compiling until telemetry can name it.
const _everyCodecNamed: [Exclude<CodecName, TelemetryVideoCodec>] extends [never] ? true : never = true
const _everyRoleNamed: [Exclude<CallRole, (typeof ROLES)[number]>] extends [never] ? true : never = true

// ---------------------------------------------------------------------------
// The schema — shared by the phone (summarizeStats's output) and the server route (its input)
// ---------------------------------------------------------------------------

/** A measurement: bounded, or null when this sample/browser could not measure it. */
const measured = (max: number) => z.number().min(0).max(max).nullable()
const measuredInt = (max: number) => z.number().int().min(0).max(max).nullable()

const contextShape = {
  /** The CallSession id. Not a TURN username — those are opaque random tokens (§3.4), never the callId. */
  callId: z.uuid(),
  role: z.enum(ROLES),
  /** Per (callId, role), from 0; the final summary takes the next number too (call_telemetry's key). */
  seq: z.number().int().min(0).max(TELEMETRY_LIMITS.seq),
  /** Whole seconds since this device joined the call. */
  tSec: z.number().int().min(0).max(TELEMETRY_LIMITS.tSec),
  /** The hang-up summary (sendBeacon). */
  final: z.boolean(),
  /** ICE restarts so far (§3.2 step 6). */
  restarts: z.number().int().min(0).max(TELEMETRY_LIMITS.restarts),
  /** On hold (§3.2 step 8): media is expected to be quiet, so this window's numbers say nothing about the network. */
  held: z.boolean(),
}

/** What the call engine supplies — summarizeStats refuses anything else (a caller bug, caught loudly in tests). */
export const CallTelemetryContext = z.object(contextShape).strict()
export type CallTelemetryContext = z.infer<typeof CallTelemetryContext>

/** The summary's shape. Exported only inside CallTelemetrySummary, which adds the "__proto__" check zod skips. */
const SummaryObject = z
  .object({
    v: z.literal(CALL_TELEMETRY_VERSION),
    callId: contextShape.callId,
    role: contextShape.role,
    seq: contextShape.seq,
    tSec: contextShape.tSec,
    final: contextShape.final,
    /** What this device sends and hears. null when no audio stream exists yet (a call that never connected). */
    audio: z
      .object({
        /** The SEND codec; the far side reports its own. */
        codec: z.enum(TELEMETRY_AUDIO_CODECS).nullable(),
        sendKbps: measured(TELEMETRY_LIMITS.audioKbps),
        recvKbps: measured(TELEMETRY_LIMITS.audioKbps),
        /** Inbound: of the packets the far side sent in the window, the share that never arrived. */
        packetsLostPct: measured(100),
        jitterMs: measured(TELEMETRY_LIMITS.ms),
        /** Inbound: the share of played samples that were concealment (the < 2% exit metric). */
        concealedPct: measured(100),
        /** RTCP round trip on the audio stream, averaged over the window. */
        rttMs: measured(TELEMETRY_LIMITS.ms),
      })
      .strict()
      .nullable(),
    /** null on an audio call. A camera-off video call still has a stream (the 1–5 fps black canvas of §2). */
    video: z
      .object({
        /** The SEND codec — the encoder the ladder tunes; the receive codec is the far side's send codec. */
        codec: z.enum(TELEMETRY_VIDEO_CODECS).nullable(),
        /** The frame's SHORT side, codec-plan's "540" (960×540 or 540×960), never a portrait frame's 960. */
        sendHeight: measuredInt(TELEMETRY_LIMITS.frameHeight),
        recvHeight: measuredInt(TELEMETRY_LIMITS.frameHeight),
        sendFps: measured(TELEMETRY_LIMITS.fps),
        recvFps: measured(TELEMETRY_LIMITS.fps),
        /** Freezes in the window (inbound). */
        freezeCount: measuredInt(TELEMETRY_LIMITS.freezes),
        /** The sender's qualityLimitationReason at the sample instant — over many samples, an unbiased time share. */
        qualityLimitation: z.enum(TELEMETRY_QUALITY_LIMITATIONS).nullable(),
        encodeMsPerFrame: measured(TELEMETRY_LIMITS.msPerFrame),
        decodeMsPerFrame: measured(TELEMETRY_LIMITS.msPerFrame),
        /** powerEfficientEncoder: Chromium only, and only while the page captures — null elsewhere, never false. */
        hardwareEncoder: z.boolean().nullable(),
        /** The ladder's bottom rung: the sender's encoding is switched off (outbound-rtp active:false). */
        paused: z.boolean().nullable(),
      })
      .strict()
      .nullable(),
    /** The selected ICE path. Always present: 'unknown' until a pair is selected. */
    transport: z
      .object({
        candidateType: z.enum(TELEMETRY_CANDIDATE_TYPES),
        /** phone → relay leg; udp is the goal, tcp/tls is the §3.5 switch-rule signal. */
        relayProtocol: z.enum(TELEMETRY_RELAY_PROTOCOLS).nullable(),
        /** STUN consent round trip on the selected pair, averaged over the window. */
        rttMs: measured(TELEMETRY_LIMITS.ms),
        availableOutgoingKbps: measured(TELEMETRY_LIMITS.outgoingKbps),
      })
      .strict()
      // A relay protocol is the phone→TURN leg: a host/srflx/prflx path has none, so a value there is garbage.
      .refine((t) => t.candidateType === 'relay' || t.relayProtocol === null, {
        message: 'relayProtocol is only meaningful for a relay candidate',
        path: ['relayProtocol'],
      }),
    restarts: contextShape.restarts,
    held: contextShape.held,
  })
  .strict()

/**
 * How deep a summary nests: the top level, then audio / video / transport, then their fields. Below that, any object
 * sits inside a value the shape already refuses, since every field holds a number, a boolean, an enum member or null.
 */
const SUMMARY_DEPTH = 2

/** The path to the first OWN "__proto__" key within a summary's depth, or null. */
function protoKeyPath(v: unknown, path: string[] = []): string[] | null {
  if (v === null || typeof v !== 'object' || path.length > SUMMARY_DEPTH) return null
  if (Object.prototype.hasOwnProperty.call(v, '__proto__')) return path
  for (const [k, x] of Object.entries(v)) {
    const found = protoKeyPath(x, [...path, k])
    if (found !== null) return found
  }
  return null
}

/**
 * ⛔ NUMBERS AND ENUMS ONLY (§3.6). There is no z.string() in this schema except the callId's uuid, so an address,
 * a url, a hostname or a ufrag has no field to live in — and .strict() at every level turns an extra key into a
 * rejection rather than letting it pass through to the jsonb column. Adding a free-form string field here would
 * reopen the hole this module exists to close; add an enum instead.
 *
 * ⚠️ zod's .strict() DOES NOT SEE A "__proto__" KEY. zod 4 skips that one key in its unknown-key scan, so that the
 * object it builds keeps its prototype, and leaves it out of the output. JSON.parse makes it an ordinary OWN key, so a
 * body like {"__proto__":{…anything…},"v":1,…} passed .strict() at any level. A route that kept the raw body after a
 * successful parse would then store whatever came in under that key. So the raw input is checked for the key first,
 * and the shape runs only on a body without one.
 */
export const CallTelemetrySummary = z
  .unknown()
  .superRefine((input, ctx) => {
    const at = protoKeyPath(input)
    if (at === null) return
    ctx.addIssue({ code: 'unrecognized_keys', keys: ['__proto__'], path: at, message: 'Unrecognized key: "__proto__"' })
  })
  .pipe(SummaryObject)
export type CallTelemetrySummary = z.infer<typeof CallTelemetrySummary>

// ---------------------------------------------------------------------------
// The reader — the only door into a stats entry
// ---------------------------------------------------------------------------

/**
 * ⛔ THE ONLY STATS FIELDS THIS MODULE MAY EVER READ. Adding one is a privacy decision, not a refactor: it must hold a
 * number, a boolean, or a string that is only compared/mapped (an id, a type, an enum-like value). The tests fail if
 * anything outside this list is read, and on every one of address/ip/port/url/relatedAddress/relatedPort/foundation/
 * usernameFragment by name.
 */
export const TELEMETRY_READ_FIELDS = [
  // Linking: compared, or used as map keys — never copied out.
  'id', 'type', 'kind', 'mediaType', 'codecId', 'remoteId', 'localId',
  'selectedCandidatePairId', 'localCandidateId', 'selected', 'nominated', 'state', 'lastPacketReceivedTimestamp',
  // The two candidate fields the schema keeps — read from the selected pair's LOCAL candidate and nothing else.
  'candidateType', 'relayProtocol',
  // Mapped to an enum.
  'mimeType', 'qualityLimitationReason',
  // Numbers and booleans.
  'timestamp', 'bytesSent', 'bytesReceived', 'packetsReceived', 'packetsLost', 'jitter',
  'concealedSamples', 'totalSamplesReceived', 'frameWidth', 'frameHeight', 'framesSent', 'framesEncoded',
  'framesDecoded',
  'freezeCount', 'totalEncodeTime', 'totalDecodeTime', 'powerEfficientEncoder', 'active',
  'roundTripTime', 'totalRoundTripTime', 'roundTripTimeMeasurements',
  'currentRoundTripTime', 'responsesReceived', 'availableOutgoingBitrate',
] as const
export type TelemetryReadField = (typeof TELEMETRY_READ_FIELDS)[number]

/** One getStats entry — opaque on purpose: its fields are reached only through read(). */
export type RTCStatsLike = object

/**
 * A getStats result: an RTCStatsReport or Map (iterates as [id, stats] pairs), or any iterable of stats entries
 * (e.g. [...report.values()]).
 */
export type StatsReportLike = Iterable<unknown>

function read(entry: RTCStatsLike, field: TelemetryReadField): unknown {
  return (entry as Record<string, unknown>)[field]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const times = (v: number | null, k: number): number | null => (v === null ? null : v * k)

interface Snapshot {
  entries: RTCStatsLike[]
  byId: Map<string, RTCStatsLike>
}

function snapshot(report: StatsReportLike | null | undefined): Snapshot {
  const entries: RTCStatsLike[] = []
  const byId = new Map<string, RTCStatsLike>()
  // A report that is not iterable at all is treated as empty: telemetry never throws on what the browser hands it.
  if (report == null || typeof (report as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function') {
    return { entries, byId }
  }
  for (const item of report) {
    // An RTCStatsReport / Map iterates as [id, stats] pairs.
    const entry: unknown = Array.isArray(item) && item.length === 2 ? item[1] : item
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    entries.push(entry) // a reference, never a copy
    const id = str(read(entry, 'id'))
    if (id !== null) byId.set(id, entry)
  }
  return { entries, byId }
}

/** The entry with this id, if it has the expected type — a dangling or mistyped reference resolves to nothing. */
function lookup(snap: Snapshot, id: unknown, type: string): RTCStatsLike | undefined {
  const key = str(id)
  const entry = key === null ? undefined : snap.byId.get(key)
  return entry !== undefined && read(entry, 'type') === type ? entry : undefined
}

/** One stats object now, the same object (same id, same type) in the previous report, and the time between them. */
interface Win {
  cur: RTCStatsLike
  prev: RTCStatsLike | undefined
  /** Milliseconds between the two samples; null when there is no prev or time did not move forward. */
  dtMs: number | null
}

function windowOf(entry: RTCStatsLike, old: Snapshot | undefined): Win {
  const type = str(read(entry, 'type'))
  const prev = old === undefined || type === null ? undefined : lookup(old, read(entry, 'id'), type)
  let dtMs: number | null = null
  if (prev !== undefined) {
    const t1 = num(read(entry, 'timestamp'))
    const t0 = num(read(prev, 'timestamp'))
    if (t1 !== null && t0 !== null && t1 > t0) dtMs = t1 - t0
  }
  return { cur: entry, prev, dtMs }
}

/**
 * How much a cumulative counter grew in the window — or, with no previous sample of this stream, its whole value
 * (counters start at zero with their stream). null when unknowable: missing, negative, absent from prev, or gone
 * BACKWARDS (a replaced stream: a negative delta would be a lie).
 */
function grew(w: Win, field: TelemetryReadField): number | null {
  const now = num(read(w.cur, field))
  if (now === null || now < 0) return null
  if (w.prev === undefined) return now
  const before = num(read(w.prev, field))
  if (before === null || before < 0 || now < before) return null
  return now - before
}

/** Frames (or anything) per ms × PER_SECOND = per second. */
const PER_SECOND = 1000
/** Bytes per ms × 8 = kbit/s — exact, no 8/1000 rounding on the way. */
const BYTES_TO_KBPS = 8

/**
 * Δcounter × k ÷ Δms over the window. A rate needs a duration, so no prev (or a time step that did not move
 * forward) means null — unlike the ratios, which grew() can still answer "since the stream began".
 */
function rate(w: Win, field: TelemetryReadField, k: number): number | null {
  if (w.prev === undefined || w.dtMs === null) return null
  const d = grew(w, field)
  return d === null ? null : (d * k) / w.dtMs
}

/** part ÷ whole, null when the whole is empty or the parts are inconsistent (part > whole). */
function ratio(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0 || part > whole) return null
  return part / whole
}

/** Rounded to `decimals`, or null unless finite and within [0, max] — see TELEMETRY_LIMITS. */
function within(v: number | null, max: number, decimals: number): number | null {
  if (v === null || !Number.isFinite(v) || v < 0 || v > max) return null
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

// ---------------------------------------------------------------------------
// The measurements
// ---------------------------------------------------------------------------

/**
 * Inbound loss over the window. ⚠️ RFC 3550 §6.4.1: cumulative packetsLost goes NEGATIVE when duplicates outnumber
 * losses, so its delta is signed — duplicates are not negative loss, and the share bottoms out at 0. Stream
 * replacement is caught by packetsReceived, which only ever grows.
 */
function lossPct(w: Win): number | null {
  const received = grew(w, 'packetsReceived')
  const lostNow = num(read(w.cur, 'packetsLost'))
  if (received === null || lostNow === null) return null
  let lost = lostNow
  if (w.prev !== undefined) {
    const lostBefore = num(read(w.prev, 'packetsLost'))
    if (lostBefore === null) return null
    lost = lostNow - lostBefore
  }
  lost = Math.max(0, lost)
  const expected = received + lost
  return expected > 0 ? (100 * lost) / expected : null
}

/** Δ seconds ÷ Δ frames, in ms — the §2 promote/demote input (encode or decode time per frame). */
function msPerFrame(w: Win, seconds: TelemetryReadField, frames: TelemetryReadField): number | null {
  const t = grew(w, seconds)
  const f = grew(w, frames)
  return t === null || f === null || f === 0 ? null : (t / f) * 1000
}

/**
 * The average round trip over the window, from the cumulative total and its measurement count. A browser without
 * the totals gets its latest single reading instead; a browser WITH them that measured nothing in the window gets
 * null — a stale "latest" from a dead path would read as a healthy one.
 */
function averageRttMs(w: Win, total: TelemetryReadField, count: TelemetryReadField, latest: TelemetryReadField): number | null {
  const sum = grew(w, total)
  const n = grew(w, count)
  if (sum !== null && n !== null) return n > 0 ? (sum / n) * 1000 : null
  return times(num(read(w.cur, latest)), 1000)
}

/** DCI 8K's width, the longest frame side anything ships. Past it the dimensions are nonsense, not a frame. */
const FRAME_LONG_SIDE_MAX = 8_192

/**
 * A frame's height in codec-plan's terms: its SHORT side (codec-plan.ts: "540 means 960×540 landscape or 540×960
 * portrait"). ⚠️ frameHeight alone is the LONG side of a portrait frame. Phones usually send the sensor's landscape
 * frame plus a rotation (urn:3gpp:video-orientation), but a sender whose peer did not negotiate that extension
 * rotates before encoding, and a portrait desktop camera is portrait at the source. Either way the 540 rung would read
 * 960, i.e. better than 720p. With no usable width, the height is reported as is.
 */
function shortSide(entry: RTCStatsLike): number | null {
  const h = num(read(entry, 'frameHeight'))
  if (h === null) return null
  const w = num(read(entry, 'frameWidth'))
  if (w === null || w <= 0) return h
  return Math.max(w, h) > FRAME_LONG_SIDE_MAX ? null : Math.min(w, h)
}

function kindOf(entry: RTCStatsLike): unknown {
  return read(entry, 'kind') ?? read(entry, 'mediaType') // mediaType: pre-2020 Chromium
}

/**
 * The stream of this direction and kind. A 1:1 call has one per kind; should a renegotiation leave a stale one
 * listed, the one that moved the most bytes in the window wins (cumulative bytes without a prev).
 */
function pickStream(cur: Snapshot, old: Snapshot | undefined, type: 'outbound-rtp' | 'inbound-rtp', kind: 'audio' | 'video'): Win | undefined {
  const bytes: TelemetryReadField = type === 'outbound-rtp' ? 'bytesSent' : 'bytesReceived'
  let best: Win | undefined
  let bestActivity = -1
  for (const entry of cur.entries) {
    if (read(entry, 'type') !== type || kindOf(entry) !== kind) continue
    const w = windowOf(entry, old)
    const activity = grew(w, bytes) ?? 0
    if (activity > bestActivity) {
      best = w
      bestActivity = activity
    }
  }
  return best
}

/** The far side's RTCP view of our outbound stream: via remoteId, else the back-reference, else the kind. */
function remoteInboundFor(cur: Snapshot, outbound: RTCStatsLike, kind: 'audio' | 'video'): RTCStatsLike | undefined {
  const direct = lookup(cur, read(outbound, 'remoteId'), 'remote-inbound-rtp')
  if (direct !== undefined) return direct
  const remotes = cur.entries.filter((e) => read(e, 'type') === 'remote-inbound-rtp')
  const outId = str(read(outbound, 'id'))
  return (outId === null ? undefined : remotes.find((e) => read(e, 'localId') === outId)) ?? remotes.find((e) => kindOf(e) === kind)
}

// Lookup tables are Maps, never object literals: a candidateType, relayProtocol or qualityLimitationReason of
// "__proto__" or "constructor" (both survive toLowerCase) would otherwise resolve to an Object.prototype member and
// put an object or a function into the summary. (The codec tables are keyed by the whole "kind/name" mimeType, which
// no prototype member matches — they are Maps anyway, so nobody has to re-derive that.)
const AUDIO_CODEC = new Map<string, TelemetryAudioCodec>([
  ['audio/opus', 'opus'], ['audio/red', 'red'], ['audio/g722', 'g722'], ['audio/pcmu', 'pcmu'], ['audio/pcma', 'pcma'],
])
const VIDEO_CODEC = new Map<string, TelemetryVideoCodec>([
  ['video/h264', 'H264'], ['video/vp8', 'VP8'], ['video/vp9', 'VP9'],
  ['video/av1', 'AV1'], ['video/av1x', 'AV1'], // AV1X: Chromium's pre-standard name
  ['video/h265', 'H265'], ['video/hevc', 'H265'],
])
const CANDIDATE_TYPE = new Map<string, TelemetryCandidateType>([
  ['relay', 'relay'], ['srflx', 'srflx'], ['host', 'host'], ['prflx', 'prflx'],
  // The first webrtc-stats drafts (RTCStatsIceCandidateType), still seen from very old engines.
  ['relayed', 'relay'], ['serverreflexive', 'srflx'], ['peerreflexive', 'prflx'],
])
const RELAY_PROTOCOL = new Map<string, TelemetryRelayProtocol>([['udp', 'udp'], ['tcp', 'tcp'], ['tls', 'tls']])
const QUALITY_LIMITATION = new Map<string, TelemetryQualityLimitation>([
  ['none', 'none'], ['bandwidth', 'bandwidth'], ['cpu', 'cpu'], ['other', 'other'],
])

/** The stream's codec mimeType, lower-cased for comparison — null when the report has no codec entry for it. */
function mimeOf(cur: Snapshot, stream: RTCStatsLike): string | null {
  const codec = lookup(cur, read(stream, 'codecId'), 'codec')
  const mime = codec === undefined ? null : str(read(codec, 'mimeType'))
  return mime === null ? null : mime.toLowerCase()
}

function qualityLimitationOf(v: unknown): TelemetryQualityLimitation | null {
  // A reason this list does not know yet IS "limited for another reason"; a non-string is not a reason at all.
  return typeof v === 'string' ? (QUALITY_LIMITATION.get(v.toLowerCase()) ?? 'other') : null
}

/**
 * The pair ICE is actually using. Standard first (RTCTransportStats.selectedCandidatePairId — Chromium, WebKit), then
 * Firefox's non-standard `selected` flag (it has no transport stats), then a nominated + succeeded pair — the most
 * recently active one if an ICE restart left two listed.
 */
function selectedPair(cur: Snapshot): RTCStatsLike | undefined {
  for (const entry of cur.entries) {
    if (read(entry, 'type') !== 'transport') continue
    const pair = lookup(cur, read(entry, 'selectedCandidatePairId'), 'candidate-pair')
    if (pair !== undefined) return pair
  }
  const pairs = cur.entries.filter((e) => read(e, 'type') === 'candidate-pair')
  const flagged = pairs.find((p) => read(p, 'selected') === true)
  if (flagged !== undefined) return flagged
  let best: RTCStatsLike | undefined
  let bestT = -Infinity
  for (const pair of pairs) {
    if (read(pair, 'nominated') !== true || read(pair, 'state') !== 'succeeded') continue
    const t = num(read(pair, 'lastPacketReceivedTimestamp')) ?? -Infinity
    if (best === undefined || t > bestT) {
      best = pair
      bestT = t
    }
  }
  return best
}

function audioSummary(cur: Snapshot, old: Snapshot | undefined, out: Win | undefined, inn: Win | undefined): NonNullable<CallTelemetrySummary['audio']> {
  const remote = out === undefined ? undefined : remoteInboundFor(cur, out.cur, 'audio')
  const sendCodec = out === undefined ? null : mimeOf(cur, out.cur)
  // ⚠️ RFC 3550 jitter only moves when a packet arrives. In a window that heard none, or on a stream that has heard
  // nothing yet, the browser still lists its last value, so a dead path would read as a steady one: null, like the
  // RTT. When liveness cannot be told (no counter, or a replaced stream), the gauge stands.
  const heard = inn === undefined ? null : grew(inn, 'packetsReceived')
  return {
    codec: sendCodec === null ? null : (AUDIO_CODEC.get(sendCodec) ?? 'other'),
    sendKbps: within(out === undefined ? null : rate(out, 'bytesSent', BYTES_TO_KBPS), TELEMETRY_LIMITS.audioKbps, 1),
    recvKbps: within(inn === undefined ? null : rate(inn, 'bytesReceived', BYTES_TO_KBPS), TELEMETRY_LIMITS.audioKbps, 1),
    packetsLostPct: within(inn === undefined ? null : lossPct(inn), 100, 2),
    jitterMs: within(
      inn === undefined || heard === 0 ? null : times(num(read(inn.cur, 'jitter')), 1000),
      TELEMETRY_LIMITS.ms,
      1,
    ),
    concealedPct: within(
      inn === undefined ? null : times(ratio(grew(inn, 'concealedSamples'), grew(inn, 'totalSamplesReceived')), 100),
      100,
      2,
    ),
    rttMs: within(
      remote === undefined ? null : averageRttMs(windowOf(remote, old), 'totalRoundTripTime', 'roundTripTimeMeasurements', 'roundTripTime'),
      TELEMETRY_LIMITS.ms,
      1,
    ),
  }
}

function videoSummary(cur: Snapshot, out: Win | undefined, inn: Win | undefined): NonNullable<CallTelemetrySummary['video']> {
  const sendCodec = out === undefined ? null : mimeOf(cur, out.cur)
  // framesSent is what actually left the phone; an engine without it (older WebKit) still counts framesEncoded.
  const sentFrames: TelemetryReadField = out !== undefined && num(read(out.cur, 'framesSent')) !== null ? 'framesSent' : 'framesEncoded'
  const active = out === undefined ? null : bool(read(out.cur, 'active'))
  return {
    codec: sendCodec === null ? null : (VIDEO_CODEC.get(sendCodec) ?? 'other'),
    sendHeight: within(out === undefined ? null : shortSide(out.cur), TELEMETRY_LIMITS.frameHeight, 0),
    recvHeight: within(inn === undefined ? null : shortSide(inn.cur), TELEMETRY_LIMITS.frameHeight, 0),
    sendFps: within(out === undefined ? null : rate(out, sentFrames, PER_SECOND), TELEMETRY_LIMITS.fps, 1),
    recvFps: within(inn === undefined ? null : rate(inn, 'framesDecoded', PER_SECOND), TELEMETRY_LIMITS.fps, 1),
    freezeCount: within(inn === undefined ? null : grew(inn, 'freezeCount'), TELEMETRY_LIMITS.freezes, 0),
    qualityLimitation: out === undefined ? null : qualityLimitationOf(read(out.cur, 'qualityLimitationReason')),
    encodeMsPerFrame: within(out === undefined ? null : msPerFrame(out, 'totalEncodeTime', 'framesEncoded'), TELEMETRY_LIMITS.msPerFrame, 1),
    decodeMsPerFrame: within(inn === undefined ? null : msPerFrame(inn, 'totalDecodeTime', 'framesDecoded'), TELEMETRY_LIMITS.msPerFrame, 1),
    hardwareEncoder: out === undefined ? null : bool(read(out.cur, 'powerEfficientEncoder')),
    paused: active === null ? null : !active,
  }
}

function transportSummary(cur: Snapshot, old: Snapshot | undefined): CallTelemetrySummary['transport'] {
  const pair = selectedPair(cur)
  if (pair === undefined) return { candidateType: 'unknown', relayProtocol: null, rttMs: null, availableOutgoingKbps: null }
  // ⛔ From the local candidate: candidateType and relayProtocol, and NOTHING else — its address, port, url,
  // raddr, foundation and ufrag sit one property away and are never touched. The remote candidate is never read.
  const local = lookup(cur, read(pair, 'localCandidateId'), 'local-candidate')
  const rawType = local === undefined ? null : str(read(local, 'candidateType'))
  const candidateType = rawType === null ? 'unknown' : (CANDIDATE_TYPE.get(rawType.toLowerCase()) ?? 'unknown')
  // Asked only of a relay candidate: anything else has no phone→relay leg to describe.
  const rawRelay = local !== undefined && candidateType === 'relay' ? str(read(local, 'relayProtocol')) : null
  const outgoingBps = num(read(pair, 'availableOutgoingBitrate'))
  return {
    candidateType,
    relayProtocol: rawRelay === null ? null : (RELAY_PROTOCOL.get(rawRelay.toLowerCase()) ?? null),
    rttMs: within(averageRttMs(windowOf(pair, old), 'totalRoundTripTime', 'responsesReceived', 'currentRoundTripTime'), TELEMETRY_LIMITS.ms, 1),
    availableOutgoingKbps: within(outgoingBps === null ? null : outgoingBps / 1000, TELEMETRY_LIMITS.outgoingKbps, 0),
  }
}

/**
 * One telemetry summary from a getStats report (+ the report summarised last time, for rates) and the engine's
 * context. The output always passes CallTelemetrySummary, whatever the report holds. Throws only on an invalid ctx
 * — a caller bug, not a browser quirk.
 */
export function summarizeStats(
  report: StatsReportLike,
  prev: StatsReportLike | null | undefined,
  ctx: CallTelemetryContext,
): CallTelemetrySummary {
  const c = CallTelemetryContext.parse(ctx)
  const cur = snapshot(report)
  const old = prev == null ? undefined : snapshot(prev)
  const outA = pickStream(cur, old, 'outbound-rtp', 'audio')
  const inA = pickStream(cur, old, 'inbound-rtp', 'audio')
  const outV = pickStream(cur, old, 'outbound-rtp', 'video')
  const inV = pickStream(cur, old, 'inbound-rtp', 'video')
  return {
    v: CALL_TELEMETRY_VERSION,
    callId: c.callId,
    role: c.role,
    seq: c.seq,
    tSec: c.tSec,
    final: c.final,
    audio: outA === undefined && inA === undefined ? null : audioSummary(cur, old, outA, inA),
    video: outV === undefined && inV === undefined ? null : videoSummary(cur, outV, inV),
    transport: transportSummary(cur, old),
    restarts: c.restarts,
    held: c.held,
  }
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * Deliberately BROAD: a false positive costs one dropped summary, a false negative stores somebody's address. So
 * "999.999.999.999" counts, and so does a DTLS fingerprint (hex pairs joined by colons) — which has no place in
 * telemetry either. No valid summary can match any of them: it has no free-form string, and JSON's own punctuation
 * never produces four dotted digit groups, a "::", or seven hex:hex colons.
 */
const IP_LIKE: readonly RegExp[] = [
  // IPv4 — also inside "::ffff:10.1.2.3", "203.0.113.7:3478", "turn:198.51.100.20:3478?transport=tcp".
  /\d{1,3}(?:\.\d{1,3}){3}/,
  // IPv6, uncompressed.
  /(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}/i,
  // IPv6, compressed: every "::" form — "::", "::1", "fe80::1%en0", "[2001:db8::1]:443".
  /::/,
  // An mDNS host-candidate name (<uuid>.local): it stands in for a private address.
  /[0-9a-z-]\.local\b/i,
]

/**
 * Does this value — a JSON string, or anything JSON.stringify accepts — contain an IPv4/IPv6 literal or an mDNS host
 * name? The tests' oracle, and the server route's last check before a call_telemetry row is written (after the
 * schema, which already leaves an address nowhere to live: this catches the day someone adds a string field).
 * Fails CLOSED: a value that cannot be serialised cannot be vouched for, so it counts as containing one.
 * ⚠️ Raw JSON can hide a dot or a digit behind a backslash-u escape ("192", backslash-u002e, "168", …), which no
 * regex on the raw text sees: a string that is JSON is scanned in its canonical re-serialised form too.
 * Not covered: an address encoded as a bare integer — every number in a valid summary is below 2^24 anyway.
 */
export function containsIpLikeString(json: unknown): boolean {
  let text: string | undefined
  try {
    text = typeof json === 'string' ? json : JSON.stringify(json)
  } catch {
    return true
  }
  if (text === undefined) return false // undefined, a function, a symbol: nothing would be sent
  const scan = (s: string) => IP_LIKE.some((re) => re.test(s))
  if (scan(text)) return true
  if (typeof json === 'string' && text.includes('\\u')) {
    try {
      return scan(JSON.stringify(JSON.parse(text)))
    } catch {
      // Not JSON: the raw scan stands.
    }
  }
  return false
}
