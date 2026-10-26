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

const REPLY = (o: Partial<TutorReply> = {}): TutorReply => ({ reply: 'Nice! We say: I went to the market.', hint: 'I went to the market.', hintVi: 'Tôi đã đi chợ.', expect: null, heardAs: [], safety: false, ...o })
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
const turn = (events: AsyncIterable<TutorEvent>, o: { speak?: Speaker | null; save?: (a: Answer, c: { clientGone: () => boolean }) => Promise<SavedReply> } = {}) => {
  const saved: { a: Answer; clientGone: boolean }[] = []
  const gaveUp: unknown[] = []
  const t = streamTurn({
    learnerText: 'I go market',
    events,
    speak: o.speak === undefined ? voice() : o.speak,
    save: o.save ?? (async (a, c) => { saved.push({ a, clientGone: c.clientGone() }); return SAVED(a) }),
    giveUp: async (e) => { gaveUp.push(e) },
    safetyLine: 'Thank you for telling me. Please talk to a grown-up you trust.',
  })
  return { ...t, saved, gaveUp }
}
const kinds = (l: TurnLine[]) => l.map((x) => (x.kind === 'say' ? `say:${x.text}` : x.kind === 'part-end' ? `part-end:${x.part}${x.last ? ':last' : ''}` : x.kind === 'pcm' ? `pcm:${x.part}` : x.kind))
/** The `reply` line lands whenever the save finishes — the voice never waits for it: the lines without it, and how many. */
const voiceOrder = (l: TurnLine[]) => ({ lines: kinds(l).filter((k) => k !== 'reply'), replies: kinds(l).filter((k) => k === 'reply').length, tail: kinds(l).slice(-2) })

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
