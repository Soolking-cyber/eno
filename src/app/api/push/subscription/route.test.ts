import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/push/subscription (F7): is this browser's Web Push subscription the caller's? Through the real route()
 * wrapper; harness after notifications/read/route.test.ts.
 */

const h = vi.hoisted(() => ({ userId: 'user-1' as string | null, rows: new Map<string, string>() }))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.userId,
  getCurrentProfile: async () => (h.userId ? { id: h.userId } : null),
  getAdmin: async () => null,
}))
vi.mock('@/lib/db', () => ({
  db: {
    pushSubscription: {
      findUnique: async ({ where }: { where: { endpoint: string } }) => {
        const profileId = h.rows.get(where.endpoint)
        return profileId ? { profileId } : null
      },
    },
  },
}))

const { POST } = await import('./route')

const FCM = 'https://fcm.googleapis.com/fcm/send/abc123'
const ask = (body: unknown) => POST(new Request('http://x/api/push/subscription', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: Promise.resolve({}) } as never)
const read = async (res: Response) => ({ status: res.status, json: await res.json() })

beforeEach(() => { h.userId = 'user-1'; h.rows = new Map() })

describe('POST /api/push/subscription — is this subscription mine?', () => {
  it('this account\'s own endpoint → mine, and the answer names the account it was made for', async () => {
    h.rows.set(FCM, 'user-1')
    expect(await read(await ask({ endpoint: FCM }))).toEqual({ status: 200, json: { me: 'user-1', mine: true, known: true } })
  })

  it('⛔ another account\'s endpoint → not mine, but known (says nothing about whose)', async () => {
    h.rows.set(FCM, 'user-2')
    expect(await read(await ask({ endpoint: FCM }))).toEqual({ status: 200, json: { me: 'user-1', mine: false, known: true } })
  })

  it('no row at all → not mine and not known: nothing is pushed to it, and the client keeps it', async () => {
    expect(await read(await ask({ endpoint: FCM }))).toEqual({ status: 200, json: { me: 'user-1', mine: false, known: false } })
  })

  it('a guest → 401; a malformed body or a non-push URL → 400 (the client then keeps its subscription)', async () => {
    h.userId = null
    expect((await ask({ endpoint: FCM })).status).toBe(401)
    h.userId = 'user-1'
    expect((await ask('not json')).status).toBe(400)
    expect((await ask({ endpoint: 'https://evil.example/hook' })).status).toBe(400)
    expect((await ask({})).status).toBe(400)
  })
})
