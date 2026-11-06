import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), translate: vi.fn(async (_t: string, _k: string, _to: string): Promise<string | null> => null) }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/handler', () => ({ route: (_o: unknown, fn: (c: { req: Request; userId: string; params: { id: string } }) => Promise<Response>) => (req: Request) => fn({ req, userId: 'u1', params: { id: 'i1' } }) }))
vi.mock('@/lib/db', () => ({ db: { facebookImportItem: { findFirst: h.findFirst, updateMany: h.updateMany } } }))
vi.mock('@/lib/fb-import/sort', async (orig) => ({ ...(await orig<typeof import('@/lib/fb-import/sort')>()), translateText: h.translate }))

const { PATCH } = await import('./route')
const DRAFT = { id: 'i1', status: 'draft', categorySlug: null, subcategorySlug: null, listingType: null, attributes: null, title: 'A good chair', description: 'Solid', titleVi: 'Ghế tốt', descriptionVi: 'Chắc chắn', city: null }
const patch = (body: unknown) => PATCH(new Request('https://eno.vn/api/fb-import/items/i1', { method: 'PATCH', body: JSON.stringify(body) }))
const data = () => h.updateMany.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  h.findFirst.mockResolvedValue(DRAFT)
  h.updateMany.mockResolvedValue({ count: 1 })
  h.translate.mockReset().mockResolvedValue(null)
})

// Owner, 2026-11-06: the seller reads and edits in their app's language; both versions must stay proper, so an edit clears the other for Publish to redo.
describe('draft edit: two languages', () => {
  it('an edit in Vietnamese is saved first, then the same field in English gets its translation', async () => {
    h.translate.mockResolvedValue('Nice wooden chair')
    expect((await patch({ title: 'Ghế gỗ đẹp', lang: 'vi' })).status).toBe(200)
    expect(data()).toMatchObject({ titleVi: 'Ghế gỗ đẹp', title: null })
    expect(data()).not.toHaveProperty('description')
    expect(h.translate).toHaveBeenCalledWith('Ghế gỗ đẹp', 'title', 'en')
    expect(h.updateMany.mock.calls[1][0]).toEqual({ where: { id: 'i1', status: { in: ['draft', 'skipped'] }, titleVi: 'Ghế gỗ đẹp' }, data: { title: 'Nice wooden chair' } })
  })
  it('⛔ the translation is written only over the words it came from: a newer edit saved meanwhile stays', async () => {
    h.translate.mockResolvedValue('Solid oak')
    await patch({ description: 'Gỗ sồi', lang: 'vi' })
    // The guard: the Vietnamese description must still be what was translated, or nothing is written.
    expect(h.updateMany.mock.calls[1][0].where).toMatchObject({ descriptionVi: 'Gỗ sồi' })
  })
  it('no AI: the edit is saved and the other language\'s field is left empty for Publish to fill; English when no language is said', async () => {
    await patch({ description: 'Solid oak' })
    expect(h.translate).toHaveBeenCalledWith('Solid oak', 'description', 'vi')
    expect(data()).toMatchObject({ description: 'Solid oak', descriptionVi: null })
    expect(data()).not.toHaveProperty('title')
    expect(h.updateMany).toHaveBeenCalledTimes(1)
  })
  it('the text check reads the language edited, not the other one', async () => {
    h.findFirst.mockResolvedValue({ ...DRAFT, categorySlug: 'furniture-appliances', listingType: 'sell' })
    await patch({ title: 'x', lang: 'vi' })
    expect(data().reason).toBe('title_short')
  })
  it('a language other than the two is refused', async () => {
    expect((await patch({ title: 'Stuhl', lang: 'de' })).status).toBe(400)
    expect(h.updateMany).not.toHaveBeenCalled()
  })
})
