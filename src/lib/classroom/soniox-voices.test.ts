import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logWarn: vi.fn(), logError: vi.fn() }))
const { createVoice, deleteVoice, listOurVoices, voiceName, voiceOf, VOICE_PREFIX } = await import('./soniox-voices')

const CFG = { key: 'k'.repeat(30), rest: 'https://api.soniox.com', ws: 'wss://x', model: 'stt-rt-v5', tts: 'wss://t', ttsModel: 'tts-rt-v2' }
const voice = (o: Record<string, unknown> = {}) => ({ id: '21b9c8e2-1c3a-4d5e-9f8a-123456789abc', name: 'eno-cv-aaaaaaaa-row1', filename: 'voice.wav', created_at: '2026-11-09T10:00:00Z', models: [{ model: 'tts-rt-v2', status: 'ready', error_type: null }], ...o })

describe('our voices at Soniox are named by their row', () => {
  it('eno-cv-<row id> — a cuid, so a name points at one row of one database', () => {
    expect(voiceName('ckrow1')).toBe(`${VOICE_PREFIX}ckrow1`)
  })
})

describe('Soniox\'s answers', () => {
  it('a voice, its status for OUR TTS model (another model\'s status is not ours)', () => {
    expect(voiceOf(voice(), 'tts-rt-v2')).toMatchObject({ id: voice().id, status: 'ready' })
    expect(voiceOf(voice({ models: [{ model: 'tts-rt-v3', status: 'ready' }] }), 'tts-rt-v2')?.status).toBeNull()
    for (const bad of [null, {}, voice({ id: 5 }), voice({ created_at: 'x' })]) expect(voiceOf(bad, 'tts-rt-v2')).toBeNull()
  })
  it('create sends multipart name + the WAV, with the key, and never follows a redirect', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const form = init.body as FormData
      expect(form.get('name')).toBe('eno-cv-aaaaaaaa-row1')
      expect((form.get('file') as File).type).toBe('audio/wav')
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${CFG.key}`)
      expect(init.redirect).toBe('error')
      return Response.json(voice({ models: [{ model: 'tts-rt-v2', status: 'processing' }] }), { status: 201 })
    })
    expect((await createVoice(CFG, 'eno-cv-aaaaaaaa-row1', new Uint8Array(100), f as unknown as typeof fetch)).status).toBe('processing')
  })
  it('⛔ the organisation\'s 20 used: a 429 the caller turns into "slots full"', async () => {
    await expect(createVoice(CFG, 'n', new Uint8Array(1), (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch)).rejects.toMatchObject({ status: 429 })
  })
  it('the list follows every page and keeps only our prefix', async () => {
    const pages = [{ voices: [voice(), voice({ id: 'other', name: 'someone-elses' })], next_page_cursor: 'c2' }, { voices: [voice({ id: 'b', name: 'eno-cv-aaaaaaaa-row2' }), voice({ id: 'd', name: 'eno-cv-bbbbbbbb-row3' })], next_page_cursor: null }]
    const f = vi.fn(async (u: string) => Response.json(u.includes('cursor=c2') ? pages[1] : pages[0]))
    expect((await listOurVoices(CFG, 'eno-cv-aaaaaaaa-', f as unknown as typeof fetch)).map((v) => v.name)).toEqual(['eno-cv-aaaaaaaa-row1', 'eno-cv-aaaaaaaa-row2'])
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('delete: gone already (404) is gone; anything else throws, so the sweep tries again', async () => {
    await expect(deleteVoice(CFG, 'x', (async () => new Response(null, { status: 404 })) as unknown as typeof fetch)).resolves.toBe(true)
    await expect(deleteVoice(CFG, 'x', (async () => new Response(null, { status: 204 })) as unknown as typeof fetch)).resolves.toBe(true)
    await expect(deleteVoice(CFG, 'x', (async () => new Response(null, { status: 503 })) as unknown as typeof fetch)).rejects.toMatchObject({ status: 503 })
  })
})
