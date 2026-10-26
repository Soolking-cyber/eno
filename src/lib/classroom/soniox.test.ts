import { afterEach, describe, expect, it, vi } from 'vitest'
import { mintSttKey, sonioxConfig, sttSettingsFor, SonioxError } from './soniox'

vi.mock('server-only', () => ({}))
afterEach(() => vi.unstubAllEnvs())

const KEY = 'k'.repeat(40)
const CFG = { key: KEY, rest: 'https://api.soniox.com', ws: 'wss://stt-rt.soniox.com/transcribe-websocket', model: 'stt-rt-v5' }

describe('sonioxConfig', () => {
  it('needs a key; the US project by default; any unknown region turns live listening off (never a guess)', () => {
    expect(sonioxConfig()).toBeNull()
    vi.stubEnv('SONIOX_API_KEY', KEY)
    expect(sonioxConfig()).toEqual(CFG)
    vi.stubEnv('SONIOX_REGION', 'mars')
    expect(sonioxConfig()).toBeNull()
    vi.stubEnv('SONIOX_REGION', 'US')
    expect(sonioxConfig()).toMatchObject({ ws: CFG.ws })
    vi.stubEnv('SONIOX_API_KEY', 'short')
    expect(sonioxConfig()).toBeNull()
  })
})

describe('mintSttKey', () => {
  it('asks for ONE single-use websocket key, short-lived to open, the stream cut at the session’s end', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! })
      return new Response(JSON.stringify({ api_key: 'temp_abcdefghij', expires_at: '2026-10-26T12:00:00Z' }), { status: 201 })
    }) as unknown as typeof fetch
    expect(await mintSttKey(CFG, { expiresInSeconds: 60, maxSessionSeconds: 612.4 }, f)).toBe('temp_abcdefghij')
    expect(calls[0].url).toBe('https://api.soniox.com/v1/auth/temporary-api-key')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ usage_type: 'transcribe_websocket', expires_in_seconds: 60, single_use: true, max_session_duration_seconds: 612 })
    expect(calls[0].init.redirect).toBe('error')
  })
  it('clamps to Soniox’s limits; any refusal, unreadable answer or network failure is a SonioxError', async () => {
    const seen: unknown[] = []
    const ok = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => { seen.push(JSON.parse(String(init!.body))); return new Response(JSON.stringify({ api_key: 'temp_abcdefghij' }), { status: 201 }) }) as unknown as typeof fetch
    await mintSttKey(CFG, { expiresInSeconds: 99_999, maxSessionSeconds: 0 }, ok)
    expect(seen[0]).toMatchObject({ expires_in_seconds: 3600, max_session_duration_seconds: 1 })
    await expect(mintSttKey(CFG, { expiresInSeconds: 60, maxSessionSeconds: 60 }, vi.fn(async () => new Response('{}', { status: 402 })) as unknown as typeof fetch)).rejects.toMatchObject({ status: 402 })
    await expect(mintSttKey(CFG, { expiresInSeconds: 60, maxSessionSeconds: 60 }, vi.fn(async () => new Response('{"nope":1}', { status: 201 })) as unknown as typeof fetch)).rejects.toBeInstanceOf(SonioxError)
    await expect(mintSttKey(CFG, { expiresInSeconds: 60, maxSessionSeconds: 60 }, vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch)).rejects.toMatchObject({ status: 502 })
  })
})

describe('sttSettingsFor', () => {
  it('the young get the most patience; sensitivity never negative while the latency level is above 0 (Soniox’s rule)', () => {
    const bands = ['adult', 'teen', 'child', 'child-young'] as const
    const s = bands.map(sttSettingsFor)
    for (let i = 1; i < s.length; i++) expect(s[i].max_endpoint_delay_ms).toBeGreaterThanOrEqual(s[i - 1].max_endpoint_delay_ms)
    for (const x of s) {
      if (x.endpoint_latency_adjustment_level > 0) expect(x.endpoint_sensitivity).toBeGreaterThanOrEqual(0)
      expect(x.max_endpoint_delay_ms).toBeGreaterThanOrEqual(500)
      expect(x.max_endpoint_delay_ms).toBeLessThanOrEqual(3000)
    }
  })
})
