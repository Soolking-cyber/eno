/**
 * In-app calls — the signalling WIRE CONTRACT: every event that crosses phone → box → phone, and the resync
 * snapshot a phone GETs when it suspects it missed some (DESIGN.md v3 §3.2 steps 3–8, §3.3).
 *
 * Why these shapes, in one paragraph: Supabase Realtime is a HINT, never the truth. realtime.send swallows its
 * own errors, a reconnecting socket misses whatever was broadcast meanwhile, and nothing is replayed — so the
 * box keeps the latest offer/answer/candidates per negotiation in Postgres and every phone re-reads them
 * (`ResyncSnapshot`). That makes duplicates and reordering NORMAL, not exotic: the same event can arrive once by
 * broadcast and again inside a snapshot, a 300-byte candidate POST can overtake a 6 KB offer POST on its own QUIC
 * stream, and a retransmit re-broadcasts what was already delivered. Every field below exists to let the pure
 * reducer in ./negotiation.ts sort that out without guessing:
 *   · `negId` — the negotiation (offer/answer generation) an SDP or candidate belongs to. Only the caller mints
 *     them, strictly increasing; an ICE restart is a new negId. WebRTC itself has NO generation check (a late
 *     answer to restart #1 applies happily during restart #2 and strands the call), so ours is the only one.
 *   · `idempotencyKey` — identifies one SEND. ⚠️ A RETRIED POST REUSES ITS KEY (so the box stores and broadcasts
 *     it once); a RETRANSMIT IS A NEW SEND WITH A NEW KEY (so the box re-broadcasts it — a retransmit with the old
 *     key would be deduplicated by the box and never reach the peer whose copy was lost). "Same negId, new key"
 *     is how a callee tells "the caller never got my answer" from "Realtime delivered one broadcast twice".
 *   · `tabId` — the SENDING tab. The box broadcasts in-call events on `call:<conversationId>`, which the sender's
 *     own call tab also receives, so a phone must drop its own echoes (else it adds its own ICE candidates as the
 *     peer's) and anything from a tab that is not the bound peer tab.
 *   · `v` — peers run different builds for days (Capacitor remote mode, long-open tabs). A version this build does
 *     not speak is rejected BEFORE the shape is looked at — a newer build may have changed the shape, and
 *     "reload to call" is the honest answer, not "malformed event".
 *   · hold/resume `seq`, answered_elsewhere `calleeTabId` — the two places where a boolean reading of an event in
 *     ARRIVAL order is wrong: a resume can commit before its hold, and "answered elsewhere" also reaches the tab
 *     that answered (see each schema's ⚠️).
 *
 * ⚠️ STRICT EVERYWHERE. Events originate on a STRANGER'S phone; the box re-serialises them (relay candidates
 * only, one fingerprint, one BUNDLE group), but this parser is the client's own line: unknown keys are refused,
 * every string is bounded, and nothing that is spliced into SDP-shaped text may carry a CR or LF — a candidate
 * of "candidate:… \r\na=fingerprint:…" is an SDP-injection attempt, never a candidate.
 *
 * ⚠️ `codecPlan` / `capabilities` are `unknown` ON PURPOSE: the codec module owns their schemas and validates
 * them where they are used. Typing them here would make this file the place two modules' versions collide.
 *
 * Pure: zod only, no I/O. Pinned by src/lib/calls/negotiation.test.ts.
 */
import { z } from 'zod'
import { CALL_PROTOCOL_VERSION, type CallEndReason } from './types'

/** 64 KB. A full Chrome/Safari offer with every codec is ≈6–10 KB; the cap is for abuse, not for fit. */
export const MAX_SDP_LENGTH = 64 * 1024
/** Half-trickle batches stragglers into one POST; 20 relay candidates is already several restarts' worth. */
export const MAX_CANDIDATES_PER_EVENT = 20
export const MAX_IDEMPOTENCY_KEY_LENGTH = 64
export const MAX_TAB_ID_LENGTH = 64
/** No call runs a hundred thousand negotiations (one restart per ~2 s for the 2 h cap is ≈3,600). */
export const MAX_NEG_ID = 100_000
/** A snapshot repeats a negotiation's candidates from every batch, so it may hold more than one event's 20. */
export const MAX_SNAPSHOT_CANDIDATES_PER_NEG = 64
export const MAX_SNAPSHOT_NEGOTIATIONS = 16
/**
 * The codec plan and a capability report stay opaque here (see the header), but never UNBOUNDED: a stranger's phone
 * sends them, the box stores them and the other phone hands them to the codec module. A real plan or report is a few
 * hundred bytes; 8 KB of JSON is headroom, and anything larger — or too deep to serialise — is refused (review C1).
 */
export const MAX_OPAQUE_JSON_LENGTH = 8 * 1024

/**
 * Runtime twin of types.ts's CallEndReason (a type-only union there, so zod needs a list). The two
 * compile-time checks below fail the build the moment either side gains a reason the other lacks.
 */
export const CALL_END_REASONS = [
  'hangup', 'declined', 'missed', 'cancelled', 'unavailable', 'lost',
  'blocked', 'kill_switch', 'cap_reached', 'media_failed', 'sas_mismatch', 'protocol_mismatch',
] as const satisfies readonly CallEndReason[]
type MissingEndReason = Exclude<CallEndReason, (typeof CALL_END_REASONS)[number]>
const endReasonsCoverTheUnion: [MissingEndReason] extends [never] ? true : never = true
void endReasonsCoverTheUnion

/**
 * What a PEER may say about why it ended an answered call — its own hang-up, its own media dying, a version it cannot
 * speak. Anything else in a peer's 'end' (declined, cancelled — ringing-only words the box applies — or a box-only
 * reason) would put words in the box's mouth, and reads as a plain hang-up (review C1). 'sas_mismatch' left this list
 * with the safety code (protocol v2, owner 2026-10-22): it stays in CALL_END_REASONS only because stored rows and an
 * old tab's end beacon may still carry it.
 */
export const PEER_END_REASONS: ReadonlySet<CallEndReason> = new Set<CallEndReason>([
  'hangup', 'lost', 'media_failed', 'protocol_mismatch',
])

/**
 * Reasons only the BOX decides; they reach a phone as 'ended'. ⚠️ A phone's own 'end' carrying one is a claim by a
 * stranger ("you were blocked", "calls are switched off") — the API must refuse or rewrite it, and the reducer
 * shows it as a plain hang-up.
 */
export const BOX_ONLY_END_REASONS: ReadonlySet<CallEndReason> = new Set<CallEndReason>([
  'missed', 'unavailable', 'blocked', 'kill_switch', 'cap_reached',
])

/** Kinds a phone may POST; the box relays them to the peer's call tab. */
export const CLIENT_EVENT_KINDS = [
  'ready', 'offer', 'answer', 'candidates', 'restart_request', 'hold', 'resume', 'end',
] as const
/** Kinds only the box emits. RLS on realtime.messages is receive-only, so a phone cannot forge these. */
export const SERVER_EVENT_KINDS = [
  'ring', 'cancel', 'answered_elsewhere', 'unavailable', 'accepted', 'ended',
] as const
export type ClientEventKind = (typeof CLIENT_EVENT_KINDS)[number]
export type ServerEventKind = (typeof SERVER_EVENT_KINDS)[number]
export type CallEventKind = ClientEventKind | ServerEventKind

const SERVER_KINDS: ReadonlySet<string> = new Set(SERVER_EVENT_KINDS)
export const isServerEventKind = (kind: string): kind is ServerEventKind => SERVER_KINDS.has(kind)

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

/** Printable ASCII, no spaces: keys and tab ids are machine-made (randomUUID + a counter). */
const TOKEN = /^[\x21-\x7e]+$/
const NO_LINE_BREAKS = /^[^\r\n]*$/

/** CallSession ids are UUIDs (gen_random_uuid / randomUUID). Anything else would match no event, silently. */
export const callIdSchema = z.uuid()
export const negIdSchema = z.int().min(1).max(MAX_NEG_ID)
export const idempotencyKeySchema = z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH).regex(TOKEN)
export const tabIdSchema = z.string().min(1).max(MAX_TAB_ID_LENGTH).regex(TOKEN)

/** Every browser's SDP starts with the version line; anything else would only fail later, inside the engine. */
export const sdpSchema = z.string().max(MAX_SDP_LENGTH).regex(/^v=0\r?\n/)

/**
 * RTCIceCandidateInit, as `RTCIceCandidate.toJSON()` produces it. `candidate: ''` is the standard
 * end-of-candidates marker and stays legal.
 */
export const iceCandidateSchema = z.strictObject({
  candidate: z.string().max(1024).regex(/^(?:candidate:[^\r\n]*)?$/),
  sdpMid: z.string().max(32).regex(NO_LINE_BREAKS).nullable().optional(),
  sdpMLineIndex: z.int().min(0).max(63).nullable().optional(),
  usernameFragment: z.string().max(256).regex(NO_LINE_BREAKS).nullable().optional(),
})
export type IceCandidate = z.infer<typeof iceCandidateSchema>

const endReasonSchema = z.enum(CALL_END_REASONS)
const emptyPayload = z.strictObject({})
/** An opaque JSON value under MAX_OPAQUE_JSON_LENGTH (absent is fine). */
const opaqueJson = z.unknown().refine((value) => {
  if (value === undefined) return true
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' && text.length <= MAX_OPAQUE_JSON_LENGTH
  } catch {
    return false // a cycle, or nesting too deep to serialise
  }
}, { message: `must serialise to at most ${MAX_OPAQUE_JSON_LENGTH} characters of JSON` })

const envelope = {
  v: z.literal(CALL_PROTOCOL_VERSION),
  callId: callIdSchema,
  idempotencyKey: idempotencyKeySchema,
  tabId: tabIdSchema,
}

// ---------------------------------------------------------------------------
// Events. negId is REQUIRED where a negotiation is meant (offer/answer/candidates), OPTIONAL on
// restart_request (the generation the callee saw fail — informational: a restart_request ALWAYS gets a fresh
// negId), and REFUSED everywhere else (strict objects reject the key).
// ---------------------------------------------------------------------------

const readyEvent = z.strictObject({ ...envelope, kind: z.literal('ready'), payload: emptyPayload })
const offerEvent = z.strictObject({
  ...envelope,
  kind: z.literal('offer'),
  negId: negIdSchema,
  payload: z.strictObject({
    sdp: sdpSchema,
    /** Decided ONCE by the caller (types.ts: peers run different builds) — opaque here, but bounded. */
    codecPlan: opaqueJson.optional(),
    capabilities: opaqueJson.optional(),
  }),
})
const answerEvent = z.strictObject({
  ...envelope,
  kind: z.literal('answer'),
  negId: negIdSchema,
  payload: z.strictObject({ sdp: sdpSchema }),
})
const candidatesEvent = z.strictObject({
  ...envelope,
  kind: z.literal('candidates'),
  negId: negIdSchema,
  payload: z.strictObject({ candidates: z.array(iceCandidateSchema).min(1).max(MAX_CANDIDATES_PER_EVENT) }),
})
const restartRequestEvent = z.strictObject({
  ...envelope,
  kind: z.literal('restart_request'),
  negId: negIdSchema.optional(),
  payload: emptyPayload,
})
/**
 * hold/resume carry the SENDER'S send counter (strictly increasing per call tab), and the receiver applies only a
 * newer one. ⚠️ They are two independent POSTs: an app switch of a few hundred ms is enough for the resume to
 * commit before its hold, and a boolean applied in arrival order then says "on another call" for good while the
 * person talks — and suppresses the recovery of a path that dies meanwhile.
 */
const holdPayload = z.strictObject({ seq: z.int().min(1) })
const holdEvent = z.strictObject({ ...envelope, kind: z.literal('hold'), payload: holdPayload })
const resumeEvent = z.strictObject({ ...envelope, kind: z.literal('resume'), payload: holdPayload })
const endEvent = z.strictObject({ ...envelope, kind: z.literal('end'), payload: z.strictObject({ reason: endReasonSchema }) })

const ringEvent = z.strictObject({
  ...envelope,
  kind: z.literal('ring'),
  // Ids and the media kind only: who is calling about what is fetched over HTTP, so no name or listing title
  // sits in realtime.messages for its 3-day retention.
  payload: z.strictObject({ media: z.enum(['audio', 'video']) }),
})
const cancelEvent = z.strictObject({ ...envelope, kind: z.literal('cancel'), payload: emptyPayload })
const answeredElsewhereEvent = z.strictObject({
  ...envelope,
  kind: z.literal('answered_elsewhere'),
  payload: z.strictObject({
    /**
     * The tab that WON the accept. ⚠️ Required, not decoration: this goes out on ring:<callee>, which EVERY tab of
     * the callee is subscribed to — the winning tab included, while its own accept POST and call-channel join are
     * still in flight (seconds on a cold-started phone). A bare "answered elsewhere" is indistinguishable from
     * "you answered", and the tab that answered would close itself.
     */
    calleeTabId: tabIdSchema,
  }),
})
/** Busy, declined and timed-out look the same to a stranger (DESIGN §3.2 step 1) — one kind, no reason. */
const unavailableEvent = z.strictObject({ ...envelope, kind: z.literal('unavailable'), payload: emptyPayload })
const acceptedEvent = z.strictObject({
  ...envelope,
  kind: z.literal('accepted'),
  payload: z.strictObject({
    /** The tab the box bound at accept — the only callee tab whose in-call events the caller obeys. */
    calleeTabId: tabIdSchema,
    /** The callee's CapabilityReport, for the caller's one-time codec plan. Validated by the codec module. */
    capabilities: opaqueJson.optional(),
  }),
})
const endedEvent = z.strictObject({ ...envelope, kind: z.literal('ended'), payload: z.strictObject({ reason: endReasonSchema }) })

const CLIENT_VARIANTS = [
  readyEvent, offerEvent, answerEvent, candidatesEvent, restartRequestEvent, holdEvent, resumeEvent, endEvent,
] as const
const SERVER_VARIANTS = [ringEvent, cancelEvent, answeredElsewhereEvent, unavailableEvent, acceptedEvent, endedEvent] as const

/** What the call API accepts from a phone (the box then re-serialises SDP/candidates before relaying). */
export const clientEventSchema = z.discriminatedUnion('kind', [...CLIENT_VARIANTS])
export const serverEventSchema = z.discriminatedUnion('kind', [...SERVER_VARIANTS])
/** Everything a phone can receive on its call channel. */
export const callEventSchema = z.discriminatedUnion('kind', [...CLIENT_VARIANTS, ...SERVER_VARIANTS])

export type ClientEvent = z.infer<typeof clientEventSchema>
export type ServerEvent = z.infer<typeof serverEventSchema>
export type CallEvent = z.infer<typeof callEventSchema>
export type CallEventOf<K extends CallEventKind> = Extract<CallEvent, { kind: K }>

// ---------------------------------------------------------------------------
// The resync snapshot — GET /api/calls/:id/state, Postgres's view of the negotiation.
// ---------------------------------------------------------------------------

/**
 * Coarse and monotonic on the box: ringing → accepted → ready (the callee's call tab SUBSCRIBED and said so)
 * → connected; ended is terminal. Monotonic matters: a snapshot can be STALE by the time it lands (the GET
 * raced newer broadcasts), and only fields that never go backwards can be applied without a sequence number.
 */
export const CALL_STATES = ['ringing', 'accepted', 'ready', 'connected', 'ended'] as const
export type CallStateName = (typeof CALL_STATES)[number]

/**
 * ⚠️ `candidates` holds the COUNTERPART'S candidates only (one's own are useless to oneself), oldest first,
 * grouped by negId. Optional fields tolerate JSON null (Prisma hands back null for absent columns) but unknown
 * keys are still refused.
 * ⚠️ `peerHold` is the counterpart's LATEST hold/resume event exactly as it sent it (`held` = it was a hold, `seq` =
 * its payload seq). A lost hold or resume would otherwise never be corrected: both phones then believe the other
 * is away, neither restarts when the path dies, and the UI says "on another call" to someone who is talking. The
 * seq is what makes a possibly-stale snapshot safe to apply — the reducer takes it only if newer than the last
 * hold/resume it applied. Absent/null = the box keeps no hold state (events alone, as before).
 */
export const resyncSnapshotSchema = z.strictObject({
  v: z.literal(CALL_PROTOCOL_VERSION),
  callId: callIdSchema,
  callState: z.enum(CALL_STATES),
  endReason: endReasonSchema.nullish(),
  peerTabId: tabIdSchema.nullish(),
  latestOffer: z.strictObject({
    negId: negIdSchema,
    sdp: sdpSchema,
    codecPlan: opaqueJson.optional(),
    capabilities: opaqueJson.optional(),
  }).nullish(),
  latestAnswer: z.strictObject({ negId: negIdSchema, sdp: sdpSchema }).nullish(),
  peerHold: z.strictObject({ held: z.boolean(), seq: z.int().min(1) }).nullish(),
  /**
   * The counterpart's CapabilityReport as the box stored it at its start / accept (protocol v2). The caller plans video
   * from the callee's report, and the 'accepted' event was its only source — a missed one made it plan from its OWN
   * report, on every video-capable call (v2 plan review). Validated by the codec module, like every report.
   */
  peerCapabilities: opaqueJson.optional(),
  candidates: z.array(z.strictObject({
    negId: negIdSchema,
    candidates: z.array(iceCandidateSchema).max(MAX_SNAPSHOT_CANDIDATES_PER_NEG),
  })).max(MAX_SNAPSHOT_NEGOTIATIONS),
})
export type ResyncSnapshot = z.infer<typeof resyncSnapshotSchema>

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ProtocolParseResult<T> =
  | { ok: true; value: T }
  /** A different build's protocol — show "reload to call", never "malformed". */
  | { ok: false; error: 'unsupported_version'; version: number }
  | { ok: false; error: 'invalid'; issues: string[] }

/**
 * Version FIRST, shape second: an event from a newer build is refused as `unsupported_version` even when its
 * shape is unreadable to us, because a version bump is exactly the licence to change the shape.
 */
function parseVersioned<T>(input: unknown, schema: z.ZodType<T>): ProtocolParseResult<T> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'invalid', issues: ['expected an object'] }
  }
  const v = (input as Record<string, unknown>).v
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
    return { ok: false, error: 'invalid', issues: ['v: expected a positive integer protocol version'] }
  }
  if (v !== CALL_PROTOCOL_VERSION) return { ok: false, error: 'unsupported_version', version: v }
  const parsed = schema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }
  return {
    ok: false,
    error: 'invalid',
    issues: parsed.error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`),
  }
}

/** Parse anything received on a call channel (client-relayed or box-originated). */
export function parseEvent(input: unknown): ProtocolParseResult<CallEvent> {
  return parseVersioned(input, callEventSchema)
}

/** Parse a resync snapshot (GET /api/calls/:id/state). */
export function parseSnapshot(input: unknown): ProtocolParseResult<ResyncSnapshot> {
  return parseVersioned(input, resyncSnapshotSchema)
}
