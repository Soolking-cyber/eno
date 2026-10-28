import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logWarn: vi.fn(), logError: vi.fn() }))
const h = vi.hoisted(() => ({
  soniox: true as boolean,
  box: true as boolean,
  sonioxFails: null as null | { status: number },
  /** A whole line from Soniox that takes this long (or never, when Infinity). */
  lineMs: 0,
  calls: [] as string[],
  /** The box's options as each call got them (the concierge's one-try rule). */
  boxOpts: [] as unknown[],
}))
vi.mock('./soniox', () => ({ sonioxConfig: () => (h.soniox ? { key: 'k', tts: 'wss://tts', ttsModel: 'tts-rt-v2' } : null) }))
vi.mock('./soniox-tts', () => ({
  sonioxSpeakStream: async (_text: string, voice: string, _style: unknown, signal?: AbortSignal) => {
    h.calls.push(`soniox-stream:${voice}`)
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { status: 499 })
    if (h.sonioxFails) throw Object.assign(new Error('soniox'), h.sonioxFails)
    return { rate: 24_000, chunks: (async function* () { yield new Uint8Array(2) })(), pauseMs: 0 }
  },
  sonioxSpeakLine: async (_text: string, voice: string) => {
    h.calls.push(`soniox-line:${voice}`)
    if (h.sonioxFails) throw Object.assign(new Error('soniox'), h.sonioxFails)
    if (h.lineMs) await new Promise((r) => (Number.isFinite(h.lineMs) ? setTimeout(r, h.lineMs) : undefined))
    return Buffer.from('mp3-from-soniox')
  },
}))
vi.mock('./speech-local', () => ({
  localSpeechConfig: () => (h.box ? { url: 'http://box', key: 'k' } : null),
  synthesizeStream: async (_cfg: unknown, _text: string, voice: string, _style: unknown, _signal: unknown, _fetch: unknown, opts?: unknown) => {
    h.calls.push(`box-stream:${voice}`)
    h.boxOpts.push(opts)
    return { rate: 24_000, chunks: (async function* () { yield new Uint8Array(2) })(), pauseMs: 0 }
  },
  synthesize: async (_cfg: unknown, _text: string, voice: string, _style: unknown, _fetch: unknown, opts?: unknown) => { h.calls.push(`box-line:${voice}`); h.boxOpts.push(opts); return Buffer.from('mp3-from-box') },
}))

/**
 * THE AVATAR'S VOICE: SONIOX FIRST, THE BOX STANDS BY (owner, 2026-10-27: "soniox voice turn on", "box tts as fallback").
 */
let sv: typeof import('./session-voice')
const style = { pace: 'natural' as const, loud: false, gapMs: 120, pauseMs: 0 }
beforeEach(async () => {
  Object.assign(h, { soniox: true, box: true, sonioxFails: null, lineMs: 0, calls: [], boxOpts: [] })
  sv = await import('./session-voice')
  sv.resetSonioxRest()
  sv.forgetLines()
})
afterEach(() => { vi.useRealTimers() })

describe('speakerFor', () => {
  it('Soniox speaks, in the voice\'s Soniox voice (Harper → Grace)', async () => {
    await sv.speakerFor('Harper', () => style)!('Hi.', new AbortController().signal)
    expect(h.calls).toEqual(['soniox-stream:Grace'])
  })

  it('⛔ Soniox fails → the box speaks the line in the voice\'s own Phonon voice — and the next lines too, for a while', async () => {
    vi.useFakeTimers()
    h.sonioxFails = { status: 402 }
    const speak = sv.speakerFor('Trevor', () => style)!
    await speak('One.', new AbortController().signal)
    expect(h.calls).toEqual(['soniox-stream:Shane', 'box-stream:Trevor'])
    h.sonioxFails = null
    await speak('Two.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('box-stream:Trevor') // resting: Soniox not even asked
    await vi.advanceTimersByTimeAsync(sv.SONIOX_REST_MS + 1)
    await speak('Three.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('soniox-stream:Shane') // back to Soniox
  })

  it('one line refused on its own (a 429, a 400): the box says that line — Soniox is NOT rested for everyone', async () => {
    h.sonioxFails = { status: 429 }
    const speak = sv.speakerFor('Harper', () => style)!
    await speak('One.', new AbortController().signal)
    expect(h.calls).toEqual(['soniox-stream:Grace', 'box-stream:Harper'])
    h.sonioxFails = null
    await speak('Two.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('soniox-stream:Grace')
  })

  it('ONE slow line (504) is not an outage — the next line tries Soniox; TWO in a row rest it', async () => {
    h.sonioxFails = { status: 504 }
    const speak = sv.speakerFor('Harper', () => style)!
    await speak('One.', new AbortController().signal)
    await speak('Two.', new AbortController().signal) // tried again: one slow line rests nothing
    expect(h.calls).toEqual(['soniox-stream:Grace', 'box-stream:Harper', 'soniox-stream:Grace', 'box-stream:Harper'])
    h.sonioxFails = null
    await speak('Three.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('box-stream:Harper') // two slow in a row: rested
  })

  it('⛔ a line asked for AHEAD never goes to the box — it is asked again in its turn (the box: one line at a time)', async () => {
    h.sonioxFails = { status: 502 }
    const speak = sv.speakerFor('Harper', () => style)!
    await expect(speak('Ahead.', new AbortController().signal, { ahead: true })).rejects.toMatchObject({ status: 502 })
    expect(h.calls).toEqual(['soniox-stream:Grace']) // no box call
    // Soniox now resting: an ahead ask is refused at once; the line in its turn goes to the box
    await expect(speak('Ahead again.', new AbortController().signal, { ahead: true })).rejects.toMatchObject({ status: 503 })
    await speak('Its turn.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('box-stream:Harper')
    expect(sv.speakerFor('Harper', () => style)!.ahead!()).toBe(0) // nothing more made ahead while it rests
  })

  it('a line whose ahead voice failed: in its turn the box says it at once — no second wait on Soniox', async () => {
    await sv.speakerFor('Toby', () => style)!('Its turn.', new AbortController().signal, { box: true })
    expect(h.calls).toEqual(['box-stream:Toby'])
  })

  it('an AHEAD line\'s slowness (504) counts toward nothing — two in a row do not rest Soniox', async () => {
    h.sonioxFails = { status: 504 }
    const speak = sv.speakerFor('Harper', () => style)!
    await expect(speak('A.', new AbortController().signal, { ahead: true })).rejects.toMatchObject({ status: 504 })
    await expect(speak('B.', new AbortController().signal, { ahead: true })).rejects.toMatchObject({ status: 504 })
    h.sonioxFails = null
    await speak('C.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('soniox-stream:Grace') // not rested
  })

  it('the voice concierge\'s one-try rule reaches the box (busyRetry: false) — the classroom keeps its retry', async () => {
    h.soniox = false
    await sv.speakerFor('Zoey', () => style, { busyRetry: false })!('Hi.', new AbortController().signal)
    await sv.speakerFor('Zoey', () => style)!('Hi.', new AbortController().signal)
    await sv.speakLine('Hello.', 'Zoey', style, 20, { busyRetry: false })
    expect(h.boxOpts).toEqual([{ busyRetry: false }, {}, { busyRetry: false }])
  })

  it('a talk-over is not a failure: no fallback, no rest', async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(sv.speakerFor('Harper', () => style)!('Hi.', stop.signal)).rejects.toMatchObject({ status: 499 })
    expect(h.calls).toEqual(['soniox-stream:Grace'])
    await sv.speakerFor('Harper', () => style)!('Again.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('soniox-stream:Grace')
  })

  it('no Soniox set up: the box; no box either: the failure passes up (the words still reach the screen)', async () => {
    h.soniox = false
    await sv.speakerFor('Imogen', () => style)!('Hi.', new AbortController().signal)
    expect(h.calls).toEqual(['box-stream:Imogen'])
    h.box = false
    expect(sv.speakerFor('Imogen', () => style)).toBeNull()
    h.soniox = true
    h.sonioxFails = { status: 503 }
    await expect(sv.speakerFor('Imogen', () => style)!('Hi.', new AbortController().signal)).rejects.toMatchObject({ status: 503 })
  })
})

describe('speakLine (the opening line, the wizard\'s samples)', () => {
  it('Soniox\'s MP3; the box\'s when Soniox fails', async () => {
    expect(Buffer.from(await sv.speakLine('Hello.', 'Maeve', style), 'base64').toString()).toBe('mp3-from-soniox')
    expect(h.calls).toEqual(['soniox-line:Freya'])
    h.sonioxFails = { status: 403 }
    sv.resetSonioxRest()
    sv.forgetLines()
    expect(Buffer.from(await sv.speakLine('Hello.', 'Maeve', style), 'base64').toString()).toBe('mp3-from-box')
    expect(h.calls.slice(-2)).toEqual(['soniox-line:Freya', 'box-line:Maeve'])
  })

  it('⚡ made ahead (the opening, while the intro is up): the start finds it — Soniox asked once', async () => {
    sv.warmLine('Hi there.', 'Harper', style)
    expect(Buffer.from(await sv.speakLine('Hi there.', 'Harper', style), 'base64').toString()).toBe('mp3-from-soniox')
    expect(h.calls).toEqual(['soniox-line:Grace'])
  })

  it('no box set up: a slow line still waits only waitMs — then the words go without a voice — and it rests nothing', async () => {
    h.box = false
    h.lineMs = Infinity
    await expect(sv.speakLine('A long opening.', 'Harper', style, 20)).rejects.toMatchObject({ status: 504 })
    await expect(sv.speakLine('Another opening.', 'Harper', style, 20)).rejects.toMatchObject({ status: 504 })
    await sv.speakerFor('Harper', () => style)!('A reply.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('soniox-stream:Grace') // two slow openings did not rest Soniox
  })

  it('⛔ slow is not failed: a line not ready in time is said by the box, and Soniox keeps the replies', async () => {
    h.lineMs = Infinity
    expect(Buffer.from(await sv.speakLine('A long opening.', 'Harper', style, 20), 'base64').toString()).toBe('mp3-from-box')
    expect(h.calls).toEqual(['soniox-line:Grace', 'box-line:Harper'])
    await sv.speakerFor('Harper', () => style)!('Next.', new AbortController().signal)
    expect(h.calls.at(-1)).toBe('soniox-stream:Grace') // not rested
  })
})
