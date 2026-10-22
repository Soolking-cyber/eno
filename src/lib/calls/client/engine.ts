import { CALL_PROTOCOL_VERSION, type CallEndReason, type CallMedia, type CallRole, type CapabilityReport } from '../types'
import type { CallEvent, ClientEvent, ResyncSnapshot } from '../protocol'
import { createNegotiation, step as negotiate, type NegotiationEffect, type NegotiationInput, type NegotiationState, type TimerName } from '../negotiation'
import {
  commit as commitTo, computeSas, fingerprintPairEqual, fingerprintsByRole, fingerprintsFromStats, generateNonce, nonceFromHex,
  parseFingerprint, SasError, sasFailureVerdict, toHex, verifyCommit, type FingerprintPair,
} from '../sas'
import type { SasEmoji } from '../sas-emoji'
import { buildPlan, directionsFor, parseCodecPlan, videoCodecPreferences, audioCodecPreferences, type CodecPlan, type DirectionPlan } from '../codec-plan'
import { createLadder, step as climb, type LadderState, type LadderAction } from '../ladder'
import { normalizeLocalSdp, prepareRemoteSdp, sdpFingerprint, validateRemoteSdp } from '../sdp-guard'
import { summarizeStats } from '../telemetry'
import {
  TAB_ID, CallApiError, abandonStart, acceptCallRequest, declineCallRequest, endBeacon, getRingingCall, outcomeUnknown, fetchSnapshot, getCallDetails, getThreadCallState,
  heartbeatRequest, revealRequest, sendSignal, startCallRequest, telemetryBeacon, type CallDetails, type RelayGrant,
} from './api'
import { callTopic, joinChannel, type CallChannel } from './realtime'
import { buildCapabilityReport, getCamera, getMicrophone, hasSeveralCameras, mediaFailure } from './media'
import { inboundPackets, inboundVideoFrames, ladderSample } from './stats'
import { registerEngineShutdown } from './presence'
import { logError } from '@/lib/log'

/**
 * In-app calls — THE CALL ENGINE: one module-level singleton per page that owns the RTCPeerConnection, the media and
 * every timer of the one call this tab is in (DESIGN.md v3 §3.1–§3.2). React only RENDERS it (useSyncExternalStore
 * over subscribe/getView); a re-render, a route change or a remount can never drop a call.
 *
 * It is glue around the pure, separately reviewed modules — and holds their invariants, which a pure module cannot:
 *   · negotiation.ts: its effects run STRICTLY in emission order, each awaited (opChain), `now` is a monotonic clock
 *     (performance.now), `createOffer`/`createAnswer` mean create AND setLocalDescription, and the caller hands every
 *     offer the one codec plan it built. The instanceId is fresh per call.
 *   · sas.ts: the caller's commitment fingerprint fpA comes from RTCCertificate.getFingerprints() (sha-256) of the fresh
 *     certificate it is about to use — DTLS has not run yet, so getStats has nothing — and is checked against
 *     getStats' own reading of that certificate at the first connect (a mismatch there ends the call); never from SDP.
 *     A fresh certificate per call, kept for the call's life (an ICE restart keeps it); C and callId frozen
 *     before nB leaves; nB frozen before nA leaves; the certificate pair read from getStats ≥ 60 ms after each DTLS
 *     'connected', frozen at the first, and the call ended when it moves. Every failure goes through
 *     sasFailureVerdict; no reveal 10 s after connecting is a mismatch.
 *   · codec-plan.ts: the caller builds the plan ONCE, after the accept brings the callee's report, and sends it with
 *     every offer; each side orders codecs for the direction it RECEIVES before every createOffer / createAnswer.
 *   · ladder.ts: one step's actions in ONE setParameters call, never two at once.
 *   · sdp-guard.ts: the peer's description is validated, then prepared, right before setRemoteDescription; our own is
 *     normalised right before it is sent — never munged before setLocalDescription.
 *   · telemetry.ts: tSec floored from the monotonic clock, summaries never allowed to throw into the call.
 * ⚠️ NO RESUME ACROSS A RELOAD. The tab id is per page load (api.ts); a page that goes away hangs up by beacon.
 */

export type CallPhase = 'idle' | 'preparing' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'reconnecting' | 'ended'
export type SasView =
  | { state: 'waiting' }
  | { state: 'ready'; emoji: readonly SasEmoji[] }
  | { state: 'mismatch' }
  | { state: 'cannot_verify' }

export interface CallView {
  phase: CallPhase
  callId: string | null
  conversationId: string | null
  role: CallRole | null
  media: CallMedia
  peer: CallDetails['peer'] | null
  listing: CallDetails['listing'] | null
  muted: boolean
  cameraOn: boolean
  /** Incoming video stays blurred until the person taps it, and again after any gap in it (§4). */
  remoteVideoRevealed: boolean
  remoteVideoLive: boolean
  /** A second camera exists (front / back) — the screen offers a switch while the camera is on. */
  canSwitchCamera: boolean
  facing: 'user' | 'environment'
  peerOnHold: boolean
  sas: SasView
  /** Date.now() of the first connection, for the timer on screen. */
  connectedAt: number | null
  /** Date.now() at which the box's 2 h cap ends the call (heartbeat), for the 1:55 warning. */
  capAt: number | null
  endReason: CallEndReason | 'answered_elsewhere' | null
  /** A refusal or failure the screen explains (an API code or a media failure). */
  error: string | null
  quality: 'good' | 'poor' | null
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  /** Ring timeout (ms epoch) for an incoming or outgoing ring. */
  ringUntil: number | null
}

const IDLE: CallView = {
  phase: 'idle', callId: null, conversationId: null, role: null, media: 'audio', peer: null, listing: null,
  muted: false, cameraOn: false, remoteVideoRevealed: false, remoteVideoLive: false, canSwitchCamera: false, facing: 'user', peerOnHold: false,
  sas: { state: 'waiting' }, connectedAt: null, capAt: null, endReason: null, error: null, quality: null,
  localStream: null, remoteStream: null, ringUntil: null,
}

const STATS_EVERY_MS = 1_000
const HEARTBEAT_EVERY_MS = 15_000
const TELEMETRY_EVERY_MS = 30_000
/** The callee's wait for the caller's reveal after connecting; a last snapshot read decides before it fails. */
const REVEAL_DEADLINE_MS = 20_000
const HALF_TRICKLE_MS = 300
const HALF_TRICKLE_MAX_MS = 1_500

const now = () => performance.now()
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Active {
  callId: string
  conversationId: string
  role: CallRole
  media: CallMedia
  pc: RTCPeerConnection
  cert: RTCCertificate
  neg: NegotiationState
  timers: Map<TimerName, ReturnType<typeof setTimeout>>
  opChain: Promise<void>
  sendChain: Promise<void>
  channel: CallChannel | null
  mic: MediaStreamTrack
  cam: MediaStreamTrack | null
  facing: 'user' | 'environment'
  /** A camera change in flight: a second tap waits rather than opening a second camera nobody would ever stop. */
  cameraBusy: boolean
  remote: MediaStream
  myCaps: CapabilityReport
  peerCaps: CapabilityReport | null
  plan: CodecPlan | null
  localNegId: number
  firstRelayAt: number | null
  // safety code
  commitIds: { caller: string; callee: string }
  commitment: string | null
  nA: Uint8Array | null
  nB: Uint8Array | null
  frozenPair: FingerprintPair | null
  remoteSdpFp: string | null
  revealTimer: ReturnType<typeof setTimeout> | null
  // quality, liveness, telemetry
  ladder: LadderState | null
  settingParams: boolean
  canSwitchCodec: boolean
  statsTimer: ReturnType<typeof setInterval> | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  lastReport: RTCStatsReport | null
  lastTelemetryReport: RTCStatsReport | null
  lastTelemetryAt: number
  telemetrySeq: number
  startedAt: number
  restarts: number
  packets: number | null
  packetsChangedAt: number
  videoFrames: number | null
  videoFramesChangedAt: number
  everConnected: boolean
  wakeLock: WakeLockLike | null
  ended: boolean
}

type WakeLockLike = { release(): Promise<void>; addEventListener?(type: 'release', listener: () => void): void }

type Listener = () => void

class CallEngine {
  private view: CallView = IDLE
  private listeners = new Set<Listener>()
  private active: Active | null = null
  private ringing: { details: CallDetails; until: number } | null = null
  private ringTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Bumped by every start / answer, and by anything that abandons one in flight (End on "Starting…", a sign-out):
   * each await in startCall / accept re-checks it, and a stale attempt cleans up what it made instead of going on.
   */
  private attempt = 0
  /**
   * Bumped by shutdown (a change of account): a ring whose details were still loading belongs to the OLD account and is
   * dropped when they arrive — never drawn for the next one (client review).
   */
  private epoch = 0
  /** Rings hidden on THIS page (one that cannot answer) — never shown again; the call rings the other devices. */
  private dismissed = new Set<string>()
  /**
   * A start whose request went out and has not answered yet. pagehide gives it up (abandonStart, keepalive): closing
   * the tab on "Starting…" must not leave the other person ringing with nobody here (client review).
   */
  private pendingStart: { conversationId: string; startId: string } | null = null
  /** An answer whose accept request went out and has not answered yet (same reason, the callee's side). */
  private pendingAccept: string | null = null
  /**
   * cancel / answered_elsewhere for a ring this page had not shown yet — its details still loading (client review: the
   * late details then drew a ring that was already over). Bounded; a ring id is never reused.
   */
  private endedRings = new Set<string>()

  // ── store ─────────────────────────────────────────────────────────────────────────────────────────────────────
  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  getView = (): CallView => this.view
  private set(patch: Partial<CallView>) {
    this.view = { ...this.view, ...patch }
    for (const l of this.listeners) l()
  }
  /** In a call, starting or answering one, or being rung (client review: a start from a thread must not wipe a ring). */
  get busy(): boolean { return this.active !== null || this.view.phase === 'preparing' || this.ringing !== null }

  /** Dismiss the end screen. */
  reset() {
    if (this.active || this.view.phase === 'incoming' || this.view.phase === 'preparing') return
    const wasEnded = this.view.phase === 'ended'
    this.set({ ...IDLE })
    if (wasEnded) this.recheckRinging()
  }

  // ── outgoing (§3.2 steps 1–2) ──────────────────────────────────────────────────────────────────────────────────
  async startCall(conversationId: string, media: CallMedia, peer: CallView['peer'], listing: CallView['listing']): Promise<void> {
    if (this.busy) return
    const my = ++this.attempt
    const stale = () => my !== this.attempt
    this.set({ ...IDLE, phase: 'preparing', conversationId, role: 'caller', media, peer, listing })
    let mic: MediaStreamTrack | null = null
    // From the moment the box answers 'ringing', the call exists there: every way out below must end it (abandon).
    let ringingId: string | null = null
    // The start went out: if its answer never comes back (a timeout), the box may be ringing them anyway.
    let startSent = false
    // This attempt's own id: a give-up names exactly this start, never a later one from the same tab. (randomUUID is
    // part of webrtcAvailable's check, so a page without it never shows a call button.)
    const startId = crypto.randomUUID()
    try {
      const thread = await getThreadCallState(conversationId)
      if (stale()) return
      const allowed = media === 'video' ? thread.video : thread.audio
      if (allowed !== 'ok' || !thread.commitIds) return this.fail(allowed !== 'ok' ? allowed : 'calls_unavailable')
      try { mic = await getMicrophone() } catch (e) { return this.fail(`media_${mediaFailure(e)}`) }
      if (stale()) return void mic.stop()
      const cert = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' } as EcKeyGenParams)
      const fpA = certificateDigest(cert)
      const nA = generateNonce()
      const commitment = await commitTo({ nA, fpA, callerId: thread.commitIds.caller, calleeId: thread.commitIds.callee })
      const myCaps = await buildCapabilityReport()
      if (stale()) return void mic.stop()
      startSent = true
      this.pendingStart = { conversationId, startId }
      const res = await startCallRequest(conversationId, { v: CALL_PROTOCOL_VERSION, media, tabId: TAB_ID, commit: commitment, capabilities: myCaps, startId })
      if (this.pendingStart?.startId === startId) this.pendingStart = null
      if (res.kind === 'ringing') ringingId = res.callId
      if (stale()) return this.abandon(mic, ringingId, 'cancelled')
      if (res.kind === 'merge') {
        mic.stop()
        this.set({ phase: 'idle' })
        return this.accept(res.callId)
      }
      if (res.kind === 'unavailable') {
        mic.stop()
        return this.set({ phase: 'ended', endReason: 'unavailable', callId: res.callId })
      }
      const active = this.createActive({
        callId: res.callId, conversationId, role: 'caller', media, relay: res.relay, cert, mic, myCaps,
        commitIds: thread.commitIds, commitment, nA, nB: null,
      })
      this.set({ phase: 'outgoing', callId: res.callId, ringUntil: Date.now() + res.ringTimeoutSec * 1000 })
      // The reducer exists BEFORE the channel can deliver anything (an early 'accepted' must land in it).
      const created = createNegotiation({ role: 'caller', callId: res.callId, tabId: TAB_ID, instanceId: instanceId(), now: now() })
      active.neg = created.state
      this.run(created.effects)
      await this.joinCallChannel(active)
      if (this.active !== active) return // hung up (or shut down) while joining: teardown already ran
      this.startLoops(active)
    } catch (e) {
      this.abandon(mic, ringingId, 'cancelled')
      // No answer at all (a timeout, the network) after the start went out: end whatever the box made from this tab —
      // the call id never reached us (client review: the other person rang on with nobody there). An error the box
      // DID answer means nothing was made.
      if (this.pendingStart?.startId === startId) this.pendingStart = null
      if (startSent && !ringingId && outcomeUnknown(e)) abandonStart(conversationId, startId)
      if (!stale()) this.fail(e instanceof CallApiError ? e.code : 'call_failed')
    }
  }

  // ── incoming (§3.2 steps 2–3) ──────────────────────────────────────────────────────────────────────────────────
  /** A ring on ring:<me>. Shows the incoming screen unless this tab is already in a call. */
  async onRing(callId: string): Promise<void> {
    if (this.busy || this.ringing?.details.callId === callId || this.dismissed.has(callId) || this.endedRings.has(callId)) return
    // Two loads of the same ring at once (the broadcast and a resubscribe) both draw the SAME ring — harmless, and never
    // a ring lost because a first load failed (review).
    const epoch = this.epoch
    let details: CallDetails
    try { details = await getCallDetails(callId) } catch { return }
    if (epoch !== this.epoch) return
    if (details.role !== 'callee' || details.state !== 'ringing' || !details.commit || !details.commitIds) return
    if (this.busy || this.endedRings.has(callId) || this.dismissed.has(callId)) return
    // The SERVER's remaining ring (its clock, not this phone's — client review: a phone running fast rang for 1 s).
    const ringFor = Math.max(1_000, Math.min(details.ringTimeoutSec * 1000, details.ringRemainingMs))
    this.ringing = { details, until: Date.now() + ringFor }
    this.set({
      ...IDLE, phase: 'incoming', callId, conversationId: details.conversationId, role: 'callee', media: details.media,
      peer: details.peer, listing: details.listing, ringUntil: Date.now() + ringFor,
    })
    if (this.ringTimer) clearTimeout(this.ringTimer)
    this.ringTimer = setTimeout(() => this.stopRinging(callId, 'missed'), ringFor)
  }

  /**
   * Is the ring on screen still ringing at the box? Asked when ring:<me> carried something this build could not read:
   * a cancel or answered_elsewhere lost that way would ring on to the deadline, and asking for "a ringing call" cannot
   * stop one (commit-gate review, opus). By THIS call's id, so a ring that began meanwhile is never the one stopped.
   */
  async recheckIncoming(): Promise<void> {
    const callId = this.ringing?.details.callId
    if (!callId) return
    let details: CallDetails
    try { details = await getCallDetails(callId) } catch { return }
    // accept() clears `ringing` before its first await (below), so an answer landing mid-accept stops nothing here.
    if (this.ringing?.details.callId !== callId || details.state === 'ringing') return
    // What the box says happened, from this side (session.ts endReasonFor): taken or turned down on another of my
    // devices, the ring just goes; timed out there is missed; any other ending is the caller's (commit-gate review).
    const why = details.state !== 'ended' || details.endReason === 'declined' || details.endReason === 'hangup'
      ? 'answered_elsewhere'
      : details.endReason === 'missed' ? 'missed' : 'cancelled'
    this.stopRinging(callId, why)
  }

  /** cancel / answered_elsewhere on ring:<me>, or the ring timing out here. */
  stopRinging(callId: string, why: 'missed' | 'cancelled' | 'answered_elsewhere') {
    // EVERY ring that stopped here is remembered (client review): a local decline still retrying, or a local time-out
    // the box has not caught up with, must not come back from GET /api/calls/ringing on the next resubscribe.
    this.endedRings.add(callId)
    if (this.endedRings.size > 50) this.endedRings.delete(this.endedRings.values().next().value as string)
    if (this.ringing?.details.callId !== callId) return
    this.ringing = null
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null }
    // The end card keeps who rang and this side's role (client review): "Missed call" with their name and face — not the
    // caller's "No answer" over a blank avatar.
    if (this.view.phase === 'incoming') {
      this.set(why === 'answered_elsewhere' ? { ...IDLE } : {
        ...IDLE, phase: 'ended', endReason: why, callId, role: 'callee', media: this.view.media, peer: this.view.peer, listing: this.view.listing,
      })
    }
  }

  async decline(): Promise<void> {
    const r = this.ringing
    if (!r) return
    this.stopRinging(r.details.callId, 'cancelled')
    this.set({ ...IDLE })
    // RETRIED until the box answers (client review): one lost request left the caller ringing while this screen showed
    // the call gone. Any answer from the box — declined, already over — ends the retrying.
    for (let i = 0; i < 4; i++) {
      try {
        await declineCallRequest(r.details.callId)
        return
      } catch (e) {
        // A clear answer from the box (gone, not found …) ends the retrying; a rate limit or an unknown outcome does not.
        if (!outcomeUnknown(e) && !(e instanceof CallApiError && e.status === 429)) return
        if (i === 3) logError(e, { op: 'calls.decline' })
        else await sleep(500 * 2 ** i)
      }
    }
  }

  /**
   * Hide the ring on THIS screen only — a page that cannot answer (the Android shell, an in-app browser). Nothing is
   * sent: the call keeps ringing the person's other devices, which is where this screen told them to answer.
   */
  dismissRing() {
    const r = this.ringing
    if (!r) return
    this.dismissed.add(r.details.callId)
    this.ringing = null
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null }
    this.set({ ...IDLE })
  }

  /**
   * The account behind this page changed (signed out, or someone else signed in): whatever call or ring it held ends
   * with that account — a live microphone must never outlive the screen that can hang it up (client review). The end
   * is sent by beacon; if the old session is already gone the box ends the call at its next missed heartbeat.
   */
  shutdown() {
    this.attempt++
    this.epoch++
    this.giveUpInFlight()
    const a = this.active
    if (a) {
      if (!a.ended) endBeacon(a.callId, a.role === 'caller' && !a.everConnected ? 'cancelled' : 'hangup')
      this.teardown(a, 'hangup', 'local')
    }
    this.ringing = null
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null }
    this.dismissed.clear()
    this.set({ ...IDLE })
  }

  /** Answer: mic FIRST (a tab that cannot capture never takes the call from the person's other devices), then accept. */
  async accept(callId?: string): Promise<void> {
    const id = callId ?? this.ringing?.details.callId
    if (!id || this.active) return
    const my = ++this.attempt
    const stale = () => my !== this.attempt
    let details = this.ringing?.details.callId === id ? this.ringing.details : null
    this.ringing = null
    if (this.ringTimer) { clearTimeout(this.ringTimer); this.ringTimer = null }
    this.set({ phase: 'preparing', callId: id })
    let mic: MediaStreamTrack | null = null
    // Once the accept is in, the call is this page's on the box: every way out below must end it (abandon).
    let accepted = false
    let acceptSent = false
    // Ended on "Answering…" before the accept went in: that is a decline, for every device of this person.
    const gaveUp = () => { mic?.stop(); void declineCallRequest(id).catch((e) => logError(e, { op: 'calls.declineAbandoned' })) }
    try {
      if (!details) details = await getCallDetails(id)
      if (stale()) return gaveUp()
      // ⚠️ FROZEN HERE, BEFORE nB EXISTS (sas.ts): the commitment, its ids and the call id — never re-read later.
      const commitment = details.commit
      const commitIds = details.commitIds
      if (details.role !== 'callee' || !commitment || !commitIds) return this.fail('call_gone')
      this.set({ conversationId: details.conversationId, role: 'callee', media: details.media, peer: details.peer, listing: details.listing })
      try { mic = await getMicrophone() } catch (e) {
        // ONE device that cannot capture: the call keeps ringing the person's other devices (the box ignores 'media').
        await declineCallRequest(id, 'media').catch((e) => logError(e, { op: 'calls.declineMedia' }))
        return this.fail(`media_${mediaFailure(e)}`)
      }
      if (stale()) return gaveUp()
      const cert = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' } as EcKeyGenParams)
      const nB = generateNonce()
      const myCaps = await buildCapabilityReport()
      if (stale()) return gaveUp()
      acceptSent = true
      this.pendingAccept = id
      const res = await acceptCallRequest(id, { v: CALL_PROTOCOL_VERSION, tabId: TAB_ID, nonce: toHex(nB), capabilities: myCaps })
      if (this.pendingAccept === id) this.pendingAccept = null
      accepted = true
      if (stale()) return this.abandon(mic, id, 'hangup')
      const active = this.createActive({
        callId: id, conversationId: details.conversationId, role: 'callee', media: details.media, relay: res.relay, cert, mic,
        myCaps, commitIds, commitment, nA: null, nB,
      })
      this.set({ phase: 'connecting', ringUntil: null })
      const created = createNegotiation({ role: 'callee', callId: id, tabId: TAB_ID, instanceId: instanceId(), now: now() })
      active.neg = created.state
      this.run(created.effects)
      await this.joinCallChannel(active)
      if (this.active !== active) return // hung up (or shut down) while joining: teardown already ran
      this.dispatch({ type: 'accepted', now: now() })
      this.startLoops(active)
    } catch (e) {
      // An accept that never answered may still have gone in (client review): end it by id — the box reads that as a
      // decline if it is still ringing, and as this tab's hang-up if the accept had landed.
      if (this.pendingAccept === id) this.pendingAccept = null
      const maybeAccepted = accepted || (acceptSent && outcomeUnknown(e))
      this.abandon(mic, maybeAccepted ? id : null, 'hangup')
      if (!stale()) this.fail(e instanceof CallApiError ? e.code : 'call_failed')
    }
  }

  // ── in-call controls ───────────────────────────────────────────────────────────────────────────────────────────
  hangup() {
    const a = this.active
    if (!a) {
      // Still preparing — the mic prompt, the certificate, the start or accept in flight: abandon the attempt. It sees
      // the bump at its next step and undoes what it made, including a call the box already holds (client review: End
      // did nothing on "Starting…", and a hung request trapped the screen there).
      if (this.view.phase === 'preparing') {
        this.attempt++
        this.giveUpInFlight()
        this.set({ ...IDLE })
      }
      return
    }
    this.dispatch({ type: 'localEnd', now: now(), reason: a.neg.phase === 'idle' && a.role === 'caller' ? 'cancelled' : 'hangup' })
  }

  toggleMute() {
    const a = this.active
    if (!a) return
    a.mic.enabled = !a.mic.enabled
    this.set({ muted: !a.mic.enabled })
  }

  async toggleCamera(): Promise<void> {
    const a = this.active
    if (!a || a.media !== 'video' || a.cameraBusy) return
    const sender = videoSender(a)
    if (!sender) return
    a.cameraBusy = true
    try {
      if (a.cam) {
        const cam = a.cam
        a.cam = null
        // Off means NO track (createActive): the other phone sees their frames stop and shows the header again.
        await sender.replaceTrack(null).catch((e) => logError(e, { op: 'calls.cameraOff' }))
        cam.stop()
        this.set({ cameraOn: false, localStream: new MediaStream([a.mic]) })
        return
      }
      const cam = await getCamera(a.facing)
      if (this.active !== a || a.ended) { cam.stop(); return }
      a.cam = cam
      await sender.replaceTrack(cam)
      await this.applyStartRung(a)
      this.set({ cameraOn: true, localStream: new MediaStream([a.mic, cam]), canSwitchCamera: await hasSeveralCameras() })
    } catch (e) {
      this.set({ error: `media_${mediaFailure(e)}` })
    } finally {
      a.cameraBusy = false
    }
  }

  /**
   * Front ↔ back camera while it is on. The old camera stops FIRST — many phones cannot open two at once — and if the
   * other one will not open, the one it had comes back; failing that, the camera is off.
   */
  async switchCamera(): Promise<void> {
    const a = this.active
    if (!a || !a.cam || a.cameraBusy) return
    const sender = videoSender(a)
    if (!sender) return
    a.cameraBusy = true
    const next: 'user' | 'environment' = a.facing === 'user' ? 'environment' : 'user'
    try {
      a.cam.stop()
      let facing = next
      let cam: MediaStreamTrack
      try { cam = await getCamera(next) } catch { facing = a.facing; cam = await getCamera(a.facing) }
      if (this.active !== a || a.ended) { cam.stop(); return }
      a.cam = cam
      a.facing = facing
      await sender.replaceTrack(cam)
      await this.applyStartRung(a)
      this.set({ facing, localStream: new MediaStream([a.mic, cam]) })
    } catch (e) {
      a.cam = null
      await sender.replaceTrack(null).catch((err) => logError(err, { op: 'calls.cameraSwitchOff' }))
      this.set({ cameraOn: false, localStream: new MediaStream([a.mic]), error: `media_${mediaFailure(e)}` })
    } finally {
      a.cameraBusy = false
    }
  }

  revealRemoteVideo() { this.set({ remoteVideoRevealed: true }) }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────────────────────────
  private fail(code: string) {
    this.set({ ...IDLE, phase: 'ended', error: code, callId: this.view.callId, peer: this.view.peer, listing: this.view.listing })
  }

  /**
   * A ring that came while this tab was busy — starting, answering, in a call, or showing how one ended — was skipped
   * (onRing). Asked again at the one moment the tab is truly free: its end screen just closed (reset). Nothing on
   * screen is replaced, and a call whose answer failed may ring again for a second try. getRingingCall never throws.
   */
  private recheckRinging() {
    void getRingingCall().then((callId) => { if (callId && !this.busy && this.view.phase === 'idle') void this.onRing(callId) })
  }

  /**
   * A start or an answer still waiting for the box, given up NOW — not when its request finally answers, up to 15 s
   * later, with the other person ringing all the while (client review). The start: by its id (abandonStart). The
   * answer: an end by call id, which the box reads as a decline if it still rings and as this tab's hang-up if the
   * accept had landed. Whatever the request then answers is cleaned up by the stale attempt (abandon) — both are
   * idempotent.
   */
  private giveUpInFlight() {
    const p = this.pendingStart
    if (p) { this.pendingStart = null; abandonStart(p.conversationId, p.startId) }
    const callId = this.pendingAccept
    if (callId) { this.pendingAccept = null; endBeacon(callId, 'hangup') }
  }

  /**
   * A start or an answer that failed — or was abandoned — AFTER the box already holds the call: tear down whatever this
   * page built (peer connection, microphone, channel, timers) and tell the box, so the other person is never left
   * ringing, or alone on a dead line, until a heartbeat times out (client review: the catch path only showed an error,
   * left the microphone live and `active` set — and with it a Close button that could not close).
   */
  private abandon(mic: MediaStreamTrack | null, callId: string | null, reason: 'cancelled' | 'hangup') {
    const a = this.active
    if (a && a.callId === callId) {
      if (!a.ended) endBeacon(a.callId, reason)
      this.teardown(a, reason, 'local')
      return
    }
    mic?.stop()
    if (callId) endBeacon(callId, reason)
  }

  private createActive(o: {
    callId: string; conversationId: string; role: CallRole; media: CallMedia; relay: RelayGrant; cert: RTCCertificate
    mic: MediaStreamTrack; myCaps: CapabilityReport; commitIds: { caller: string; callee: string }; commitment: string
    nA: Uint8Array | null; nB: Uint8Array | null
  }): Active {
    const pc = new RTCPeerConnection({
      iceServers: o.relay.iceServers,
      iceTransportPolicy: 'relay',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      certificates: [o.cert],
      iceCandidatePoolSize: 1,
    })
    const remote = new MediaStream()
    const a: Active = {
      callId: o.callId, conversationId: o.conversationId, role: o.role, media: o.media, pc, cert: o.cert,
      neg: undefined as unknown as NegotiationState, timers: new Map(), opChain: Promise.resolve(), sendChain: Promise.resolve(),
      channel: null, mic: o.mic, cam: null, facing: 'user', cameraBusy: false, remote, myCaps: o.myCaps, peerCaps: null, plan: null, localNegId: 0,
      firstRelayAt: null, commitIds: o.commitIds, commitment: o.commitment, nA: o.nA, nB: o.nB, frozenPair: null,
      remoteSdpFp: null, revealTimer: null, ladder: null, settingParams: false, canSwitchCodec: false, statsTimer: null,
      heartbeatTimer: null, lastReport: null, lastTelemetryReport: null, lastTelemetryAt: now(), telemetrySeq: 0,
      startedAt: now(), restarts: 0, packets: null, packetsChangedAt: now(), videoFrames: null, videoFramesChangedAt: 0,
      everConnected: false, wakeLock: null, ended: false,
    }
    this.active = a
    if (o.role === 'caller') {
      // The caller's transceivers exist before the first offer; the callee's come from the offer (and get our
      // tracks, sendrecv, right before createAnswer — remote-offer transceivers default to recvonly).
      pc.addTransceiver(o.mic, { direction: 'sendrecv', streams: [new MediaStream([o.mic])] })
      // ⚠️ NO TRACK while the camera is off — not a black placeholder (client review): placeholder frames read as "their
      // camera is on" on the other phone, which then hid the caller's name, verified mark and listing behind a blurred
      // black screen. The cost is a cold bandwidth estimate when the camera turns on; the ladder's start rung covers it.
      if (o.media === 'video') pc.addTransceiver('video', { direction: 'sendrecv' })
    }
    // Whether their video is live comes from the frames actually decoded (tick → inboundVideoFrames), not from mute
    // events, which browsers fire inconsistently for a sender that stopped sending.
    pc.ontrack = (ev) => {
      if (!remote.getTracks().includes(ev.track)) remote.addTrack(ev.track)
      this.set({ remoteStream: remote })
    }
    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !ev.candidate.candidate) return
      if (/ typ relay/.test(ev.candidate.candidate) && a.firstRelayAt === null) a.firstRelayAt = now()
      this.dispatch({ type: 'candidatesGathered', now: now(), negId: a.localNegId, candidates: [toInit(ev.candidate)] })
    }
    pc.oniceconnectionstatechange = () => {
      this.dispatch({ type: 'iceConnectionStateChange', now: now(), state: pc.iceConnectionState })
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') this.onConnected(a)
    }
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') this.onDtlsConnected(a) }
    this.wireMic(a, o.mic)
    this.set({ localStream: new MediaStream([o.mic]), remoteStream: remote })
    return a
  }

  /**
   * Hold (§3.2 step 8): the OS taking the microphone (a GSM call, iOS backgrounding) mutes or ends the track. Wired on
   * EVERY microphone, the reopened one too (client review: a second interruption went unnoticed).
   */
  private wireMic(a: Active, mic: MediaStreamTrack) {
    mic.onmute = () => { if (a.everConnected && a.mic === mic) this.dispatch({ type: 'localHold', now: now() }) }
    mic.onunmute = () => { if (a.everConnected && a.mic === mic) this.dispatch({ type: 'localResume', now: now() }) }
    mic.onended = () => {
      if (!a.everConnected || a.mic !== mic) return
      this.dispatch({ type: 'localHold', now: now() })
      void this.reopenMic(a)
    }
  }

  private async reopenMic(a: Active) {
    for (let i = 0; i < 20 && this.active === a; i++) {
      await sleep(3_000)
      if (document.visibilityState !== 'visible') continue
      let mic: MediaStreamTrack | null = null
      try {
        mic = await getMicrophone()
        // ⛔ The call may have ended while the OS was handing the microphone back (client review, critical): a track
        // nobody holds keeps recording with no screen left to stop it. Checked again after every await.
        if (this.active !== a || a.ended) { mic.stop(); return }
        const sender = a.pc.getSenders().find((s) => s.track?.kind === 'audio' || s.track === a.mic)
        await sender?.replaceTrack(mic)
        if (this.active !== a || a.ended) { mic.stop(); return }
        a.mic = mic
        mic.enabled = !this.view.muted
        this.wireMic(a, mic)
        this.dispatch({ type: 'localResume', now: now() })
        return
      } catch {
        mic?.stop() // never keep a microphone this attempt could not attach — the next one opens its own
      }
    }
  }

  /**
   * Join call:<conversationId> and wait (≤ 5 s) for the first SUBSCRIBED: the callee's 'accepted' input means "accept
   * POST done AND channel subscribed" (negotiation.ts) — a 'ready' sent earlier invites an offer into the void. A later
   * SUBSCRIBED (after a drop) is a resync. Past 5 s the call goes on regardless: the offer is retransmitted and the
   * snapshot polled, so a slow socket costs seconds, not the call.
   */
  private async joinCallChannel(a: Active) {
    let first = true
    let signal: () => void = () => {}
    const subscribed = new Promise<void>((resolve) => { signal = resolve })
    a.channel = await joinChannel(callTopic(a.conversationId), {
      onEvent: (ev) => this.onRemoteEvent(a, ev),
      onVersion: () => { if (this.active === a) this.set({ error: 'protocol_mismatch' }) },
      // Unreadable is not nothing: the snapshot has whatever it was (realtime.ts, broadcast.ts).
      onUnreadable: () => { if (this.active === a) void this.resync(a) },
      onStatus: (s) => {
        if (s !== 'SUBSCRIBED' || this.active !== a) return
        if (first) {
          first = false
          signal()
          // The FIRST subscribe reads the snapshot too (client review): an 'accepted' broadcast before this channel was
          // up was never heard — Postgres has it.
          void this.resync(a)
          return
        }
        if (a.neg) this.dispatch({ type: 'resubscribed', now: now() })
      },
    })
    await Promise.race([subscribed, sleep(5_000)])
  }

  private onRemoteEvent(a: Active, ev: CallEvent) {
    if (this.active !== a || ev.callId !== a.callId) return
    if (ev.kind === 'accepted') {
      // nB, frozen at its first sight; a different one later is an attempt to re-grind the code (sas.ts).
      const nB = safeNonce(ev.payload.calleeNonce)
      if (a.role === 'caller') {
        if (a.nB && nB && toHex(a.nB) !== toHex(nB)) return this.sasFailed(a, 'mismatch')
        if (!a.nB) a.nB = nB
        if (!a.peerCaps && ev.payload.capabilities) a.peerCaps = ev.payload.capabilities as CapabilityReport
        this.set({ phase: 'connecting', ringUntil: null })
      }
    }
    if (ev.kind === 'reveal' && a.role === 'callee') void this.onReveal(a, ev.payload.callerNonce)
    // Hold is taken from the reducer's state after dispatch — it applies hold/resume in SEND order (seq), not arrival.
    this.dispatch({ type: 'remote', now: now(), event: ev })
  }

  private onSnapshot(a: Active, snap: ResyncSnapshot) {
    if (a.role === 'caller' && snap.calleeNonce) {
      const nB = safeNonce(snap.calleeNonce)
      if (a.nB && nB && toHex(a.nB) !== toHex(nB)) return this.sasFailed(a, 'mismatch')
      if (!a.nB) a.nB = nB
    }
    if (a.role === 'callee' && snap.callerReveal) void this.onReveal(a, snap.callerReveal)
    this.dispatch({ type: 'snapshot', now: now(), snapshot: snap })
  }

  // ── the reducer and its effects ────────────────────────────────────────────────────────────────────────────────
  private dispatch(input: NegotiationInput) {
    const a = this.active
    if (!a || a.ended || !a.neg) return
    const r = negotiate(a.neg, input)
    a.neg = r.state
    if (r.state.phase === 'reconnecting' && this.view.phase === 'connected') this.set({ phase: 'reconnecting' })
    if (r.state.peerOnHold !== this.view.peerOnHold) this.set({ peerOnHold: r.state.peerOnHold })
    this.run(r.effects)
  }

  private run(effects: NegotiationEffect[]) {
    const a = this.active
    if (!a) return
    for (const fx of effects) {
      switch (fx.type) {
        case 'send': {
          const event = fx.event
          // ⚠️ AN 'end' GOES STRAIGHT OUT, by beacon — never queued behind a send still in flight (client review: it could
          // wait out a 15 s request while the other person sat on a dead line), and never lost to the teardown that
          // follows in the same batch: it is what frees the other person at once instead of after the 45 s heartbeat.
          if (event.kind === 'end') {
            endBeacon(a.callId, event.payload.reason)
            break
          }
          a.sendChain = a.sendChain.then(async () => {
            const r = await sendSignal(a.callId, event, () => this.active === a && !a.ended)
            if (r === 'gone' && this.active === a) void this.resync(a)
          })
          break
        }
        case 'schedule': {
          const old = a.timers.get(fx.timer)
          if (old) clearTimeout(old)
          const timer = fx.timer
          a.timers.set(timer, setTimeout(() => { a.timers.delete(timer); this.dispatch({ type: 'timer', now: now(), timer }) }, Math.max(0, fx.atMs - now())))
          break
        }
        case 'cancel': {
          const old = a.timers.get(fx.timer)
          if (old) { clearTimeout(old); a.timers.delete(fx.timer) }
          break
        }
        case 'fetchState':
          void this.resync(a)
          break
        case 'endCall':
          this.teardown(a, fx.reason, fx.origin)
          break
        default:
          // RTCPeerConnection effects: strictly in emission order, each awaited (negotiation.ts ⚠️ EFFECTS ARE ORDERED).
          a.opChain = a.opChain.then(() => this.runPcEffect(a, fx)).catch((e) => logError(e, { op: 'calls.pcEffect' }))
      }
    }
  }

  private async resync(a: Active) {
    const snap = await fetchSnapshot(a.callId)
    if (snap && this.active === a) this.onSnapshot(a, snap)
  }

  private async runPcEffect(a: Active, fx: Exclude<NegotiationEffect, { type: 'send' | 'schedule' | 'cancel' | 'fetchState' | 'endCall' }>) {
    if (this.active !== a || a.ended) return
    const pc = a.pc
    try {
      switch (fx.type) {
        case 'createOffer': {
          if (!a.plan) a.plan = buildPlan(a.myCaps, a.peerCaps ?? a.myCaps, a.media)
          this.applyCodecPreferences(a)
          const offer = await pc.createOffer({ iceRestart: fx.iceRestart })
          await pc.setLocalDescription(offer)
          if (fx.iceRestart) a.restarts++
          a.localNegId = fx.negId
          await this.halfTrickle(a)
          const sdp = normalizeLocalSdp(pc.localDescription?.sdp ?? '')
          this.dispatch({ type: 'localDescriptionReady', now: now(), negId: fx.negId, sdp, codecPlan: a.plan, capabilities: a.myCaps })
          return
        }
        case 'createAnswer': {
          a.plan = parseCodecPlan(fx.codecPlan) ?? a.plan
          if (fx.peerCapabilities && !a.peerCaps) a.peerCaps = fx.peerCapabilities as CapabilityReport
          this.attachCalleeTracks(a)
          this.applyCodecPreferences(a)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          a.localNegId = fx.negId
          await this.halfTrickle(a)
          const sdp = normalizeLocalSdp(pc.localDescription?.sdp ?? '')
          this.dispatch({ type: 'localDescriptionReady', now: now(), negId: fx.negId, sdp })
          return
        }
        case 'setRemoteDescription': {
          // ⚠️ The phone's own check is the one that counts (sdp-guard.ts): the box already filtered this.
          if (!validateRemoteSdp(fx.sdp).ok) throw new Error('remote description refused')
          const fp = sdpFingerprint(fx.sdp)
          // A later description naming another certificate is a new DTLS association nobody compared (sas.ts).
          if (a.remoteSdpFp !== null && fp !== a.remoteSdpFp) return this.sasFailed(a, 'mismatch')
          a.remoteSdpFp = fp
          await pc.setRemoteDescription({ type: fx.sdpType, sdp: prepareRemoteSdp(fx.sdp) })
          this.dispatch({ type: 'remoteDescriptionApplied', now: now(), negId: fx.negId })
          return
        }
        case 'addCandidates':
          // A stray candidate the PC refuses (an old generation's, a duplicate) is normal and costs nothing — never fatal.
          for (const c of fx.candidates) await pc.addIceCandidate(c).catch((e) => logError(e, { op: 'calls.addCandidate' }))
          return
        case 'rollback':
          await pc.setLocalDescription({ type: 'rollback' })
          return
      }
    } catch {
      if (fx.type === 'createOffer' || fx.type === 'createAnswer' || fx.type === 'setRemoteDescription') {
        this.dispatch({ type: 'operationFailed', now: now(), negId: fx.negId, op: fx.type })
      }
    }
  }

  /** Half-trickle (§3.2 step 4): the description goes out ≤ 300 ms after the first UDP relay candidate, ≤ 1.5 s in all. */
  private async halfTrickle(a: Active) {
    const started = now()
    while (now() - started < HALF_TRICKLE_MAX_MS) {
      if (a.pc.iceGatheringState === 'complete') return
      if (a.firstRelayAt !== null && now() - a.firstRelayAt >= HALF_TRICKLE_MS) return
      await sleep(50)
    }
  }

  private attachCalleeTracks(a: Active) {
    for (const t of a.pc.getTransceivers()) {
      const kind = t.receiver.track?.kind
      if (kind === 'audio' && t.sender.track !== a.mic) { void t.sender.replaceTrack(a.mic); t.direction = 'sendrecv' }
      if (kind === 'video') {
        // The camera if it is on, else nothing at all (see createActive: never a placeholder).
        const track = a.cam ?? null
        if (t.sender.track !== track) void t.sender.replaceTrack(track)
        t.direction = 'sendrecv'
      }
    }
  }

  /** Order codecs for the direction this side RECEIVES (codec-plan.ts), before every createOffer / createAnswer. */
  private applyCodecPreferences(a: Active) {
    const plan = a.plan
    for (const t of a.pc.getTransceivers()) {
      const kind = t.receiver.track?.kind
      if (typeof t.setCodecPreferences !== 'function' || !kind) continue
      const caps = RTCRtpReceiver.getCapabilities?.(kind)?.codecs
      if (!caps) continue
      try {
        if (kind === 'video') {
          const receive = plan ? directionsFor(plan, a.role).receive : null
          t.setCodecPreferences(videoCodecPreferences(caps, receive))
        } else {
          t.setCodecPreferences(audioCodecPreferences(caps, { useRed: false }))
        }
      } catch { /* a browser that refuses the order keeps its own — the call still works */ }
    }
  }

  // ── connection, safety code, quality ───────────────────────────────────────────────────────────────────────────
  private onConnected(a: Active) {
    if (this.active !== a) return
    if (!a.everConnected) {
      a.everConnected = true
      this.set({ phase: 'connected', connectedAt: Date.now(), ringUntil: null })
      void this.acquireWakeLock(a)
      if (a.role === 'callee') a.revealTimer = setTimeout(() => void this.revealDeadline(a), REVEAL_DEADLINE_MS)
    } else if (this.view.phase === 'reconnecting') {
      this.set({ phase: 'connected' })
    }
  }

  /**
   * Read the certificate pair ≥ 60 ms after each DTLS 'connected' (sas.ts: null means "not yet", never a pass).
   * ⚠️ A MISSING PEER CERTIFICATE IS RE-READ BEFORE IT COUNTS. libwebrtc serves a cached report for 50 ms, so one read
   * can straddle the handshake; only a peer certificate that is STILL missing or unusable after the re-reads is the
   * tamper evidence sas.ts calls a mismatch (commit-gate review C2, round 3). Any other SasError is final at once.
   */
  private async onDtlsConnected(a: Active) {
    let pair: FingerprintPair | null = null
    let rejections = 0
    for (let i = 0; i < 40 && !pair && this.active === a; i++) {
      await sleep(i === 0 ? 80 : 100)
      let report: RTCStatsReport | null = null
      try {
        report = await a.pc.getStats()
        pair = fingerprintsFromStats(report)
      } catch (e) {
        // ⛔ CHROMIUM'S DTLS CLIENT REPORTS NO PEER CERTIFICATE AT ALL: the connected transport carries no
        // remoteCertificateId (measured 2026-10-21 on the first real-relay run — every honest callee read as
        // "intercepted"). The peer's certificate is then the one the browser VERIFIED against the applied remote
        // description's single fingerprint — DTLS-SRTP accepts no other, and sdp-guard refuses a second fingerprint —
        // so that fingerprint is exactly what the stats would have said. A peer certificate that IS reported but
        // unusable stays what it was: tamper evidence (sas.ts).
        if (e instanceof SasError && e.code === 'remote_cert_rejected' && report && noPeerCertificateReported(report)) {
          const verified = sdpVerifiedPair(a)
          if (verified) { pair = verified; break }
        }
        if (e instanceof SasError && e.code === 'remote_cert_rejected' && ++rejections < 5) continue
        const verdict = verdictHere(e)
        this.sasFailed(a, verdict)
        // A caller that cannot VERIFY still owes the callee its reveal — the callee's check does not depend on ours
        // (client review: a Firefox caller fell silent here and the callee's deadline called it interception).
        if (verdict === 'cannot_verify' && a.role === 'caller') await this.revealWhenReady(a)
        return
      }
    }
    if (this.active !== a) return
    if (!pair) {
      this.sasFailed(a, 'cannot_verify')
      if (a.role === 'caller') await this.revealWhenReady(a)
      return
    }
    if (a.frozenPair) {
      if (!fingerprintPairEqual(a.frozenPair, pair)) this.sasFailed(a, 'mismatch')
      return
    }
    a.frozenPair = pair
    if (a.role === 'caller') {
      // Our own certificate as DTLS used it must be the one we committed to.
      if (toHex(pair.local) !== toHex(certificateDigest(a.cert))) return this.sasFailed(a, 'mismatch')
      if (!(await this.revealWhenReady(a))) return
      await this.showCode(a)
    }
    // The callee waits for the reveal (event or snapshot) — onReveal.
  }

  /**
   * The caller's half of the code: once nB is in, reveal nA — RETRIED until the box has it (it answers a repeat of the
   * same nonce quietly), because the callee's check times out without it (client review: one swallowed POST failure
   * ended honest calls as "someone may have listened in"). A missed 'accepted' event is covered by reading the
   * snapshot, which carries nB. False when the call ended or nB never came (that is a mismatch).
   */
  private async revealWhenReady(a: Active): Promise<boolean> {
    if (!a.nB) void this.resync(a)
    await this.waitFor(() => a.nB !== null || this.active !== a, 15_000)
    if (this.active !== a) return false
    if (!a.nB || !a.nA) { this.sasFailed(a, 'mismatch'); return false }
    const nA = toHex(a.nA)
    for (let i = 0; i < 6 && this.active === a; i++) {
      try {
        await revealRequest(a.callId, nA)
        return true
      } catch (e) {
        if (e instanceof CallApiError && e.code === 'reveal_conflict') { this.sasFailed(a, 'mismatch'); return false }
        if (e instanceof CallApiError && (e.code === 'call_gone' || e.code === 'not_found')) return false
        await sleep(Math.min(2_000, 400 * 2 ** i))
      }
    }
    // Never reached the box: the callee cannot check the code, so this screen must not claim it either (client review).
    if (this.active === a) this.sasFailed(a, 'cannot_verify')
    return false
  }

  /** The callee's deadline for the reveal: one last read of the snapshot (it carries the reveal) before it fails. */
  private async revealDeadline(a: Active) {
    if (this.active !== a || this.view.sas.state !== 'waiting') return
    await this.resync(a)
    await this.waitFor(() => this.view.sas.state !== 'waiting' || this.active !== a, 3_000)
    if (this.active === a && this.view.sas.state === 'waiting') this.sasFailed(a, 'mismatch')
  }

  private async onReveal(a: Active, revealHex: string) {
    if (a.role !== 'callee' || a.nA || this.active !== a) return
    const nA = safeNonce(revealHex)
    if (!nA) return this.sasFailed(a, 'mismatch')
    a.nA = nA
    await this.waitFor(() => a.frozenPair !== null || this.active !== a, 15_000)
    if (this.active !== a || !a.frozenPair || !a.commitment) return
    const { fpA } = fingerprintsByRole('callee', a.frozenPair)
    let opens = false
    try {
      opens = await verifyCommit(a.commitment, { nA, fpA, callerId: a.commitIds.caller, calleeId: a.commitIds.callee })
    } catch (e) {
      return this.sasFailed(a, sasFailureVerdict(e))
    }
    if (!opens) return this.sasFailed(a, 'mismatch')
    await this.showCode(a)
  }

  private async showCode(a: Active) {
    if (!a.frozenPair || !a.nA || !a.nB) return
    try {
      const { fpA, fpB } = fingerprintsByRole(a.role, a.frozenPair)
      const code = await computeSas({ callId: a.callId, fpA, fpB, nA: a.nA, nB: a.nB })
      if (a.revealTimer) { clearTimeout(a.revealTimer); a.revealTimer = null }
      if (this.active === a) this.set({ sas: { state: 'ready', emoji: code.emoji } })
    } catch (e) {
      this.sasFailed(a, sasFailureVerdict(e))
    }
  }

  /** 'cannot_verify' is shown and the call goes on; a mismatch ends the call with a warning. */
  private sasFailed(a: Active, verdict: 'mismatch' | 'cannot_verify') {
    if (this.active !== a) return
    if (verdict === 'cannot_verify') {
      if (this.view.sas.state === 'waiting') this.set({ sas: { state: 'cannot_verify' } })
      return
    }
    this.set({ sas: { state: 'mismatch' } })
    this.dispatch({ type: 'localEnd', now: now(), reason: 'sas_mismatch' })
  }

  private async waitFor(cond: () => boolean, maxMs: number) {
    const started = now()
    while (!cond() && now() - started < maxMs) await sleep(100)
  }

  private startLoops(a: Active) {
    a.heartbeatTimer = setInterval(() => void this.beat(a), HEARTBEAT_EVERY_MS)
    void this.beat(a)
    a.statsTimer = setInterval(() => void this.tick(a), STATS_EVERY_MS)
  }

  private async beat(a: Active) {
    if (this.active !== a) return
    let telemetry: unknown
    if (a.everConnected && now() - a.lastTelemetryAt >= TELEMETRY_EVERY_MS && a.lastReport) {
      telemetry = this.summary(a, a.lastReport, false)
      a.lastTelemetryReport = a.lastReport
      a.lastTelemetryAt = now()
    }
    try {
      const r = await heartbeatRequest(a.callId, { connected: a.everConnected, telemetry })
      // The server says how much is LEFT (its clock); this phone adds it to its own now.
      if (this.active === a && r.capInMs !== null) this.set({ capAt: Date.now() + r.capInMs })
    } catch (e) {
      if (e instanceof CallApiError && e.code === 'call_gone' && this.active === a) void this.resync(a)
    }
  }

  private summary(a: Active, report: RTCStatsReport, final: boolean): unknown {
    try {
      return summarizeStats(report, a.lastTelemetryReport, {
        callId: a.callId, role: a.role, seq: a.telemetrySeq++, tSec: Math.floor((now() - a.startedAt) / 1000),
        final, restarts: a.restarts, held: a.neg?.localOnHold ?? false,
      })
    } catch {
      return undefined // telemetry must never end a call (telemetry.ts)
    }
  }

  private async tick(a: Active) {
    if (this.active !== a || a.ended) return
    let report: RTCStatsReport
    try { report = await a.pc.getStats() } catch { return }
    const prev = a.lastReport
    a.lastReport = report
    if (!a.everConnected) return
    // Dead-path detection: inbound packets that stop growing (negotiation.ts packetsStalled), every poll.
    const p = inboundPackets(report)
    if (p !== null && p !== a.packets) { a.packets = p; a.packetsChangedAt = now() }
    this.dispatch({ type: 'packetsStalled', now: now(), stalledMs: p === null ? 0 : now() - a.packetsChangedAt })
    if (a.media === 'video') this.videoLiveness(a, report)
    await this.ladderTick(a, report, prev)
  }

  /**
   * Their video is live while frames keep arriving (inboundVideoFrames): 2 s without a new one — the camera turned off,
   * or a gap — and the screen goes back to the name, verified mark and listing, and the video blurs again until tapped
   * (§4: a stranger's camera can change what it shows).
   */
  private videoLiveness(a: Active, report: RTCStatsReport) {
    const frames = inboundVideoFrames(report)
    if (frames !== null && frames !== a.videoFrames) { a.videoFrames = frames; a.videoFramesChangedAt = now() }
    const live = a.videoFramesChangedAt > 0 && now() - a.videoFramesChangedAt < 2_000
    if (live !== this.view.remoteVideoLive) this.set(live ? { remoteVideoLive: true } : { remoteVideoLive: false, remoteVideoRevealed: false })
  }

  private sendPlan(a: Active): DirectionPlan | null {
    return a.plan ? directionsFor(a.plan, a.role).send : null
  }

  /** The first rung of the plan, applied when the camera turns on (and the ladder created on first use). */
  private async applyStartRung(a: Active) {
    const plan = this.sendPlan(a)
    const sender = videoSender(a)
    if (!plan || !sender) return
    if (!a.ladder) {
      const created = createLadder({ startHeight: plan.startHeight, maxHeight: plan.maxHeight })
      a.ladder = created.state
      await this.applyLadder(a, created.actions)
    }
  }

  private async ladderTick(a: Active, report: RTCStatsReport, prev: RTCStatsReport | null) {
    if (a.media !== 'video' || !a.ladder || a.settingParams) return
    const sender = videoSender(a)
    if (!sender) return
    const enc = sender.getParameters().encodings?.[0]
    const sample = ladderSample(report, prev, {
      currentCapBps: typeof enc?.maxBitrate === 'number' ? enc.maxBitrate : Number.NaN,
      canSwitchCodec: a.canSwitchCodec,
      videoEnabled: a.cam !== null,
    })
    if (!sample) return
    const r = climb(a.ladder, sample, now())
    a.ladder = r.state
    if (r.actions.length) await this.applyLadder(a, r.actions)
  }

  /** One step's actions in ONE setParameters call (ladder.ts). */
  private async applyLadder(a: Active, actions: readonly LadderAction[]) {
    const sender = videoSender(a)
    if (!sender || a.settingParams) return
    a.settingParams = true
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
      const enc = params.encodings[0] as RTCRtpEncodingParameters & { codec?: RTCRtpCodec; scalabilityMode?: string }
      const captureShort = shortSide(a.cam)
      for (const act of actions) {
        switch (act.type) {
          case 'setCap': enc.maxBitrate = act.bps; break
          case 'setScaleToHeight': enc.scaleResolutionDownBy = captureShort ? Math.max(1, captureShort / act.height) : 1; break
          case 'setMaxFramerate': enc.maxFramerate = act.fps; break
          case 'pauseVideo': enc.active = false; break
          case 'resumeVideo': enc.active = true; break
          case 'switchCodec': {
            const list = (params as RTCRtpSendParameters & { codecs?: RTCRtpCodec[] }).codecs ?? []
            const target = list.find((c) => c.mimeType.toLowerCase() === `video/${act.codec.toLowerCase()}`)
            if (target && 'codec' in enc) { enc.codec = target; enc.scalabilityMode = act.scalabilityMode }
            break
          }
          case 'emit':
            this.set({ quality: act.event === 'video_paused' || act.event === 'rung_down' ? 'poor' : act.event === 'rung_up' || act.event === 'video_resumed' ? 'good' : this.view.quality })
            break
        }
      }
      await sender.setParameters(params)
      a.canSwitchCodec = 'codec' in enc
    } catch {
      a.canSwitchCodec = false
    } finally {
      a.settingParams = false
    }
  }

  private async acquireWakeLock(a: Active) {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } }).wakeLock
      if (!wl || document.visibilityState !== 'visible' || this.active !== a) return
      const sentinel = await wl.request('screen')
      a.wakeLock = sentinel
      // The OS releases it whenever the page is hidden: forget it then, so the next 'visible' takes a new one (client
      // review: a released lock still looked held, and long calls let the screen sleep after one trip to the background).
      sentinel.addEventListener?.('release', () => { if (a.wakeLock === sentinel) a.wakeLock = null })
    } catch { /* not granted — the call still works */ }
  }

  /** visibilitychange → visible: the wake lock is released by the OS on hide; take it again. */
  onVisible() {
    const a = this.active
    if (a?.everConnected && !a.wakeLock) void this.acquireWakeLock(a)
    if (a) void this.resync(a)
  }

  /** pagehide: the page is going away — hang up by beacon (§3.2 step 7), there is no resume. */
  onPageHide() {
    if (this.pendingStart || this.pendingAccept) {
      // A start or an answer still waiting for the box: give it up — this page will never hear how it went.
      this.attempt++
      this.giveUpInFlight()
    }
    const a = this.active
    if (!a) return
    endBeacon(a.callId, a.role === 'caller' && !a.everConnected ? 'cancelled' : 'hangup')
    if (a.lastReport && a.everConnected) {
      const s = this.summary(a, a.lastReport, true)
      if (s) telemetryBeacon(a.callId, s)
    }
    // And over HERE too (client review): a page kept in the back/forward cache must not come back holding a live
    // microphone and a call the box was just told is over. Its final summary was just sent.
    this.teardown(a, 'hangup', 'local', { finalStats: false })
  }

  private teardown(a: Active, reason: CallEndReason | 'answered_elsewhere', _origin: 'local' | 'remote', opts: { finalStats?: boolean } = {}) {
    if (a.ended) return
    a.ended = true
    if (opts.finalStats === false) {
      try { a.pc.close() } catch { /* already closed */ }
    } else {
      // The final summary, taken BEFORE close (telemetry.ts).
      void a.pc.getStats().then((report) => {
        const s = this.summary(a, report, true)
        if (s) telemetryBeacon(a.callId, s)
      }).catch((e) => logError(e, { op: 'calls.finalStats' })).finally(() => {
        try { a.pc.close() } catch { /* already closed */ }
      })
    }
    for (const t of a.timers.values()) clearTimeout(t)
    a.timers.clear()
    if (a.statsTimer) clearInterval(a.statsTimer)
    if (a.heartbeatTimer) clearInterval(a.heartbeatTimer)
    if (a.revealTimer) clearTimeout(a.revealTimer)
    a.channel?.close()
    a.mic.stop()
    a.cam?.stop()
    void a.wakeLock?.release().catch((e) => logError(e, { op: 'calls.wakeLock' }))
    if (this.active === a) this.active = null
    this.set({ phase: 'ended', endReason: reason, localStream: null, remoteStream: null, ringUntil: null })
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * sasFailureVerdict, adjusted for the engines it was verified on. "The peer's certificate has no stats" is tamper
 * evidence only where libwebrtc writes the stats (Chrome, Android WebView, Safari, WKWebView — sas review, from
 * source); Firefox was not verified, and an honest Firefox call must never read as interception (commit-gate review
 * C2). There it is "cannot verify".
 */
function verdictHere(e: unknown): 'mismatch' | 'cannot_verify' {
  const v = sasFailureVerdict(e)
  const firefox = typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent)
  return v === 'mismatch' && firefox && e instanceof SasError && e.code === 'remote_cert_rejected' ? 'cannot_verify' : v
}

/** Connected DTLS transports that name no peer certificate at all (not one that is named but unusable). */
function noPeerCertificateReported(report: RTCStatsReport): boolean {
  let connected = 0
  let named = 0
  report.forEach((s: { type?: string; dtlsState?: string; remoteCertificateId?: string }) => {
    if (s.type !== 'transport' || s.dtlsState !== 'connected') return
    connected++
    if (s.remoteCertificateId) named++
  })
  return connected > 0 && named === 0
}

/**
 * The pair from what DTLS verified: our own (only) certificate, and the applied remote description's single sha-256
 * fingerprint (sdp-guard sdpFingerprint, recorded at setRemoteDescription and held constant since). Null if either is
 * unusable — which the caller then treats as it would the stats.
 */
function sdpVerifiedPair(a: Active): FingerprintPair | null {
  if (!a.remoteSdpFp) return null
  try {
    return { local: certificateDigest(a.cert), remote: parseFingerprint('sha-256', a.remoteSdpFp) }
  } catch {
    return null
  }
}

function instanceId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24)
}

function certificateDigest(cert: RTCCertificate): Uint8Array {
  const fp = cert.getFingerprints().find((f) => (f.algorithm ?? '').toLowerCase() === 'sha-256')
  if (!fp?.value) throw new Error('no sha-256 fingerprint on the certificate')
  return parseFingerprint('sha-256', fp.value)
}

function safeNonce(hex: string | null | undefined): Uint8Array | null {
  if (!hex) return null
  try { return nonceFromHex(hex) } catch { return null }
}

function toInit(c: RTCIceCandidate) {
  const j = c.toJSON()
  return {
    candidate: j.candidate ?? '',
    sdpMid: j.sdpMid ?? null,
    sdpMLineIndex: j.sdpMLineIndex ?? null,
    usernameFragment: j.usernameFragment ?? null,
  }
}

function videoSender(a: Active): RTCRtpSender | null {
  return a.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video')?.sender ?? null
}

function shortSide(track: MediaStreamTrack | null): number | null {
  if (!track) return null
  const s = track.getSettings()
  return typeof s.width === 'number' && typeof s.height === 'number' ? Math.min(s.width, s.height) : null
}

/** The page's one engine (module singleton — outside React, so no remount can drop a call). */
export const callEngine = new CallEngine()
// A call may exist from here on: a change of account shuts the engine down, synchronously (call-host.tsx, presence.ts).
registerEngineShutdown(() => callEngine.shutdown())
