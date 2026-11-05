import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ add: vi.fn(), end: vi.fn(), sort: vi.fn(async () => ({})), mail: vi.fn(async () => true), afters: [] as (() => unknown)[] }))
vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (f: () => unknown) => h.afters.push(f) }))
vi.mock('@/lib/api/handler', () => ({ route: (_o: unknown, fn: (c: { req: Request }) => Promise<Response>) => (req: Request) => fn({ req }) }))
vi.mock('@/lib/fb-import/jobs', () => ({ addReportedItems: h.add, endImportJob: h.end }))
vi.mock('@/lib/fb-import/sort', () => ({ sortPendingItems: h.sort }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/mail', () => ({ sendMail: h.mail }))

const { POST } = await import('./route')
const call = (body: unknown, token: string | null = 'SECRET') => (POST as unknown as (r: Request) => Promise<Response>)(new Request('https://eno.vn/x', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }))

beforeEach(() => { vi.clearAllMocks(); h.afters.length = 0; vi.stubEnv('FB_IMPORT_WORKER_TOKEN', 'SECRET'); h.add.mockResolvedValue(true); h.end.mockResolvedValue(true) })

describe('the worker’s report', () => {
  it.each([['no token', null], ['a wrong token', 'NOPE']])('%s: the route doesn’t exist', async (_n, t) => {
    expect((await call({ kind: 'finished', jobId: 'j', leaseId: 'l' }, t)).status).toBe(404)
    expect(h.end).not.toHaveBeenCalled()
  })
  it('with no token configured nothing gets in, even an empty bearer', async () => {
    vi.stubEnv('FB_IMPORT_WORKER_TOKEN', '')
    expect((await call({ kind: 'finished', jobId: 'j', leaseId: 'l' }, '')).status).toBe(404)
  })
  it('refuses a malformed body', async () => { expect((await call({ kind: 'items', jobId: 'j', leaseId: 'l', items: [{ fbItemId: 'x' }] })).status).toBe(400) })
  it('409 tells a worker that lost its lease to drop the job', async () => {
    h.end.mockResolvedValue(false)
    expect((await call({ kind: 'finished', jobId: 'j', leaseId: 'old' })).status).toBe(409)
    expect(h.afters).toHaveLength(0)
  })
  it('finished starts sorting', async () => {
    expect((await call({ kind: 'finished', jobId: 'j', leaseId: 'l' })).status).toBe(200)
    for (const f of h.afters) await f()
    expect(h.sort).toHaveBeenCalled()
  })
  it('a wall alerts a person, and says nothing about the seller', async () => {
    expect((await call({ kind: 'unavailable', jobId: 'j', leaseId: 'l' })).status).toBe(200)
    for (const f of h.afters) await f()
    expect(h.mail).toHaveBeenCalledWith(expect.objectContaining({ to: 'support@eno.vn' }))
    expect(JSON.stringify(h.mail.mock.calls[0])).not.toContain('"j"')
  })
})
