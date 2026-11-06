import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  jobs: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  items: { count: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  queryRaw: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/generated/prisma/client', () => ({ Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }) } }))
vi.mock('@/lib/db', () => ({ db: { facebookImportJob: h.jobs, facebookImportItem: h.items, $queryRaw: h.queryRaw } }))

const { addReportedItems, claimImportJob, createImportJob, endImportJob, sweepImportJobs } = await import('./jobs')

const item = { fbItemId: '12345678', title: 'A', description: null, priceAmount: '5000.00', currency: 'VND', location: null, condition: null, photos: [] }
beforeEach(() => { vi.clearAllMocks(); h.jobs.updateMany.mockResolvedValue({ count: 1 }); h.items.updateMany.mockResolvedValue({ count: 0 }); h.jobs.deleteMany.mockResolvedValue({ count: 0 }) })

describe('createImportJob', () => {
  it('queues a first import', async () => {
    h.jobs.findMany.mockResolvedValue([]); h.jobs.create.mockResolvedValue({ id: 'j1' })
    expect(await createImportJob('p', 'An', ['sha'])).toEqual({ ok: true, id: 'j1' })
  })
  it('one at a time', async () => {
    h.jobs.findMany.mockResolvedValue([{ status: 'reading' }])
    expect(await createImportJob('p', 'An', ['sha'])).toEqual({ ok: false, reason: 'active' })
    expect(h.jobs.create).not.toHaveBeenCalled()
  })
  it('no daily cap for now (owner, 2026-11-06): finished and failed tries never stop the next one', async () => {
    h.jobs.findMany.mockResolvedValue([{ status: 'ready' }, { status: 'not_found' }, { status: 'failed' }, { status: 'unavailable' }])
    expect(await createImportJob('p', 'An', ['sha'])).toEqual({ ok: true, id: 'j1' })
  })
})

describe('the lease', () => {
  it('a claim fails jobs out of attempts and re-queues expired ones BEFORE taking one', async () => {
    h.queryRaw.mockResolvedValue([{ id: 'j1', fbName: 'An', pictureShas: ['sha'] }])
    const c = await claimImportJob(new Date('2026-11-04T10:00:00Z'))
    expect(c).toMatchObject({ jobId: 'j1', name: 'An', pictureShas: ['sha'], maxItems: 100 })
    expect(c!.leaseId).toMatch(/^[0-9a-f-]{36}$/)
    // Listings already read go on to sorting; a job with none has failed.
    expect(h.jobs.updateMany.mock.calls[0][0]).toMatchObject({ where: { items: { some: {} } }, data: { status: 'sorting' } })
    expect(h.jobs.updateMany.mock.calls[1][0].data.status).toBe('failed')
    expect(h.jobs.updateMany.mock.calls[2][0].data.status).toBe('queued')
  })
  it('no work: null', async () => { h.queryRaw.mockResolvedValue([]); expect(await claimImportJob()).toBeNull() })
  it('a lost lease writes nothing: a computer waking from sleep can’t report into a job it lost', async () => {
    h.jobs.updateMany.mockResolvedValue({ count: 0 })
    expect(await addReportedItems('j1', 'old', [item])).toBe(false)
    expect(h.items.createMany).not.toHaveBeenCalled()
    expect(await endImportJob('j1', 'old', 'finished')).toBe(false)
    expect(h.jobs.update).not.toHaveBeenCalled()
  })
  it.each(['error', 'unavailable'] as const)('stopped part way (%s): what was already read still gets sorted for the seller', async (end) => {
    h.jobs.updateMany.mockResolvedValue({ count: 1 })
    h.items.count.mockResolvedValue(3)
    await endImportJob('j1', 'l', end)
    expect(h.jobs.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'sorting' }) }))
    h.items.count.mockResolvedValue(0)
    await endImportJob('j1', 'l', end)
    expect(h.jobs.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: end === 'error' ? 'failed' : 'unavailable' }) }))
  })
  it('a held lease stores items, replay-safe, with the VND price', async () => {
    h.items.count.mockResolvedValue(0)
    expect(await addReportedItems('j1', 'l', [item])).toBe(true)
    const arg = h.items.createMany.mock.calls[0][0]
    expect(arg.skipDuplicates).toBe(true)
    expect(arg.data[0]).toMatchObject({ jobId: 'j1', fbItemId: '12345678', price: 5000, district: null, city: null })
  })
  it('stops at 100 items across batches', async () => {
    h.items.count.mockResolvedValue(100)
    expect(await addReportedItems('j1', 'l', [item])).toBe(true)
    expect(h.items.createMany).not.toHaveBeenCalled()
  })
  it.each([['finished', 'sorting'], ['not_found', 'not_found'], ['unavailable', 'unavailable'], ['error', 'failed']] as const)('%s → %s, and clears the lease', async (end, status) => {
    h.items.count.mockResolvedValue(0)
    expect(await endImportJob('j1', 'l', end)).toBe(true)
    expect(h.jobs.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { status, leaseId: null, leaseUntil: null } })
  })
})

describe('sweepImportJobs', () => {
  it('a worker gone for a day: the seller stops reading "Reading…", and a live lease is left alone', async () => {
    h.jobs.updateMany.mockResolvedValue({ count: 0 })
    h.jobs.deleteMany.mockResolvedValue({ count: 0 })
    h.items.updateMany.mockResolvedValue({ count: 0 })
    const now = new Date('2026-11-05T12:00:00Z')
    await sweepImportJobs(now)
    const lost = h.jobs.updateMany.mock.calls.map((c) => c[0]).find((c) => c.where.status === 'reading')
    expect(lost.data.status).toBe('unavailable')
    expect(lost.where.leaseUntil.lt).toEqual(new Date('2026-11-04T12:00:00Z'))
  })
  it('closes a queue nobody read after a day, deletes after 7, frees a stuck publish', async () => {
    const now = new Date('2026-11-10T00:00:00Z')
    await sweepImportJobs(now)
    expect(h.jobs.updateMany.mock.calls[0][0]).toMatchObject({ where: { status: 'queued', createdAt: { lt: new Date('2026-11-09T00:00:00Z') } }, data: { status: 'unavailable' } })
    expect(h.jobs.deleteMany.mock.calls[0][0].where.createdAt.lt).toEqual(new Date('2026-11-03T00:00:00Z'))
    expect(h.items.updateMany.mock.calls[0][0].data).toEqual({ status: 'draft', publishingSince: null })
  })
})
