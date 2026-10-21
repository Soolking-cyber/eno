/**
 * Adversarial review of the video ladder (ladder.ts), written by the reviewer against the module spec, DESIGN.md v3 §2
 * and review-refute-quality.md objections 1–4. ladder.test.ts drives every trace with NOISELESS stats: loss 0, the
 * target pinned at the cap. Real getStats is not like that. fractionLost is one RTCP receiver report: an 8-bit
 * fixed-point fraction (truncated) of the few dozen packets sent since the last report. So at 300 kbps (~31 packets/s)
 * ONE lost packet reads as 8/256 = 3.1%, and at 360p (~73 packets/s) as 3/256 = 1.17%. Most traces below therefore feed
 * the ladder reports quantized the way an RR quantizes them (`rr`), and they pin the defects that show up only then.
 * The rest pins spec boundaries the original suite leaves untested and invariants under hostile input.
 */
import { describe, expect, it } from 'vitest'
import type { CodecName } from './types'
import {
  createLadder, step, LADDER_TUNING as T, RUNG_SPEC, VIDEO_RUNGS,
  type LadderAction, type LadderPlan, type LadderSample, type LadderState, type VideoRung,
} from './ladder'

// ---------------------------------------------------------------------------
// Harness — the sender model applies the ladder's actions the way the engine would
// ---------------------------------------------------------------------------

interface Tx { cap: number; height: number; fps: number; codec: CodecName; paused: boolean }
type Net = (t: number, tx: Tx) => Partial<LadderSample>
type Logged = { i: number; t: number; a: LadderAction }

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

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

/** One sample per tick (seconds; ticks may jump or run backwards). Default: a clean path, target pinned at the cap. */
function simulate(plan: LadderPlan, o: { seconds?: number; ticks?: number[]; net?: Net; codec?: CodecName; hw?: (c: CodecName) => boolean } = {}) {
  const init = createLadder(plan)
  let state: LadderState = init.state
  const tx: Tx = { cap: 0, height: 0, fps: 0, codec: o.codec ?? 'H264', paused: false }
  apply(tx, init.actions)
  const hw = o.hw ?? ((c: CodecName) => c === 'H264')
  const log: Logged[] = []
  ;(o.ticks ?? range(0, o.seconds ?? 60)).forEach((t, i) => {
    const sample: LadderSample = {
      targetBitrateBps: tx.paused ? 0 : tx.cap,
      currentCapBps: tx.cap,
      qualityLimitationReason: 'none',
      fractionLost: 0,
      rttMs: 50,
      fps: tx.fps,
      frameHeight: tx.height,
      encodeMsPerFrame: 5,
      codec: tx.codec,
      hardwareEncoder: hw(tx.codec),
      canSwitchCodec: true,
      videoEnabled: true,
      ...o.net?.(t, tx),
    }
    const r = step(state, sample, t * 1000)
    state = r.state
    apply(tx, r.actions)
    for (const a of r.actions) log.push({ i, t, a })
  })
  return { init, state, tx, log }
}

const link = (capacity: (t: number) => number, extra?: Net): Net => (t, tx) => ({
  targetBitrateBps: tx.paused ? 0 : Math.min(tx.cap, capacity(t)),
  ...extra?.(t, tx),
})

/** review-refute-quality.md's estimator, as in ladder.test.ts: 1.5× ceiling, 0.85 backoff, probes only on a cap raise. */
function gcc(capacity: (t: number) => number, initialBps: number): Net {
  let est = initialBps
  let sent = 0
  let lastCap = 0
  return (t, tx) => {
    const room = capacity(t)
    if (lastCap > 0 && tx.cap > lastCap) est = Math.max(est, Math.min(room, 2 * tx.cap))
    lastCap = tx.cap
    if (est > room) est = 0.85 * Math.min(sent, room)
    else if (est < 1.5 * sent + 10_000) est = Math.min(est * 1.08, 1.5 * sent + 10_000)
    const target = Math.min(tx.cap, est)
    sent = target
    return { targetBitrateBps: target, qualityLimitationReason: target < 0.9 * tx.cap ? 'bandwidth' : 'none' }
  }
}

/** fractionLost exactly as an RTCP receiver report carries it: floor(lost × 256 / expected) / 256. */
const rr = (lost: number, expected: number) => Math.floor((lost * 256) / expected) / 256
/** Packets per second at a bitrate (~1200-byte packets). */
const pps = (bps: number) => Math.max(1, Math.round(bps / 8 / 1200))

/** Deterministic PRNG (mulberry32) so the noisy traces are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const scaled = (log: Logged[]) => log.flatMap((e) => (e.a.type === 'setScaleToHeight' ? [[e.t, e.a.height]] : []))
const events = (log: Logged[], event: string) => log.flatMap((e) => (e.a.type === 'emit' && e.a.event === event ? [e.t] : []))
const reasons = (log: Logged[], event: string) =>
  log.flatMap((e) => (e.a.type === 'emit' && e.a.event === event ? [[e.t, e.a.reason]] : []))
const codecSwitches = (log: Logged[]) =>
  log.flatMap((e) => (e.a.type === 'switchCodec' ? [[e.t, e.a.codec, e.a.scalabilityMode]] : []))
const actionsAtIndex = (log: Logged[], i: number) => log.filter((e) => e.i === i).map((e) => e.a)
/** A trial start: a setCap alone in its step (a commit carries a height, a resume resumeVideo, a revert 'trial_failed'). */
const trialStarts = (log: Logged[], bps: number) =>
  log.flatMap((e) => (e.a.type === 'setCap' && e.a.bps === bps ? [e] : []))
    .filter((e) => !actionsAtIndex(log, e.i).some((a) =>
      a.type === 'setScaleToHeight' || a.type === 'resumeVideo' || (a.type === 'emit' && a.event === 'trial_failed')))
    .map((e) => e.t)

const CAP720 = 2_000_000
const P540_UP: LadderPlan = { startHeight: 540, maxHeight: 720, cap720Bps: CAP720 }
const P540_TOP: LadderPlan = { startHeight: 540, maxHeight: 540 }
const P360_UP: LadderPlan = { startHeight: 360, maxHeight: 720, cap720Bps: CAP720 }

// ---------------------------------------------------------------------------
// DEFECT 1 — the climb precondition read loss one report at a time
// ---------------------------------------------------------------------------

describe('DEFECT 1: one lost packet must not stall the climb', () => {
  // `stable` (the run that must last the next rung's 12–60 s backoff before a trial) broke on ANY report with loss
  // ≥ 2%. With RR quantization a lost packet at 300 kbps is 3.1%, so the climb needed 12–60 s of ZERO loss: on a 1%
  // random-loss 4G link the mean wait for a 24 s run is ~1.7 h and for a 60 s run longer than any call. That is the
  // review's key defect (one congestion event demotes a call for good) coming back through the loss input.

  it('climbs R540 → R720 on a roomy path whose RTCP shows one 2.3% report every 7 s (mean loss 0.33%)', () => {
    const blip = rr(3, pps(1_200_000)) // 3 of 125 packets → 6/256
    expect(blip).toBeGreaterThanOrEqual(T.trialMaxLoss)
    const { log, state } = simulate(P540_UP, { seconds: 60, net: (t) => ({ fractionLost: t % 7 === 3 ? blip : 0 }) })
    expect(scaled(log)).toEqual([[15, 720]])
    expect(state.rung).toBe('R720')
  })

  it('climbs R240 → R360 at 300 kbps, where ONE lost packet reads as 3.1%, lost once every 5 s (mean 0.6%)', () => {
    const onePacket = rr(1, pps(300_000))
    expect(onePacket).toBe(8 / 256)
    const { log } = simulate({ startHeight: 240, maxHeight: 360 }, {
      seconds: 60, codec: 'VP8', net: (t) => ({ fractionLost: t % 5 === 2 ? onePacket : 0 }),
    })
    expect(scaled(log)).toEqual([[15, 360]])
  })

  it('the headline trace with real RTCP: one 4G congestion event at R720, then the path is back with a 2.3% report every 7 s — climbs back', () => {
    const capacity = (t: number) => (t >= 10 && t < 40 ? 1_300_000 : 5_000_000)
    const blip = rr(3, pps(1_200_000))
    const congestion = gcc(capacity, CAP720)
    const { log, state } = simulate({ startHeight: 720, maxHeight: 720, cap720Bps: CAP720 }, {
      seconds: 120, net: (t, tx) => ({ ...congestion(t, tx), fractionLost: t % 7 === 3 ? blip : 0 }),
    })
    expect(reasons(log, 'rung_down')).toEqual([[13, 'bandwidth']])
    expect(events(log, 'rung_up')).toHaveLength(1)
    expect(state.rung).toBe('R720')
  })

  // Random packet loss at rate p, each report quantized like an RR, over 200 fixed seeds: a population, not a lucky seed
  // (seed 20261021 happened to climb even before the fix; 180 of 200 seeds did not).
  const randomLoss = (seed: number, p: number): Net => {
    const rand = mulberry32(seed)
    return (_t, tx) => {
      const n = pps(tx.paused ? 0 : tx.cap)
      let lost = 0
      for (let k = 0; k < n; k++) if (rand() < p) lost++
      return { fractionLost: rr(lost, n) }
    }
  }
  const seeds = range(1, 200)
  const R240_UP: LadderPlan = { startHeight: 240, maxHeight: 540 }

  it('1% random packet loss on a roomy path: a call at R240 is back at R540 within 90 s in ≥ 95% of 200 seeds (before: 10%)', () => {
    const back = seeds.filter((seed) => simulate(R240_UP, { seconds: 90, codec: 'VP8', net: randomLoss(seed, 0.01) }).state.rung === 'R540')
    expect(back.length).toBeGreaterThanOrEqual(190)
  })

  it('…while at 4% random loss (twice the trial line) a call at R240 stays there for 5 minutes in ≥ 95% of seeds', () => {
    const stayed = seeds.filter((seed) => simulate(R240_UP, { seconds: 300, codec: 'VP8', net: randomLoss(seed, 0.04) }).state.rung === 'R240')
    expect(stayed.length).toBeGreaterThanOrEqual(190)
  })

  it('…while a link that really loses ≥ 2% never starts a trial (steady 3%, or 4% every other report)', () => {
    const steady = simulate(P540_UP, { seconds: 120, net: () => ({ fractionLost: 0.03 }) })
    expect(trialStarts(steady.log, CAP720)).toEqual([])
    const alternating = simulate(P540_UP, { seconds: 120, net: (t) => ({ fractionLost: t % 2 ? 0 : 0.04 }) })
    expect(trialStarts(alternating.log, CAP720)).toEqual([])
  })

  it('a bad report as the FIRST sample of a run costs that one sample, not the run', () => {
    // a lost packet at t = 0, 5, 10, …: the run starts at t=1, the trial at 13 (its window 14–16 holds one blip, mean 1%)
    const onePacket = rr(1, pps(300_000))
    const { log } = simulate({ startHeight: 240, maxHeight: 360 }, {
      seconds: 40, codec: 'VP8', net: (t) => ({ fractionLost: t % 5 === 0 ? onePacket : 0 }),
    })
    expect(trialStarts(log, RUNG_SPEC.R360.capBps)).toEqual([13])
    expect(scaled(log)).toEqual([[16, 360]])
  })

  it('an unknown loss still never climbs, and one unknown report does not void a run already under way', () => {
    expect(simulate(P540_UP, { seconds: 60, net: () => ({ fractionLost: NaN }) }).log).toEqual([])
    // a NaN report at t=6 restarts the run at t=7 → trial at 19, climb at 22
    const { log } = simulate(P540_UP, { seconds: 40, net: (t) => ({ fractionLost: t === 6 ? NaN : 0 }) })
    expect(scaled(log)).toEqual([[22, 720]])
  })
})

// ---------------------------------------------------------------------------
// DEFECT 2 — the way back to hardware H.264 read loss one report at a time
// ---------------------------------------------------------------------------

describe('DEFECT 2: the way back to hardware H.264 must survive single lost packets', () => {
  // `clean` (loss < 1% for 20 s → back to H.264) broke on every report ≥ 1%. At 360p (~73 packets/s) that is ONE lost
  // packet, so a link losing 0.5% needed 21 consecutive loss-free reports (mean wait ~1.9 h): a stream moved to software
  // VP8 for a lossy minute stayed on it for the rest of the call — the heat and battery the hardware path exists to save.

  it('returns to H.264 20 s after the loss clears at R360, although a lone lost packet (1.17%) shows every 6 s', () => {
    const single = rr(1, pps(700_000))
    expect(single).toBe(3 / 256)
    const { log } = simulate({ startHeight: 360, maxHeight: 360 }, {
      seconds: 90, net: (t) => ({ fractionLost: t < 20 ? 0.05 : t % 6 === 0 ? single : 0 }),
    })
    expect(codecSwitches(log)).toEqual([[5, 'VP8', 'L1T2'], [40, 'H264', 'L1T1']])
  })

  it('…while a link that really loses ≥ 1% stays on VP8', () => {
    const { log } = simulate({ startHeight: 360, maxHeight: 360 }, {
      seconds: 120, net: (t) => ({ fractionLost: t < 20 ? 0.05 : 0.012 }),
    })
    expect(codecSwitches(log)).toEqual([[5, 'VP8', 'L1T2']])
  })

  it('a step-down in the middle of the clean run does not restart it: loss is a fact about the path, not the rung', () => {
    // VP8 from t=5; loss clears at 20; a sag at 30 steps VP8 (software, no dwell) R540 → R360 at 33; back to H.264 at 40
    const { log } = simulate(P540_TOP, {
      seconds: 60, net: link((t) => (t >= 30 ? 750_000 : 5_000_000), (t) => ({ fractionLost: t < 20 ? 0.05 : 0 })),
    })
    expect(scaled(log)).toEqual([[33, 360]])
    expect(codecSwitches(log)).toEqual([[5, 'VP8', 'L1T2'], [40, 'H264', 'L1T1']])
  })

  it('a trial’s own lossy samples never count against the stable run that follows it (the backoff alone sets the pace)', () => {
    const { log } = simulate(P540_UP, { seconds: 100, net: (_t, tx) => ({ fractionLost: tx.cap > RUNG_SPEC.R540.capBps ? 0.03 : 0 }) })
    expect(trialStarts(log, CAP720)).toEqual([12, 39, 90])
    expect(reasons(log, 'trial_failed').map(([, r]) => r)).toEqual(['loss', 'loss', 'loss'])
  })

  it('the VP8 switch itself still ignores one bad report (it reads every report, so a blip cannot trigger it)', () => {
    const { log } = simulate(P540_TOP, { seconds: 60, net: (t) => ({ fractionLost: t === 5 ? 0.6 : 0 }) })
    expect(codecSwitches(log)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DEFECT 3 — a clock that runs backwards left deadlines in the old timebase
// ---------------------------------------------------------------------------

describe('DEFECT 3: a clock that runs backwards must not strand deadlines in the old timebase', () => {
  // The header promises a backwards clock is treated like a gap. The HOLD timers were reset, but resumeAt, lastResetAt,
  // lastClimb.at and pendingCodec.at kept the old clock: after a jump back by N seconds a paused video stayed paused,
  // and the hardware dwell blocked every non-emergency move, for N seconds.

  it('a paused video still retries 15 s after it paused when the clock restarts from 0', () => {
    // paused at 1005 (retry due 1020); the clock restarts at 0 after 1010, with 10 of the 15 s served
    const ticks = [...range(1000, 1010), ...range(0, 30)]
    const { log } = simulate({ startHeight: 240, maxHeight: 240 }, { ticks, codec: 'VP8', net: link(() => 100_000) })
    expect(events(log, 'video_paused')).toEqual([1005])
    const resumes = log.filter((e) => e.a.type === 'resumeVideo').map((e) => [e.i, e.t])
    expect(resumes[0]).toEqual([21, 10])
  })

  it('the 15 s hardware dwell keeps its remaining length after the jump, not the old clock’s thousand seconds', () => {
    // R540 steps down at 1003 (750 kbps); the clock restarts at 0 and the path sags below R360's line (500 kbps)
    const ticks = [...range(1000, 1003), ...range(0, 30)]
    const { log } = simulate(P540_TOP, { ticks, net: link((t) => (t >= 1000 ? 750_000 : 500_000)) })
    expect(scaled(log)).toEqual([[1003, 360], [15, 240]])
  })

  it('a climb’s probation ends 30 s after it in the new timebase too (left in the old one, every later drop doubled the backoff)', () => {
    // software VP8 (no dwell): R720 passes at 1015; the clock restarts at 0 after 1020 (the climb is now 5 s in the past);
    // a 10 s dip at 40–50 drops it at 43 — 48 s after the climb, so no penalty: the next R720 trial is 12 s on, at 56
    const ticks = [...range(1000, 1020), ...range(0, 80)]
    const { log } = simulate(P540_UP, {
      ticks, codec: 'VP8', hw: () => false, net: link((t) => (t >= 40 && t < 50 ? 1_300_000 : 5_000_000)),
    })
    expect(scaled(log)).toEqual([[1015, 720], [43, 540], [59, 720]])
    expect(trialStarts(log, CAP720).filter((t) => t < 1000)).toEqual([56])
  })

  it('a codec switch that never shows up in the stats is given up 3 s after it in the new timebase too, and retried', () => {
    // software H.264 at R240: the catch-up asks for VP8 at 1000, the sender silently stays on H.264, the clock restarts
    const ticks = [1000, 1001, ...range(0, 10)]
    const { log } = simulate({ startHeight: 240, maxHeight: 240 }, { ticks, hw: () => false, net: () => ({ codec: 'H264' }) })
    expect(codecSwitches(log)).toEqual([[1000, 'VP8', 'L1T2'], [2, 'VP8', 'L1T2'], [5, 'VP8', 'L1T2'], [8, 'VP8', 'L1T2']])
  })
})

// ---------------------------------------------------------------------------
// DEFECT 4 — a maxHeight below the lowest rung still sent 240p
// ---------------------------------------------------------------------------

describe("DEFECT 4: never above the plan's maxHeight, even below the lowest rung", () => {
  // snapDown floored at R240, so maxHeight 180 (or 0) sent 240p: above the plan, and contrary to codec-plan, which
  // plans NO video for a direction that cannot take 240p (PLAN_MIN_HEIGHT). The header itself said "never exceed it".

  it('maxHeight 180 → video paused from the start, never retried, no frame taller than 180', () => {
    const { init, log, tx, state } = simulate({ startHeight: 240, maxHeight: 180 }, { seconds: 120, codec: 'VP8', net: link(() => 5_000_000) })
    expect(init.actions).toEqual([{ type: 'pauseVideo' }])
    expect(log.filter((e) => e.a.type === 'setScaleToHeight' || e.a.type === 'resumeVideo')).toEqual([])
    expect(tx.paused).toBe(true)
    expect(state.rung).toBe('PAUSED')
  })

  it('maxHeight 0 is no video too; exactly 240 is still R240', () => {
    expect(createLadder({ startHeight: 240, maxHeight: 0 }).actions).toEqual([{ type: 'pauseVideo' }])
    expect(createLadder({ startHeight: 240, maxHeight: 240 }).state).toMatchObject({ rung: 'R240', top: 'R240' })
  })
})

// ---------------------------------------------------------------------------
// DEFECT 5 — a rung left upward while on probation kept a stale backoff
// ---------------------------------------------------------------------------

describe('DEFECT 5: climbing on from a rung still on probation proves that rung held', () => {
  // A pass only opens a 30 s probation; the backoff resets when the climb has held. Climbing on from that rung
  // overwrote lastClimb, so its probation was silently dropped: neither failed nor passed, and the rung kept the
  // backoff its earlier failures had built (60 s), although it had just carried its cap stably and passed a trial.

  it("R540's 60 s backoff does not survive a climb through it to R720", () => {
    // t < 100: 0.9 Mbps — R360 holds, R540 trials fail (backoff 60 s). Then 50 Mbps: R540 passes at 156, R720 at 171
    // (R540 left upward 15 s into its probation). 205–215: 0.65 Mbps — an emergency lands R720 on R360. Then 50 Mbps.
    const capacity = (t: number) => (t < 100 ? 900_000 : t >= 205 && t < 215 ? 650_000 : 50_000_000)
    const { log } = simulate(P360_UP, { seconds: 260, net: link(capacity) })
    expect(scaled(log).slice(0, 3)).toEqual([[156, 540], [171, 720], [206, 360]])
    // R540's own 12 s backoff (from the stable run starting at 207), not the 60 s it had before it held
    expect(trialStarts(log, RUNG_SPEC.R540.capBps).filter((t) => t > 206)).toEqual([219])
  })
})

// ---------------------------------------------------------------------------
// DEFECT 6 — an impossible fractionLost was clamped to 100% loss
// ---------------------------------------------------------------------------

describe('DEFECT 6: an impossible fractionLost is unknown, not 100% loss', () => {
  // An RR's fraction can never exceed 255/256. A value above 1 is a units or counter bug in the engine; clamping it to
  // 1 turned the bug into "100% loss": an emergency drop every couple of seconds and no climb ever again.

  it('fractionLost 1.5 (or 5, a percent passed by mistake) moves nothing', () => {
    expect(simulate(P540_TOP, { seconds: 30, hw: () => false, net: () => ({ fractionLost: 1.5 }) }).log).toEqual([])
    expect(simulate(P540_UP, { seconds: 30, net: () => ({ fractionLost: 5 }) }).log).toEqual([])
  })

  it('the largest fraction an RR can carry (255/256) is still a real emergency', () => {
    const { log } = simulate(P540_TOP, { seconds: 5, hw: () => false, net: () => ({ fractionLost: 255 / 256 }) })
    expect(reasons(log, 'rung_down')[0]).toEqual([1, 'emergency'])
  })
})

// ---------------------------------------------------------------------------
// Spec boundaries the original suite does not pin
// ---------------------------------------------------------------------------

describe('spec boundaries: strict vs inclusive thresholds', () => {
  it('target exactly 0.9 × cap never steps down; one bit/s less steps down after 3 s (four ~1 s samples)', () => {
    const at = (delta: number) => simulate(P540_TOP, { seconds: 10, net: (_t, tx) => ({ targetBitrateBps: tx.cap * 0.9 + delta }) })
    expect(at(0).log).toEqual([])
    expect(scaled(at(-1).log)).toEqual([[3, 360]])
  })

  it("qualityLimitationReason 'bandwidth' alone (target at the cap) steps down after 3 s; a 2 s burst does not", () => {
    const held = simulate(P540_TOP, { seconds: 10, net: () => ({ qualityLimitationReason: 'bandwidth' }) })
    expect(reasons(held.log, 'rung_down')).toEqual([[3, 'bandwidth']])
    const bursts = simulate(P540_TOP, { seconds: 60, net: (t) => ({ qualityLimitationReason: t % 4 === 3 ? 'none' : 'bandwidth' }) })
    expect(bursts.log).toEqual([])
  })

  it('a trial target of exactly 0.8 × the new cap passes; one bit/s less fails', () => {
    const pass = simulate(P540_UP, { seconds: 16, net: link(() => 0.8 * CAP720) })
    expect(events(pass.log, 'rung_up')).toEqual([15])
    const fail = simulate(P540_UP, { seconds: 16, net: link(() => 0.8 * CAP720 - 1) })
    expect(reasons(fail.log, 'trial_failed')).toEqual([[15, 'bandwidth']])
  })

  it('trial mean loss exactly 2% fails; just under passes', () => {
    const lossInTrial = (loss: number): Net => (_t, tx) => ({ fractionLost: tx.cap > RUNG_SPEC.R540.capBps ? loss : 0 })
    expect(reasons(simulate(P540_UP, { seconds: 16, net: lossInTrial(0.02) }).log, 'trial_failed')).toEqual([[15, 'loss']])
    expect(events(simulate(P540_UP, { seconds: 16, net: lossInTrial(0.0199) }).log, 'rung_up')).toEqual([15])
  })

  it('trial RTT exactly baseline × 1.3 + 10 ms passes; above it fails', () => {
    const rttInTrial = (during: number): Net => (_t, tx) => ({ rttMs: tx.cap > RUNG_SPEC.R540.capBps ? during : 100 })
    expect(events(simulate(P540_UP, { seconds: 16, net: rttInTrial(140) }).log, 'rung_up')).toEqual([15])
    expect(reasons(simulate(P540_UP, { seconds: 16, net: rttInTrial(140.5) }).log, 'trial_failed')).toEqual([[15, 'rtt']])
  })

  it('loss exactly 3% never moves hardware H.264 to VP8; 3.01% does after 5 s', () => {
    expect(codecSwitches(simulate(P540_TOP, { seconds: 60, net: () => ({ fractionLost: 0.03 }) }).log)).toEqual([])
    expect(codecSwitches(simulate(P540_TOP, { seconds: 10, net: () => ({ fractionLost: 0.0301 }) }).log)).toEqual([[5, 'VP8', 'L1T2']])
  })

  it('loss exactly 10% is not an emergency; just above drops one rung after 1 s (two samples)', () => {
    expect(simulate(P540_TOP, { seconds: 30, hw: () => false, net: () => ({ fractionLost: 0.1 }) }).log).toEqual([])
    const over = simulate(P540_TOP, { seconds: 2, hw: () => false, net: () => ({ fractionLost: 0.1001 }) })
    expect(reasons(over.log, 'rung_down')).toEqual([[1, 'emergency']])
    expect(scaled(over.log)).toEqual([[1, 360]])
  })

  it('target exactly 0.5 × cap is an ordinary step-down (3 s, one rung); just below is an emergency (1 s, to the rung it can feed)', () => {
    const half = simulate(P540_TOP, { seconds: 5, net: link(() => 600_000) })
    expect(reasons(half.log, 'rung_down')).toEqual([[3, 'bandwidth']])
    expect(scaled(half.log)).toEqual([[3, 360]])
    const under = simulate(P540_TOP, { seconds: 5, net: link(() => 599_999) })
    expect(reasons(under.log, 'rung_down')).toEqual([[1, 'emergency']])
    expect(scaled(under.log)).toEqual([[1, 240]]) // 0.6 Mbps cannot feed R360's 0.63 Mbps line
  })

  it('target exactly 150 kbps never pauses; one bit/s less pauses after 5 s', () => {
    const plan = { startHeight: 240, maxHeight: 240 }
    expect(events(simulate(plan, { seconds: 60, codec: 'VP8', net: link(() => 150_000) }).log, 'video_paused')).toEqual([])
    expect(events(simulate(plan, { seconds: 60, codec: 'VP8', net: link(() => 149_999) }).log, 'video_paused')).toEqual([5])
  })
})

describe('spec: rules the original suite exercises only in passing', () => {
  it('R240 is the floor of every drop: heavy loss there neither drops nor pauses', () => {
    const { log } = simulate({ startHeight: 240, maxHeight: 360 }, { seconds: 60, codec: 'VP8', net: () => ({ fractionLost: 0.5 }) })
    expect(log.filter((e) => e.a.type !== 'emit' || e.a.event !== 'trial_failed')).toEqual([])
    expect(events(log, 'rung_down')).toEqual([])
  })

  it('CPU at R240: H.264 that cannot switch is left to libwebrtc; AV1 moves to VP8 L1T2, not H.264 (H.264 is bad below 360p)', () => {
    const plan = { startHeight: 240, maxHeight: 240 }
    const stuck = simulate(plan, { seconds: 30, net: () => ({ qualityLimitationReason: 'cpu', canSwitchCodec: false }) })
    expect(stuck.log).toEqual([])
    const av1 = simulate(plan, { seconds: 30, codec: 'AV1', hw: () => false, net: () => ({ qualityLimitationReason: 'cpu' }) })
    expect(codecSwitches(av1.log)).toEqual([[10, 'VP8', 'L1T2']])
  })

  it('a stream PLANNED as VP8 (no hardware H.264) is never moved to H.264, however clean the link', () => {
    const { log } = simulate({ startHeight: 360, maxHeight: 540 }, { seconds: 120, codec: 'VP8' })
    expect(codecSwitches(log)).toEqual([])
  })

  it('starvation pauses inside the hardware dwell (pausing costs no IDR)', () => {
    // 750 kbps steps R540 down at t=3 (a reset); the path then collapses to 100 kbps: emergency to R240 at 5, pause at 9
    const { log } = simulate(P540_TOP, { seconds: 12, net: link((t) => (t <= 3 ? 750_000 : 100_000)) })
    expect(scaled(log)).toEqual([[3, 360], [5, 240]])
    expect(events(log, 'video_paused')).toEqual([9])
  })

  it('camera off during a PAUSED retry re-pauses without a second video_paused, and the retry comes back', () => {
    const plan = { startHeight: 240, maxHeight: 240 }
    const { log } = simulate(plan, {
      seconds: 60, codec: 'VP8',
      net: link((t) => (t < 30 ? 100_000 : 1_000_000), (t) => ({ videoEnabled: !(t >= 22 && t < 26) })),
    })
    expect(events(log, 'video_paused')).toEqual([5])
    expect(log.filter((e) => e.a.type === 'pauseVideo').map((e) => e.t)).toEqual([5, 22])
    expect(events(log, 'video_resumed')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Hostile input: a peer forging RTCP, and random garbage
// ---------------------------------------------------------------------------

describe('a peer that forges RTCP', () => {
  it('cannot make a hardware encoder reset more than about twice a minute: the probation throttles its flap', () => {
    // the peer reports 15% loss whenever the sender is at 720p (an emergency every time), and perfect stats otherwise
    const { log } = simulate(P540_UP, { seconds: 600, net: (_t, tx) => ({ fractionLost: tx.height === 720 ? 0.15 : 0 }) })
    const changes = scaled(log)
    expect(changes.length).toBeLessThanOrEqual(24)
    // every climb waited out the 15 s dwell from the previous reset; only the emergency drops may break it
    for (let k = 1; k < changes.length; k++) {
      if (changes[k][1] > changes[k - 1][1]) expect(changes[k][0] - changes[k - 1][0]).toBeGreaterThanOrEqual(15)
    }
    expect(Math.max(...changes.map(([, h]) => h))).toBe(720)
  })

  it('absurd RTTs (1e300 ms, negative, Infinity) neither throw nor leak a non-finite number into an action', () => {
    for (const rttMs of [1e300, -50, Infinity, -Infinity]) {
      const { log } = simulate(P540_UP, { seconds: 40, net: () => ({ rttMs }) })
      for (const e of log) for (const v of Object.values(e.a)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('invariants under seeded random, hostile input', () => {
  const deepFreeze = <V>(v: V): V => {
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
      Object.freeze(v)
    }
    return v
  }

  it('12 000 random steps: no throw, no mutation, nothing above the plan, and the engine stays in sync with the state', () => {
    const rand = mulberry32(0xeca11)
    const pick = <V>(xs: readonly V[]): V => xs[Math.floor(rand() * xs.length)]
    const garbage = [NaN, -1, Infinity, -Infinity, 1e300, undefined as unknown as number]
    const num = (good: () => number) => (rand() < 0.05 ? pick(garbage) : good())
    const plans: LadderPlan[] = [
      { startHeight: 540, maxHeight: 720, cap720Bps: 2_500_000 }, { startHeight: 720, maxHeight: 720 },
      { startHeight: 360, maxHeight: 540 }, { startHeight: 240, maxHeight: 240 }, { startHeight: 540, maxHeight: 100 },
      { startHeight: NaN, maxHeight: 720, cap720Bps: NaN },
    ]
    for (const plan of plans) {
      const init = createLadder(plan)
      let state = init.state
      const tx: Tx = { cap: 0, height: 0, fps: 0, codec: 'H264', paused: false }
      apply(tx, init.actions)
      const topHeight = RUNG_SPEC[state.top].height
      let now = 0
      let pauses = init.actions.filter((a) => a.type === 'pauseVideo').length
      let resumes = 0
      let pausedEvents = 0
      let resumedEvents = 0
      for (let k = 0; k < 2000; k++) {
        const clockBroken = rand() < 0.01
        if (!clockBroken) now += pick([1000, 1000, 1000, 1000, 900, 1100, 250, 0, 7000, -3000])
        const sample = deepFreeze({
          targetBitrateBps: num(() => tx.cap * rand() * 1.2),
          currentCapBps: num(() => (rand() < 0.9 ? tx.cap : pick([200_000, 300_000, 700_000, 1_200_000, 2_500_000]))),
          qualityLimitationReason: pick(['none', 'none', 'none', 'bandwidth', 'cpu', 'other', 'weird', undefined]) as LadderSample['qualityLimitationReason'],
          fractionLost: num(() => (rand() < 0.7 ? 0 : rand() * 0.2)),
          rttMs: num(() => 20 + rand() * 200),
          fps: num(() => 30),
          frameHeight: num(() => tx.height),
          encodeMsPerFrame: num(() => rand() * 40),
          codec: rand() < 0.9 ? tx.codec : pick(['H264', 'VP8', 'AV1', 'VP9', 'H265'] as CodecName[]),
          hardwareEncoder: rand() < 0.6,
          canSwitchCodec: rand() < 0.8,
          videoEnabled: rand() < 0.95,
        } satisfies LadderSample)
        const prev = deepFreeze(state)
        const r = step(prev, sample, clockBroken ? NaN : now * 1000)
        for (const a of r.actions) {
          for (const v of Object.values(a)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
          if (a.type === 'setScaleToHeight') {
            expect(VIDEO_RUNGS.map((x) => RUNG_SPEC[x].height)).toContain(a.height)
            expect(a.height).toBeLessThanOrEqual(topHeight)
            expect(a.height).toBeLessThanOrEqual(Number.isFinite(plan.maxHeight) ? plan.maxHeight : 540)
          }
          if (a.type === 'setCap') expect(a.bps > 0 && a.bps <= T.cap720MaxBps).toBe(true)
          if (a.type === 'setMaxFramerate') expect([15, 24, 30]).toContain(a.fps)
          if (a.type === 'pauseVideo') pauses++
          if (a.type === 'resumeVideo') resumes++
          if (a.type === 'emit' && a.event === 'video_paused') pausedEvents++
          if (a.type === 'emit' && a.event === 'video_resumed') resumedEvents++
          // pause/resume strictly alternate, as do the events the far end's placeholder follows
          expect(pauses - resumes === 0 || pauses - resumes === 1).toBe(true)
          expect(pausedEvents - resumedEvents === 0 || pausedEvents - resumedEvents === 1).toBe(true)
        }
        apply(tx, r.actions)
        state = r.state
        // the engine, having applied every action, holds exactly what the ladder believes it holds
        if (state.trial?.kind === 'up') {
          expect(tx).toMatchObject({ paused: false, cap: state.trial.capBps, height: RUNG_SPEC[state.rung as VideoRung].height })
        } else if (state.trial?.kind === 'resume') {
          expect(tx).toMatchObject({ paused: false, cap: T.resumeCapBps, height: RUNG_SPEC.R240.height })
        } else if (state.rung === 'PAUSED') {
          expect(tx.paused).toBe(true)
        } else {
          const spec = RUNG_SPEC[state.rung]
          expect(tx).toMatchObject({ paused: false, cap: state.capBps, height: spec.height, fps: spec.fps })
        }
      }
      expect(JSON.parse(JSON.stringify(state))).toEqual(state)
    }
  })

  it('replay: a JSON round-tripped state continues exactly like the live one', () => {
    const samples = (t: number, cap: number): LadderSample => ({
      targetBitrateBps: Math.min(cap, t % 40 < 20 ? 5_000_000 : 650_000), currentCapBps: cap, qualityLimitationReason: 'none',
      fractionLost: t % 9 === 4 ? 0.023 : 0, rttMs: 40, fps: 30, frameHeight: 540, encodeMsPerFrame: 5, codec: 'H264',
      hardwareEncoder: true, canSwitchCodec: true, videoEnabled: true,
    })
    let live = createLadder(P540_UP).state
    let cap = RUNG_SPEC.R540.capBps
    for (let t = 0; t < 200; t++) {
      const replayed = step(JSON.parse(JSON.stringify(live)) as LadderState, samples(t, cap), t * 1000)
      const r = step(live, samples(t, cap), t * 1000)
      expect(replayed).toEqual(r)
      for (const a of r.actions) if (a.type === 'setCap') cap = a.bps
      live = r.state
    }
  })
})
