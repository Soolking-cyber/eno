import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── TASK B: CHECKOUT CHARGES THE CASE'S CANONICAL SELECTION, NEVER THE CLIENT ────────
//
// The two properties this route must hold after the 2026-07-23 review, and neither is
// observable from a live-DB e2e without opening a real provider session:
//
//  1. CANONICAL SOURCE OF TRUTH. The charged listing comes from visa_applications
//     .selected_listing_id, falling back to the newest dm_product_selected event. The
//     body's listingId is only a confirmation token: a body naming a DIFFERENT listing than
//     the case selected is refused (listing_selection_mismatch), never charged. Before the
//     guard the route trusted the body outright, so this test would go green on a checkout
//     for the wrong product.
//  2. FAIL CLOSED WITH NO SELECTION. A case with neither the column nor a
//     dm_product_selected event has no price to quote and is refused product_not_selected —
//     a productless case cannot pay.
//
// Both refusals must happen BEFORE any provider is called, so every test also asserts the
// provider mock was never touched — a refusal that still charged would be the worst outcome.
//
// ⚠️ THE SUPABASE MOCK HONOURS ITS TABLE + OP (the dm-flow.test.ts idiom): the visa_applications
// read returns the seeded case, the visa_documents read its docs, the visa_payments insert
// succeeds. resolveVisaProduct is stubbed to return a VALID product for whatever id it is
// asked — so removing the guard genuinely lets the wrong-listing / no-selection cases reach a
// 200, which is exactly what makes these tests fail without it.

type Row = Record<string, any>

const CANON = 'listing-canonical'

const h = vi.hoisted(() => ({
  state: {
    userId: 'user-1' as string | null,
    application: null as Row | null,
    documents: [] as Row[],
    payload: { entryType: 'single' } as Row,
    issues: [] as unknown[],
    dmSelected: null as string | null,
    cryptoReady: true,
    payments: { providers: ['paypal', 'stripe'], feeCents: 100, currency: 'USD' } as Row | null,
    rateOk: true,
    // resolveVisaProduct returns this template with listingId set to whatever was asked, so a
    // route that trusts the client id (no guard) still resolves a sellable product for it.
    product: {
      title: 'Vietnam e-visa — 1 hour, single entry',
      entryType: 'single' as string | null,
      speed: '1H' as string | null,
      priceVnd: 3_000_000,
      currency: 'VND',
      window: { acceptingNow: true, nextCutoffIso: null, nextOpensIso: null },
    } as Row | null,
    quote: {
      listingId: 'listing-canonical', priceVnd: 3_000_000, amountUsdCents: 11_489, vndPerUsd: 26_111,
      quotedAt: '2026-07-23T00:00:00.000Z', expiresAt: '2026-07-23T00:15:00.000Z',
    } as Row | null,
    inserts: [] as Row[],
    providerCalls: [] as Row[],
  },
}))

// ── The Supabase mock (getVisaDb) — resolves by table + op ──────────────────────────
vi.mock('@/lib/visa/db', () => {
  const from = (table: string) => {
    const b: Row = { _table: table, _op: 'select', _payload: null as unknown }
    const result = () => {
      if (b._op === 'insert') { h.state.inserts.push({ table, payload: b._payload }); return { data: null, error: null } }
      if (b._op === 'update') return { data: null, error: null }
      if (table === 'visa_applications') return { data: h.state.application, error: null }
      if (table === 'visa_documents') return { data: h.state.documents, error: null }
      return { data: null, error: null }
    }
    b.select = () => b
    b.eq = () => b
    b.in = () => b
    b.is = () => b
    b.order = () => b
    b.limit = () => b
    b.update = (p: unknown) => { b._op = 'update'; b._payload = p; return b }
    b.insert = (p: unknown) => { b._op = 'insert'; b._payload = p; return b }
    b.maybeSingle = () => Promise.resolve().then(result)
    b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve().then(result).then(onF, onR)
    return b
  }
  return { getVisaDb: () => ({ from }) }
})

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: () => Promise.resolve(h.state.userId) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: () => Promise.resolve({ success: h.state.rateOk }) }))
vi.mock('@/lib/db', () => ({ db: { listing: { findUnique: () => Promise.resolve(null) } } }))
vi.mock('@/lib/visa/crypto', () => ({
  visaCryptoReady: () => h.state.cryptoReady,
  decryptVisaPayload: () => h.state.payload,
  visaApplicantSnapshotHash: () => 'snap-hash',
}))
vi.mock('@/lib/visa/schema', () => ({
  validateVisaForReview: () => h.state.issues,
  VISA_DECLARATION_VERSION: 'decl-1',
  VISA_AUTHORIZATION_VERSION: 'auth-1',
}))
vi.mock('@/lib/visa-shop', () => ({
  getVisaShopListings: () => Promise.resolve([]),
  resolveVisaProduct: (listingId: string) =>
    Promise.resolve(h.state.product ? { ...h.state.product, listingId } : null),
}))
vi.mock('@/lib/visa/dm-flow', () => ({ selectedVisaDmListingId: () => Promise.resolve(h.state.dmSelected) }))
vi.mock('@/lib/visa/fx', () => ({
  quoteVisaUsd: () => Promise.resolve(h.state.quote),
  isQuoteChargeable: () => true,
  parseVisaQuote: (v: unknown) => v,
  visaQuoteDrifted: () => false,
}))
vi.mock('@/lib/visa/payments', () => ({
  visaPaymentsConfig: () => h.state.payments,
  stripeCreateCheckout: (input: Row) => { h.state.providerCalls.push({ provider: 'stripe', ...input }); return Promise.resolve({ ref: 'cs_1', url: 'https://stripe.test/pay' }) },
  paypalCreateOrder: (input: Row) => { h.state.providerCalls.push({ provider: 'paypal', ...input }); return Promise.resolve({ ref: 'ord_1', url: 'https://paypal.test/approve' }) },
}))
vi.mock('@/lib/visa/records', () => ({ recordVisaEvent: () => Promise.resolve() }))

import { POST } from './route'

const APP_ID = '11111111-1111-4111-8111-111111111111'

function seedApplication(overrides: Row = {}): void {
  h.state.application = {
    id: APP_ID, user_id: 'user-1', status: 'draft', encrypted_payload: 'cipher',
    paid_at: null, selected_listing_id: null, updated_at: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

async function postCheckout(body: Row): Promise<{ status: number; json: Row }> {
  const req = new Request(`http://test/api/visa/applications/${APP_ID}/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const res = await POST(req, { params: Promise.resolve({ id: APP_ID }) })
  return { status: res.status, json: (await res.json()) as Row }
}

const validBody = (listingId: string): Row => ({
  provider: 'paypal', listingId, declarationAccepted: true, prefillAuthorized: true,
})

beforeEach(() => {
  h.state.userId = 'user-1'
  h.state.documents = []
  h.state.payload = { entryType: 'single' }
  h.state.issues = []
  h.state.dmSelected = null
  h.state.cryptoReady = true
  h.state.payments = { providers: ['paypal', 'stripe'], feeCents: 100, currency: 'USD' }
  h.state.rateOk = true
  h.state.product = {
    title: 'Vietnam e-visa — 1 hour, single entry', entryType: 'single', speed: '1H',
    priceVnd: 3_000_000, currency: 'VND', window: { acceptingNow: true, nextCutoffIso: null, nextOpensIso: null },
  }
  h.state.quote = {
    listingId: CANON, priceVnd: 3_000_000, amountUsdCents: 11_489, vndPerUsd: 26_111,
    quotedAt: '2026-07-23T00:00:00.000Z', expiresAt: '2026-07-23T00:15:00.000Z',
  }
  h.state.inserts = []
  h.state.providerCalls = []
  seedApplication()
})

describe('visa checkout — canonical selection guard', () => {
  // ── REQUIREMENT 3: a productless case cannot pay ──────────────────────────────────
  it('refuses product_not_selected when neither the column nor a dm event names a listing', async () => {
    seedApplication({ selected_listing_id: null })
    h.state.dmSelected = null

    const { status, json } = await postCheckout(validBody('listing-anything'))

    expect(status).toBe(409)
    expect(json.error).toBe('product_not_selected')
    // FAIL CLOSED: nothing was charged. (Without the guard the route would resolve the
    // body's listing to a valid product and open a provider session.)
    expect(h.state.providerCalls).toHaveLength(0)
  })

  // ── REQUIREMENT 1: the body may only CONFIRM the canonical column, never redirect ──
  it('refuses listing_selection_mismatch when the body names a listing other than selected_listing_id', async () => {
    seedApplication({ selected_listing_id: CANON })

    const { status, json } = await postCheckout(validBody('listing-attacker-picked'))

    expect(status).toBe(409)
    expect(json.error).toBe('listing_selection_mismatch')
    expect(json.selectedListingId).toBe(CANON) // UI can re-point at the real product
    expect(h.state.providerCalls).toHaveLength(0)
  })

  // ── REQUIREMENT 1 (fallback): mismatch is measured against the dm event too ───────
  it('refuses listing_selection_mismatch against the dm_product_selected fallback when the column is null', async () => {
    seedApplication({ selected_listing_id: null })
    h.state.dmSelected = 'listing-from-dm'

    const { status, json } = await postCheckout(validBody('listing-attacker-picked'))

    expect(status).toBe(409)
    expect(json.error).toBe('listing_selection_mismatch')
    expect(json.selectedListingId).toBe('listing-from-dm')
    expect(h.state.providerCalls).toHaveLength(0)
  })

  // ── REQUIREMENT 1 (happy): the column is canonical; a matching body proceeds ──────
  it('charges the selected_listing_id when the body confirms it', async () => {
    seedApplication({ selected_listing_id: CANON })

    const { status, json } = await postCheckout(validBody(CANON))

    expect(status).toBe(200)
    expect(json.url).toBe('https://paypal.test/approve')
    expect(json.listingId).toBe(CANON)
    expect(h.state.providerCalls).toHaveLength(1)
    expect(h.state.providerCalls[0].listingId).toBe(CANON) // the CANONICAL listing was charged
  })

  // ── REQUIREMENT 1 (fallback happy): column null → charge the dm event's listing ───
  it('falls back to the newest dm_product_selected listing when the column is null', async () => {
    seedApplication({ selected_listing_id: null })
    h.state.dmSelected = 'listing-from-dm'

    const { status, json } = await postCheckout(validBody('listing-from-dm'))

    expect(status).toBe(200)
    expect(json.listingId).toBe('listing-from-dm')
    expect(h.state.providerCalls[0].listingId).toBe('listing-from-dm')
  })

  // ── The column WINS over the dm event (immutable-column precedence) ───────────────
  it('prefers selected_listing_id over the dm event when both exist', async () => {
    seedApplication({ selected_listing_id: CANON })
    h.state.dmSelected = 'listing-stale-dm'

    // Body echoes the dm event's (stale) listing, not the column → refused.
    const { status, json } = await postCheckout(validBody('listing-stale-dm'))

    expect(status).toBe(409)
    expect(json.error).toBe('listing_selection_mismatch')
    expect(json.selectedListingId).toBe(CANON)
    expect(h.state.providerCalls).toHaveLength(0)
  })

  // ── REQUIREMENT 2: the resolved product's entryType must match the application ────
  it('refuses product_entry_type_mismatch when the canonical product disagrees with the payload', async () => {
    seedApplication({ selected_listing_id: CANON })
    h.state.payload = { entryType: 'single' }
    h.state.product = { ...h.state.product, entryType: 'multiple' }

    const { status, json } = await postCheckout(validBody(CANON))

    expect(status).toBe(409)
    expect(json.error).toBe('product_entry_type_mismatch')
    expect(h.state.providerCalls).toHaveLength(0)
  })
})
