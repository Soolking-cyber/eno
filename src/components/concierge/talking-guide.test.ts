import { describe, expect, it, vi } from 'vitest'

const th = vi.hoisted(() => ({ show: null as null | (() => Promise<void>), disposed: 0 }))
vi.mock('@met4citizen/talkinghead', () => ({
  TalkingHead: class {
    controls = { disconnect() {} }
    showAvatar() { return th.show!() }
    dispose() { th.disposed += 1 }
  },
}))
vi.mock('@met4citizen/headaudio/dist/headaudio.min.mjs', () => ({ HeadAudio: class {} }))
import { LIPS_MODEL_URL, LIPS_WORKLET_URL } from '@/lib/concierge/guide-assets'
import { LIP_DELAY_S, attachLips, createGuide, makeStream, resampler, type Head, type Lips } from './talking-guide'

/**
 * The guide's face engine (talking-guide.ts) without a browser: the audio graph it rewires, its stream and its resampler,
 * on fake Web Audio nodes. ⛔ The rewiring is the test that matters: TalkingHead 1.8.2 reaches the speakers by two paths,
 * and HeadAudio's own recipe plays the voice twice, 100 ms apart.
 */

class FakeNode {
  outs: FakeNode[] = []
  constructor(readonly name: string) {}
  connect(n: FakeNode) { this.outs.push(n); return n }
  disconnect() { this.outs = [] }
}
const param = () => ({ value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() })
vi.stubGlobal('DelayNode', class { constructor(_ctx: unknown, o: { delayTime: number }) { return Object.assign(new FakeNode('delay'), { delayTime: o.delayTime }) } })
vi.stubGlobal('GainNode', class { constructor() { return Object.assign(new FakeNode('duck'), { gain: param() }) } })

function rig() {
  const destination = new FakeNode('destination')
  const ctx = { audioWorklet: { addModule: vi.fn(async () => {}) }, destination, sampleRate: 48_000, currentTime: 0, resume: vi.fn(async () => {}) }
  const reverb = new FakeNode('reverb')
  const speechGain = new FakeNode('speechGain')
  const streamGain = new FakeNode('streamGain')
  const analyser = new FakeNode('analyser')
  // TalkingHead's constructor graph (talkinghead.mjs initAudioGraph)
  analyser.connect(speechGain)
  speechGain.connect(reverb)
  streamGain.connect(reverb)
  reverb.connect(destination)
  const head = {
    audioStreamGainNode: streamGain, audioSpeechGainNode: speechGain, audioReverbNode: reverb, audioAnalyzerNode: analyser,
    mtAvatar: { viseme_aa: { newvalue: 0, needsUpdate: false } }, opt: { update: null },
    lookAtCamera: vi.fn(), speakWithHands: vi.fn(),
    streamStart: vi.fn(async () => {}), streamAudio: vi.fn(), streamNotifyEnd: vi.fn(), streamInterrupt: vi.fn(),
  } as unknown as Head & { streamAudio: ReturnType<typeof vi.fn> }
  let lips!: FakeNode & Lips
  const HeadAudio = class {
    constructor() {
      lips = Object.assign(new FakeNode('lips'), {
        loadModel: vi.fn(async () => {}), update: vi.fn(), resetAll: vi.fn(), onvalue: null, onstarted: null, onended: null,
      }) as unknown as FakeNode & Lips
      return lips
    }
  } as unknown as new (ctx: AudioContext, opt: Record<string, unknown>) => Lips
  return { ctx: ctx as unknown as AudioContext & typeof ctx, head, HeadAudio, nodes: { destination, reverb, speechGain, streamGain, analyser }, lips: () => lips }
}

/** Every path from `from` to `to` (a DAG here). */
function paths(from: FakeNode, to: FakeNode, seen: string[] = []): string[][] {
  if (from === to) return [[...seen, from.name]]
  return from.outs.flatMap((n) => paths(n, to, [...seen, from.name]))
}

describe('attachLips — HeadAudio on TalkingHead\'s stream', () => {
  it('⛔ ONE audible path, delayed: the worklet\'s two outputs reach the speakers once, through the delay — the lips tap before it', async () => {
    const r = rig()
    const { duck } = await attachLips(r.head, r.ctx, r.HeadAudio)
    expect(r.ctx.audioWorklet.addModule).toHaveBeenCalledWith(LIPS_WORKLET_URL)
    expect(r.lips().loadModel).toHaveBeenCalledWith(LIPS_MODEL_URL)
    // streamStart connects the playback worklet to the stream gain AND the analyser (talkinghead.mjs streamStart)
    const worklet = new FakeNode('worklet')
    worklet.connect(r.nodes.streamGain)
    worklet.connect(r.nodes.analyser)
    const audible = paths(worklet, r.nodes.destination)
    expect(audible).toEqual([['worklet', 'analyser', 'speechGain', 'delay', 'duck', 'destination']])
    expect(r.nodes.analyser.outs).toContain(r.lips())
    expect(paths(worklet, r.lips() as unknown as FakeNode)).toEqual([['worklet', 'analyser', 'lips']])
    expect((r.nodes.speechGain.outs[0] as unknown as { delayTime: number }).delayTime).toBe(LIP_DELAY_S)
    expect(duck).toBe(r.nodes.speechGain.outs[0].outs[0])
  })

  it('visemes land on the model\'s keys (a key it lacks is skipped), and TalkingHead\'s frame drives the easing', async () => {
    const r = rig()
    await attachLips(r.head, r.ctx, r.HeadAudio)
    r.lips().onvalue!('viseme_aa', 0.5)
    expect(r.head.mtAvatar.viseme_aa).toEqual({ newvalue: 0.5, needsUpdate: true })
    expect(() => r.lips().onvalue!('viseme_nope', 0.4)).not.toThrow()
    r.head.opt.update!(16)
    expect(r.lips().update).toHaveBeenCalledWith(16)
  })
})

describe('makeStream — the guide\'s voice, streamed', () => {
  const setup = async () => {
    const r = rig()
    const { lips, duck } = await attachLips(r.head, r.ctx, r.HeadAudio)
    return { ...r, stream: makeStream(r.head, r.ctx, lips, duck), duck: duck as unknown as { gain: ReturnType<typeof param> } }
  }
  /** 100 ms of the voice server's 24 kHz PCM. */
  const chunk = () => new Int16Array(2_400).fill(1000)

  it('holds a 120 ms pre-roll (the worklet has no jitter buffer), then sends as it comes — resampled to the context\'s rate', async () => {
    const { stream, head } = await setup()
    stream.pushPcm(chunk(), 24_000)
    expect(head.streamAudio).not.toHaveBeenCalled()
    stream.pushPcm(chunk(), 24_000)
    expect(head.streamAudio).toHaveBeenCalledTimes(2)
    const sent = (head.streamAudio.mock.calls as unknown as [{ audio: Int16Array }][]).reduce((n, c) => n + c[0].audio.length, 0)
    expect(Math.abs(sent - 9_600)).toBeLessThanOrEqual(2) // 200 ms at 48 kHz
    stream.pushPcm(chunk(), 24_000)
    expect(head.streamAudio).toHaveBeenCalledTimes(3)
  })

  it('a reply shorter than the pre-roll is still said: endTurn sends what is held, then "no more data"', async () => {
    const { stream, head } = await setup()
    stream.pushPcm(new Int16Array(240).fill(5), 24_000)
    expect(head.streamAudio).not.toHaveBeenCalled()
    stream.endTurn()
    expect(head.streamAudio).toHaveBeenCalledTimes(1)
    expect(head.streamNotifyEnd).toHaveBeenCalledTimes(1)
  })

  it('talked over: the worklet\'s queue goes, the delayed tail is muted then restored, the lips reset — and the next reply pre-rolls again', async () => {
    const { stream, head, duck, lips } = await setup()
    stream.pushPcm(chunk(), 24_000)
    stream.pushPcm(chunk(), 24_000)
    stream.interrupt()
    expect(head.streamInterrupt).toHaveBeenCalledTimes(1)
    expect(duck.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number))
    expect(duck.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, expect.any(Number))
    expect(lips().resetAll).toHaveBeenCalled()
    head.streamAudio.mockClear()
    stream.pushPcm(chunk(), 24_000)
    expect(head.streamAudio).not.toHaveBeenCalled()
  })

  it('unlock resumes the context (in the tap); open is streamStart with the two callbacks', async () => {
    const { stream, head, ctx } = await setup()
    stream.unlock()
    expect(ctx.resume).toHaveBeenCalled()
    const sound = vi.fn()
    const drained = vi.fn()
    await stream.open(sound, drained)
    expect(head.streamStart).toHaveBeenCalledWith({ lipsyncType: 'visemes' }, sound, drained)
  })
})

describe('resampler', () => {
  it('the same rate is the same samples', () => {
    const x = new Int16Array([1, 2, 3])
    expect(resampler(24_000, 24_000)(x)).toBe(x)
  })

  it('24 → 48 kHz: twice the samples, interpolated, with NO seam where the chunks meet', () => {
    const ramp = Int16Array.from({ length: 480 }, (_, i) => i * 10)
    const whole = resampler(24_000, 48_000)(ramp)
    const r = resampler(24_000, 48_000)
    const parts = [...r(ramp.subarray(0, 240)), ...r(ramp.subarray(240))]
    expect(Math.abs(whole.length - 959)).toBeLessThanOrEqual(1)
    expect(parts.length).toBe(whole.length)
    // A linear ramp resampled linearly stays a ramp: every step is the same, the chunk boundary included.
    const steps = new Set(parts.slice(1).map((v, i) => v - parts[i]))
    expect([...steps].every((d) => d === 5)).toBe(true)
  })
})

describe('createGuide', () => {
  it('the window closed while the model loads: the audio context and the face go AT ONCE, once, and the load ends there', async () => {
    const closed = vi.fn(async () => {})
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ getExtension: () => null }) }) })
    vi.stubGlobal('AudioWorkletNode', class {})
    vi.stubGlobal('AudioContext', class { close = closed })
    vi.stubGlobal('window', { devicePixelRatio: 3 })
    let land: (() => void) | null = null
    th.show = () => new Promise<void>((r) => { land = r })
    th.disposed = 0
    const stop = new AbortController()
    const made = createGuide({} as HTMLElement, '/avatar/x.bin', () => {}, stop.signal)
    await vi.waitFor(() => expect(land).not.toBeNull())
    stop.abort()
    expect(closed).toHaveBeenCalledTimes(1)
    expect(th.disposed).toBe(1)
    land!()
    await expect(made).rejects.toThrow('face_cancelled')
    expect(closed).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('a device with no WebGL2 throws before loading anything (the window shows the portrait)', async () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
    await expect(createGuide({} as HTMLElement, '/avatar/x.bin', () => {})).rejects.toThrow('face_unsupported')
    vi.unstubAllGlobals()
  })
})
