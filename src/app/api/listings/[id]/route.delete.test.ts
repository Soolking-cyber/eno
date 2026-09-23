import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE_HOLD_COPY } from '@/lib/delete-hold-copy'

/**
 * DELETE /api/listings/[id] — THE HIDE-INSTEAD-OF-DELETE ANSWER CARRIES ITS OWN WORDS (review, 2026-09-24).
 *
 * While the account or the listing is under investigation, deleteListingCore hides instead of deleting.
 * The web dashboard words that itself; the native iOS and Android dashboards call this same route and
 * had nothing to show, so a held seller watched a "deleted" listing come back hidden with no reason.
 * The route now answers `message: { en, vi }` — the same sentences the web dashboard shows.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  result: { ok: true, deleted: true } as Row,
  owner: { ok: true, profileId: 'p1' } as Row,
}))

vi.mock('@/lib/listing-owner', () => ({ checkListingOwner: async () => h.owner }))
vi.mock('@/lib/core/listings', () => ({
  deleteListingCore: async () => h.result,
  updateListingCore: async () => ({ ok: true }),
}))
// The rest of the route's import graph (GET / PATCH) — not exercised here.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: () => ({}) }))
vi.mock('@/lib/phone', () => ({ normalizePhone: () => null }))
vi.mock('@/lib/phone-unique', () => ({ phoneTakenByOther: async () => false }))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/price-stat', () => ({ getPriceBand: async () => null }))
vi.mock('@/lib/seller-metrics', () => ({ topSellerReviews: async () => [], sameSellerListings: async () => [] }))

const { DELETE } = await import('./route')

async function del() {
  const res = await DELETE(new Request('https://eno.vn/api/listings/L1', { method: 'DELETE' }) as never, { params: Promise.resolve({ id: 'L1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.result = { ok: true, deleted: true }
  h.owner = { ok: true, profileId: 'p1' }
})

describe('DELETE /api/listings/[id]', () => {
  it('an ordinary delete stays the bare {ok:true}', async () => {
    expect(await del()).toEqual({ status: 200, body: { ok: true } })
  })

  for (const reason of ['account_held', 'account_suspended', 'open_report'] as const) {
    it(`a hide (${reason}) carries the reason AND the bilingual sentence for the native clients`, async () => {
      h.result = { ok: true, deleted: false, hidden: true, reason }
      expect(await del()).toEqual({
        status: 200,
        body: { ok: true, deleted: false, hidden: true, reason, message: DELETE_HOLD_COPY[reason] },
      })
    })
  }

  it('an ownership refusal is unchanged', async () => {
    h.owner = { ok: false, error: 'forbidden', code: 403 }
    expect(await del()).toEqual({ status: 403, body: { error: 'forbidden' } })
  })
})

describe('the native sentence IS the web dashboard\'s sentence', () => {
  // The dashboard words the outcome with literal tr() calls (so gen-ui-strings harvests them); the
  // route answers DELETE_HOLD_COPY. Both languages of every reason must appear verbatim in the hook.
  const hook = readFileSync(fileURLToPath(new URL('../../../../components/marketplace/use-listing-actions.ts', import.meta.url)), 'utf8')
  for (const [reason, copy] of Object.entries(DELETE_HOLD_COPY)) {
    it(`${reason}: en + vi`, () => {
      expect(hook).toContain(`'${copy.en}'`)
      expect(hook).toContain(`'${copy.vi}'`)
    })
  }
})
