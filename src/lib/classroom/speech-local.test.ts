import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_SPOKEN_CHARS, TTS_STALL_MS, localSpeechConfig, spokenPart, synthesize, synthesizeStream, transcribe } from './speech-local'
import { NATURAL_VOICE, voiceStyle } from './pace'
import { SpeechError } from './azure-speech'

vi.mock('server-only', () => ({}))
afterEach(() => vi.unstubAllEnvs())

const CFG = { url: 'http://eno-classroom-speech:8090', key: 'k'.repeat(32) }
const WAV = Buffer.from('RIFF....WAVEfmt ')
const MP3 = new Uint8Array(4_000).fill(0xff)

type Call = { url: string; init: RequestInit }
function fake(...answers: (Response | Error)[]) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const a = answers.shift()
    if (!a) throw new Error('no more answers')
    if (a instanceof Error) throw a
    return a
  }) as unknown as typeof fetch
  return { impl, calls }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name)

describe('localSpeechConfig', () => {
  it('needs both the address and a real key; a public-looking or odd URL is refused', () => {
    expect(localSpeechConfig()).toBeNull()
    vi.stubEnv('CLASSROOM_SPEECH_URL', 'http://eno-classroom-speech:8090/')
    expect(localSpeechConfig()).toBeNull()
    vi.stubEnv('CLASSROOM_SPEECH_KEY', 'short')
    expect(localSpeechConfig()).toBeNull()
    vi.stubEnv('CLASSROOM_SPEECH_KEY', 'k'.repeat(24))
    expect(localSpeechConfig()).toEqual({ url: 'http://eno-classroom-speech:8090', key: 'k'.repeat(24) })
    vi.stubEnv('CLASSROOM_SPEECH_URL', 'http://eno-classroom-speech:8090/stt?x=1')
    expect(localSpeechConfig()).toBeNull()
  })
  it('⛔ only eno’s own network: a container name, loopback or a private address — never a public host', () => {
    vi.stubEnv('CLASSROOM_SPEECH_KEY', 'k'.repeat(24))
    for (const ok of ['http://eno-classroom-speech:8090', 'http://127.0.0.1:8090', 'http://localhost:8090', 'http://10.0.4.2:8090', 'http://172.20.0.5:8090', 'http://192.168.1.9:8090', 'http://100.101.2.3:8090']) {
      vi.stubEnv('CLASSROOM_SPEECH_URL', ok)
      expect(localSpeechConfig(), ok).not.toBeNull()
    }
    for (const bad of ['http://example.com:8090', 'http://speech.eno.vn', 'http://8.8.8.8:8090', 'http://172.32.0.1:8090', 'http://100.128.0.1:8090', 'http://eno-classroom-speech.:8090', 'ftp://eno-classroom-speech:8090', 'http://user@eno-classroom-speech:8090',
      // the same public address written as one number, or in hex — fetch() reads both as 8.8.8.8
      'http://134744072:8090', 'http://0x8.0x8.0x8.0x8:8090', 'http://0x08080808:8090',
      // any other single name could resolve through the host's search domain
      'http://eno-classrom-speech:8090', 'http://speech:8090', 'http://ENO-CLASSROOM-SPEECH.evil:8090']) {
      vi.stubEnv('CLASSROOM_SPEECH_URL', bad)
      expect(localSpeechConfig(), bad).toBeNull()
    }
    // canonical forms of a loopback address are loopback
    vi.stubEnv('CLASSROOM_SPEECH_URL', 'http://0x7f.0.0.1:8090')
    expect(localSpeechConfig()).toMatchObject({ url: 'http://127.0.0.1:8090' })
  })
})

describe('transcribe', () => {
  it('posts the WAV with the key; the words come back as heard', async () => {
    const f = fake(json({ text: ' I go to school yesterday. ', status: 'ok', seconds: 2.1, ms: 400 }))
    expect(await transcribe(CFG, WAV, f.impl)).toEqual({ text: 'I go to school yesterday.', status: 'ok' })
    expect(f.calls[0].url).toBe('http://eno-classroom-speech:8090/stt')
    expect(header(f.calls[0], 'x-speech-key')).toBe(CFG.key)
    expect(header(f.calls[0], 'content-type')).toBe('audio/wav')
    expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal)
    expect(f.calls[0].init.redirect).toBe('error') // the checked address only — a redirect may not carry the audio away
  })
  it('silence, or an empty "ok", is silence', async () => {
    expect(await transcribe(CFG, WAV, fake(json({ text: '', status: 'silence' })).impl)).toEqual({ text: '', status: 'silence' })
    expect(await transcribe(CFG, WAV, fake(json({ text: '  ', status: 'ok' })).impl)).toEqual({ text: '', status: 'silence' })
  })
  it('a retry never outlives the stage’s budget: a 503 that came late is final', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const f = fake(json({ error: 'busy' }, 503), json({ text: 'late', status: 'ok' }))
      const slow = vi.fn(async (u: string | URL | Request, i?: RequestInit) => { vi.setSystemTime(Date.now() + 10_000); return f.impl(u, i) }) as unknown as typeof fetch
      await expect(transcribe(CFG, WAV, slow)).rejects.toMatchObject({ status: 503, stage: 'stt' })
      expect(f.calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('busy once → one short wait and one retry; busy twice → a 503 SpeechError', async () => {
    const f = fake(json({ error: 'busy' }, 503), json({ text: 'Hello', status: 'ok' }))
    expect(await transcribe(CFG, WAV, f.impl)).toEqual({ text: 'Hello', status: 'ok' })
    expect(f.calls).toHaveLength(2)
    await expect(transcribe(CFG, WAV, fake(json({}, 503), json({}, 503)).impl)).rejects.toMatchObject({ status: 503, stage: 'stt' })
  })
  it('unreachable, refused or malformed → a SpeechError, never the raw error', async () => {
    await expect(transcribe(CFG, WAV, fake(new TypeError('fetch failed')).impl)).rejects.toBeInstanceOf(SpeechError)
    await expect(transcribe(CFG, WAV, fake(json({ error: 'unauthorised' }, 401)).impl)).rejects.toMatchObject({ status: 401, stage: 'stt' })
    await expect(transcribe(CFG, WAV, fake(new Response('not json')).impl)).rejects.toMatchObject({ status: 502, stage: 'stt' })
    await expect(transcribe(CFG, WAV, fake(json({ text: 5, status: 'ok' })).impl)).rejects.toMatchObject({ status: 502 })
    await expect(transcribe(CFG, WAV, fake(json({ text: 'x', status: 'maybe' })).impl)).rejects.toMatchObject({ status: 502 })
  })
})

describe('synthesize', () => {
  it('posts text, voice and the voice style as JSON — the pace by NAME, and `rate` for a server from before the paces; MP3 bytes come back', async () => {
    const f = fake(new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } }))
    const out = await synthesize(CFG, 'Hello there.', 'Harper', voiceStyle('child-young', 'slowest'), f.impl)
    expect(out.length).toBe(MP3.length)
    expect(f.calls[0].url).toBe('http://eno-classroom-speech:8090/tts')
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ text: 'Hello there.', voice: 'Harper', pace: 'slowest', rate: 'slow', loud: true, gap_ms: 450 })
    const g = fake(new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } }))
    await synthesize(CFG, 'Hi.', 'Harper', voiceStyle('adult', 'quick'), g.impl)
    expect(JSON.parse(String(g.calls[0].init.body))).toEqual({ text: 'Hi.', voice: 'Harper', pace: 'quick', rate: 'natural', loud: false, gap_ms: 120 })
    expect(header(f.calls[0], 'x-speech-key')).toBe(CFG.key)
  })
  it('busyRetry false (the concierge\'s opening line): a busy server is asked ONCE — the 503 is final', async () => {
    const f = fake(json({ error: 'busy' }, 503), new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } }))
    await expect(synthesize(CFG, 'Hi.', 'Zoey', NATURAL_VOICE, f.impl, { busyRetry: false })).rejects.toMatchObject({ status: 503, stage: 'tts' })
    expect(f.calls).toHaveLength(1)
    const g = fake(json({ error: 'busy' }, 503), new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } }))
    expect((await synthesize(CFG, 'Hi.', 'Zoey', NATURAL_VOICE, g.impl)).length).toBe(MP3.length)
    expect(g.calls).toHaveLength(2)
  })
  it('a line over the server’s cap is cut at its last full sentence, never refused whole', async () => {
    const long = 'This is one sentence of the reply. '.repeat(30)
    expect(long.length).toBeGreaterThan(MAX_SPOKEN_CHARS)
    const part = spokenPart(long)
    expect(part.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS)
    expect(part.endsWith('reply.')).toBe(true)
    expect(spokenPart('Short.')).toBe('Short.')
    // a sentence ending EXACTLY at the cap is kept whole
    const exact = `${'x'.repeat(MAX_SPOKEN_CHARS - 1)}. And more after it.`
    expect(spokenPart(exact)).toBe(`${'x'.repeat(MAX_SPOKEN_CHARS - 1)}.`)
    // closing quotes and a line break end a sentence too
    const quoted = `${'He said "Lovely." '.repeat(40)}`
    expect(spokenPart(quoted).endsWith('Lovely."')).toBe(true)
    const lines = `${'One line.\n'.repeat(70)}`
    expect(spokenPart(lines).endsWith('line.')).toBe(true)
    // no sentence end at all: it ends on a whole word
    const words = 'practise '.repeat(80)
    expect(spokenPart(words).split(' ').every((w) => w === 'practise')).toBe(true)
    // never half an emoji
    const emoji = `${'a'.repeat(MAX_SPOKEN_CHARS - 1)}😀 tail`
    expect(spokenPart(emoji)).not.toMatch(/[\uD800-\uDBFF]$/)
    const f = fake(new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } }))
    await synthesize(CFG, long, 'Harper', NATURAL_VOICE, f.impl)
    expect(JSON.parse(String(f.calls[0].init.body)).text).toBe(part)
  })
  it('anything but audio, or a stub, is a 502', async () => {
    await expect(synthesize(CFG, 'x', 'Harper', NATURAL_VOICE, fake(json({ ok: true })).impl)).rejects.toMatchObject({ status: 502, stage: 'tts' })
    await expect(synthesize(CFG, 'x', 'Harper', NATURAL_VOICE, fake(new Response(new Uint8Array(10), { headers: { 'content-type': 'audio/mpeg' } })).impl)).rejects.toMatchObject({ status: 502 })
    await expect(synthesize(CFG, 'x', 'Bob', NATURAL_VOICE, fake(json({ error: 'voice' }, 400)).impl)).rejects.toMatchObject({ status: 400, stage: 'tts' })
  })
})

describe('synthesizeStream', () => {
  /** A /tts/stream answer: raw PCM in the given chunks, at `rate`. */
  const pcm = (chunks: number[][], rate = '24000', type = 'audio/L16;rate=24000;channels=1') => new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(new Uint8Array(ch)); c.close() },
  }), { headers: { 'content-type': type, 'x-sample-rate': rate } })
  const all = async (g: AsyncGenerator<Uint8Array>) => { const out: number[][] = []; for await (const c of g) out.push([...c]); return out }

  it('posts the line to /tts/stream and yields the voice as it comes — whole samples only, an odd byte carried over', async () => {
    const f = fake(pcm([[1, 2, 3], [4, 5, 6], [7]]))
    const v = await synthesizeStream(CFG, 'Hello there.', 'Harper', voiceStyle('adult', 'gentle'), undefined, f.impl)
    expect(v.rate).toBe(24_000)
    expect(await all(v.chunks)).toEqual([[1, 2], [3, 4, 5, 6]])
    expect(f.calls[0].url).toBe('http://eno-classroom-speech:8090/tts/stream')
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ text: 'Hello there.', voice: 'Harper', pace: 'gentle', rate: 'slow', loud: false, gap_ms: 120 })
    expect(header(f.calls[0], 'x-speech-key')).toBe(CFG.key)
    expect(f.calls[0].init.redirect).toBe('error')
  })
  it('a line is its voice alone — no silence after it; its pause (for the caller to put BEFORE a next sentence) comes with it', async () => {
    const f = fake(pcm([[1, 2]], '1000'))
    const v = await synthesizeStream(CFG, 'Hello.', 'Zoey', voiceStyle('child', 'slowest'), undefined, f.impl)
    expect(await all(v.chunks)).toEqual([[1, 2]])
    expect(v.pauseMs).toBe(voiceStyle('child', 'slowest').pauseMs)
    const stop = new AbortController()
    const g = fake(pcm([[1, 2], [3, 4]], '1000'))
    const w = await synthesizeStream(CFG, 'Hello.', 'Zoey', voiceStyle('child', 'slowest'), stop.signal, g.impl)
    const cut: number[][] = []
    for await (const c of w.chunks) { cut.push([...c]); stop.abort() }
    expect(cut).toEqual([[1, 2]])
  })
  it('a busy server is asked once more; any other refusal, an unreachable server or a non-PCM answer is a SpeechError', async () => {
    const busy = fake(json({ error: 'busy' }, 503), pcm([[0, 0]]))
    expect(await all((await synthesizeStream(CFG, 'x', 'Harper', NATURAL_VOICE, undefined, busy.impl)).chunks)).toEqual([[0, 0]])
    expect(busy.calls).toHaveLength(2)
    await expect(synthesizeStream(CFG, 'x', 'Bob', NATURAL_VOICE, undefined, fake(json({ error: 'voice' }, 400)).impl)).rejects.toMatchObject({ status: 400, stage: 'tts' })
    await expect(synthesizeStream(CFG, 'x', 'Harper', NATURAL_VOICE, undefined, fake(new TypeError('fetch failed')).impl)).rejects.toBeInstanceOf(SpeechError)
    await expect(synthesizeStream(CFG, 'x', 'Harper', NATURAL_VOICE, undefined, fake(new Response('<html>', { headers: { 'content-type': 'text/html' } })).impl)).rejects.toMatchObject({ status: 502, stage: 'tts' })
  })
  it('⛔ a stall AFTER the first sound is a failed voice, not a finished one (review round 2, codex)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let pulls = 0
      const body = new ReadableStream({
        pull(c) {
          pulls += 1
          if (pulls === 1) { c.enqueue(new Uint8Array([1, 2])); return }
          return new Promise<void>(() => {}) // the server stopped sending
        },
      })
      const f = fake(new Response(body, { headers: { 'content-type': 'audio/L16', 'x-sample-rate': '24000' } }))
      const v = await synthesizeStream(CFG, 'x', 'Harper', NATURAL_VOICE, undefined, f.impl)
      const got: number[][] = []
      const run = (async () => { for await (const c of v.chunks) got.push([...c]) })()
      // the expectation is attached BEFORE the timers run, so the rejection is never "unhandled" for a moment
      const failed = expect(run).rejects.toMatchObject({ status: 504, stage: 'tts' })
      await vi.advanceTimersByTimeAsync(TTS_STALL_MS + 10)
      await failed
      expect(got).toEqual([[1, 2]])
    } finally {
      vi.useRealTimers()
    }
  })
  it('the caller’s signal stops the voice: the stream simply ends', async () => {
    const stop = new AbortController()
    let pulls = 0
    const body = new ReadableStream({
      pull(c) {
        pulls += 1
        if (pulls === 1) { c.enqueue(new Uint8Array([1, 2])); return }
        return new Promise<void>(() => {}) // the server is still making the rest
      },
    })
    const f = fake(new Response(body, { headers: { 'content-type': 'audio/L16', 'x-sample-rate': '24000' } }))
    const v = await synthesizeStream(CFG, 'x', 'Harper', NATURAL_VOICE, stop.signal, f.impl)
    const got: number[][] = []
    for await (const c of v.chunks) { got.push([...c]); stop.abort() }
    expect(got).toEqual([[1, 2]])
  })
})
