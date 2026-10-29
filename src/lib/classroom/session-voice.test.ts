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
  /** The box refuses (its status), stays silent until the line is stopped, ends with no sound, or makes a whole line slowly. */
  boxFails: null as null | { status: number },
  boxSilent: false,
  boxEmpty: false,
  boxLineMs: 0,
  /** Soniox's first-sound budget as each stream got it; a hook run as Soniox is asked. */
  sonioxBudgets: [] as unknown[],
  onSoniox: null as null | (() => void),
  /** Box streams let go (their reader cancelled). */
  boxClosed: 0,
  /** The language of each box call (its style's): English, or the guide's Vietnamese (/vi/…). */
  boxLangs: [] as string[],
  /** The box answers 404 for these languages (a server without the /vi/ routes, or with them off). */
  boxLacks: [] as string[],
}))
vi.mock('./soniox', () => ({ sonioxConfig: () => (h.soniox ? { key: 'k', tts: 'wss://tts', ttsModel: 'tts-rt-v2' } : null) }))
vi.mock('./soniox-tts', () => ({
  sonioxSpeakStream: async (_text: string, voice: string, _style: unknown, signal?: AbortSignal, firstSoundMs?: number) => {
    h.calls.push(`soniox-stream:${voice}`)
    h.sonioxBudgets.push(firstSoundMs)
    h.onSoniox?.()
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
  synthesizeStream: async (_cfg: unknown, _text: string, voice: string, style: { language?: string }, signal: AbortSignal | undefined, _fetch: unknown, opts?: unknown) => {
    h.calls.push(`box-stream:${voice}`)
    h.boxOpts.push(opts)
    h.boxLangs.push(style.language ?? 'en')
    if (h.boxLacks.includes(style.language ?? 'en')) throw Object.assign(new Error('not found'), { status: 404 })
    // Like speech-local.ts: a request stopped on its way is a 502 (its fetch threw).
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { status: 502 })
    if (h.boxFails) throw Object.assign(new Error('box'), h.boxFails)
    const { boxSilent: silent, boxEmpty: empty } = h
    return {
      rate: 24_000,
      pauseMs: 0,
      chunks: (async function* () {
        try {
          // Like speech-local.ts: a stopped line's read ends at once.
          if (silent) await new Promise<void>((r) => (signal?.aborted ? r() : signal?.addEventListener('abort', () => r(), { once: true })))
          if (signal?.aborted || empty) return
          yield new Uint8Array(2)
          yield new Uint8Array(2)
        } finally {
          h.boxClosed++
        }
      })(),
    }
  },
  synthesize: async (_cfg: unknown, _text: string, voice: string, style: { language?: string }, _fetch: unknown, opts?: unknown) => {
    h.calls.push(`box-line:${voice}`)
    h.boxOpts.push(opts)
    h.boxLangs.push(style.language ?? 'en')
    if (h.boxLacks.includes(style.language ?? 'en')) throw Object.assign(new Error('not found'), { status: 404 })
    if (h.boxFails) throw Object.assign(new Error('box'), h.boxFails)
    if (h.boxLineMs) await new Promise((r) => setTimeout(r, h.boxLineMs))
    return Buffer.from('mp3-from-box')
  },
}))

/**
 * THE AVATAR'S VOICE: SONIOX FIRST, THE BOX STANDS BY (owner, 2026-10-27: "soniox voice turn on", "box tts as fallback").
 */
let sv: typeof import('./session-voice')
const style = { pace: 'natural' as const, loud: false, gapMs: 120, pauseMs: 0 }
beforeEach(async () => {
  Object.assign(h, { soniox: true, box: true, sonioxFails: null, lineMs: 0, calls: [], boxOpts: [], boxFails: null, boxSilent: false, boxEmpty: false, boxLineMs: 0, sonioxBudgets: [], onSoniox: null, boxClosed: 0, boxLangs: [], boxLacks: [] })
  sv = await import('./session-voice')
  sv.resetSonioxRest()
  sv.resetBoxRest()
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

  it('⛔ a voice in another language than English has NO box: a Soniox failure passes up (the words still show) — the English box never reads Vietnamese', async () => {
    h.sonioxFails = { status: 502 }
    const speak = sv.speakerFor('Zoey', () => ({ ...style, language: 'vi' }))!
    await expect(speak('Xin chào.', new AbortController().signal)).rejects.toBeTruthy()
    expect(h.calls.some((c) => c.startsWith('box'))).toBe(false)
    await expect(sv.speakLine('Xin chào.', 'Zoey', { ...style, language: 'vi' }, 100)).rejects.toBeTruthy()
    expect(h.calls.some((c) => c.startsWith('box'))).toBe(false)
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

/**
 * THE VOICE GUIDE TURNS IT ROUND (`first`; owner, 2026-10-29: "priority english and vietnamese rest use soniox"): its
 * English on the box FIRST, as a guide line; Soniox for what the box cannot say — and for the rest of that reply.
 */
describe('the voice guide (`first`): English on the box first, Soniox the overflow', () => {
  const guide = { busyRetry: false, first: true }
  const speaker = () => sv.speakerFor('Zoey', () => style, guide)!
  const go = () => new AbortController().signal

  it('English goes to the box as a GUIDE line (busy at once, one try) — its first sound still played; Soniox not asked', async () => {
    const speak = speaker()
    const voiced = await speak('Hi.', go())
    const heard: Uint8Array[] = []
    for await (const c of voiced.chunks) heard.push(c)
    expect(heard).toHaveLength(2) // the chunk read to time the first sound is handed on, then the rest
    expect(h.boxClosed).toBe(1)
    expect(h.calls).toEqual(['box-stream:Zoey'])
    expect(h.boxOpts).toEqual([{ busyRetry: false, guide: true }])
    expect(speak.ahead!()).toBe(0) // the box makes one line at a time
  })

  it('a full box (503): that line AND the rest of the reply go to Soniox, made ahead there — the next reply tries the box', async () => {
    h.boxFails = { status: 503 }
    const speak = speaker()
    await speak('One.', go())
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane'])
    expect(speak.ahead!()).toBe(sv.SONIOX_AHEAD)
    await speak('Two.', go())
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane', 'soniox-stream:Sloane']) // one voice an answer
    h.boxFails = null
    await speaker()('The next reply.', go())
    expect(h.calls.at(-1)).toBe('box-stream:Zoey') // busy rests nothing
  })

  it('no first sound in BOX_FIRST_SOUND_MS: Soniox says it; ONE slow line rests nothing, TWO in a row rest the guide\'s box', async () => {
    vi.useFakeTimers()
    h.boxSilent = true
    for (const line of ['One.', 'Two.']) {
      const said = speaker()(line, go())
      await vi.advanceTimersByTimeAsync(sv.BOX_FIRST_SOUND_MS + 1)
      await said
    }
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane', 'box-stream:Zoey', 'soniox-stream:Sloane'])
    h.boxSilent = false
    await speaker()('Three.', go())
    expect(h.calls.at(-1)).toBe('soniox-stream:Sloane') // resting: the box not asked
    await vi.advanceTimersByTimeAsync(sv.BOX_REST_MS + 1)
    await speaker()('Four.', go())
    expect(h.calls.at(-1)).toBe('box-stream:Zoey')
  })

  it('a line that ends with no sound at all counts as slow, like a late one', async () => {
    h.boxEmpty = true
    await speaker()('One.', go())
    await speaker()('Two.', go())
    h.boxEmpty = false
    await speaker()('Three.', go())
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane', 'box-stream:Zoey', 'soniox-stream:Sloane', 'soniox-stream:Sloane'])
  })

  it('⛔ the box DOWN (unreachable, a fault, the key refused) rests it for every guide speaker — never for a lesson', async () => {
    for (const status of [502, 500, 401]) {
      sv.resetBoxRest()
      h.calls = []
      h.boxFails = { status }
      await speaker()('One.', go())
      h.boxFails = null
      await speaker()('Two.', go())
      expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane', 'soniox-stream:Sloane'])
    }
    // The guide's box is resting — a lesson whose Soniox fails still has the box.
    h.sonioxFails = { status: 402 }
    await sv.speakerFor('Trevor', () => style)!('A lesson.', go())
    expect(h.calls.slice(-2)).toEqual(['soniox-stream:Shane', 'box-stream:Trevor'])
  })

  it('a line the box refuses on its own (400) goes to Soniox and rests nothing', async () => {
    h.boxFails = { status: 400 }
    await speaker()('One.', go())
    h.boxFails = null
    await speaker()('Two.', go())
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane', 'box-stream:Zoey'])
  })

  it('Soniox refuses a line once the reply moved to it (its three streams at once): the box says that line', async () => {
    h.boxFails = { status: 503 }
    const speak = speaker()
    await speak('One.', go())
    h.boxFails = null
    h.sonioxFails = { status: 429 }
    await speak('Two.', go())
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane', 'soniox-stream:Sloane', 'box-stream:Zoey'])
  })

  it('⛔ a line asked AHEAD goes to Soniox only, never the box; a line whose ahead voice failed (o.box) gets the box at once', async () => {
    h.boxFails = { status: 503 }
    const speak = speaker()
    await speak('One.', go())
    h.boxFails = null
    await speak('Ahead.', go(), { ahead: true })
    expect(h.calls.at(-1)).toBe('soniox-stream:Sloane')
    await speak('Late.', go(), { box: true })
    expect(h.calls.at(-1)).toBe('box-stream:Zoey')
  })

  it('talked over while the box makes the line: no Soniox, no rest', async () => {
    h.boxSilent = true
    const stop = new AbortController()
    const said = speaker()('Hi.', stop.signal)
    stop.abort()
    await expect(said).rejects.toMatchObject({ status: 499 })
    expect(h.calls).toEqual(['box-stream:Zoey'])
    h.boxSilent = false
    await speaker()('Again.', go())
    expect(h.calls.at(-1)).toBe('box-stream:Zoey')
  })

  it('after a box miss Soniox gets SONIOX_FIRST_SOUND_MS (opus) — silent past it, the box once more', async () => {
    h.boxFails = { status: 503 }
    h.sonioxFails = { status: 504 }
    h.onSoniox = () => { h.boxFails = null } // the box frees while Soniox stays silent
    await speaker()('One.', go())
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane', 'box-stream:Zoey'])
    expect(h.sonioxBudgets).toEqual([sv.SONIOX_FIRST_SOUND_MS])
  })

  it('⛔ missing THAT short wait never rests Soniox for the lessons (opus, round 3) — two in a row, a lesson still has Soniox', async () => {
    h.boxFails = { status: 503 }
    h.sonioxFails = { status: 504 }
    await expect(speaker()('One.', go())).rejects.toBeTruthy()
    await expect(speaker()('Two.', go())).rejects.toBeTruthy()
    h.sonioxFails = null
    await sv.speakerFor('Trevor', () => style)!('A lesson.', go())
    expect(h.calls.at(-1)).toBe('soniox-stream:Shane')
  })

  it('a reply\'s voice closed before it is played lets the box\'s stream go (codex, round 3)', async () => {
    const voiced = await speaker()('Hi.', go())
    await voiced.chunks[Symbol.asyncIterator]().return?.()
    expect(h.boxClosed).toBe(1)
  })

  it('the box resting: Soniox gets its whole time — there is nothing to hand the line to', async () => {
    h.boxFails = { status: 502 }
    await speaker()('One.', go())
    expect(h.sonioxBudgets).toEqual([undefined])
  })

  it('talked over before its turn: a 499 (opus) — the box never asked (codex), no Soniox, no rest', async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(speaker()('Hi.', stop.signal)).rejects.toMatchObject({ status: 499 })
    expect(h.calls).toEqual([])
    await speaker()('Again.', go())
    expect(h.calls.at(-1)).toBe('box-stream:Zoey')
  })

  it('a whole line made on the box ends a run of slow lines (codex): slow, an opening, slow — still not rested', async () => {
    vi.useFakeTimers()
    const slow = async () => {
      h.boxSilent = true
      const said = speaker()('Slow.', go())
      await vi.advanceTimersByTimeAsync(sv.BOX_FIRST_SOUND_MS + 1)
      await said
      h.boxSilent = false
    }
    await slow()
    await sv.speakLine('Hello.', 'Zoey', style, 2_500, guide)
    await slow()
    await speaker()('Fine.', go())
    expect(h.calls.at(-1)).toBe('box-stream:Zoey')
  })

  it('a language the box does not speak (Chinese): Soniox only, made ahead as before', async () => {
    const speak = sv.speakerFor('Zoey', () => ({ ...style, language: 'zh' }), guide)!
    await speak('你好。', go())
    expect(h.calls).toEqual(['soniox-stream:Sloane'])
    expect(speak.ahead!()).toBe(sv.SONIOX_AHEAD)
  })

  it('neither can say it: the failure passes up (the words still show)', async () => {
    h.boxFails = { status: 502 }
    h.sonioxFails = { status: 402 }
    await expect(speaker()('Hi.', go())).rejects.toMatchObject({ status: 402 })
  })
})

describe('the voice guide\'s opening (`first`)', () => {
  const guide = { busyRetry: false, first: true }
  const line = async (text: string, waitMs = 2_500) => Buffer.from(await sv.speakLine(text, 'Zoey', style, waitMs, guide), 'base64').toString()

  it('made on the box ahead and KEPT — the same words for every visitor: two Starts, one make, no Soniox', async () => {
    sv.warmLine('Hello, I am eno.', 'Zoey', style, guide)
    expect(await line('Hello, I am eno.')).toBe('mp3-from-box')
    expect(await line('Hello, I am eno.')).toBe('mp3-from-box')
    expect(h.calls).toEqual(['box-line:Zoey'])
    expect(h.boxOpts).toEqual([{ busyRetry: false, guide: true }])
  })

  it('a cold Start (nothing made ahead) makes it on the box', async () => {
    expect(await line('Hello.')).toBe('mp3-from-box')
    expect(h.calls).toEqual(['box-line:Zoey'])
  })

  it('a box that cannot make it: Soniox makes it ahead instead, and the Start finds Soniox\'s', async () => {
    h.boxFails = { status: 503 }
    sv.warmLine('Hello.', 'Zoey', style, guide)
    await new Promise((r) => setTimeout(r, 0))
    expect(await line('Hello.')).toBe('mp3-from-soniox')
    expect(h.calls).toEqual(['box-line:Zoey', 'soniox-line:Sloane', 'box-line:Zoey']) // Soniox made it once
  })

  it('⛔ a box line merely SLOW is not made again on Soniox (codex): the words show this once, the next Start has it', async () => {
    h.boxLineMs = 50
    await expect(sv.speakLine('Hello.', 'Zoey', style, 10, guide)).rejects.toMatchObject({ status: 504 })
    await new Promise((r) => setTimeout(r, 60))
    expect(await line('Hello.', 10)).toBe('mp3-from-box')
    expect(h.calls).toEqual(['box-line:Zoey'])
  })

  it('a box slow at Start while Soniox\'s line, made ahead when the box was busy, is ready: Soniox\'s plays (opus)', async () => {
    h.boxFails = { status: 503 }
    sv.warmLine('Hello.', 'Zoey', style, guide)
    await new Promise((r) => setTimeout(r, 0))
    h.boxFails = null
    h.boxLineMs = 50
    expect(await line('Hello.', 20)).toBe('mp3-from-soniox')
    expect(h.calls).toEqual(['box-line:Zoey', 'soniox-line:Sloane', 'box-line:Zoey']) // no second Soniox make
  })

  it('a line the box made already plays while the box rests (codex, round 3) — no Soniox', async () => {
    sv.warmLine('Hello.', 'Zoey', style, guide)
    await new Promise((r) => setTimeout(r, 0))
    h.boxFails = { status: 502 }
    await sv.speakerFor('Zoey', () => style, guide)!('A reply.', new AbortController().signal) // the box down: resting now
    h.calls = []
    expect(await line('Hello.')).toBe('mp3-from-box')
    expect(h.calls).toEqual([])
  })

  it('the box down: Soniox, and the box rested for the next Start', async () => {
    h.boxFails = { status: 500 }
    expect(await line('A.')).toBe('mp3-from-soniox')
    expect(await line('B.')).toBe('mp3-from-soniox')
    expect(h.calls).toEqual(['box-line:Zoey', 'soniox-line:Sloane', 'soniox-line:Sloane'])
  })

  it('a language the box does not speak (Chinese): Soniox, as before — the box never reads it', async () => {
    expect(Buffer.from(await sv.speakLine('你好。', 'Zoey', { ...style, language: 'zh' }, 100, guide), 'base64').toString()).toBe('mp3-from-soniox')
    expect(h.calls).toEqual(['soniox-line:Sloane'])
  })
})

/**
 * THE GUIDE'S VIETNAMESE ON THE BOX (owner, 2026-10-29: "bao tran go", "go live"): the server's /vi/ routes (Bảo Trang,
 * ZeroTTS) — the guide's alone; a server without them answers 404 and Vietnamese goes to Soniox for a minute.
 */
describe('the voice guide\'s Vietnamese on the box (`first`)', () => {
  const guide = { busyRetry: false, first: true }
  const viStyle = () => ({ ...style, language: 'vi' as const })
  const go = () => new AbortController().signal

  it('Vietnamese goes to the box first, as a guide line in Vietnamese — Soniox not asked', async () => {
    const speak = sv.speakerFor('Zoey', viStyle, guide)!
    await speak('Xin chào.', go())
    expect(h.calls).toEqual(['box-stream:Zoey'])
    expect(h.boxLangs).toEqual(['vi'])
    expect(h.boxOpts).toEqual([{ busyRetry: false, guide: true }])
    expect(speak.ahead!()).toBe(0)
  })

  it('⛔ a lesson never sends Vietnamese to the box (no `first`): Soniox, as before', async () => {
    h.sonioxFails = { status: 502 }
    await expect(sv.speakerFor('Zoey', viStyle)!('Xin chào.', go())).rejects.toBeTruthy()
    await expect(sv.speakLine('Xin chào.', 'Zoey', viStyle(), 100)).rejects.toBeTruthy()
    expect(h.calls.some((c) => c.startsWith('box'))).toBe(false)
  })

  it('a box WITHOUT Vietnamese (404): that reply and every Vietnamese line for BOX_REST_MS go to Soniox — English keeps the box', async () => {
    vi.useFakeTimers()
    h.boxLacks = ['vi']
    await sv.speakerFor('Zoey', viStyle, guide)!('Một.', go())
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane'])
    await sv.speakerFor('Zoey', viStyle, guide)!('Hai.', go())
    expect(h.calls.at(-1)).toBe('soniox-stream:Sloane') // not asked again
    await sv.speakerFor('Zoey', () => style, guide)!('Hi.', go())
    expect(h.calls.at(-1)).toBe('box-stream:Zoey') // English: the box, untouched
    h.boxLacks = []
    await vi.advanceTimersByTimeAsync(sv.BOX_REST_MS + 1)
    await sv.speakerFor('Zoey', viStyle, guide)!('Ba.', go())
    expect(h.calls.at(-1)).toBe('box-stream:Zoey')
    expect(h.boxLangs.at(-1)).toBe('vi')
  })

  it('⛔ Vietnamese failing never rests the box\'s ENGLISH (opus, commit review): two slow Vietnamese lines, English still on the box', async () => {
    vi.useFakeTimers()
    h.boxSilent = true
    for (const line of ['Một.', 'Hai.']) {
      const said = sv.speakerFor('Zoey', viStyle, guide)!(line, go())
      await vi.advanceTimersByTimeAsync(sv.BOX_FIRST_SOUND_MS + 1)
      await said
    }
    h.boxSilent = false
    await sv.speakerFor('Zoey', viStyle, guide)!('Ba.', go())
    expect(h.calls.at(-1)).toBe('soniox-stream:Sloane') // Vietnamese: resting
    await sv.speakerFor('Zoey', () => style, guide)!('Hi.', go())
    expect(h.calls.at(-1)).toBe('box-stream:Zoey') // English: not
    h.boxFails = { status: 500 }
    await sv.speakerFor('Zoey', viStyle, guide)!('Bốn.', go()) // still resting: Soniox, the box not even asked
    h.boxFails = null
    expect(h.boxLangs.filter((l) => l === 'en')).toHaveLength(1)
  })

  it('⛔ a Vietnamese line the box misses goes to Soniox — NEVER to the box\'s English route', async () => {
    h.boxFails = { status: 503 }
    await sv.speakerFor('Zoey', viStyle, guide)!('Một.', go())
    expect(h.boxLangs.every((l) => l === 'vi')).toBe(true)
    expect(h.calls).toEqual(['box-stream:Zoey', 'soniox-stream:Sloane'])
  })

  it('the Vietnamese opening is made on the box in Vietnamese and kept apart from the English one', async () => {
    const line = async (text: string, st: typeof style) => Buffer.from(await sv.speakLine(text, 'Zoey', st, 2_500, guide), 'base64').toString()
    expect(await line('Chào bạn!', viStyle())).toBe('mp3-from-box')
    expect(await line('Hi!', style)).toBe('mp3-from-box')
    expect(await line('Chào bạn!', viStyle())).toBe('mp3-from-box')
    expect(h.boxLangs).toEqual(['vi', 'en']) // made once each, by language
  })
})

