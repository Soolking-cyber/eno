import { describe, expect, it } from 'vitest'
import { CALL_PROTOCOL_VERSION, type CallRole } from './types'
import {
  MAX_SDP_LENGTH, parseEvent, parseSnapshot,
  type CallEvent, type ClientEvent, type IceCandidate, type ResyncSnapshot,
} from './protocol'
import {
  CONNECT_DEADLINE_MS, HOLD_LIMIT_MS, LOST_DEADLINE_MS, MAX_SDP_FAILURES, RESTART_REQUEST_RETRY_MS, RESYNC_MS,
  RETRANSMIT_MS, createNegotiation, step,
  type NegotiationEffect, type NegotiationInput, type NegotiationState, type TimerName,
} from './negotiation'

/**
 * The signalling contract and the negotiation reducer (DESIGN.md v3 §3.2 steps 3–8, §3.3). Part 1 pins each
 * rule on its own; part 2 (bottom of the file) runs two reducers against each other over a lossy, reordering,
 * duplicating fake transport with a fake RTCPeerConnection that REFUSES what a browser would refuse — so a
 * stale answer, a candidate before its SDP or a rollback in 'stable' fails the run instead of passing silently.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type Fx = NegotiationEffect
type FxOf<T extends Fx['type']> = Extract<Fx, { type: T }>

const CALL_ID = '6f1c2b8e-4d3a-4c5b-9e7f-0a1b2c3d4e5f'
const MY_TAB = 'tab-me'
const PEER_TAB = 'tab-peer'
/** nB, as the box relays it in 'accepted' (protocol.ts: lowercase hex, required). */

const only = <T extends Fx['type']>(fx: readonly Fx[], type: T): FxOf<T>[] =>
  fx.filter((e): e is FxOf<T> => e.type === type)
const sent = (fx: readonly Fx[]): ClientEvent[] => only(fx, 'send').map((e) => e.event)
const sentKinds = (fx: readonly Fx[]) => sent(fx).map((e) => e.kind)
const negOf = (e: ClientEvent) => ('negId' in e ? e.negId : undefined)

const sdpFor = (role: CallRole, negId: number) =>
  `v=0\r\no=- 1 ${negId} IN IP4 0.0.0.0\r\na=ice-ufrag:${role[0]}${negId}\r\n`
const cand = (role: CallRole, negId: number, n: number): IceCandidate => ({
  candidate: `candidate:${n} 1 udp 100 198.51.100.7 ${40000 + n} typ relay raddr 0.0.0.0 rport 0 ufrag ${role[0]}${negId}`,
  sdpMid: '0', sdpMLineIndex: 0, usernameFragment: `${role[0]}${negId}`,
})

function mustParse(raw: unknown): CallEvent {
  const r = parseEvent(raw)
  if (!r.ok) throw new Error(`test built an invalid event: ${JSON.stringify(r)}`)
  return r.value
}
let keyCounter = 0
const nextKey = () => `peer:${++keyCounter}`
const env = (key?: string, tabId = PEER_TAB) => ({ v: CALL_PROTOCOL_VERSION, callId: CALL_ID, idempotencyKey: key ?? nextKey(), tabId })
const readyEv = (key?: string) => mustParse({ ...env(key), kind: 'ready', payload: {} })
const offerEv = (negId: number, key?: string, sdp = sdpFor('caller', negId)) =>
  mustParse({ ...env(key), kind: 'offer', negId, payload: { sdp } })
const answerEv = (negId: number, key?: string, sdp = sdpFor('callee', negId)) =>
  mustParse({ ...env(key), kind: 'answer', negId, payload: { sdp } })
const candEv = (negId: number, list: IceCandidate[], key?: string) =>
  mustParse({ ...env(key), kind: 'candidates', negId, payload: { candidates: list } })
const restartReqEv = (negId?: number, key?: string) =>
  mustParse({ ...env(key), kind: 'restart_request', ...(negId ? { negId } : {}), payload: {} })
let holdSeq = 0
/** hold/resume carry the sender's send counter (protocol.ts: applied in send order, not arrival order). */
const holdEv = (kind: 'hold' | 'resume', key?: string) => mustParse({ ...env(key), kind, payload: { seq: ++holdSeq } })
const endEv = (reason: string, key?: string) => mustParse({ ...env(key), kind: 'end', payload: { reason } })
const serverEv = (kind: string, payload: object = {}) => mustParse({ ...env(undefined, 'server'), kind, payload })

const snap = (over: Partial<ResyncSnapshot> = {}): ResyncSnapshot => ({
  v: CALL_PROTOCOL_VERSION, callId: CALL_ID, callState: 'ready', candidates: [], ...over,
})

/** One reducer, driven by hand. `t` is the clock every input carries. */
class Driver {
  state: NegotiationState
  log: Fx[] = []
  t = 0
  constructor(role: CallRole, peerTabId: string | null = PEER_TAB) {
    const r = createNegotiation({ role, callId: CALL_ID, tabId: MY_TAB, instanceId: 'inst0001', peerTabId, now: 0 })
    this.state = r.state
    this.log.push(...r.effects)
  }
  at(t: number): this { this.t = t; return this }
  do(input: DistributiveOmit<NegotiationInput, 'now'>): Fx[] {
    const r = step(this.state, { ...input, now: this.t } as NegotiationInput)
    this.state = r.state
    this.log.push(...r.effects)
    return r.effects
  }
  remote(event: CallEvent): Fx[] { return this.do({ type: 'remote', event }) }
  fire(timer: TimerName): Fx[] { return this.do({ type: 'timer', timer }) }
}

function callerAwaitingAnswer(): Driver {
  const c = new Driver('caller')
  c.remote(readyEv())
  c.do({ type: 'localDescriptionReady', negId: 1, sdp: sdpFor('caller', 1) })
  return c
}
function callerConnected(): Driver {
  const c = callerAwaitingAnswer()
  c.remote(answerEv(1))
  c.do({ type: 'remoteDescriptionApplied', negId: 1 })
  c.do({ type: 'iceConnectionStateChange', state: 'connected' })
  return c
}
function calleeAnswered(negId = 1): Driver {
  const e = new Driver('callee')
  e.do({ type: 'accepted' })
  e.remote(offerEv(negId))
  e.do({ type: 'remoteDescriptionApplied', negId })
  e.do({ type: 'localDescriptionReady', negId, sdp: sdpFor('callee', negId) })
  return e
}
function calleeConnected(): Driver {
  const e = calleeAnswered()
  e.do({ type: 'iceConnectionStateChange', state: 'connected' })
  return e
}

// ===========================================================================
// Part 1a — the wire contract
// ===========================================================================

describe('protocol — strict schemas, version first', () => {
  it('accepts a well-formed event of every kind', () => {
    const all: unknown[] = [
      { ...env(), kind: 'ready', payload: {} },
      { ...env(), kind: 'offer', negId: 1, payload: { sdp: sdpFor('caller', 1), codecPlan: { video: 'H264' }, capabilities: { v: 1 } } },
      { ...env(), kind: 'answer', negId: 1, payload: { sdp: sdpFor('callee', 1) } },
      { ...env(), kind: 'candidates', negId: 3, payload: { candidates: [cand('caller', 3, 1), { candidate: '' }] } },
      { ...env(), kind: 'restart_request', payload: {} },
      { ...env(), kind: 'restart_request', negId: 2, payload: {} },
      { ...env(), kind: 'hold', payload: { seq: 1 } },
      { ...env(), kind: 'resume', payload: { seq: 2 } },
      { ...env(), kind: 'end', payload: { reason: 'hangup' } },
      { ...env(), kind: 'ring', payload: { media: 'video' } },
      { ...env(), kind: 'cancel', payload: {} },
      { ...env(), kind: 'answered_elsewhere', payload: { calleeTabId: PEER_TAB } },
      { ...env(), kind: 'unavailable', payload: {} },
      { ...env(), kind: 'accepted', payload: { calleeTabId: PEER_TAB, capabilities: { v: 1 } } },
      { ...env(), kind: 'ended', payload: { reason: 'kill_switch' } },
    ]
    for (const raw of all) expect(parseEvent(raw)).toEqual({ ok: true, value: raw })
  })

  it('an unknown version is its own error ("reload to call"), checked before the shape', () => {
    const next = CALL_PROTOCOL_VERSION + 1
    expect(parseEvent({ ...env(), v: next, kind: 'ready', payload: {} })).toEqual({ ok: false, error: 'unsupported_version', version: next })
    // An OLDER build's event too (protocol v1's tabs after the v2 deploy): "reload to call", never "malformed".
    expect(parseEvent({ ...env(), v: 1, kind: 'ready', payload: {} })).toEqual({ ok: false, error: 'unsupported_version', version: 1 })
    // Even when the rest is unreadable to this build — a version bump is the licence to change the shape.
    expect(parseEvent({ v: 7, whatever: true })).toEqual({ ok: false, error: 'unsupported_version', version: 7 })
    for (const v of [undefined, '1', 1.5, 0, -1]) {
      const r = parseEvent({ ...env(), v, kind: 'ready', payload: {} })
      expect(r.ok === false && r.error).toBe('invalid')
    }
    expect(parseEvent(null)).toMatchObject({ ok: false, error: 'invalid' })
    expect(parseEvent([1])).toMatchObject({ ok: false, error: 'invalid' })
  })

  it('refuses unknown keys in the envelope and in payloads, and negId where none belongs', () => {
    const bad: unknown[] = [
      { ...env(), kind: 'ready', payload: {}, extra: 1 },
      { ...env(), kind: 'ready', payload: { extra: 1 } },
      { ...env(), kind: 'answer', negId: 1, payload: { sdp: sdpFor('callee', 1), type: 'answer' } },
      { ...env(), kind: 'hold', negId: 1, payload: { seq: 1 } },
      { ...env(), kind: 'nonsense', payload: {} },
      { ...env(), kind: 'candidates', negId: 1, payload: { candidates: [{ ...cand('caller', 1, 1), port: 1 }] } },
    ]
    for (const raw of bad) expect(parseEvent(raw)).toMatchObject({ ok: false, error: 'invalid' })
  })

  it('negId is required (integer ≥ 1) on offer, answer and candidates', () => {
    for (const negId of [undefined, 0, -1, 1.5, '1', 100_001]) {
      expect(parseEvent({ ...env(), kind: 'offer', negId, payload: { sdp: sdpFor('caller', 1) } }).ok).toBe(false)
      expect(parseEvent({ ...env(), kind: 'answer', negId, payload: { sdp: sdpFor('callee', 1) } }).ok).toBe(false)
      expect(parseEvent({ ...env(), kind: 'candidates', negId, payload: { candidates: [cand('callee', 1, 1)] } }).ok).toBe(false)
    }
  })

  it('bounds every string and list: 64 KB SDP, 20 candidates, 64-char key and tab id, a real uuid', () => {
    const head = 'v=0\r\n'
    const sdpAtCap = head + 'a'.repeat(MAX_SDP_LENGTH - head.length)
    expect(parseEvent({ ...env(), kind: 'answer', negId: 1, payload: { sdp: sdpAtCap } }).ok).toBe(true)
    expect(parseEvent({ ...env(), kind: 'answer', negId: 1, payload: { sdp: sdpAtCap + 'a' } }).ok).toBe(false)
    expect(parseEvent({ ...env(), kind: 'answer', negId: 1, payload: { sdp: 'hello' } }).ok).toBe(false)
    const twenty = Array.from({ length: 20 }, (_, i) => cand('caller', 1, i))
    expect(parseEvent({ ...env(), kind: 'candidates', negId: 1, payload: { candidates: twenty } }).ok).toBe(true)
    expect(parseEvent({ ...env(), kind: 'candidates', negId: 1, payload: { candidates: [...twenty, cand('caller', 1, 99)] } }).ok).toBe(false)
    expect(parseEvent({ ...env(), kind: 'candidates', negId: 1, payload: { candidates: [] } }).ok).toBe(false)
    expect(parseEvent({ ...env('k'.repeat(64)), kind: 'ready', payload: {} }).ok).toBe(true)
    expect(parseEvent({ ...env('k'.repeat(65)), kind: 'ready', payload: {} }).ok).toBe(false)
    expect(parseEvent({ ...env(undefined, 't'.repeat(65)), kind: 'ready', payload: {} }).ok).toBe(false)
    expect(parseEvent({ ...env('has space'), kind: 'ready', payload: {} }).ok).toBe(false)
    expect(parseEvent({ ...env(), callId: 'call-1', kind: 'ready', payload: {} }).ok).toBe(false)
  })

  it('a candidate cannot smuggle SDP lines, and must be a candidate line (or the empty end marker)', () => {
    const inject = { candidate: 'candidate:1 1 udp 1 203.0.113.1 3478 typ relay\r\na=fingerprint:sha-256 AA' }
    expect(parseEvent({ ...env(), kind: 'candidates', negId: 1, payload: { candidates: [inject] } }).ok).toBe(false)
    expect(parseEvent({ ...env(), kind: 'candidates', negId: 1, payload: { candidates: [{ candidate: 'a=fingerprint:x' }] } }).ok).toBe(false)
    expect(parseEvent({ ...env(), kind: 'candidates', negId: 1, payload: { candidates: [{ ...cand('caller', 1, 1), sdpMid: '0\r\na=x' }] } }).ok).toBe(false)
  })

  it('end and ended carry a CallEndReason and nothing else', () => {
    // 'sas_mismatch' is a legacy reason (protocol v1's safety code): still a CallEndReason, so an old beacon parses.
    expect(parseEvent({ ...env(), kind: 'end', payload: { reason: 'sas_mismatch' } }).ok).toBe(true)
    expect(parseEvent({ ...env(), kind: 'end', payload: { reason: 'bored' } }).ok).toBe(false)
    expect(parseEvent({ ...env(), kind: 'ended', payload: {} }).ok).toBe(false)
  })

  it('parseSnapshot: strict, JSON-null tolerant, versioned the same way', () => {
    const good = {
      v: CALL_PROTOCOL_VERSION, callId: CALL_ID, callState: 'ready', peerTabId: PEER_TAB,
      latestOffer: { negId: 2, sdp: sdpFor('caller', 2) }, latestAnswer: null, endReason: null,
      candidates: [{ negId: 2, candidates: [cand('caller', 2, 1)] }],
    }
    expect(parseSnapshot(good)).toEqual({ ok: true, value: good })
    expect(parseSnapshot({ ...good, callState: 'dialling' }).ok).toBe(false)
    expect(parseSnapshot({ ...good, secret: 1 }).ok).toBe(false)
    expect(parseSnapshot({ ...good, v: 3 })).toEqual({ ok: false, error: 'unsupported_version', version: 3 })
  })
})

// ===========================================================================
// Part 1b — the reducer, one rule at a time
// ===========================================================================

describe('who offers, and when', () => {
  it('the caller offers on ready — never on accept', () => {
    const c = new Driver('caller')
    expect(only(c.remote(serverEv('accepted', { calleeTabId: PEER_TAB })), 'createOffer')).toEqual([])
    expect(c.state.phase).toBe('waiting_ready')
    expect(only(c.do({ type: 'accepted' }), 'createOffer')).toEqual([])
    expect(only(c.remote(readyEv()), 'createOffer')).toEqual([{ type: 'createOffer', negId: 1, iceRestart: false }])
    expect(c.state.phase).toBe('connecting')
  })

  it('nothing but ready (or a snapshot saying ready) starts the caller', () => {
    const c = new Driver('caller')
    c.remote(candEv(1, [cand('callee', 1, 1)]))
    c.remote(answerEv(1))
    c.remote(restartReqEv(1))
    c.do({ type: 'iceConnectionStateChange', state: 'failed' })
    c.do({ type: 'snapshot', snapshot: snap({ callState: 'accepted' }) })
    expect(only(c.log, 'createOffer')).toEqual([])
    expect(only(c.do({ type: 'snapshot', snapshot: snap({ callState: 'ready' }) }), 'createOffer')).toHaveLength(1)
  })

  it('the callee never offers, whatever it is fed', () => {
    const rng = mulberry32(7)
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]
    for (let i = 0; i < 600; i++) {
      e.at(e.t + Math.floor(rng() * 3000))
      const negId = 1 + Math.floor(rng() * 4)
      const inputs: DistributiveOmit<NegotiationInput, 'now'>[] = [
        { type: 'remote', event: offerEv(negId) },
        { type: 'remote', event: restartReqEv(negId) },
        { type: 'remote', event: readyEv() },
        { type: 'remote', event: candEv(negId, [cand('caller', negId, i)]) },
        { type: 'remoteDescriptionApplied', negId },
        { type: 'localDescriptionReady', negId, sdp: sdpFor('callee', negId) },
        { type: 'operationFailed', negId, op: pick(['createOffer', 'createAnswer', 'setRemoteDescription'] as const) },
        { type: 'iceConnectionStateChange', state: pick(['connected', 'disconnected', 'failed', 'checking'] as const) },
        { type: 'packetsStalled', stalledMs: pick([0, 2500, 9000]) },
        { type: 'localResume' }, { type: 'localHold' },
        { type: 'timer', timer: pick(['retransmit', 'resync'] as const) },
      ]
      e.do(pick(inputs))
      if (e.state.phase === 'ended') break
    }
    expect(only(e.log, 'createOffer')).toEqual([])
    expect(sentKinds(e.log)).not.toContain('offer')
  })

  it('the callee announces ready on accept and repeats it every 2.5 s until an offer shows up', () => {
    const e = new Driver('callee')
    expect(only(e.log, 'schedule')).toEqual([]) // nothing runs before accept
    const fx = e.do({ type: 'accepted' })
    expect(sentKinds(fx)).toEqual(['ready'])
    expect(only(fx, 'fetchState')).toHaveLength(1)
    expect(sentKinds(e.at(RETRANSMIT_MS).fire('retransmit'))).toEqual(['ready'])
    e.remote(offerEv(1))
    expect(sentKinds(e.at(2 * RETRANSMIT_MS).fire('retransmit'))).toEqual([])
  })
})

describe('retransmit until the matching answer', () => {
  it('re-sends the same offer every 2.5 s, each time under a new idempotency key', () => {
    const c = callerAwaitingAnswer()
    const first = sent(c.log).filter((e) => e.kind === 'offer')
    expect(first).toHaveLength(1)
    expect(only(c.log, 'schedule').at(-1)).toEqual({ type: 'schedule', timer: 'retransmit', atMs: RETRANSMIT_MS })
    const again = sent(c.at(RETRANSMIT_MS).fire('retransmit'))
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ kind: 'offer', negId: 1, payload: { sdp: sdpFor('caller', 1) } })
    expect(again[0].idempotencyKey).not.toBe(first[0].idempotencyKey)
    expect(sent(c.at(2 * RETRANSMIT_MS).fire('retransmit'))).toHaveLength(1)
  })

  it('an answer for another negId changes nothing; the matching one stops it', () => {
    const c = new Driver('caller')
    c.remote(readyEv())
    c.do({ type: 'localDescriptionReady', negId: 1, sdp: sdpFor('caller', 1) })
    c.remote(restartReqEv(1)) // → rollback + negId 2
    c.do({ type: 'localDescriptionReady', negId: 2, sdp: sdpFor('caller', 2) })
    expect(only(c.remote(answerEv(1)), 'setRemoteDescription')).toEqual([])
    expect(sentKinds(c.at(RETRANSMIT_MS).fire('retransmit'))).toEqual(['offer'])
    expect(only(c.remote(answerEv(2)), 'setRemoteDescription')).toEqual([
      { type: 'setRemoteDescription', negId: 2, sdpType: 'answer', sdp: sdpFor('callee', 2) },
    ])
    expect(sentKinds(c.at(2 * RETRANSMIT_MS).fire('retransmit'))).not.toContain('offer')
  })

  it('the callee re-sends its answer for a RETRANSMITTED offer — not for a duplicate broadcast or a snapshot', () => {
    const e = calleeAnswered()
    const answer = sent(e.log).find((x) => x.kind === 'answer')!
    const retransmit = sent(e.remote(offerEv(1)))
    expect(retransmit).toHaveLength(1)
    expect(retransmit[0]).toMatchObject({ kind: 'answer', negId: 1, payload: { sdp: sdpFor('callee', 1) } })
    expect(retransmit[0].idempotencyKey).not.toBe(answer.idempotencyKey)
    const dup = offerEv(1, 'same-key')
    e.remote(dup)
    expect(e.remote(dup)).toEqual([]) // the same broadcast delivered twice is not a retransmit
    expect(sent(e.do({ type: 'snapshot', snapshot: snap({ latestOffer: { negId: 1, sdp: sdpFor('caller', 1) } }) }))).toEqual([])
  })

  it('a second ready (the callee re-subscribed) makes the caller re-send its offer at once', () => {
    const c = callerAwaitingAnswer()
    expect(sent(c.at(900).remote(readyEv()))).toMatchObject([{ kind: 'offer', negId: 1 }])
  })
})

describe('candidates wait for their generation', () => {
  it('callee: candidates that beat the offer are queued, then flushed in arrival order once it applies', () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    const [a, b, c] = [cand('caller', 1, 1), cand('caller', 1, 2), cand('caller', 1, 3)]
    expect(only(e.remote(candEv(1, [a, b])), 'addCandidates')).toEqual([])
    expect(only(e.remote(candEv(1, [c])), 'addCandidates')).toEqual([])
    expect(only(e.remote(offerEv(1)), 'addCandidates')).toEqual([]) // offer not applied yet
    const fx = e.do({ type: 'remoteDescriptionApplied', negId: 1 })
    expect(fx.map((x) => x.type)).toEqual(['addCandidates', 'createAnswer'])
    expect(only(fx, 'addCandidates')[0]).toEqual({ type: 'addCandidates', negId: 1, candidates: [a, b, c] })
    expect(only(e.remote(candEv(1, [cand('caller', 1, 4)])), 'addCandidates')).toHaveLength(1) // now immediate
  })

  it('caller: callee candidates before the answer applies are queued, flushed after it', () => {
    const c = callerAwaitingAnswer()
    const x = cand('callee', 1, 1)
    expect(only(c.remote(candEv(1, [x])), 'addCandidates')).toEqual([])
    c.remote(answerEv(1))
    expect(only(c.remote(candEv(1, [cand('callee', 1, 2)])), 'addCandidates')).toEqual([]) // still applying
    expect(only(c.do({ type: 'remoteDescriptionApplied', negId: 1 }), 'addCandidates')).toEqual([
      { type: 'addCandidates', negId: 1, candidates: [x, cand('callee', 1, 2)] },
    ])
  })

  it('older generations are dropped, and a candidate is added once however often it arrives', () => {
    const c = callerConnected()
    c.remote(restartReqEv(1)) // → negId 2
    c.do({ type: 'localDescriptionReady', negId: 2, sdp: sdpFor('caller', 2) })
    expect(c.remote(candEv(1, [cand('callee', 1, 9)]))).toEqual([])
    c.remote(answerEv(2))
    c.do({ type: 'remoteDescriptionApplied', negId: 2 })
    const y = cand('callee', 2, 1)
    expect(only(c.remote(candEv(2, [y])), 'addCandidates')).toHaveLength(1)
    expect(only(c.remote(candEv(2, [y])), 'addCandidates')).toEqual([])
    expect(only(c.do({ type: 'snapshot', snapshot: snap({ candidates: [{ negId: 2, candidates: [y] }] }) }), 'addCandidates')).toEqual([])
  })

  it('local candidates go out in batches of ≤20 for the current negId; a stale generation is dropped', () => {
    const c = callerAwaitingAnswer()
    const many = Array.from({ length: 25 }, (_, i) => cand('caller', 1, i))
    const out = sent(c.do({ type: 'candidatesGathered', negId: 1, candidates: many }))
    expect(out.map((e) => (e.kind === 'candidates' ? e.payload.candidates.length : -1))).toEqual([20, 5])
    expect(out.every((e) => negOf(e) === 1)).toBe(true)
    expect(c.do({ type: 'candidatesGathered', negId: 7, candidates: [cand('caller', 7, 1)] })).toEqual([])
  })
})

describe('stale and duplicate events are dropped', () => {
  it('caller: an answer for an older or already-applied negId never reaches the PC', () => {
    const c = callerConnected()
    expect(c.remote(answerEv(1))).toEqual([])
    c.remote(restartReqEv(1))
    c.do({ type: 'localDescriptionReady', negId: 2, sdp: sdpFor('caller', 2) })
    expect(only(c.remote(answerEv(1)), 'setRemoteDescription')).toEqual([])
  })

  it('callee: an offer older than the newest it has seen is ignored', () => {
    const e = calleeAnswered(3)
    expect(e.remote(offerEv(2))).toEqual([])
    expect(only(e.remote(offerEv(4)), 'setRemoteDescription')).toMatchObject([{ negId: 4, sdpType: 'offer' }])
  })

  it('the same idempotency key is processed once — one restart per restart_request', () => {
    const c = callerConnected()
    const req = restartReqEv(1, 'rr-1')
    expect(only(c.remote(req), 'createOffer')).toHaveLength(1)
    expect(c.remote(req)).toEqual([])
    const hold = holdEv('hold', 'h-1')
    c.remote(hold)
    expect(c.remote(hold)).toEqual([])
  })

  it('own echoes, other tabs of the peer, and other calls are ignored', () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    const echo = mustParse({ ...env(undefined, MY_TAB), kind: 'offer', negId: 1, payload: { sdp: sdpFor('caller', 1) } })
    const stranger = mustParse({ ...env(undefined, 'tab-other'), kind: 'offer', negId: 1, payload: { sdp: sdpFor('caller', 1) } })
    const otherCall = mustParse({ ...env(), callId: '0e2a9a3c-1b2c-4d5e-8f90-123456789abc', kind: 'offer', negId: 1, payload: { sdp: sdpFor('caller', 1) } })
    expect(e.remote(echo)).toEqual([])
    expect(e.remote(stranger)).toEqual([])
    expect(e.remote(otherCall)).toEqual([])
    expect(only(e.remote(offerEv(1)), 'setRemoteDescription')).toHaveLength(1)
  })
})

describe('recovery: restart fast, one generation at a time', () => {
  it("'disconnected' → the caller restarts at once with a new negId (no rollback from stable)", () => {
    const c = callerConnected()
    const fx = c.at(10_000).do({ type: 'iceConnectionStateChange', state: 'disconnected' })
    expect(fx.filter((x) => x.type === 'rollback' || x.type === 'createOffer')).toEqual([{ type: 'createOffer', negId: 2, iceRestart: true }])
    expect(c.state.phase).toBe('reconnecting')
  })

  it('a trigger in have-local-offer rolls back FIRST, then offers a fresh negId', () => {
    const c = callerConnected()
    c.remote(restartReqEv(1)) // media still fine: negId 2 offered while connected
    c.do({ type: 'localDescriptionReady', negId: 2, sdp: sdpFor('caller', 2) })
    const fx = c.at(5_000).do({ type: 'packetsStalled', stalledMs: 2_000 })
    expect(fx.filter((x) => x.type === 'rollback' || x.type === 'createOffer')).toEqual([
      { type: 'rollback' }, { type: 'createOffer', negId: 3, iceRestart: true },
    ])
  })

  it('a 2 s inbound stall restarts once — not once per stats poll', () => {
    const c = callerConnected()
    expect(only(c.at(1_000).do({ type: 'packetsStalled', stalledMs: 1_999 }), 'createOffer')).toEqual([])
    expect(only(c.at(1_001).do({ type: 'packetsStalled', stalledMs: 2_000 }), 'createOffer')).toHaveLength(1)
    expect(only(c.at(2_001).do({ type: 'packetsStalled', stalledMs: 3_000 }), 'createOffer')).toEqual([])
  })

  it('the callee asks with restart_request (never offers), repeats every 5 s, and stops at a newer offer', () => {
    const e = calleeConnected()
    const fx = e.at(10_000).do({ type: 'iceConnectionStateChange', state: 'disconnected' })
    expect(sent(fx)).toMatchObject([{ kind: 'restart_request', negId: 1 }])
    expect(only(fx, 'createOffer')).toEqual([])
    expect(sentKinds(e.at(10_000 + RETRANSMIT_MS).fire('retransmit'))).not.toContain('restart_request') // < 5 s
    expect(sentKinds(e.at(10_000 + 2 * RETRANSMIT_MS).fire('retransmit'))).toContain('restart_request')
    e.remote(offerEv(2))
    expect(sentKinds(e.at(10_000 + 4 * RETRANSMIT_MS).fire('retransmit'))).not.toContain('restart_request')
  })

  it('restart_request ALWAYS yields a fresh negId — stable, awaiting an answer, mid-createOffer, mid-apply', () => {
    const stable = callerConnected()
    expect(only(stable.remote(restartReqEv(1)), 'createOffer')).toEqual([{ type: 'createOffer', negId: 2, iceRestart: true }])

    const awaiting = callerAwaitingAnswer()
    expect(awaiting.remote(restartReqEv()).filter((x) => x.type === 'rollback' || x.type === 'createOffer'))
      .toEqual([{ type: 'rollback' }, { type: 'createOffer', negId: 2, iceRestart: true }])

    const creating = new Driver('caller')
    creating.remote(readyEv()) // createOffer(1) in flight
    expect(creating.remote(restartReqEv())).toEqual([]) // cannot interrupt the PC: queued
    const landed = creating.do({ type: 'localDescriptionReady', negId: 1, sdp: sdpFor('caller', 1) })
    expect(landed.filter((x) => x.type === 'rollback' || x.type === 'createOffer'))
      .toEqual([{ type: 'rollback' }, { type: 'createOffer', negId: 2, iceRestart: true }])
    expect(sentKinds(landed)).not.toContain('offer') // the obsolete offer is never sent

    const applying = callerAwaitingAnswer()
    applying.remote(answerEv(1))
    expect(only(applying.remote(restartReqEv()), 'createOffer')).toEqual([])
    expect(only(applying.do({ type: 'remoteDescriptionApplied', negId: 1 }), 'createOffer')).toEqual([{ type: 'createOffer', negId: 2, iceRestart: true }])
  })

  it('restart racing an in-flight answer: the late answer is dropped, the new one applies', () => {
    const c = callerConnected()
    c.do({ type: 'iceConnectionStateChange', state: 'disconnected' }) // → offer 2
    c.do({ type: 'localDescriptionReady', negId: 2, sdp: sdpFor('caller', 2) })
    c.remote(restartReqEv(1)) // the callee's request lands while answer 2 is in flight → rollback, offer 3
    c.do({ type: 'localDescriptionReady', negId: 3, sdp: sdpFor('caller', 3) })
    expect(c.remote(answerEv(2))).toEqual([])
    expect(only(c.remote(answerEv(3)), 'setRemoteDescription')).toMatchObject([{ negId: 3 }])
  })

  it('stale answer after a restart — by event or from a lagging snapshot — is dropped', () => {
    const c = callerConnected()
    c.do({ type: 'iceConnectionStateChange', state: 'failed' })
    c.do({ type: 'localDescriptionReady', negId: 2, sdp: sdpFor('caller', 2) })
    expect(c.remote(answerEv(1))).toEqual([])
    expect(only(c.do({ type: 'snapshot', snapshot: snap({ latestAnswer: { negId: 1, sdp: sdpFor('callee', 1) } }) }), 'setRemoteDescription')).toEqual([])
    expect(c.state.op).toBe('awaitingAnswer')
  })

  it("a failed SDP operation restarts; the 4th failure ends the call as media_failed", () => {
    const c = callerAwaitingAnswer()
    c.remote(answerEv(1))
    const fx = c.do({ type: 'operationFailed', negId: 1, op: 'setRemoteDescription' })
    expect(fx.filter((x) => x.type === 'rollback' || x.type === 'createOffer')).toEqual([
      { type: 'rollback' }, { type: 'createOffer', negId: 2, iceRestart: true },
    ])
    for (let n = 2; n <= MAX_SDP_FAILURES + 1; n++) c.do({ type: 'operationFailed', negId: n, op: 'createOffer' })
    expect(c.state.ended).toEqual({ reason: 'media_failed', origin: 'local' })
  })
})

describe('deadlines', () => {
  it('no connection 20 s after ready → lost (an early fire re-arms, it is never dropped)', () => {
    const c = new Driver('caller')
    c.at(3_000).remote(readyEv())
    const due = 3_000 + CONNECT_DEADLINE_MS
    expect(only(c.log, 'schedule')).toContainEqual({ type: 'schedule', timer: 'connectDeadline', atMs: due })
    expect(c.at(due - 1).fire('connectDeadline')).toEqual([{ type: 'schedule', timer: 'connectDeadline', atMs: due }])
    const fx = c.at(due).fire('connectDeadline')
    expect(sent(fx)).toMatchObject([{ kind: 'end', payload: { reason: 'lost' } }])
    expect(only(fx, 'endCall')).toEqual([{ type: 'endCall', reason: 'lost', origin: 'local' }])
  })

  it('the callee counts 20 s from its own ready; connecting cancels the deadline', () => {
    const e = new Driver('callee')
    e.at(1_000).do({ type: 'accepted' })
    expect(e.state.timers.connectDeadline).toBe(1_000 + CONNECT_DEADLINE_MS)
    const ok = calleeConnected()
    expect(ok.state.timers.connectDeadline).toBeNull()
    expect(ok.at(CONNECT_DEADLINE_MS + 1).fire('connectDeadline')).toEqual([])
  })

  it('no media for 40 s once connected → lost, counted from when the packets stopped', () => {
    const c = callerConnected()
    c.at(50_000).do({ type: 'packetsStalled', stalledMs: 2_000 })
    expect(c.state.timers.lostDeadline).toBe(48_000 + LOST_DEADLINE_MS)
    c.at(80_000).do({ type: 'iceConnectionStateChange', state: 'disconnected' })
    expect(c.state.timers.lostDeadline).toBe(48_000 + LOST_DEADLINE_MS) // same episode, same clock
    expect(only(c.at(48_000 + LOST_DEADLINE_MS).fire('lostDeadline'), 'endCall')).toEqual([{ type: 'endCall', reason: 'lost', origin: 'local' }])
  })

  it('recovering before the deadline cancels it', () => {
    const e = calleeConnected()
    e.at(10_000).do({ type: 'packetsStalled', stalledMs: 2_500 })
    e.at(12_000).do({ type: 'packetsStalled', stalledMs: 0 })
    expect(e.state.phase).toBe('connected')
    expect(e.state.timers.lostDeadline).toBeNull()
    expect(e.at(60_000).fire('lostDeadline')).toEqual([])
  })
})

describe('resync — Postgres is the truth, Realtime the hint', () => {
  it('an offer broadcast while the callee was reconnecting arrives through the snapshot; a stale one does nothing', () => {
    const e = calleeConnected()
    e.do({ type: 'iceConnectionStateChange', state: 'disconnected' })
    const fx = e.do({ type: 'snapshot', snapshot: snap({ latestOffer: { negId: 2, sdp: sdpFor('caller', 2) } }) })
    expect(only(fx, 'setRemoteDescription')).toEqual([{ type: 'setRemoteDescription', negId: 2, sdpType: 'offer', sdp: sdpFor('caller', 2) }])
    expect(e.do({ type: 'snapshot', snapshot: snap({ latestOffer: { negId: 1, sdp: sdpFor('caller', 1) } }) })).toEqual([])
  })

  it('the caller learns ready, and the answer, from snapshots', () => {
    const c = new Driver('caller')
    c.remote(serverEv('accepted', { calleeTabId: PEER_TAB }))
    expect(only(c.do({ type: 'snapshot', snapshot: snap({ callState: 'ready' }) }), 'createOffer')).toHaveLength(1)
    c.do({ type: 'localDescriptionReady', negId: 1, sdp: sdpFor('caller', 1) })
    const fx = c.do({
      type: 'snapshot',
      snapshot: snap({ latestAnswer: { negId: 1, sdp: sdpFor('callee', 1) }, candidates: [{ negId: 1, candidates: [cand('callee', 1, 1)] }] }),
    })
    expect(fx.map((x) => x.type)).toContain('setRemoteDescription')
    expect(only(c.do({ type: 'remoteDescriptionApplied', negId: 1 }), 'addCandidates')).toHaveLength(1)
  })

  it('polls every 2 s while connecting, stops once connected, resumes while reconnecting', () => {
    const c = new Driver('caller')
    expect(c.log).toEqual([{ type: 'schedule', timer: 'resync', atMs: RESYNC_MS }])
    expect(only(c.at(RESYNC_MS).fire('resync'), 'fetchState')).toHaveLength(1)
    const live = callerConnected()
    expect(live.state.timers.resync).toBeNull()
    live.at(9_000).do({ type: 'iceConnectionStateChange', state: 'disconnected' })
    expect(live.state.timers.resync).toBe(9_000 + RESYNC_MS)
  })

  it("a snapshot saying 'ended' ends the call", () => {
    const e = calleeConnected()
    expect(only(e.do({ type: 'snapshot', snapshot: snap({ callState: 'ended', endReason: 'blocked' }) }), 'endCall'))
      .toEqual([{ type: 'endCall', reason: 'blocked', origin: 'remote' }])
  })
})

describe('hold / resume', () => {
  it('pass through both ways; a local resume forces an ICE restart', () => {
    const c = callerConnected()
    expect(sentKinds(c.do({ type: 'localHold' }))).toEqual(['hold'])
    expect(c.do({ type: 'localHold' })).toEqual([])
    const fx = c.do({ type: 'localResume' })
    expect(sentKinds(fx)).toEqual(['resume'])
    expect(only(fx, 'createOffer')).toEqual([{ type: 'createOffer', negId: 2, iceRestart: true }])
    const e = calleeConnected()
    e.do({ type: 'localHold' })
    expect(sentKinds(e.do({ type: 'localResume' }))).toEqual(['resume', 'restart_request'])
  })

  it('while the peer is on hold a stall neither restarts nor starts the 40 s clock; 2 min on hold ends it', () => {
    const c = callerConnected()
    c.at(1_000).remote(holdEv('hold'))
    expect(c.state.peerOnHold).toBe(true)
    const fx = c.at(5_000).do({ type: 'packetsStalled', stalledMs: 3_000 })
    expect(only(fx, 'createOffer')).toEqual([])
    expect(c.state.timers.lostDeadline).toBeNull()
    expect(c.state.timers.holdDeadline).toBe(1_000 + HOLD_LIMIT_MS)
    expect(only(c.at(1_000 + HOLD_LIMIT_MS).fire('holdDeadline'), 'endCall')).toEqual([{ type: 'endCall', reason: 'lost', origin: 'local' }])
  })

  it('a remote resume restarts the 40 s clock from the resume, not from the stall', () => {
    const c = callerConnected()
    c.at(1_000).remote(holdEv('hold'))
    c.at(5_000).do({ type: 'packetsStalled', stalledMs: 3_000 })
    c.at(70_000).remote(holdEv('resume'))
    expect(c.state.peerOnHold).toBe(false)
    expect(c.state.timers.holdDeadline).toBeNull()
    expect(c.state.timers.lostDeadline).toBe(70_000 + LOST_DEADLINE_MS)
  })
})

describe('end is terminal and idempotent', () => {
  it('a remote end tears down once, cancels every timer, and silences all later input', () => {
    const c = callerAwaitingAnswer()
    const fx = c.remote(endEv('hangup'))
    expect(only(fx, 'endCall')).toEqual([{ type: 'endCall', reason: 'hangup', origin: 'remote' }])
    expect(only(fx, 'cancel').map((x) => x.timer).sort()).toEqual(['connectDeadline', 'resync', 'retransmit'])
    expect(sentKinds(fx)).toEqual([]) // the peer ended it: nothing to tell anyone
    expect(c.remote(endEv('hangup'))).toEqual([])
    expect(c.remote(serverEv('ended', { reason: 'hangup' }))).toEqual([])
    expect(c.remote(answerEv(1))).toEqual([])
    expect(c.fire('retransmit')).toEqual([])
    expect(c.do({ type: 'localEnd', reason: 'hangup' })).toEqual([])
  })

  it('a local end sends end once and tears down', () => {
    const e = calleeConnected()
    const fx = e.do({ type: 'localEnd', reason: 'hangup' })
    expect(sent(fx)).toMatchObject([{ kind: 'end', payload: { reason: 'hangup' } }])
    expect(only(fx, 'endCall')).toEqual([{ type: 'endCall', reason: 'hangup', origin: 'local' }])
    expect(e.do({ type: 'localEnd', reason: 'hangup' })).toEqual([])
  })

  it('cancel and unavailable end the call; answered_elsewhere closes only a tab that did not accept', () => {
    expect(only(new Driver('callee').remote(serverEv('cancel')), 'endCall')).toMatchObject([{ reason: 'cancelled', origin: 'remote' }])
    expect(only(new Driver('caller').remote(serverEv('unavailable')), 'endCall')).toMatchObject([{ reason: 'unavailable' }])
    expect(only(new Driver('callee').remote(serverEv('answered_elsewhere', { calleeTabId: 'tab-other' })), 'endCall')).toMatchObject([{ reason: 'answered_elsewhere', origin: 'remote' }])
    expect(calleeConnected().remote(serverEv('answered_elsewhere', { calleeTabId: 'tab-other' }))).toEqual([])
  })
})

describe('idempotency keys and outgoing events', () => {
  it('every key is unique, ≤64 chars, carries the instance id, and every sent event passes parseEvent', () => {
    const c = callerConnected()
    for (let i = 1; i < 40; i++) c.at(i * 1_000).remote(restartReqEv())
    const events = sent(c.log)
    const keys = events.map((e) => e.idempotencyKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((k) => k.length <= 64 && k.startsWith('inst0001:'))).toBe(true)
    for (const e of events) expect(parseEvent(e).ok).toBe(true)
  })

  it('refuses an unusable instance id up front', () => {
    expect(() => createNegotiation({ role: 'caller', callId: CALL_ID, tabId: MY_TAB, instanceId: 'x'.repeat(41), now: 0 })).toThrow()
    expect(() => createNegotiation({ role: 'caller', callId: CALL_ID, tabId: 'has space', instanceId: 'okokokok', now: 0 })).toThrow()
    // A non-UUID call id would match no event at all — the call would just never start. Loud, at once.
    expect(() => createNegotiation({ role: 'callee', callId: 'call-42', tabId: MY_TAB, instanceId: 'okokokok', now: 0 })).toThrow(/UUID/)
  })

  it('step never mutates the state it was given', () => {
    const c = callerAwaitingAnswer()
    const frozen = JSON.stringify(c.state)
    const before = c.state
    step(before, { type: 'remote', now: 1, event: answerEv(1) })
    step(before, { type: 'iceConnectionStateChange', now: 1, state: 'failed' })
    expect(JSON.stringify(before)).toBe(frozen)
  })
})

// ===========================================================================
// Part 2 — simulation
// ===========================================================================

/** Deterministic PRNG so a failing seed replays exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ROLES: readonly CallRole[] = ['caller', 'callee']
const TAB: Record<CallRole, string> = { caller: 'tab-caller', callee: 'tab-callee' }
/** Distinct side letters inside the fake SDP/candidates, so applying one's OWN description is caught. */
const LETTER: Record<CallRole, 'A' | 'B'> = { caller: 'A', callee: 'B' }
const ufragOf = (re: RegExp, text: string) => {
  const m = re.exec(text)
  return m ? { side: m[1], gen: Number(m[2]) } : null
}
const sdpGen = (sdp: string) => ufragOf(/a=ice-ufrag:([AB])(\d+)/, sdp)
const candGen = (c: string) => ufragOf(/ufrag ([AB])(\d+)$/, c)
const sdpCands = (sdp: string) => sdp.split('\r\n').filter((l) => l.startsWith('a=candidate:')).map((l) => l.slice(2))
/** A hand-built event as if it came from the simulated callee's (bound) call tab. */
const asCallee = (e: CallEvent) => mustParse({ ...e, tabId: TAB.callee })

interface SimHookMsg { to: CallRole; from: CallRole | 'server'; event: CallEvent; copy: number }
interface SimOptions {
  seed: number
  /** Probability that one broadcast delivery is lost (the box still has the row: resync can recover it). */
  dropRate: number
  dupRate: number
  /** Broadcast latency is uniform in [10, maxDelay] ms per delivery — independent, so events reorder. */
  maxDelay: number
  /** A POST retried after a lost response: the box receives the same key twice. */
  postDupRate: number
  /** false = every GET fails, so retransmits alone must carry the call. */
  resync: boolean
  /** Half-trickle: the first gathered candidate rides inside the SDP. */
  sdpCandidates: boolean
  /** Drop every copy of the FIRST event of these kinds on its way to the peer. */
  dropFirst?: CallEvent['kind'][]
  hook?: (msg: SimHookMsg, sim: Sim) => 'drop' | number | void
  onEffects?: (role: CallRole, fx: readonly Fx[], sim: Sim) => void
  /** Observe every input just before a reducer sees it, with the state it will see it in. */
  onInput?: (role: CallRole, input: DistributiveOmit<NegotiationInput, 'now'>, before: NegotiationState) => void
}

/**
 * The RTCPeerConnection, reduced to what the races are about: the JSEP signalling states, one ICE generation per
 * negId (read from the SDP/candidate ufrag — never from the reducer's word for it), and the operations a browser
 * REFUSES. Every refusal is recorded as a violation; a healthy run has none.
 */
class FakePc {
  signaling: 'stable' | 'have-local-offer' | 'have-remote-offer' = 'stable'
  localGen = 0
  remoteGen = 0
  pendingGen = 0
  busyUntil = 0
  localOfferRollbacks = 0
  readonly remoteCands = new Map<number, Set<string>>()
  readonly violations: string[] = []
  constructor(readonly role: CallRole) {}
  get remoteDescriptionGen(): number { return this.signaling === 'have-remote-offer' ? this.pendingGen : this.remoteGen }
  addRemote(gen: number, c: string): void {
    const set = this.remoteCands.get(gen) ?? new Set<string>()
    set.add(c)
    this.remoteCands.set(gen, set)
  }
}

interface SimSide {
  role: CallRole
  state: NegotiationState
  pc: FakePc
  timers: Map<TimerName, number>
  ended: { reason: string; origin: string; at: number } | null
  firstConnectedAt: number | null
  sentLog: { at: number; event: ClientEvent }[]
  firstCreateOfferAt: number | null
  readyFromSnapshot: boolean
  received: Map<string, number>
}

class Sim {
  t = 0
  readonly rng: () => number
  readonly sides: Record<CallRole, SimSide>
  readonly violations: string[] = []
  readonly downUntil: Record<CallRole, number> = { caller: 0, callee: 0 }
  readonly server = {
    seen: new Set<string>(),
    state: 'ringing' as ResyncSnapshot['callState'],
    endReason: null as ResyncSnapshot['endReason'],
    latestOffer: null as ResyncSnapshot['latestOffer'],
    latestAnswer: null as ResyncSnapshot['latestAnswer'],
    cands: { caller: new Map<number, IceCandidate[]>(), callee: new Map<number, IceCandidate[]>() },
  }
  iceGen = 0
  mediaOk = false
  mediaLostAt = 0
  calleeReadyAt: number | null = null
  earlyCandidates = 0
  readonly marks: Record<string, number> = {}
  readonly trace: string[] = []
  private readonly deadGens = new Set<number>()
  private readonly droppedFirst = new Map<string, string>()
  private queue: { at: number; seq: number; run: () => void }[] = []
  private seq = 0
  private tokens = 0
  private connecting = 0
  private polling = false
  private serverKeys = 0

  constructor(readonly opts: SimOptions) {
    this.rng = mulberry32(opts.seed)
    const initial: Partial<Record<CallRole, Fx[]>> = {}
    const make = (role: CallRole): SimSide => {
      const r = createNegotiation({
        role, callId: CALL_ID, tabId: TAB[role], instanceId: `i${role}${opts.seed}`,
        // The callee learns the caller's tab from its accept response; the caller must learn the callee's.
        peerTabId: role === 'callee' ? TAB.caller : null, now: 0,
      })
      initial[role] = r.effects
      return {
        role, state: r.state, pc: new FakePc(role), timers: new Map(), ended: null, firstConnectedAt: null,
        sentLog: [], firstCreateOfferAt: null, readyFromSnapshot: false, received: new Map(),
      }
    }
    this.sides = { caller: make('caller'), callee: make('callee') }
    for (const role of ROLES) for (const e of initial[role] ?? []) this.perform(role, e)
  }

  // --- event loop --------------------------------------------------------
  at(time: number, run: () => void): void {
    const item = { at: Math.max(time, this.t), seq: this.seq++, run }
    let lo = 0
    let hi = this.queue.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const m = this.queue[mid]
      if (m.at < item.at || (m.at === item.at && m.seq < item.seq)) lo = mid + 1
      else hi = mid
    }
    this.queue.splice(lo, 0, item)
  }
  rand(lo: number, hi: number): number { return lo + Math.floor(this.rng() * (hi - lo + 1)) }
  up(role: CallRole): boolean { return this.t >= this.downUntil[role] }
  processed = 0
  runUntil(until: number, done?: () => boolean): boolean {
    while (this.queue.length > 0 && this.queue[0].at <= until) {
      const item = this.queue.shift()!
      this.t = item.at
      this.processed++
      item.run()
      if (done?.()) return true
    }
    return done?.() ?? false
  }
  bothConnected = (): boolean => ROLES.every((r) => this.sides[r].state.phase === 'connected')
  note(line: string): void {
    this.trace.push(`${this.t}ms ${line}`)
    if (this.trace.length > 160) this.trace.shift()
  }

  start(): void {
    const acceptAt = this.rand(300, 3_000)
    this.at(acceptAt, () => {
      this.server.state = 'accepted'
      this.broadcastServer('accepted', { calleeTabId: TAB.callee })
      this.at(this.t + this.rand(50, 600), () => this.dispatch('callee', { type: 'accepted' }))
    })
  }

  // --- reducers -----------------------------------------------------------
  dispatch(role: CallRole, input: DistributiveOmit<NegotiationInput, 'now'>): void {
    const s = this.sides[role]
    const before = s.state
    this.opts.onInput?.(role, input, before)
    const r = step(before, { ...input, now: this.t } as NegotiationInput)
    s.state = r.state
    if (input.type === 'remote') {
      s.received.set(input.event.kind, (s.received.get(input.event.kind) ?? 0) + 1)
      const ev = input.event
      if (role === 'callee' && ev.kind === 'candidates' && before.remoteNegId < ev.negId) this.earlyCandidates++
    }
    if (input.type === 'snapshot' && !before.readySeen && r.state.readySeen) s.readyFromSnapshot = true
    if (input.type !== 'packetsStalled' || r.effects.length > 0) {
      const what = input.type === 'remote' ? `remote:${input.event.kind}${'negId' in input.event ? input.event.negId ?? '' : ''}` : input.type
      this.note(`${role} ← ${what} → ${r.effects.map((e) => (e.type === 'send' ? `send:${e.event.kind}${negOf(e.event) ?? ''}` : e.type === 'createOffer' || e.type === 'setRemoteDescription' || e.type === 'createAnswer' || e.type === 'addCandidates' ? `${e.type}:${e.negId}` : e.type)).join(',')} [${r.state.phase}/${r.state.op}]`)
    }
    for (const e of r.effects) this.perform(role, e)
    if (s.firstConnectedAt === null && s.state.phase === 'connected') s.firstConnectedAt = this.t
    this.opts.onEffects?.(role, r.effects, this)
  }

  perform(role: CallRole, e: Fx): void {
    const s = this.sides[role]
    switch (e.type) {
      case 'send': {
        s.sentLog.push({ at: this.t, event: e.event })
        if (e.event.kind === 'ready' && role === 'callee' && this.calleeReadyAt === null) this.calleeReadyAt = this.t
        this.post(role, e.event)
        return
      }
      case 'schedule': {
        const token = ++this.tokens
        s.timers.set(e.timer, token)
        this.at(e.atMs, () => {
          if (s.timers.get(e.timer) !== token) return
          s.timers.delete(e.timer)
          this.dispatch(role, { type: 'timer', timer: e.timer })
        })
        return
      }
      case 'cancel': s.timers.delete(e.timer); return
      case 'fetchState': this.fetch(role); return
      case 'endCall':
        if (s.ended) this.violations.push(`${role}: endCall twice`)
        s.ended = { reason: e.reason, origin: e.origin, at: this.t }
        return
      default: {
        if (e.type === 'createOffer' && s.firstCreateOfferAt === null) s.firstCreateOfferAt = this.t
        // The PC's operations chain: one at a time, in emission order.
        const startAt = Math.max(this.t, s.pc.busyUntil) + this.rand(2, 25)
        s.pc.busyUntil = startAt
        this.at(startAt, () => this.execPc(role, e))
      }
    }
  }

  // --- the fake RTCPeerConnection ------------------------------------------
  execPc(role: CallRole, e: Fx): void {
    const s = this.sides[role]
    const pc = s.pc
    if (s.ended) return // the engine closed the PC
    const expectSide = LETTER[role === 'caller' ? 'callee' : 'caller']
    switch (e.type) {
      case 'createOffer':
        if (role !== 'caller') { pc.violations.push('the callee created an offer'); return }
        if (pc.signaling !== 'stable') { pc.violations.push(`createOffer(${e.negId}) in ${pc.signaling}`); return }
        pc.signaling = 'have-local-offer'
        pc.pendingGen = e.negId
        this.gather(role, e.negId)
        return
      case 'createAnswer':
        if (pc.signaling !== 'have-remote-offer' || pc.pendingGen !== e.negId) {
          pc.violations.push(`createAnswer(${e.negId}) in ${pc.signaling}/${pc.pendingGen}`)
          return
        }
        pc.signaling = 'stable'
        pc.remoteGen = e.negId
        pc.localGen = e.negId
        this.gather(role, e.negId)
        this.checkConnect()
        return
      case 'setRemoteDescription': {
        const g = sdpGen(e.sdp)
        if (!g || g.side !== expectSide || g.gen !== e.negId) {
          pc.violations.push(`setRemoteDescription(${e.negId}) given ${JSON.stringify(g)}`)
          return
        }
        if (e.sdpType === 'offer') {
          if (pc.signaling !== 'stable') { pc.violations.push(`offer ${g.gen} applied in ${pc.signaling}`); return }
          pc.signaling = 'have-remote-offer'
          pc.pendingGen = g.gen
        } else {
          // The stale-answer bug, exactly: WebRTC itself would accept an answer of the wrong generation here.
          if (pc.signaling !== 'have-local-offer') { pc.violations.push(`answer ${g.gen} applied in ${pc.signaling}`); return }
          if (pc.pendingGen !== g.gen) { pc.violations.push(`answer ${g.gen} applied to local offer ${pc.pendingGen}`); return }
          pc.signaling = 'stable'
          pc.localGen = g.gen
          pc.remoteGen = g.gen
        }
        for (const c of sdpCands(e.sdp)) pc.addRemote(g.gen, c)
        this.dispatch(role, { type: 'remoteDescriptionApplied', negId: e.negId })
        this.checkConnect()
        return
      }
      case 'addCandidates': {
        const g = pc.remoteDescriptionGen
        if (g === 0 || g !== e.negId) {
          pc.violations.push(`addIceCandidate for ${e.negId} while the remote description is generation ${g}`)
          return
        }
        for (const c of e.candidates) {
          const cg = candGen(c.candidate)
          if (!cg || cg.side !== expectSide || cg.gen !== g) pc.violations.push(`candidate ${c.candidate} added to generation ${g}`)
          else pc.addRemote(g, c.candidate)
        }
        this.checkConnect()
        return
      }
      case 'rollback':
        if (pc.signaling === 'stable') { pc.violations.push('rollback in stable'); return }
        if (pc.signaling === 'have-local-offer') pc.localOfferRollbacks++
        pc.signaling = 'stable'
        pc.pendingGen = 0
        return
    }
  }

  gather(role: CallRole, negId: number): void {
    const L = LETTER[role]
    const all: IceCandidate[] = Array.from({ length: this.rand(1, 3) }, (_, i) => ({
      candidate: `candidate:${i + 1} 1 udp ${100 - i} 203.0.113.${role === 'caller' ? 10 : 20} ${40_000 + negId * 10 + i} typ relay raddr 0.0.0.0 rport 0 ufrag ${L}${negId}`,
      sdpMid: '0', sdpMLineIndex: 0, usernameFragment: `${L}${negId}`,
    }))
    const inSdp = this.opts.sdpCandidates ? all.slice(0, 1) : []
    const sdp = `v=0\r\no=- 1 ${negId} IN IP4 0.0.0.0\r\na=ice-ufrag:${L}${negId}\r\n${inSdp.map((c) => `a=${c.candidate}\r\n`).join('')}`
    const readyAt = this.t + this.rand(0, 300) // ≤300 ms after the first relay candidate (half-trickle)
    this.at(readyAt, () => this.dispatch(role, { type: 'localDescriptionReady', negId, sdp }))
    for (const c of all.slice(inSdp.length)) {
      this.at(readyAt + this.rand(1, 400), () => this.dispatch(role, { type: 'candidatesGathered', negId, candidates: [c] }))
    }
  }

  connectable(g: number): boolean {
    const a = this.sides.caller.pc
    const b = this.sides.callee.pc
    return g > 0 && a.localGen === g && a.remoteGen === g && b.localGen === g && b.remoteGen === g &&
      (a.remoteCands.get(g)?.size ?? 0) > 0 && (b.remoteCands.get(g)?.size ?? 0) > 0 &&
      !this.deadGens.has(g) && this.up('caller') && this.up('callee') && !this.sides.caller.ended && !this.sides.callee.ended
  }

  checkConnect(): void {
    const g = this.sides.caller.pc.localGen
    if (!this.connectable(g) || this.iceGen === g || this.connecting === g) return
    this.connecting = g
    this.at(this.t + this.rand(30, 250), () => {
      this.connecting = 0
      if (!this.connectable(g)) { this.checkConnect(); return }
      this.iceGen = g
      this.mediaOk = true
      this.note(`ICE connected on generation ${g}`)
      for (const role of ROLES) this.at(this.t + this.rand(0, 50), () => this.dispatch(role, { type: 'iceConnectionStateChange', state: 'connected' }))
      if (!this.polling) {
        this.polling = true
        for (const role of ROLES) this.at(this.t + this.rand(100, 1_000), () => this.poll(role))
      }
    })
  }

  /** The engine's 1 Hz getStats poll: ms since inbound packets last grew. */
  poll(role: CallRole): void {
    if (this.sides[role].ended) return
    this.dispatch(role, { type: 'packetsStalled', stalledMs: this.mediaOk ? 0 : this.t - this.mediaLostAt })
    this.at(this.t + 1_000, () => this.poll(role))
  }

  /** The media path dies (Wi-Fi → 4G, a tunnel); optionally one phone drops off the network for a while. */
  killPath(at: number, down?: { role: CallRole; ms: number }): void {
    this.at(at, () => {
      if (!this.mediaOk) return
      this.note(`PATH DIES (generation ${this.iceGen})${down ? `; ${down.role} offline ${down.ms} ms` : ''}`)
      this.deadGens.add(this.iceGen)
      this.mediaOk = false
      this.mediaLostAt = this.t
      this.iceGen = 0
      if (down) {
        this.downUntil[down.role] = this.t + down.ms
        this.at(this.t + down.ms, () => this.checkConnect())
      }
      for (const role of ROLES) {
        this.at(this.t + this.rand(5_000, 7_500), () => {
          if (!this.mediaOk) this.dispatch(role, { type: 'iceConnectionStateChange', state: 'disconnected' })
        })
      }
    })
  }

  // --- the box: POST → Postgres row → Realtime broadcast; GET → snapshot ---
  post(from: CallRole, event: CallEvent): void {
    const parsed = parseEvent(event)
    if (!parsed.ok) this.violations.push(`${from} sent an invalid event: ${JSON.stringify(parsed)}`)
    if (from === 'callee' && event.kind === 'offer') this.violations.push('the callee sent an offer')
    const arrive = Math.max(this.t, this.downUntil[from]) + this.rand(20, 250) // the engine retries until it lands
    this.at(arrive, () => this.serverReceive(from, event))
    if (this.rng() < this.opts.postDupRate) this.at(arrive + this.rand(50, 600), () => this.serverReceive(from, event))
  }

  /** Inject an event as if `from`'s engine had sent it (fresh key, through the box). */
  inject(from: CallRole, body: Record<string, unknown>): CallEvent {
    const event = mustParse({ v: CALL_PROTOCOL_VERSION, callId: CALL_ID, idempotencyKey: `inject:${++this.serverKeys}`, tabId: TAB[from], ...body })
    this.post(from, event)
    return event
  }

  serverReceive(from: CallRole, event: CallEvent): void {
    const srv = this.server
    if (srv.seen.has(event.idempotencyKey)) return // idempotency: a retried POST is stored and relayed once
    srv.seen.add(event.idempotencyKey)
    if (srv.state === 'ended') return
    switch (event.kind) {
      case 'ready': if (from === 'callee' && srv.state === 'accepted') srv.state = 'ready'; break
      case 'offer':
        if (from === 'caller' && event.negId >= (srv.latestOffer?.negId ?? 0)) srv.latestOffer = { negId: event.negId, sdp: event.payload.sdp }
        break
      case 'answer':
        if (from === 'callee' && event.negId >= (srv.latestAnswer?.negId ?? 0)) srv.latestAnswer = { negId: event.negId, sdp: event.payload.sdp }
        break
      case 'candidates': {
        const row = srv.cands[from]
        const have = row.get(event.negId) ?? []
        const fresh = event.payload.candidates.filter((c) => !have.some((h) => h.candidate === c.candidate))
        row.set(event.negId, [...have, ...fresh])
        break
      }
      case 'end':
        srv.state = 'ended'
        srv.endReason = event.payload.reason
        this.broadcast(from, event)
        this.broadcastServer('ended', { reason: event.payload.reason })
        return
    }
    this.broadcast(from, event)
  }

  broadcastServer(kind: string, payload: object): void {
    this.broadcast('server', mustParse({ v: CALL_PROTOCOL_VERSION, callId: CALL_ID, idempotencyKey: `srv:${++this.serverKeys}`, tabId: 'server', kind, payload }))
  }

  /** call:<conversationId> reaches BOTH call tabs — the sender's own echo included. */
  broadcast(from: CallRole | 'server', event: CallEvent): void {
    for (const to of ROLES) {
      const copies = this.rng() < this.opts.dupRate ? 2 : 1
      for (let copy = 0; copy < copies; copy++) {
        const h = this.opts.hook?.({ to, from, event, copy }, this)
        if (h === 'drop') continue
        if (to !== from && this.opts.dropFirst?.includes(event.kind)) {
          const first = this.droppedFirst.get(event.kind)
          if (first === undefined) this.droppedFirst.set(event.kind, event.idempotencyKey)
          if ((first ?? event.idempotencyKey) === event.idempotencyKey) continue
        }
        if (this.rng() < this.opts.dropRate || !this.up(to)) continue
        const at = this.t + this.rand(10, this.opts.maxDelay) + (typeof h === 'number' ? h : 0)
        this.at(at, () => { if (this.up(to)) this.dispatch(to, { type: 'remote', event }) })
      }
    }
  }

  fetch(role: CallRole): void {
    if (!this.opts.resync || !this.up(role)) return
    this.at(this.t + this.rand(20, 200), () => {
      if (!this.up(role)) return
      const snapshot = this.snapshotFor(role)
      const parsed = parseSnapshot(snapshot)
      if (!parsed.ok) this.violations.push(`the box built an invalid snapshot: ${JSON.stringify(parsed)}`)
      // The response travels back while newer broadcasts may overtake it: snapshots can land stale.
      this.at(this.t + this.rand(20, 200), () => { if (this.up(role)) this.dispatch(role, { type: 'snapshot', snapshot }) })
    })
  }

  snapshotFor(role: CallRole): ResyncSnapshot {
    const srv = this.server
    const peer = role === 'caller' ? 'callee' : 'caller'
    return {
      v: CALL_PROTOCOL_VERSION, callId: CALL_ID, callState: srv.state, endReason: srv.endReason,
      peerTabId: srv.state === 'ringing' ? null : TAB[peer],
      latestOffer: srv.latestOffer, latestAnswer: srv.latestAnswer,
      candidates: [...srv.cands[peer].entries()].slice(-16).map(([negId, list]) => ({ negId, candidates: list.slice(-64) })),
    }
  }
}

function pcViolations(sim: Sim): string[] {
  return [...sim.violations, ...ROLES.flatMap((r) => sim.sides[r].pc.violations.map((v) => `${r} PC: ${v}`))]
}

/** Why a run that should have connected did not — or null. */
function convergenceProblem(sim: Sim): string | null {
  const v = pcViolations(sim)
  if (v.length > 0) return `violations: ${v.join(' | ')}`
  for (const r of ROLES) {
    const s = sim.sides[r]
    if (s.ended) return `${r} ended (${s.ended.reason}) at ${s.ended.at} ms`
    if (s.firstConnectedAt === null) return `${r} never connected (phase ${s.state.phase}, op ${s.state.op})`
  }
  const readyAt = sim.calleeReadyAt
  if (readyAt === null) return 'the callee never sent ready'
  const firstOffer = sim.sides.caller.firstCreateOfferAt
  if (firstOffer === null || firstOffer < readyAt) return `the caller offered at ${firstOffer} ms, before ready at ${readyAt} ms`
  const lastConnect = Math.max(sim.sides.caller.firstConnectedAt!, sim.sides.callee.firstConnectedAt!)
  if (lastConnect > readyAt + CONNECT_DEADLINE_MS) return `connected only ${lastConnect - readyAt} ms after ready`
  return null
}

const explain = (sim: Sim, problem: string) => `${problem}\n  …${sim.trace.slice(-40).join('\n  ')}`

function connectedSim(opts: Partial<SimOptions> & { seed: number }): Sim {
  const sim = new Sim({
    dropRate: 0, dupRate: 0, maxDelay: 80, postDupRate: 0, resync: true, sdpCandidates: true, ...opts,
  })
  sim.start()
  if (!sim.runUntil(30_000, sim.bothConnected)) throw new Error(explain(sim, 'setup never connected'))
  return sim
}

describe('simulation — two reducers, a lossy box, a strict fake RTCPeerConnection', () => {
  it('converges to connected within the connect deadline for 240 seeds of drops, duplicates and reordering', () => {
    const failures: string[] = []
    let early = 0
    let events = 0
    let offerResends = 0
    let answerResends = 0
    let snapshotOffers = 0
    for (let seed = 1; seed <= 240; seed++) {
      const r = mulberry32(seed * 7_919)
      const resync = seed % 4 !== 0 // every 4th seed: every GET fails and retransmits alone carry the call
      const sim = new Sim({
        seed,
        dropRate: resync ? 0.1 + r() * 0.3 : 0.05 + r() * 0.2,
        dupRate: r() * 0.25,
        maxDelay: 50 + Math.floor(r() * 750),
        postDupRate: r() * 0.2,
        resync,
        sdpCandidates: r() < 0.5,
        dropFirst: ['offer', 'answer'],
        onInput: (role, input, before) => {
          if (role === 'callee' && input.type === 'snapshot' && (input.snapshot.latestOffer?.negId ?? 0) > before.negId) snapshotOffers++
        },
      })
      sim.start()
      sim.runUntil(45_000)
      early += sim.earlyCandidates
      events += sim.processed
      const kindsSent = (r: CallRole, kind: string) => sim.sides[r].sentLog.filter((x) => x.event.kind === kind).length
      offerResends += kindsSent('caller', 'offer') - sim.sides.caller.state.negId
      answerResends += kindsSent('callee', 'answer') - sim.sides.callee.state.negId
      const problem = convergenceProblem(sim)
      if (problem) failures.push(`seed ${seed}: ${explain(sim, problem)}`)
      else if (!sim.bothConnected()) failures.push(`seed ${seed}: did not STAY connected (${sim.sides.caller.state.phase}/${sim.sides.callee.state.phase})`)
    }
    expect(failures).toEqual([])
    // The runs did the work the claim is about — not 240 lucky first tries:
    expect(events).toBeGreaterThan(240 * 100)
    expect(offerResends).toBeGreaterThan(0) // offers retransmitted…
    expect(answerResends).toBeGreaterThan(0) // …answers re-sent for retransmitted offers…
    expect(snapshotOffers).toBeGreaterThan(0) // …offers recovered from Postgres by resync…
    expect(early).toBeGreaterThan(0) // …and candidates that beat their offer were queued, not lost
  })

  it('recovers from a dead path — with a phone offline for up to 8 s — for 200 seeds, inside the 40 s budget', () => {
    const failures: string[] = []
    let rollbacks = 0
    let restartRequests = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = mulberry32(seed * 104_729)
      const sim = new Sim({
        seed: seed + 10_000,
        dropRate: r() * 0.3,
        dupRate: r() * 0.2,
        maxDelay: 50 + Math.floor(r() * 500),
        postDupRate: r() * 0.2,
        resync: seed % 5 !== 0,
        sdpCandidates: r() < 0.5,
      })
      sim.start()
      if (!sim.runUntil(45_000, sim.bothConnected)) { failures.push(`seed ${seed}: ${explain(sim, 'never connected')}`); continue }
      const g0 = sim.iceGen
      const killAt = sim.t + 500 + Math.floor(r() * 3_000)
      const offline = r() < 0.6 ? { role: (r() < 0.5 ? 'caller' : 'callee') as CallRole, ms: Math.floor(r() * 8_000) } : undefined
      sim.killPath(killAt, offline)
      sim.runUntil(killAt + 1)
      const recovered = sim.runUntil(killAt + LOST_DEADLINE_MS - 1, () => sim.iceGen > g0 && sim.bothConnected())
      const v = pcViolations(sim)
      if (v.length > 0) failures.push(`seed ${seed}: ${explain(sim, `violations: ${v.join(' | ')}`)}`)
      else if (!recovered) failures.push(`seed ${seed}: ${explain(sim, `no recovery (gen ${sim.iceGen} vs ${g0})`)}`)
      else if (ROLES.some((x) => sim.sides[x].ended)) failures.push(`seed ${seed}: ended during recovery`)
      else if (sim.sides.caller.state.negId > g0 + 12) failures.push(`seed ${seed}: restart churn (negId ${sim.sides.caller.state.negId} from ${g0})`)
      rollbacks += sim.sides.caller.pc.localOfferRollbacks
      restartRequests += sim.sides.callee.sentLog.filter((x) => x.event.kind === 'restart_request').length
    }
    expect(failures).toEqual([])
    expect(restartRequests).toBeGreaterThan(0)
    expect(rollbacks).toBeGreaterThan(0) // restart_requests landing mid-offer happened on their own, and were survived
  })

  it('restart racing an in-flight answer: the late answer is dropped, the newer negotiation wins', () => {
    const sim = connectedSim({ seed: 41 })
    const g0 = sim.iceGen
    let lateAnswerAtNeg = 0
    // Every answer to the first restart offer is stuck 3 s in a slow QUIC stream…
    sim.opts.hook = ({ to, event }) => (to === 'caller' && event.kind === 'answer' && event.negId === g0 + 1 ? 3_000 : undefined)
    // …and the callee's restart_request lands 100 ms after that offer went out, while its answer is in flight.
    sim.opts.onEffects = (role, fx, s) => {
      if (role === 'caller' && !s.marks.raced && sent(fx).some((e) => e.kind === 'offer' && e.negId === g0 + 1)) {
        s.marks.raced = 1
        s.at(s.t + 100, () => s.dispatch('caller', { type: 'remote', event: asCallee(restartReqEv(g0)) }))
      }
    }
    sim.opts.onInput = (role, input, before) => {
      if (role === 'caller' && input.type === 'remote' && input.event.kind === 'answer' && input.event.negId === g0 + 1) {
        lateAnswerAtNeg = before.negId
      }
    }
    // The first restart, while media still flows (a request left over from an earlier blip).
    sim.dispatch('caller', { type: 'remote', event: asCallee(restartReqEv(g0)) })
    sim.runUntil(sim.t + 15_000)
    expect(pcViolations(sim)).toEqual([])
    expect(sim.marks.raced).toBe(1)
    expect(lateAnswerAtNeg).toBeGreaterThan(g0 + 1) // it did arrive — after the caller had moved on…
    expect(sim.sides.caller.pc.localOfferRollbacks).toBeGreaterThanOrEqual(1) // …because offer g0+1 was rolled back
    expect(sim.iceGen).toBeGreaterThanOrEqual(g0 + 2)
    expect(sim.bothConnected()).toBe(true)
  })

  it('stale answer after a restart: an old answer re-sent mid-restart never reaches the PC', () => {
    const sim = connectedSim({ seed: 42 })
    const g0 = sim.iceGen
    let staleAtNeg = 0
    sim.opts.onEffects = (role, fx, s) => {
      if (role === 'caller' && !s.marks.stale && only(fx, 'createOffer').some((e) => e.negId === g0 + 1)) {
        s.marks.stale = 1
        s.inject('callee', { kind: 'answer', negId: g0, payload: { sdp: `v=0\r\no=- 1 ${g0} IN IP4 0.0.0.0\r\na=ice-ufrag:B${g0}\r\n` } })
      }
    }
    sim.opts.onInput = (role, input, before) => {
      const e = input.type === 'remote' ? input.event : null
      if (role === 'caller' && e?.kind === 'answer' && e.negId === g0 && e.idempotencyKey.startsWith('inject:')) staleAtNeg = before.negId
    }
    sim.killPath(sim.t + 10) // both sides stall 2 s later; the caller restarts
    const recovered = sim.runUntil(sim.t + LOST_DEADLINE_MS, () => sim.iceGen > g0 && sim.bothConnected())
    expect(pcViolations(sim)).toEqual([])
    expect(sim.marks.stale).toBe(1)
    expect(staleAtNeg).toBeGreaterThan(g0) // delivered while a newer negotiation was in progress
    expect(recovered).toBe(true)
  })

  it('ready lost then resync: with every ready broadcast dropped, the snapshot still starts the caller', () => {
    const sim = new Sim({
      seed: 43, dropRate: 0.1, dupRate: 0.1, maxDelay: 300, postDupRate: 0.1, resync: true, sdpCandidates: false,
      hook: ({ to, event }) => (to === 'caller' && event.kind === 'ready' ? 'drop' : undefined),
    })
    sim.start()
    sim.runUntil(45_000)
    expect(convergenceProblem(sim)).toBeNull()
    expect(sim.sides.caller.received.get('ready') ?? 0).toBe(0)
    expect(sim.sides.caller.readyFromSnapshot).toBe(true)
  })

  it('restart_request while the caller is mid-createOffer: that offer is never sent, a fresh negId is', () => {
    const sim = connectedSim({ seed: 44 })
    const g0 = sim.iceGen
    sim.opts.onEffects = (role, fx, s) => {
      if (role === 'caller' && only(fx, 'createOffer').some((e) => e.negId === g0 + 1) && !s.marks.mid) {
        s.marks.mid = 1
        // Lands 1 ms later — before the PC can possibly have finished createOffer (≥2 ms in this model).
        s.at(s.t + 1, () => s.dispatch('caller', { type: 'remote', event: asCallee(restartReqEv(g0)) }))
      }
    }
    sim.dispatch('caller', { type: 'remote', event: asCallee(restartReqEv(g0)) })
    sim.runUntil(sim.t + 15_000)
    const offers = sim.sides.caller.sentLog.map((x) => x.event).filter((e) => e.kind === 'offer').map((e) => negOf(e))
    expect(sim.marks.mid).toBe(1)
    expect(offers).not.toContain(g0 + 1)
    expect(offers.some((n) => (n ?? 0) >= g0 + 2)).toBe(true)
    expect(sim.sides.caller.pc.localOfferRollbacks).toBeGreaterThanOrEqual(1)
    expect(pcViolations(sim)).toEqual([])
    expect(sim.iceGen).toBeGreaterThanOrEqual(g0 + 2)
    expect(sim.bothConnected()).toBe(true)
  })

  it('candidates that beat their offer are queued by the callee, never added early, and the call connects', () => {
    const sim = new Sim({
      seed: 45, dropRate: 0, dupRate: 0, maxDelay: 40, postDupRate: 0, resync: false, sdpCandidates: false,
      hook: ({ to, event }) => (to === 'callee' && event.kind === 'offer' && event.negId === 1 ? 1_500 : undefined),
    })
    sim.start()
    sim.runUntil(30_000)
    expect(sim.earlyCandidates).toBeGreaterThan(0)
    expect(convergenceProblem(sim)).toBeNull()
  })

  it('a path that never comes back ends the call as lost exactly 40 s after the media stopped, on both sides', () => {
    const sim = connectedSim({ seed: 46 })
    const killAt = sim.t + 1_000
    sim.killPath(killAt, { role: 'callee', ms: 10 * 60_000 })
    sim.runUntil(killAt + 3 * LOST_DEADLINE_MS)
    expect(pcViolations(sim)).toEqual([])
    for (const r of ROLES) {
      expect(sim.sides[r].ended).toMatchObject({ reason: 'lost', origin: 'local', at: killAt + LOST_DEADLINE_MS })
    }
  })
})
