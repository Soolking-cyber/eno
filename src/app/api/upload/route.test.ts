/**
 * appsec-05 / R37: /api/upload (the guest post wizard's route) checks the BYTES before any sharp call. The declared type
 * is whatever the browser or curl said, and sharp decodes SVG, GIF, TIFF and AVIF too. A refused file answers like any other
 * refusal here: 200, a short `urls`, and reason 'type' (the client's "use a JPG, PNG or WebP" message).
 * And the listing photo check (owner, 2026-11-15) — opt-in with `check=listing`: per-file `results`, a file two reads
 * refused is never stored, a guest gets the cache only, everything else is stored (fail-open).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharpLib from 'sharp'
import { NextRequest } from 'next/server'

type Verdict = { rule: 'ok' } | { rule: 'flyer' | 'contact'; confirmed: boolean } | 'unavailable' | 'budget'
const h = vi.hoisted(() => ({
  stored: [] as Buffer[],
  profileId: null as string | null,
  /** The verdict per prepared file, by its first byte's marker (see `marked`). */
  verdictFor: (_b: Buffer): Verdict | Promise<Verdict> => ({ rule: 'ok' }) as Verdict,
  verdictCalls: [] as Array<{ src: { sha?: string }; o: Record<string, unknown> }>,
  pointed: [] as Array<[string, string]>,
  charged: [] as string[],
  exemptAsked: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.profileId })) // a guest by default: the case appsec-05 is about
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 29 }) }))
vi.mock('@/lib/image-owner', () => ({ recordImageOwner: async () => {} }))
vi.mock('@/lib/ai-guard', () => ({ chargeAccountPhotoCheck: async (id: string) => { h.charged.push(id); return true } }))
vi.mock('@/lib/listing-photo-verdict', () => ({
  listingPhotoVerdict: async (src: { bytes: Buffer; sha?: string }, o: Record<string, unknown>) => {
    h.verdictCalls.push({ src: { sha: src.sha }, o })
    return h.verdictFor(src.bytes)
  },
  rememberPhotoKey: async (key: string, sha: string) => { h.pointed.push([key, sha]) },
}))
// The exemption itself is listing-photo-refusal.test.ts's: here SDC_store's id stands for any exempt storefront.
vi.mock('@/lib/listing-photo-refusal', () => ({
  photoCheckExemptFor: async (l: { sellerId: string }) => { h.exemptAsked.push(l); return l.sellerId === 'sdc' },
  // 'p1' owns 'sdc' here (the ownership read itself: listing-photo-refusal.test.ts).
  ownsStorefront: async (profileId: string | null, seller: string) => profileId === 'p1' && seller === 'sdc',
}))
vi.mock('@/lib/core/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/media')>()),
  // Decoding and storing are not under test: only whether the route lets the bytes reach them.
  storeListingImage: async (buf: Buffer) => {
    h.stored.push(buf)
    return `https://sb.test/storage/v1/object/public/listings/${h.stored.length}.webp`
  },
  prepareListingImage: async (buf: Buffer) => ({ out: buf, sha256: `sha-${buf.length}`, nameFacts: '' }),
  putListingImage: async (img: { out: Buffer }) => {
    h.stored.push(img.out)
    const key = `${h.stored.length}.webp`
    return { url: `https://sb.test/storage/v1/object/public/listings/${key}`, key }
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
type Body = { urls: string[]; failed: number; reasons: string[]; results?: Array<{ url: string } | { reason: string }> }
async function send(fields: Record<string, string>, ...files: File[]) {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const res = await POST(new NextRequest('https://eno.vn/api/upload', { method: 'POST', body: form }))
  return { status: res.status, body: (await res.json()) as Body }
}
const upload = (...files: File[]) => send({}, ...files)
const checked = (category: string, ...files: File[]) => send({ check: 'listing', category }, ...files)

beforeEach(() => {
  h.stored.length = 0
  h.profileId = null
  h.verdictFor = () => ({ rule: 'ok' })
  h.verdictCalls = []
  h.pointed = []
  h.charged = []
  h.exemptAsked = []
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

/** A JPEG whose length tells the verdict mock which file it is (prepare is mocked to pass the bytes through). */
const jpegOf = async (pad: number) => Buffer.concat([fx.jpeg, Buffer.alloc(pad)])

describe('POST /api/upload — the listing photo check (check=listing)', () => {
  it('without check=listing nothing changes: no check, no `results`', async () => {
    const { body } = await upload(file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    expect(body).toEqual({ urls: [expect.any(String)], failed: 0, reasons: [] })
    expect(h.verdictCalls).toEqual([])
  })

  it('answers per file in the order sent; a confirmed refusal is never stored', async () => {
    const [a, b] = [await jpegOf(1), await jpegOf(2)]
    h.verdictFor = (bytes) => (bytes.length === b.length ? { rule: 'flyer', confirmed: true } : { rule: 'ok' })
    const { status, body } = await checked('rentals', file(a, 'a.jpg', 'image/jpeg'), file(b, 'b.jpg', 'image/jpeg'), file(fx.avif, 'c.jpg', 'image/jpeg'))
    expect(status).toBe(200)
    expect(body.results).toEqual([{ url: expect.any(String) }, { reason: 'photo_flyer' }, { reason: 'type' }])
    expect(body).toMatchObject({ urls: [(body.results![0] as { url: string }).url], failed: 2, reasons: ['photo_flyer', 'type'] })
    expect(h.stored).toEqual([a])
  })

  it('contact is its own reason', async () => {
    h.verdictFor = () => ({ rule: 'contact', confirmed: true })
    const { body } = await checked('goods', file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    expect(body.results).toEqual([{ reason: 'photo_contact' }])
    expect(h.stored).toHaveLength(0)
  })

  it.each([
    ['a lone (unconfirmed) refusal', { rule: 'flyer', confirmed: false } as Verdict],
    ['a check that could not run (deadline, cap, no model)', 'unavailable' as Verdict],
    ['a spent lane', 'budget' as Verdict],
  ])('⛔ FAIL-OPEN: %s is stored, and its key pointed at the bytes’ facts', async (_why, v) => {
    h.verdictFor = () => v
    const { body } = await checked('rentals', file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    expect(body.results).toEqual([{ url: expect.any(String) }])
    expect(h.stored).toHaveLength(1)
    expect(h.pointed).toEqual([['1.webp', `sha-${fx.jpeg.length}`]])
  })

  it('asks for two reads in parallel inside 8 s, in the upload lane, with the category’s flyer rule (off for jobs)', async () => {
    await checked('rentals', file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    await checked('jobs', file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    expect(h.verdictCalls.map((c) => c.o)).toEqual([
      expect.objectContaining({ lane: 'upload', confirm: 'parallel', deadlineMs: 8000, flyerRule: true }),
      expect.objectContaining({ flyerRule: false }),
    ])
    expect(h.verdictCalls[0].src.sha).toBe(`sha-${fx.jpeg.length}`)
  })

  it('⛔ a guest gets the cache only — no paid read, no account cap', async () => {
    await checked('rentals', file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    expect(h.verdictCalls[0].o).toMatchObject({ cacheOnly: true })
    expect(h.verdictCalls[0].o.beforeRead).toBeUndefined()
  })

  it('a member’s own cap is asked before any paid read', async () => {
    h.profileId = 'p1'
    await checked('rentals', file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    const o = h.verdictCalls[0].o as { cacheOnly?: boolean; beforeRead?: () => Promise<boolean> }
    expect(o.cacheOnly).toBeUndefined()
    expect(await o.beforeRead!()).toBe(true)
    expect(h.charged).toEqual(['p1'])
  })

  it('the files of a request are checked in parallel', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    h.verdictFor = async () => { await gate; return { rule: 'ok' } }
    const pending = checked('rentals', file(await jpegOf(1), 'a.jpg', 'image/jpeg'), file(await jpegOf(2), 'b.jpg', 'image/jpeg'), file(await jpegOf(3), 'c.jpg', 'image/jpeg'))
    await vi.waitFor(() => expect(h.verdictCalls).toHaveLength(3))
    release()
    expect((await pending).body.urls).toHaveLength(3)
  })

  it('a guest’s fourth file is over the cap, at its own index', async () => {
    const { body } = await checked('rentals', ...[1, 2, 3, 4].map((n) => file(fx.jpeg, `${n}.jpg`, 'image/jpeg')))
    expect(body.results).toEqual([{ url: expect.any(String) }, { url: expect.any(String) }, { url: expect.any(String) }, { reason: 'over_cap' }])
    expect(body).toMatchObject({ failed: 1, reasons: ['over_cap:1'] })
  })

  it('⛔ A1: where the pass never checks (the storefront and aisle the wizard sends), nothing is checked or refused', async () => {
    h.verdictFor = () => ({ rule: 'flyer', confirmed: true })
    h.profileId = 'p1'
    const { body } = await send({ check: 'listing', category: 'services', subcategory: 'esim', seller: 'sdc' }, file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    expect(h.exemptAsked).toEqual([{ category: 'services', subcategory: 'esim', sellerId: 'sdc' }])
    expect(h.verdictCalls).toEqual([])
    expect(body).toMatchObject({ urls: [expect.any(String)], failed: 0 })
    // Any other storefront is checked as before.
    expect((await send({ check: 'listing', category: 'services', seller: 's1' }, file(fx.jpeg, 'a.jpg', 'image/jpeg'))).body.results).toEqual([{ reason: 'photo_flyer' }])
  })

  it('⛔ O5: a seller the caller does not own is ignored — a guest or another member naming SDC_store is checked', async () => {
    h.verdictFor = () => ({ rule: 'flyer', confirmed: true })
    for (const who of [null, 'p2']) {
      h.profileId = who; h.exemptAsked = []
      const { body } = await send({ check: 'listing', category: 'services', seller: 'sdc' }, file(fx.jpeg, 'a.jpg', 'image/jpeg'))
      expect(h.exemptAsked).toEqual([{ category: 'services', subcategory: null, sellerId: '' }])
      expect(body.results).toEqual([{ reason: 'photo_flyer' }])
    }
  })

  it('an avatar is never checked, whatever the form says', async () => {
    const { body } = await send({ check: 'listing', category: 'rentals', kind: 'avatar' }, file(fx.jpeg, 'a.jpg', 'image/jpeg'))
    expect(h.verdictCalls).toEqual([])
    expect(body.results).toBeUndefined()
  })
})
