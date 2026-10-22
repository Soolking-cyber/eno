import { describe, expect, it } from 'vitest'
import { CALL_PROTOCOL_VERSION, type CallRole } from './types'
import { parseEvent, parseSnapshot, type CallEvent, type ClientEvent, type IceCandidate, type ResyncSnapshot } from './protocol'
import {
  CONNECT_DEADLINE_MS, HOLD_LIMIT_MS, MAX_SDP_FAILURES, RESTART_REQUEST_RETRY_MS, RETRANSMIT_MS, TIMER_NAMES,
  createNegotiation, step,
  type NegotiationEffect, type NegotiationInput, type NegotiationState, type TimerName,
} from './negotiation'

/**
 * ADVERSARIAL REVIEW of the signalling contract + negotiation reducer (DESIGN.md v3 §3.2 steps 3–8, §3.3).
 *
 * negotiation.test.ts pins the rules the module's author had in mind. This file pins the ones a hostile reading
 * of the design found missing — each `D<n>` block names the defect it caught (numbered in order of discovery; the
 * four hold defects sit together), and every D-test failed against the module as first written. The 'coverage'
 * block pins branches the author's own unit tests never reached. The common thread: the author's simulation
 * never let the box do what DESIGN says the box does (answered_elsewhere to every callee tab, hold/resume as two
 * independent POSTs), never failed an SDP operation, and never let a candidate fall off a queue cap — so the
 * reducer's behaviour in exactly those places was untested and, it turned out, wrong.
 *
 * ⚠️ The simulation at the bottom is a SECOND, independent harness (not a copy of the author's): a fault-injecting
 * box and a strict fake RTCPeerConnection that also FAILS operations, so the operationFailed paths — rollback,
 * restart_request, the failure cap — run against two live reducers instead of a hand-fed one.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type Fx = NegotiationEffect
type FxOf<T extends Fx['type']> = Extract<Fx, { type: T }>
type In = DistributiveOmit<NegotiationInput, 'now'>

const CALL_ID = '6f1c2b8e-4d3a-4c5b-9e7f-0a1b2c3d4e5f'
const MY_TAB = 'tab-me'
const PEER_TAB = 'tab-peer'
/** nB, as the box relays it in 'accepted' (protocol.ts: lowercase hex, required). */

const only = <T extends Fx['type']>(fx: readonly Fx[], type: T): FxOf<T>[] =>
  fx.filter((e): e is FxOf<T> => e.type === type)
const sent = (fx: readonly Fx[]): ClientEvent[] => only(fx, 'send').map((e) => e.event)
const sentKinds = (fx: readonly Fx[]) => sent(fx).map((e) => e.kind)

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
const nextKey = () => `peer-${++keyCounter}`
const env = (key?: string, tabId = PEER_TAB) => ({ v: CALL_PROTOCOL_VERSION, callId: CALL_ID, idempotencyKey: key ?? nextKey(), tabId })
const readyEv = (key?: string) => mustParse({ ...env(key), kind: 'ready', payload: {} })
const offerEv = (negId: number, key?: string) => mustParse({ ...env(key), kind: 'offer', negId, payload: { sdp: sdpFor('caller', negId) } })
const answerEv = (negId: number, key?: string) => mustParse({ ...env(key), kind: 'answer', negId, payload: { sdp: sdpFor('callee', negId) } })
const candEv = (negId: number, list: IceCandidate[], key?: string) =>
  mustParse({ ...env(key), kind: 'candidates', negId, payload: { candidates: list } })
const restartReqEv = (negId?: number, key?: string) =>
  mustParse({ ...env(key), kind: 'restart_request', ...(negId ? { negId } : {}), payload: {} })
let holdSeq = 0
/** A hold/resume as the peer's engine numbers it (its send counter); pass `seq` to stage an out-of-order arrival. */
const holdEv = (kind: 'hold' | 'resume', seq = ++holdSeq + 1_000, key?: string) => mustParse({ ...env(key), kind, payload: { seq } })
const serverEv = (kind: string, payload: object = {}, key?: string) => mustParse({ ...env(key, 'server'), kind, payload })
const parseSnapshotOk = (raw: object) => parseSnapshot(JSON.parse(JSON.stringify(raw))).ok
const snap = (over: Partial<ResyncSnapshot> = {}): ResyncSnapshot => ({
  v: CALL_PROTOCOL_VERSION, callId: CALL_ID, callState: 'ready', candidates: [], ...over,
})

/** One reducer driven by hand, plus the engine's setTimeout loop and stats poll for advancing time. */
class Driver {
  state: NegotiationState
  log: Fx[] = []
  t = 0
  constructor(role: CallRole, peerTabId: string | null = PEER_TAB, tabId = MY_TAB) {
    const r = createNegotiation({ role, callId: CALL_ID, tabId, instanceId: 'review-1', peerTabId, now: 0 })
    this.state = r.state
    this.log.push(...r.effects)
  }
  at(t: number): this { this.t = t; return this }
  do(input: In): Fx[] {
    const r = step(this.state, { ...input, now: this.t } as NegotiationInput)
    this.state = r.state
    this.log.push(...r.effects)
    return r.effects
  }
  remote(event: CallEvent): Fx[] { return this.do({ type: 'remote', event }) }
  fire(timer: TimerName): Fx[] { return this.do({ type: 'timer', timer }) }
  /**
   * Advance to `until`, firing every armed timer when it is due and (optionally) dispatching a stats poll every
   * `pollEvery` ms with `stalledAt(t)`; a fetchState is answered with `snapshot()` when given.
   */
  advance(until: number, opts: { pollEvery?: number; stalledAt?: (t: number) => number; snapshot?: () => ResyncSnapshot } = {}): Fx[] {
    const out: Fx[] = []
    let nextPoll = opts.pollEvery ? this.t + opts.pollEvery : Infinity
    while (this.state.phase !== 'ended') {
      let due: TimerName | null = null
      let dueAt = Infinity
      for (const name of TIMER_NAMES) {
        const at = this.state.timers[name]
        if (at !== null && at <= until && at < dueAt) { due = name; dueAt = at }
      }
      const pollAt = nextPoll <= until ? nextPoll : Infinity
      if (dueAt === Infinity && pollAt === Infinity) break
      if (dueAt <= pollAt && due) {
        this.t = Math.max(this.t, dueAt)
        const fx = this.fire(due)
        out.push(...fx)
        if (opts.snapshot && fx.some((e) => e.type === 'fetchState')) out.push(...this.do({ type: 'snapshot', snapshot: opts.snapshot() }))
      } else {
        this.t = pollAt
        out.push(...this.do({ type: 'packetsStalled', stalledMs: opts.stalledAt ? opts.stalledAt(pollAt) : 0 }))
        nextPoll += opts.pollEvery!
      }
    }
    this.t = Math.max(this.t, until)
    return out
  }
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
// D1 (blocker) — answered_elsewhere killed the tab that was accepting
// ===========================================================================

describe('D1: the answered_elsewhere broadcast must not close the tab whose accept caused it', () => {
  // DESIGN §3.2 step 3: ONE conditional UPDATE ringing→accepted, and "other devices get answered_elsewhere" —
  // on ring:<callee>, which EVERY tab of the callee is subscribed to (that is how they all rang), the accepting
  // tab included. That tab's reducer is still 'idle' until its accept POST has returned AND its call channel has
  // SUBSCRIBED (the 'accepted' input) — seconds on a cold-started phone — so the broadcast lands in that window.
  it('the accepting tab, still idle, survives the broadcast and proceeds when its accept completes', () => {
    const e = new Driver('callee', 'tab-caller')
    e.at(100).remote(serverEv('answered_elsewhere', { calleeTabId: MY_TAB }))
    expect(e.state.phase).toBe('idle')
    expect(e.state.ended).toBeNull()
    const fx = e.at(900).do({ type: 'accepted' })
    expect(sentKinds(fx)).toEqual(['ready'])
  })

  it('every OTHER ringing tab of the callee is closed', () => {
    const other = new Driver('callee', 'tab-caller')
    expect(only(other.remote(serverEv('answered_elsewhere', { calleeTabId: 'tab-winner' })), 'endCall'))
      .toEqual([{ type: 'endCall', reason: 'answered_elsewhere', origin: 'remote' }])
  })

  it('the wire contract names the winning tab (a bare answered_elsewhere is ambiguous and refused)', () => {
    expect(parseEvent({ ...env(undefined, 'server'), kind: 'answered_elsewhere', payload: {} }).ok).toBe(false)
    expect(parseEvent({ ...env(undefined, 'server'), kind: 'answered_elsewhere', payload: { calleeTabId: 'has space' } }).ok).toBe(false)
  })
})

// ===========================================================================
// D2 — a stale peer-hold flag ended a healthy call at the 2-minute hold limit
// ===========================================================================

describe('D2: hold/resume are two independent POSTs — a lost or overtaken resume must not end a live call', () => {
  const flowing = () => 0

  it('a LOST resume leaves media flowing — the call is NOT ended at 2 min, the stale flag is dropped', () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('hold')) // its resume never arrives: the peer looks held, but is talking
    c.advance(10_000 + HOLD_LIMIT_MS + 30_000, { pollEvery: 1_000, stalledAt: flowing })
    expect(c.state.peerOnHold).toBe(false)
    expect(c.state.ended).toBeNull()
    expect(c.state.phase).toBe('connected')
  })

  it('once the stale hold has been seen through, a real media loss recovers normally again (restart + 40 s clock)', () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('hold')) // resume lost on the wire
    c.advance(10_000 + HOLD_LIMIT_MS + 1_000, { pollEvery: 1_000, stalledAt: flowing })
    expect(c.state.ended).toBeNull()
    const stall = c.at(c.t + 2_000).do({ type: 'packetsStalled', stalledMs: 2_000 })
    expect(only(stall, 'createOffer')).toHaveLength(1)
    expect(c.state.timers.lostDeadline).not.toBeNull()
  })

  it('a peer that VANISHED while on hold (no media) still ends the call at the hold limit', () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('hold'))
    const stoppedAt = 11_000 // iOS suspended the held phone: nothing arrives any more
    c.advance(10_000 + HOLD_LIMIT_MS, { pollEvery: 1_000, stalledAt: (t) => Math.max(0, t - stoppedAt) })
    expect(c.state.ended).toEqual({ reason: 'lost', origin: 'local' })
  })

  it('the side that is ITSELF on hold ends the call after 2 min whether or not media flows (it is authoritative)', () => {
    const e = calleeConnected()
    e.at(5_000).do({ type: 'localHold' })
    const fx = e.advance(5_000 + HOLD_LIMIT_MS, { pollEvery: 1_000, stalledAt: flowing })
    expect(sent(fx).filter((x) => x.kind === 'end')).toMatchObject([{ payload: { reason: 'lost' } }])
    expect(e.state.ended).toEqual({ reason: 'lost', origin: 'local' })
  })
})

// ===========================================================================
// D10 — hold/resume were applied in ARRIVAL order
// ===========================================================================

describe('D10: hold/resume are applied in the order they were SENT, not the order they arrive', () => {
  // Found by the fault simulation at 10× seeds (seed 217): each side made an app switch (hold + resume a few
  // hundred ms apart, two independent POSTs), each resume committed before its hold, so EACH side believed the
  // other was on hold — the UI says "X is on another call" while X talks, and when the path died neither side
  // restarted (a peer hold suspends recovery). The call ended at the hold limit with both phones healthy.
  it('a resume that overtakes its own hold leaves the peer NOT on hold', () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('resume', 8))
    c.at(10_040).remote(holdEv('hold', 7))
    expect(c.state.peerOnHold).toBe(false)
    expect(c.state.timers.holdDeadline).toBeNull()
  })

  it('in order, hold then resume still pass through (and a later hold still counts)', () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('hold', 3))
    expect(c.state.peerOnHold).toBe(true)
    c.at(12_000).remote(holdEv('resume', 4))
    expect(c.state.peerOnHold).toBe(false)
    c.at(14_000).remote(holdEv('hold', 9))
    expect(c.state.peerOnHold).toBe(true)
  })

  it('this side numbers its own hold/resume in send order, and every one passes the wire contract', () => {
    const e = calleeConnected()
    const h = sent(e.at(1_000).do({ type: 'localHold' }))[0]
    const r = sent(e.at(1_200).do({ type: 'localResume' }))[0]
    if (h.kind !== 'hold' || r.kind !== 'resume') throw new Error('expected hold then resume')
    expect(r.payload.seq).toBeGreaterThan(h.payload.seq)
    for (const ev of [h, r]) expect(parseEvent(ev).ok).toBe(true)
    expect(parseEvent({ ...env(), kind: 'hold', payload: {} }).ok).toBe(false)
    expect(parseEvent({ ...env(), kind: 'resume', payload: { seq: 0 } }).ok).toBe(false)
  })
})

// ===========================================================================
// D11 — one shared hold clock: a short hold inherited the deadline of an earlier one
// ===========================================================================

describe('D11: each person on hold gets their OWN two minutes', () => {
  // Found by the fault simulation at 10× seeds (seed 484): the caller's resume was lost, so the callee's hold
  // clock — one `holdSince` for "anyone on hold" — never closed; 80 s later the callee took a GSM call of its own
  // and was hung up 33 s into it, by the deadline armed two minutes earlier for the caller's hold.
  const flowing = () => 0

  it("a short local hold does not inherit the deadline of the peer's earlier hold", () => {
    const e = calleeConnected()
    e.at(10_000).remote(holdEv('hold')) // the caller's resume is then lost
    e.advance(100_000, { pollEvery: 1_000, stalledAt: flowing })
    e.at(100_000).do({ type: 'localHold' })
    e.advance(10_000 + HOLD_LIMIT_MS + 5_000, { pollEvery: 1_000, stalledAt: flowing })
    expect(e.state.ended).toBeNull()
    expect(e.state.localOnHold).toBe(true)
    // …and its own two minutes still apply:
    e.advance(100_000 + HOLD_LIMIT_MS, { pollEvery: 1_000, stalledAt: flowing })
    expect(e.state.ended).toEqual({ reason: 'lost', origin: 'local' })
  })

  it('overlapping holds where nobody is away for 2 minutes do not end the call', () => {
    const c = callerConnected()
    c.at(1_000).do({ type: 'localHold' })
    c.at(91_000).remote(holdEv('hold'))
    c.at(101_000).do({ type: 'localResume' })
    c.advance(150_000, { pollEvery: 1_000, stalledAt: flowing })
    expect(c.state.peerOnHold).toBe(true) // a genuine 59 s hold — not mistaken for a stale one
    c.at(151_000).remote(holdEv('resume'))
    c.advance(400_000, { pollEvery: 1_000, stalledAt: flowing })
    expect(c.state.ended).toBeNull()
    expect(c.state.timers.holdDeadline).toBeNull()
  })
})

// ===========================================================================
// D12 — a LOST hold/resume could never be corrected (hold was the one state not backed by Postgres)
// ===========================================================================

describe('D12: the resync snapshot carries the peer\'s latest hold/resume, so a lost one heals', () => {
  // Found by the fault simulation at 10× seeds (seed 911): one resume lost in EACH direction left both sides
  // believing the other was on hold; the path then died and neither restarted (a peer hold suspends recovery).
  // The author kept hold out of the snapshot because "a boolean cannot be applied from a possibly-stale
  // snapshot without a sequence number" — D10 put that sequence number on the wire, so it now can be.
  it("a lost resume is corrected by the next snapshot — and the recovery it was suppressing starts", () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('hold', 5)) // the resume (seq 6) never arrives
    c.at(30_000).do({ type: 'packetsStalled', stalledMs: 2_500 }) // the path dies: no restart while "on hold"
    expect(only(c.log, 'createOffer')).toHaveLength(1)
    const fx = c.at(31_000).do({ type: 'snapshot', snapshot: snap({ callState: 'connected', peerHold: { held: false, seq: 6 } }) })
    expect(c.state.peerOnHold).toBe(false)
    expect(only(fx, 'createOffer')).toEqual([{ type: 'createOffer', negId: 2, iceRestart: true }])
  })

  it('a lost hold is learned from the snapshot too', () => {
    const c = callerConnected()
    c.at(10_000).do({ type: 'snapshot', snapshot: snap({ callState: 'connected', peerHold: { held: true, seq: 3 } }) })
    expect(c.state.peerOnHold).toBe(true)
    expect(c.state.timers.holdDeadline).toBe(10_000 + HOLD_LIMIT_MS)
  })

  it('a snapshot older than the events already applied changes nothing', () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('hold', 8))
    c.at(10_100).do({ type: 'snapshot', snapshot: snap({ callState: 'connected', peerHold: { held: false, seq: 7 } }) })
    expect(c.state.peerOnHold).toBe(true)
  })

  it('the wire contract: optional and nullable (an older box omits it), strict when present', () => {
    const base = { v: CALL_PROTOCOL_VERSION, callId: CALL_ID, callState: 'connected', candidates: [] }
    for (const peerHold of [undefined, null, { held: true, seq: 1 }]) expect(parseSnapshotOk({ ...base, peerHold })).toBe(true)
    expect(parseSnapshotOk({ ...base, peerHold: { held: true } })).toBe(false)
    expect(parseSnapshotOk({ ...base, peerHold: { held: true, seq: 1, at: 5 } })).toBe(false)
  })
})

// ===========================================================================
// D3 — a callee whose SDP operation failed during setup asked for a restart exactly once
// ===========================================================================

describe('D3: the callee keeps asking for a restart while CONNECTING, not only while reconnecting', () => {
  function calleeWhoseAnswerFailed(): Driver {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    e.remote(offerEv(1))
    e.do({ type: 'remoteDescriptionApplied', negId: 1 })
    expect(sentKinds(e.do({ type: 'operationFailed', negId: 1, op: 'createAnswer' }))).toEqual(['restart_request'])
    return e
  }

  it('createAnswer failed + that restart_request lost → it is repeated every 5 s (the call does not die at 20 s)', () => {
    const e = calleeWhoseAnswerFailed()
    // Nothing else reaches the callee (its socket is reconnecting): the timer alone must ask again.
    const later = e.advance(3 * RESTART_REQUEST_RETRY_MS + 1)
    expect(sent(later).filter((x) => x.kind === 'restart_request').length).toBeGreaterThanOrEqual(3)
  })

  it('setRemoteDescription(offer) failed + request lost → also repeated', () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    e.remote(offerEv(1))
    e.do({ type: 'operationFailed', negId: 1, op: 'setRemoteDescription' })
    expect(sent(e.advance(RESTART_REQUEST_RETRY_MS + RETRANSMIT_MS)).some((x) => x.kind === 'restart_request')).toBe(true)
  })

  it('a retransmit of the offer it could not answer makes it ask again AT ONCE (rate-limited to one per 2.5 s)', () => {
    // Found by the fault simulation at 10× seeds (seed 1443): four timed requests in a row lost on the caller's
    // side while six retransmits of the unanswerable offer reached the callee — and were ignored.
    const e = calleeWhoseAnswerFailed()
    expect(sentKinds(e.at(RETRANSMIT_MS).remote(offerEv(1)))).toEqual(['restart_request'])
    expect(sentKinds(e.at(RETRANSMIT_MS + 100).remote(offerEv(1)))).toEqual([]) // a burst of copies: once
    expect(sentKinds(e.at(2 * RETRANSMIT_MS).remote(offerEv(1)))).toEqual(['restart_request'])
  })

  it('…and stops as soon as a newer offer shows up', () => {
    const e = calleeWhoseAnswerFailed()
    e.at(1_000).remote(offerEv(2))
    expect(sent(e.advance(4 * RESTART_REQUEST_RETRY_MS)).some((x) => x.kind === 'restart_request')).toBe(false)
  })
})

// ===========================================================================
// D4 — after rolling back a failed createAnswer, the callee still thought that offer was applied
// ===========================================================================

describe('D4: a rolled-back offer is no longer the remote description', () => {
  it("that offer's candidates are not handed to the PC after the rollback (addIceCandidate would reject them)", () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    e.remote(offerEv(1))
    e.do({ type: 'remoteDescriptionApplied', negId: 1 })
    const fx = e.do({ type: 'operationFailed', negId: 1, op: 'createAnswer' })
    expect(fx.map((x) => x.type)).toContain('rollback')
    expect(only(e.remote(candEv(1, [cand('caller', 1, 1)])), 'addCandidates')).toEqual([])
    expect(e.state.remoteNegId).toBe(0)
  })

  it('…and when the replacement offer applies, only ITS candidates are flushed', () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    e.remote(offerEv(1))
    e.do({ type: 'remoteDescriptionApplied', negId: 1 })
    e.do({ type: 'operationFailed', negId: 1, op: 'createAnswer' })
    e.remote(candEv(1, [cand('caller', 1, 1)]))
    e.remote(candEv(2, [cand('caller', 2, 1)]))
    e.remote(offerEv(2))
    expect(only(e.do({ type: 'remoteDescriptionApplied', negId: 2 }), 'addCandidates'))
      .toEqual([{ type: 'addCandidates', negId: 2, candidates: [cand('caller', 2, 1)] }])
  })
})

// ===========================================================================
// D5 — candidates dropped by a queue cap were still remembered as "seen"
// ===========================================================================

describe('D5: the candidate queue caps never swallow a candidate for good', () => {
  it('the NEWEST generation is the one kept when more generations queue than there is room for', () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    for (const n of [1, 2, 3, 4]) e.remote(candEv(n, [cand('caller', n, 1)]))
    const newest = cand('caller', 5, 1)
    e.remote(candEv(5, [newest]))
    e.remote(offerEv(5))
    expect(only(e.do({ type: 'remoteDescriptionApplied', negId: 5 }), 'addCandidates'))
      .toEqual([{ type: 'addCandidates', negId: 5, candidates: [newest] }])
  })

  it('a candidate evicted from the queue is not marked seen: its retransmission is accepted', () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    const victim = cand('caller', 1, 1)
    e.remote(candEv(1, [victim]))
    for (const n of [2, 3, 4, 5]) e.remote(candEv(n, [cand('caller', n, 1)])) // generation 1 is evicted
    // The caller's offer 1 shows up after all (the later generations were a burst of abandoned restarts).
    e.remote(offerEv(1))
    e.do({ type: 'remoteDescriptionApplied', negId: 1 })
    expect(only(e.remote(candEv(1, [victim])), 'addCandidates')).toEqual([{ type: 'addCandidates', negId: 1, candidates: [victim] }])
  })

  it('a peer cannot make the PC pair with an unbounded number of candidates in one generation', () => {
    const c = callerConnected()
    let added = 0
    for (let batch = 0; batch < 10; batch++) {
      const list = Array.from({ length: 20 }, (_, i) => cand('callee', 1, 100 + batch * 20 + i))
      added += only(c.remote(candEv(1, list)), 'addCandidates').reduce((n, x) => n + x.candidates.length, 0)
    }
    expect(added).toBeLessThanOrEqual(64)
  })
})

// ===========================================================================
// D6 — idempotency keys were deduplicated across senders
// ===========================================================================

describe('D6: an idempotency key identifies a send BY ITS SENDER', () => {
  it("a peer that reuses the box's key for a server event cannot make us drop that event", () => {
    const c = callerConnected()
    c.remote(holdEv('hold', undefined, 'box-ended-1')) // the peer picks the box's key
    const fx = c.remote(serverEv('ended', { reason: 'kill_switch' }, 'box-ended-1'))
    expect(only(fx, 'endCall')).toEqual([{ type: 'endCall', reason: 'kill_switch', origin: 'remote' }])
  })

  it('the same key from the same sender is still processed once', () => {
    const c = callerConnected()
    expect(only(c.remote(restartReqEv(1, 'rr-x')), 'createOffer')).toHaveLength(1)
    expect(c.remote(restartReqEv(1, 'rr-x'))).toEqual([])
  })
})

// ===========================================================================
// D7 — SDP failures accumulated over the whole call
// ===========================================================================

describe('D7: the SDP-failure cap stops a failure LOOP, not a long call with a few recovered failures', () => {
  it('four failures, each followed by a completed negotiation, do not end the call', () => {
    const c = callerConnected()
    for (let i = 0; i <= MAX_SDP_FAILURES; i++) {
      c.at(c.t + 60_000).remote(restartReqEv())
      const failing = c.state.negId
      c.do({ type: 'operationFailed', negId: failing, op: 'createOffer' }) // → retries at once with a fresh negId
      expect(c.state.ended).toBeNull()
      const n = c.state.negId
      c.do({ type: 'localDescriptionReady', negId: n, sdp: sdpFor('caller', n) })
      c.remote(answerEv(n))
      c.do({ type: 'remoteDescriptionApplied', negId: n })
    }
    expect(c.state.ended).toBeNull()
  })

  it('back-to-back failures with no completed negotiation in between still end it as media_failed', () => {
    const c = callerConnected()
    c.remote(restartReqEv())
    for (let i = 0; i <= MAX_SDP_FAILURES; i++) c.do({ type: 'operationFailed', negId: c.state.negId, op: 'createOffer' })
    expect(c.state.ended).toEqual({ reason: 'media_failed', origin: 'local' })
  })
})

// ===========================================================================
// D8 — a caller whose callee never said ready waited forever
// ===========================================================================

describe('D8: the caller does not wait for ready without a bound', () => {
  it("accepted, but no ready ever (callee's call channel never subscribes) → lost, 20 s after the accept", () => {
    const c = new Driver('caller')
    c.at(1_000).remote(serverEv('accepted', { calleeTabId: PEER_TAB }))
    c.advance(1_000 + CONNECT_DEADLINE_MS, { snapshot: () => snap({ callState: 'accepted' }) })
    expect(c.state.ended).toEqual({ reason: 'lost', origin: 'local' })
  })

  it('a ready that comes in time restarts the 20 s from the ready, as the spec says', () => {
    const c = new Driver('caller')
    c.at(1_000).remote(serverEv('accepted', { calleeTabId: PEER_TAB }))
    c.at(15_000).remote(readyEv())
    expect(c.state.timers.connectDeadline).toBe(15_000 + CONNECT_DEADLINE_MS)
    c.advance(15_000 + CONNECT_DEADLINE_MS - 1)
    expect(c.state.ended).toBeNull()
  })
})

// ===========================================================================
// D13 — the reducer could mint idempotency keys the box's table refuses
// ===========================================================================

describe('D13: every idempotency key this side mints is 8–64 chars (the box accepts 1–64 since the commit-gate review)', () => {
  // scripts/calls-ddl.mjs now says `CHECK (length(idem) BETWEEN 1 AND 64)` = protocol.ts idempotencyKeySchema exactly;
  // this side still mints ≥ 8 (a fresh instanceId per reducer). Originally: `BETWEEN 8 AND 64`. The module documented
  // instanceId as "1–40 chars", so an engine that followed it with a short id would have EVERY POST refused by
  // the database — retried forever by the engine, the call never set up, nothing on screen saying why.
  it('an instanceId too short to yield an 8-character key is refused up front', () => {
    expect(() => createNegotiation({ role: 'caller', callId: CALL_ID, tabId: MY_TAB, instanceId: 'ab12', now: 0 })).toThrow(/instanceId/)
  })

  it('the keys of a long call are all 8–64 characters', () => {
    const c = callerConnected()
    for (let i = 1; i < 30; i++) c.at(i * 1_000).remote(restartReqEv())
    const keys = sent(c.log).map((e) => e.idempotencyKey)
    expect(keys.every((k) => k.length >= 8 && k.length <= 64)).toBe(true)
  })
})

// ===========================================================================
// D14 — a peer could put the BOX's end reasons in our mouth
// ===========================================================================

describe("D14: a peer's own 'end' cannot claim a reason only the box decides", () => {
  // missed / unavailable / blocked / kill_switch / cap_reached are decided by the box and arrive as 'ended'. A
  // stranger's 'end' carrying one of them is a lie by construction — "you were blocked", "calls are switched
  // off" — and a relayed 'declined' after a call was accepted is no business of the other side's UI either.
  it('a peer end claiming a box-only reason is shown as a plain hang-up', () => {
    for (const reason of ['blocked', 'kill_switch', 'cap_reached', 'missed', 'unavailable'] as const) {
      const c = callerConnected()
      expect(only(c.remote(mustParse({ ...env(), kind: 'end', payload: { reason } })), 'endCall'))
        .toEqual([{ type: 'endCall', reason: 'hangup', origin: 'remote' }])
    }
  })

  it("the peer's own reasons pass through, and the box's 'ended' is believed whatever it says", () => {
    const c = callerConnected()
    expect(only(c.remote(mustParse({ ...env(), kind: 'end', payload: { reason: 'media_failed' } })), 'endCall'))
      .toMatchObject([{ reason: 'media_failed' }])
    // The safety code's 'sas_mismatch' is no longer a peer's word (protocol v2): an old peer saying it reads as a hang-up.
    const old = callerConnected()
    expect(only(old.remote(mustParse({ ...env(), kind: 'end', payload: { reason: 'sas_mismatch' } })), 'endCall'))
      .toMatchObject([{ reason: 'hangup' }])
    const e = calleeConnected()
    expect(only(e.remote(serverEv('ended', { reason: 'blocked' })), 'endCall')).toMatchObject([{ reason: 'blocked' }])
  })
})

// ===========================================================================
// D9 — media that died during the PEER's hold was left to the resumer alone
// ===========================================================================

describe("D9: when the peer resumes and the media is down, this side recovers too", () => {
  // Found by the fault simulation (seed 34): the callee's 'resume' lost the race to the caller's 'hold' (an app
  // switch), leaving "peer on hold" stuck on the callee; later the path died during the callee's real hold, and
  // on resume the callee's restart_request was suppressed by that stale flag — while the caller, which alone
  // can offer, merely re-armed its 40 s clock on the callee's resume. Nobody restarted; the call ended as lost.
  it('caller: path died during the callee\'s hold → the callee\'s resume makes the caller restart at once', () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('hold'))
    expect(only(c.at(15_000).do({ type: 'packetsStalled', stalledMs: 3_000 }), 'createOffer')).toEqual([]) // on hold: no restart
    const fx = c.at(40_000).remote(holdEv('resume'))
    expect(only(fx, 'createOffer')).toEqual([{ type: 'createOffer', negId: 2, iceRestart: true }])
    expect(c.state.timers.lostDeadline).toBe(40_000 + 40_000)
  })

  it('callee: path died during the caller\'s hold → the caller\'s resume makes the callee ask for a restart', () => {
    const e = calleeConnected()
    e.at(10_000).remote(holdEv('hold'))
    e.at(15_000).do({ type: 'packetsStalled', stalledMs: 3_000 })
    expect(sent(e.at(40_000).remote(holdEv('resume')))).toMatchObject([{ kind: 'restart_request', negId: 1 }])
  })

  it('a resume while media flows restarts nothing on this side (the resumer rebuilds its own path)', () => {
    const c = callerConnected()
    c.at(10_000).remote(holdEv('hold'))
    expect(only(c.at(20_000).remote(holdEv('resume')), 'createOffer')).toEqual([])
  })

  it('…and nothing while THIS side is still on hold', () => {
    const c = callerConnected()
    c.at(5_000).do({ type: 'localHold' })
    c.at(10_000).remote(holdEv('hold'))
    c.at(15_000).do({ type: 'packetsStalled', stalledMs: 3_000 })
    expect(only(c.at(20_000).remote(holdEv('resume')), 'createOffer')).toEqual([])
    expect(only(c.at(25_000).do({ type: 'localResume' }), 'createOffer')).toEqual([{ type: 'createOffer', negId: 2, iceRestart: true }])
  })
})

// ===========================================================================
// Branches the module's own unit tests never reached directly
// ===========================================================================

describe('coverage: superseded negotiations on the callee, stale PC callbacks', () => {
  it('an offer superseded while it is being APPLIED is rolled back, and the newer one applied', () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    e.remote(offerEv(1))
    e.remote(offerEv(2)) // lands while setRemoteDescription(1) is in flight
    const fx = e.do({ type: 'remoteDescriptionApplied', negId: 1 })
    expect(fx.map((x) => x.type)).toEqual(['rollback', 'setRemoteDescription'])
    expect(only(fx, 'setRemoteDescription')[0]).toMatchObject({ negId: 2, sdpType: 'offer' })
  })

  it('an offer superseded while its answer is being CREATED: that answer is never sent, the newer offer is applied', () => {
    const e = new Driver('callee')
    e.do({ type: 'accepted' })
    e.remote(offerEv(1))
    e.do({ type: 'remoteDescriptionApplied', negId: 1 })
    e.remote(offerEv(2)) // lands while createAnswer(1) is in flight
    const fx = e.do({ type: 'localDescriptionReady', negId: 1, sdp: sdpFor('callee', 1) })
    expect(sentKinds(fx)).toEqual([])
    expect(fx.map((x) => x.type)).toEqual(['setRemoteDescription'])
    expect(e.state.answeredNegId).toBe(1) // the PC is stable with offer 1 — what a later rollback returns to
  })

  it('PC callbacks for an operation the reducer is not waiting on change nothing', () => {
    const c = callerAwaitingAnswer()
    const before = c.state
    expect(c.do({ type: 'localDescriptionReady', negId: 1, sdp: sdpFor('caller', 1) })).toEqual([])
    expect(c.do({ type: 'remoteDescriptionApplied', negId: 1 })).toEqual([])
    expect(c.do({ type: 'operationFailed', negId: 1, op: 'createAnswer' })).toEqual([])
    expect(c.do({ type: 'operationFailed', negId: 7, op: 'createOffer' })).toEqual([])
    expect(c.state).toEqual(before)
  })

  it('fuzz: 4,000 random inputs per role against DEEP-FROZEN states — no mutation, no throw, every send valid', () => {
    const deepFreeze = <T,>(o: T): T => {
      if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o)
        for (const v of Object.values(o as object)) deepFreeze(v)
      }
      return o
    }
    for (const role of ['caller', 'callee'] as const) {
      const rng = mulberry32(role === 'caller' ? 99 : 100)
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]
      const d = new Driver(role)
      deepFreeze(d.state)
      let t = 0
      for (let i = 0; i < 4_000 && d.state.phase !== 'ended'; i++) {
        t += Math.floor(rng() * 1_500)
        const n = 1 + Math.floor(rng() * 5)
        const inputs: In[] = [
          { type: 'accepted' }, { type: 'resubscribed' },
          { type: 'remote', event: offerEv(n) }, { type: 'remote', event: answerEv(n) }, { type: 'remote', event: readyEv() },
          { type: 'remote', event: candEv(n, [cand(role === 'caller' ? 'callee' : 'caller', n, i % 7)]) },
          { type: 'remote', event: restartReqEv(n) }, { type: 'remote', event: holdEv(pick(['hold', 'resume'] as const), 1 + Math.floor(rng() * 40)) },
          { type: 'localDescriptionReady', negId: n, sdp: sdpFor(role, n) }, { type: 'remoteDescriptionApplied', negId: n },
          { type: 'operationFailed', negId: n, op: pick(['createOffer', 'createAnswer', 'setRemoteDescription'] as const) },
          { type: 'candidatesGathered', negId: n, candidates: [cand(role, n, i % 5)] },
          { type: 'iceConnectionStateChange', state: pick(['checking', 'connected', 'completed', 'disconnected', 'failed'] as const) },
          { type: 'packetsStalled', stalledMs: pick([0, 500, 2_000, 9_000]) },
          { type: 'localHold' }, { type: 'localResume' },
          { type: 'timer', timer: pick(TIMER_NAMES) },
          { type: 'snapshot', snapshot: snap({ callState: pick(['accepted', 'ready', 'connected'] as const), latestOffer: { negId: n, sdp: sdpFor('caller', n) }, latestAnswer: { negId: n, sdp: sdpFor('callee', n) }, peerHold: { held: rng() < 0.5, seq: 1 + Math.floor(rng() * 40) } }) },
        ]
        const fx = d.at(t).do(pick(inputs)) // throws if the reducer mutates a frozen state
        deepFreeze(d.state)
        for (const e of sent(fx)) expect(parseEvent(JSON.parse(JSON.stringify(e))).ok).toBe(true)
        if (role === 'callee') expect(only(fx, 'createOffer')).toEqual([])
      }
    }
  })

  it('a stats poll that cannot be a duration (NaN, Infinity, negative) is ignored', () => {
    const c = callerConnected()
    for (const stalledMs of [Number.NaN, Number.POSITIVE_INFINITY, -5]) expect(c.do({ type: 'packetsStalled', stalledMs })).toEqual([])
    expect(c.state.phase).toBe('connected')
  })
})

// ===========================================================================
// Simulation — a fault-injecting box and a strict fake RTCPeerConnection that also FAILS operations
// ===========================================================================

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
const STAB: Record<CallRole, string> = { caller: 'tab-A', callee: 'tab-B' }
const SIDE: Record<CallRole, 'A' | 'B'> = { caller: 'A', callee: 'B' }
const peerOf = (r: CallRole): CallRole => (r === 'caller' ? 'callee' : 'caller')
const genOf = (re: RegExp, s: string) => { const m = re.exec(s); return m ? { side: m[1], gen: Number(m[2]) } : null }

interface FaultOpts {
  seed: number
  drop: number
  dup: number
  maxDelay: number
  /** POST latency spread: two POSTs sent back to back can commit in either order (hold vs resume, offer vs candidates). */
  postSpread: number
  resync: boolean
  failRate: number
  maxFails: number
  answeredElsewhere: boolean
  holds: number
  pathKills: number
  channelDrops: boolean
}

/** The browser's JSEP state for one phone, refusing what a browser refuses. Generations are read from the ufrag. */
class StrictPc {
  sig: 'stable' | 'have-local-offer' | 'have-remote-offer' = 'stable'
  localGen = 0
  remoteGen = 0
  pendingGen = 0
  busyUntil = 0
  readonly remote = new Map<number, Set<string>>()
  readonly violations: string[] = []
  get remoteDescGen(): number { return this.sig === 'have-remote-offer' ? this.pendingGen : this.remoteGen }
  add(gen: number, c: string): void { const s = this.remote.get(gen) ?? new Set<string>(); s.add(c); this.remote.set(gen, s) }
}

interface FSide {
  role: CallRole
  state: NegotiationState
  pc: StrictPc
  timers: Map<TimerName, number>
  ended: { reason: string; origin: string; at: number } | null
  connectedAt: number | null
  polling: boolean
  fails: number
}

class FaultSim {
  t = 0
  readonly rng: () => number
  readonly sides = {} as Record<CallRole, FSide>
  readonly violations: string[] = []
  readonly trace: string[] = []
  readonly srv = {
    seen: new Set<string>(),
    state: 'ringing' as ResyncSnapshot['callState'],
    endReason: null as ResyncSnapshot['endReason'],
    latestOffer: null as ResyncSnapshot['latestOffer'],
    latestAnswer: null as ResyncSnapshot['latestAnswer'],
    cands: { caller: new Map<number, IceCandidate[]>(), callee: new Map<number, IceCandidate[]>() },
    hold: { caller: null, callee: null } as Record<CallRole, { held: boolean; seq: number } | null>,
  }
  readyAt: number | null = null
  iceGen = 0
  mediaOk = false
  mediaLostAt = 0
  holdLog: string[] = []
  private readonly dead = new Set<number>()
  private readonly chanDownUntil: Record<CallRole, number> = { caller: 0, callee: 0 }
  private q: { at: number; seq: number; run: () => void }[] = []
  private seq = 0
  private tok = 0
  private srvKey = 0
  private connecting = 0

  constructor(readonly o: FaultOpts) {
    this.rng = mulberry32(o.seed)
    const mk = (role: CallRole): FSide => {
      const r = createNegotiation({
        role, callId: CALL_ID, tabId: STAB[role], instanceId: `fault-${role}-${o.seed}`,
        peerTabId: role === 'callee' ? STAB.caller : null, now: 0,
      })
      const side: FSide = { role, state: r.state, pc: new StrictPc(), timers: new Map(), ended: null, connectedAt: null, polling: false, fails: 0 }
      this.sides[role] = side
      for (const e of r.effects) this.perform(role, e)
      return side
    }
    mk('caller')
    mk('callee')
  }

  // --- loop --------------------------------------------------------------
  at(time: number, run: () => void): void {
    const item = { at: Math.max(time, this.t), seq: this.seq++, run }
    let lo = 0
    let hi = this.q.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.q[mid].at < item.at || (this.q[mid].at === item.at && this.q[mid].seq < item.seq)) lo = mid + 1
      else hi = mid
    }
    this.q.splice(lo, 0, item)
  }
  rand(lo: number, hi: number): number { return lo + Math.floor(this.rng() * (hi - lo + 1)) }
  run(until: number): void {
    while (this.q.length > 0 && this.q[0].at <= until) {
      const it = this.q.shift()!
      this.t = it.at
      it.run()
    }
    this.t = Math.max(this.t, until)
  }
  note(s: string): void { this.trace.push(`${this.t}ms ${s}`); if (this.trace.length > 120) this.trace.shift() }
  bothConnected = () => ROLES.every((r) => this.sides[r].state.phase === 'connected')

  // --- reducers ------------------------------------------------------------
  dispatch(role: CallRole, input: In): void {
    const s = this.sides[role]
    const r = step(s.state, { ...input, now: this.t } as NegotiationInput)
    s.state = r.state
    if (input.type !== 'packetsStalled' || r.effects.length > 0) {
      const what = input.type === 'remote' ? `remote:${input.event.kind}${'negId' in input.event ? input.event.negId ?? '' : ''}` : input.type === 'timer' ? `timer:${input.timer}` : input.type
      this.note(`${role} ← ${what} → ${r.effects.map((e) => (e.type === 'send' ? `send:${e.event.kind}` : 'negId' in e ? `${e.type}:${e.negId}` : e.type)).join(',')} [${r.state.phase}/${r.state.op}/n${r.state.negId}]`)
    }
    for (const e of r.effects) this.perform(role, e)
    if (s.connectedAt === null && s.state.phase === 'connected') s.connectedAt = this.t
  }

  perform(role: CallRole, e: Fx): void {
    const s = this.sides[role]
    switch (e.type) {
      case 'send': this.post(role, e.event); return
      case 'schedule': {
        const token = ++this.tok
        s.timers.set(e.timer, token)
        this.at(e.atMs, () => { if (s.timers.get(e.timer) === token) { s.timers.delete(e.timer); this.dispatch(role, { type: 'timer', timer: e.timer }) } })
        return
      }
      case 'cancel': s.timers.delete(e.timer); return
      case 'fetchState': this.fetch(role); return
      case 'endCall':
        if (s.ended) this.violations.push(`${role}: endCall twice`)
        s.ended = { reason: e.reason, origin: e.origin, at: this.t }
        return
      default: {
        const startAt = Math.max(this.t, s.pc.busyUntil) + this.rand(2, 25)
        s.pc.busyUntil = startAt
        this.at(startAt, () => this.execPc(role, e))
      }
    }
  }

  private failNow(role: CallRole): boolean {
    const s = this.sides[role]
    if (s.fails >= this.o.maxFails || this.rng() >= this.o.failRate) return false
    s.fails++
    return true
  }

  execPc(role: CallRole, e: Fx): void {
    const s = this.sides[role]
    const pc = s.pc
    if (s.ended) return
    const theirs = SIDE[peerOf(role)]
    switch (e.type) {
      case 'createOffer':
        if (role !== 'caller') { pc.violations.push('callee createOffer'); return }
        if (pc.sig !== 'stable') { pc.violations.push(`createOffer(${e.negId}) in ${pc.sig}`); return }
        if (this.failNow(role)) { this.dispatch(role, { type: 'operationFailed', negId: e.negId, op: 'createOffer' }); return }
        pc.sig = 'have-local-offer'
        pc.pendingGen = e.negId
        this.gather(role, e.negId)
        return
      case 'createAnswer':
        if (pc.sig !== 'have-remote-offer' || pc.pendingGen !== e.negId) { pc.violations.push(`createAnswer(${e.negId}) in ${pc.sig}/${pc.pendingGen}`); return }
        // A failed createAnswer/setLocalDescription leaves the PC in have-remote-offer — the reducer must roll back.
        if (this.failNow(role)) { this.dispatch(role, { type: 'operationFailed', negId: e.negId, op: 'createAnswer' }); return }
        pc.sig = 'stable'
        pc.remoteGen = e.negId
        pc.localGen = e.negId
        this.gather(role, e.negId)
        this.checkConnect()
        return
      case 'setRemoteDescription': {
        const g = genOf(/a=ice-ufrag:([AB])(\d+)/, e.sdp)
        if (!g || g.side !== theirs || g.gen !== e.negId) { pc.violations.push(`SRD(${e.negId}) given ${JSON.stringify(g)}`); return }
        if (e.sdpType === 'offer') {
          if (pc.sig !== 'stable') { pc.violations.push(`offer ${g.gen} in ${pc.sig}`); return }
          if (this.failNow(role)) { this.dispatch(role, { type: 'operationFailed', negId: e.negId, op: 'setRemoteDescription' }); return }
          pc.sig = 'have-remote-offer'
          pc.pendingGen = g.gen
        } else {
          if (pc.sig !== 'have-local-offer' || pc.pendingGen !== g.gen) { pc.violations.push(`answer ${g.gen} in ${pc.sig}/${pc.pendingGen}`); return }
          if (this.failNow(role)) { this.dispatch(role, { type: 'operationFailed', negId: e.negId, op: 'setRemoteDescription' }); return }
          pc.sig = 'stable'
          pc.localGen = g.gen
          pc.remoteGen = g.gen
        }
        for (const line of e.sdp.split('\r\n')) if (line.startsWith('a=candidate:')) pc.add(g.gen, line.slice(2))
        this.dispatch(role, { type: 'remoteDescriptionApplied', negId: e.negId })
        this.checkConnect()
        return
      }
      case 'addCandidates': {
        const g = pc.remoteDescGen
        if (g === 0 || g !== e.negId) { pc.violations.push(`addCandidates(${e.negId}) with remote description ${g} (${pc.sig})`); return }
        for (const c of e.candidates) {
          const cg = genOf(/ufrag ([AB])(\d+)$/, c.candidate)
          if (!cg || cg.side !== theirs || cg.gen !== g) pc.violations.push(`candidate ${c.candidate} into ${g}`)
          else pc.add(g, c.candidate)
        }
        this.checkConnect()
        return
      }
      case 'rollback':
        if (pc.sig === 'stable') { pc.violations.push('rollback in stable'); return }
        pc.sig = 'stable'
        pc.pendingGen = 0
        return
    }
  }

  gather(role: CallRole, negId: number): void {
    const L = SIDE[role]
    const all: IceCandidate[] = Array.from({ length: this.rand(1, 3) }, (_, i) => ({
      candidate: `candidate:${i + 1} 1 udp ${100 - i} 203.0.113.${role === 'caller' ? 10 : 20} ${40_000 + negId * 10 + i} typ relay raddr 0.0.0.0 rport 0 ufrag ${L}${negId}`,
      sdpMid: '0', sdpMLineIndex: 0, usernameFragment: `${L}${negId}`,
    }))
    const inSdp = this.rng() < 0.5 ? all.slice(0, 1) : []
    const sdp = `v=0\r\no=- 1 ${negId} IN IP4 0.0.0.0\r\na=ice-ufrag:${L}${negId}\r\n${inSdp.map((c) => `a=${c.candidate}\r\n`).join('')}`
    const readyAt = this.t + this.rand(0, 300)
    this.at(readyAt, () => this.dispatch(role, { type: 'localDescriptionReady', negId, sdp }))
    for (const c of all.slice(inSdp.length)) this.at(readyAt + this.rand(1, 400), () => this.dispatch(role, { type: 'candidatesGathered', negId, candidates: [c] }))
  }

  connectable(g: number): boolean {
    const a = this.sides.caller.pc
    const b = this.sides.callee.pc
    return g > 0 && a.localGen === g && a.remoteGen === g && b.localGen === g && b.remoteGen === g &&
      (a.remote.get(g)?.size ?? 0) > 0 && (b.remote.get(g)?.size ?? 0) > 0 && !this.dead.has(g) &&
      !this.sides.caller.ended && !this.sides.callee.ended
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
      this.note(`ICE connected on ${g}`)
      for (const role of ROLES) {
        this.at(this.t + this.rand(0, 50), () => this.dispatch(role, { type: 'iceConnectionStateChange', state: 'connected' }))
        if (!this.sides[role].polling) { this.sides[role].polling = true; this.at(this.t + this.rand(100, 1_000), () => this.poll(role)) }
      }
    })
  }

  poll(role: CallRole): void {
    if (this.sides[role].ended) return
    this.dispatch(role, { type: 'packetsStalled', stalledMs: this.mediaOk ? 0 : this.t - this.mediaLostAt })
    this.at(this.t + 1_000, () => this.poll(role))
  }

  killPath(at: number): void {
    this.at(at, () => {
      if (!this.mediaOk) return
      this.note(`PATH DIES (gen ${this.iceGen})`)
      this.dead.add(this.iceGen)
      this.mediaOk = false
      this.mediaLostAt = this.t
      this.iceGen = 0
      for (const role of ROLES) this.at(this.t + this.rand(5_000, 7_500), () => { if (!this.mediaOk) this.dispatch(role, { type: 'iceConnectionStateChange', state: 'disconnected' }) })
    })
  }

  /** A hold that really happened (a GSM call on Android: silence keeps flowing). */
  hold(role: CallRole, at: number, ms: number): void {
    this.at(at, () => { this.holdLog.push(`${role} hold @${this.t}`); this.dispatch(role, { type: 'localHold' }) })
    this.at(at + ms, () => { this.holdLog.push(`${role} resume @${this.t}`); this.dispatch(role, { type: 'localResume' }) })
  }

  /** The call channel drops (Realtime reconnect): broadcasts meanwhile are lost; then it re-SUBSCRIBES. */
  dropChannel(role: CallRole, at: number, ms: number): void {
    this.at(at, () => { this.chanDownUntil[role] = this.t + ms; this.note(`${role} channel down ${ms} ms`) })
    this.at(at + ms, () => this.dispatch(role, { type: 'resubscribed' }))
  }

  // --- the box ---------------------------------------------------------------
  start(): void {
    const acceptAt = this.rand(300, 3_000)
    this.at(acceptAt, () => {
      this.srv.state = 'accepted'
      this.broadcastServer(['caller'], 'accepted', { calleeTabId: STAB.callee })
      // DESIGN §3.2 step 3: "other devices get answered_elsewhere" — on ring:<callee>, which the accepting tab
      // is subscribed to as well, and before its own accept POST has returned.
      if (this.o.answeredElsewhere) this.broadcastServer(['callee'], 'answered_elsewhere', { calleeTabId: STAB.callee })
      this.at(this.t + this.rand(50, 2_000), () => this.dispatch('callee', { type: 'accepted' }))
    })
  }

  post(from: CallRole, event: ClientEvent): void {
    const parsed = parseEvent(event)
    if (!parsed.ok) this.violations.push(`${from} sent an invalid event ${JSON.stringify(parsed)}`)
    if (from === 'callee' && event.kind === 'offer') this.violations.push('callee sent an offer')
    if (from === 'callee' && event.kind === 'ready' && this.readyAt === null) this.readyAt = this.t
    const arrive = this.t + this.rand(20, this.o.postSpread)
    this.at(arrive, () => this.receive(from, event))
    if (this.rng() < 0.1) this.at(arrive + this.rand(50, 600), () => this.receive(from, event)) // retried POST, same key
  }

  receive(from: CallRole, event: ClientEvent): void {
    const key = `${from}|${event.idempotencyKey}`
    if (this.srv.seen.has(key)) return
    this.srv.seen.add(key)
    if (this.srv.state === 'ended') return
    switch (event.kind) {
      case 'ready': if (from === 'callee' && this.srv.state === 'accepted') this.srv.state = 'ready'; break
      case 'offer': if (event.negId >= (this.srv.latestOffer?.negId ?? 0)) this.srv.latestOffer = { negId: event.negId, sdp: event.payload.sdp }; break
      case 'answer': if (event.negId >= (this.srv.latestAnswer?.negId ?? 0)) this.srv.latestAnswer = { negId: event.negId, sdp: event.payload.sdp }; break
      case 'candidates': {
        const row = this.srv.cands[from]
        const have = row.get(event.negId) ?? []
        row.set(event.negId, [...have, ...event.payload.candidates.filter((c) => !have.some((h) => h.candidate === c.candidate))])
        break
      }
      case 'hold':
      case 'resume': {
        const last = this.srv.hold[from]
        if (!last || event.payload.seq > last.seq) this.srv.hold[from] = { held: event.kind === 'hold', seq: event.payload.seq }
        break
      }
      case 'end':
        this.srv.state = 'ended'
        this.srv.endReason = event.payload.reason
        this.broadcast(ROLES, event)
        this.broadcastServer(ROLES, 'ended', { reason: event.payload.reason })
        return
    }
    this.broadcast(ROLES, event)
  }

  broadcastServer(to: readonly CallRole[], kind: string, payload: object): void {
    this.broadcast(to, mustParse({ v: CALL_PROTOCOL_VERSION, callId: CALL_ID, idempotencyKey: `srv-${++this.srvKey}`, tabId: 'server', kind, payload }))
  }

  broadcast(to: readonly CallRole[], event: CallEvent): void {
    for (const r of to) {
      const copies = this.rng() < this.o.dup ? 2 : 1
      for (let c = 0; c < copies; c++) {
        if (this.rng() < this.o.drop || this.t < this.chanDownUntil[r]) continue
        this.at(this.t + this.rand(10, this.o.maxDelay), () => { if (this.t >= this.chanDownUntil[r]) this.dispatch(r, { type: 'remote', event }) })
      }
    }
  }

  fetch(role: CallRole): void {
    if (!this.o.resync) return
    this.at(this.t + this.rand(20, 200), () => {
      const peer = peerOf(role)
      const snapshot: ResyncSnapshot = {
        v: CALL_PROTOCOL_VERSION, callId: CALL_ID, callState: this.srv.state, endReason: this.srv.endReason,
        peerTabId: this.srv.state === 'ringing' ? null : STAB[peer],
        latestOffer: this.srv.latestOffer, latestAnswer: this.srv.latestAnswer, peerHold: this.srv.hold[peer],
        candidates: [...this.srv.cands[peer].entries()].slice(-16).map(([negId, list]) => ({ negId, candidates: list.slice(-64) })),
      }
      this.at(this.t + this.rand(20, 200), () => this.dispatch(role, { type: 'snapshot', snapshot }))
    })
  }

  problems(): string[] {
    return [...this.violations, ...ROLES.flatMap((r) => this.sides[r].pc.violations.map((v) => `${r} PC: ${v}`))]
  }
}

const tail = (sim: FaultSim) => `\n  ${sim.trace.slice(-45).join('\n  ')}`

describe('fault simulation — failing SDP operations, holds, channel drops and answered_elsewhere, two live reducers', () => {
  it('setup converges inside the 20 s deadline for 200 seeds even when up to 2 SDP operations per side fail', () => {
    const failures: string[] = []
    let injected = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = mulberry32(seed * 7_331)
      const sim = new FaultSim({
        seed: seed + 50_000, drop: r() * 0.15, dup: r() * 0.2, maxDelay: 50 + Math.floor(r() * 400), postSpread: 60 + Math.floor(r() * 400),
        resync: seed % 4 !== 0, failRate: 0.35, maxFails: 2, answeredElsewhere: true, holds: 0, pathKills: 0, channelDrops: false,
      })
      sim.start()
      sim.run(40_000)
      injected += sim.sides.caller.fails + sim.sides.callee.fails
      const p = sim.problems()
      if (p.length) { failures.push(`seed ${seed}: ${p.join(' | ')}${tail(sim)}`); continue }
      for (const role of ROLES) {
        const s = sim.sides[role]
        if (s.ended) failures.push(`seed ${seed}: ${role} ended (${s.ended.reason}) at ${s.ended.at}${tail(sim)}`)
        else if (s.connectedAt === null) failures.push(`seed ${seed}: ${role} never connected${tail(sim)}`)
        else if (sim.readyAt !== null && s.connectedAt > sim.readyAt + CONNECT_DEADLINE_MS) failures.push(`seed ${seed}: ${role} connected late`)
      }
    }
    expect(failures.slice(0, 3)).toEqual([])
    expect(injected).toBeGreaterThan(200) // the failure paths really ran
  })

  it('channel drops during setup (ready, offer or answer broadcast into a reconnecting socket) are recovered for 200 seeds', () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const r = mulberry32(seed * 104_723)
      const sim = new FaultSim({
        seed: seed + 60_000, drop: r() * 0.2, dup: r() * 0.2, maxDelay: 50 + Math.floor(r() * 500), postSpread: 60 + Math.floor(r() * 300),
        resync: true, failRate: 0, maxFails: 0, answeredElsewhere: true, holds: 0, pathKills: 0, channelDrops: true,
      })
      for (const role of ROLES) if (r() < 0.7) sim.dropChannel(role, sim.rand(200, 6_000), sim.rand(300, 6_000))
      sim.start()
      sim.run(40_000)
      const p = sim.problems()
      if (p.length) { failures.push(`seed ${seed}: ${p.join(' | ')}${tail(sim)}`); continue }
      for (const role of ROLES) {
        const s = sim.sides[role]
        if (s.ended || s.connectedAt === null) failures.push(`seed ${seed}: ${role} ${s.ended ? `ended (${s.ended.reason})` : 'never connected'}${tail(sim)}`)
      }
    }
    expect(failures.slice(0, 3)).toEqual([])
  })

  it('holds (reordered hold/resume POSTs), dead paths and SDP failures after connect never end a call that recovers — 120 seeds × 5 min', () => {
    const failures: string[] = []
    let holds = 0
    for (let seed = 1; seed <= 120; seed++) {
      const r = mulberry32(seed * 15_485_863)
      const sim = new FaultSim({
        seed: seed + 70_000, drop: r() * 0.1, dup: r() * 0.2, maxDelay: 50 + Math.floor(r() * 300), postSpread: 60 + Math.floor(r() * 600),
        resync: true, failRate: 0.15, maxFails: 2, answeredElsewhere: true, holds: 3, pathKills: 1, channelDrops: false,
      })
      sim.start()
      sim.run(40_000)
      if (!sim.bothConnected()) { failures.push(`seed ${seed}: setup failed${tail(sim)}`); continue }
      // After connect: up to three holds (some as short as an app switch — the POST race), and maybe a dead path.
      let t = sim.t + 2_000
      for (let i = 0; i < 3; i++) {
        const who: CallRole = r() < 0.5 ? 'caller' : 'callee'
        const ms = r() < 0.5 ? 50 + Math.floor(r() * 400) : 2_000 + Math.floor(r() * 60_000)
        sim.hold(who, t, ms)
        holds++
        t += ms + 5_000 + Math.floor(r() * 10_000)
      }
      if (r() < 0.5) sim.killPath(sim.t + 20_000 + Math.floor(r() * 60_000))
      sim.run(sim.t + 5 * 60_000)
      const p = sim.problems()
      if (p.length) { failures.push(`seed ${seed}: ${p.join(' | ')}${tail(sim)}`); continue }
      for (const role of ROLES) {
        const s = sim.sides[role]
        if (s.ended) failures.push(`seed ${seed}: ${role} ended (${s.ended.reason}) at ${s.ended.at} — holds ${sim.holdLog.join(', ')}${tail(sim)}`)
      }
      if (!failures.length && !sim.bothConnected()) failures.push(`seed ${seed}: not connected at the end (${sim.sides.caller.state.phase}/${sim.sides.callee.state.phase})${tail(sim)}`)
    }
    expect(failures.slice(0, 3)).toEqual([])
    expect(holds).toBeGreaterThan(300)
  })
})
