/**
 * The adaptive video ladder — the PURE controller that decides, about once a second, how much video one outgoing
 * sender may send: step(state, sample, now) → { state, actions }. The call engine builds a LadderSample from getStats,
 * applies the returned actions through RTCRtpSender.setParameters, and keeps the state between calls.
 * Design: ~/eno-calls-research-2026-10/DESIGN.md §2 "Video"; review-refute-quality.md objections 1–4 are why it exists.
 *
 * WHY RELATIVE, AND WHY TRIALS. The first design used absolute bands (≥3 Mbps → 720p, 1.5–3 → 540p, …). libwebrtc's
 * estimator cannot report much more than a CAPPED sender actually sends: the delay-based increase stops near 1.5× the
 * acked throughput (aimd_rate_control.cc), allocation probes reach at most 2× the max allocation and fire only when
 * the cap CHANGES (probe_controller.cc), and periodic ALR probes need the sender below 65% of the estimate, which the
 * 1.5× ceiling never allows. A 540p sender capped at 1.2 Mbps therefore never "sees" the 3 Mbps that 720p asked for:
 * one 4G congestion event demoted a call for good, and "video off" never came back. Here every rule is relative to the
 * cap in force, and the only way up is to RAISE THE CAP AND WATCH (a trial) — the raise itself fires the allocation
 * probes that let the estimate discover whether the path has room.
 *
 * Rungs (RUNG_SPEC): R720 720p30 at the plan's 1.7–2.5 Mbps · R540 540p30 1.2 · R360 360p24 0.7 · R240 240p15 0.3
 * (VP8 L1T2 for an H.264 stream) · PAUSED. The start and the top rung come from the plan (createLadder).
 *
 * The rules, in the order step() tries them. At most ONE move per sample, so cause and effect stay readable:
 *   1. a climb trial in flight is judged, and nothing else moves until it ends;
 *   2. PAUSED: retry R240 at 200 kbps every 15 s; resume once the retry has held for 10 s;
 *   3. STARVED — target < 150 kbps for 5 s → PAUSED (pauseVideo + 'video_paused');
 *   4. EMERGENCY — loss > 10% or target < 0.5× cap for 1 s → drop now, straight to the rung the target can feed;
 *   5. CPU — qualityLimitationReason 'cpu' for 10 s → an AV1 stream switches codec first, otherwise one rung down;
 *   6. BANDWIDTH — target < 0.9× cap, or qualityLimitationReason 'bandwidth', for 3 s → one rung down;
 *   7. CODEC — loss > 3% for 5 s on hardware H.264 → VP8 L1T2; back to H.264 at ≥ R360 after 20 s of MEAN loss < 1%;
 *   8. CLIMB — stable (target ≥ 0.9× cap, not limited, MEAN loss < 2%) for the next rung's backoff (12 s, doubled per
 *      failure up to 60 s) → raise the cap to the next rung's; after 3 s keep it if the target reached ≥ 0.8× of it
 *      with loss < 2% and RTT not up > 30%, else revert.
 *
 * ⚠️ THE CLIMB AND THE STEP-DOWN DISAGREE ON PURPOSE, SO A CLIMB IS ON PROBATION. A link carrying 80–90% of the next
 * cap passes the trial (0.8×) and then trips the step-down (0.9×); left alone that is a flap every ~30 s, two IDRs
 * each. A step-down within 30 s of climbing to that rung therefore counts as a failed trial and doubles that rung's
 * backoff, so the flap decays to one attempt a minute — and a passed trial resets the backoff only once its climb has
 * HELD for those 30 s, never on the pass itself. Climbing on from a rung still on probation counts as that rung having
 * held: it carried its cap through a whole stable run and the next trial, and leaving it upward is no failure. A CPU
 * step-down sets the abandoned rung's backoff straight to the 60 s cap: a trial measures the PATH and is blind to the
 * encoder, so it would climb right back into the overload.
 * ⚠️ ONE RTCP REPORT IS SMALL-NUMBER STATISTICS. fractionLost is one receiver report: an 8-bit fraction (truncated) of
 * the packets sent since the previous report, so at 300 kbps (~31 packets/s) ONE lost packet reads as 3.1%, and at
 * 360p as 1.17%. The holds that wait for CALM — `stable` before a climb, `clean` before the way back to H.264 — judge
 * the MEAN loss of their run. Judged report by report, a 1%-loss 4G link needed a 24–60 s run without one lost packet
 * (hours on average), and the ladder never climbed back: the review's defect again, through the loss input. The rules
 * that REACT to loss — the emergency and the VP8 switch — read every report, so no single bad report can trigger them
 * (a run mean would let one 60% report switch the codec 5 s later).
 * ⚠️ EVERY ENCODER RESET COSTS AN IDR, AND ON AN ANDROID HARDWARE ENCODER EVERY RESOLUTION CHANGE IS A RESET (the NDK
 * encoder reports supports_frame_size_change=false, so MediaCodec is torn down and rebuilt). On a hardware encoder,
 * resolution changes AND codec switches therefore keep a 15 s dwell; only an emergency drop may break it, and a climb
 * trial starts only when its verdict would land after the dwell. The engine must apply ONE step's actions in ONE
 * setParameters call — then a drop into R240 that carries its VP8 switch is one reset, not two.
 * ⚠️ DURING A TRIAL THE CAP IN FORCE IS THE TRIAL'S. Every target-relative rule then measures against the COMMITTED cap
 * — measured against the raised one, every trial would begin life looking like an emergency (target < 0.5× cap).
 * ⚠️ R240 IS THE FLOOR OF THE STEP-DOWN RULES. 240p15 at 200 kbps is usable video, and "one rung down" from R240 would
 * pause it on a link that is merely below 270 kbps. Only starvation (< 150 kbps for 5 s) pauses video.
 * ⚠️ A STATS GAP IS NOT EVIDENCE. Hidden tabs and backgrounded WebViews throttle timers, and two samples 40 s apart must
 * not read as "held for 3 s": a gap over 5 s (or a clock that ran backwards) restarts every timer and calls off a trial
 * without penalty. A clock that ran backwards also shifts every stored deadline (dwell, retry, probation, pending codec)
 * by the jump, as if no time had passed between the two samples; left in the old timebase, a jump back by N seconds
 * froze every non-emergency move, and kept a paused video paused, for N seconds.
 * Likewise a missing or NaN field is UNKNOWN, never zero: an unknown target or loss never steps down and never climbs,
 * and an unknown encode time or frame height only skips the CPU-headroom check (the CPU rule is the backstop). A
 * fractionLost above 1, which no receiver report can carry (255/256 is its maximum), is a units or counter bug in the
 * engine and is unknown too; clamped to 1, it read as 100% loss.
 * ⚠️ 30% OF A 15 ms RTT IS JITTER. The trial compares mean RTT with an EWMA baseline plus 10 ms of absolute slack —
 * without it a Wi-Fi↔Wi-Fi call through the in-country relay, the best network eno will ever see, fails every trial on
 * ordinary jitter and never reaches 720p.
 * ⚠️ ENCODE TIME ON A HARDWARE ENCODER IS PIPELINE LATENCY, NOT LOAD. The CPU-headroom check before a climb (projected
 * encode time at the next rung under 85% of its frame interval — libwebrtc's own overuse threshold) reads it only for
 * software encoders.
 * Pure: no timers, no WebRTC objects. `now` is the engine's monotonic clock in ms and the state is plain JSON, so a call
 * can be replayed from telemetry and every rule is pinned by a synthetic trace in ladder.test.ts (noiseless stats) and
 * ladder.review.test.ts (RTCP-quantized loss, spec boundaries, hostile input).
 */

import type { CodecName } from './types'

// ---------------------------------------------------------------------------
// Rungs and tuning
// ---------------------------------------------------------------------------

export type VideoRung = 'R720' | 'R540' | 'R360' | 'R240'
export type LadderRung = VideoRung | 'PAUSED'

/** Lowest first: a climb is index + 1, "one rung down" is index − 1. */
export const VIDEO_RUNGS: readonly VideoRung[] = ['R240', 'R360', 'R540', 'R720']

/**
 * R720's cap is the plan's (clamped to the cap720 band in LADDER_TUNING); the others are the design's. R360 takes the
 * middle of the design's 0.6–0.8 Mbps band, R240 its 0.3 Mbps ceiling.
 */
export const RUNG_SPEC: Readonly<Record<VideoRung, { readonly height: number; readonly fps: number; readonly capBps: number }>> = {
  R720: { height: 720, fps: 30, capBps: 1_700_000 },
  R540: { height: 540, fps: 30, capBps: 1_200_000 },
  R360: { height: 360, fps: 24, capBps: 700_000 },
  R240: { height: 240, fps: 15, capBps: 300_000 },
}

/** Every number the rules use, in one place: a re-tune after the VN device bake-off is one diff here. */
export const LADDER_TUNING = Object.freeze({
  cap720MinBps: 1_700_000,
  cap720MaxBps: 2_500_000,
  /** Step down when the target stays below this fraction of the cap in force… */
  stepDownRatio: 0.9,
  /** …or qualityLimitationReason says 'bandwidth', for this long. */
  stepDownHoldMs: 3_000,
  cpuHoldMs: 10_000,
  emergencyLoss: 0.1,
  emergencyRatio: 0.5,
  /** Two consecutive ~1 s samples: one RTCP report at 30 packets/s reads 10% loss from three lost packets. */
  emergencyHoldMs: 1_000,
  dwellMs: 15_000,
  trialBackoffMs: 12_000,
  trialMaxBackoffMs: 60_000,
  /** Loss reports trail a probe by an RTCP interval, so a trial is judged after its window, never on first touch. */
  trialRampMs: 3_000,
  trialReachRatio: 0.8,
  trialMaxLoss: 0.02,
  trialRttRise: 0.3,
  trialRttSlackMs: 10,
  rttEwmaAlpha: 0.25,
  climbProbationMs: 30_000,
  /** libwebrtc's own overuse threshold: encode time over the frame interval. */
  cpuHeadroom: 0.85,
  vp8Loss: 0.03,
  vp8LossHoldMs: 5_000,
  h264CleanLoss: 0.01,
  h264CleanHoldMs: 20_000,
  starvedBps: 150_000,
  starvedHoldMs: 5_000,
  resumeEveryMs: 15_000,
  resumeCapBps: 200_000,
  resumeHoldMs: 10_000,
  sampleGapMs: 5_000,
  /** How long a codec we asked for may take to show up in getStats before the stats are believed again. */
  codecSettleMs: 3_000,
} as const)

// ---------------------------------------------------------------------------
// Contract with the call engine
// ---------------------------------------------------------------------------

export interface LadderPlan {
  /** Where the call starts (design: 540). Snapped DOWN to a rung, and never above the top. */
  startHeight: number
  /**
   * The tallest frame this direction may carry: min(sender tier, receiver tier, the receiver's announced max). Snapped
   * DOWN to a rung — 600 means R540, never R720 — so the ladder can never exceed it. Below 240 there is no rung at all:
   * the ladder starts paused and never retries (codec-plan plans no video there either, PLAN_MIN_HEIGHT).
   */
  maxHeight: number
  /** This pair's R720 cap: clamped into 1.7–2.5 Mbps, 1.7 Mbps when absent. */
  cap720Bps?: number
}

export type QualityLimitationReason = 'none' | 'bandwidth' | 'cpu' | 'other'

/** One getStats reading for the video sender. A missing or NaN number is read as UNKNOWN (see the header). */
export interface LadderSample {
  /** outbound-rtp targetBitrate: min(the estimator's allocation, the cap). */
  targetBitrateBps: number
  /** encodings[0].maxBitrate as the sender holds it now — it may trail a setCap by one sample. */
  currentCapBps: number
  qualityLimitationReason: QualityLimitationReason
  /** remote-inbound-rtp fractionLost, 0–1. */
  fractionLost: number
  /** remote-inbound-rtp roundTripTime, in ms. */
  rttMs: number
  /** Carried for telemetry parity; no rule reads it — qualityLimitationReason is libwebrtc's own verdict on fps sag. */
  fps: number
  /**
   * The SHORT side of the frame actually encoded: 540 for 960×540 and for 540×960 alike, the plan's convention for every
   * height. libwebrtc may already sit below the rung. The CPU-headroom check scales encode time by (rung / frameHeight)²,
   * so a portrait frame's long side would understate the next rung's cost about threefold.
   */
  frameHeight: number
  /** Δ totalEncodeTime / Δ framesEncoded, in ms. */
  encodeMsPerFrame: number
  codec: CodecName
  /** powerEfficientEncoder: a hardware encoder. */
  hardwareEncoder: boolean
  /**
   * Chromium senders only: encodings[0].codec can move this stream between VP8 and H.264 without renegotiation.
   * ⚠️ The engine must report false after a switch that failed, or the ladder will ask again every few seconds.
   */
  canSwitchCodec: boolean
  /** false while the camera is off (the black placeholder track is on the sender): the ladder holds still. */
  videoEnabled: boolean
}

export type LadderEvent = 'video_paused' | 'video_resumed' | 'rung_down' | 'rung_up' | 'trial_failed'
export type LadderReason = 'bandwidth' | 'cpu' | 'loss' | 'rtt' | 'emergency' | 'starved' | 'trial'

/**
 * What the engine must do. One step's actions belong in ONE setParameters call (see the header). Every rung change
 * carries the whole rung — setCap + setScaleToHeight + setMaxFramerate — so an engine that missed a step re-syncs.
 * setScaleToHeight cannot upscale: the engine maps it to scaleResolutionDownBy = captureHeight / height (≥ 1).
 */
export type LadderAction =
  | { type: 'setCap'; bps: number }
  | { type: 'setScaleToHeight'; height: number }
  | { type: 'setMaxFramerate'; fps: number }
  | { type: 'switchCodec'; codec: 'VP8' | 'H264'; scalabilityMode: 'L1T2' | 'L1T1' }
  | { type: 'pauseVideo' }
  | { type: 'resumeVideo' }
  | { type: 'emit'; event: LadderEvent; reason: LadderReason }

/** A cap raised on probation: 'up' climbs one rung, 'resume' is the 200 kbps R240 retry out of PAUSED. */
export interface LadderTrial {
  kind: 'up' | 'resume'
  to: VideoRung
  capBps: number
  startedAt: number
  baseRttMs: number | null
  lossSum: number
  lossN: number
  rttSum: number
  rttN: number
}

/** When each condition was first seen in its current unbroken run; null = not holding. */
export interface LadderTimers {
  under: number | null
  bandwidth: number | null
  cpu: number | null
  emergency: number | null
  starved: number | null
  lossy: number | null
  clean: number | null
  stable: number | null
}

/**
 * The loss behind a calm-waiting hold (`stable`, `clean`): its run's MEAN is what the hold judges (see the header).
 * `from` is the run's start, equal to since[key] while the run is alive, so a stale run can never be carried into a
 * new one.
 */
export interface LossRun {
  from: number
  sum: number
  n: number
}

export interface LadderState {
  rung: LadderRung
  top: VideoRung
  cap720Bps: number
  /** The committed cap of the current rung — never a trial's. */
  capBps: number
  lastSampleAt: number | null
  /** The last encoder reset this ladder caused (resolution change, codec switch, resume): the dwell counts from it. */
  lastResetAt: number | null
  since: LadderTimers
  lossRuns: { stable: LossRun | null; clean: LossRun | null }
  rttEwmaMs: number | null
  /** Per TARGET rung: failing to reach R720 must not slow the climb back to R540 after a drop. */
  backoffMs: Record<VideoRung, number>
  lastClimb: { rung: VideoRung; at: number } | null
  trial: LadderTrial | null
  /** PAUSED only: when the next 200 kbps retry may start. */
  resumeAt: number | null
  /** This ladder moved an H.264 stream to VP8 and owes it the way back. */
  vp8Fallback: boolean
  pendingCodec: { codec: 'VP8' | 'H264'; at: number } | null
}

export interface LadderStep {
  state: LadderState
  actions: LadderAction[]
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

const T = LADDER_TUNING

const NO_TIMERS: LadderTimers = {
  under: null, bandwidth: null, cpu: null, emergency: null, starved: null, lossy: null, clean: null, stable: null,
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const rank = (r: VideoRung): number => VIDEO_RUNGS.indexOf(r)
const capOf = (s: Pick<LadderState, 'cap720Bps'>, r: VideoRung): number => (r === 'R720' ? s.cap720Bps : RUNG_SPEC[r].capBps)

/** The tallest rung not above `height`; R240 is the floor even for a nonsense height. */
function snapDown(height: number): VideoRung {
  for (let i = VIDEO_RUNGS.length - 1; i > 0; i--) if (RUNG_SPEC[VIDEO_RUNGS[i]].height <= height) return VIDEO_RUNGS[i]
  return 'R240'
}

/**
 * A fresh ladder and the actions that configure the start rung. A height that is not a finite number falls back to
 * 540p — the design's conservative start — and a missing R720 cap to 1.7 Mbps, rather than throwing mid-call.
 */
export function createLadder(plan: LadderPlan): LadderStep {
  const top = snapDown(finite(plan.maxHeight) ? plan.maxHeight : 540)
  const wanted = snapDown(finite(plan.startHeight) ? plan.startHeight : 540)
  const rung = rank(wanted) > rank(top) ? top : wanted
  const cap720Bps = Math.min(T.cap720MaxBps, Math.max(T.cap720MinBps, finite(plan.cap720Bps) ? plan.cap720Bps : 0))
  const b = T.trialBackoffMs
  const state: LadderState = {
    rung, top, cap720Bps, capBps: 0, lastSampleAt: null, lastResetAt: null, since: { ...NO_TIMERS },
    lossRuns: { stable: null, clean: null }, rttEwmaMs: null,
    backoffMs: { R240: b, R360: b, R540: b, R720: b }, lastClimb: null, trial: null, resumeAt: null,
    vp8Fallback: false, pendingCodec: null,
  }
  state.capBps = capOf(state, rung)
  // ⚠️ below the lowest rung there is nothing the ladder may send ("never above maxHeight" has no floor exemption), and
  // codec-plan plans no video for such a direction either. PAUSED with no retry date (resumeAt null) is paused for good.
  if (finite(plan.maxHeight) && plan.maxHeight < RUNG_SPEC.R240.height) {
    state.rung = 'PAUSED'
    return { state, actions: [{ type: 'pauseVideo' }] }
  }
  return { state, actions: rungActions(state, rung) }
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** The sample with every number checked: null = unknown. */
interface Reading {
  target: number | null
  appliedCap: number | null
  qlr: QualityLimitationReason
  loss: number | null
  rtt: number | null
  frameHeight: number | null
  encodeMs: number | null
  codec: CodecName
  hardwareEncoder: boolean
  canSwitchCodec: boolean
  videoEnabled: boolean
}

function read(x: LadderSample): Reading {
  const nonNeg = (v: unknown) => (finite(v) && v >= 0 ? v : null)
  const positive = (v: unknown) => (finite(v) && v > 0 ? v : null)
  const loss = nonNeg(x.fractionLost)
  const q = x.qualityLimitationReason
  return {
    target: nonNeg(x.targetBitrateBps),
    appliedCap: positive(x.currentCapBps),
    qlr: q === 'none' || q === 'bandwidth' || q === 'cpu' ? q : 'other',
    // above 1 is no receiver report (255/256 is the most one carries): an engine bug, so unknown — never "100% loss"
    loss: loss !== null && loss <= 1 ? loss : null,
    rtt: nonNeg(x.rttMs),
    frameHeight: positive(x.frameHeight),
    encodeMs: positive(x.encodeMsPerFrame),
    codec: x.codec,
    hardwareEncoder: x.hardwareEncoder === true,
    canSwitchCodec: x.canSwitchCodec === true,
    videoEnabled: x.videoEnabled === true,
  }
}

/**
 * Feed one sample. Never mutates `prev` — the engine may keep old states for telemetry or replay. A non-finite `now`
 * decides nothing (a broken clock cannot be allowed to satisfy a hold).
 */
export function step(prev: LadderState, sample: LadderSample, now: number): LadderStep {
  const s: LadderState = {
    ...prev,
    since: { ...prev.since },
    lossRuns: { ...prev.lossRuns },
    backoffMs: { ...prev.backoffMs },
    trial: prev.trial ? { ...prev.trial } : null,
  }
  const out: LadderAction[] = []
  if (!finite(now)) return { state: s, actions: out }
  const x = read(sample)

  const backwards = prev.lastSampleAt !== null && now < prev.lastSampleAt
  const gap = backwards || (prev.lastSampleAt !== null && now - prev.lastSampleAt > T.sampleGapMs)
  if (backwards) rebase(s, now - (prev.lastSampleAt as number))
  s.lastSampleAt = now
  if (s.pendingCodec && (x.codec === s.pendingCodec.codec || now - s.pendingCodec.at >= T.codecSettleMs)) s.pendingCodec = null
  if (gap || !x.videoEnabled) {
    standDown(s, now, out)
    // camera off: the black placeholder's stats say nothing about the path or the encoder — hold still
    if (!x.videoEnabled) return { state: s, actions: out }
  }
  observe(s, x, now)
  // a climb that has held through its probation has earned its rung a fresh backoff
  if (s.lastClimb && s.rung === s.lastClimb.rung && now - s.lastClimb.at > T.climbProbationMs) {
    s.backoffMs[s.lastClimb.rung] = T.trialBackoffMs
    s.lastClimb = null
  }
  decide(s, x, now, out)
  return { state: s, actions: out }
}

/**
 * The clock ran backwards: move every stored deadline into the new timebase, as if no time had passed between the two
 * samples, so the dwell, the retry and the probation keep exactly what was left of them. (Hold timers and the trial
 * are dropped by standDown in the same step.) Objects are replaced, never mutated: they may be shared with `prev`.
 */
function rebase(s: LadderState, shift: number): void {
  if (s.lastResetAt !== null) s.lastResetAt += shift
  if (s.resumeAt !== null) s.resumeAt += shift
  if (s.lastClimb) s.lastClimb = { ...s.lastClimb, at: s.lastClimb.at + shift }
  if (s.pendingCodec) s.pendingCodec = { ...s.pendingCodec, at: s.pendingCodec.at + shift }
}

/** Forget every hold and call off any trial WITHOUT a backoff penalty: absence of evidence is not a failure. */
function standDown(s: LadderState, now: number, out: LadderAction[]): void {
  if (s.trial?.kind === 'up') out.push(setCap(s.capBps))
  if (s.trial?.kind === 'resume') {
    out.push({ type: 'pauseVideo' })
    s.resumeAt = now + T.resumeEveryMs
  }
  s.trial = null
  s.since = { ...NO_TIMERS }
  s.lossRuns = { stable: null, clean: null }
}

/** Advance every condition timer from this sample. Decisions happen in decide(), on the timers alone. */
function observe(s: LadderState, x: Reading, now: number): void {
  const video = s.rung !== 'PAUSED'
  // ⚠️ during a climb trial the sender holds the TRIAL's cap — measure against the committed one (see the header)
  const cap = s.trial?.kind === 'up' ? s.capBps : x.appliedCap ?? s.capBps
  const { target, loss } = x
  const hold = (key: keyof LadderTimers, on: boolean) => {
    s.since[key] = on ? s.since[key] ?? now : null
  }
  hold('under', video && target !== null && target < T.stepDownRatio * cap)
  hold('bandwidth', video && x.qlr === 'bandwidth')
  hold('cpu', video && x.qlr === 'cpu')
  hold('emergency', video && ((loss !== null && loss > T.emergencyLoss) || (target !== null && target < T.emergencyRatio * cap)))
  hold('starved', video && target !== null && target < T.starvedBps)
  // ⚠️ reacting to loss reads every report (no single one can trigger it); waiting for calm reads the run's MEAN loss
  hold('lossy', video && x.codec === 'H264' && x.hardwareEncoder && loss !== null && loss > T.vp8Loss)
  holdCalm(s, 'clean', video && s.vp8Fallback && x.codec === 'VP8' && s.rung !== 'R240', loss, T.h264CleanLoss, now)
  // 'other' is neutral: it neither steps down nor blocks a climb (no browser documents what it means in practice)
  holdCalm(s, 'stable', video && !s.trial && s.rung !== s.top && target !== null && target >= T.stepDownRatio * cap
    && (x.qlr === 'none' || x.qlr === 'other'), loss, T.trialMaxLoss, now)
  // the baseline a trial's RTT is judged against: a trial's own samples would raise the bar it is measured by
  if (!s.trial && x.rtt !== null) s.rttEwmaMs = s.rttEwmaMs === null ? x.rtt : s.rttEwmaMs + T.rttEwmaAlpha * (x.rtt - s.rttEwmaMs)
}

/**
 * A hold that waits for CALM: `pre` must hold on every sample and the run's MEAN loss must stay under `maxLoss`. An
 * unknown loss breaks the run, because unknown never climbs. The report that breaks a run is itself above the line (the
 * mean only crosses it on a sample above it), so it never starts the next run. A run whose start was set from outside
 * (a failed trial restarts `stable` at its verdict) begins its mean empty.
 */
function holdCalm(s: LadderState, key: 'stable' | 'clean', pre: boolean, loss: number | null, maxLoss: number, now: number): void {
  const since = s.since[key]
  if (pre && loss !== null) {
    const run = s.lossRuns[key]
    const base = since !== null && run !== null && run.from === since ? run : { from: since ?? now, sum: 0, n: 0 }
    const next: LossRun = { from: base.from, sum: base.sum + loss, n: base.n + 1 }
    if (next.sum / next.n < maxLoss) {
      s.since[key] = next.from
      s.lossRuns[key] = next
      return
    }
  }
  s.since[key] = null
  s.lossRuns[key] = null
}

/** At most one move, in the header's rule order. */
function decide(s: LadderState, x: Reading, now: number, out: LadderAction[]): void {
  if (s.trial?.kind === 'up') return judgeClimb(s, x, now, out)
  if (s.rung === 'PAUSED') return whilePaused(s, x, now, out)
  const rung = s.rung
  const held = (key: keyof LadderTimers, ms: number) => {
    const since = s.since[key]
    return since !== null && now - since >= ms
  }
  const dwellOk = dwellAllows(s, x, now)

  if (held('starved', T.starvedHoldMs)) return pause(s, now, out)
  // emergencies are the one move the dwell may not delay: freezing for 15 s on a collapsing link costs more than an IDR
  if (rung !== 'R240' && held('emergency', T.emergencyHoldMs)) return stepDown(s, x, now, out, emergencyLanding(s, x, rung), 'emergency')
  if (held('cpu', T.cpuHoldMs) && dwellOk) {
    // AV1 is the one codec whose encoder costs far more than the alternatives: shedding it comes before shedding pixels
    if (x.codec === 'AV1' && x.canSwitchCodec && !s.pendingCodec) return switchCodec(s, now, out, rung === 'R240' ? 'VP8' : 'H264')
    // at R240 libwebrtc's own CPU adaptation (maintain-framerate) goes on downscaling; pausing would only flap
    if (rung !== 'R240') return stepDown(s, x, now, out, VIDEO_RUNGS[rank(rung) - 1], 'cpu')
  }
  if (rung !== 'R240' && dwellOk && (held('under', T.stepDownHoldMs) || held('bandwidth', T.stepDownHoldMs))) {
    return stepDown(s, x, now, out, VIDEO_RUNGS[rank(rung) - 1], 'bandwidth')
  }
  if (x.canSwitchCodec && !s.pendingCodec && dwellOk) {
    // Android hardware H.264 has no temporal layers (only Qualcomm/Exynos get them) and an untrusted rate controller
    if (held('lossy', T.vp8LossHoldMs)) return switchCodec(s, now, out, 'VP8')
    if (held('clean', T.h264CleanHoldMs)) return switchCodec(s, now, out, 'H264')
    // catch-up for an R240 that could not switch on entry (e.g. the call STARTED at R240)
    if (rung === 'R240' && x.codec === 'H264') return switchCodec(s, now, out, 'VP8')
  }
  maybeClimb(s, x, now, out)
}

/** On a hardware encoder a reset may follow the previous one only after the dwell. */
function dwellAllows(s: LadderState, x: Reading, now: number): boolean {
  return !x.hardwareEncoder || s.lastResetAt === null || now - s.lastResetAt >= T.dwellMs
}

/**
 * Where an emergency lands: one rung down at least, and further while the target cannot feed the rung (below the
 * step-down line of its cap). One reset straight to R240 beats three resets in a row on a link that just collapsed.
 * An unknown target (a loss-only emergency) lands one rung down.
 */
function emergencyLanding(s: LadderState, x: Reading, from: VideoRung): VideoRung {
  let i = rank(from) - 1
  if (x.target !== null) while (i > 0 && x.target < T.stepDownRatio * capOf(s, VIDEO_RUNGS[i])) i--
  return VIDEO_RUNGS[Math.max(i, 0)]
}

function stepDown(s: LadderState, x: Reading, now: number, out: LadderAction[], to: VideoRung, reason: LadderReason): void {
  const from = s.rung as VideoRung
  if (reason === 'cpu') s.backoffMs[from] = T.trialMaxBackoffMs
  else if (s.lastClimb?.rung === from && now - s.lastClimb.at <= T.climbProbationMs) {
    s.backoffMs[from] = Math.min(s.backoffMs[from] * 2, T.trialMaxBackoffMs)
  }
  s.lastClimb = null
  enterRung(s, to)
  s.lastResetAt = now
  out.push(...rungActions(s, to))
  // in the SAME step as the resolution change, so the engine folds both into one reset
  const codec = s.pendingCodec ? s.pendingCodec.codec : x.codec
  if (to === 'R240' && codec === 'H264' && x.canSwitchCodec) switchCodec(s, now, out, 'VP8')
  out.push(emit('rung_down', reason))
}

/** Rung-relative holds start over; loss and starvation are facts about the path, not the rung, and carry on. */
function enterRung(s: LadderState, to: VideoRung): void {
  s.rung = to
  s.capBps = capOf(s, to)
  s.since = { ...NO_TIMERS, starved: s.since.starved, lossy: s.since.lossy, clean: s.since.clean }
  s.lossRuns = { stable: null, clean: s.lossRuns.clean }
}

function switchCodec(s: LadderState, now: number, out: LadderAction[], codec: 'VP8' | 'H264'): void {
  out.push({ type: 'switchCodec', codec, scalabilityMode: codec === 'VP8' ? 'L1T2' : 'L1T1' })
  s.pendingCodec = { codec, at: now }
  s.vp8Fallback = codec === 'VP8'
  s.lastResetAt = now
  // a new encoder: its loss and CPU history start over (which is what makes AV1 → H.264 come "first")
  s.since.lossy = null
  s.since.clean = null
  s.since.cpu = null
  s.lossRuns = { ...s.lossRuns, clean: null }
}

function pause(s: LadderState, now: number, out: LadderAction[]): void {
  s.rung = 'PAUSED'
  s.trial = null
  s.lastClimb = null
  s.since = { ...NO_TIMERS }
  s.lossRuns = { stable: null, clean: null }
  s.resumeAt = now + T.resumeEveryMs
  out.push({ type: 'pauseVideo' }, emit('video_paused', 'starved'))
}

/**
 * Raise the cap to the next rung's when the current one has been stable for that rung's backoff. Only the cap moves:
 * no IDR is spent until the trial has passed.
 */
function maybeClimb(s: LadderState, x: Reading, now: number, out: LadderAction[]): void {
  const rung = s.rung as VideoRung
  if (rung === s.top || s.since.stable === null) return
  const to = VIDEO_RUNGS[rank(rung) + 1]
  if (now - s.since.stable < s.backoffMs[to]) return
  // the verdict (≥ trialRampMs away) is when the resolution would change, so it must land after the dwell
  if (x.hardwareEncoder && s.lastResetAt !== null && now + T.trialRampMs - s.lastResetAt < T.dwellMs) return
  if (!x.hardwareEncoder && x.encodeMs !== null && x.frameHeight !== null) {
    const next = RUNG_SPEC[to]
    const usage = (x.encodeMs * (next.height / x.frameHeight) ** 2 * next.fps) / 1000
    if (usage >= T.cpuHeadroom) return
  }
  s.trial = newTrial('up', to, capOf(s, to), now, s.rttEwmaMs)
  out.push(setCap(s.trial.capBps))
}

function judgeClimb(s: LadderState, x: Reading, now: number, out: LadderAction[]): void {
  const trial = s.trial as LadderTrial
  const verdict = judge(trial, x, now, s.capBps, T.trialRampMs)
  if (verdict === 'pending') return
  if (verdict === 'pass') {
    // defensive: maybeClimb already timed the verdict past the dwell; if the encoder changed under us, keep judging
    if (!dwellAllows(s, x, now)) return
    s.trial = null
    // the rung we climb FROM carried its cap through a whole stable run and this trial: still on probation, it has
    // held, and earns its fresh backoff now. Left upward, its probation used to lapse silently and keep a stale backoff.
    const from = s.rung as VideoRung
    if (s.lastClimb?.rung === from) s.backoffMs[from] = T.trialBackoffMs
    enterRung(s, trial.to)
    s.lastResetAt = now
    // ⚠️ the backoff is NOT reset here: a pass only opens the probation (see step()). Resetting on the pass undid the
    // probation's doubling on every climb, and the dead-band flap ran forever at a fixed period.
    s.lastClimb = { rung: trial.to, at: now }
    s.since.stable = now
    out.push(...rungActions(s, trial.to), emit('rung_up', 'trial'))
    return
  }
  s.trial = null
  s.backoffMs[trial.to] = Math.min(s.backoffMs[trial.to] * 2, T.trialMaxBackoffMs)
  s.since.stable = now
  s.lossRuns.stable = null
  out.push(setCap(s.capBps), emit('trial_failed', verdict))
}

/** PAUSED: retry R240 at the resume cap every resumeEveryMs; resume once a retry holds for resumeHoldMs. */
function whilePaused(s: LadderState, x: Reading, now: number, out: LadderAction[]): void {
  if (s.trial?.kind === 'resume') {
    const verdict = judge(s.trial, x, now, null, T.resumeHoldMs)
    if (verdict === 'pending') return
    s.trial = null
    if (verdict === 'pass') {
      s.resumeAt = null
      enterRung(s, 'R240')
      s.since.stable = now
      out.push(...rungActions(s, 'R240'), emit('video_resumed', 'trial'))
      return
    }
    // no second 'video_paused': the far end never saw 'video_resumed', so its placeholder never went away
    s.resumeAt = now + T.resumeEveryMs
    out.push({ type: 'pauseVideo' }, emit('trial_failed', verdict))
    return
  }
  if (s.resumeAt === null || now < s.resumeAt) return
  s.trial = newTrial('resume', 'R240', T.resumeCapBps, now, s.rttEwmaMs)
  s.lastResetAt = now
  const r = RUNG_SPEC.R240
  out.push({ type: 'resumeVideo' }, setCap(T.resumeCapBps), setScaleToHeight(r.height), setMaxFramerate(r.fps))
  if (x.codec === 'H264' && x.canSwitchCodec && s.pendingCodec?.codec !== 'VP8') switchCodec(s, now, out, 'VP8')
}

function newTrial(kind: LadderTrial['kind'], to: VideoRung, capBps: number, now: number, baseRttMs: number | null): LadderTrial {
  return { kind, to, capBps, startedAt: now, baseRttMs, lossSum: 0, lossN: 0, rttSum: 0, rttN: 0 }
}

/**
 * One trial sample. An emergency fails it at once (reverting a cap is free); otherwise, once the ramp is over, every
 * sample must show the target at ≥ 0.8× the trial cap with MEAN loss < 2% and MEAN RTT within 30% + slack of the
 * baseline — means, because at 30 packets/s one lost packet is a 3% sample. A climb is judged once at the end of the
 * ramp; a resume must keep passing until resumeHoldMs. Unknown loss cannot confirm a trial; unknown RTT is skipped
 * (it is the secondary signal, and Safari builds have gone without it).
 */
function judge(trial: LadderTrial, x: Reading, now: number, baseCapBps: number | null, holdMs: number): 'pending' | 'pass' | LadderReason {
  if (x.loss !== null && x.loss > T.emergencyLoss) return 'emergency'
  if (baseCapBps !== null && x.target !== null && x.target < T.emergencyRatio * baseCapBps) return 'emergency'
  if (x.loss !== null) {
    trial.lossSum += x.loss
    trial.lossN += 1
  }
  if (x.rtt !== null) {
    trial.rttSum += x.rtt
    trial.rttN += 1
  }
  const elapsed = now - trial.startedAt
  if (elapsed < T.trialRampMs) return 'pending'
  if (x.target === null || x.target < T.trialReachRatio * trial.capBps) return 'bandwidth'
  if (trial.lossN === 0 || trial.lossSum / trial.lossN >= T.trialMaxLoss) return 'loss'
  if (trial.baseRttMs !== null && trial.rttN > 0
    && trial.rttSum / trial.rttN > trial.baseRttMs * (1 + T.trialRttRise) + T.trialRttSlackMs) return 'rtt'
  return elapsed >= holdMs ? 'pass' : 'pending'
}

// ---------------------------------------------------------------------------
// Action builders
// ---------------------------------------------------------------------------

const setCap = (bps: number): LadderAction => ({ type: 'setCap', bps })
const setScaleToHeight = (height: number): LadderAction => ({ type: 'setScaleToHeight', height })
const setMaxFramerate = (fps: number): LadderAction => ({ type: 'setMaxFramerate', fps })
const emit = (event: LadderEvent, reason: LadderReason): LadderAction => ({ type: 'emit', event, reason })

function rungActions(s: Pick<LadderState, 'cap720Bps'>, r: VideoRung): LadderAction[] {
  return [setCap(capOf(s, r)), setScaleToHeight(RUNG_SPEC[r].height), setMaxFramerate(RUNG_SPEC[r].fps)]
}
