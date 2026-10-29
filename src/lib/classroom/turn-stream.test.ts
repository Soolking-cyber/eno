// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PCM_LINE_BYTES, replayTurn, streamTurn, type Answer, type SavedReply, type Speaker, type TurnLine } from './turn-stream'
import type { TutorEvent, TutorReply } from './tutor-ai'

/**
 * ONE TURN'S ANSWER, LINE BY LINE (owner, 2026-10-26: "delayless") — the order the page relies on, the voice following
 * each sentence as it is made, and the turn finishing and saving whatever its reader does.
 */
const logs = vi.hoisted(() => [] as unknown[][])
vi.mock('@/lib/log', () => ({ logWarn: (...a: unknown[]) => { logs.push(a) }, logError: (...a: unknown[]) => { logs.push(a) }, logInfo: () => {} }))
afterEach(() => { logs.length = 0 })

const REPLY = (o: Partial<TutorReply> = {}): TutorReply => ({ reply: 'Nice! We say: I went to the market.', hint: 'I went to the market.', hintVi: 'Tôi đã đi chợ.', expect: null, heardAs: [], safety: false, pace: null, ...o })
const SAVED = (a: Answer): SavedReply => ({ seq: 4, learnerText: 'I go market', reply: a.reply.reply, hint: a.reply.hint, hintVi: a.reply.hintVi, expect: a.reply.expect, heardAs: a.reply.heardAs, secondsLeft: 300 })
async function* brain(...ev: TutorEvent[]): AsyncGenerator<TutorEvent> { yield* ev }
async function collect(lines: AsyncGenerator<TurnLine, void, undefined>) { const out: TurnLine[] = []; for await (const l of lines) out.push(l); return out }
/** A voice that yields `sizes` bytes per chunk (each byte = the part's first letter, so lines can be told apart). */
const voice = (sizes: number[] = [100]): Speaker & { asked: string[]; signals: AbortSignal[] } => {
  const asked: string[] = []
  const signals: AbortSignal[] = []
  const f = async (text: string, signal: AbortSignal) => {
    asked.push(text)
    signals.push(signal)
    return { rate: 24_000, chunks: (async function* () { for (const n of sizes) yield new Uint8Array(n).fill(text.charCodeAt(0)) })() }
  }
  return Object.assign(f, { asked, signals })
}
const turn = (events: AsyncIterable<TutorEvent>, o: { speak?: Speaker | null; save?: (a: Answer, c: { clientGone: () => boolean }) => Promise<SavedReply>; onPace?: (c: 'slower' | 'faster') => void } = {}) => {
  const saved: { a: Answer; clientGone: boolean }[] = []
  const gaveUp: unknown[] = []
  const t = streamTurn({
    learnerText: 'I go market',
    events,
    speak: o.speak === undefined ? voice() : o.speak,
    save: o.save ?? (async (a, c) => { saved.push({ a, clientGone: c.clientGone() }); return SAVED(a) }),
    giveUp: async (e) => { gaveUp.push(e) },
    safetyLine: 'Thank you for telling me. Please talk to a grown-up you trust.',
    onPace: o.onPace,
  })
  return { ...t, saved, gaveUp }
}
const kinds = (l: TurnLine[]) => l.map((x) => (x.kind === 'say' ? `say:${x.text}` : x.kind === 'part-end' ? `part-end:${x.part}${x.last ? ':last' : ''}` : x.kind === 'pcm' ? `pcm:${x.part}` : x.kind))
/** The `reply` line lands whenever the save finishes — the voice never waits for it: the lines without it, and how many. */
const voiceOrder = (l: TurnLine[]) => ({ lines: kinds(l).filter((k) => k !== 'reply'), replies: kinds(l).filter((k) => k === 'reply').length, tail: kinds(l).slice(-2) })

describe('streamTurn — the voice pace (owner, 2026-10-26: "adults may adjust pace by saying talk more slowly")', () => {
  it('the learner asked for a slower voice: the pace moves BEFORE the first sentence is voiced — the reply itself is slower', async () => {
    const order: string[] = []
    const v = voice()
    const speak: Speaker = async (text, signal) => { order.push(`voice:${text}`); return v(text, signal) }
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'pace', change: 'slower' }, { kind: 'say', text: 'Sure, I will slow down.' }, { kind: 'final', reply: REPLY({ reply: 'Sure, I will slow down.', pace: 'slower' }), model: 'm', calls: 1 }), {
      speak, onPace: (c) => order.push(`pace:${c}`),
    })
    await collect(t.lines)
    expect(order).toEqual(['pace:slower', 'voice:Sure, I will slow down.'])
  })
  it('⛔ a harm-flagged turn never moves the pace', async () => {
    const order: string[] = []
    const t = turn(brain({ kind: 'safety', harm: true }, { kind: 'pace', change: 'faster' }, { kind: 'final', reply: REPLY({ reply: 'Please tell a trusted adult.', safety: true }), model: 'm', calls: 1 }), { onPace: (c) => order.push(c) })
    await collect(t.lines)
    expect(order).toEqual([])
  })
})

describe('streamTurn', () => {
  it('heard first; each sentence said then voiced; the saved turn; the last part-end; end', async () => {
    const r = REPLY({ reply: 'Nice! We say: I went to the market.' })
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Nice!' }, { kind: 'say', text: 'We say: I went to the market.' }, { kind: 'final', reply: r, model: 'gpt-6-luna', calls: 1 }))
    const lines = await collect(t.lines)
    expect(voiceOrder(lines)).toEqual({
      lines: ['heard', 'say:Nice!', 'pcm:0', 'part-end:0', 'say:We say: I went to the market.', 'pcm:1', 'part-end:1', 'part-end:1:last', 'end'],
      replies: 1,
      tail: ['part-end:1:last', 'end'],
    })
    expect(lines[0]).toEqual({ kind: 'heard', learnerText: 'I go market' })
    expect(lines.find((l) => l.kind === 'reply')).toEqual({ kind: 'reply', ...SAVED({ reply: r, model: 'gpt-6-luna', calls: 1 }) })
    expect(t.saved).toEqual([{ a: { reply: r, model: 'gpt-6-luna', calls: 1 }, clientGone: false }])
    await t.done
  })

  it('the voice: the FIRST frames go alone at once, then ~100 ms per line; every byte arrives, in order', async () => {
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Hello there.' }, { kind: 'final', reply: REPLY({ reply: 'Hello there.' }), model: 'm', calls: 1 }), { speak: voice([100, 3000, 3000, 100]) })
    const pcm = (await collect(t.lines)).filter((l) => l.kind === 'pcm') as Extract<TurnLine, { kind: 'pcm' }>[]
    expect(pcm.map((l) => Buffer.from(l.data, 'base64').length)).toEqual([100, 6000, 100])
    expect(pcm.every((l) => l.rate === 24_000 && l.part === 0)).toBe(true)
    expect(6000).toBeGreaterThanOrEqual(PCM_LINE_BYTES)
  })

  it('⛔ a voice that asks for a PRE-ROLL (the box\'s Vietnamese) holds its first sound until that much is in hand — then ~100 ms lines; a short line goes whole at its end', async () => {
    // 24 kHz PCM16: 500 ms = 24,000 bytes.
    const slow = (sizes: number[]): Speaker => Object.assign(async () => ({
      rate: 24_000, prerollMs: 500, chunks: (async function* () { for (const n of sizes) yield new Uint8Array(n) })(),
    }), {})
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Xin chào.' }, { kind: 'final', reply: REPLY({ reply: 'Xin chào.' }), model: 'm', calls: 1 }), { speak: slow([3840, 7680, 15360, 6000, 100]) })
    const pcm = (await collect(t.lines)).filter((l) => l.kind === 'pcm') as Extract<TurnLine, { kind: 'pcm' }>[]
    expect(pcm.map((l) => Buffer.from(l.data, 'base64').length)).toEqual([26880, 6000, 100]) // 3840+7680+15360 first, then as before
    const short = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Dạ.' }, { kind: 'final', reply: REPLY({ reply: 'Dạ.' }), model: 'm', calls: 1 }), { speak: slow([3840, 3840]) })
    const p2 = (await collect(short.lines)).filter((l) => l.kind === 'pcm') as Extract<TurnLine, { kind: 'pcm' }>[]
    expect(p2.map((l) => Buffer.from(l.data, 'base64').length)).toEqual([7680]) // never reached 500 ms: the whole line at its end
  })

  it('⚡ a voice made elsewhere (Soniox: ahead() > 0) is asked for the NEXT sentences while one is heard — still sent in order', async () => {
    // Each sentence's voice takes 30 ms to start; one at a time that is a hole before every sentence after the first.
    // ⚠️ ORDER, NOT THE CLOCK: whether a voice was ready when the next was asked for — a "< 30 ms" on the wall clock failed
    // on a loaded machine (the full suite, 2026-10-28) while the order held.
    const asked: { text: string; firstReady: boolean }[] = []
    let firstReady = false
    const slow = Object.assign(async (text: string) => {
      asked.push({ text, firstReady })
      await new Promise((r) => setTimeout(r, 30))
      if (text === 'A one.') firstReady = true
      return { rate: 24_000, chunks: (async function* () { yield new Uint8Array(10).fill(text.charCodeAt(0)) })() }
    }, { ahead: () => 2 }) as Speaker
    const r = REPLY({ reply: 'A one. B two. C three.' })
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'A one.' }, { kind: 'say', text: 'B two.' }, { kind: 'say', text: 'C three.' }, { kind: 'final', reply: r, model: 'm', calls: 1 }), { speak: slow })
    const lines = await collect(t.lines)
    expect(voiceOrder(lines).lines).toEqual(['heard', 'say:A one.', 'pcm:0', 'part-end:0', 'say:B two.', 'pcm:1', 'part-end:1', 'say:C three.', 'pcm:2', 'part-end:2', 'part-end:2:last', 'end'])
    // all three asked for before the first was even ready: B and C were made while A was heard
    expect(asked.map((a) => a.text)).toEqual(['A one.', 'B two.', 'C three.'])
    expect(asked.map((a) => a.firstReady)).toEqual([false, false, false])
    // the bytes of each part are its own, in order
    const pcm = lines.filter((l) => l.kind === 'pcm') as Extract<TurnLine, { kind: 'pcm' }>[]
    expect(pcm.map((l) => String.fromCharCode(Buffer.from(l.data, 'base64')[0]))).toEqual(['A', 'B', 'C'])
    await t.done
  })

  it('⛔ a voice made ahead that FAILED is asked for again in its own turn (where the box may say it) — never lost', async () => {
    const asked: { text: string; ahead: boolean }[] = []
    const flaky = Object.assign(async (text: string, _s: AbortSignal, o?: { ahead?: boolean; box?: boolean }) => {
      asked.push({ text, ahead: !!o?.ahead })
      if (o?.box) expect(text).toBe('B two.') // only the failed ahead line is handed to the box
      if (o?.ahead && text.startsWith('B')) throw Object.assign(new Error('soniox'), { status: 502 })
      // A is still being heard when B is said: B is asked for AHEAD
      return { rate: 24_000, chunks: (async function* () { if (text.startsWith('A')) await new Promise((r) => setTimeout(r, 20)); yield new Uint8Array(10).fill(text.charCodeAt(0)) })() }
    }, { ahead: () => 2 }) as Speaker
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'A one.' }, { kind: 'say', text: 'B two.' }, { kind: 'final', reply: REPLY({ reply: 'A one. B two.' }), model: 'm', calls: 1 }), { speak: flaky })
    const lines = await collect(t.lines)
    expect(voiceOrder(lines).lines).toEqual(['heard', 'say:A one.', 'pcm:0', 'part-end:0', 'say:B two.', 'pcm:1', 'part-end:1', 'part-end:1:last', 'end'])
    // A (the next to be sent) is asked for as itself; B ahead — and, its ahead voice failed, again in its turn for the box
    expect(asked).toEqual([{ text: 'A one.', ahead: false }, { text: 'B two.', ahead: true }, { text: 'B two.', ahead: false }])
    await t.done
  })

  it('the CURRENT line\'s failed voice is not asked again (its own ask already had the box behind it)', async () => {
    const asked: string[] = []
    const fails = Object.assign(async (text: string, _s: AbortSignal, o?: { ahead?: boolean; box?: boolean }) => {
      asked.push(`${text}${o?.box ? '+box' : ''}`)
      throw Object.assign(new Error('both down'), { status: 503 })
    }, { ahead: () => 2 }) as Speaker
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Only.' }, { kind: 'final', reply: REPLY({ reply: 'Only.' }), model: 'm', calls: 1 }), { speak: fails })
    const lines = await collect(t.lines)
    expect(asked).toEqual(['Only.']) // once: no second ask on the box
    expect(kinds(lines)).toContain('audio-failed')
    await t.done
  })

  it('⛔ a line made ahead that is still SILENT when its turn comes: after turnMs the box says it, and the ahead ask is stopped', async () => {
    const asked: string[] = []
    const stopped: string[] = []
    const slowAhead = Object.assign(async (text: string, signal: AbortSignal, o?: { ahead?: boolean; box?: boolean }) => {
      asked.push(`${text}${o?.box ? '+box' : o?.ahead ? '+ahead' : ''}`)
      if (o?.ahead) {
        signal.addEventListener('abort', () => stopped.push(text), { once: true })
        return new Promise<never>(() => {}) // never a first sound
      }
      return { rate: 24_000, chunks: (async function* () { if (text.startsWith('A')) await new Promise((r) => setTimeout(r, 10)); yield new Uint8Array(10).fill(text.charCodeAt(0)) })() }
    }, { ahead: () => 2, turnMs: 20 }) as Speaker
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'A one.' }, { kind: 'say', text: 'B two.' }, { kind: 'final', reply: REPLY({ reply: 'A one. B two.' }), model: 'm', calls: 1 }), { speak: slowAhead })
    const lines = await collect(t.lines)
    expect(asked).toEqual(['A one.', 'B two.+ahead', 'B two.+box'])
    expect(stopped).toEqual(['B two.'])
    expect(voiceOrder(lines).lines).toEqual(['heard', 'say:A one.', 'pcm:0', 'part-end:0', 'say:B two.', 'pcm:1', 'part-end:1', 'part-end:1:last', 'end'])
    await t.done
  })

  it('the box (no ahead): one sentence at a time, as before', async () => {
    const asked: string[] = []
    let inFlight = 0
    let most = 0
    const one = (async (text: string) => {
      asked.push(text)
      inFlight += 1
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      return { rate: 24_000, chunks: (async function* () { yield new Uint8Array(10); inFlight -= 1 })() }
    }) as Speaker
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'One.' }, { kind: 'say', text: 'Two.' }, { kind: 'final', reply: REPLY({ reply: 'One. Two.' }), model: 'm', calls: 1 }), { speak: one })
    await collect(t.lines)
    expect(asked).toEqual(['One.', 'Two.'])
    expect(most).toBe(1)
    await t.done
  })

  it('⛔ the first sentence is voiced BEFORE the brain has finished the reply', async () => {
    const gate = Promise.withResolvers<void>()
    async function* slow(): AsyncGenerator<TutorEvent> {
      yield { kind: 'safety', harm: false }
      yield { kind: 'say', text: 'Nice!' }
      await gate.promise
      yield { kind: 'final', reply: REPLY({ reply: 'Nice!' }), model: 'm', calls: 1 }
    }
    const t = turn(slow())
    const seen: TurnLine[] = []
    for await (const l of t.lines) {
      seen.push(l)
      if (l.kind === 'part-end' && !l.last) { expect(t.saved).toEqual([]); gate.resolve() } // its voice is out; the reply is not yet saved
    }
    expect(kinds(seen)).toEqual(['heard', 'say:Nice!', 'pcm:0', 'part-end:0', 'reply', 'part-end:0:last', 'end'])
  })

  it('⛔ harm: not a word before the turn is saved flagged — then the model’s checked kind words, voiced; no drill', async () => {
    const speak = voice()
    const r = REPLY({ reply: 'Thank you for telling me. That is important. Please tell a trusted adult like your teacher.', safety: true, expect: 'I am safe.' })
    const t = turn(brain({ kind: 'safety', harm: true }, { kind: 'final', reply: r, model: 'm', calls: 1 }), { speak })
    const lines = await collect(t.lines)
    expect(t.saved[0].a.reply).toMatchObject({ safety: true, expect: null, reply: r.reply })
    const firstSay = lines.findIndex((l) => l.kind === 'say')
    expect(firstSay).toBeGreaterThan(lines.findIndex((l) => l.kind === 'reply'))
    expect(speak.asked.join(' ')).toBe(r.reply)
  })

  it('⛔ harm whose reply could not be used: eno’s own words, saved flagged and spoken', async () => {
    async function* flagged(): AsyncGenerator<TutorEvent> {
      yield { kind: 'safety', harm: true }
      throw Object.assign(new SyntaxError('classroom_unusable_reply'), { safety: true, calls: 2 })
    }
    const speak = voice()
    const t = turn(flagged(), { speak })
    const lines = await collect(t.lines)
    expect(t.saved[0].a).toMatchObject({ model: 'eno-safety', calls: 2, reply: { safety: true, reply: 'Thank you for telling me. Please talk to a grown-up you trust.' } })
    expect(speak.asked.join(' ')).toBe('Thank you for telling me. Please talk to a grown-up you trust.')
    expect(lines.some((l) => l.kind === 'error')).toBe(false)
    expect(t.gaveUp).toEqual([])
  })

  it('⛔ a harm flag the brain raised and then failed after is kept: saved flagged with eno’s own words (review, codex P1)', async () => {
    async function* broke(): AsyncGenerator<TutorEvent> { yield { kind: 'safety', harm: true }; throw new Error('llm_502') }
    const speak = voice()
    const t = turn(broke(), { speak })
    await collect(t.lines)
    expect(t.saved[0].a).toMatchObject({ model: 'eno-safety', reply: { safety: true, reply: 'Thank you for telling me. Please talk to a grown-up you trust.' } })
    expect(speak.asked.join(' ')).toBe('Thank you for telling me. Please talk to a grown-up you trust.')
    expect(t.gaveUp).toEqual([])
  })

  it('⛔ talked over: stop() ends the brain at once, and only what was said before is saved (review, opus)', async () => {
    const gate = Promise.withResolvers<void>()
    let brainStopped = false
    async function* slow(): AsyncGenerator<TutorEvent> {
      yield { kind: 'safety', harm: false }
      yield { kind: 'say', text: 'One.' }
      await gate.promise
      if (brainStopped) throw Object.assign(new Error('aborted'), { status: 504 })
      yield { kind: 'say', text: 'Two.' }
      yield { kind: 'final', reply: REPLY({ reply: 'One. Two.' }), model: 'm', calls: 1 }
    }
    const saved: { a: Answer; clientGone: boolean }[] = []
    const t = streamTurn({
      learnerText: 'hi', events: slow(), speak: voice(),
      save: async (a, c) => { saved.push({ a, clientGone: c.clientGone() }); return SAVED(a) },
      giveUp: async () => {}, safetyLine: 'x', stopBrain: () => { brainStopped = true; gate.resolve() },
    })
    for await (const l of t.lines) if (l.kind === 'part-end') t.stop()
    await t.done
    expect(brainStopped).toBe(true)
    expect(saved).toEqual([{ a: expect.objectContaining({ model: 'cut-off', reply: expect.objectContaining({ reply: 'One.' }) }), clientGone: true }])
  })

  it('⛔ gone while the first sentence still waits for its voice: nothing was heard — the turn is given back (review, codex)', async () => {
    const gate = Promise.withResolvers<void>()
    const speak: Speaker = async () => { await gate.promise; return { rate: 24_000, chunks: (async function* () { yield new Uint8Array(10) })() } }
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'One.' }, { kind: 'say', text: 'Two.' }, { kind: 'final', reply: REPLY({ reply: 'One. Two.' }), model: 'm', calls: 1 }), { speak })
    for await (const l of t.lines) if (l.kind === 'say') t.stop() // its words are shown; its voice has not started
    gate.resolve()
    await t.done
    expect(t.saved).toEqual([])
    expect(t.gaveUp).toHaveLength(1)
  })

  it('⛔ the page left before the drill\'s request sounded: saved as what was heard — no drill (review round 2, codex)', async () => {
    const r = REPLY({ reply: 'Good. Please say after me: I think so.', expect: 'I think so.' })
    let dropped = 0
    const saved: Answer[] = []
    // the drill's voice is still being made when the page leaves
    const speak: Speaker = async (text, signal) => {
      if (text.startsWith('Please')) await new Promise((res) => signal.addEventListener('abort', res, { once: true }))
      return { rate: 24_000, chunks: (async function* () { yield new Uint8Array(10) })() }
    }
    const t = streamTurn({
      learnerText: 'hi', events: brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Good.' }, { kind: 'say', text: 'Please say after me: I think so.' }, { kind: 'final', reply: r, model: 'm', calls: 1 }),
      speak, save: async (a) => { saved.push(a); return SAVED(a) }, giveUp: async () => {}, safetyLine: 'x', dropDrill: async () => { dropped += 1 },
    })
    // the brain was done; the page leaves when the last sentence's words show, before its voice
    for await (const l of t.lines) if (l.kind === 'say' && l.part === 1) t.stop()
    await t.done
    // every voice is settled BEFORE the save (2026-10-27): the row says what was heard, and sets no drill
    expect(saved[0]).toMatchObject({ model: 'cut-off', reply: { reply: 'Good.', expect: null } })
    expect(dropped).toBe(0)
  })

  it('⛔ the page left after the save: the drill is withdrawn before the answer ends (review round 2, codex)', async () => {
    const r = REPLY({ reply: 'Good. Please say after me: I think so.', expect: 'I think so.' })
    let dropped = 0
    let stop = () => {}
    const t = streamTurn({
      learnerText: 'hi', events: brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Good.' }, { kind: 'say', text: 'Please say after me: I think so.' }, { kind: 'final', reply: r, model: 'm', calls: 1 }),
      speak: voice(), save: async (a) => { stop(); return SAVED(a) }, giveUp: async () => {}, safetyLine: 'x', dropDrill: async () => { dropped += 1 },
    })
    stop = t.stop
    await collect(t.lines)
    await t.done
    expect(dropped).toBe(1)
  })

  it('⛔ a sentence whose voice failed: the drill is withdrawn BEFORE the save — the turn is saved with none (2026-10-27)', async () => {
    const speak: Speaker = async (text) => {
      if (text.startsWith('Please')) throw Object.assign(new Error('tts'), { status: 504 })
      return { rate: 24_000, chunks: (async function* () { yield new Uint8Array(10) })() }
    }
    const r = REPLY({ reply: 'Good. Please say after me: I think so.', expect: 'I think so.' })
    let dropped = 0
    const saved: Answer[] = []
    const t = streamTurn({
      learnerText: 'hi', events: brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Good.' }, { kind: 'say', text: 'Please say after me: I think so.' }, { kind: 'spoken', expect: 'I think so.' }, { kind: 'final', reply: r, model: 'm', calls: 1 }),
      speak, save: async (a) => { saved.push(a); return SAVED(a) }, giveUp: async () => {}, safetyLine: 'x', dropDrill: async () => { dropped += 1 },
    })
    const lines = await collect(t.lines)
    expect(saved[0].reply.expect).toBeNull()
    expect(dropped).toBe(0)
    // no `drill` line for the page either: its next turn sends no clip for a request nobody heard
    expect(kinds(lines)).not.toContain('drill')
    expect(kinds(lines)).not.toContain('no-drill')
  })

  it('no answer and nothing said: the turn is given back; the page is told (error), then end', async () => {
    async function* broken(): AsyncGenerator<TutorEvent> { yield { kind: 'safety', harm: false }; throw Object.assign(new Error('llm_502'), { status: 502 }) }
    const t = turn(broken())
    expect(await collect(t.lines)).toEqual([{ kind: 'heard', learnerText: 'I go market' }, { kind: 'error', error: 'tutor_unavailable' }, { kind: 'end' }])
    expect(t.gaveUp).toHaveLength(1)
    expect(t.saved).toEqual([])
  })

  it('the brain broke off after a sentence was said: what the learner heard is saved as the reply — no error', async () => {
    async function* cut(): AsyncGenerator<TutorEvent> { yield { kind: 'safety', harm: false }; yield { kind: 'say', text: 'Good try.' }; throw new Error('llm_502') }
    const t = turn(cut())
    const lines = await collect(t.lines)
    expect(t.saved[0].a).toMatchObject({ model: 'cut-off', reply: { reply: 'Good try.', hint: '', expect: null, safety: false } })
    expect(voiceOrder(lines)).toEqual({ lines: ['heard', 'say:Good try.', 'pcm:0', 'part-end:0', 'part-end:0:last', 'end'], replies: 1, tail: ['part-end:0:last', 'end'] })
  })

  it('a save that fails: after words were said, the voice still finishes (no reply line); before any, error', async () => {
    const failing = async () => { throw new Error('db down') }
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Nice!' }, { kind: 'final', reply: REPLY({ reply: 'Nice!' }), model: 'm', calls: 1 }), { save: failing })
    expect(kinds(await collect(t.lines))).toEqual(['heard', 'say:Nice!', 'pcm:0', 'part-end:0', 'part-end:0:last', 'end'])
    const t2 = turn(brain({ kind: 'safety', harm: false }, { kind: 'final', reply: REPLY({ reply: 'Nice!' }), model: 'm', calls: 1 }), { save: failing })
    expect(kinds(await collect(t2.lines))).toEqual(['heard', 'error', 'end'])
  })

  it('a sentence whose voice fails is audio-failed — its status logged, never its words — and the next one is voiced', async () => {
    const speak: Speaker = async (text) => {
      if (text.startsWith('Bad')) throw Object.assign(new Error('tts'), { status: 503 })
      return { rate: 24_000, chunks: (async function* () { yield new Uint8Array(10) })() }
    }
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Bad secret words.' }, { kind: 'say', text: 'Good.' }, { kind: 'final', reply: REPLY({ reply: 'Bad secret words. Good.' }), model: 'm', calls: 1 }), { speak })
    const lines = await collect(t.lines)
    expect(voiceOrder(lines).lines).toEqual(['heard', 'say:Bad secret words.', 'audio-failed', 'say:Good.', 'pcm:1', 'part-end:1', 'part-end:1:last', 'end'])
    expect(JSON.stringify(logs)).not.toMatch(/secret/)
    expect(logs[0][1]).toEqual({ part: 0, status: 503 })
  })

  it('no voice configured: the words alone, then the last part-end and end', async () => {
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Nice!' }, { kind: 'final', reply: REPLY({ reply: 'Nice!' }), model: 'm', calls: 1 }), { speak: null })
    expect(voiceOrder(await collect(t.lines))).toEqual({ lines: ['heard', 'say:Nice!', 'part-end:0:last', 'end'], replies: 1, tail: ['part-end:0:last', 'end'] })
  })

  it('⛔ the page goes away mid-answer: the voice stops at once, nothing more is written — and the turn is STILL saved', async () => {
    const gate = Promise.withResolvers<void>()
    async function* slow(): AsyncGenerator<TutorEvent> {
      yield { kind: 'safety', harm: false }
      yield { kind: 'say', text: 'One.' }
      await gate.promise
      yield { kind: 'say', text: 'Two.' }
      yield { kind: 'final', reply: REPLY({ reply: 'One. Two.' }), model: 'm', calls: 1 }
    }
    const speak = voice()
    const t = turn(slow(), { speak })
    const seen: TurnLine[] = []
    for await (const l of t.lines) {
      seen.push(l)
      if (l.kind === 'part-end') t.stop()
    }
    gate.resolve()
    await t.done
    expect(kinds(seen)).toEqual(['heard', 'say:One.', 'pcm:0', 'part-end:0'])
    expect(speak.signals[0].aborted).toBe(true)
    expect(speak.asked).toEqual(['One.']) // "Two." never voiced
    // saved as what was HEARD — "Two." was written after the page left (review round 2, codex + opus)
    expect(t.saved).toEqual([{ a: expect.objectContaining({ model: 'cut-off', reply: expect.objectContaining({ reply: 'One.', expect: null }) }), clientGone: true }])
  })
})

describe('streamTurn — the reply\'s voice closes at its last sentence (owner, 2026-10-27: "need super fast response")', () => {
  it('⚡ `spoken`: the last part-end goes out once the queued voices are, BEFORE the brain is done and the turn saved', async () => {
    const gate = Promise.withResolvers<void>()
    async function* brainy(): AsyncGenerator<TutorEvent> {
      yield { kind: 'safety', harm: false }
      yield { kind: 'say', text: 'Nice!' }
      yield { kind: 'say', text: 'What did you buy?' }
      yield { kind: 'spoken', expect: null }
      await gate.promise // the hint and its Vietnamese still being written
      yield { kind: 'final', reply: REPLY({ reply: 'Nice! What did you buy?' }), model: 'm', calls: 1 }
    }
    const t = turn(brainy())
    const seen: TurnLine[] = []
    for await (const l of t.lines) {
      seen.push(l)
      if (l.kind === 'part-end' && l.last) { expect(t.saved).toEqual([]); gate.resolve() }
    }
    expect(kinds(seen)).toEqual(['heard', 'say:Nice!', 'pcm:0', 'part-end:0', 'say:What did you buy?', 'pcm:1', 'part-end:1', 'part-end:1:last', 'reply', 'end'])
    expect(t.saved[0].a.reply.reply).toBe('Nice! What did you buy?')
  })
  it('a reply that asked for a drill: `drill` right before the last part-end (the page may get an answer before `reply`)', async () => {
    const r = REPLY({ reply: 'Good. Please say after me: I think so.', expect: 'I think so.' })
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Good.' }, { kind: 'say', text: 'Please say after me: I think so.' }, { kind: 'spoken', expect: 'I think so.' }, { kind: 'final', reply: r, model: 'm', calls: 1 }))
    const lines = await collect(t.lines)
    expect(voiceOrder(lines).lines.slice(-3)).toEqual(['drill', 'part-end:1:last', 'end'])
    expect(lines.find((l) => l.kind === 'drill')).toEqual({ kind: 'drill', expect: 'I think so.' })
    expect(t.saved[0].a.reply.expect).toBe('I think so.')
  })
  it('⛔ the page was told the drill, then the save failed: `no-drill` — no clip is scored against a drill nobody saved', async () => {
    const r = REPLY({ reply: 'Good. Please say after me: I think so.', expect: 'I think so.' })
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Good.' }, { kind: 'say', text: 'Please say after me: I think so.' }, { kind: 'spoken', expect: 'I think so.' }, { kind: 'final', reply: r, model: 'm', calls: 1 }), {
      save: async () => { throw new Error('db down') },
    })
    const k = kinds(await collect(t.lines))
    expect(k.indexOf('no-drill')).toBeGreaterThan(k.indexOf('drill'))
    expect(k.indexOf('drill')).toBeGreaterThanOrEqual(0)
    expect(k).not.toContain('reply')
    expect(k.at(-1)).toBe('end')
  })
  it('⛔ nothing is voiced after the close — a sentence the brain sends later is neither said nor saved; one last part-end', async () => {
    const speak = voice()
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'Nice!' }, { kind: 'spoken', expect: null }, { kind: 'say', text: 'Sneaky.' }, { kind: 'final', reply: REPLY({ reply: 'Nice! Sneaky.' }), model: 'm', calls: 1 }), { speak })
    const lines = await collect(t.lines)
    expect(speak.asked).toEqual(['Nice!'])
    expect(kinds(lines).filter((k) => k.endsWith(':last'))).toEqual(['part-end:0:last'])
    expect(kinds(lines)).not.toContain('say:Sneaky.')
    expect(t.saved[0].a).toMatchObject({ model: 'cut-off', reply: { reply: 'Nice!', expect: null } })
  })
  it('⛔ a harm-flagged turn ignores a `spoken`: its kind words are voiced after the save, then the last part-end', async () => {
    const speak = voice()
    const r = REPLY({ reply: 'Thank you for telling me. Please tell a trusted adult.', safety: true })
    const t = turn(brain({ kind: 'safety', harm: true }, { kind: 'spoken', expect: null }, { kind: 'final', reply: r, model: 'm', calls: 1 }), { speak })
    const lines = await collect(t.lines)
    expect(speak.asked.join(' ')).toBe(r.reply)
    expect(kinds(lines).filter((k) => k.endsWith(':last'))).toHaveLength(1)
    expect(kinds(lines).slice(-2)[0]).toMatch(/^part-end:\d+:last$/)
    expect(lines.findIndex((l) => l.kind === 'say')).toBeGreaterThan(lines.findIndex((l) => l.kind === 'reply'))
  })
  it('the breath goes BETWEEN sentences: a silent pcm line before the second (never counted as heard), none after the last', async () => {
    const speak: Speaker = async (text) => ({ rate: 1_000, pauseMs: 300, chunks: (async function* () { yield new Uint8Array(10).fill(text.charCodeAt(0)) })() })
    const t = turn(brain({ kind: 'safety', harm: false }, { kind: 'say', text: 'One.' }, { kind: 'say', text: 'Two.' }, { kind: 'spoken', expect: null }, { kind: 'final', reply: REPLY({ reply: 'One. Two.' }), model: 'm', calls: 1 }), { speak })
    const lines = await collect(t.lines)
    const pcm = lines.filter((l) => l.kind === 'pcm') as Extract<TurnLine, { kind: 'pcm' }>[]
    const bytes = pcm.map((l) => [...Buffer.from(l.data, 'base64')])
    expect(pcm.map((l) => l.part)).toEqual([0, 1, 1])
    expect(bytes[1]).toHaveLength(600) // 300 ms at 1 kHz, PCM16
    expect(bytes[1].every((b) => b === 0)).toBe(true)
    expect(bytes.at(-1)!.every((b) => b === 'T'.charCodeAt(0))).toBe(true) // the reply ends on its voice, not on a pause
  })
})

describe('replayTurn', () => {
  const saved: SavedReply = { seq: 2, learnerText: 'I go market', reply: 'Nice one! You went to the market yesterday. What did you buy there, and was it busy?', hint: 'h', hintVi: 'hv', expect: null, heardAs: [], secondsLeft: 200 }
  it('the latest turn again: its words, its voice made again part by part, the saved turn', async () => {
    const speak = voice()
    expect(voiceOrder(await collect(replayTurn(saved, speak).lines))).toEqual({
      lines: ['heard', 'say:Nice one! You went to the market yesterday.', 'pcm:0', 'part-end:0', 'say:What did you buy there, and was it busy?', 'pcm:1', 'part-end:1', 'part-end:1:last', 'end'],
      replies: 1,
      tail: ['part-end:1:last', 'end'],
    })
    expect(speak.asked).toEqual(['Nice one! You went to the market yesterday.', 'What did you buy there, and was it busy?'])
  })
  it('an older turn, or a flagged one: the words alone — no voice, no part-end', async () => {
    expect(kinds(await collect(replayTurn(saved, null).lines))).toEqual(['heard', 'reply', 'end'])
    expect(kinds(await collect(replayTurn({ ...saved, learnerText: '' }, null).lines))).toEqual(['reply', 'end'])
  })
})
