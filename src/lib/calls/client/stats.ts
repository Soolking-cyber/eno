import type { CodecName } from '../types'
import type { LadderSample, QualityLimitationReason } from '../ladder'

/**
 * In-app calls — what the engine reads out of getStats() once a second, beyond telemetry (telemetry.ts has its own
 * allowlist reader): the inbound packet count that detects a dead path 5 s before ICE says so (negotiation.ts
 * packetsStalled), and the video sender's LadderSample (ladder.ts). Numbers only, read field by field; nothing here
 * touches a candidate entry, so no address can be picked up by accident.
 * A field a browser does not report is NaN in the sample — UNKNOWN to the ladder, never zero (ladder.ts header).
 */

type Stat = Record<string, unknown> & { id?: string; type?: string; kind?: string; mediaType?: string }

function entries(report: RTCStatsReport | Iterable<unknown> | null | undefined): Stat[] {
  if (!report) return []
  const out: Stat[] = []
  for (const v of report as Iterable<unknown>) {
    const s = Array.isArray(v) ? v[1] : v
    if (s && typeof s === 'object') out.push(s as Stat)
  }
  return out
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN)
const kindOf = (s: Stat) => (typeof s.kind === 'string' ? s.kind : s.mediaType)

/** Total RTP packets received on every inbound stream — the stall detector's input. null when there is no stream yet. */
export function inboundPackets(report: RTCStatsReport | Iterable<unknown>): number | null {
  let total = 0
  let seen = false
  for (const s of entries(report)) {
    if (s.type !== 'inbound-rtp') continue
    const p = num(s.packetsReceived)
    if (!Number.isNaN(p)) { total += p; seen = true }
  }
  return seen ? total : null
}

/**
 * Frames decoded from the other side's video so far. GROWING means their camera is sending; a camera turned off sends
 * no track at all, so the count stops (null: no inbound video yet). This, not the track's mute events, drives the call
 * screen's video — browsers disagree on when a receiving track mutes.
 */
export function inboundVideoFrames(report: RTCStatsReport | Iterable<unknown>): number | null {
  let total = 0
  let seen = false
  for (const s of entries(report)) {
    if (s.type !== 'inbound-rtp' || kindOf(s) !== 'video') continue
    const f = num(s.framesDecoded)
    if (!Number.isNaN(f)) { total += f; seen = true }
  }
  return seen ? total : null
}

const CODEC_BY_MIME: Record<string, CodecName> = { 'video/h264': 'H264', 'video/vp8': 'VP8', 'video/vp9': 'VP9', 'video/av1': 'AV1', 'video/h265': 'H265' }
const QL = new Set<QualityLimitationReason>(['none', 'bandwidth', 'cpu', 'other'])

export interface LadderContext {
  /** encodings[0].maxBitrate as the sender holds it now. */
  currentCapBps: number
  /** Chromium with RTCRtpEncodingParameters.codec — false after a switch that failed (ladder.ts). */
  canSwitchCodec: boolean
  /** false while the camera is off (the video sender then carries no track). */
  videoEnabled: boolean
}

/** The video sender's sample, or null when this call sends no video. */
export function ladderSample(report: RTCStatsReport | Iterable<unknown>, prev: RTCStatsReport | Iterable<unknown> | null, ctx: LadderContext): LadderSample | null {
  const all = entries(report)
  const out = all.find((s) => s.type === 'outbound-rtp' && kindOf(s) === 'video')
  if (!out) return null
  const remote = all.find((s) => s.type === 'remote-inbound-rtp' && kindOf(s) === 'video')
  const codecStat = all.find((s) => s.type === 'codec' && s.id === out.codecId)
  const mime = typeof codecStat?.mimeType === 'string' ? codecStat.mimeType.toLowerCase() : ''
  const old = prev ? entries(prev).find((s) => s.type === 'outbound-rtp' && s.id === out.id) : undefined
  const dTime = num(out.totalEncodeTime) - num(old?.totalEncodeTime)
  const dFrames = num(out.framesEncoded) - num(old?.framesEncoded)
  const w = num(out.frameWidth)
  const h = num(out.frameHeight)
  const ql = typeof out.qualityLimitationReason === 'string' && QL.has(out.qualityLimitationReason as QualityLimitationReason)
    ? out.qualityLimitationReason as QualityLimitationReason
    : 'none'
  return {
    targetBitrateBps: num(out.targetBitrate),
    currentCapBps: ctx.currentCapBps,
    qualityLimitationReason: ql,
    fractionLost: num(remote?.fractionLost),
    rttMs: num(remote?.roundTripTime) * 1000,
    fps: num(out.framesPerSecond),
    frameHeight: Number.isNaN(w) || Number.isNaN(h) ? Number.NaN : Math.min(w, h),
    encodeMsPerFrame: dFrames > 0 && dTime >= 0 ? (dTime / dFrames) * 1000 : Number.NaN,
    codec: CODEC_BY_MIME[mime] ?? 'VP8',
    hardwareEncoder: out.powerEfficientEncoder === true,
    canSwitchCodec: ctx.canSwitchCodec,
    videoEnabled: ctx.videoEnabled,
  }
}
