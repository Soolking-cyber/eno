// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mediaElementCaptureSupported, resetCompressionAudioForTests, takeCompressionAudioContext, unlockCompressionAudio } from './compression-audio'

// The tap that opens a video picker starts the AudioContext a compressed clip's sound needs (2026-10-17: every compressed
// upload came out as digital silence) — iOS runs one only from a gesture, Chromium only once the page has had one.

class FakeContext {
  static made = 0
  static all: FakeContext[] = []
  state: string
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  constructor() { FakeContext.made++; FakeContext.all.push(this); this.state = 'suspended' }
}

const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
const realCapture = proto.captureStream

beforeEach(() => {
  resetCompressionAudioForTests()
  FakeContext.made = 0
  FakeContext.all = []
  vi.stubGlobal('AudioContext', FakeContext)
  delete proto.captureStream
  delete proto.mozCaptureStream
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (realCapture) proto.captureStream = realCapture
  else delete proto.captureStream
})

describe('compression audio — the iOS unlock', () => {
  it('WebKit (no captureStream): the tap starts and resumes ONE context, which the compressor takes once', () => {
    expect(mediaElementCaptureSupported()).toBe(false)
    unlockCompressionAudio()
    unlockCompressionAudio()
    expect(FakeContext.made).toBe(1)
    const ctx = takeCompressionAudioContext() as unknown as FakeContext
    expect(ctx.resume).toHaveBeenCalled()
    expect(ctx.state).toBe('running')
    // Handed over once: the next compression without a fresh tap gets a new (possibly suspended) one, never a closed one.
    const next = takeCompressionAudioContext() as unknown as FakeContext
    expect(next).not.toBe(ctx)
    expect(FakeContext.made).toBe(2)
  })

  it('Chromium/Firefox (captureStream) too: decoding is the in-step way everywhere, so the tap starts the context there as well', () => {
    proto.captureStream = () => null
    expect(mediaElementCaptureSupported()).toBe(true)
    unlockCompressionAudio()
    expect(FakeContext.made).toBe(1)
  })

  it('⛔ never throws from the click handler — a browser without Web Audio, or a constructor that throws', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => unlockCompressionAudio()).not.toThrow()
    expect(takeCompressionAudioContext()).toBeNull()
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('NotAllowed') } })
    expect(() => unlockCompressionAudio()).not.toThrow()
    expect(takeCompressionAudioContext()).toBeNull()
  })

  it('a context the page closed is never handed over', () => {
    unlockCompressionAudio()
    const first = takeCompressionAudioContext() as unknown as FakeContext
    first.state = 'closed'
    unlockCompressionAudio()
    const second = takeCompressionAudioContext() as unknown as FakeContext
    expect(second).not.toBe(first)
    expect(second.state).not.toBe('closed')
  })

  it('a context nobody takes (picker cancelled, a clip that needs no compression) is closed after 5 minutes; a taken one is not', () => {
    vi.useFakeTimers()
    try {
      unlockCompressionAudio()
      const unused = FakeContext.all[0]
      vi.advanceTimersByTime(5 * 60_000 + 1)
      expect(unused.close).toHaveBeenCalled()
      // The next compression without a tap gets a fresh context, never the closed one.
      expect(takeCompressionAudioContext()).not.toBe(unused)

      unlockCompressionAudio()
      const taken = takeCompressionAudioContext() as unknown as FakeContext
      vi.advanceTimersByTime(10 * 60_000)
      expect(taken.close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a context Safari left "interrupted" (Photos picker, a call) is resumed by the next tap — not only a suspended one', () => {
    unlockCompressionAudio()
    const ctx = FakeContext.all[0]
    ctx.state = 'interrupted'
    ctx.resume.mockClear()
    unlockCompressionAudio()
    expect(ctx.resume).toHaveBeenCalledTimes(1)
  })
})
