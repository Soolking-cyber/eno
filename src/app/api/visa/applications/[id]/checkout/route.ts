import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { db as marketplaceDb } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaShopListings, resolveVisaProduct } from '@/lib/visa-shop'
import { decryptVisaPayload, visaApplicantSnapshotHash, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { paypalCreateOrder, stripeCreateCheckout, visaPaymentsConfig } from '@/lib/visa/payments'
import { recordVisaEvent, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'
import { VISA_AUTHORIZATION_VERSION, VISA_DECLARATION_VERSION, validateVisaForReview } from '@/lib/visa/schema'

// Start a checkout for a COMPLETE application, for ONE product the applicant picked.
//
// ⚠️ THE CLIENT NAMES A PRODUCT; THE SERVER NAMES THE PRICE (owner, 2026-07-21).
// A visa service is an ordinary marketplace listing the admin uploaded — one listing per
// (entry type × processing speed), each with its own price on Listing.price. The body
// therefore carries a `listingId` and NOTHING resembling money: the amount comes from
// resolveVisaProduct(listingId).priceCents, which re-reads the listing on every request,
// and there is no other source of an amount anywhere in this file. (The body never
// accepted a price; the schema below is `.strict()` so that a client which starts sending
// one gets a loud 400 instead of having it silently stripped.)
//
// visaPaymentsConfig() is consulted only for "are payments switched on and is this
// provider configured" — its feeCents prices nothing (see the note on the type).
//
// ⚠️ AND THE PRODUCT MUST BE THE SERVICE THE APPLICATION ASKS FOR. Naming a listing is
// naming a SERVICE, not just a price: the tier's entry type is compared with the
// application's own entryType and a mismatch is refused (product_entry_type_mismatch)
// before anything reaches a provider.
//
// The declaration + prefill-authorization consents are required here (the same literals
// the submit route demands) and are stamped onto the payment row together with the payload
// snapshot hash — after the provider confirms payment, markVisaPaidAndHandoff re-checks
// that hash and completes the send_for_review handoff server-side.
// 503 while payments are dormant (no fee/provider env), so the client can fall back to the
// direct submit flow.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  provider: z.enum(['stripe', 'paypal']),
  // WHICH product, never how much. Listing ids are cuids, so this is a bounded opaque
  // string — its authority comes from matching a for-sale listing on the visa storefront,
  // not from its shape.
  listingId: z.string().trim().min(1).max(64),
  declarationAccepted: z.literal(true),
  prefillAuthorized: z.literal(true),
}).strict()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Why this exact listing cannot be charged. resolveVisaProduct() answers one honest null
 * for every reason, which is right for a money lookup and useless for a buyer — so the
 * catalogue is re-read here to name the reason. Only ever runs on the failure path.
 */
async function explainUnsellable(listingId: string): Promise<{ error: string; status: number }> {
  const row = (await getVisaShopListings()).find((l) => l.id === listingId)
  if (!row) {
    // Not on the visa storefront. Distinguish "no such listing" from "a listing, but not
    // one of ours" — the two need different words in the UI, and a listing's existence is
    // already public (every listing has a public PDP), so this reveals nothing.
    const exists = await marketplaceDb.listing.findUnique({ where: { id: listingId }, select: { id: true } })
      // A failed probe answers "unknown listing": the catalogue read above fails SOFT to an
      // empty list (visa-shop swallows its own errors), so a database outage lands here and
      // must refuse the charge rather than guess a price. Logged, because the difference
      // between "nobody has seeded the shop" and "the database is down" is invisible in the
      // response by design.
      .catch((e) => { console.error('[visa/checkout] listing probe failed', (e as Error)?.message?.slice(0, 200)); return null })
    return exists ? { error: 'not_a_visa_product', status: 400 } : { error: 'listing_not_found', status: 404 }
  }
  if (!row.verified || row.status !== 'active') return { error: 'product_not_for_sale', status: 409 }
  // On the storefront, for sale, and still unresolvable ⇒ the price itself is unusable
  // (non-positive, fractional, or not USD — see sellablePriceCents in visa-shop).
  return { error: 'product_price_unavailable', status: 409 }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const config = visaPaymentsConfig()
  if (!config) return NextResponse.json({ error: 'payments_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-checkout', userId, 10, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  if (!config.providers.includes(parsed.data.provider)) return NextResponse.json({ error: 'provider_not_configured' }, { status: 400 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const db = getVisaDb()
  const [{ data: application }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id),
  ])
  if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const app = application as VisaApplicationRow & { paid_at?: string | null }
  if (app.paid_at) return NextResponse.json({ error: 'already_paid' }, { status: 409 })
  if (!['draft', 'needs_changes'].includes(app.status)) return NextResponse.json({ error: 'invalid_status_transition' }, { status: 409 })

  // Never charge for an incomplete application — same validation + checklist
  // write-back the submit route performs, so the client jumps to the failing step.
  const payload = decryptVisaPayload(app.encrypted_payload)
  const issues = validateVisaForReview(payload, (documents || []) as VisaDocumentRow[])
  if (issues.length) {
    await db.from('visa_applications').update({ checklist: issues, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ error: 'application_incomplete', issues }, { status: 400 })
  }
  const snapshotHash = visaApplicantSnapshotHash(payload)

  // ── THE PRICE. One lookup, one source, immediately above the charge ───────────────
  const product = await resolveVisaProduct(parsed.data.listingId)
  if (!product) {
    const { error, status } = await explainUnsellable(parsed.data.listingId)
    return NextResponse.json({ error }, { status })
  }
  // A half-built product must not be sold: entry type and speed ARE the service (a
  // government form needs single/multiple, and the speed is what the applicant is paying
  // the premium for). The admin can see the row; nobody can buy it until it is finished.
  const missing = [
    ...(product.entryType ? [] : ['entryType']),
    ...(product.speed ? [] : ['speed']),
  ]
  if (missing.length) return NextResponse.json({ error: 'product_not_configured', missing }, { status: 409 })
  // ── THE TIER PAID FOR *IS* THE SERVICE REQUESTED ─────────────────────────────────
  // Price varies by entry type, so without this an applicant could pick the cheaper
  // single-entry product and hand eno an application asking for multiple entry — the
  // form the operator then submits would not be the one that was paid for. The listing's
  // own attribute is compared against the APPLICATION's entryType (decrypted above, the
  // same value validateVisaForReview just accepted), and a mismatch refuses the charge
  // instead of resolving it in either direction: the applicant either picks the matching
  // product or changes the answer on the form, and both are their decision to make.
  // Both values are echoed because the client must be able to say WHICH way they differ;
  // an entry type is the applicant's own choice being read back to them, not new exposure.
  if (payload.entryType !== product.entryType) {
    return NextResponse.json({
      error: 'product_entry_type_mismatch',
      productEntryType: product.entryType,
      applicationEntryType: payload.entryType,
    }, { status: 409 })
  }
  // Belt-and-braces at the decision point: visa-shop already guarantees a positive
  // whole-cent USD amount, and payments.ts asserts it again at the provider boundary, but
  // a non-positive price must be a NAMED refusal here rather than a provider error string.
  if (!Number.isSafeInteger(product.priceCents) || product.priceCents <= 0 || product.currency !== 'USD') {
    return NextResponse.json({ error: 'product_price_unavailable' }, { status: 409 })
  }
  // Closed desk → refuse and say when it reopens, rather than taking $115 at 23:00 for a
  // 1H service nobody will touch until 10:00. `nextCutoffIso` is the batch a buyer can
  // still aim at (the "opens again at 10:00" instant); `nextOpensIso` is when the tier
  // starts accepting again (local midnight). A tier with no cutoffs is always accepting,
  // so this can only fire for a tier that has them.
  if (!product.window.acceptingNow) {
    return NextResponse.json({
      error: 'submission_window_closed',
      speed: product.speed,
      nextCutoffIso: product.window.nextCutoffIso,
      nextOpensIso: product.window.nextOpensIso,
    }, { status: 409 })
  }
  const amountCents = product.priceCents

  try {
    const session = parsed.data.provider === 'stripe'
      ? await stripeCreateCheckout({
        applicationId: id, userId, listingId: product.listingId,
        productTitle: product.title, amountCents, currency: product.currency,
      })
      : await paypalCreateOrder({
        applicationId: id, listingId: product.listingId,
        productTitle: product.title, amountCents, currency: product.currency,
      })

    const { error } = await db.from('visa_payments').insert({
      application_id: id,
      user_id: userId,
      provider: parsed.data.provider,
      provider_ref: session.ref,
      // The amount the provider was just asked for — the local truth markVisaPaidAndHandoff
      // makes the capture cover. It is the LISTING's price, frozen at this click, so a
      // mid-checkout price edit by the admin can neither raise nor lower this session.
      amount_cents: amountCents,
      currency: product.currency,
      status: 'created',
      consent_snapshot_hash: snapshotHash,
      consent_at: new Date().toISOString(),
      // The exact consent versions ACCEPTED at this click — the handoff stamps these,
      // never whatever constants are current at payment time (review #8).
      consent_declaration_version: VISA_DECLARATION_VERSION,
      consent_authorization_version: VISA_AUTHORIZATION_VERSION,
    })
    if (error) throw new Error(`visa_payment_insert_failed:${error.message}`)

    // ── Dispute evidence: WHICH product, at WHAT price, under WHICH provider ref ─────
    // In visa_events, deliberately:
    //  · not a Message body — a chat card is applicant-visible content that later edits
    //    and re-renders can rewrite; the audit log is append-only and admin-facing;
    //  · not the encrypted payload — that blob's shape is a cross-app contract with the
    //    forum, and re-encrypting it to record a price would be a PII write for a
    //    non-PII fact;
    //  · not a new column — visa_payments has no listing_id and this session may not run
    //    DDL. metadata is jsonb, so this needs no migration to be queryable.
    // Everything written here is a PUBLIC marketplace fact (a listing id, a title, a
    // price, a provider reference the applicant already sees in their own return URL);
    // no applicant data goes into it, so the log's exposure is unchanged.
    // If this write fails the whole checkout fails (502): the provider session is never
    // handed to the client, so it cannot be paid, and an unevidenced charge is impossible.
    // `entryType`/`speed` are the PRODUCT's, and the guard above has already established
    // that the entry type is the application's too — so this row records what was bought
    // and what was asked for in one fact, which is what a dispute actually needs.
    await recordVisaEvent(id, 'applicant', 'checkout_started', userId, {
      provider: parsed.data.provider,
      providerRef: session.ref,
      listingId: product.listingId,
      productTitle: product.title,
      entryType: product.entryType,
      speed: product.speed,
      amountCents,
      currency: product.currency,
    })

    return NextResponse.json({
      url: session.url,
      provider: parsed.data.provider,
      // Echoed so the client can show what it is about to be charged — READ-BACK of the
      // server's decision, never an input to it.
      listingId: product.listingId,
      amountCents,
      currency: product.currency,
    })
  } catch (error) {
    console.error('[visa/checkout]', (error as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'checkout_failed' }, { status: 502 })
  }
}
