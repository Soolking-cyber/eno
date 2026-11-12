import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Admin › Partner inbox's badge count (route.ts): admins only, a number only, never cached. */
const admin = { value: null as null | { id: string } }
vi.mock('@/lib/admin', () => ({ getAdmin: vi.fn(async () => admin.value) }))
vi.mock('@/lib/partner-inbox', () => ({ partnerInboxCounts: vi.fn(async () => ({ shops: [{ name: 'GoPlus', unreadChats: 2 }], unreadChats: 2, unreadMessages: 4 })) }))
const { partnerInboxCounts } = await import('@/lib/partner-inbox')
const { GET } = await import('./route')

beforeEach(() => { admin.value = null; vi.mocked(partnerInboxCounts).mockClear() })

describe('GET /api/admin/partner-inbox', () => {
  it('refuses anyone but an admin, before counting', async () => {
    const r = await GET()
    expect(r.status).toBe(403)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(partnerInboxCounts).not.toHaveBeenCalled()
  })
  it('an admin gets the total only', async () => {
    admin.value = { id: 'a1' }
    const r = await GET()
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(await r.json()).toEqual({ unreadChats: 2 })
  })
})
