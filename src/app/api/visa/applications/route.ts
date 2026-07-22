import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import {
  getVisaShopListings,
  getVisaShopProducts,
  isVisaProductReadyForAutoFill,
  type VisaEntryType,
  type VisaShopProduct,
  type VisaSpeedCode,
} from '@/lib/visa-shop'
import { encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { quoteVisaUsd, type VisaQuote } from '@/lib/visa/fx'
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
  /** Listing.titleVi — the admin's hand-authored Vietnamese title, null when unset. The
   *  product's IDENTITY (entry type + speed) is bilingual from src/lib/visa/speed.ts; this
   *  is the admin's own wording, and a Vietnamese buyer must read it in Vietnamese. */
  titleVi: string | null
  entryType: VisaEntryType
  speed: VisaSpeedCode
  /** The admin's number, in whole đồng — the price they actually set on the listing. */
  priceVnd: number
  currency: 'VND'
  /** SERVER-ISSUED USD conversion, or null when FX is unavailable. See the note below. */
  quote: VisaQuote | null
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
 * ⚠️ TWO NUMBERS, AND ONLY ONE OF THEM IS OURS TO INVENT. `priceVnd` is the admin's own
 * figure off the listing. The USD ride-along is a SERVER-ISSUED quote, never a client-side
 * conversion: the browser's FX rates are cached for up to 12h, so converting there lets the
 * buyer read one number while PayPal captures another. A null quote means FX is unavailable
 * — the UI must say so and refuse to charge rather than guess a rate.
 *
 * Both are still display-only: the checkout route re-quotes and accepts no amount from the
 * client. The quote here is what the buyer AGREED to, and checkout compares against it.
 */
async function visaCatalogueForApplicant(): Promise<VisaCatalogueEntry[]> {
  const products = (await getVisaShopProducts()).filter(isBuyableVisaProduct)
  // The Vietnamese title lives on the LISTING; the projected product carries only the
  // fields the ENGINE needs. Read back from the same per-request-cached storefront list
  // getVisaShopProducts is itself derived from, so this is a map lookup, not a query.
  const viTitles = new Map((await getVisaShopListings()).map((listing) => [listing.id, listing.titleVi]))
  // One rate fetch serves them all (fx.ts caches it), so this is not N round-trips.
  return Promise.all(
    products.map(async (product) => ({
      listingId: product.listingId,
      title: product.title,
      titleVi: viTitles.get(product.listingId) ?? null,
      entryType: product.entryType,
      speed: product.speed,
      priceVnd: product.priceVnd,
      currency: 'VND' as const,
      quote: await quoteVisaUsd({ listingId: product.listingId, priceVnd: product.priceVnd }),
    })),
  )
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const activeMode = params.get('active') === '1'
  const catalogueMode = params.get('catalogue') === '1'

  // ── ?catalogue=1 — THE PICKER'S PAYLOAD, and nothing else ────────────────────────
  //
  // "user click chat then selects available product from admin shop" (owner): the chat
  // entry point needs the six products and the three facts that decide whether starting
  // one can work. It must NOT drag the applicant's case list along with it — that read
  // decrypts nothing here but still walks visa_applications + visa_documents for a
  // surface that renders neither, and a picker is opened far more often than a case is.
  //
  // ⚠️ THE DOLLARS ARE THE SERVER'S. Every row ships a SERVER-ISSUED quote (fx.ts) and the
  // client renders that number; there is no client-side conversion, because the browser's
  // FX rates are cached for up to 12h and a buyer must never read one number while the
  // provider captures another. A null quote is the honest "FX is down" state.
  //
  // ⚠️ THE SUBMISSION WINDOW IS DELIBERATELY ABSENT — same rule as the applicant payload
  // below: it is a pure function of the tier and the INSTANT, so the client recomputes it
  // from src/lib/visa/speed.ts and a picker left open for an hour stops offering a desk
  // that closed. The server's answer at checkout is still the only one that decides.
  //
  // NOT gated on `payments` (unlike the applicant list): the products are real whether or
  // not the provider keys are installed, so the picker is told BOTH facts and says so
  // itself. Hiding the catalogue on a dormant host would be a lie about the shop.
  if (catalogueMode) {
    const products = await visaCatalogueForApplicant().catch((error) => {
      console.error('[visa] catalogue read failed', (error as Error)?.message?.slice(0, 200))
      return [] as VisaCatalogueEntry[]
    })
    return NextResponse.json({
      products,
      // null while the payment providers are dormant — the flow still runs, the pay card
      // at step 5 does not. The picker says so up front instead of dead-ending at the end.
      payments: visaPaymentsPublicConfig(),
      // false ⇒ POST /start answers 503 on this host; the picker refuses rather than
      // offering a button that cannot work.
      encryptionReady: visaCryptoReady(),
    })
  }

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
