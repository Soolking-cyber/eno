import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { photoVerdict, photoForCheck, checkTeacherPhoto, PHOTO_MODEL } = await import('./photo-check')
const { GEMINI_MODEL } = await import('@/lib/gemini')

/**
 * THE DECISION IS OURS, NOT THE MODEL'S (owner, 2026-10-16): the model describes the picture in facts; this code decides.
 * Lenient on purpose — only a non-photo, a picture with no face, or young children only fails.
 */
describe('photoVerdict', () => {
  const facts = (o: Record<string, unknown> = {}) => ({ photograph: true, faceVisible: true, onlyYoungChildren: false, subject: 'one_person', ...o })
  it('a real photo with a face passes — one person or a group (a teacher with their class)', () => {
    expect(photoVerdict(facts())).toEqual({ ok: true })
    expect(photoVerdict(facts({ subject: 'group' }))).toEqual({ ok: true })
  })
  it('a drawing, a game character, a logo or a text graphic is not a photo', () => {
    expect(photoVerdict(facts({ photograph: false, subject: 'artwork' }))).toEqual({ ok: false, reason: 'not_photo' })
    // Not a photo wins even where a "face" was seen (a cartoon has one).
    expect(photoVerdict(facts({ photograph: false, faceVisible: true }))).toEqual({ ok: false, reason: 'not_photo' })
  })
  it('a tree, an animal or an object — or a face hidden — shows no face; children alone do not show the teacher', () => {
    expect(photoVerdict(facts({ faceVisible: false, subject: 'no_person' }))).toEqual({ ok: false, reason: 'no_face' })
    expect(photoVerdict(facts({ onlyYoungChildren: true, subject: 'group' }))).toEqual({ ok: false, reason: 'no_face' })
  })
  it('⛔ an answer that is not the shape asked for is "could not check" (null) — never a refusal', () => {
    expect(photoVerdict(null)).toBeNull()
    expect(photoVerdict([])).toBeNull()
    expect(photoVerdict({ photograph: 'yes', faceVisible: true, onlyYoungChildren: false })).toBeNull()
    expect(photoVerdict({ photograph: true, faceVisible: true })).toBeNull()
  })
})

describe('photoForCheck', () => {
  it('re-encodes to a JPEG of at most 768 px, dropping the metadata', async () => {
    const sharp = (await import('sharp')).default
    const big = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#88aacc' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'someone' } } })
      .png().toBuffer()
    const out = await photoForCheck(big)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(768)
    expect(meta.exif).toBeUndefined()
  })
  it('throws on bytes that are not an image', async () => {
    await expect(photoForCheck(Buffer.from('not an image'))).rejects.toThrow()
  })
})

describe('checkTeacherPhoto — hedged', () => {
  const answer = (o: Record<string, unknown>) => ({ text: JSON.stringify({ photograph: true, faceVisible: true, onlyYoungChildren: false, subject: 'one_person', ...o }) })
  const fakeAi = (byModel: Record<string, () => Promise<unknown>>) => {
    const calls: string[] = []
    const ai = { models: { generateContent: vi.fn(async ({ model }: { model: string }) => { calls.push(model); return byModel[model]() }) } }
    return { ai: ai as never, calls }
  }
  it('the first model answers in time: one call, its verdict', async () => {
    const { ai, calls } = fakeAi({ [PHOTO_MODEL]: async () => answer({}), [GEMINI_MODEL]: async () => answer({}) })
    await expect(checkTeacherPhoto(ai, Buffer.from('x'))).resolves.toEqual({ verdict: { ok: true }, model: PHOTO_MODEL })
    expect(calls).toEqual([PHOTO_MODEL])
  })
  it('the first model fails: the second answers at once', async () => {
    const { ai, calls } = fakeAi({ [PHOTO_MODEL]: async () => { throw Object.assign(new Error('quota'), { status: 429 }) }, [GEMINI_MODEL]: async () => answer({ faceVisible: false }) })
    await expect(checkTeacherPhoto(ai, Buffer.from('x'))).resolves.toEqual({ verdict: { ok: false, reason: 'no_face' }, model: GEMINI_MODEL })
    expect(calls).toEqual([PHOTO_MODEL, GEMINI_MODEL])
  })
  it('an unreadable answer counts as a failure, never a verdict', async () => {
    const { ai } = fakeAi({ [PHOTO_MODEL]: async () => ({ text: '{"photograph":"maybe"}' }), [GEMINI_MODEL]: async () => ({ text: 'not json' }) })
    await expect(checkTeacherPhoto(ai, Buffer.from('x'))).rejects.toBeInstanceOf(AggregateError)
  })
  it('the first model slow past the hedge: the second starts beside it and the first answer wins', async () => {
    vi.useFakeTimers()
    try {
      let releaseSlow: (v: unknown) => void = () => {}
      const { ai, calls } = fakeAi({
        [PHOTO_MODEL]: () => new Promise((r) => { releaseSlow = r }),
        [GEMINI_MODEL]: async () => answer({ photograph: false }),
      })
      const p = checkTeacherPhoto(ai, Buffer.from('x'))
      await vi.advanceTimersByTimeAsync(4_000)
      await expect(p).resolves.toEqual({ verdict: { ok: false, reason: 'not_photo' }, model: GEMINI_MODEL })
      expect(calls).toEqual([PHOTO_MODEL, GEMINI_MODEL])
      releaseSlow(answer({}))
    } finally {
      vi.useRealTimers()
    }
  })
})
