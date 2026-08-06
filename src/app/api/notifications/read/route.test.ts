import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * WS6 migration guard for the two routes moved onto `route()` in this commit.
 *
 * ⚠️ THE CONTRACT IS "ZERO BYTES CHANGE ON THE WIRE", so that is what is asserted: status code and
 * exact JSON body for every branch, not "it still works". Clients branch on these strings with no
 * compiler involved, and the wrapper's own docblock says byte-identity is the only reason a
 * 167-route migration is safe to start.
 *
 * ⚠️ THE `body:` OPTION IS THE TRAP THIS FILE EXISTS TO CATCH. route() answers 400 when a `body`
 * schema is given and the JSON is malformed. /api/notifications/read must treat a missing or
 * unparseable body as "mark ALL read" — the bell sends no body at all. Handing it a schema is the
 * obvious-looking migration and it would silently stop the badge clearing, with nothing failing.
 */
const h = vi.hoisted(() => ({
  userId: null as string | null,
  updateMany: [] as Record<string, unknown>[],
  profileUpdate: null as Record<string, unknown> | null,
  profileUpdateArgs: null as Record<string, unknown> | null,
  profileThrows: false,
  notifThrows: false,
  badgeSynced: [] as string[],
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.userId,
  getCurrentProfile: async () => (h.userId ? { id: h.userId } : null),
  getAdmin: async () => null,
}))
vi.mock('@/lib/db', () => ({
  db: {
    notification: {
      updateMany: async (a: Record<string, unknown>) => {
        if (h.notifThrows) throw new Error('db down')
        h.updateMany.push(a); return { count: 1 }
      },
    },
    profile: {
      update: async (a: Record<string, unknown>) => {
        h.profileUpdateArgs = a
        if (h.profileThrows) throw new Error('db down')
        return h.profileUpdate
      },
    },
  },
}))
vi.mock('@/lib/native-push', () => ({ syncBadgeToProfile: async (id: string) => { h.badgeSynced.push(id) } }))
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void fn() } }
})

const { POST: markRead } = await import('./route')
const { POST: skip } = await import('../../availability/skip/route')

const post = (body?: unknown, raw?: string) =>
  new Request('http://x/api/notifications/read', {
    method: 'POST',
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

const read = async (res: Response) => ({ status: res.status, json: await res.json() })

beforeEach(() => {
  h.userId = 'user-1'; h.updateMany = []; h.badgeSynced = []
  h.profileUpdate = { availabilitySkips: 3 }; h.profileThrows = false
  h.profileUpdateArgs = null; h.notifThrows = false
})

describe('POST /api/notifications/read — wire unchanged by the route() migration', () => {
  it('guest → 401 {"error":"auth_required"}', async () => {
    h.userId = null
    expect(await read(await markRead(post()))).toEqual({ status: 401, json: { error: 'auth_required' } })
    // The 401 must come BEFORE any work — a wrapper that authed after running the handler would
    // still satisfy the status assertion alone.
    expect(h.updateMany).toEqual([])
    expect(h.badgeSynced).toEqual([])
  })

  it('NO body → marks ALL unread, 200 {"ok":true}', async () => {
    const r = await read(await markRead(post()))
    expect(r).toEqual({ status: 200, json: { ok: true } })
    expect(h.updateMany[0].where).toEqual({ recipientId: 'user-1', read: false })
  })

  it('MALFORMED json → still marks all, 200 — NOT a 400', async () => {
    // The regression a `body:` schema would introduce. If this ever returns 400, the bell stops
    // clearing the badge and nothing else fails.
    const r = await read(await markRead(post(undefined, '{not json')))
    expect(r).toEqual({ status: 200, json: { ok: true } })
    expect(h.updateMany[0].where).toEqual({ recipientId: 'user-1', read: false })
  })

  it('{ids:[…]} → marks exactly those, 200 {"ok":true}', async () => {
    const r = await read(await markRead(post({ ids: ['a', 'b'] })))
    expect(r).toEqual({ status: 200, json: { ok: true } })
    expect(h.updateMany[0].where).toEqual({ recipientId: 'user-1', id: { in: ['a', 'b'] } })
  })

  it('{ids:[]} → falls back to marking all (empty array is not a selection)', async () => {
    await markRead(post({ ids: [] }))
    expect(h.updateMany[0].where).toEqual({ recipientId: 'user-1', read: false })
  })

  /**
   * ⚠️ THE ONE BRANCH THAT IS *NOT* BYTE-IDENTICAL, and the reviewer was right to catch the
   * overclaim. Previously an updateMany rejection was an UNHANDLED throw and Next answered its own
   * default 500. route() catches it, logs with an `op`, and answers `{"error":"internal_error"}`
   * 500. That is a deliberate improvement — a structured code instead of an HTML error page, and
   * never the exception text, which can carry a Prisma query or a phone number — but it IS a wire
   * change on the failure path and is recorded rather than glossed.
   */
  it('a DB failure now answers a structured 500 {"error":"internal_error"} — CHANGED, deliberately', async () => {
    h.notifThrows = true
    expect(await read(await markRead(post()))).toEqual({ status: 500, json: { error: 'internal_error' } })
  })

  it('responds as JSON — the content type is part of the wire too', async () => {
    const res = await markRead(post())
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('syncs the badge for the caller, never a body-supplied id', async () => {
    await markRead(post({ ids: ['a'], recipientId: 'someone-else' }))
    expect(h.badgeSynced).toEqual(['user-1'])
  })
})

describe('POST /api/availability/skip — wire unchanged by the route() migration', () => {
  it('guest → 401 {"error":"auth_required"}', async () => {
    h.userId = null
    expect(await read(await skip(new Request('http://x/api/availability/skip', { method: 'POST' })))).toEqual({
      status: 401, json: { error: 'auth_required' },
    })
  })

  it('signed in → 200 {"ok":true,"skips":n}, incrementing the CALLER\'s own row', async () => {
    const r = await read(await skip(new Request('http://x/api/availability/skip', { method: 'POST' })))
    expect(r).toEqual({ status: 200, json: { ok: true, skips: 3 } })
    // Asserted because the mock ignores its arguments otherwise: `auth: 'userId'` resolves the id
    // from the JWT with no DB read, so if that id were ever not the Profile id this route would
    // increment the wrong row — or throw into the .catch and answer 200 skips:0 forever — with the
    // status assertion above still green.
    expect(h.profileUpdateArgs).toEqual({
      where: { id: 'user-1' },
      data: { availabilitySkips: { increment: 1 } },
      select: { availabilitySkips: true },
    })
  })

  it('a failed update still answers 200 with skips:0 — the ?? 0 is load-bearing', async () => {
    h.profileThrows = true
    const r = await read(await skip(new Request('http://x/api/availability/skip', { method: 'POST' })))
    expect(r).toEqual({ status: 200, json: { ok: true, skips: 0 } })
  })
})
