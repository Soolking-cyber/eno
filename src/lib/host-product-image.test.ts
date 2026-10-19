import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { cleanImagePath, makeImageHost } from './host-product-image'
import { measureImage } from './import-photo-check'
import { hashFromUrl } from './image-hash-url'
import { isOverlayImageUrl } from './image-mark-url'

/**
 * `mark: 'none'` — a PARTNER's photo stored clean and unmarked at a key its source decides (GoPlus, 2026-10-19). The
 * other two modes are pinned by import-photo-check.test.ts (hash parity) and the importers' own tests.
 */
const photo = async (w = 900, h = 600) => {
  const raw = Buffer.alloc(w * h * 3)
  let x = 7
  for (let i = 0; i < raw.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[i] = (x >> 16) & 0xff }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
}
type Call = { path: string; body: Buffer }
const storageWith = (answer: (c: Call) => { error: unknown }) => {
  const calls: Call[] = []
  return { calls, storage: { upload: async (path: string, body: Buffer) => { const c = { path, body }; calls.push(c); return answer(c) } } }
}

describe("makeImageHost — mark: 'none'", () => {
  it('stores at <prefix>/<slug>-h<dHash>.webp, outside affiliate/m/ (no overlay), with the dHash the measure predicts', async () => {
    const { calls, storage } = storageWith(() => ({ error: null }))
    const host = makeImageHost({ storage, storageUrl: 'https://sb.test', bucket: 'listings', edge: 1600, quality: 82, mark: 'none', prefix: 'partner/goplus' })
    const buf = await photo()
    const url = await host.fromBuffer(buf, '0123456789abcdef')
    const hash = (await measureImage(buf))!.hash!
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe(cleanImagePath('partner/goplus', '0123456789abcdef', hash))
    expect(calls[0].path).toBe(`partner/goplus/0123456789abcdef-h${hash}.webp`)
    expect(url).toBe(`https://sb.test/storage/v1/object/public/listings/${calls[0].path}`)
    expect(hashFromUrl(url!)).toBe(hash)
    expect(isOverlayImageUrl(url)).toBe(false)
  }, 30_000)

  it('⛔ burns NO mark: the stored corner is the photo\'s own, where the burned mode changes it', async () => {
    const buf = await photo()
    const stored: Record<string, Buffer> = {}
    for (const mark of ['none', 'burned'] as const) {
      const { calls, storage } = storageWith(() => ({ error: null }))
      await makeImageHost({ storage, storageUrl: 'https://sb.test', bucket: 'listings', edge: 1600, quality: 95, mark, prefix: 'p' }).fromBuffer(buf, 'k')
      stored[mark] = calls[0].body
    }
    const corner = async (b: Buffer) => (await sharp(b).extract({ left: 700, top: 500, width: 200, height: 100 }).greyscale().raw().toBuffer())
    const [src, none, burned] = await Promise.all([corner(buf), corner(stored.none), corner(stored.burned)])
    const diff = (a: Buffer, b: Buffer) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length
    expect(diff(src, none)).toBeLessThan(diff(src, burned))
    expect(diff(src, burned) - diff(src, none)).toBeGreaterThan(1)
  }, 30_000)

  it('an upload refused as "already exists" IS that photo — the URL is returned; any other error is a failure', async () => {
    const buf = await photo(640, 480)
    const dup = storageWith(() => ({ error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } }))
    const url = await makeImageHost({ storage: dup.storage, storageUrl: 'https://sb.test', bucket: 'listings', mark: 'none', prefix: 'partner/goplus' }).fromBuffer(buf, 'aaaaaaaaaaaaaaaa')
    expect(url).toMatch(/^https:\/\/sb\.test\/storage\/v1\/object\/public\/listings\/partner\/goplus\/aaaaaaaaaaaaaaaa-h[0-9a-f]{16}\.webp$/)
    const broken = storageWith(() => ({ error: { statusCode: '500', message: 'internal' } }))
    expect(await makeImageHost({ storage: broken.storage, storageUrl: 'https://sb.test', bucket: 'listings', mark: 'none', prefix: 'partner/goplus' }).fromBuffer(buf, 'aaaaaaaaaaaaaaaa')).toBeNull()
    // A 5xx that MENTIONS "duplicate" is still a server failure, not proof the object exists (a reviewer's catch).
    const dup500 = storageWith(() => ({ error: { statusCode: '500', message: 'duplicate key value violates unique constraint' } }))
    expect(await makeImageHost({ storage: dup500.storage, storageUrl: 'https://sb.test', bucket: 'listings', mark: 'none', prefix: 'partner/goplus' }).fromBuffer(buf, 'aaaaaaaaaaaaaaaa')).toBeNull()
  }, 30_000)

  it('cleanImagePath keeps the key in the first-party alphabet', () => {
    expect(cleanImagePath('partner/goplus', 'ab/cd ef', null)).toBe('partner/goplus/ab-cd-ef.webp')
    expect(cleanImagePath('/partner//goplus/', 'x', 'ABCDEF0123456789')).toBe('partner/goplus/x-habcdef0123456789.webp')
    expect(cleanImagePath('p', '', 'nothex')).toBe('p/img.webp')
  })
})
