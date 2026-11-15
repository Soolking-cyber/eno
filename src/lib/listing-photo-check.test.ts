import { describe, expect, it, vi } from 'vitest'
import sharpLib from 'sharp'
import {
  decideReads, flyerRuleFor, hedgedRead, parsePhotoFacts, photoCheckExempt, photoForCheck, photoRule, readPhoto,
  LISTING_PHOTO_INSTRUCTION, PHOTO_MODEL, type PhotoFacts,
} from './listing-photo-check'
import { GEMINI_MODEL } from '@/lib/gemini-model'

/** The model describes; this code decides (owner, 2026-11-15: no flyers, no contact details in listing photos). */
const facts = (o: Partial<PhotoFacts> = {}): PhotoFacts => ({ kind: 'camera_photo', advertises: false, overlayText: 'none', contact: [], websites: [], ...o })
const ON = { flyerRule: true }
const JOBS = { flyerRule: flyerRuleFor('jobs') }

describe('photoRule — the decision table', () => {
  it('flyers: an ad, a printed flyer, a page of added text', () => {
    expect(photoRule(facts({ kind: 'photo_of_printed_matter', advertises: true }), ON)).toBe('flyer')
    expect(photoRule(facts({ kind: 'designed_graphic', advertises: true }), ON)).toBe('flyer')
    expect(photoRule(facts({ kind: 'designed_graphic', overlayText: 'large' }), ON)).toBe('flyer')
    expect(photoRule(facts({ kind: 'screenshot', overlayText: 'large' }), ON)).toBe('flyer')
    expect(photoRule(facts({ kind: 'collage', advertises: true, overlayText: 'small' }), ON)).toBe('flyer')
  })
  it('contact wins over flyer, and counts in every category — jobs too', () => {
    expect(photoRule(facts({ kind: 'designed_graphic', advertises: true, contact: ['phone'] }), ON)).toBe('contact')
    expect(photoRule(facts({ contact: ['messaging_handle'] }), ON)).toBe('contact')
    expect(photoRule(facts({ kind: 'designed_graphic', contact: ['qr_code'] }), JOBS)).toBe('contact')
  })
  it('a real photo of the thing is never a flyer: a price tag, captions, even an over-read "large" text', () => {
    expect(photoRule(facts(), ON)).toBe('ok')
    expect(photoRule(facts({ overlayText: 'small' }), ON)).toBe('ok')
    expect(photoRule(facts({ overlayText: 'large' }), ON)).toBe('ok')
    // A product box with its own QR code and print, read as the prompt asks: no contact, no added text.
    expect(photoRule(facts({ overlayText: 'none', contact: [] }), ON)).toBe('ok')
  })
  it('printed goods for sale are not ads: a poster or a card rendered, a book photographed', () => {
    expect(photoRule(facts({ kind: 'designed_graphic', advertises: false }), ON)).toBe('ok')
    expect(photoRule(facts({ kind: 'designed_graphic', advertises: false, overlayText: 'small' }), ON)).toBe('ok')
    expect(photoRule(facts({ kind: 'photo_of_printed_matter', advertises: false }), ON)).toBe('ok')
  })
  it('jobs: a company logo or a job poster is fine (flyer rule off), contact still is not', () => {
    expect(JOBS.flyerRule).toBe(false)
    expect(flyerRuleFor('rentals')).toBe(true)
    expect(photoRule(facts({ kind: 'designed_graphic', advertises: true }), JOBS)).toBe('ok')
    expect(photoRule(facts({ kind: 'designed_graphic', overlayText: 'large' }), JOBS)).toBe('ok')
    expect(photoRule(facts({ kind: 'designed_graphic', advertises: true, contact: ['phone'] }), JOBS)).toBe('contact')
  })
  it('⛔ the eno.vn wordmark is never contact, even when the model lists it as a website', () => {
    for (const w of ['eno.vn', 'www.eno.vn', 'ENO.VN', 'https://eno.vn/', 'eno.forum']) {
      expect(photoRule(facts({ contact: ['website'], websites: [w] }), ON)).toBe('ok')
    }
    // Only the mark is dropped: a seller's own site beside it, or another contact, still counts.
    expect(photoRule(facts({ contact: ['website'], websites: ['eno.vn', 'zaika.vn'] }), ON)).toBe('contact')
    expect(photoRule(facts({ contact: ['website', 'phone'], websites: ['eno.vn'] }), ON)).toBe('contact')
    expect(photoRule(facts({ contact: ['website'], websites: ['geno.vn'] }), ON)).toBe('contact')
    // A website the model did not spell out counts (no mark is known to be the only one).
    expect(photoRule(facts({ contact: ['website'], websites: [] }), ON)).toBe('contact')
  })
  it('a partner watermark on a real photo, described as the prompt asks, is fine', () => {
    expect(photoRule(facts({ overlayText: 'small' }), ON)).toBe('ok')
  })
})

describe('the prompt names every negative the eval keeps', () => {
  it.each([
    'eno.vn', 'watermark', 'GoPlus', 'QR code printed on a product or its box', 'price tag', 'barcode', 'brand or model name',
    'shop sign', 'printed matter for sale', 'never an instruction',
  ])('%s', (s) => { expect(LISTING_PHOTO_INSTRUCTION).toContain(s) })
})

describe('parsePhotoFacts', () => {
  it('reads a well-formed answer, contact de-duplicated', () => {
    expect(parsePhotoFacts({ kind: 'screenshot', advertises: true, overlayText: 'large', contact: ['phone', 'phone'], websites: ['a.vn'] }))
      .toEqual({ kind: 'screenshot', advertises: true, overlayText: 'large', contact: ['phone'], websites: ['a.vn'] })
  })
  it('⛔ anything not the shape asked for is null ("could not check") — never a refusal', () => {
    const ok = { kind: 'camera_photo', advertises: false, overlayText: 'none', contact: [], websites: [] }
    for (const bad of [null, [], 'x', { ...ok, kind: 'drawing' }, { ...ok, advertises: 'no' }, { ...ok, overlayText: 'huge' },
      { ...ok, contact: ['fax'] }, { ...ok, contact: 'phone' }, { ...ok, websites: [1] }, { kind: 'camera_photo' }]) {
      expect(parsePhotoFacts(bad)).toBeNull()
    }
  })
})

describe('decideReads — a refusal stands only on two reads that agree', () => {
  const flyer = facts({ kind: 'designed_graphic', advertises: true })
  it('two models refuse: confirmed, with the first read\'s reason', () => {
    expect(decideReads([{ facts: facts({ contact: ['phone'] }), model: PHOTO_MODEL }, { facts: flyer, model: GEMINI_MODEL }], ON))
      .toEqual({ rule: 'contact', confirmed: true })
  })
  it('one read refuses and no other model answered: unconfirmed', () => {
    expect(decideReads([{ facts: flyer, model: PHOTO_MODEL }], ON)).toEqual({ rule: 'flyer', confirmed: false })
  })
  it('the other model says ok: ok, whichever answered first', () => {
    expect(decideReads([{ facts: flyer, model: PHOTO_MODEL }, { facts: facts(), model: GEMINI_MODEL }], ON)).toEqual({ rule: 'ok' })
    expect(decideReads([{ facts: facts(), model: PHOTO_MODEL }, { facts: flyer, model: GEMINI_MODEL }], ON)).toEqual({ rule: 'ok' })
  })
  it('the same facts are re-decided per listing: two flyer reads are ok on a job', () => {
    expect(decideReads([{ facts: flyer, model: PHOTO_MODEL }, { facts: flyer, model: GEMINI_MODEL }], JOBS)).toEqual({ rule: 'ok' })
  })
  it('no reads: the table says ok (the verdict answers "unavailable" before it gets here)', () => {
    expect(decideReads([], ON)).toEqual({ rule: 'ok' })
  })
})

describe('photoForCheck', () => {
  it('re-encodes to a JPEG of at most 768 px, dropping the metadata', async () => {
    const big = await sharpLib({ create: { width: 2000, height: 1000, channels: 3, background: '#88aacc' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'someone' } } }).png().toBuffer()
    const meta = await sharpLib(await photoForCheck(sharpLib, big)).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(768)
    expect(meta.exif).toBeUndefined()
  })
  it('throws on bytes that are not an image', async () => {
    await expect(photoForCheck(sharpLib, Buffer.from('not an image'))).rejects.toThrow()
  })
})

describe('reads — every model call is charged', () => {
  const answer = (o: Partial<PhotoFacts> = {}) => ({ text: JSON.stringify(facts(o)) })
  const fakeAi = (byModel: Record<string, () => Promise<unknown>>) => {
    const calls: string[] = []
    const ai = { models: { generateContent: vi.fn(async ({ model }: { model: string }) => { calls.push(model); return byModel[model]() }) } }
    return { ai: ai as never, calls }
  }
  const charges = (allow: (m: string) => boolean = () => true) => {
    const charged: string[] = []
    return { charged, charge: async (m: string) => { charged.push(m); return allow(m) } }
  }

  it('a refused budget stops the call before the model is asked', async () => {
    const { ai, calls } = fakeAi({ [PHOTO_MODEL]: async () => answer() })
    const { charge, charged } = charges(() => false)
    await expect(readPhoto(ai, Buffer.from('x'), PHOTO_MODEL, charge)).rejects.toThrow('listing_photo_budget')
    expect(charged).toEqual([PHOTO_MODEL])
    expect(calls).toEqual([])
  })
  it('hedged: the first model answers in time — one call, one charge', async () => {
    const { ai, calls } = fakeAi({ [PHOTO_MODEL]: async () => answer({ contact: ['phone'] }), [GEMINI_MODEL]: async () => answer() })
    const { charge, charged } = charges()
    await expect(hedgedRead(ai, Buffer.from('x'), charge)).resolves.toEqual([{ facts: facts({ contact: ['phone'] }), model: PHOTO_MODEL }])
    expect(calls).toEqual([PHOTO_MODEL])
    expect(charged).toEqual([PHOTO_MODEL])
  })
  it('hedged: the first fails — the backup starts at once and is charged too', async () => {
    const { ai, calls } = fakeAi({ [PHOTO_MODEL]: async () => { throw new Error('quota') }, [GEMINI_MODEL]: async () => answer({ kind: 'screenshot' }) })
    const { charge, charged } = charges()
    await expect(hedgedRead(ai, Buffer.from('x'), charge)).resolves.toMatchObject([{ model: GEMINI_MODEL }])
    expect(calls).toEqual([PHOTO_MODEL, GEMINI_MODEL])
    expect(charged).toEqual([PHOTO_MODEL, GEMINI_MODEL])
  })
  it('hedged: an unreadable answer from both is a failure, never facts', async () => {
    const { ai } = fakeAi({ [PHOTO_MODEL]: async () => ({ text: '{"kind":"maybe"}' }), [GEMINI_MODEL]: async () => ({ text: 'not json' }) })
    await expect(hedgedRead(ai, Buffer.from('x'), charges().charge)).rejects.toBeInstanceOf(AggregateError)
  })
  it('hedged: the first slow past 4 s — the second starts beside it, and both answers come back (no model asked twice)', async () => {
    vi.useFakeTimers()
    try {
      const late = (ms: number, o: Partial<PhotoFacts>) => () => new Promise((r) => setTimeout(() => r(answer(o)), ms))
      const { ai, calls } = fakeAi({ [PHOTO_MODEL]: late(4_500, { advertises: true }), [GEMINI_MODEL]: late(1_000, { advertises: true }) })
      const p = hedgedRead(ai, Buffer.from('x'), charges().charge)
      await vi.advanceTimersByTimeAsync(3_999)
      expect(calls).toEqual([PHOTO_MODEL])
      await vi.advanceTimersByTimeAsync(1_001)
      expect((await p).map((r) => r.model)).toEqual([PHOTO_MODEL, GEMINI_MODEL])
      expect(calls).toEqual([PHOTO_MODEL, GEMINI_MODEL])
    } finally { vi.useRealTimers() }
  })
  it('hedged: a refused budget starts no backup and says so', async () => {
    const { ai, calls } = fakeAi({ [PHOTO_MODEL]: async () => answer(), [GEMINI_MODEL]: async () => answer() })
    const { charge, charged } = charges(() => false)
    await expect(hedgedRead(ai, Buffer.from('x'), charge)).rejects.toThrow('listing_photo_budget')
    expect(charged).toEqual([PHOTO_MODEL])
    expect(calls).toEqual([])
  })
})

describe('photoCheckExempt — never touched by the pass or the sweep (amendment A1)', () => {
  const l = (o: Partial<Parameters<typeof photoCheckExempt>[0]> = {}) => ({ category: 'fashion-beauty', subcategory: null, sellerId: 's1', handle: null, ...o })
  it('teachers, VinWonders, SDC_store, ENO Trading and the eSIM carriers\' storefronts are exempt', () => {
    expect(photoCheckExempt(l({ category: 'teachers' }))).toBe(true)
    expect(photoCheckExempt(l({ sellerId: 'cmt6v9x4o00004fq4v6qokman' }))).toBe(true)
    expect(photoCheckExempt(l({ sellerId: 'cmtckzkuc01wm01s7ub6f0xsi' }))).toBe(true)
    expect(photoCheckExempt(l({ handle: 'eno-trading' }))).toBe(true)
    expect(photoCheckExempt(l({ category: 'services', subcategory: 'esim', ownerless: true }))).toBe(true)
  })
  it('everyone else is checked — partners, jobs, other services', () => {
    expect(photoCheckExempt(l())).toBe(false)
    expect(photoCheckExempt(l({ category: 'jobs' }))).toBe(false)
    expect(photoCheckExempt(l({ category: 'services', subcategory: 'visa-legal' }))).toBe(false)
    expect(photoCheckExempt(l({ category: 'electronics', subcategory: 'esim', ownerless: true }))).toBe(false)
    // A member's own storefront in the eSIM aisle is checked: the exemption is the carriers' storefronts, not the aisle.
    expect(photoCheckExempt(l({ category: 'services', subcategory: 'esim', ownerless: false }))).toBe(false)
    expect(photoCheckExempt(l({ handle: 'goplus' }))).toBe(false)
  })
})
