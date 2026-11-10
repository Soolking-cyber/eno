/**
 * appsec-05 / R37: /api/upload (the guest post wizard's route) checks the BYTES before any sharp call. The declared type
 * is whatever the browser or curl said, and sharp decodes SVG, GIF, TIFF and AVIF too. A refused file answers like any other
 * refusal here: 200, a short `urls`, and reason 'type' (the client's "use a JPG, PNG or WebP" message).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharpLib from 'sharp'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ stored: [] as Buffer[] }))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => null })) // a guest: the case appsec-05 is about
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 29 }) }))
vi.mock('@/lib/image-owner', () => ({ recordImageOwner: async () => {} }))
vi.mock('@/lib/core/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/media')>()),
  // Decoding and storing are not under test: only whether the route lets the bytes reach them.
  storeListingImage: async (buf: Buffer) => {
    h.stored.push(buf)
    return `https://sb.test/storage/v1/object/public/listings/${h.stored.length}.webp`
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

const file = (bytes: Buffer, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type })
async function upload(...files: File[]) {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const res = await POST(new NextRequest('https://eno.vn/api/upload', { method: 'POST', body: form }))
  return { status: res.status, body: (await res.json()) as { urls: string[]; failed: number; reasons: string[] } }
}

beforeEach(() => {
  h.stored.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST /api/upload — the bytes, not the label', () => {
  it.each(['svg', 'gif', 'tiff', 'avif'] as const)('refuses %s bytes declared image/png, before sharp sees them', async (kind) => {
    const { status, body } = await upload(file(fx[kind], 'photo.png', 'image/png'))
    expect(status).toBe(200)
    expect(body).toEqual({ urls: [], failed: 1, reasons: ['type'] })
    expect(h.stored).toHaveLength(0)
  })

  it('takes a real JPEG the browser called image/png, and a WebP named .jpg (the wizard’s own output, and the web’s commonest mislabel)', async () => {
    const { body } = await upload(file(fx.jpeg, 'a.png', 'image/png'), file(fx.webp, 'b.jpg', 'image/jpeg'))
    expect(body.urls).toHaveLength(2)
    expect(body.failed).toBe(0)
    expect(h.stored.map((b) => b.equals(fx.jpeg) || b.equals(fx.webp))).toEqual([true, true])
  })

  it('in a mixed request stores the photo and refuses only the impostor', async () => {
    const { body } = await upload(file(fx.jpeg, 'a.jpg', 'image/jpeg'), file(fx.avif, 'b.jpg', 'image/jpeg'))
    expect(body).toEqual({ urls: [expect.any(String)], failed: 1, reasons: ['type'] })
    expect(h.stored).toHaveLength(1)
  })
})
