// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFiller, isHesitation, openLiveStt } from './live-stt'

/**
 * LIVE LISTENING, PAGE SIDE (owner, 2026-10-26: "make it instant conversation"): the socket opens with the server's single-use
 * key, audio flows only inside an utterance, Soniox's end markers hand back each utterance's words — and anything broken
 * sends the page back to clips.
 */
class FakeSocket {
  static last: FakeSocket | null = null
  static OPEN = 1
  readyState = 0
  sent: unknown[] = []
  protocols: string[]
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  binaryType = ''
  constructor(readonly url: string, protocols: string[]) { this.protocols = protocols; FakeSocket.last = this; setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
  send(d: unknown) { this.sent.push(d) }
  close() { this.readyState = 3 }
  /** Soniox says something. */
  say(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

const grant = { apiKey: 'temp_key_123', url: 'wss://stt-rt.soniox.com/transcribe-websocket', model: 'stt-rt-v5', settings: { endpoint_sensitivity: 0.3, endpoint_latency_adjustment_level: 2, max_endpoint_delay_ms: 1200 }, languageHints: ['en'] }
const open = async (ok = true) => {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn(async () => (ok ? new Response(JSON.stringify(grant), { status: 200 }) : new Response('{}', { status: 503 }))))
  const got = { utterances: [] as [string, number][], failed: 0, activity: [] as boolean[] }
  const l = await openLiveStt('s1', {
    utterance: (t, ms) => got.utterances.push([t, ms]), failed: () => { got.failed += 1 }, activity: (sp) => { got.activity.push(sp) },
  })
  return { l, got, ws: FakeSocket.last! }
}
afterEach(() => { vi.unstubAllGlobals(); FakeSocket.last = null })

describe('openLiveStt', () => {
  it('opens with the single-use key as Soniox’s protocol pair, then sends the stream’s settings first', async () => {
    const { l, ws } = await open()
    expect(l).not.toBeNull()
    expect(ws.url).toBe(grant.url)
    expect(ws.protocols).toEqual(['soniox-api-key', 'temp_key_123'])
    expect(JSON.parse(ws.sent[0] as string)).toEqual({
      model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 16_000, num_channels: 1, language_hints: ['en'], enable_endpoint_detection: true,
      endpoint_sensitivity: 0.3, endpoint_latency_adjustment_level: 2, max_endpoint_delay_ms: 1200,
    })
    expect(l!.maxDelayMs).toBe(1200)
  })
  it('no key (refused, or no Soniox): null — the page keeps sending clips', async () => {
    const { l } = await open(false)
    expect(l).toBeNull()
  })
  it('audio only from begin() to pause(); the final words up to <end> are one utterance, with its length', async () => {
    const { l, got, ws } = await open()
    l!.push(new Int16Array([1, 2, 3]))
    expect(ws.sent).toHaveLength(1) // only the settings: no utterance yet
    l!.begin()
    l!.push(new Int16Array(1_600)) // 100 ms on the stream's clock
    expect(ws.sent).toHaveLength(2)
    ws.say({ tokens: [{ text: 'I', is_final: true, start_ms: 10, end_ms: 200 }, { text: ' go', is_final: false }] })
    ws.say({ tokens: [{ text: ' go', is_final: true, end_ms: 400 }, { text: ' market', is_final: true, end_ms: 810 }, { text: '<end>', is_final: true }] })
    expect(got.utterances).toEqual([['I go market', 800]])
    l!.pause()
    l!.push(new Int16Array([4]))
    expect(ws.sent).toHaveLength(2)
  })
  it('an empty <end> (a cough) is no utterance and the stream goes on; an empty <fin> answers the page’s finalize', async () => {
    const { l, got, ws } = await open()
    l!.begin()
    ws.say({ tokens: [{ text: '<end>', is_final: true }] })
    expect(got.utterances).toEqual([])
    l!.push(new Int16Array(160))
    expect(ws.sent).toHaveLength(2) // still streaming
    l!.finalize()
    ws.say({ tokens: [{ text: '<fin>', is_final: true }] })
    expect(got.utterances).toEqual([['', 0]])
  })
  it('⛔ an abandoned utterance’s late words and markers never become the next one (review, codex)', async () => {
    const { l, got, ws } = await open()
    l!.begin()
    l!.push(new Int16Array(16_000)) // 1 s of the first utterance
    l!.finalize() // the learner stopped; its words are owed …
    l!.cancel() // … and the page gave up: sent as a clip
    l!.begin() // the next utterance starts at 1 s on the clock
    l!.push(new Int16Array(8_000))
    // the first utterance's words and both its <fin>s arrive late
    ws.say({ tokens: [{ text: 'old words', is_final: true, start_ms: 100, end_ms: 900 }, { text: '<fin>', is_final: true }, { text: '<fin>', is_final: true }] })
    expect(got.utterances).toEqual([])
    ws.say({ tokens: [{ text: 'new words', is_final: true, start_ms: 1_050, end_ms: 1_450 }, { text: '<end>', is_final: true }] })
    expect(got.utterances).toEqual([['new words', 400]])
  })
  it('finalize asks Soniox to end it now (<fin> counts as the end)', async () => {
    const { l, got, ws } = await open()
    l!.begin()
    l!.finalize()
    expect(JSON.parse(ws.sent.at(-1) as string)).toEqual({ type: 'finalize' })
    ws.say({ tokens: [{ text: 'Hello', is_final: true, start_ms: 0, end_ms: 300 }, { text: '<fin>', is_final: true }] })
    expect(got.utterances).toEqual([['Hello', 300]])
  })
  it('⛔ re-checked every minute while open: a refusal (a withdrawal, the switch) closes it — a network blip does not', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const { got } = await open()
      const fetches = vi.mocked(fetch)
      fetches.mockImplementationOnce(async () => new Response(null, { status: 204 }))
      vi.advanceTimersByTime(60_000)
      await Promise.resolve(); await Promise.resolve()
      expect(got.failed).toBe(0)
      fetches.mockImplementationOnce(async () => { throw new TypeError('offline') })
      vi.advanceTimersByTime(60_000)
      await new Promise((r) => setTimeout(r, 0))
      expect(got.failed).toBe(0)
      fetches.mockImplementationOnce(async () => new Response('{"error":"seat_inactive"}', { status: 409 }))
      vi.advanceTimersByTime(60_000)
      await new Promise((r) => setTimeout(r, 0))
      expect(got.failed).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('an error message or a closed socket: failed() once, nothing more sent', async () => {
    const { l, got, ws } = await open()
    ws.say({ tokens: [], error_code: 402, error_type: 'payment_required' })
    expect(got.failed).toBe(1)
    l!.begin()
    l!.push(new Int16Array([1]))
    ws.onclose?.()
    expect(got.failed).toBe(1)
    expect(ws.sent).toHaveLength(1)
  })
  it('close(): an empty frame ends Soniox’s stream, and it is not a failure', async () => {
    const { l, got, ws } = await open()
    l!.close()
    expect(ws.sent.at(-1)).toBe('')
    expect(got.failed).toBe(0)
  })
})

describe('openLiveStt — Soniox decides (owner, 2026-10-27: "let the stt decide itself")', () => {
  it('every answer says whether this utterance holds words — in progress or final — so the page can say "Hearing you"', async () => {
    const { l, got, ws } = await open()
    l!.begin()
    ws.say({ tokens: [] }) // silence: Soniox answers about once a second anyway (measured)
    ws.say({ tokens: [{ text: 'I wa', is_final: false, start_ms: 120 }] })
    ws.say({ tokens: [{ text: 'I', is_final: true, start_ms: 120, end_ms: 300 }, { text: ' want', is_final: false, start_ms: 320 }] })
    ws.say({ tokens: [{ text: ' want', is_final: true, end_ms: 600 }, { text: '<end>', is_final: true }] })
    ws.say({ tokens: [{ text: 'hm', is_final: false, start_ms: 900 }] })
    ws.say({ tokens: [] }) // the noise it took back
    expect(got.activity).toEqual([false, true, true, false, true, false])
    expect(got.utterances).toEqual([['I want', 480]])
    l!.pause()
    ws.say({ tokens: [{ text: 'late', is_final: false, start_ms: 2_000 }] })
    expect(got.activity).toHaveLength(6) // nothing after the page paused for its turn
  })
  it('⛔ a keepalive whenever no audio went for 8 s — even while listening (an iOS interruption stops the frames)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const { l, ws } = await open()
      l!.begin()
      const keepalives = () => ws.sent.filter((d) => typeof d === 'string' && d.includes('keepalive')).length
      for (let i = 0; i < 20; i++) { l!.push(new Int16Array(1_600)); vi.advanceTimersByTime(1_000); ws.say({ tokens: [] }) }
      expect(keepalives()).toBe(0) // audio flowing
      vi.advanceTimersByTime(12_000) // the frames stopped, the page still "listening"
      expect(keepalives()).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('⛔ audio going out and no answer for 6 s: the socket is stuck — failed(), the page goes back to clips', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const { l, got, ws } = await open()
      l!.begin()
      for (let i = 0; i < 10; i++) { l!.push(new Int16Array(1_600)); vi.advanceTimersByTime(1_000); ws.say({ tokens: [] }) }
      expect(got.failed).toBe(0) // it answers: alive
      for (let i = 0; i < 5; i++) { l!.push(new Int16Array(1_600)); vi.advanceTimersByTime(1_000) }
      expect(got.failed).toBe(0) // 5 s without an answer — still within STALL_MS
      for (let i = 0; i < 3; i++) { l!.push(new Int16Array(1_600)); vi.advanceTimersByTime(1_000) }
      expect(got.failed).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('a pause in the audio (thinking, the avatar speaking) is not a stall: the clock restarts when it flows again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const { l, got, ws } = await open()
      l!.begin()
      l!.push(new Int16Array(1_600)); ws.say({ tokens: [] })
      l!.pause()
      vi.advanceTimersByTime(30_000) // the avatar talks; keepalives hold the socket, Soniox says nothing
      l!.begin()
      for (let i = 0; i < 4; i++) { l!.push(new Int16Array(1_600)); vi.advanceTimersByTime(1_000) }
      expect(got.failed).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('isHesitation — the only sound that is never a turn', () => {
  it('a pure hesitation in English or Vietnamese; a word that can be an answer is not one', () => {
    for (const h of ['Um', 'uh…', 'Hmm.', 'Ermm', 'Eh', 'ờ', 'Ừm', 'à', 'ờ ờ', 'u\u031B\u0300m']) expect(isHesitation(h), h).toBe(true)
    for (const a of ['So', 'Well,', 'like', 'and um', 'thì', 'Yes.', 'No', 'ừ', 'ờ 5', 'Mm.', 'Mhm', 'uh-huh', '']) expect(isHesitation(a), a).toBe(false)
  })
})

describe('isFiller', () => {
  it('only filler words are held for what follows; a short ANSWER is a turn', () => {
    for (const f of ['Um', 'uh…', 'Hmm.', 'Ermm', 'Eh', 'So', 'Well,', 'and um', 'like', 'mmm', 'ờ', 'Ừm', 'à', 'thì', 'ờ thì']) expect(isFiller(f), f).toBe(true)
    for (const a of ['Yes.', 'No', 'OK', "I'm fine", 'Dogs', 'So good', 'So-so', 'Hello there', 'ừ', '']) expect(isFiller(a), a).toBe(false)
  })
  it('a number is an answer ("like 2"); a decomposed Vietnamese filler is still a filler (review, codex + opus)', () => {
    expect(isFiller('like 2')).toBe(false)
    expect(isFiller('ờ 5')).toBe(false)
    expect(isFiller('o\u031B\u0300')).toBe(true) // "ờ" as o + horn + grave
    expect(isFiller('u\u031B\u0300m')).toBe(true) // "ừm"
  })
})
