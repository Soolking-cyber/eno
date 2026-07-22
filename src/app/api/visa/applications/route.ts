import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import {
  getVisaShopProducts,
  isVisaProductReadyForAutoFill,
  type VisaEntryType,
  type VisaShopProduct,
  type VisaSpeedCode,
} from '@/lib/visa-shop'
import { encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb, visaTableMissing } from '@/lib/visa/db'
import { visaPaymentsConfig, type VisaPaymentProvider } from '@/lib/visa/payments'
import { serializeVisa, type VisaApplicationRow, type VisaDocumentRow, type VisaEventRow } from '@/lib/visa/records'
import { emptyVisaPayload } from '@/lib/visa/schema'

// APPLICANT visa API — the in-hub port of apps/forum/src/app/api/visa/applications/route.ts.
// Adapted for eno.vn: auth is the COOKIE session (getCurrentProfile) instead of the forum's
// Bearer path — ownership scoping is unchanged because visa_applications.user_id is the
// Supabase auth uid, and Profile.id == auth.users.id (src/lib/profile.ts). Same-origin
// dashboard fetches only, so the forum's CORS/forumJson layer is dropped (repo convention:
// no cookie-auth route here does per-route origin checks).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * What the BROWSER is allowed to know about the payment gate.
 *
 * ⚠️ feeCents NEVER CROSSES THIS BOUNDARY (owner, 2026-07-21). It is the dormant/live env
 * switch and nothing else — visa services are ordinary marketplace listings now and their
 * amounts live on Listing.price, so a client that renders feeCents renders a number nobody
 * will ever be charged (which is exactly what the Review step used to do). The applicant
 * needs two facts to draw the gate: which providers to offer, and the currency the desk
 * charges in. The amount comes from the catalogue below, where it is attached to the
 * PRODUCT it belongs to and can be compared with what the checkout route captures.
 */
type VisaPaymentsPublicConfig = { providers: VisaPaymentProvider[]; currency: 'USD' }
function visaPaymentsPublicConfig(): VisaPaymentsPublicConfig | null {
  const config = visaPaymentsConfig()
  return config ? { providers: config.providers, currency: config.currency } : null
}

/** A catalogue row as the applicant sees it: WHICH product, and what it costs. */
type VisaCatalogueEntry = {
  listingId: string
  title: string
  entryType: VisaEntryType
  speed: VisaSpeedCode
  priceCents: number
  currency: string
}

/**
 * Delegates to the shop's own readiness rule and NARROWS with it, so the two can never
 * disagree: what the buyer is offered is exactly what isVisaProductReadyForAutoFill()
 * calls finished, and the nulls are gone from the type by the same test.
 */
function isBuyableVisaProduct(
  product: VisaShopProduct,
): product is VisaShopProduct & { entryType: VisaEntryType; speed: VisaSpeedCode } {
  return isVisaProductReadyForAutoFill(product)
}

/**
 * The purchasable catalogue — the marketplace IS the catalogue, so this is derived from
 * the visa storefront's listings on every request and there is no hard-coded option list
 * anywhere on the client.
 *
 * Half-built products (no entry type or no speed yet) are dropped: the shop keeps them
 * visible so the ADMIN can see the row being set up, but they are not a service anyone can
 * buy, and the checkout route refuses them with `product_not_configured` anyway.
 *
 * The `window` is deliberately NOT shipped: it is a function of the tier and the instant,
 * and the client recomputes it from the same pure module (src/lib/visa/speed.ts) so a page
 * left open does not keep offering a desk that closed twenty minutes ago. The server's
 * answer at checkout time is still the only one that decides.
 *
 * ⚠️ Prices ride along as CENTS PER PRODUCT and are display-only — the checkout route
 * re-resolves the amount from the listing and accepts no amount from the client.
 */
async function visaCatalogueForApplicant(): Promise<VisaCatalogueEntry[]> {
  return (await getVisaShopProducts()).filter(isBuyableVisaProduct).map((product) => ({
    listingId: product.listingId,
    title: product.title,
    entryType: product.entryType,
    speed: product.speed,
    priceCents: product.priceCents,
    currency: product.currency,
  }))
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const activeMode = new URL(request.url).searchParams.get('active') === '1'
  try {
    // Dormant hosts do NO extra work and answer exactly as they did before per-product
    // pricing: no providers configured ⇒ no catalogue read, no products, direct submit.
    // Started here (not awaited) so the storefront read overlaps the application queries;
    // fail-soft to [] because a catalogue outage must not 500 somebody's application list.
    const payments = visaPaymentsPublicConfig()
    const cataloguePromise: Promise<VisaCatalogueEntry[]> = payments
      ? visaCatalogueForApplicant().catch((error) => {
        console.error('[visa] catalogue read failed', (error as Error)?.message?.slice(0, 200))
        return []
      })
      : Promise.resolve([])
    const db = getVisaDb()
    const { data, error } = await db.from('visa_applications').select('*').eq('user_id', profile.id).order('updated_at', { ascending: false }).limit(20)
    if (error) throw error
    const applications = (data || []) as VisaApplicationRow[]
    const ids = applications.map((item) => item.id)
    if (activeMode) {
      // ?active=1 — the assistant's mount/poll shape (forum-route parity): the list rows
      // (history) PLUS the active application in DETAIL form (decrypted payload + events,
      // same serialization as GET /api/visa/applications/[id]), replacing the client's
      // former list→detail request waterfall with one round trip. Selection mirrors the
      // client rule it replaces exactly: newest non-cancelled application, else the newest.
      const encryptionReady = visaCryptoReady()
      // Detail requires decryption — without the key, return the (payload-free) list and
      // encryptionReady:false so the client renders the honest "not configured" state.
      const active = encryptionReady ? (applications.find((item) => item.status !== 'cancelled') || applications[0] || null) : null
      const [documentsResult, eventsResult] = await Promise.all([
        ids.length ? db.from('visa_documents').select('*').in('application_id', ids).order('created_at') : Promise.resolve({ data: [] }),
        active ? db.from('visa_events').select('*').eq('application_id', active.id).order('created_at') : Promise.resolve({ data: [] }),
      ])
      const documents = (documentsResult.data || []) as VisaDocumentRow[]
      const events = (eventsResult.data || []) as VisaEventRow[]
      return NextResponse.json({
        application: active ? serializeVisa(active, documents.filter((document) => document.application_id === active.id), events) : null,
        applications: applications.map((item) => serializeVisa(item, documents.filter((document) => document.application_id === item.id), undefined, false)),
        encryptionReady,
        payments,
        products: await cataloguePromise,
      })
    }
    const documents = ids.length
      ? ((await db.from('visa_documents').select('*').in('application_id', ids).order('created_at')).data || []) as VisaDocumentRow[]
      : []
    return NextResponse.json({
      // List rows serialize WITHOUT payload (forum parity) — no decryption needed, so the
      // list keeps working on a host without the key…
      applications: applications.map((item) => serializeVisa(item, documents.filter((document) => document.application_id === item.id), undefined, false)),
      // …and this flag tells the dashboard client UP FRONT whether payload routes will work,
      // so the "not configured on this host yet" state renders without a doomed write.
      encryptionReady: visaCryptoReady(),
      // Payment-gate state: null while dormant (client shows the direct submit), otherwise
      // the providers the Review step offers. NOT a price — see visaPaymentsPublicConfig.
      payments,
      // The products those providers can be paid for, priced from the listings themselves.
      products: await cataloguePromise,
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    const missing = visaTableMissing({ code })
    const message = (error as Error).message
    if (missing || message.includes('not_configured')) {
      return NextResponse.json({ error: missing ? 'visa_schema_not_ready' : message }, { status: 503 })
    }
    // Passport-data route: never echo raw DB/driver error text to the client.
    console.error('[visa] applications GET failed', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function POST() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  // Env gate BEFORE any write: creating a draft encrypts the empty payload.
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-create', profile.id, 5, '24 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  try {
    const id = randomUUID()
    const now = new Date().toISOString()
    const row = {
      id, user_id: profile.id, status: 'draft', encrypted_payload: encryptVisaPayload(emptyVisaPayload(profile.email || '')),
      payload_version: 1, checklist: [], last_applicant_action_at: now, created_at: now, updated_at: now,
    }
    const db = getVisaDb()
    const { data, error } = await db.from('visa_applications').insert(row).select('*').single()
    if (error) throw error
    await db.from('visa_events').insert({ id: randomUUID(), application_id: id, actor_type: 'applicant', actor_ref: profile.id, event: 'application_created' })
    return NextResponse.json({ application: serializeVisa(data as VisaApplicationRow, [], [], true) }, { status: 201 })
  } catch (error) {
    const message = (error as Error).message
    const missing = visaTableMissing(error as { code?: string }) || message.includes('relation')
    if (missing || message.includes('not_configured')) {
      return NextResponse.json({ error: missing ? 'visa_schema_not_ready' : message }, { status: 503 })
    }
    // Passport-data route: never echo raw DB/driver error text to the client.
    console.error('[visa] applications POST failed', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
