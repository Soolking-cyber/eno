import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/messages/[id]/reactions across a block (App Store gate `ugc-safety`): the thread is closed to
 * reactions as well as messages. Off: unchanged and no block lookup.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ blocked: false, lookups: 0, created: [] as Row[], existing: 0, removedCount: 0 }))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'buyer-1' }), getCurrentProfileId: async () => 'buyer-1', getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/db', () => {
  const tx: Row = {
    message: { updateMany: async () => ({ count: 1 }) },
    messageReaction: {
      deleteMany: async ({ where }: Row) => {
        // The toggle-off delete names the emoji; the swap delete does not.
        if (where.emoji && h.existing) { h.existing = 0; h.removedCount++; return { count: 1 } }
        return { count: 0 }
      },
      create: async ({ data }: Row) => { h.created.push(data); return data },
    },
  }
  return {
    db: {
      message: { findUnique: async () => ({ id: 'm1', deletedAt: null, conversation: { buyerProfileId: 'buyer-1', sellerProfileId: 'seller-1' } }) },
      messageReaction: { groupBy: async () => [], findMany: async () => [], count: async () => 0 },
      forumUserBlock: { findFirst: async () => { h.lookups++; return h.blocked ? { blockerProfileId: 'seller-1' } : null } },
      profile: { findUnique: async () => ({ email: 'someone@example.com' }) },
      $transaction: async (fn: (t: Row) => unknown) => fn(tx),
    },
  }
})

const { POST } = await import('./route')

async function react() {
  const res = await POST(new Request('https://www.eno.forum/api/messages/m1/reactions', { method: 'POST', body: JSON.stringify({ emoji: '❤️' }) }) as never, { params: Promise.resolve({ id: 'm1' }) } as never)
  return { status: res.status, body: (await res.json().catch(() => null)) as Row | null }
}

beforeEach(() => { h.blocked = false; h.lookups = 0; h.created = []; h.existing = 0; h.removedCount = 0 })
afterEach(() => vi.unstubAllEnvs())

describe('reacting across a block', () => {
  it('gate OFF: a stored block changes nothing and is never looked up', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    h.blocked = true
    await react()
    expect(h.lookups).toBe(0)
    expect(h.created).toHaveLength(1)
  })

  it('gate ON, blocked: a NEW reaction is refused (403 blocked) and nothing written', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocked = true
    expect(await react()).toEqual({ status: 403, body: { error: 'blocked' } })
    expect(h.created).toEqual([])
  })

  it('gate ON, blocked: taking your own reaction BACK still works', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    h.blocked = true
    h.existing = 1
    expect((await react()).status).toBe(200)
    expect(h.removedCount).toBe(1)
    expect(h.created).toEqual([])
  })
})
