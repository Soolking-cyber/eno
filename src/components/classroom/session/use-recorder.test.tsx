// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { LIMITS } from '@/lib/classroom/constants'

vi.mock('./trace', () => ({ mark: () => {} }))

/**
 * THE MICROPHONE'S HEALTH (owner, 2026-10-28, "fix both": a microphone that ended or was muted mid-session left "Listening"
 * up to the deadline). The hook's media world is faked: tracks, the stream, the context, the worklet node.
 */
class FakeTrack {
  readyState: 'live' | 'ended' = 'live'
  muted = false
  onmute: (() => void) | null = null
  onunmute: (() => void) | null = null
  onended: (() => void) | null = null
  stopped = false
  stop() { this.stopped = true; this.readyState = 'ended' }
}
const fakeStream = () => {
  const track = new FakeTrack()
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream }
}

type FakeNode = { port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: Mock }; connect: Mock; disconnect: Mock }
let node: FakeNode
vi.stubGlobal('AudioWorkletNode', function FakeWorkletNode() {
  node = { port: { onmessage: null, postMessage: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
  return node
})

function fakeCtx() {
  const listeners: Record<string, (() => void)[]> = {}
  const sources: { connect: Mock; disconnect: Mock; stream: MediaStream }[] = []
  const ctx = {
    state: 'running' as string,
    sampleRate: 48_000,
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: vi.fn((stream: MediaStream) => {
      const s = { connect: vi.fn(), disconnect: vi.fn(), stream }
      sources.push(s)
      return s
    }),
    resume: vi.fn(async () => { ctx.state = 'running' }),
    addEventListener: (type: string, f: () => void) => { (listeners[type] ??= []).push(f) },
    removeEventListener: (type: string, f: () => void) => { listeners[type] = (listeners[type] ?? []).filter((x) => x !== f) },
    emit: (type: string) => (listeners[type] ?? []).forEach((f) => f()),
    sources,
  }
  return ctx
}

const gum = vi.fn()
Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true })

const { useRecorder } = await import('./use-recorder')

async function setup() {
  const states: string[] = []
  const first = fakeStream()
  gum.mockResolvedValueOnce(first.stream)
  const hook = renderHook(() => useRecorder({ speechStart() {}, speechEnd() {}, autoStop() {}, mic: (m) => states.push(m) }))
  const ctx = fakeCtx()
  await act(async () => { await hook.result.current.prepare(ctx as unknown as AudioContext) })
  return { hook, ctx, first, states }
}
/** As a browser does: the flag first, then the event. */
const mute = (t: FakeTrack) => { t.muted = true; t.onmute?.() }
const unmute = (t: FakeTrack) => { t.muted = false; t.onunmute?.() }
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const frame = (values: number[]) => act(() => { node.port.onmessage!({ data: new Float32Array(values) }) })

const visibility = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
beforeEach(() => { gum.mockReset(); visibility('visible') })
afterEach(() => { vi.useRealTimers() })

describe('useRecorder — the microphone as the browser reports it', () => {
  it('muted by the system (a call, Siri): paused — unmuted: on', async () => {
    const { first, states } = await setup()
    act(() => { mute(first.track) })
    act(() => { unmute(first.track) })
    expect(states).toEqual(['paused', 'on'])
  })

  it('⛔ a track that ENDS: paused — and nothing is asked by itself (no prompt, no hidden-page retake); the tap takes it again', async () => {
    const { hook, ctx, first, states } = await setup()
    act(() => { first.track.onended!() })
    await flush()
    expect(states).toEqual(['paused'])
    expect(gum).toHaveBeenCalledTimes(1)
    const second = fakeStream()
    gum.mockResolvedValueOnce(second.stream)
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(states).toEqual(['paused', 'on'])
    expect(ctx.sources).toHaveLength(2)
    expect(ctx.sources[0].disconnect).toHaveBeenCalled()
    expect(ctx.sources[1].connect).toHaveBeenCalledWith(node)
    expect(first.track.stopped).toBe(true)
    expect(second.track.onended).toBeTypeOf('function')
  })

  it('two taps at once ask ONCE (single flight)', async () => {
    const { hook, first } = await setup()
    act(() => { first.track.onended!() })
    let grant!: (s: MediaStream) => void
    gum.mockReturnValueOnce(new Promise<MediaStream>((r) => { grant = r }))
    const a = hook.result.current.resume()
    const b = hook.result.current.resume()
    grant(fakeStream().stream)
    await act(async () => { await Promise.all([a, b]) })
    expect(gum).toHaveBeenCalledTimes(2)
  })

  it('a REFUSAL (NotAllowedError): lost — said, never an end; a later tap that works brings it back', async () => {
    const { hook, first, states } = await setup()
    act(() => { first.track.onended!() })
    gum.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(states).toEqual(['paused', 'lost'])
    gum.mockResolvedValueOnce(fakeStream().stream)
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(states).toEqual(['paused', 'lost', 'on'])
  })

  it('a passing failure (NotReadableError): still paused, not lost', async () => {
    const { hook, first, states } = await setup()
    act(() => { first.track.onended!() })
    gum.mockRejectedValueOnce(Object.assign(new Error('busy'), { name: 'NotReadableError' }))
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(states).toEqual(['paused'])
  })

  it('a grant slower than its time (a prompt still up): still paused — the late microphone is stopped', async () => {
    vi.useFakeTimers()
    const { hook, first, states } = await setup()
    act(() => { first.track.onended!() })
    let grant!: (s: MediaStream) => void
    gum.mockReturnValueOnce(new Promise<MediaStream>((r) => { grant = r }))
    const tap = hook.result.current.resume()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100) })
    await act(async () => { await tap })
    expect(states).toEqual(['paused'])
    const late = fakeStream()
    grant(late.stream)
    await flush()
    expect(late.track.stopped).toBe(true)
  })

  it('the tap during an INTERRUPTION (a live, unmuted track): only the audio resumed — the working microphone is kept', async () => {
    const { hook, ctx, first, states } = await setup()
    ctx.state = 'interrupted'
    ctx.resume.mockImplementationOnce(async () => {}) // still interrupted when the context's listener runs
    act(() => ctx.emit('statechange'))
    expect(states).toEqual(['paused'])
    await act(async () => { await hook.result.current.resume() })
    expect(gum).toHaveBeenCalledTimes(1)
    expect(first.track.stopped).toBe(false)
    expect(ctx.state).toBe('running')
    act(() => ctx.emit('statechange'))
    expect(states).toEqual(['paused', 'on'])
  })

  it('the tap on a MUTED track: a fresh microphone (the tap always does something — commit review, codex)', async () => {
    const { hook, first } = await setup()
    act(() => { mute(first.track) })
    gum.mockResolvedValueOnce(fakeStream().stream)
    await act(async () => { await hook.result.current.resume() })
    expect(gum).toHaveBeenCalledTimes(2)
  })

  it('a fresh microphone that comes back ALREADY muted stays paused; one already ended is not a recovery', async () => {
    const { hook, first, states } = await setup()
    act(() => { first.track.onended!() })
    const muted = fakeStream()
    muted.track.muted = true
    gum.mockResolvedValueOnce(muted.stream)
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(states).toEqual(['paused'])
    const dead = fakeStream()
    dead.track.readyState = 'ended'
    gum.mockResolvedValueOnce(dead.stream)
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(states).toEqual(['paused'])
  })

  it('at prepare(): a context already suspended, or a track that came muted or ended — paused at once', async () => {
    const states: string[] = []
    gum.mockResolvedValueOnce(fakeStream().stream)
    const hook = renderHook(() => useRecorder({ speechStart() {}, speechEnd() {}, autoStop() {}, mic: (m) => states.push(m) }))
    const ctx = fakeCtx()
    ctx.state = 'suspended'
    ctx.resume.mockImplementationOnce(async () => {})
    await act(async () => { await hook.result.current.prepare(ctx as unknown as AudioContext) })
    expect(states).toEqual(['paused'])
    expect(ctx.resume).toHaveBeenCalled()

    const states2: string[] = []
    const muted = fakeStream()
    muted.track.muted = true
    gum.mockResolvedValueOnce(muted.stream)
    const hook2 = renderHook(() => useRecorder({ speechStart() {}, speechEnd() {}, autoStop() {}, mic: (m) => states2.push(m) }))
    await act(async () => { await hook2.result.current.prepare(fakeCtx() as unknown as AudioContext) })
    expect(states2).toEqual(['paused'])

    const states3: string[] = []
    const ended = fakeStream()
    ended.track.readyState = 'ended'
    gum.mockResolvedValueOnce(ended.stream)
    const hook3 = renderHook(() => useRecorder({ speechStart() {}, speechEnd() {}, autoStop() {}, mic: (m) => states3.push(m) }))
    await act(async () => { await hook3.result.current.prepare(fakeCtx() as unknown as AudioContext) })
    expect(states3).toEqual(['paused'])
  })

  it('the tap resumes the context BEFORE it waits for a fresh microphone (the iOS gesture is only good until the first await)', async () => {
    const { hook, ctx, first } = await setup()
    act(() => { first.track.onended!() })
    ctx.state = 'suspended'
    let grant!: (s: MediaStream) => void
    gum.mockReturnValueOnce(new Promise<MediaStream>((r) => { grant = r }))
    const tap = hook.result.current.resume()
    expect(ctx.resume).toHaveBeenCalled() // synchronously, in the tap
    grant(fakeStream().stream)
    await act(async () => { await tap })
  })

  it('refused, then the ORIGINAL microphone unmutes: on again — "lost" never outlives a microphone that works', async () => {
    const { hook, first, states } = await setup()
    act(() => { mute(first.track) })
    gum.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(states).toEqual(['paused', 'lost'])
    act(() => { unmute(first.track) })
    expect(states).toEqual(['paused', 'lost', 'on'])
  })

  it('the original microphone unmutes WHILE the fresh one is asked, and the ask is refused: on — never "lost" over a working microphone', async () => {
    const { hook, first, states } = await setup()
    act(() => { mute(first.track) })
    let refuse!: (e: unknown) => void
    gum.mockReturnValueOnce(new Promise<MediaStream>((_, reject) => { refuse = reject }))
    const tap = hook.result.current.resume()
    act(() => { unmute(first.track) })
    refuse(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    await act(async () => { await tap })
    await flush()
    expect(states.at(-1)).toBe('on')
    expect(states).not.toContain('lost')
  })

  it('a graph that throws while the fresh microphone is wired: the old one kept, the new one stopped — and the next tap asks again', async () => {
    const { hook, ctx, first } = await setup()
    act(() => { first.track.onended!() })
    const fresh = fakeStream()
    gum.mockResolvedValueOnce(fresh.stream)
    ctx.createMediaStreamSource.mockImplementationOnce(() => { throw new Error('InvalidStateError') })
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(fresh.track.stopped).toBe(true)
    expect(first.track.onended).toBeTypeOf('function') // still the current stream's handlers
    gum.mockResolvedValueOnce(fakeStream().stream)
    await act(async () => { await hook.result.current.resume() })
    await flush()
    expect(gum).toHaveBeenCalledTimes(3)
  })

  it('release() after a pause tells the page "on" — a next prepare() on the same hook never inherits a stale "stopped"', async () => {
    const { hook, first, states } = await setup()
    act(() => { mute(first.track) })
    act(() => hook.result.current.release())
    expect(states).toEqual(['paused', 'on'])
    expect(first.track.stopped).toBe(true)
    expect(first.track.onended).toBeNull()
  })

  it('no guessing from the sound: streaming in total silence for a minute is still "on"', async () => {
    vi.useFakeTimers()
    const { hook, states } = await setup()
    act(() => hook.result.current.stream())
    for (let i = 0; i < 60; i++) {
      act(() => { node.port.onmessage!({ data: new Float32Array(4) }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    }
    expect(states).toEqual([])
  })
})

describe('the drill clip limit (constants.ts LIMITS.clipSeconds)', () => {
  it('is past the turn cap, and a clip that long still fits the turn route\'s body cap', () => {
    expect(LIMITS.clipSeconds).toBeGreaterThan(LIMITS.turnSeconds)
    expect(LIMITS.clipSeconds * 16_000 * 2 + 44).toBeLessThanOrEqual(LIMITS.turnBytes)
  })
})
