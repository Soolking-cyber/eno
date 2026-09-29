import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `GET /api/handle/check` — the editor's live "available / taken" answer.
 *
 * ⛔ IT MUST SAY WHAT `claimHandle` WILL DO (SEO wave B, I2b, and its review). A name is taken when
 * another handle has its SUBDOMAIN KEY (the handle without underscores: `sdc_store` ↔ `sdcstore`),
 * and "yours" means only the row `claimHandle` frees: the EDITOR's own target. Opus, reviewing I2b:
 * your profile's `sdcstore` counted as yours in the SHOP editor, so it said "available" for
 * `sdc_store` and Save answered 409.
 *
 * `route()` is replaced by a pass-through (auth and the limiter are its own tests' business) and the
 * database by an in-memory list; nothing here can reach Postgres.
 */

type Holder = { handle: string; profileId: string | null; sellerId: string | null }

const h = vi.hoisted(() => ({
  handles: [] as Holder[],
  /** sellerId → ownerId */
  sellerOwner: new Map<string, string>(),
}))

vi.mock('@/lib/api/handler', () => ({
  route: (_opts: unknown, fn: (ctx: { req: Request; userId: string }) => Promise<unknown>) =>
    async (req: Request) => fn({ req, userId: 'user-1' }),
}))

vi.mock('@/lib/handle', async () => {
  const { validateHandle } = await import('@/lib/handle-format')
  return {
    validateHandle,
    subdomainKeyHolders: async (x: string) => h.handles.filter((r) => r.handle.replace(/_/g, '') === x.replace(/_/g, '')),
  }
})

vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      count: async ({ where }: { where: { id: string; ownerId: string } }) =>
        (h.sellerOwner.get(where.id) === where.ownerId ? 1 : 0),
    },
  },
}))

const { GET } = await import('./route')
const check = async (name: string, target?: 'profile' | 'seller') =>
  (GET as unknown as (r: Request) => Promise<unknown>)(
    new Request(`https://eno.vn/api/handle/check?h=${encodeURIComponent(name)}${target ? `&target=${target}` : ''}`),
  )

beforeEach(() => {
  h.handles = []
  h.sellerOwner = new Map([['shop-1', 'user-1'], ['shop-9', 'user-9']])
})

describe('GET /api/handle/check — by subdomain key', () => {
  it('a free name is available', async () => {
    expect(await check('sdcstore', 'seller')).toEqual({ handle: 'sdcstore', valid: true, available: true })
  })

  it('⛔ another holder of the same underscore-free form makes it taken, in every spelling', async () => {
    for (const [held, wanted] of [['sdc_store', 'sdcstore'], ['sdcstore', 'sdc_store'], ['a_b_cd', 'abc_d']]) {
      h.handles = [{ handle: held, profileId: null, sellerId: 'shop-9' }]
      expect(await check(wanted, 'seller'), `${held} held`).toMatchObject({ available: false, reason: 'taken' })
    }
  })

  it('a hyphen is a different key', async () => {
    h.handles = [{ handle: 'sdc_store', profileId: null, sellerId: 'shop-9' }]
    expect(await check('sdc-store', 'seller')).toMatchObject({ available: true })
  })

  it('re-spelling the target\'s OWN name is available (claimHandle frees it first)', async () => {
    h.handles = [{ handle: 'sdc_store', profileId: null, sellerId: 'shop-1' }]
    expect(await check('sdcstore', 'seller')).toMatchObject({ available: true })
    h.handles = [{ handle: 'sdc_store', profileId: 'user-1', sellerId: null }]
    expect(await check('sdcstore', 'profile')).toMatchObject({ available: true })
  })

  it('⛔ your OTHER row is not the target\'s: profile `sdcstore` blocks the shop claiming `sdc_store`, and back', async () => {
    h.handles = [{ handle: 'sdcstore', profileId: 'user-1', sellerId: null }]
    expect(await check('sdc_store', 'seller')).toMatchObject({ available: false, reason: 'taken' })
    h.handles = [{ handle: 'sdcstore', profileId: null, sellerId: 'shop-1' }]
    expect(await check('sdc_store', 'profile')).toMatchObject({ available: false, reason: 'taken' })
  })

  it('an older client that sends no target keeps the old answer: either of your rows', async () => {
    h.handles = [{ handle: 'sdcstore', profileId: 'user-1', sellerId: null }]
    expect(await check('sdc_store')).toMatchObject({ available: true })
    h.handles = [{ handle: 'sdcstore', profileId: null, sellerId: 'shop-1' }]
    expect(await check('sdc_store')).toMatchObject({ available: true })
  })
})
