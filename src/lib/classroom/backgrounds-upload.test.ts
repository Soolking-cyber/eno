import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))

const { bothAgree, prepareBackground, roomOf, roomVerdict, FULL, THUMB, MAX_IMAGE_BYTES } = await import('./backgrounds-upload')
const { getSharp } = await import('@/lib/sharp-lazy')

// Owner, 2026-11-09: "changable backgrounds where they can upload or use from existing backgrounds". Children see these.
describe('the check decides in code, from the model\'s facts — and anything unclear refuses', () => {
  const facts = (o: Record<string, unknown> = {}) => ({ anyPerson: false, unsafe: false, personalDetails: false, scene: 'room', ...o })
  it('a room with nobody in it, nothing unsafe and no personal details is kept', () => {
    expect(roomVerdict(facts())).toEqual({ ok: true })
  })
  it('a person anywhere, anything unsuitable, or readable personal details is refused, with why', () => {
    expect(roomVerdict(facts({ anyPerson: true }))).toEqual({ ok: false, reason: 'person' })
    expect(roomVerdict(facts({ unsafe: true }))).toEqual({ ok: false, reason: 'unsafe' })
    expect(roomVerdict(facts({ personalDetails: true }))).toEqual({ ok: false, reason: 'personal_details' })
    expect(roomVerdict(facts({ unsafe: true, anyPerson: true }))).toEqual({ ok: false, reason: 'unsafe' })
  })
  it('⛔ an answer not in the shape asked for is no verdict (the route then refuses: FAIL CLOSED)', () => {
    for (const bad of [null, 'ok', [], {}, facts({ anyPerson: 'no' }), facts({ unsafe: undefined }), { anyPerson: false }]) expect(roomVerdict(bad)).toBeNull()
  })
})

describe('⛔ both models decide (the faster one never decides alone)', () => {
  it('kept only when both say ok; either refusing refuses, the stricter reason first', () => {
    expect(bothAgree([{ ok: true }, { ok: true }])).toEqual({ ok: true })
    expect(bothAgree([{ ok: true }, { ok: false, reason: 'person' }])).toEqual({ ok: false, reason: 'person' })
    expect(bothAgree([{ ok: false, reason: 'personal_details' }, { ok: false, reason: 'unsafe' }])).toEqual({ ok: false, reason: 'unsafe' })
  })
})

describe('the picture kept is the crop students see, with no metadata', () => {
  it('⛔ a very detailed picture still fits the database\'s 1 MB bound (encoded again, lower)', async () => {
    const sharp = await getSharp()
    const noise = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 90 } } }).png().toBuffer()
    const { image } = await prepareBackground(noise)
    expect(image.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
  }, 30_000) // five encodes of a 1080×1920 picture: ~3.5 s alone, far more under a loaded full run
  it('⛔ a phone photo with EXIF and GPS comes out 9:16, as WebP, carrying neither', async () => {
    const sharp = await getSharp()
    const photo = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#7a9' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'PhoneCo', Model: 'X1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 46/1 0/1' } })
      .toBuffer()
    expect((await sharp(photo).metadata()).exif).toBeTruthy()
    const { image, thumb, check } = await prepareBackground(photo)
    const [mi, mt, mc] = await Promise.all([sharp(image).metadata(), sharp(thumb).metadata(), sharp(check).metadata()])
    expect([mi.format, mi.width, mi.height]).toEqual(['webp', FULL.width, FULL.height])
    expect([mt.format, mt.width, mt.height]).toEqual(['webp', THUMB.width, THUMB.height])
    expect(mc.format).toBe('jpeg')
    for (const m of [mi, mt, mc]) { expect(m.exif).toBeUndefined(); expect(m.xmp).toBeUndefined() }
    // Within the DDL's bounds (1 MB, 200 KB).
    expect(image.length).toBeLessThan(1_048_576)
    expect(thumb.length).toBeLessThan(204_800)
  })
  it('bytes that are not an image are refused (the route says "not a photo")', async () => {
    await expect(prepareBackground(Buffer.from('not an image at all'))).rejects.toThrow()
  })
})

describe('the room a tutor shows', () => {
  const traits = { background: 'library' }
  it('its uploaded room while that is still ok', () => {
    expect(roomOf({ traits, backgroundId: 'b1' }, new Set(['b1']))).toMatchObject({ backgroundUrl: '/api/classroom/backgrounds/b1/image', backgroundThumbUrl: '/api/classroom/backgrounds/b1/image?size=thumb' })
  })
  it('⛔ a removed (or deleted) upload falls back to the library room at once', () => {
    expect(roomOf({ traits, backgroundId: 'b1' }, new Set())).toEqual({ background: 'library', backgroundUrl: '/classroom/backgrounds/library.webp', backgroundThumbUrl: '/classroom/backgrounds/library-thumb.webp' })
    expect(roomOf({ traits: { background: 'plain' }, backgroundId: null }, new Set())).toMatchObject({ backgroundUrl: null })
  })
})
