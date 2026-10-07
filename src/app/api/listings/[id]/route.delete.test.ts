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
  update: { ok: true } as Row,
  // The caller from the locally verified JWT (the acting-account check), and how often it was asked.
  me: 'p1' as string | null,
  idReads: 0,
  ownerChecks: 0,
  deletes: 0,
}))

vi.mock('@/lib/listing-owner', () => ({ checkListingOwner: async () => { h.ownerChecks += 1; return h.owner } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => { h.idReads += 1; return h.me } }))
vi.mock('@/lib/core/listings', () => ({
  deleteListingCore: async () => { h.deletes += 1; return h.result },
  updateListingCore: async () => h.update,
}))
// The rest of the route's import graph (GET / PATCH) — not exercised here.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: () => ({}) }))
vi.mock('@/lib/phone', () => ({ normalizePhone: () => null }))
vi.mock('@/lib/phone-unique', () => ({ phoneTakenByOther: async () => false }))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/price-stat', () => ({ getPriceBand: async () => null }))
vi.mock('@/lib/seller-metrics', () => ({ topSellerReviews: async () => [], sameSellerListings: async () => [] }))

const { DELETE, PATCH } = await import('./route')
const { PARTNER_ONLY_REFUSAL } = await import('@/lib/taxonomy')

async function del(headers: Record<string, string> = {}) {
  const res = await DELETE(new Request('https://eno.vn/api/listings/L1', { method: 'DELETE', headers }) as never, { params: Promise.resolve({ id: 'L1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.result = { ok: true, deleted: true }
  h.owner = { ok: true, profileId: 'p1' }
  h.update = { ok: true }
  h.me = 'p1'
  h.idReads = 0
  h.ownerChecks = 0
  h.deletes = 0
})

// O-34b (owner, 2026-10-05): an edit that moves a non-partner's listing into the visa slot is refused by the core
// (listings.sell-rules.test.ts); the route answers it with the bilingual sentence, as POST /api/listings does —
// the native apps' post schema still lists the slot, so they need words, not just the code.
describe('PATCH /api/listings/[id] — the visa-slot refusal carries its words', () => {
  const patch = async (body: Row) => {
    const res = await PATCH(new Request('https://eno.vn/api/listings/L1', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'L1' }) })
    return { status: res.status, body: (await res.json()) as Row }
  }

  it('subcategory_partner_only → 400 with the code and PARTNER_ONLY_REFUSAL', async () => {
    h.update = { ok: false, code: 400, error: 'subcategory_partner_only' }
    expect(await patch({ subcategorySlug: 'visa-legal' })).toEqual({ status: 400, body: { error: 'subcategory_partner_only', message: PARTNER_ONLY_REFUSAL } })
  })

  it('every other refusal stays the bare code', async () => {
    h.update = { ok: false, code: 400, error: 'title_too_short' }
    expect(await patch({ title: 'ab' })).toEqual({ status: 400, body: { error: 'title_too_short' } })
  })
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

  // 2026-10-01 review: a refused hide used to be relabelled 404 by the core and answered {ok:true} here.
  it('a hide the core refused for a reason other than "gone" is answered as itself, never {ok:true}', async () => {
    h.result = { ok: false, code: 403, error: 'account_held' }
    expect(await del()).toEqual({ status: 403, body: { error: 'account_held' } })
  })

  it('a 404 (already gone, or a tombstone) stays the idempotent {ok:true}', async () => {
    h.result = { ok: false, code: 404, error: 'not_found' }
    expect(await del()).toEqual({ status: 200, body: { ok: true } })
  })

  it('an ownership refusal is unchanged', async () => {
    h.owner = { ok: false, error: 'forbidden', code: 403 }
    expect(await del()).toEqual({ status: 403, body: { error: 'forbidden' } })
  })
})

/**
 * ⛔ THE DASHBOARD'S DELETE IS SENT AS THE ACCOUNT THAT TAPPED (src/lib/api/acting-account.ts). It waits out a 5s
 * undo window and the cookie is read when it goes out; a browser that changed account in between gets 409
 * account_changed BEFORE the owner check — not a 403 about someone else's listing, shown to the wrong person.
 */
describe('DELETE /api/listings/[id] — the account that tapped', () => {
  it('⛔ a session that is not the account named → 409 account_changed, before the owner check and the delete', async () => {
    h.me = 'p2'
    expect(await del({ 'x-eno-acting-account': 'p1' })).toEqual({ status: 409, body: { error: 'account_changed' } })
    expect(h.ownerChecks).toBe(0)
    expect(h.deletes).toBe(0)
  })

  it('the header names the session → the delete goes on as before', async () => {
    expect(await del({ 'x-eno-acting-account': 'p1' })).toEqual({ status: 200, body: { ok: true } })
    expect(h.deletes).toBe(1)
  })

  it('no header (the native dashboards) → the caller is not even resolved for it, and nothing changes', async () => {
    expect(await del()).toEqual({ status: 200, body: { ok: true } })
    expect(h.idReads).toBe(0)
    expect(h.deletes).toBe(1)
  })

  it('signed out with a header → the owner check answers, as before (401 is its to give)', async () => {
    h.me = null
    h.owner = { ok: false, error: 'auth_required', code: 401 }
    expect(await del({ 'x-eno-acting-account': 'p1' })).toEqual({ status: 401, body: { error: 'auth_required' } })
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
