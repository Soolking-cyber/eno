/**
 * The video ladder, pinned by synthetic traces. Each test drives step() once per simulated second against a tiny model
 * of the sender (the ladder's own actions applied the way the engine would apply them) and a network function that
 * turns the cap in force into what getStats would report. The headline trace uses a crude GCC with the three properties
 * review-refute-quality.md proved from libwebrtc source — the estimator a capped sender actually has — because that is
 * the defect this module exists to fix: under it, absolute thresholds step down and never climb back.
 */
import { describe, expect, it } from 'vitest'
import type { CodecName } from './types'
import {
  createLadder, step, LADDER_TUNING as T, RUNG_SPEC,
  type LadderAction, type LadderPlan, type LadderSample, type LadderState,
} from './ladder'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** What the sender is doing: the ladder's actions, applied. */
interface Tx { cap: number; height: number; fps: number; codec: CodecName; paused: boolean }
type Net = (t: number, tx: Tx) => Partial<LadderSample>
type Logged = { t: number; a: LadderAction }

interface SimOptions {
  seconds?: number
  /** Explicit sample times in seconds (gap tests); default every second from 0 to `seconds`. */
  ticks?: number[]
  net?: Net
  codec?: CodecName
  /** Which codecs this phone encodes in hardware — default H.264 only, like a MediaTek/Unisoc Android. */
  hw?: (codec: CodecName) => boolean
  /** The sender adopts each setCap one sample late (setParameters is async), and getStats reports what it really has. */
  lagCap?: boolean
}

function apply(tx: Tx, actions: readonly LadderAction[]): void {
  for (const a of actions) {
    if (a.type === 'setCap') tx.cap = a.bps
    else if (a.type === 'setScaleToHeight') tx.height = a.height
    else if (a.type === 'setMaxFramerate') tx.fps = a.fps
    else if (a.type === 'switchCodec') tx.codec = a.codec
    else if (a.type === 'pauseVideo') tx.paused = true
    else if (a.type === 'resumeVideo') tx.paused = false
  }
}

/** A clean path by default: target pinned at the cap, no loss, flat 50 ms RTT, a cheap encoder. */
function simulate(plan: LadderPlan, o: SimOptions = {}) {
  const init = createLadder(plan)
  let state: LadderState = init.state
  const tx: Tx = { cap: 0, height: 0, fps: 0, codec: o.codec ?? 'H264', paused: false }
  apply(tx, init.actions)
  const hw = o.hw ?? ((c: CodecName) => c === 'H264')
  const ticks = o.ticks ?? Array.from({ length: (o.seconds ?? 60) + 1 }, (_, i) => i)
  const log: Logged[] = []
  let lagged = tx.cap
  for (const t of ticks) {
    const view: Tx = o.lagCap ? { ...tx, cap: lagged } : tx
    lagged = tx.cap
    const sample: LadderSample = {
      targetBitrateBps: view.paused ? 0 : view.cap,
      currentCapBps: view.cap,
      qualityLimitationReason: 'none',
      fractionLost: 0,
      rttMs: 50,
      fps: view.fps,
      frameHeight: view.height,
      encodeMsPerFrame: 5,
      codec: view.codec,
      hardwareEncoder: hw(view.codec),
      canSwitchCodec: true,
      videoEnabled: true,
      ...o.net?.(t, view),
    }
    const r = step(state, sample, t * 1000)
    state = r.state
    apply(tx, r.actions)
    for (const a of r.actions) log.push({ t, a })
  }
  return { state, tx, log }
}

/** An ideal estimator: the target is whatever the path carries, up to the cap. */
const link = (capacity: (t: number) => number, extra?: Net): Net => (t, tx) => ({
  targetBitrateBps: tx.paused ? 0 : Math.min(tx.cap, capacity(t)),
  ...extra?.(t, tx),
})

/**
 * A crude GCC with the three properties review-refute-quality.md objection 1 proved from libwebrtc m150 source:
 *  - the delay-based estimate grows only to 1.5× what was actually sent, +10 kbps (aimd_rate_control.cc L251-252);
 *  - on overuse it falls to 0.85× the delivered rate (L290, beta 0.85);
 *  - it gets past that ceiling only through an allocation probe, which fires when the CAP rises and reaches at most
 *    2× the new cap (probe_controller.cc L223-262, L553-561).
 */
function gcc(capacity: (t: number) => number, initialBps: number) {
  let est = initialBps
  let sent = 0
  let lastCap = 0
  const net: Net = (t, tx) => {
    const room = capacity(t)
    if (lastCap > 0 && tx.cap > lastCap) est = Math.max(est, Math.min(room, 2 * tx.cap))
    lastCap = tx.cap
    if (est > room) est = 0.85 * Math.min(sent, room)
    else if (est < 1.5 * sent + 10_000) est = Math.min(est * 1.08, 1.5 * sent + 10_000)
    const target = Math.min(tx.cap, est)
    sent = target
    return { targetBitrateBps: target, qualityLimitationReason: target < 0.9 * tx.cap ? 'bandwidth' : 'none' }
  }
  return { net, estimate: () => est }
}

// log queries — each returns [t, …] tuples so a failing expectation prints the whole story
const scaled = (log: Logged[]) => log.flatMap((e) => (e.a.type === 'setScaleToHeight' ? [[e.t, e.a.height]] : []))
const capsAt = (log: Logged[], bps: number) => log.flatMap((e) => (e.a.type === 'setCap' && e.a.bps === bps ? [e.t] : []))
const events = (log: Logged[], event: string) => log.flatMap((e) => (e.a.type === 'emit' && e.a.event === event ? [e.t] : []))
const reasons = (log: Logged[], event: string) =>
  log.flatMap((e) => (e.a.type === 'emit' && e.a.event === event ? [[e.t, e.a.reason]] : []))
const codecSwitches = (log: Logged[]) =>
  log.flatMap((e) => (e.a.type === 'switchCodec' ? [[e.t, e.a.codec, e.a.scalabilityMode]] : []))
const actionsAt = (log: Logged[], t: number) => log.filter((e) => e.t === t).map((e) => e.a)
/**
 * A trial start is a setCap alone in its step: a commit re-sends the whole rung (with a resolution), a resume carries
 * resumeVideo, and a failed trial's revert carries its 'trial_failed'.
 */
const trialStarts = (log: Logged[], bps: number) =>
  capsAt(log, bps).filter((t) => !actionsAt(log, t).some((a) =>
    a.type === 'setScaleToHeight' || a.type === 'resumeVideo' || (a.type === 'emit' && a.event === 'trial_failed')))

const CAP720 = 2_000_000
const P720: LadderPlan = { startHeight: 720, maxHeight: 720, cap720Bps: CAP720 }
const P540_UP: LadderPlan = { startHeight: 540, maxHeight: 720, cap720Bps: CAP720 }
const P540_TOP: LadderPlan = { startHeight: 540, maxHeight: 540 }
const P360_UP: LadderPlan = { startHeight: 360, maxHeight: 720, cap720Bps: CAP720 }

// ---------------------------------------------------------------------------
// The review's defect
// ---------------------------------------------------------------------------

describe('one congestion event must not demote a call for good (review-refute-quality.md objection 1)', () => {
  // 720p capped at the plan's cap on a 5 Mbps path; 30 s of 4G congestion at 1.3 Mbps from t=10; then the path is back
  const capacity = (t: number) => (t >= 10 && t < 40 ? 1_300_000 : 5_000_000)

  it('drops R720 → R540 during the congestion and climbs back to R720 once bandwidth returns', () => {
    const model = gcc(capacity, CAP720)
    const estimateAt: number[] = []
    const { log, state } = simulate(P720, {
      seconds: 120,
      net: (t, tx) => {
        const s = model.net(t, tx)
        estimateAt[t] = model.estimate()
        return s
      },
    })
    expect(scaled(log)).toEqual([[13, 540], [54, 720]])
    expect(reasons(log, 'rung_down')).toEqual([[13, 'bandwidth']])
    expect(events(log, 'rung_up')).toEqual([54])
    expect(state.rung).toBe('R720')
    // The proof that a trial was NECESSARY: while capped at 1.2 Mbps the estimate never got past 1.5× the cap, so the
    // old absolute rule (≥ 3 Mbps → 720p) could never have fired. The trial's cap raise is what probed the path.
    const trialAt = trialStarts(log, CAP720).find((t) => t > 40) as number
    expect(trialAt).toBe(51)
    expect(estimateAt[trialAt]).toBeLessThanOrEqual(1.5 * RUNG_SPEC.R540.capBps + 10_000)
    expect(estimateAt[trialAt]).toBeLessThan(3_000_000)
  })

  it('takes the emergency path on a flagship cap (2.5 Mbps: the dip is below half the cap) and still climbs back', () => {
    const { log, state } = simulate({ ...P720, cap720Bps: 2_500_000 }, { seconds: 120, net: gcc(capacity, 2_500_000).net })
    expect(reasons(log, 'rung_down')).toEqual([[11, 'emergency']])
    const heights = scaled(log)
    expect(heights[0]).toEqual([11, 540])
    expect(heights[1][0]).toBeGreaterThan(40)
    expect(heights[1][1]).toBe(720)
    expect(heights).toHaveLength(2)
    expect(state.rung).toBe('R720')
  })
})

describe('a capped sender that is not limited never demotes itself', () => {
  it('stays at R720 for 5 minutes with the target pinned at the cap', () => {
    const { log, state } = simulate(P720, { seconds: 300 })
    expect(log).toEqual([])
    expect(state.rung).toBe('R720')
  })

  it('stays when the target sags to 0.92× the cap every other second (estimator noise above the 0.9 line)', () => {
    const { log } = simulate(P720, { seconds: 300, net: (t, tx) => ({ targetBitrateBps: tx.cap * (t % 2 ? 0.92 : 1) }) })
    expect(log).toEqual([])
  })

  it("stays under GCC's 1.5× ceiling on a roomy path — the estimate can never show more than the cap, and need not", () => {
    const { log } = simulate(P720, { seconds: 300, net: gcc(() => 10_000_000, CAP720).net })
    expect(log).toEqual([])
  })

  it("qualityLimitationReason 'other' neither demotes nor blocks a climb", () => {
    const { log } = simulate(P540_UP, { seconds: 60, net: () => ({ qualityLimitationReason: 'other' }) })
    expect(trialStarts(log, CAP720)).toEqual([12])
    expect(scaled(log)).toEqual([[15, 720]])
  })
})

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

describe('codec: VP8 L1T2 below 360p and on lossy hardware H.264', () => {
  it('sustained loss > 3% for 5 s on hardware H.264 switches to VP8 L1T2, and back to H.264 after 20 s under 1%', () => {
    const { log } = simulate(P540_TOP, { seconds: 60, net: (t) => ({ fractionLost: t < 20 ? 0.05 : 0.005 }) })
    expect(codecSwitches(log)).toEqual([[5, 'VP8', 'L1T2'], [40, 'H264', 'L1T1']])
    expect(scaled(log)).toEqual([]) // a codec switch is not a rung change
  })

  it('does not switch at 3% or below, on a software H.264 encoder, or where the sender cannot switch (Safari)', () => {
    expect(codecSwitches(simulate(P540_TOP, { seconds: 60, net: () => ({ fractionLost: 0.025 }) }).log)).toEqual([])
    expect(codecSwitches(simulate(P540_TOP, { seconds: 60, hw: () => false, net: () => ({ fractionLost: 0.05 }) }).log)).toEqual([])
    expect(codecSwitches(simulate(P540_TOP, { seconds: 60, net: () => ({ fractionLost: 0.05, canSwitchCodec: false }) }).log))
      .toEqual([])
  })

  it('a drop into R240 carries its VP8 switch in the SAME step — one encoder reset, not two', () => {
    const { log } = simulate({ startHeight: 360, maxHeight: 360 }, { seconds: 10, net: link(() => 400_000) })
    expect(scaled(log)).toEqual([[3, 240]])
    expect(actionsAt(log, 3)).toEqual([
      { type: 'setCap', bps: RUNG_SPEC.R240.capBps },
      { type: 'setScaleToHeight', height: 240 },
      { type: 'setMaxFramerate', fps: 15 },
      { type: 'switchCodec', codec: 'VP8', scalabilityMode: 'L1T2' },
      { type: 'emit', event: 'rung_down', reason: 'bandwidth' },
    ])
  })

  it('keeps H.264 at R240 when the sender cannot switch, and keeps AV1 there (already L1T2, and meant for low rates)', () => {
    const plan = { startHeight: 360, maxHeight: 360 }
    const safari = simulate(plan, { seconds: 30, net: link(() => 400_000, () => ({ canSwitchCodec: false })) })
    expect(scaled(safari.log)).toEqual([[3, 240]])
    expect(codecSwitches(safari.log)).toEqual([])
    const av1 = simulate(plan, { seconds: 30, codec: 'AV1', net: link(() => 400_000) })
    expect(scaled(av1.log)).toEqual([[3, 240]])
    expect(codecSwitches(av1.log)).toEqual([])
  })

  it('returns to H.264 only at ≥ R360: 20 s of clean loss at R240 is not enough', () => {
    // 0.4 Mbps drops 360p to 240p (VP8); from t=10 the path carries 1 Mbps, so 240p climbs back to 360p at t=19
    const { log } = simulate({ startHeight: 360, maxHeight: 360 }, { seconds: 60, net: link((t) => (t < 10 ? 400_000 : 1_000_000)) })
    expect(scaled(log)).toEqual([[3, 240], [19, 360]])
    expect(codecSwitches(log)).toEqual([[3, 'VP8', 'L1T2'], [40, 'H264', 'L1T1']])
  })
})

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

describe('CPU limit', () => {
  const cpu: Net = () => ({ qualityLimitationReason: 'cpu' })
  const openH264 = () => false // a software H.264 encoder: no dwell, so the CPU rule's own timing shows

  it("qualityLimitationReason 'cpu' for 10 s steps down one rung, and again after 10 more", () => {
    const { log } = simulate(P720, { seconds: 30, hw: openH264, net: cpu })
    expect(scaled(log)).toEqual([[10, 540], [21, 360]])
    expect(reasons(log, 'rung_down')).toEqual([[10, 'cpu'], [21, 'cpu']])
  })

  it('an AV1 stream switches to H.264 FIRST, and steps down only if the CPU is still the limit 10 s later', () => {
    const { log } = simulate(P720, { seconds: 30, codec: 'AV1', net: cpu })
    expect(codecSwitches(log)).toEqual([[10, 'H264', 'L1T1']])
    // 10 more seconds of 'cpu' ends at t=21, but the hardware H.264 encoder started at t=10: the dwell holds it to t=25
    expect(scaled(log)).toEqual([[25, 540]])
  })

  it('an AV1 sender that cannot switch codec steps down directly', () => {
    const { log } = simulate(P720, { seconds: 15, codec: 'AV1', net: () => ({ qualityLimitationReason: 'cpu', canSwitchCodec: false }) })
    expect(codecSwitches(log)).toEqual([])
    expect(scaled(log)).toEqual([[10, 540]])
  })

  it('parks the abandoned rung for the full 60 s backoff — a trial measures the path and is blind to the encoder', () => {
    const { log } = simulate(P720, { seconds: 90, hw: openH264, net: (t) => ({ qualityLimitationReason: t <= 10 ? 'cpu' : 'none' }) })
    expect(scaled(log)[0]).toEqual([10, 540])
    expect(trialStarts(log, CAP720)).toEqual([71])
  })
})

// ---------------------------------------------------------------------------
// Dwell and emergencies
// ---------------------------------------------------------------------------

// 540p; the path sags to 0.75 Mbps (one step down at t=3), then to 0.5 Mbps — below 360p's line but not an emergency
const sag = (t: number) => (t <= 3 ? 750_000 : 500_000)

describe('dwell: on a hardware encoder resolution changes stay 15 s apart', () => {
  it('holds the second step until 15 s after the first', () => {
    expect(scaled(simulate(P540_TOP, { seconds: 30, net: link(sag) }).log)).toEqual([[3, 360], [18, 240]])
  })

  it('does not hold a software encoder (libvpx changes size without a MediaCodec rebuild)', () => {
    expect(scaled(simulate(P540_TOP, { seconds: 30, codec: 'VP8', net: link(sag) }).log)).toEqual([[3, 360], [7, 240]])
  })

  it('a target that dips below the line for 2 s at a time never steps down — the 3 s hold is the hysteresis', () => {
    const { log } = simulate(P540_TOP, { seconds: 120, net: (t, tx) => ({ targetBitrateBps: t % 4 === 3 ? tx.cap : 0.7 * tx.cap }) })
    expect(log).toEqual([])
  })
})

describe('emergency drops bypass the dwell', () => {
  it('loss > 10% held for 1 s drops at once, inside the dwell', () => {
    const { log } = simulate(P540_TOP, { seconds: 30, net: link(sag, (t) => ({ fractionLost: t === 5 || t === 6 ? 0.15 : 0 })) })
    expect(scaled(log)).toEqual([[3, 360], [6, 240]])
    expect(reasons(log, 'rung_down')).toEqual([[3, 'bandwidth'], [6, 'emergency']])
  })

  it('a target below half the cap held for 1 s drops at once, inside the dwell', () => {
    const { log } = simulate(P540_TOP, { seconds: 30, net: link((t) => (t <= 3 ? 750_000 : 300_000)) })
    expect(scaled(log)).toEqual([[3, 360], [5, 240]])
  })

  it('lands on the rung the target can feed in ONE reset: 720p → 240p when the path collapses to 0.4 Mbps', () => {
    const { log } = simulate({ ...P720, cap720Bps: 2_500_000 }, { seconds: 20, net: link((t) => (t < 5 ? 10_000_000 : 400_000)) })
    expect(scaled(log)).toEqual([[6, 240]])
    expect(actionsAt(log, 6)).toContainEqual({ type: 'switchCodec', codec: 'VP8', scalabilityMode: 'L1T2' })
  })

  it('one noisy RTCP report (a single 20% sample) is not an emergency', () => {
    expect(simulate(P540_TOP, { seconds: 30, net: (t) => ({ fractionLost: t === 5 ? 0.2 : 0 }) }).log).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Pause and resume
// ---------------------------------------------------------------------------

describe('pause below 150 kbps, and resume', () => {
  it('pauses after 5 s under 150 kbps, retries R240 at 200 kbps every 15 s, and resumes once a retry holds 10 s', () => {
    // 100 kbps until t=30, then 1 Mbps: the t=20 retry fails, the t=38 retry holds
    const { log, state, tx } = simulate({ startHeight: 240, maxHeight: 240 }, { seconds: 60, codec: 'VP8', net: link((t) => (t < 30 ? 100_000 : 1_000_000)) })
    expect(reasons(log, 'video_paused')).toEqual([[5, 'starved']])
    expect(log.filter((e) => e.a.type === 'pauseVideo').map((e) => e.t)).toEqual([5, 23])
    expect(log.filter((e) => e.a.type === 'resumeVideo').map((e) => e.t)).toEqual([20, 38])
    expect(actionsAt(log, 20)).toEqual([
      { type: 'resumeVideo' },
      { type: 'setCap', bps: T.resumeCapBps },
      { type: 'setScaleToHeight', height: 240 },
      { type: 'setMaxFramerate', fps: 15 },
    ])
    // the failed retry pauses again WITHOUT a second 'video_paused': the far end never saw 'video_resumed'
    expect(reasons(log, 'trial_failed')).toEqual([[23, 'bandwidth']])
    expect(actionsAt(log, 48)).toEqual([
      { type: 'setCap', bps: RUNG_SPEC.R240.capBps },
      { type: 'setScaleToHeight', height: 240 },
      { type: 'setMaxFramerate', fps: 15 },
      { type: 'emit', event: 'video_resumed', reason: 'trial' },
    ])
    expect(state.rung).toBe('R240')
    expect(tx).toMatchObject({ paused: false, cap: RUNG_SPEC.R240.capBps })
  })

  it('pauses from a higher rung when the path collapses: emergency to R240 first, the pause when starvation reaches 5 s', () => {
    const { log } = simulate(P540_TOP, { seconds: 10, net: link((t) => (t < 2 ? 5_000_000 : 80_000)) })
    expect(scaled(log)).toEqual([[3, 240]])
    expect(events(log, 'video_paused')).toEqual([7])
  })

  it('a retry out of PAUSED on H.264 switches to VP8 in the same step as resumeVideo', () => {
    // the sender can switch only from t=20, so the stream is still H.264 when it pauses at t=5
    const { log } = simulate({ startHeight: 240, maxHeight: 240 }, { seconds: 25, net: link(() => 100_000, (t) => ({ canSwitchCodec: t >= 20 })) })
    expect(events(log, 'video_paused')).toEqual([5])
    expect(codecSwitches(log)).toEqual([[20, 'VP8', 'L1T2']])
    expect(actionsAt(log, 20)[0]).toEqual({ type: 'resumeVideo' })
  })

  it('a call that STARTS at R240 on H.264 moves to VP8 on its first sample (the R240 catch-up rule)', () => {
    expect(codecSwitches(simulate({ startHeight: 240, maxHeight: 240 }, { seconds: 3 }).log)).toEqual([[0, 'VP8', 'L1T2']])
  })
})

// ---------------------------------------------------------------------------
// The plan's ceiling
// ---------------------------------------------------------------------------

describe("never above the plan's maxHeight", () => {
  it('a 540p ceiling never sees a 720p rung, however good the path (5 minutes at 50 Mbps)', () => {
    const { log, state, tx } = simulate({ startHeight: 720, maxHeight: 540, cap720Bps: 2_500_000 }, { seconds: 300, net: link(() => 50_000_000) })
    expect(log).toEqual([])
    expect(state.top).toBe('R540')
    expect(tx).toMatchObject({ height: 540, cap: RUNG_SPEC.R540.capBps })
  })

  it('climbs from 360p to the top and stops there — no height or cap above the plan', () => {
    const { log, state } = simulate(P360_UP, { seconds: 300, net: link(() => 50_000_000) })
    expect(scaled(log)).toEqual([[15, 540], [30, 720]])
    expect(state.rung).toBe('R720')
    for (const e of log) if (e.a.type === 'setCap') expect(e.a.bps).toBeLessThanOrEqual(CAP720)
  })

  it('snaps maxHeight DOWN to a rung: 600 → R540, 1080 → R720, 100 → no rung at all (no video, like codec-plan)', () => {
    expect(createLadder({ startHeight: 540, maxHeight: 600 }).state.top).toBe('R540')
    expect(createLadder({ startHeight: 1080, maxHeight: 1080 }).state).toMatchObject({ top: 'R720', rung: 'R720' })
    expect(createLadder({ startHeight: 540, maxHeight: 100 })).toMatchObject({ state: { rung: 'PAUSED', resumeAt: null }, actions: [{ type: 'pauseVideo' }] })
  })

  it("clamps the plan's R720 cap into 1.7–2.5 Mbps, and falls back to a 540p start on a nonsense plan", () => {
    const capOf = (cap720Bps?: number) => createLadder({ startHeight: 720, maxHeight: 720, cap720Bps }).actions[0]
    expect(capOf(9_000_000)).toEqual({ type: 'setCap', bps: 2_500_000 })
    expect(capOf(1_000_000)).toEqual({ type: 'setCap', bps: 1_700_000 })
    expect(capOf(undefined)).toEqual({ type: 'setCap', bps: 1_700_000 })
    expect(createLadder({ startHeight: NaN, maxHeight: NaN })).toEqual({
      state: expect.objectContaining({ rung: 'R540', top: 'R540' }),
      actions: [
        { type: 'setCap', bps: 1_200_000 },
        { type: 'setScaleToHeight', height: 540 },
        { type: 'setMaxFramerate', fps: 30 },
      ],
    })
  })
})

// ---------------------------------------------------------------------------
// Trials: backoff, probation, verdicts
// ---------------------------------------------------------------------------

describe('trial backoff', () => {
  it('doubles after each failed trial, capped at 60 s: trials at 12, 39, 90, 153, 216 s', () => {
    // the path carries 1.3 Mbps: 540p is fine, 720p's 2 Mbps never reaches 0.8× (1.6 Mbps)
    const { log } = simulate(P540_UP, { seconds: 230, net: link(() => 1_300_000) })
    expect(trialStarts(log, CAP720)).toEqual([12, 39, 90, 153, 216])
    expect(reasons(log, 'trial_failed')).toEqual([[15, 'bandwidth'], [42, 'bandwidth'], [93, 'bandwidth'], [156, 'bandwidth'], [219, 'bandwidth']])
    expect(scaled(log)).toEqual([]) // failed trials never spend an IDR
  })

  it('a climb that does not hold counts as a failed trial: the flap decays instead of repeating', () => {
    // 1.7 Mbps passes 720p's trial (≥ 1.6) and then trips its step-down line (< 1.8) — the 0.8/0.9 dead band
    const climbs = events(simulate(P540_UP, { seconds: 300, net: link(() => 1_700_000) }).log, 'rung_up')
    expect(climbs).toEqual([15, 58, 125, 204, 283])
    const gaps = climbs.slice(1).map((t, i) => t - climbs[i])
    expect(gaps).toEqual([43, 67, 79, 79]) // grows with the backoff, then sits at its 60 s cap
  })

  it('is per rung: failing to reach R720 does not slow the climb back to R540 after a drop', () => {
    // 1.3 Mbps (720p trials fail, its backoff reaches 60 s), a 10 s dip to 0.62 Mbps (540p → 360p), then 1.3 Mbps again
    const capacity = (t: number) => (t >= 100 && t < 110 ? 620_000 : 1_300_000)
    const { log } = simulate(P540_UP, { seconds: 190, net: link(capacity) })
    expect(scaled(log)).toEqual([[103, 360], [125, 540]])
    expect(trialStarts(log, RUNG_SPEC.R540.capBps)).toEqual([122]) // 12 s after the path came back, not 60
    expect(trialStarts(log, CAP720)).toEqual([12, 39, 90, 185]) // while R720 keeps its 60 s backoff
  })
})

describe('climb probation', () => {
  it('a climb that HOLDS through its 30 s probation resets its rung to the 12 s backoff', () => {
    // 720p trials fail until t=50 (backoff reaches 48 s); the t=90 trial passes; 720p holds past its probation;
    // a dip at t=130 drops it; the next climb comes 12 s after the dip ends — not 48
    const capacity = (t: number) => (t < 50 || (t >= 130 && t < 140) ? 1_300_000 : 5_000_000)
    const { log } = simulate(P540_UP, { seconds: 160, net: link(capacity) })
    expect(trialStarts(log, CAP720)).toEqual([12, 39, 90, 146])
    expect(scaled(log)).toEqual([[93, 720], [133, 540], [149, 720]])
  })
})

describe('trial verdicts', () => {
  const trialRtt = (base: number, during: number): Net => (_t, tx) => ({ rttMs: tx.cap > RUNG_SPEC.R540.capBps ? during : base })

  it('keeps a climb whose RTT moves with jitter (15 → 22 ms): a bare +30% rule would have failed it', () => {
    expect(scaled(simulate(P540_UP, { seconds: 20, net: trialRtt(15, 22) }).log)).toEqual([[15, 720]])
  })

  it('reverts a climb whose mean RTT rises past 30% + slack (100 → 145 ms), and doubles the backoff', () => {
    const { log } = simulate(P540_UP, { seconds: 40, net: trialRtt(100, 145) })
    expect(reasons(log, 'trial_failed')[0]).toEqual([15, 'rtt'])
    expect(trialStarts(log, CAP720)).toEqual([12, 39])
    expect(scaled(log)).toEqual([])
  })

  it('reverts a climb when its mean loss reaches 2%', () => {
    const { log } = simulate(P540_UP, { seconds: 20, net: (_t, tx) => ({ fractionLost: tx.cap > RUNG_SPEC.R540.capBps ? 0.03 : 0 }) })
    expect(reasons(log, 'trial_failed')).toEqual([[15, 'loss']])
  })

  it('a failed trial never reads as an emergency, even when the sender reports the trial cap a sample late', () => {
    // 1.2 Mbps path, 2.5 Mbps trial cap: against the RAISED cap the target (1.2) sits below half of it (1.25) for the
    // whole trial, and the revert's lagging sample would then "confirm" an emergency that never happened
    const { log } = simulate({ startHeight: 540, maxHeight: 720, cap720Bps: 2_500_000 }, { seconds: 60, lagCap: true, net: link(() => 1_200_000) })
    // 44, not 42: the lagging sample at t=16 still shows the trial cap, so stability restarts at t=17 (+24 s backoff)
    expect(events(log, 'trial_failed').slice(0, 2)).toEqual([15, 44])
    expect(scaled(log)).toEqual([])
    expect(events(log, 'rung_down')).toEqual([])
  })

  it('an emergency inside a trial reverts the cap at once — no IDR spent — and drops nothing if it clears', () => {
    const { log } = simulate(P540_UP, { seconds: 30, net: (t) => ({ fractionLost: t === 13 ? 0.15 : 0 }) })
    expect(reasons(log, 'trial_failed')).toEqual([[13, 'emergency']])
    expect(actionsAt(log, 13)).toContainEqual({ type: 'setCap', bps: RUNG_SPEC.R540.capBps })
    expect(scaled(log)).toEqual([])
  })

  it('a software encoder without CPU headroom for the next rung never starts a trial; a hardware one is not judged by it', () => {
    const plan = { startHeight: 360, maxHeight: 540 }
    const r540 = RUNG_SPEC.R540.capBps
    // VP8 at 360p taking 30 ms/frame → ≈2.0× the 540p30 frame interval: no trial
    expect(trialStarts(simulate(plan, { seconds: 60, codec: 'VP8', net: () => ({ encodeMsPerFrame: 30 }) }).log, r540)).toEqual([])
    // 8 ms/frame → ≈0.54: room to climb
    expect(trialStarts(simulate(plan, { seconds: 60, codec: 'VP8', net: () => ({ encodeMsPerFrame: 8 }) }).log, r540)).toEqual([12])
    // a hardware encoder's 30 ms is pipeline latency, not load
    expect(trialStarts(simulate(plan, { seconds: 60, net: () => ({ encodeMsPerFrame: 30 }) }).log, r540)).toEqual([12])
  })
})

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('robustness', () => {
  it('a stats gap restarts every hold: two samples 10 s apart are not "3 s below the line"', () => {
    const { log } = simulate(P540_TOP, { ticks: [0, 10, 11, 12, 13, 14], net: link(() => 700_000) })
    expect(scaled(log)).toEqual([[13, 360]])
  })

  it('a clock that runs backwards counts as a gap (without the guard the holds would sit at a negative age)', () => {
    const { log } = simulate(P540_TOP, { ticks: [10, 11, 12, 0, 1, 2, 3], net: link(() => 700_000) })
    expect(scaled(log)).toEqual([[3, 360]])
  })

  it('a gap calls a trial off without penalty: the cap reverts, no trial_failed, the backoff does not double', () => {
    const { log } = simulate(P540_UP, { ticks: [...range(0, 12), ...range(20, 40)] })
    expect(actionsAt(log, 20)).toEqual([{ type: 'setCap', bps: RUNG_SPEC.R540.capBps }])
    expect(events(log, 'trial_failed')).toEqual([])
    expect(trialStarts(log, CAP720)).toEqual([12, 32])
  })

  it('camera off: the ladder holds still whatever the stats say', () => {
    const { log } = simulate(P540_TOP, { seconds: 60, net: () => ({ videoEnabled: false, targetBitrateBps: 50_000, fractionLost: 0.3 }) })
    expect(log).toEqual([])
  })

  it('camera off mid-trial reverts the cap, and the climb starts over once the camera is back', () => {
    const { log } = simulate(P540_UP, { seconds: 40, net: (t) => ({ videoEnabled: !(t >= 13 && t < 20) }) })
    expect(actionsAt(log, 13)).toEqual([{ type: 'setCap', bps: RUNG_SPEC.R540.capBps }])
    expect(trialStarts(log, CAP720)).toEqual([12, 32])
  })

  it('unknown is not zero: a NaN target never steps down, a missing loss never climbs, a missing RTT is skipped', () => {
    expect(simulate(P540_UP, { seconds: 60, net: () => ({ targetBitrateBps: NaN }) }).log).toEqual([])
    expect(simulate(P540_UP, { seconds: 60, net: () => ({ fractionLost: NaN }) }).log).toEqual([])
    expect(scaled(simulate(P540_UP, { seconds: 20, net: () => ({ rttMs: NaN }) }).log)).toEqual([[15, 720]])
  })

  it('a NaN clock decides nothing', () => {
    const { state } = createLadder(P540_TOP)
    const sample: LadderSample = {
      targetBitrateBps: 0, currentCapBps: 1_200_000, qualityLimitationReason: 'bandwidth', fractionLost: 0.5, rttMs: 50,
      fps: 30, frameHeight: 540, encodeMsPerFrame: 5, codec: 'H264', hardwareEncoder: true, canSwitchCodec: true, videoEnabled: true,
    }
    expect(step(state, sample, NaN)).toEqual({ state, actions: [] })
  })

  it('never mutates the state it is given (deep-frozen input, every rule exercised)', () => {
    const deepFreeze = <V>(v: V): V => {
      if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
        Object.freeze(v)
      }
      return v
    }
    let { state } = createLadder(P540_UP)
    // climb, congest, starve, recover — trials, step-downs, pause and resume all run on frozen inputs
    const capacity = (t: number) => (t < 20 ? 5_000_000 : t < 40 ? 100_000 : 5_000_000)
    const seen = new Set<string>()
    for (let t = 0; t <= 90; t++) {
      const prev = deepFreeze(state)
      const sample = deepFreeze<LadderSample>({
        targetBitrateBps: Math.min(capacity(t), 2_000_000), currentCapBps: 2_000_000, qualityLimitationReason: 'none',
        fractionLost: 0, rttMs: 40, fps: 30, frameHeight: 540, encodeMsPerFrame: 5, codec: 'H264', hardwareEncoder: true,
        canSwitchCodec: true, videoEnabled: true,
      })
      const next = step(prev, sample, t * 1000)
      expect(next.state).not.toBe(prev)
      for (const a of next.actions) seen.add(a.type === 'emit' ? a.event : a.type)
      state = next.state
    }
    // the claim above, pinned: the frozen run really went through every kind of move
    for (const kind of ['rung_up', 'rung_down', 'switchCodec', 'pauseVideo', 'video_paused', 'resumeVideo', 'video_resumed']) {
      expect(seen).toContain(kind)
    }
    expect(JSON.parse(JSON.stringify(state))).toEqual(state) // plain JSON: replayable from telemetry
  })
})
