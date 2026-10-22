/**
 * In-app calls — the NEGOTIATION STATE MACHINE: who offers, when, which SDP and which ICE candidates may touch
 * the RTCPeerConnection, when to retransmit, when to ICE-restart, and when to give up (DESIGN.md v3 §3.2 steps
 * 3–8, §3.3; review-refute-engineering.md blockers 1–2, review-codex.txt C4, review-opus.txt C4).
 *
 * A PURE reducer: `step(state, input) → { state, effects }`. No timers, no I/O, no clock — time arrives as
 * `input.now` and every side effect leaves as an `effects[]` entry the call engine performs, feeding the outcome
 * back as another input. That is the whole point: the races the reviews named (a candidate before its offer, a
 * stale answer after a restart, an offer broadcast while the callee was reconnecting, a restart_request while
 * the caller is mid-offer) are pinned by a seeded simulation in negotiation.test.ts, not discovered on a
 * Viettel 4G phone at 21:00.
 *
 * The rules, and why each exists:
 *   · ONLY THE CALLER OFFERS — so SDP glare cannot happen; the callee's only lever is `restart_request`.
 *   · THE CALLER OFFERS ON `ready`, NEVER ON accept. An Answer tapped from a push cold-starts a page whose
 *     channel join finishes seconds later; an offer sent on accept is broadcast into the void.
 *   · RETRANSMIT the current offer every 2.5 s until an answer with the SAME negId arrives (a new idempotency key
 *     each time — see protocol.ts — or the box would deduplicate the very copy that needs re-broadcasting).
 *     A callee that sees a retransmit of an offer it already answered RE-SENDS its answer: the retransmit is
 *     the caller saying "I never got it". Ready and local candidates are re-sent the same way until connected.
 *   · ONE GENERATION AT A TIME. Remote candidates are queued per negId until that negId's remote description is
 *     applied, then flushed in arrival order; answers/offers/candidates for an older or already-applied negId
 *     are dropped. WebRTC has no generation check of its own (a late answer to restart #1 applies during
 *     restart #2 and leaves the caller holding the callee's stale ufrag until 'failed', ~30 s later).
 *   · RECOVER FAST, BOUNDED. ICE reports 'disconnected' only 5–7.5 s after the path dies, so an inbound-packet
 *     stall of 2 s also counts. The caller restarts at once (new negId; rollback first if it sits in
 *     have-local-offer); the callee sends restart_request, which ALWAYS yields a fresh negId (a "restart
 *     already in progress" guard deadlocks both sides when the in-progress offer was lost). A restart_request
 *     is a lone broadcast no resync recovers, so the callee repeats it — every 5 s, and at once whenever the
 *     caller retransmits an offer the callee could not answer. 20 s from ready without a connection (and 20 s
 *     from the accept while no ready has come), or 40 s without media once connected, ends the call as 'lost'.
 *     SDP operations failing in a ROW (no completed negotiation between) end it as media_failed.
 *   · POSTGRES IS THE TRUTH. A resync snapshot that is newer than local state is applied (so an offer broadcast
 *     while the callee was reconnecting still arrives); one that is older changes nothing, because everything
 *     taken from it is compared by negId, by the peer's hold seq, or is monotonic.
 *   · HOLD (a GSM call, the app backgrounded): media loss while either side is on hold starts no restart and no
 *     40 s 'lost' clock — each person's own 2-minute hold limit governs instead — and resuming forces an ICE
 *     restart (on BOTH sides when the media died meanwhile). ⚠️ The peer's hold is only what its events said:
 *     they are applied in SEND order (a seq — the two POSTs race), healed from the snapshot when one is lost, and
 *     its 2-minute limit ends the call only when the media agrees (a stale flag must never hang up a talker).
 *   · answered_elsewhere closes only a callee tab the box did NOT name as the winner — it reaches the winning tab
 *     too, on ring:<callee>, while that tab's accept is still in flight.
 *   · END IS TERMINAL AND IDEMPOTENT: once ended, every input is a no-op.
 *
 * ⚠️ EFFECTS ARE ORDERED. The engine must run the RTCPeerConnection effects (createOffer, createAnswer,
 * setRemoteDescription, addCandidates, rollback) strictly in emission order, each awaited before the next — the
 * reducer's picture of the signalling state assumes exactly that (it is what the PC's own operations chain
 * does, provided nothing else touches the PC). `createOffer`/`createAnswer` mean "create AND
 * setLocalDescription"; report back with `localDescriptionReady` (or `operationFailed`).
 *
 * ⚠️ `instanceId` MUST BE FRESH PER REDUCER (crypto.randomUUID() at engine start). Idempotency keys are
 * `${instanceId}:${seq}`; a tab id survives a reload (sessionStorage) while the counter restarts at 1, so keys
 * derived from the tab id would collide with the pre-reload page's and the box would silently drop them.
 *
 * ⚠️ NOT THIS MODULE'S JOB: the DTLS certificate (protocol v1's safety code pinned it from getStats; removed in v2).
 * This reducer treats SDP as opaque text.
 */
import { CALL_PROTOCOL_VERSION, type CallEndReason, type CallRole } from './types'
import {
  MAX_CANDIDATES_PER_EVENT, PEER_END_REASONS, MAX_SNAPSHOT_CANDIDATES_PER_NEG, callIdSchema, isServerEventKind, tabIdSchema,
  type CallEvent, type ClientEvent, type IceCandidate, type ResyncSnapshot,
} from './protocol'

export const RETRANSMIT_MS = 2_500
export const RESYNC_MS = 2_000
export const CONNECT_DEADLINE_MS = 20_000
export const LOST_DEADLINE_MS = 40_000
export const STALL_RESTART_MS = 2_000
export const HOLD_LIMIT_MS = 120_000
/** The callee repeats an unanswered restart_request this often — slower than a round trip, so it cannot churn. */
export const RESTART_REQUEST_RETRY_MS = 5_000
/** SDP operations that may fail IN A ROW — with no completed negotiation in between — before the call ends as
 * media_failed: a deterministic failure would otherwise loop restart → fail → restart at machine speed. ⚠️ In a
 * row, not per call: a two-hour call that survives one failed restart per network change must not die of the
 * fourth one. A completed negotiation (caller: answer applied; callee: answer created) resets the count. */
export const MAX_SDP_FAILURES = 3

const SEEN_KEYS_CAP = 256
/** Remote candidates accepted per generation (added or queued) — the box's own snapshot holds no more than this. */
const REMOTE_CANDIDATES_PER_NEG = MAX_SNAPSHOT_CANDIDATES_PER_NEG
const QUEUE_NEG_CAP = 4
const LOCAL_CANDIDATES_CAP = 64
/** A callee queues candidates for at most this many negIds ahead of the newest offer it has seen. */
const FUTURE_NEG_WINDOW = 8

export type NegotiationPhase = 'idle' | 'waiting_ready' | 'connecting' | 'connected' | 'reconnecting' | 'ended'
export type TimerName = 'retransmit' | 'resync' | 'connectDeadline' | 'lostDeadline' | 'holdDeadline'
export const TIMER_NAMES: readonly TimerName[] = ['retransmit', 'resync', 'connectDeadline', 'lostDeadline', 'holdDeadline']
export type IceConnectionState = 'new' | 'checking' | 'connected' | 'completed' | 'disconnected' | 'failed' | 'closed'
export type SdpOperation = 'createOffer' | 'createAnswer' | 'setRemoteDescription'
/** Where this side's RTCPeerConnection is in the offer/answer cycle, as far as the reducer has asked it to go. */
export type PcOp = 'none' | 'creatingOffer' | 'awaitingAnswer' | 'applyingAnswer' | 'applyingOffer' | 'creatingAnswer'
export type EndOrigin = 'local' | 'remote'
/** 'answered_elsewhere' never reaches the box: it only closes a callee tab that did not accept. */
export type NegotiationEndReason = CallEndReason | 'answered_elsewhere'

export interface OfferRecord {
  readonly negId: number
  readonly sdp: string
  readonly codecPlan?: unknown
  readonly capabilities?: unknown
}
export interface CandidateBatch {
  readonly negId: number
  readonly list: readonly IceCandidate[]
}

export interface NegotiationState {
  readonly role: CallRole
  readonly callId: string
  readonly tabId: string
  readonly instanceId: string
  /** The one peer tab whose in-call events are obeyed (bound by the box at accept). null = not known yet. */
  readonly peerTabId: string | null
  readonly phase: NegotiationPhase
  readonly everConnected: boolean
  /** Send counter behind the idempotency keys. */
  readonly seq: number
  /** Remote events already processed, as `${senderTabId} ${idempotencyKey}` (box events: ` ${idempotencyKey}`). */
  readonly seenKeys: readonly string[]
  /** Caller: the newest negId it minted. Callee: the newest offer negId it has seen. 0 = none. */
  readonly negId: number
  /** The negId whose REMOTE description is applied (caller: answer; callee: offer). 0 = none. */
  readonly remoteNegId: number
  readonly op: PcOp
  readonly opNegId: number
  /** Caller: a restart arrived while an SDP operation was in flight; run it when that operation lands. */
  readonly restartQueued: boolean
  /** Caller: the callee's call tab has said ready (event or snapshot). */
  readonly readySeen: boolean
  /** Caller: the local offer being negotiated. Callee: the remote offer being applied/answered. */
  readonly offer: OfferRecord | null
  /** Callee: the newest offer, waiting for the PC to finish what it is doing. */
  readonly pendingOffer: OfferRecord | null
  /** Callee: the last answer sent, re-sent when its offer is retransmitted. */
  readonly answer: { readonly negId: number; readonly sdp: string } | null
  /**
   * Callee: the negId of the last offer this side fully answered (sent or superseded) — the PC's last STABLE remote
   * description, which is what a rollback out of have-remote-offer returns to. 0 = none.
   */
  readonly answeredNegId: number
  readonly localCandidates: CandidateBatch
  readonly remoteQueue: readonly CandidateBatch[]
  readonly remoteSeen: readonly { readonly negId: number; readonly keys: readonly string[] }[]
  readonly iceState: IceConnectionState
  readonly stalled: boolean
  readonly mediaLostAt: number | null
  /** Callee: the negId its outstanding restart_request complained about, and when it was sent. */
  readonly restartRequestedFor: number | null
  readonly restartRequestedAt: number | null
  readonly localOnHold: boolean
  readonly peerOnHold: boolean
  /** The send counter of the last peer hold/resume applied — an older one arriving late is ignored. 0 = none. */
  readonly peerHoldSeq: number
  /** When this side's hold began, and when the peer's did (as its events said): each person gets their own 2 minutes. */
  readonly localHoldSince: number | null
  readonly peerHoldSince: number | null
  readonly sdpFailures: number
  /** When each timer is due (ms, the engine's clock), or null when not armed. */
  readonly timers: Readonly<Record<TimerName, number | null>>
  readonly ended: { readonly reason: NegotiationEndReason; readonly origin: EndOrigin } | null
}

export type NegotiationInput =
  /** Callee: the accept POST succeeded AND the call channel is SUBSCRIBED. Caller: the box reported the accept. */
  | { type: 'accepted'; now: number }
  /** The call channel re-SUBSCRIBED after a drop: resync, and a callee re-announces ready. */
  | { type: 'resubscribed'; now: number }
  | { type: 'localDescriptionReady'; now: number; negId: number; sdp: string; codecPlan?: unknown; capabilities?: unknown }
  | { type: 'remoteDescriptionApplied'; now: number; negId: number }
  | { type: 'operationFailed'; now: number; negId: number; op: SdpOperation }
  | { type: 'candidatesGathered'; now: number; negId: number; candidates: readonly IceCandidate[] }
  | { type: 'iceConnectionStateChange'; now: number; state: IceConnectionState }
  /** Dispatch on EVERY stats poll: ms since inbound packetsReceived last grew (0 = flowing). */
  | { type: 'packetsStalled'; now: number; stalledMs: number }
  | { type: 'localHold'; now: number }
  | { type: 'localResume'; now: number }
  | { type: 'localEnd'; now: number; reason: CallEndReason }
  /** An event already validated by protocol.ts parseEvent. */
  | { type: 'remote'; now: number; event: CallEvent }
  | { type: 'timer'; now: number; timer: TimerName }
  /** A snapshot already validated by protocol.ts parseSnapshot. */
  | { type: 'snapshot'; now: number; snapshot: ResyncSnapshot }

export type NegotiationEffect =
  /** POST to the box, retrying with the SAME event (same key) until it is acknowledged. */
  | { type: 'send'; event: ClientEvent }
  | { type: 'createOffer'; negId: number; iceRestart: boolean }
  /** Callee: apply the offer's codec plan to the transceivers (both sendrecv), then createAnswer. */
  | { type: 'createAnswer'; negId: number; codecPlan?: unknown; peerCapabilities?: unknown }
  | { type: 'setRemoteDescription'; negId: number; sdpType: 'offer' | 'answer'; sdp: string }
  | { type: 'addCandidates'; negId: number; candidates: readonly IceCandidate[] }
  | { type: 'rollback' }
  /** Arm (or re-arm, replacing) the named timer; when it fires, dispatch { type: 'timer', timer }. */
  | { type: 'schedule'; timer: TimerName; atMs: number }
  | { type: 'cancel'; timer: TimerName }
  /** GET the call state and dispatch it as a 'snapshot' input (drop the response if the GET fails). */
  | { type: 'fetchState' }
  /** Tear the call down locally. Network-wise the 'end' event (if any) was already emitted as a send. */
  | { type: 'endCall'; reason: NegotiationEndReason; origin: EndOrigin }

export interface StepResult {
  state: NegotiationState
  effects: NegotiationEffect[]
}

export interface NegotiationOptions {
  role: CallRole
  callId: string
  tabId: string
  /** Fresh per reducer — see the ⚠️ in the header. 8–40 chars of [A-Za-z0-9_-] (a randomUUID fits). */
  instanceId: string
  peerTabId?: string | null
  now: number
}

type Draft = { -readonly [K in keyof NegotiationState]: NegotiationState[K] }
type Fx = NegotiationEffect[]
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type OutgoingBody = DistributiveOmit<ClientEvent, 'v' | 'callId' | 'tabId' | 'idempotencyKey'>

/**
 * The initial state — plus, for the caller, the resync polling that runs while it rings. Throws on options
 * that would make every event invalid or unmatchable (a programming error, better loud at call start).
 */
export function createNegotiation(opts: NegotiationOptions): StepResult {
  // ⚠️ ≥ 8 random characters: every key is `${instanceId}:${seq}`, and a short id makes it likelier that a reloaded
  // page's keys meet the previous page's (the header's ⚠️) — the box would then swallow this page's sends as retries.
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(opts.instanceId)) throw new TypeError('negotiation: instanceId must be 8–40 chars of [A-Za-z0-9_-]')
  if (!tabIdSchema.safeParse(opts.tabId).success) throw new TypeError('negotiation: invalid tabId')
  if (opts.peerTabId != null && !tabIdSchema.safeParse(opts.peerTabId).success) throw new TypeError('negotiation: invalid peerTabId')
  if (!callIdSchema.safeParse(opts.callId).success) throw new TypeError('negotiation: callId must be a UUID')
  const timers: Record<TimerName, number | null> = {
    retransmit: null, resync: null, connectDeadline: null, lostDeadline: null, holdDeadline: null,
  }
  const effects: NegotiationEffect[] = []
  if (opts.role === 'caller') {
    timers.resync = opts.now + RESYNC_MS
    effects.push({ type: 'schedule', timer: 'resync', atMs: timers.resync })
  }
  const state: NegotiationState = {
    role: opts.role, callId: opts.callId, tabId: opts.tabId, instanceId: opts.instanceId,
    peerTabId: opts.peerTabId ?? null, phase: 'idle', everConnected: false, seq: 0, seenKeys: [],
    negId: 0, remoteNegId: 0, op: 'none', opNegId: 0, restartQueued: false, readySeen: false,
    offer: null, pendingOffer: null, answer: null, answeredNegId: 0,
    localCandidates: { negId: 0, list: [] }, remoteQueue: [], remoteSeen: [],
    iceState: 'new', stalled: false, mediaLostAt: null, restartRequestedFor: null, restartRequestedAt: null,
    localOnHold: false, peerOnHold: false, peerHoldSeq: 0, localHoldSince: null, peerHoldSince: null, sdpFailures: 0, timers, ended: null,
  }
  return { state, effects }
}

/** The reducer. Never mutates `state`; an ended negotiation returns it unchanged with no effects. */
export function step(state: NegotiationState, input: NegotiationInput): StepResult {
  if (state.phase === 'ended') return { state, effects: [] }
  const d: Draft = { ...state }
  const fx: Fx = []
  const now = input.now
  switch (input.type) {
    case 'accepted': onAccepted(d, fx, now); break
    case 'resubscribed':
      fx.push({ type: 'fetchState' })
      if (d.role === 'callee' && d.phase !== 'idle') emit(d, fx, { kind: 'ready', payload: {} })
      break
    case 'localDescriptionReady': onLocalDescription(d, fx, input); break
    case 'remoteDescriptionApplied': onRemoteApplied(d, fx, input.negId, now); break
    case 'operationFailed': onOperationFailed(d, fx, input.negId, input.op, now); break
    case 'candidatesGathered': onCandidatesGathered(d, fx, input.negId, input.candidates); break
    case 'iceConnectionStateChange': onIceState(d, fx, input.state, now); break
    case 'packetsStalled': onStall(d, fx, input.stalledMs, now); break
    case 'localHold':
      if (d.localOnHold) break
      d.localOnHold = true
      d.localHoldSince = now
      // seq = this event's own send counter (the one in its idempotency key): strictly increasing, so the peer can
      // apply hold/resume in the order they were sent whatever order the box commits them in.
      emit(d, fx, { kind: 'hold', payload: { seq: d.seq + 1 } })
      enterHold(d, fx)
      break
    case 'localResume':
      if (!d.localOnHold) break
      d.localOnHold = false
      d.localHoldSince = null
      emit(d, fx, { kind: 'resume', payload: { seq: d.seq + 1 } })
      leaveHold(d, fx, now)
      // DESIGN §3.2 step 8: on resume the mic is reopened AND the ICE path rebuilt — whatever the network did
      // while we were away, a fresh generation is cheaper than discovering a dead one 2 s later.
      if (d.everConnected && !d.peerOnHold) recover(d, fx, now)
      break
    case 'localEnd': endLocal(d, fx, input.reason); break
    case 'remote': onRemote(d, fx, input.event, now); break
    case 'timer': onTimer(d, fx, input.timer, now); break
    case 'snapshot': onSnapshot(d, fx, input.snapshot, now); break
  }
  return { state: d, effects: fx }
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function emit(d: Draft, fx: Fx, body: OutgoingBody): void {
  d.seq += 1
  const event = {
    v: CALL_PROTOCOL_VERSION, callId: d.callId, tabId: d.tabId, idempotencyKey: `${d.instanceId}:${d.seq}`, ...body,
  } as ClientEvent
  fx.push({ type: 'send', event })
}

function sendCandidates(d: Draft, fx: Fx, negId: number, list: readonly IceCandidate[]): void {
  for (let i = 0; i < list.length; i += MAX_CANDIDATES_PER_EVENT) {
    emit(d, fx, { kind: 'candidates', negId, payload: { candidates: list.slice(i, i + MAX_CANDIDATES_PER_EVENT) } })
  }
}

function arm(d: Draft, fx: Fx, timer: TimerName, atMs: number): void {
  if (d.timers[timer] === atMs) return
  d.timers = { ...d.timers, [timer]: atMs }
  fx.push({ type: 'schedule', timer, atMs })
}
function armIfIdle(d: Draft, fx: Fx, timer: TimerName, atMs: number): void {
  if (d.timers[timer] === null) arm(d, fx, timer, atMs)
}
function disarm(d: Draft, fx: Fx, timer: TimerName): void {
  if (d.timers[timer] === null) return
  d.timers = { ...d.timers, [timer]: null }
  fx.push({ type: 'cancel', timer })
}

const candidateKey = (c: IceCandidate) => `${c.sdpMid ?? ''}|${c.sdpMLineIndex ?? ''}|${c.candidate}`
const onHold = (d: Draft) => d.localOnHold || d.peerOnHold
const iceUp = (s: IceConnectionState) => s === 'connected' || s === 'completed'
const needsResync = (d: Draft) =>
  d.phase === 'waiting_ready' || d.phase === 'connecting' || d.phase === 'reconnecting' ||
  (d.phase === 'idle' && d.role === 'caller')

/** Forget queued/seen remote candidates of generations older than the newest negId. */
function pruneRemote(d: Draft): void {
  d.remoteQueue = d.remoteQueue.filter((b) => b.negId >= d.negId)
  d.remoteSeen = d.remoteSeen.filter((e) => e.negId >= d.negId)
}

function finish(d: Draft, fx: Fx, reason: NegotiationEndReason, origin: EndOrigin): void {
  for (const timer of TIMER_NAMES) disarm(d, fx, timer)
  d.phase = 'ended'
  d.ended = { reason, origin }
  fx.push({ type: 'endCall', reason, origin })
}
function endLocal(d: Draft, fx: Fx, reason: CallEndReason): void {
  if (d.phase === 'ended') return
  emit(d, fx, { kind: 'end', payload: { reason } })
  finish(d, fx, reason, 'local')
}
function endRemote(d: Draft, fx: Fx, reason: NegotiationEndReason): void {
  if (d.phase === 'ended') return
  finish(d, fx, reason, 'remote')
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function onAccepted(d: Draft, fx: Fx, now: number): void {
  if (d.role === 'caller') {
    if (d.phase === 'idle') d.phase = 'waiting_ready'
    armIfIdle(d, fx, 'resync', now + RESYNC_MS)
    // ⚠️ Bounded even before ready. A callee whose call channel never SUBSCRIBES (the Realtime tenant at its
    // connection cap, a WebView that cannot open the socket) keeps heartbeating over HTTP, so the box's sweep never
    // fires — and neither side would ever give up. The first ready re-arms this from the ready, as specified.
    if (!d.readySeen && !d.everConnected) armIfIdle(d, fx, 'connectDeadline', now + CONNECT_DEADLINE_MS)
    return
  }
  if (d.phase !== 'idle') return
  d.phase = 'connecting'
  emit(d, fx, { kind: 'ready', payload: {} })
  arm(d, fx, 'connectDeadline', now + CONNECT_DEADLINE_MS)
  fx.push({ type: 'fetchState' })
  arm(d, fx, 'resync', now + RESYNC_MS)
  // Re-announces ready until the first offer shows up, so even a callee whose GETs all fail gets one.
  arm(d, fx, 'retransmit', now + RETRANSMIT_MS)
  if (d.pendingOffer && d.op === 'none') startApplyOffer(d, fx)
}

/** Caller: the callee's call tab is subscribed. The first ready starts negotiation; a later one re-sends. */
function onReady(d: Draft, fx: Fx, now: number): void {
  if (d.role !== 'caller') return
  if (!d.readySeen) {
    d.readySeen = true
    if (d.phase === 'idle' || d.phase === 'waiting_ready') d.phase = 'connecting'
    if (!d.everConnected) arm(d, fx, 'connectDeadline', now + CONNECT_DEADLINE_MS)
    armIfIdle(d, fx, 'resync', now + RESYNC_MS)
    if (d.negId === 0) createOfferNext(d, fx, false)
    return
  }
  // A second ready means the callee (re)subscribed and may have missed what was broadcast meanwhile.
  if (d.op === 'awaitingAnswer') resendOffer(d, fx, now)
}

function createOfferNext(d: Draft, fx: Fx, iceRestart: boolean): void {
  if (d.role !== 'caller') return // the callee never offers — the only glare-free rule there is
  d.negId += 1
  d.op = 'creatingOffer'
  d.opNegId = d.negId
  d.offer = null
  d.restartQueued = false
  d.localCandidates = { negId: d.negId, list: [] }
  pruneRemote(d)
  fx.push({ type: 'createOffer', negId: d.negId, iceRestart })
}

function resendOffer(d: Draft, fx: Fx, now: number): void {
  const offer = d.offer
  if (!offer) return
  emitOffer(d, fx, offer)
  if (d.localCandidates.negId === offer.negId) sendCandidates(d, fx, offer.negId, d.localCandidates.list)
  arm(d, fx, 'retransmit', now + RETRANSMIT_MS)
}

function emitOffer(d: Draft, fx: Fx, offer: OfferRecord): void {
  emit(d, fx, {
    kind: 'offer',
    negId: offer.negId,
    payload: {
      sdp: offer.sdp,
      ...(offer.codecPlan !== undefined ? { codecPlan: offer.codecPlan } : {}),
      ...(offer.capabilities !== undefined ? { capabilities: offer.capabilities } : {}),
    },
  })
}

function onLocalDescription(d: Draft, fx: Fx, input: Extract<NegotiationInput, { type: 'localDescriptionReady' }>): void {
  const { negId, sdp, now } = input
  if (d.role === 'caller') {
    if (d.op !== 'creatingOffer' || negId !== d.opNegId) return
    if (d.restartQueued) {
      // A restart (restart_request, a dead path) landed while this offer was being made. It is already
      // obsolete: never send it — roll it back and offer a fresh negId instead.
      fx.push({ type: 'rollback' })
      createOfferNext(d, fx, true)
      return
    }
    const offer: OfferRecord = {
      negId, sdp,
      ...(input.codecPlan !== undefined ? { codecPlan: input.codecPlan } : {}),
      ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
    }
    d.offer = offer
    d.op = 'awaitingAnswer'
    emitOffer(d, fx, offer)
    if (d.localCandidates.negId === negId && d.localCandidates.list.length > 0) {
      sendCandidates(d, fx, negId, d.localCandidates.list)
    }
    arm(d, fx, 'retransmit', now + RETRANSMIT_MS)
    return
  }
  if (d.op !== 'creatingAnswer' || negId !== d.opNegId) return
  d.op = 'none'
  d.answeredNegId = negId // the PC is stable again, with this offer as its remote description
  d.sdpFailures = 0
  if (d.pendingOffer) {
    // A newer offer arrived while this answer was being made: the caller has already abandoned this negId,
    // so the answer would only be dropped there. Skip it; the PC is stable, apply the newer offer.
    startApplyOffer(d, fx)
    return
  }
  d.answer = { negId, sdp }
  emit(d, fx, { kind: 'answer', negId, payload: { sdp } })
  armIfIdle(d, fx, 'retransmit', now + RETRANSMIT_MS)
}

function startApplyOffer(d: Draft, fx: Fx): void {
  const offer = d.pendingOffer
  if (!offer) return
  d.pendingOffer = null
  d.offer = offer
  d.op = 'applyingOffer'
  d.opNegId = offer.negId
  fx.push({ type: 'setRemoteDescription', negId: offer.negId, sdpType: 'offer', sdp: offer.sdp })
}

function flushQueued(d: Draft, fx: Fx, negId: number): void {
  const batch = d.remoteQueue.find((b) => b.negId === negId)
  d.remoteQueue = d.remoteQueue.filter((b) => b.negId > negId)
  if (batch && batch.list.length > 0) fx.push({ type: 'addCandidates', negId, candidates: batch.list })
}

function onRemoteApplied(d: Draft, fx: Fx, negId: number, now: number): void {
  if (d.role === 'caller') {
    if (d.op !== 'applyingAnswer' || negId !== d.opNegId) return
    d.op = 'none'
    d.remoteNegId = negId
    d.sdpFailures = 0 // a completed negotiation: whatever failed before it was not a loop
    flushQueued(d, fx, negId)
    if (d.restartQueued) startRestart(d, fx, now)
    return
  }
  if (d.op !== 'applyingOffer' || negId !== d.opNegId) return
  if (d.pendingOffer) {
    // Superseded while it was being applied (have-remote-offer): roll it back, apply the newer one.
    fx.push({ type: 'rollback' })
    d.op = 'none'
    startApplyOffer(d, fx)
    return
  }
  d.remoteNegId = negId
  flushQueued(d, fx, negId)
  d.op = 'creatingAnswer'
  d.localCandidates = { negId, list: [] }
  const offer = d.offer
  fx.push({
    type: 'createAnswer',
    negId,
    ...(offer?.codecPlan !== undefined ? { codecPlan: offer.codecPlan } : {}),
    ...(offer?.capabilities !== undefined ? { peerCapabilities: offer.capabilities } : {}),
  })
}

function onOperationFailed(d: Draft, fx: Fx, negId: number, op: SdpOperation, now: number): void {
  if (negId !== d.opNegId) return
  const matches =
    (op === 'createOffer' && d.op === 'creatingOffer') ||
    (op === 'createAnswer' && d.op === 'creatingAnswer') ||
    (op === 'setRemoteDescription' && (d.op === 'applyingAnswer' || d.op === 'applyingOffer'))
  if (!matches) return
  d.sdpFailures += 1
  if (d.sdpFailures > MAX_SDP_FAILURES) {
    endLocal(d, fx, 'media_failed')
    return
  }
  if (d.role === 'caller') {
    if (d.op === 'applyingAnswer') fx.push({ type: 'rollback' }) // the answer never applied: still have-local-offer
    d.op = 'none'
    createOfferNext(d, fx, true)
    return
  }
  if (d.op === 'creatingAnswer') {
    fx.push({ type: 'rollback' }) // still have-remote-offer
    // ⚠️ The rollback takes the PC back to its last stable remote description: this offer is no longer applied,
    // so its candidates must queue again (addIceCandidate would reject them, or add them to the wrong generation).
    d.remoteNegId = d.answeredNegId
  }
  d.op = 'none'
  if (d.pendingOffer) startApplyOffer(d, fx)
  else sendRestartRequest(d, fx, now)
}

function onCandidatesGathered(d: Draft, fx: Fx, negId: number, candidates: readonly IceCandidate[]): void {
  if (candidates.length === 0 || negId !== d.negId || negId !== d.localCandidates.negId) return
  if (d.role === 'caller' && d.restartQueued) return // that offer is about to be abandoned
  if (d.role === 'callee' && !(d.op === 'creatingAnswer' && d.opNegId === negId) && d.answer?.negId !== negId) return
  d.localCandidates = { negId, list: [...d.localCandidates.list, ...candidates].slice(0, LOCAL_CANDIDATES_CAP) }
  // A caller still making its offer sends them with the offer (onLocalDescription); otherwise now. The peer
  // queues candidates that beat their SDP, so early is safe — merely pointless before the offer exists.
  if (d.role === 'caller' && d.op === 'creatingOffer') return
  sendCandidates(d, fx, negId, candidates)
}

/**
 * The peer's candidates, from an event or a snapshot: dedupe, then add now or queue until their SDP applies.
 * ⚠️ "Seen" means ADDED OR STILL QUEUED, never merely "arrived": a candidate a cap turned away must stay unseen,
 * or its retransmission (and the snapshot's copy) would be deduplicated away and its generation lose it for good.
 */
function acceptRemoteCandidates(d: Draft, fx: Fx, negId: number, list: readonly IceCandidate[]): void {
  if (d.role === 'caller') {
    if (d.negId === 0 || negId !== d.negId) return // stale generation (or one we never minted)
  } else if (negId < d.negId || negId > d.negId + FUTURE_NEG_WINDOW) {
    return
  }
  const keys = new Set(d.remoteSeen.find((e) => e.negId === negId)?.keys ?? [])
  const fresh: IceCandidate[] = []
  for (const c of list) {
    // A generation is bounded: relay-only gathering yields 2–6 per side, and every candidate handed to the PC is
    // paired and checked — a peer streaming distinct candidates must not grow that without limit.
    if (keys.size >= REMOTE_CANDIDATES_PER_NEG) break
    const key = candidateKey(c)
    if (keys.has(key)) continue
    keys.add(key)
    fresh.push(c)
  }
  if (fresh.length === 0) return
  const seenNow = { negId, keys: [...keys] }
  if (d.remoteNegId === negId && d.negId === negId) {
    d.remoteSeen = [...d.remoteSeen.filter((e) => e.negId !== negId), seenNow]
    fx.push({ type: 'addCandidates', negId, candidates: fresh })
    return
  }
  const queued = d.remoteQueue.find((b) => b.negId === negId)
  const all = [...d.remoteQueue.filter((b) => b.negId !== negId), { negId, list: [...(queued?.list ?? []), ...fresh] }]
    .sort((a, b) => a.negId - b.negId)
  // More generations waiting than there is room for: the NEWEST win (a callee never applies an offer older than
  // one it has seen), and an evicted generation is forgotten entirely so that a retransmission can bring it back.
  const keep = all.slice(-QUEUE_NEG_CAP)
  const evicted = new Set(all.slice(0, all.length - keep.length).map((b) => b.negId))
  d.remoteQueue = keep
  d.remoteSeen = [
    ...d.remoteSeen.filter((e) => e.negId !== negId && !evicted.has(e.negId)),
    ...(evicted.has(negId) ? [] : [seenNow]),
  ]
}

// ---------------------------------------------------------------------------
// Remote events and snapshots
// ---------------------------------------------------------------------------

function onRemote(d: Draft, fx: Fx, event: CallEvent, now: number): void {
  if (event.callId !== d.callId) return
  if (!isServerEventKind(event.kind)) {
    if (event.tabId === d.tabId) return // our own broadcast, echoed back by call:<conversationId>
    if (d.peerTabId !== null && event.tabId !== d.peerTabId) return // not the tab the box bound
  }
  // ⚠️ A key identifies one send BY ITS SENDER. The peer picks its keys freely, so one shared namespace would let
  // it pre-empt a box event (an 'ended', a 'cancel') by sending first under the same key. Box events are keyed
  // with a leading space: a tab id is ≥1 printable non-space character, so the two namespaces cannot meet.
  const seenKey = `${isServerEventKind(event.kind) ? '' : event.tabId} ${event.idempotencyKey}`
  if (d.seenKeys.includes(seenKey)) return
  d.seenKeys = [...d.seenKeys, seenKey].slice(-SEEN_KEYS_CAP)
  switch (event.kind) {
    case 'ready': onReady(d, fx, now); break
    case 'offer': if (d.role === 'callee') onOffer(d, fx, { negId: event.negId, ...event.payload }, true, now); break
    case 'answer': if (d.role === 'caller') onAnswer(d, fx, event.negId, event.payload.sdp); break
    case 'candidates': acceptRemoteCandidates(d, fx, event.negId, event.payload.candidates); break
    case 'restart_request': if (d.role === 'caller') startRestart(d, fx, now); break
    case 'hold':
    case 'resume':
      // In SEND order: a resume that overtook its hold must not be undone by the hold arriving after it.
      if (event.payload.seq <= d.peerHoldSeq) break
      d.peerHoldSeq = event.payload.seq
      setPeerHold(d, fx, event.kind === 'hold', now)
      break
    case 'end': // the PEER's word — only what a peer may say of its own end is believed (protocol.ts PEER_END_REASONS)
      endRemote(d, fx, PEER_END_REASONS.has(event.payload.reason) ? event.payload.reason : 'hangup')
      break
    case 'ended': endRemote(d, fx, event.payload.reason); break
    case 'cancel': endRemote(d, fx, 'cancelled'); break
    case 'unavailable': if (d.role === 'caller') endRemote(d, fx, 'unavailable'); break
    case 'answered_elsewhere':
      // ⚠️ ring:<callee> reaches EVERY tab of the callee, including the one whose accept caused this broadcast —
      // and that tab is still 'idle' here (its accept POST and channel join are in flight), so the phase alone
      // cannot tell "another tab answered" from "I answered". The box names the winner; only a loser closes. An
      // already-accepted tab ignores it whatever it says (a stale or misrouted copy must not drop a live call).
      if (d.role === 'callee' && d.phase === 'idle' && event.payload.calleeTabId !== d.tabId) {
        endRemote(d, fx, 'answered_elsewhere')
      }
      break
    case 'accepted':
      if (d.role !== 'caller') break
      if (d.peerTabId === null) d.peerTabId = event.payload.calleeTabId
      onAccepted(d, fx, now)
      break
    case 'ring': break // the ring overlay's business, not the negotiation's
  }
}

/**
 * Callee. `retransmit` = it came as an event (a retransmit may mean "I never got your answer"); a snapshot
 * repeating an offer we answered is just the box's memory and earns no re-send.
 */
function onOffer(d: Draft, fx: Fx, offer: OfferRecord, retransmit: boolean, now: number): void {
  if (offer.negId < d.negId) return // older generation
  if (offer.negId === d.negId) {
    if (!retransmit || d.op !== 'none') return // otherwise already being applied or answered
    if (d.answer?.negId === offer.negId) {
      emit(d, fx, { kind: 'answer', negId: offer.negId, payload: { sdp: d.answer.sdp } })
      if (d.localCandidates.negId === offer.negId) sendCandidates(d, fx, offer.negId, d.localCandidates.list)
    } else if (d.restartRequestedFor === offer.negId && !onHold(d) && now - (d.restartRequestedAt ?? 0) >= RETRANSMIT_MS) {
      // ⚠️ The offer this side could not answer (its setRemoteDescription/createAnswer failed), retransmitted: the
      // caller never got our restart_request — a lone broadcast that no resync can recover. Ask again now rather
      // than at the next 5 s retry; the same reading as the answer re-send above.
      sendRestartRequest(d, fx, now)
    }
    return
  }
  d.negId = offer.negId
  d.pendingOffer = offer
  pruneRemote(d)
  if (d.phase !== 'idle' && d.op === 'none') startApplyOffer(d, fx)
  // else: applied as soon as the PC operation in flight lands (or on accept)
}

/** Caller: only the answer to the offer we are waiting on, exactly once. Everything else is stale. */
function onAnswer(d: Draft, fx: Fx, negId: number, sdp: string): void {
  if (d.op !== 'awaitingAnswer' || negId !== d.opNegId) return
  d.op = 'applyingAnswer'
  fx.push({ type: 'setRemoteDescription', negId, sdpType: 'answer', sdp })
}

function onSnapshot(d: Draft, fx: Fx, snap: ResyncSnapshot, now: number): void {
  if (snap.callId !== d.callId) return
  if (snap.callState === 'ended') {
    endRemote(d, fx, snap.endReason ?? 'hangup')
    return
  }
  if (d.peerTabId === null && snap.peerTabId) d.peerTabId = snap.peerTabId
  if (d.role === 'caller') {
    if (d.phase === 'idle' && snap.callState !== 'ringing') onAccepted(d, fx, now) // the accepted event was lost
    if (!d.readySeen && (snap.callState === 'ready' || snap.callState === 'connected')) onReady(d, fx, now)
    if (snap.latestAnswer) onAnswer(d, fx, snap.latestAnswer.negId, snap.latestAnswer.sdp)
  } else if (snap.latestOffer && snap.latestOffer.negId > d.negId) {
    const o = snap.latestOffer
    onOffer(d, fx, {
      negId: o.negId, sdp: o.sdp,
      ...(o.codecPlan !== undefined ? { codecPlan: o.codecPlan } : {}),
      ...(o.capabilities !== undefined ? { capabilities: o.capabilities } : {}),
    }, false, now)
  }
  for (const batch of snap.candidates) acceptRemoteCandidates(d, fx, batch.negId, batch.candidates)
  // The peer's hold state from Postgres — what heals a LOST hold/resume event. Applied only when newer than the last
  // one applied (its seq), so a snapshot that raced a newer event cannot undo it.
  if (snap.peerHold && snap.peerHold.seq > d.peerHoldSeq) {
    d.peerHoldSeq = snap.peerHold.seq
    setPeerHold(d, fx, snap.peerHold.held, now)
  }
}

// ---------------------------------------------------------------------------
// Connectivity, recovery, hold
// ---------------------------------------------------------------------------

/** Caller: abandon whatever is in flight and negotiate a fresh negId with new ICE credentials. */
function startRestart(d: Draft, fx: Fx, _now: number): void {
  if (d.role !== 'caller' || d.negId === 0) return // nothing negotiated yet — the first offer is the "restart"
  if (d.op === 'creatingOffer' || d.op === 'applyingAnswer') {
    d.restartQueued = true // cannot interrupt an SDP operation; run when it lands
    return
  }
  if (d.op === 'awaitingAnswer') fx.push({ type: 'rollback' }) // have-local-offer → stable before re-offering
  createOfferNext(d, fx, true)
}

function sendRestartRequest(d: Draft, fx: Fx, now: number): void {
  if (d.role !== 'callee' || d.negId === 0) return
  emit(d, fx, { kind: 'restart_request', negId: d.negId, payload: {} })
  d.restartRequestedFor = d.negId
  d.restartRequestedAt = now
  armIfIdle(d, fx, 'retransmit', now + RETRANSMIT_MS)
}

const recover = (d: Draft, fx: Fx, now: number) =>
  d.role === 'caller' ? startRestart(d, fx, now) : sendRestartRequest(d, fx, now)

function markRecovered(d: Draft, fx: Fx): void {
  if (!d.everConnected) {
    d.everConnected = true
    disarm(d, fx, 'connectDeadline')
  }
  if (d.phase === 'connected') return
  d.phase = 'connected'
  d.mediaLostAt = null
  d.restartRequestedFor = null
  d.restartRequestedAt = null
  disarm(d, fx, 'lostDeadline')
  disarm(d, fx, 'resync')
  // A caller mid-restart keeps retransmitting that offer until it is answered; nothing else needs resending.
  if (!(d.role === 'caller' && d.op === 'awaitingAnswer')) disarm(d, fx, 'retransmit')
}

function mediaLost(d: Draft, fx: Fx, lostAt: number, now: number, cause: 'stall' | 'disconnected' | 'failed'): void {
  if (!d.everConnected) {
    // Before the first connection only a hard ICE failure means anything (e.g. the relay allocation failed);
    // the connect deadline bounds the rest.
    if (cause === 'failed' && d.phase === 'connecting') recover(d, fx, now)
    return
  }
  const newEpisode = d.phase === 'connected'
  d.phase = 'reconnecting'
  d.mediaLostAt = d.mediaLostAt === null ? lostAt : Math.min(d.mediaLostAt, lostAt)
  armIfIdle(d, fx, 'resync', now + RESYNC_MS)
  if (onHold(d)) return // the hold limit governs; the restart happens on resume
  arm(d, fx, 'lostDeadline', d.mediaLostAt + LOST_DEADLINE_MS)
  if (newEpisode) {
    recover(d, fx, now)
    return
  }
  if (cause === 'stall') return
  // A fresh ICE failure mid-episode: try again only once the previous attempt has settled, never on top of it.
  if (d.role === 'caller') {
    if (d.op === 'none') startRestart(d, fx, now)
  } else if (d.restartRequestedFor === null || d.negId > d.restartRequestedFor) {
    sendRestartRequest(d, fx, now)
  }
}

function onIceState(d: Draft, fx: Fx, state: IceConnectionState, now: number): void {
  if (state === d.iceState) return
  d.iceState = state
  if (iceUp(state)) {
    if (!d.stalled) markRecovered(d, fx)
  } else if (state === 'disconnected' || state === 'failed') {
    mediaLost(d, fx, now, now, state)
  }
}

function onStall(d: Draft, fx: Fx, stalledMs: number, now: number): void {
  if (!d.everConnected || !Number.isFinite(stalledMs) || stalledMs < 0) return
  if (stalledMs >= STALL_RESTART_MS) {
    if (d.stalled) return // one trigger per stall, not one per stats poll
    d.stalled = true
    mediaLost(d, fx, now - stalledMs, now, 'stall')
    return
  }
  if (!d.stalled) return
  d.stalled = false
  if (iceUp(d.iceState)) markRecovered(d, fx)
}

/**
 * The hold limit for whichever hold began first, or none. ⚠️ One clock PER PERSON, not one "someone is on hold"
 * window: with a shared window a stale peer hold (its resume lost) never closes, and the next short hold of this
 * side's own would be hung up by a deadline armed minutes earlier for somebody else's.
 */
function syncHoldDeadline(d: Draft, fx: Fx): void {
  const since = [d.localHoldSince, d.peerHoldSince].filter((t): t is number => t !== null)
  if (since.length === 0) disarm(d, fx, 'holdDeadline')
  else arm(d, fx, 'holdDeadline', Math.min(...since) + HOLD_LIMIT_MS)
}

function enterHold(d: Draft, fx: Fx): void {
  syncHoldDeadline(d, fx)
  disarm(d, fx, 'lostDeadline')
}

function leaveHold(d: Draft, fx: Fx, now: number): void {
  syncHoldDeadline(d, fx)
  if (onHold(d)) return
  if (d.phase === 'reconnecting') {
    // The 40 s 'lost' clock restarts from the resume: hold time never counts against the recovery.
    d.mediaLostAt = now
    arm(d, fx, 'lostDeadline', now + LOST_DEADLINE_MS)
  }
}

function setPeerHold(d: Draft, fx: Fx, held: boolean, now: number): void {
  if (d.peerOnHold === held) return
  d.peerOnHold = held
  d.peerHoldSince = held ? now : null
  if (held) {
    enterHold(d, fx)
    return
  }
  leaveHold(d, fx, now)
  // ⚠️ The peer is back, and media that died while it was away was never recovered (no restarts during a hold).
  // Its own resume restarts — unless a stale "peer on hold" flag on ITS side suppresses that (a resume that lost
  // the race to its hold), or its restart_request is lost. So when the media is down, this side recovers too.
  if (!onHold(d) && d.phase === 'reconnecting') recover(d, fx, now)
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

function onTimer(d: Draft, fx: Fx, timer: TimerName, now: number): void {
  const due = d.timers[timer]
  if (due === null) return // cancelled: a fire that raced its cancel
  if (now < due) {
    // Fired early (clock skew between setTimeout and the engine's clock). Re-arm rather than lose it.
    fx.push({ type: 'schedule', timer, atMs: due })
    return
  }
  d.timers = { ...d.timers, [timer]: null }
  switch (timer) {
    case 'retransmit': onRetransmit(d, fx, now); break
    case 'resync':
      if (needsResync(d)) {
        fx.push({ type: 'fetchState' })
        arm(d, fx, 'resync', now + RESYNC_MS)
      }
      break
    case 'connectDeadline': if (!d.everConnected) endLocal(d, fx, 'lost'); break
    case 'lostDeadline': if (d.phase === 'reconnecting' && !onHold(d)) endLocal(d, fx, 'lost'); break
    case 'holdDeadline': onHoldDeadline(d, fx, now); break
  }
}

/**
 * Two minutes on hold — per person. The side that is ITSELF on hold knows it for certain and ends the call. The other side
 * only knows what the hold/resume events said — ⚠️ two independent POSTs, so a resume can be lost or commit BEFORE
 * its hold (an app switch of a few hundred ms is enough), leaving "peer on hold" stuck while the peer is talking.
 * So this side ends the call only when the media agrees — nothing arriving: the held phone vanished (iOS suspended
 * it, the app was killed). With media flowing it drops the stale flag instead; a peer genuinely still on hold
 * ends the call on its own clock at about the same moment.
 */
function onHoldDeadline(d: Draft, fx: Fx, now: number): void {
  if (d.localHoldSince !== null && now >= d.localHoldSince + HOLD_LIMIT_MS) {
    endLocal(d, fx, 'lost')
    return
  }
  if (d.peerHoldSince !== null && now >= d.peerHoldSince + HOLD_LIMIT_MS) {
    if (d.phase !== 'connected' || d.stalled) {
      endLocal(d, fx, 'lost')
      return
    }
    d.peerOnHold = false
    d.peerHoldSince = null
    leaveHold(d, fx, now)
    return
  }
  syncHoldDeadline(d, fx) // the other person's limit is still to come
}

function onRetransmit(d: Draft, fx: Fx, now: number): void {
  const live = d.phase === 'connecting' || d.phase === 'reconnecting'
  const ownCandidates = d.localCandidates.negId === d.negId && d.localCandidates.list.length > 0
  if (d.role === 'caller') {
    if (d.op === 'awaitingAnswer') {
      resendOffer(d, fx, now)
    } else if (live && ownCandidates && d.op !== 'creatingOffer') {
      sendCandidates(d, fx, d.negId, d.localCandidates.list)
      arm(d, fx, 'retransmit', now + RETRANSMIT_MS)
    }
    return
  }
  if (d.phase === 'connecting' && d.negId === 0) {
    emit(d, fx, { kind: 'ready', payload: {} })
    arm(d, fx, 'retransmit', now + RETRANSMIT_MS)
    return
  }
  let again = false
  if (live && ownCandidates && d.answer?.negId === d.negId) {
    sendCandidates(d, fx, d.negId, d.localCandidates.list)
    again = true
  }
  // ⚠️ `live`, not just 'reconnecting': a callee whose setRemoteDescription/createAnswer failed DURING SETUP has
  // only this request to get a usable offer (it cannot answer the one it has, and ignores its retransmits), so a
  // single lost request would otherwise run the call into the 20 s connect deadline.
  if (live && !onHold(d) && d.restartRequestedFor !== null && d.restartRequestedFor === d.negId) {
    if (now - (d.restartRequestedAt ?? 0) >= RESTART_REQUEST_RETRY_MS) sendRestartRequest(d, fx, now)
    again = true
  }
  if (again) arm(d, fx, 'retransmit', now + RETRANSMIT_MS)
}
