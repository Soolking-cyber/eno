import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The home "Find a teacher" shelf's seed (owner, 2026-10-13). Pinned: it reads /c/teachers' own predicate and default
 * order with the opt-in pinned to the teachers category, the owner's demo profile never comes back, a card without its
 * photo is dropped (and the shelf still fills), a person's name is its own Vietnamese title, and only card fields go out.
 */
const h = vi.hoisted(() => ({
  teachersId: 'cat-teachers' as string | null,
  rows: [] as Record<string, unknown>[],
  findMany: vi.fn(),
  scoped: vi.fn(),
  localize: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: (a: unknown) => h.findMany(a) } } }))
vi.mock('@/lib/edition-scope', () => ({
  teachersCategoryId: async () => h.teachersId,
  scopedListingWhere: (w: unknown, opts: unknown) => h.scoped(w, opts),
}))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: (cards: unknown[], onlyLang?: string) => h.localize(cards, onlyLang) }))

const { homeTeacherShelf } = await import('./teacher-shelf')
const { LISTING_CARD_SELECT } = await import('@/lib/serialize')
const { HOME_HIDDEN_TEACHER_LISTING_IDS, HOME_TEACHER_SHELF_TAKE } = await import('@/lib/teachers/constants')

/** A teacher listing exactly as `select: LISTING_CARD_SELECT` returns it. */
const row = (id: string, over: Record<string, unknown> = {}) => ({
  sellerId: `s-${id}`, id, title: `Teacher ${id}`, titleVi: null, price: 35_000_000, priceUnit: 'VND/month', currency: 'VND',
  negotiable: false, previousPrice: null, priceDropAt: null, urgentUntil: null,
  location: 'Thủ Đức, Hồ Chí Minh', district: null, city: 'Hồ Chí Minh', lat: null, lng: null,
  images: JSON.stringify([`https://sb.eno.vn/storage/v1/object/public/listings/${id}.webp`]), video: null,
  buildingKey: null, subcategorySlug: 'teachers-fulltime', brandSlug: null, model: null, condition: null, marketPosition: null,
  verified: true, postedAt: new Date('2026-10-01T00:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z'), savedCount: 0, contactCount: 0,
  affiliateUrl: null, listingType: 'teacher', attributes: null,
  category: { id: 'cat-teachers', name: 'Teachers', nameVi: 'Giáo viên', slug: 'teachers', icon: 'graduation-cap', color: 'blue' },
  seller: { trustScore: 60, officialPartner: false, ownerId: `owner-${id}`, owner: { accountType: 'individual' } },
  ...over,
})

beforeEach(() => {
  h.teachersId = 'cat-teachers'
  h.rows = Array.from({ length: 3 }, (_, i) => row(`t${i}`))
  h.findMany.mockReset().mockImplementation(async () => h.rows)
  h.scoped.mockReset().mockImplementation(async (w: unknown) => ({ AND: [w, { sellerId: { notIn: ['desk'] } }] }))
  h.localize.mockReset().mockImplementation(async (cards: unknown[]) => cards)
})

describe('homeTeacherShelf', () => {
  it('scopes /c/teachers\' predicate with the opt-in PINNED to the teachers category — and the demo is excluded by id', async () => {
    await homeTeacherShelf()
    expect(h.scoped).toHaveBeenCalledTimes(1)
    const [where, opts] = h.scoped.mock.calls[0]
    expect(opts).toEqual({ teachers: true })
    expect(where).toEqual({ categoryId: 'cat-teachers', verified: true, status: 'active', id: { notIn: ['cmuzccru60000wvq4mojalida'] } })
    expect(HOME_HIDDEN_TEACHER_LISTING_IDS).toContain('cmuzccru60000wvq4mojalida')
    // The scoped where (desk exclusion and all) is what the read gets — not the bare predicate.
    expect(h.findMany.mock.calls[0][0].where).toEqual({ AND: [where, { sellerId: { notIn: ['desk'] } }] })
  })

  it('reads in /c/teachers\' default order with the card projection — never a second ranking rule', async () => {
    await homeTeacherShelf()
    const args = h.findMany.mock.calls[0][0]
    expect(args.orderBy).toEqual([{ rankScore: 'desc' }, { id: 'desc' }])
    expect(args.select).toBe(LISTING_CARD_SELECT)
    expect(args.take).toBe(HOME_TEACHER_SHELF_TAKE + 2)
  })

  it('no teachers category: nothing to show, and nothing is read', async () => {
    h.teachersId = null
    expect(await homeTeacherShelf()).toEqual([])
    expect(h.findMany).not.toHaveBeenCalled()
    expect(h.localize).not.toHaveBeenCalled()
  })

  it('holds at most HOME_TEACHER_SHELF_TAKE (8) cards, in the order read', async () => {
    expect(HOME_TEACHER_SHELF_TAKE).toBe(8)
    h.rows = Array.from({ length: 10 }, (_, i) => row(`t${i}`))
    const cards = await homeTeacherShelf()
    expect(cards.map((c) => c.id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
  })

  it('drops a card without its first photo — and the spare rows keep the shelf full', async () => {
    h.rows = [
      row('t0'), row('no-photo', { images: '[]' }), row('blank', { images: JSON.stringify(['']) }),
      ...Array.from({ length: 7 }, (_, i) => row(`t${i + 1}`)),
    ]
    const cards = await homeTeacherShelf()
    expect(cards.map((c) => c.id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect(cards.every((c) => typeof c.images[0] === 'string' && c.images[0] !== '')).toBe(true)
  })

  it('a person\'s name is its own Vietnamese title (never machine-translated on /vi); a stored titleVi is kept', async () => {
    h.rows = [row('t0', { title: 'Jane Doe' }), row('t1', { title: 'Nguyễn Văn An', titleVi: 'Nguyễn Văn An (VI)' })]
    const cards = await homeTeacherShelf()
    expect(cards[0]).toMatchObject({ title: 'Jane Doe', titleVi: 'Jane Doe' })
    expect(cards[1]).toMatchObject({ title: 'Nguyễn Văn An', titleVi: 'Nguyễn Văn An (VI)' })
  })

  it('only card fields leave the server: no description, no owner id', async () => {
    const cards = await homeTeacherShelf()
    expect(cards).toHaveLength(3)
    for (const c of cards) {
      expect(c).not.toHaveProperty('description')
      expect(JSON.stringify(c)).not.toContain('owner-')
    }
  })

  it('embeds the cached titles for every language (language-neutral ISR) — no single-language cut', async () => {
    h.localize.mockImplementation(async (cards: Array<{ id: string }>) => cards.map((c) => ({ ...c, titleI18n: { ko: `ko:${c.id}` } })))
    const cards = await homeTeacherShelf()
    expect(h.localize).toHaveBeenCalledWith(expect.any(Array), undefined)
    expect(cards[0].titleI18n).toEqual({ ko: 'ko:t0' })
  })
})
