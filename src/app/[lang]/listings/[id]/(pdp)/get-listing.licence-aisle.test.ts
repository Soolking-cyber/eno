import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE EDITION BOUNDARY ON AN e-VISA PAGE (codex #8, plan review 2026-10-14). Since 2026-10-14 the e-Visa subcategory is
 * open to anyone on BOTH editions, live after eno's licence check — but eno's OWN visa desk stays hidden from eno.vn
 * (HIDDEN_DESK_OWNER_EMAILS: eno itself still does not offer e-visa there). So on the marketplace build, the PDP's read
 * (getListing → scopedListingWhere) must 404 the desk's e-Visa row and serve a third party's from the same aisle.
 * The database is a fixture table, and the read's `where` is evaluated against it the way Prisma would.
 */
const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  lastWhere: null as unknown,
}))

type Where = Record<string, unknown>
/** Prisma's reading of the shapes scopedListingWhere composes: AND, plain equality, { in }, { notIn }. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Where[]).every((w) => matches(row, w))
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const op = v as { in?: unknown[]; notIn?: unknown[]; not?: unknown }
      return (op.in === undefined || op.in.includes(row[k])) && (op.notIn === undefined || !op.notIn.includes(row[k])) && (!('not' in op) || row[k] !== op.not)
    }
    return row[k] === v
  })
}

vi.mock('@/lib/edition', () => ({ IS_SERVICES: false, IS_MARKETPLACE: true, EDITION: 'marketplace', SITE_NAME: 'eno.vn' }))
vi.mock('@/lib/visa-shop', () => ({ VISA_SHOP_OWNER_EMAILS: ['support@eno.forum'] }))
vi.mock('@/lib/trips/dm-thread', () => ({ TRIP_DESK_OWNER_EMAILS: ['support@eno.forum'] }))
vi.mock('@/lib/gone-listing', () => ({ isGoneListing: () => false }))
vi.mock('@/lib/gone-listing-ids', () => ({ isJournaledGone: () => false }))
vi.mock('@/lib/db', () => ({
  db: {
    // The desk: the storefront eno's own support account owns.
    seller: { findMany: async ({ where }: { where: { owner: { email: { in: string[] } } } }) => (where.owner.email.in.includes('support@eno.forum') ? [{ id: 'desk-seller' }] : []) },
    category: { findUnique: async () => null },
    listing: {
      findFirst: async ({ where }: { where: Where }) => {
        h.lastWhere = where
        return h.rows.find((r) => matches(r, where)) ?? null
      },
    },
  },
}))
// react's cache() memoises per request; outside a request it is identity — unwrapped so every read reaches the fixture.
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: (f: unknown) => f }))

// The two allow/hide lists are read when edition-scope loads: pinned here, whatever the shell exports.
vi.stubEnv('HIDDEN_DESK_OWNER_EMAILS', 'support@eno.forum')
vi.stubEnv('MARKETPLACE_ALLOWED_OWNER_EMAILS', '')
const { getListing } = await import('./get-listing')

const row = (id: string, sellerId: string) => ({
  id, sellerId, subcategorySlug: 'visa-legal', verified: true, status: 'active', category: { slug: 'services' },
  attributes: JSON.stringify({ providerLegalName: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ DU LỊCH VIETKITE', providerLicenceNo: '79-123/2019/TCDL-GP LHQT' }),
})

beforeEach(() => {
  h.rows = [row('desk-evisa', 'desk-seller'), row('partner-evisa', 'b6b7b817-6af9-4d37-a762-cf54f6ec74e6')]
  h.lastWhere = null
})

describe('the marketplace PDP read and the e-Visa aisle', () => {
  it('404s eno’s own desk’s e-Visa listing — the read carries the desk exclusion', async () => {
    expect(await getListing('desk-evisa')).toBeNull()
    expect(h.lastWhere).toEqual({ AND: [{ id: 'desk-evisa' }, { sellerId: { notIn: ['desk-seller'] } }] })
  })

  it('serves another seller’s e-Visa listing from the same aisle (live after eno’s licence check)', async () => {
    const got = await getListing('partner-evisa')
    expect(got?.id).toBe('partner-evisa')
    expect(got?.subcategorySlug).toBe('visa-legal')
  })
})
