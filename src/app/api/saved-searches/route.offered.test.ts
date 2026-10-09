import { beforeEach, describe, expect, it, vi } from 'vitest'

// ⛔ No saved search on teachers, held on the SERVER (2026-10-09): the browser stopped offering one, and a stale tab or
// a direct request must not save an alert the cron never sends (it leaves teachers out).
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ creates: [] as Row[], reads: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p1', accountType: 'individual' }), getCurrentProfileId: async () => 'p1', getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }), kv: { set: async () => 'OK', get: async () => null } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    savedSearch: {
      findFirst: async () => { h.reads++; return null },
      count: async () => { h.reads++; return 0 },
      create: async ({ data }: { data: Row }) => { h.creates.push(data); return { id: 's1', label: data.label ?? null } },
    },
  },
}))
const { POST } = await import('./route')
const post = (params: Row) => POST(new Request('https://eno.vn/api/saved-searches', { method: 'POST', body: JSON.stringify({ params }) }) as never, {} as never)

beforeEach(() => { h.creates = []; h.reads = 0 })

describe('POST /api/saved-searches — no alert this site never sends', () => {
  it('⛔ a teachers search is refused (422 not_offered) before anything is read or written', async () => {
    const res = await post({ category: 'teachers', attrs: { workIn: 'ha-noi' } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'not_offered' })
    expect(h.reads).toBe(0)
    expect(h.creates).toEqual([])
  })

  it('every other category saves as before', async () => {
    const res = await post({ category: 'rentals' })
    expect(res.status).toBe(201)
    expect(h.creates).toHaveLength(1)
  })
})
