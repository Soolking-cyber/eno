import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * engine.ts startCall — the one call button places a video-capable call where the pair may use video (camera off), and
 * a start refused at a gate only VIDEO has goes again as a voice call: the button's state can be older than the refusal
 * (commit-gate review, codex + opus — the other person's verification lapsed after the page loaded).
 */
const h = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('./media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./media')>()),
  getMicrophone: async () => ({ kind: 'audio', stop: h.stop }) as unknown as MediaStreamTrack,
  capabilityReport: async () => ({ v: 2, codecs: [] }),
}))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), startCallRequest: h.start }))

import { callEngine } from './engine'
import { CallApiError } from './api'

const media = () => h.start.mock.calls.map(([, body]) => (body as { media: string }).media)

describe('startCall — one button, voice when only video is refused', () => {
  beforeEach(() => {
    h.start.mockReset()
    h.stop.mockReset()
    callEngine.reset()
  })

  it('a video start refused for a video-only reason is placed again as voice, with the same start id', async () => {
    h.start
      .mockRejectedValueOnce(new CallApiError('calls_peer_not_verified', 403))
      .mockResolvedValueOnce({ kind: 'unavailable', callId: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b' })
    await callEngine.startCall('cmuh33qrd000301no3mhk7h75', 'video', null, null)
    expect(media()).toEqual(['video', 'audio'])
    const ids = h.start.mock.calls.map(([, body]) => (body as { startId: string }).startId)
    expect(ids[0]).toBe(ids[1])
    expect(callEngine.getView()).toMatchObject({ phase: 'ended', endReason: 'unavailable', media: 'audio' })
  })

  it('the video switch off (calls_unavailable) also falls back; if voice is refused too, the refusal shows', async () => {
    h.start
      .mockRejectedValueOnce(new CallApiError('calls_unavailable', 403))
      .mockRejectedValueOnce(new CallApiError('calls_unavailable', 403))
    await callEngine.startCall('cmuh33qrd000301no3mhk7h75', 'video', null, null)
    expect(media()).toEqual(['video', 'audio'])
    expect(callEngine.getView().error).toBe('calls_unavailable')
    expect(h.stop).toHaveBeenCalled() // the microphone is never left open
  })

  it('no retry for a refusal that is not about video, nor for a voice start', async () => {
    h.start.mockRejectedValueOnce(new CallApiError('calls_consent_required', 403))
    await callEngine.startCall('cmuh33qrd000301no3mhk7h75', 'video', null, null)
    expect(media()).toEqual(['video'])
    callEngine.reset()
    h.start.mockReset()
    h.start.mockRejectedValueOnce(new CallApiError('calls_peer_not_verified', 403))
    await callEngine.startCall('cmuh33qrd000301no3mhk7h75', 'audio', null, null)
    expect(media()).toEqual(['audio'])
    expect(callEngine.getView().error).toBe('calls_peer_not_verified')
  })
})
