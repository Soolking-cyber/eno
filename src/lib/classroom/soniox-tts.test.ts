import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./soniox', () => ({
  sonioxConfig: () => ({ key: 'k'.repeat(40), rest: 'https://api.soniox.com', ws: 'wss://stt', model: 'stt-rt-v5', tts: 'wss://tts-rt.soniox.com/tts-websocket', ttsModel: 'tts-rt-v2' }),
}))

/**
 * THE AVATAR'S VOICE ON SONIOX (owner, 2026-10-27: "replace to soniox tts"): one socket, a stream per line, PCM as it is
 * made — the first sound or a refusal decides the call, a talk-over cancels at Soniox, a child's voice is louder without
 * clipping. The protocol as soniox.com/docs/api-reference/tts/websocket-api describes it.
 */
type Sent = Record<string, unknown>
class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  /** The next socket closes before it ever opens. */
  static closeBeforeOpen = false
  /** Sockets take this long to open. */
  static openDelayMs = 0
  readyState = 0
  sent: Sent[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(readonly url: string, readonly protocols: string[]) {
    FakeSocket.all.push(this)
    const dies = FakeSocket.closeBeforeOpen
    FakeSocket.closeBeforeOpen = false
    setTimeout(() => { if (dies) { this.readyState = 3; this.onclose?.() } else { this.readyState = 1; this.onopen?.() } }, FakeSocket.openDelayMs)
  }
  send(d: string) { this.sent.push(JSON.parse(d) as Sent) }
  close() { this.readyState = 3; this.onclose?.() }
  say(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  /** The stream the line went out on (its config message). */
  get line() { return this.sent.find((m) => 'voice' in m)?.stream_id as string }
}
const pcm = (...samples: number[]) => Buffer.from(new Int16Array(samples).buffer).toString('base64')
const style = { pace: 'natural' as const, loud: false, gapMs: 120, pauseMs: 80 }

let tts: typeof import('./soniox-tts')
beforeEach(async () => {
  vi.resetModules()
  FakeSocket.all = []
  FakeSocket.openDelayMs = 0
  vi.stubGlobal('WebSocket', FakeSocket)
  tts = await import('./soniox-tts')
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

/** Lets the socket open and the line's two messages go out. */
const settle = () => new Promise((r) => setTimeout(r, 5))

describe('sonioxSpeakStream', () => {
  it('a line in another language says so to Soniox (the voice concierge — VoiceStyle.language); the classroom stays English', async () => {
    const call = tts.sonioxSpeakStream('Xin chào.', 'Grace', { ...style, language: 'vi' })
    await settle()
    const ws = FakeSocket.all[0]
    expect(ws.sent[0]).toMatchObject({ language: 'vi', voice: 'Grace' })
    ws.say({ stream_id: ws.line, audio: pcm(1, 2, 3) })
    await call
  })

  it('opens with the key as Soniox\'s protocol pair; sends the line\'s settings, then its words with text_end', async () => {
    const call = tts.sonioxSpeakStream('Hello there.', 'Grace', { ...style, pace: 'gentle' })
    await settle()
    const ws = FakeSocket.all[0]
    expect(ws.url).toBe('wss://tts-rt.soniox.com/tts-websocket')
    expect(ws.protocols).toEqual(['soniox-api-key', 'k'.repeat(40)])
    expect(ws.sent[0]).toEqual({ stream_id: ws.line, model: 'tts-rt-v2', language: 'en', voice: 'Grace', audio_format: 'pcm_s16le', sample_rate: 24_000, speed: 0.91 })
    expect(ws.sent[1]).toEqual({ stream_id: ws.line, text: 'Hello there.', text_end: true })
    ws.say({ stream_id: ws.line, audio: pcm(1, 2, 3) })
    const r = await call
    expect(r.rate).toBe(24_000)
    expect(r.pauseMs).toBe(80)
    ws.say({ stream_id: ws.line, audio: pcm(4), audio_end: true })
    const out: number[] = []
    for await (const c of r.chunks) out.push(...new Int16Array(c.buffer, c.byteOffset, c.byteLength / 2))
    expect(out).toEqual([1, 2, 3, 4])
  })

  it('a refusal before any sound throws at once — the turn says audio-failed, the socket lives on', async () => {
    const call = tts.sonioxSpeakStream('Hi.', 'Nobody', style)
    await settle()
    const ws = FakeSocket.all[0]
    ws.say({ stream_id: ws.line, error_code: 400, error_message: 'unknown voice' })
    await expect(call).rejects.toMatchObject({ status: 400, stage: 'tts' })
    // the next line reuses the same socket
    const next = tts.sonioxSpeakStream('Again.', 'Grace', style)
    await settle()
    expect(FakeSocket.all).toHaveLength(1)
    ws.say({ stream_id: ws.sent.filter((m) => 'voice' in m)[1].stream_id, audio: pcm(9), audio_end: true })
    await expect(next).resolves.toMatchObject({ rate: 24_000 })
  })

  it('a talk-over (the caller\'s signal) cancels the stream at Soniox and ends the line quietly', async () => {
    const stop = new AbortController()
    const call = tts.sonioxSpeakStream('A long reply.', 'Grace', style, stop.signal)
    await settle()
    const ws = FakeSocket.all[0]
    ws.say({ stream_id: ws.line, audio: pcm(1) })
    const r = await call
    const it = r.chunks[Symbol.asyncIterator]()
    expect((await it.next()).done).toBe(false)
    stop.abort()
    expect((await it.next()).done).toBe(true)
    expect(ws.sent.at(-1)).toEqual({ stream_id: ws.line, cancel: true })
  })

  it('no first sound in time: 504; a stall after it: the line ends with 504', async () => {
    vi.useFakeTimers()
    const call = tts.sonioxSpeakStream('Hi.', 'Grace', style)
    const failed = expect(call).rejects.toMatchObject({ status: 504 })
    await vi.advanceTimersByTimeAsync(tts.TTS_BUDGET_MS + 10)
    await failed
  })

  it('the socket breaks mid-line: the line fails (502) — never a hang', async () => {
    const call = tts.sonioxSpeakStream('Hi.', 'Grace', style)
    await settle()
    const ws = FakeSocket.all[0]
    ws.say({ stream_id: ws.line, audio: pcm(1) })
    const r = await call
    ws.close()
    const read = (async () => { for await (const _ of r.chunks) { /* drain */ } })()
    await expect(read).rejects.toMatchObject({ status: 502 })
  })
})

describe('the review\'s holes, closed (codex + opus)', () => {
  it('talked over before the line went out: nothing is spoken (499)', async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(tts.sonioxSpeakStream('Hi.', 'Grace', style, stop.signal)).rejects.toMatchObject({ status: 499 })
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('a socket that closes before it opens fails the line (502) — never a hang — and the next line opens a new one', async () => {
    FakeSocket.closeBeforeOpen = true
    await expect(tts.sonioxSpeakStream('Hi.', 'Grace', style)).rejects.toMatchObject({ status: 502 })
    const next = tts.sonioxSpeakStream('Again.', 'Grace', style)
    await settle()
    const ws = FakeSocket.all[1]
    ws.say({ stream_id: ws.line, audio: pcm(5), audio_end: true })
    await expect(next).resolves.toMatchObject({ rate: 24_000 })
  })

  it('a child\'s louder voice survives a chunk cut mid-sample', async () => {
    const call = tts.sonioxSpeakStream('Hi.', 'Grace', { ...style, loud: true })
    await settle()
    const ws = FakeSocket.all[0]
    const bytes = Buffer.from(new Int16Array([1000, -1000]).buffer)
    ws.say({ stream_id: ws.line, audio: bytes.subarray(0, 3).toString('base64') })
    ws.say({ stream_id: ws.line, audio: bytes.subarray(3).toString('base64'), audio_end: true })
    const r = await call
    const out: number[] = []
    for await (const c of r.chunks) out.push(...new Int16Array(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength)))
    expect(out).toEqual([2000, -2000])
  })

  it('a sixth line at once opens a second socket (Soniox takes five streams on one)', async () => {
    for (let i = 0; i < 6; i++) void tts.sonioxSpeakStream(`Line ${i}.`, 'Grace', style).catch(() => {})
    await settle()
    expect(FakeSocket.all).toHaveLength(2)
    expect(FakeSocket.all[0].sent.filter((m) => 'voice' in m)).toHaveLength(5)
    expect(FakeSocket.all[1].sent.filter((m) => 'voice' in m)).toHaveLength(1)
  })
})

describe('round two (codex + opus)', () => {
  it('every socket full: the 21st line is refused here (429) — the box says it — never a sixth stream on a socket', async () => {
    for (let i = 0; i < 20; i++) void tts.sonioxSpeakStream(`Line ${i}.`, 'Grace', style).catch(() => {})
    await expect(tts.sonioxSpeakStream('One too many.', 'Grace', style)).rejects.toMatchObject({ status: 429 })
    await settle()
    expect(FakeSocket.all).toHaveLength(4)
    for (const ws of FakeSocket.all) expect(ws.sent.filter((m) => 'voice' in m).length).toBeLessThanOrEqual(5)
  })

  it('talked over while the socket opens: the words are never sent', async () => {
    FakeSocket.openDelayMs = 20
    const stop = new AbortController()
    const call = tts.sonioxSpeakStream('Never said.', 'Grace', style, stop.signal)
    stop.abort()
    await expect(call).rejects.toMatchObject({ status: 499 })
    await new Promise((r) => setTimeout(r, 30))
    expect(FakeSocket.all[0].sent.some((m) => 'text' in m)).toBe(false)
  })

  it('a talk-over drops what already arrived: nothing queued plays after it', async () => {
    const stop = new AbortController()
    const call = tts.sonioxSpeakStream('Hi.', 'Grace', style, stop.signal)
    await settle()
    const ws = FakeSocket.all[0]
    ws.say({ stream_id: ws.line, audio: pcm(1) })
    const r = await call
    ws.say({ stream_id: ws.line, audio: pcm(2) })
    ws.say({ stream_id: ws.line, audio: pcm(3) })
    const it = r.chunks[Symbol.asyncIterator]()
    expect((await it.next()).done).toBe(false) // the first sound
    stop.abort()
    expect((await it.next()).done).toBe(true) // 2 and 3 never play
  })

  it('the first-sound clock includes the socket\'s opening: a slow socket hands the line to the box on time (504)', async () => {
    FakeSocket.openDelayMs = 200
    const t0 = Date.now()
    await expect(tts.sonioxSpeakStream('Hi.', 'Grace', style, undefined, 50)).rejects.toMatchObject({ status: 504 })
    expect(Date.now() - t0).toBeLessThan(150)
    // …and once the socket does open, the words the box took are never sent to Soniox
    await new Promise((r) => setTimeout(r, 250))
    expect(FakeSocket.all[0].sent.some((m) => 'text' in m)).toBe(false)
  })

  it('talked over while the socket is stalled: answered at once (499), and the words never go out', async () => {
    FakeSocket.openDelayMs = 200
    const stop = new AbortController()
    const t0 = Date.now()
    const call = tts.sonioxSpeakStream('Hi.', 'Grace', style, stop.signal)
    setTimeout(() => stop.abort(), 20)
    await expect(call).rejects.toMatchObject({ status: 499 })
    expect(Date.now() - t0).toBeLessThan(150)
    await new Promise((r) => setTimeout(r, 250))
    expect(FakeSocket.all[0].sent.some((m) => 'text' in m)).toBe(false)
  })

  it('talked over before the first chunk was taken: not even the first one plays', async () => {
    const stop = new AbortController()
    const call = tts.sonioxSpeakStream('Hi.', 'Grace', style, stop.signal)
    await settle()
    const ws = FakeSocket.all[0]
    ws.say({ stream_id: ws.line, audio: pcm(1) })
    const r = await call
    stop.abort()
    expect((await r.chunks[Symbol.asyncIterator]().next()).done).toBe(true)
  })

  it('a child\'s whole line comes LOUDER, as a WAV (16 kHz) — an MP3 cannot be made louder', async () => {
    const call = tts.sonioxSpeakLine('Hello.', 'Grace', { ...style, loud: true })
    await settle()
    const ws = FakeSocket.all[0]
    expect(ws.sent[0]).toMatchObject({ audio_format: 'pcm_s16le', sample_rate: 16_000 })
    ws.say({ stream_id: ws.line, audio: Buffer.from(new Int16Array(200).fill(1000).buffer).toString('base64'), audio_end: true })
    const wav = await call
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16_000)
    expect(wav.readInt16LE(44)).toBe(2000)
  })
})

describe('round three (codex + opus)', () => {
  it('a line over for us (audio_end) still counts against the socket\'s five until Soniox says terminated', async () => {
    const lines = Array.from({ length: 5 }, (_, i) => tts.sonioxSpeakStream(`Line ${i}.`, 'Grace', style))
    await settle()
    const ws = FakeSocket.all[0]
    const ids = ws.sent.filter((m) => 'voice' in m).map((m) => m.stream_id as string)
    for (const id of ids) ws.say({ stream_id: id, audio: pcm(1), audio_end: true })
    await Promise.all(lines)
    void tts.sonioxSpeakStream('Sixth.', 'Grace', style).catch(() => {})
    await settle()
    expect(FakeSocket.all).toHaveLength(2) // the five are still Soniox's: a new socket
    ws.say({ stream_id: ids[0], terminated: true })
    void tts.sonioxSpeakStream('Seventh.', 'Grace', style).catch(() => {})
    await settle()
    expect(ws.sent.filter((m) => 'voice' in m)).toHaveLength(6) // one slot freed on the first socket
  })
})

describe('louder', () => {
  it('a child\'s voice is +6 dB, and a peak bends under full scale instead of clipping', () => {
    const out = new Int16Array(tts.louder(new Uint8Array(new Int16Array([1000, -1000, 20000, -30000]).buffer)).buffer)
    expect(out[0]).toBe(2000)
    expect(out[1]).toBe(-2000)
    expect(out[2]).toBeGreaterThan(22_000)
    expect(out[2]).toBeLessThanOrEqual(32_767)
    expect(out[3]).toBeLessThan(-22_000)
    expect(out[3]).toBeGreaterThanOrEqual(-32_767)
  })
})

describe('sonioxSpeakLine', () => {
  it('a whole line as MP3 (the opening line, the voice samples): the chunks joined', async () => {
    const call = tts.sonioxSpeakLine('Hello.', 'Grace', style)
    await settle()
    const ws = FakeSocket.all[0]
    expect(ws.sent[0]).toMatchObject({ audio_format: 'mp3', voice: 'Grace', speed: 1 })
    expect(ws.sent[0]).not.toHaveProperty('sample_rate')
    ws.say({ stream_id: ws.line, audio: Buffer.alloc(150, 1).toString('base64') })
    ws.say({ stream_id: ws.line, audio: Buffer.alloc(150, 2).toString('base64'), audio_end: true })
    const mp3 = await call
    expect(mp3.length).toBe(300)
  })
})
