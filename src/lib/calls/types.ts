/**
 * In-app calls — the shared vocabulary of the call modules (design: ~/eno-calls-research-2026-10/DESIGN.md v3).
 *
 * 1:1 calls run on the platform WebRTC engine, always relay-only, DTLS-SRTP keys only on the two phones (the 4-emoji
 * safety code was removed in protocol v2 — owner, 2026-10-22: "the 4 pin remove that thing"). Every module under src/lib/calls/ is PURE (no React, no DOM beyond WebRTC/WebCrypto
 * types, no DB) so it is pinned by tests rather than by rendering a call.
 *
 * ⚠️ PEERS RUN DIFFERENT BUILDS. Capacitor remote mode and long-open tabs keep old JS alive for days, so anything
 * two peers must agree on (event shapes, the codec plan) is versioned by
 * CALL_PROTOCOL_VERSION and decided ONCE by one side — never computed independently on both and assumed equal.
 */

/**
 * Bump on any change two peers must agree on. The server refuses a pair whose versions differ ("reload to call").
 * 2 (2026-10-22): the safety code's commit / nonce / reveal left the start, the accept, the 'accepted' event and the
 * snapshot, and the 'reveal' event is gone.
 */
export const CALL_PROTOCOL_VERSION = 2

export type CallMedia = 'audio' | 'video'
export type CallRole = 'caller' | 'callee'

export type CodecName = 'H264' | 'VP8' | 'VP9' | 'AV1' | 'H265'

/** What one device can do for one codec — from RTCRtpSender/Receiver.getCapabilities + mediaCapabilities. */
export interface CodecSupport {
  codec: CodecName
  /** H.264 only: 'high' (640c1f) or 'cbp' (42e01f). */
  profile?: 'high' | 'cbp'
  encode: boolean
  decode: boolean
  /** mediaCapabilities.encodingInfo({type:'webrtc'}).powerEfficient — i.e. a hardware encoder. */
  powerEfficientEncode?: boolean
  /** mediaCapabilities.decodingInfo({type:'webrtc'}).powerEfficient. */
  powerEfficientDecode?: boolean
}

/**
 * A device's capability report, sent in the invite (caller) and the accept (callee). Coarse on purpose: device-tier
 * guesses from deviceMemory/cores are unreliable (Safari exposes neither; octa-core A53 phones report 8 cores), so
 * the call starts conservative and promotes from live stats — this report only bounds what is POSSIBLE.
 */
export interface CapabilityReport {
  v: number
  codecs: CodecSupport[]
  /** The tallest frame this device wants to RECEIVE (≤540 on a ≤3 GB phone: one WebView renderer hosts the page too). */
  maxRecvHeight: number
  /** The tallest frame this device is willing to SEND. */
  maxSendHeight: number
  platform: 'android' | 'ios' | 'desktop' | 'other'
  app: 'capacitor-ios' | 'capacitor-android' | 'browser'
  /** navigator.deviceMemory (Chromium only; a power-of-two bucket clamped to [0.25, 8]) — a hint, never a tier. */
  deviceMemory?: number
  /** Android 12+ Build.SOC_MODEL, passed by the native shell when present. */
  socModel?: string
}

/** The end reasons a CallSession can record. 'lost' = no heartbeat/media for the deadline. */
export type CallEndReason =
  | 'hangup'
  | 'declined'
  | 'missed'
  | 'cancelled'
  | 'unavailable'
  | 'lost'
  | 'blocked'
  | 'kill_switch'
  | 'cap_reached'
  | 'media_failed'
  | 'sas_mismatch' // legacy: protocol v1's safety code (removed in v2) — stored rows and old beacons still carry it
  | 'protocol_mismatch'
