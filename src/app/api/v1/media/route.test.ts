/**
 * appsec-05 / R37: POST /api/v1/media checks the BYTES before any sharp call, for both input shapes (multipart `file` and a
 * raw body). The documented contract was always JPEG, PNG or WebP; until now only the declared type was checked, and sharp
 * decodes SVG, GIF, TIFF and AVIF too.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharpLib from 'sharp'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ stored: [] as Buffer[] }))

vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['media:write']) }, rate: { limit: 600, remaining: 599, resetSec: 60, windowSec: 60 } }),
}))
vi.mock('@/lib/core/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/media')>()),
  // Decoding and storing are not under test: only whether the route lets the bytes reach them.
  storeListingImage: async (buf: Buffer) => {
    h.stored.push(buf)
    return `https://sb.test/storage/v1/object/public/listings/api/${h.stored.length}.webp`
  },
}))

const { POST } = await import('./route')

const photo = () => sharpLib({ create: { width: 48, height: 32, channels: 3, background: { r: 200, g: 120, b: 40 } } })
const fx = {} as Record<'jpeg' | 'webp' | 'svg' | 'gif' | 'tiff' | 'avif', Buffer>
beforeAll(async () => {
  fx.jpeg = await photo().jpeg().toBuffer()
  fx.webp = await photo().webp().toBuffer()
  fx.svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="red"/></svg>')
  fx.gif = await photo().gif().toBuffer()
  fx.tiff = await photo().tiff().toBuffer()
  fx.avif = await photo().avif().toBuffer()
})

const URL_ = 'https://eno.vn/api/v1/media'
const auth = { authorization: 'Bearer test' }
function multipart(bytes: Buffer, type: string) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], 'photo', { type }))
  return POST(new NextRequest(URL_, { method: 'POST', headers: auth, body: form }))
}
const raw = (bytes: Buffer, type: string) => POST(new NextRequest(URL_, { method: 'POST', headers: { ...auth, 'content-type': type }, body: new Uint8Array(bytes) }))

beforeEach(() => { h.stored.length = 0 })

describe('POST /api/v1/media — the bytes, not the label', () => {
  it.each(['svg', 'gif', 'tiff', 'avif'] as const)('refuses %s bytes declared image/png, multipart and raw, before sharp sees them', async (kind) => {
    for (const res of [await multipart(fx[kind], 'image/png'), await raw(fx[kind], 'image/png')]) {
      expect(res.status).toBe(422)
      expect((await res.json()).error.code).toBe('invalid_image')
    }
    expect(h.stored).toHaveLength(0)
  })

  it('takes a real JPEG declared image/png, and a raw WebP body', async () => {
    const a = await multipart(fx.jpeg, 'image/png')
    const b = await raw(fx.webp, 'image/webp')
    expect([a.status, b.status]).toEqual([200, 200])
    expect((await a.json()).url).toMatch(/^https:\/\/sb\.test\//)
    expect(h.stored).toHaveLength(2)
  })
})
