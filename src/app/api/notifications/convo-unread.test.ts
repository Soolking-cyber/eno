import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE ROUTE THAT ACTUALLY SHIPPED THE PHANTOM.
 *
 * ⛔ THIS SUITE EXISTS BECAUSE THE FIRST FIX TESTED THE WRONG ENDPOINT. The owner reported a badge
 * of 1 with an empty inbox; `/api/conversations/unread` was hardened, given a 99-line suite, and the
 * badge did not move — because ChatProvider reads `convoUnread` from THIS route, which carried its
 * own inline aggregates with neither the edition scope nor the deleted-thread filter. A reviewer put
 * it plainly: the broken route is the untested one.
 *
 * ⚠️ IT PINS THE WIRING, NOT THE SQL. `conversationUnread()` owns the predicate and has its own
 * coverage; what regressed here was a route re-deriving the sum instead of calling it, so that is
 * what is asserted — the route delegates, and it passes the operator flag through.
 */
const h = {
  admin: false as boolean,
  convoCalls: [] as { profileId: string; opts: { includeSupportDesk?: boolean } }[],
  notifWhere: [] as Record<string, unknown>[],
}

vi.mock('@/lib/api/handler', () => ({
  // The wrapper is auth + rate limiting; this suite is about the body it wraps.
  route: (_opts: unknown, handler: (ctx: { userId: string }) => Promise<unknown>) => () =>
    handler({ userId: 'me' }),
}))
vi.mock('@/lib/admin', () => ({ isCurrentUserAdminByClaims: () => Promise.resolve(h.admin) }))
vi.mock('@/lib/unread', () => ({
  conversationUnread: (profileId: string, opts: { includeSupportDesk?: boolean } = {}) => {
    h.convoCalls.push({ profileId, opts })
    return Promise.resolve(7)
  },
}))
vi.mock('@/lib/edition', () => ({ IS_MARKETPLACE: true }))
vi.mock('@/lib/db', () => ({
  db: {
    notification: {
      findMany: () => Promise.resolve([]),
      count: ({ where }: { where: Record<string, unknown> }) => {
        h.notifWhere.push(where)
        return Promise.resolve(3)
      },
    },
  },
}))

const run = async () => {
  const { GET } = await import('./route')
  return (await (GET as unknown as () => Promise<{ convoUnread: number; unread: number }>)())
}

describe('the notifications poll', () => {
  beforeEach(() => { h.convoCalls = []; h.notifWhere = []; h.admin = false; vi.resetModules() })

  it('takes its conversation total from the shared counter, not its own aggregates', async () => {
    const body = await run()
    expect(h.convoCalls).toHaveLength(1)
    expect(h.convoCalls[0].profileId).toBe('me')
    expect(body.convoUnread).toBe(7)
  })

  /** ⚠️ An operator's desk threads belong in the badge; everyone else's must not include them. */
  it('passes the operator flag through, both ways', async () => {
    await run()
    expect(h.convoCalls[0].opts.includeSupportDesk).toBe(false)

    h.convoCalls = []; h.admin = true; vi.resetModules()
    await run()
    expect(h.convoCalls[0].opts.includeSupportDesk).toBe(true)
  })

  /** ⛔ The bell's own count keeps the edition deny-list — the half that was already correct. */
  it('still scopes the notification count by edition', async () => {
    await run()
    expect(h.notifWhere[0]).toMatchObject({ recipientId: 'me', read: false })
    expect(h.notifWhere[0].type).toBeDefined()
  })
})
