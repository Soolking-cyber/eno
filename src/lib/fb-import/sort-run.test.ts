import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  items: { findMany: vi.fn(), updateMany: vi.fn() },
  execute: vi.fn(async () => 0),
  luna: vi.fn(),
  charge: vi.fn(async () => true),
  key: 'sk-test' as string | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { facebookImportItem: h.items, $executeRaw: h.execute } }))
vi.mock('@/lib/ai-guard', () => ({ chargeAiGlobal: h.charge }))
vi.mock('@/lib/gemini', () => ({ getGeminiVertex: () => null, GEMINI_MODEL: 'gemini-3.8-flash' }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: vi.fn() }))
vi.mock('@/lib/log', () => ({ logError: vi.fn(), logWarn: vi.fn() }))
vi.mock('@/lib/classroom/llm-openai', () => ({ openAiConfig: () => (h.key ? { key: h.key, url: 'https://api.openai.com' } : null) }))
vi.mock('./luna', () => ({ askLuna: h.luna }))

const { sortPendingItems } = await import('./sort')
const raw = { title: 'A good chair', description: 'Solid', priceAmount: '65', currency: 'VND', location: 'Quận 12, Hồ Chí Minh', photos: [] }
const item = (over: object = {}) => ({ id: 'i1', raw, district: 'Quận 12', createdAt: new Date(), ...over })
const answer = { category: 'furniture-appliances', subcategory: '', listingType: 'sell', condition: 'used', priceUnit: 'million', area: '', brand: '', model: '', title: 'A good chair', description: 'A solid chair.', title_vi: 'Ghế tốt', description_vi: 'Một chiếc ghế chắc chắn.' }

beforeEach(() => {
  vi.clearAllMocks()
  h.key = 'sk-test'
  h.charge.mockResolvedValue(true)
  h.items.updateMany.mockResolvedValue({ count: 1 })
  h.luna.mockResolvedValue(JSON.stringify(answer))
})

describe('sortPendingItems', () => {
  it('scales the seller’s own number by the unit the model picked', async () => {
    h.items.findMany.mockResolvedValue([item()])
    await sortPendingItems()
    expect(h.items.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'draft', price: 65_000_000 })
    // Both proper versions (owner, 2026-11-06): English in title, Vietnamese beside it.
    expect(h.items.updateMany.mock.calls[0][0].data).toMatchObject({ title: 'A good chair', titleVi: 'Ghế tốt', descriptionVi: 'Một chiếc ghế chắc chắn.' })
  })
  it('⛔ writes only while the row is still raw: a second sorter can’t overwrite an edit or a publish', async () => {
    h.items.findMany.mockResolvedValue([item()])
    await sortPendingItems()
    expect(h.items.updateMany.mock.calls[0][0].where).toEqual({ id: 'i1', status: 'raw' })
  })
  it('takes the area from the text when Facebook’s line had none', async () => {
    h.luna.mockResolvedValue(JSON.stringify({ ...answer, area: 'Thảo Điền' }))
    h.items.findMany.mockResolvedValue([item({ district: null })])
    await sortPendingItems()
    expect(h.items.updateMany.mock.calls[0][0].data).toMatchObject({ district: 'Thảo Điền' })
  })
  it('no AI at all: fresh items wait, old ones become drafts, and the job can end', async () => {
    h.key = null
    h.items.findMany.mockResolvedValue([item({ id: 'old', createdAt: new Date(Date.now() - 7 * 3600_000) }), item({ id: 'new' })])
    expect(await sortPendingItems()).toEqual({ sorted: 0, stoppedBy: 'no_ai' })
    expect(h.items.updateMany).toHaveBeenCalledTimes(1)
    expect(h.items.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'old', status: 'raw' }, data: { status: 'draft', reason: 'no_category' } })
    expect(h.execute).toHaveBeenCalled()
    expect(h.luna).not.toHaveBeenCalled()
  })
  it('a budget that keeps refusing can’t hold an old item on “Sorting…”', async () => {
    h.charge.mockResolvedValue(false)
    h.items.findMany.mockResolvedValue([item({ id: 'old', createdAt: new Date(Date.now() - 7 * 3600_000) })])
    await sortPendingItems()
    expect(h.items.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'draft' })
  })
  it('a failed call leaves the item raw for the next run', async () => {
    h.luna.mockRejectedValue(new Error('luna_500'))
    h.items.findMany.mockResolvedValue([item()])
    expect(await sortPendingItems()).toEqual({ sorted: 0, stoppedBy: null })
    expect(h.items.updateMany).not.toHaveBeenCalled()
  })
})
