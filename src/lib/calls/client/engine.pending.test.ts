import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * engine.ts — (1) THE RING BEFORE ITS DETAILS: a ring shows at once and fills in who is calling when GET /api/calls/:id
 * answers (retried for the whole ring); Answer waits for them (detailsPending — §4: see who is calling, about what,
 * before answering); a cancel, answered_elsewhere, a change of account or details that say "no longer ringing" while
 * they load clear the screen, and the late details draw nothing; accept() awaits the details in flight instead of
 * asking again. (2) THE VIDEO SWITCH PAUSES CAMERAS: `videoAllowed` false from the accept or a heartbeat turns the camera
 * off and keeps it off — the call goes on.
 */
const h = vi.hoisted(() => ({
  details: vi.fn(),
  accept: vi.fn(),
  heartbeat: vi.fn(),
  decline: vi.fn(async () => ({ ended: true })),
  camStop: vi.fn(),
  replaced: [] as (unknown | null)[],
  several: null as Promise<boolean> | null,
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getCallDetails: h.details,
  acceptCallRequest: h.accept,
  heartbeatRequest: h.heartbeat,
  declineCallRequest: h.decline,
  fetchSnapshot: async () => null,
  sendSignal: async () => 'ok',
  endBeacon: () => {},
  telemetryBeacon: () => {},
  getRingingCall: async () => null,
}))
vi.mock('./media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./media')>()),
  getMicrophone: async () => ({ kind: 'audio', enabled: true, stop: () => {} }) as unknown as MediaStreamTrack,
  getCamera: async () => ({ kind: 'video', stop: h.camStop, getSettings: () => ({}) }) as unknown as MediaStreamTrack,
  hasSeveralCameras: async () => (h.several ? h.several : false),
  capabilityReport: async () => ({ v: 2, codecs: [] }),
}))
vi.mock('./realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./realtime')>()),
  joinChannel: async (_topic: string, handlers: { onStatus?: (s: string) => void }) => {
    queueMicrotask(() => handlers.onStatus?.('SUBSCRIBED'))
    return { close: () => {} }
  },
}))

import { callEngine } from './engine'
import { CallApiError } from './api'
import { CALL_PROTOCOL_VERSION } from '../types'

let n = 0
const details = (callId: string, o: Record<string, unknown> = {}) => ({
  callId, conversationId: 'cmuh33qrd000301no3mhk7h75', media: 'audio', role: 'callee', state: 'ringing', endReason: null,
  protocolVersion: CALL_PROTOCOL_VERSION, ringingAt: new Date().toISOString(), ringTimeoutSec: 45, ringRemainingMs: 40_000, connectedAt: null,
  peer: { name: 'Lan', avatarUrl: null, verified: true, memberSince: null, side: 'seller' }, listing: { id: 'l1', title: 'Sofa' }, ...o,
})
function deferred<T>() {
  let resolve: (v: T) => void = () => {}
  let reject: (e: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0))
/** A call id no earlier test used (the engine is one per page; negotiation.ts wants a UUID). */
const nextId = () => `6f1c2b3a-4d5e-4f60-8a7b-${String(++n).padStart(12, '0')}`

beforeEach(() => {
  h.details.mockReset(); h.accept.mockReset(); h.heartbeat.mockReset(); h.decline.mockClear(); h.camStop.mockReset(); h.replaced = []; h.several = null
  h.heartbeat.mockResolvedValue({ state: 'connected', capInMs: null })
})
afterEach(() => { callEngine.shutdown() })

describe('the ring shows before its details', () => {
  it('drawn AT ONCE with a placeholder (no name, Answer waiting), filled in when the details arrive', async () => {
    const callId = nextId()
    const d = deferred<unknown>()
    h.details.mockReturnValueOnce(d.promise)
    const done = callEngine.onRing(callId)
    expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId, role: 'callee', detailsPending: true, peer: null, listing: null })
    expect(callEngine.busy).toBe(true)
    d.resolve(details(callId))
    await done
    expect(callEngine.getView()).toMatchObject({ phase: 'incoming', callId, detailsPending: false, peer: { name: 'Lan' }, listing: { title: 'Sofa' } })
    expect(callEngine.getView().ringUntil).toBeGreaterThan(Date.now())
  })

  it('the details are asked for again until they come — not just twice', async () => {
    vi.useFakeTimers()
    try {
      const callId = nextId()
      h.details
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new CallApiError('network_error', 502))
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(details(callId))
      const done = callEngine.onRing(callId)
      await vi.advanceTimersByTimeAsync(10_000)
      await done
      expect(h.details).toHaveBeenCalledTimes(4)
      expect(callEngine.getView()).toMatchObject({ phase: 'incoming', detailsPending: false, peer: { name: 'Lan' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a cancel (or answered elsewhere) while the details load clears the screen, and the late details draw nothing', async () => {
    for (const why of ['cancelled', 'answered_elsewhere'] as const) {
      const callId = nextId()
      const d = deferred<unknown>()
      h.details.mockReturnValueOnce(d.promise)
      const done = callEngine.onRing(callId)
      callEngine.stopRinging(callId, why)
      expect(callEngine.getView().phase).toBe('idle')
      expect(callEngine.busy).toBe(false)
      d.resolve(details(callId))
      await done
      expect(callEngine.getView().phase).toBe('idle')
      // …and the same ring never comes back (a late broadcast, the resubscribe's GET /api/calls/ringing).
      await callEngine.onRing(callId)
      expect(callEngine.getView().phase).toBe('idle')
    }
  })

  it('details that say it is no longer ringing (or not mine) drop the ring quietly', async () => {
    for (const o of [{ state: 'ended', endReason: 'cancelled' }, { state: 'accepted' }, { role: 'caller' }]) {
      const callId = nextId()
      h.details.mockResolvedValueOnce(details(callId, o))
      await callEngine.onRing(callId)
      expect(callEngine.getView().phase, JSON.stringify(o)).toBe('idle')
    }
    // A clear "not found" from the box ends the asking too.
    const callId = nextId()
    h.details.mockRejectedValueOnce(new CallApiError('not_found', 404))
    await callEngine.onRing(callId)
    expect(h.details).toHaveBeenCalledTimes(4)
    expect(callEngine.getView().phase).toBe('idle')
  })

  it('a change of account while the details load drops the ring — never filled in for the next account', async () => {
    const callId = nextId()
    const d = deferred<unknown>()
    h.details.mockReturnValueOnce(d.promise)
    const done = callEngine.onRing(callId)
    callEngine.shutdown()
    expect(callEngine.getView().phase).toBe('idle')
    d.resolve(details(callId))
    await done
    expect(callEngine.getView()).toMatchObject({ phase: 'idle', peer: null })
    expect(callEngine.busy).toBe(false)
  })

  it('a ring that times out before its details came just goes — no "Missed call" card over a blank header', async () => {
    vi.useFakeTimers()
    try {
      const callId = nextId()
      h.details.mockImplementation(() => new Promise(() => {})) // never answers
      void callEngine.onRing(callId)
      await vi.advanceTimersByTimeAsync(46_000)
      expect(callEngine.getView().phase).toBe('idle')
    } finally {
      h.details.mockReset()
      vi.useRealTimers()
    }
  })

  it('a decline while the details load ends the ring by its id', async () => {
    const callId = nextId()
    h.details.mockReturnValueOnce(new Promise(() => {}))
    void callEngine.onRing(callId)
    await callEngine.decline()
    expect(h.decline).toHaveBeenCalledWith(callId)
    expect(callEngine.getView().phase).toBe('idle')
  })

  it('accept() awaits the details in flight — never asks a second time', async () => {
    const callId = nextId()
    const d = deferred<unknown>()
    h.details.mockReturnValueOnce(d.promise)
    void callEngine.onRing(callId)
    h.accept.mockRejectedValueOnce(new CallApiError('call_gone', 409))
    const accepting = callEngine.accept()
    expect(callEngine.getView()).toMatchObject({ phase: 'preparing', callId, detailsPending: false })
    await flush()
    expect(h.accept).not.toHaveBeenCalled() // still waiting for who is calling
    d.resolve(details(callId))
    await accepting
    expect(h.details).toHaveBeenCalledTimes(1)
    expect(h.accept).toHaveBeenCalledTimes(1)
    expect(callEngine.getView()).toMatchObject({ phase: 'ended', error: 'call_gone', peer: { name: 'Lan' } })
    callEngine.reset()
  })

  it('accept() while the details load, and they say the ring is over: no microphone, no accept — "This call has ended"', async () => {
    const callId = nextId()
    const d = deferred<unknown>()
    h.details.mockReturnValueOnce(d.promise)
    void callEngine.onRing(callId)
    const accepting = callEngine.accept()
    d.resolve(details(callId, { state: 'ended', endReason: 'cancelled' }))
    await accepting
    expect(h.accept).not.toHaveBeenCalled()
    expect(callEngine.getView()).toMatchObject({ phase: 'ended', error: 'call_gone' })
    callEngine.reset()
  })
})

// ── the video switch pauses cameras ─────────────────────────────────────────────────────────────────────────────────

class FakeStream {
  private tracks: unknown[]
  constructor(tracks: unknown[] = []) { this.tracks = [...tracks] }
  getTracks() { return this.tracks }
  addTrack(t: unknown) { this.tracks.push(t) }
}
class FakePc {
  connectionState = 'new'
  iceConnectionState = 'new'
  iceGatheringState = 'new'
  private video = {
    receiver: { track: { kind: 'video' } },
    sender: {
      track: null as unknown,
      replaceTrack: async (t: unknown) => { h.replaced.push(t) },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async () => {},
    },
    direction: 'recvonly',
  }
  getTransceivers() { return [this.video] }
  getSenders() { return [this.video.sender] }
  addTransceiver() { return this.video }
  async getStats() { return new Map() }
  close() {}
}

describe('the video switch turns cameras off instead of ending the call', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaStream', FakeStream)
    vi.stubGlobal('RTCPeerConnection', FakePc)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const engine = callEngine as unknown as { active: unknown; beat(a: unknown): Promise<void> }
  async function answerVideoCall(videoAllowed: boolean | undefined) {
    const callId = nextId()
    h.details.mockResolvedValueOnce(details(callId, { media: 'video' }))
    await callEngine.onRing(callId)
    h.accept.mockResolvedValueOnce({ relay: { provider: 'cloudflare', iceServers: [], iceTransportPolicy: 'relay', expiresAt: 0 }, conversationId: 'c', media: 'video', videoAllowed })
    await callEngine.accept()
    await flush()
    return callId
  }

  it('paused at the answer: no camera, the call goes on', async () => {
    await answerVideoCall(false)
    expect(callEngine.getView()).toMatchObject({ phase: 'connecting', media: 'video', videoPaused: true, cameraOn: false })
    await callEngine.toggleCamera() // the button is gone; a stray call opens nothing either
    expect(callEngine.getView().cameraOn).toBe(false)
    expect(h.camStop).not.toHaveBeenCalled()
  })

  it('a heartbeat saying video is off turns the camera OFF (no track) and keeps the call; back on, the button returns', async () => {
    await answerVideoCall(true)
    expect(callEngine.getView().videoPaused).toBe(false)
    await callEngine.toggleCamera()
    expect(callEngine.getView().cameraOn).toBe(true)

    h.heartbeat.mockResolvedValueOnce({ state: 'connected', capInMs: null, videoAllowed: false })
    await engine.beat(engine.active)
    expect(callEngine.getView()).toMatchObject({ phase: 'connecting', videoPaused: true, cameraOn: false, remoteVideoLive: false })
    expect(h.replaced.at(-1)).toBeNull()
    expect(h.camStop).toHaveBeenCalledTimes(1)
    expect(engine.active).not.toBeNull()

    h.heartbeat.mockResolvedValueOnce({ state: 'connected', capInMs: null, videoAllowed: true })
    await engine.beat(engine.active)
    expect(callEngine.getView()).toMatchObject({ videoPaused: false, cameraOn: false })
  })

  it('a pause that lands while the camera is turning on: never shown as on, and the next tap turns it ON (second opinion)', async () => {
    await answerVideoCall(true)
    const d = deferred<boolean>()
    h.several = d.promise
    const turningOn = callEngine.toggleCamera()
    await flush()
    h.heartbeat.mockResolvedValueOnce({ state: 'connected', capInMs: null, videoAllowed: false })
    await engine.beat(engine.active)
    d.resolve(true)
    await turningOn
    expect(callEngine.getView()).toMatchObject({ videoPaused: true, cameraOn: false })
    expect(h.camStop).toHaveBeenCalledTimes(1)
    h.several = null
    h.heartbeat.mockResolvedValueOnce({ state: 'connected', capInMs: null, videoAllowed: true })
    await engine.beat(engine.active)
    await callEngine.toggleCamera()
    expect(callEngine.getView().cameraOn).toBe(true)
  })

  it('a box that does not say (older build) changes nothing', async () => {
    await answerVideoCall(undefined)
    await engine.beat(engine.active)
    expect(callEngine.getView().videoPaused).toBe(false)
  })
})
