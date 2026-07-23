import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { db as marketplaceDb } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaShopListings, resolveVisaProduct } from '@/lib/visa-shop'
import { decryptVisaPayload, visaApplicantSnapshotHash, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { selectedVisaDmListingId } from '@/lib/visa/dm-flow'
import { isQuoteChargeable, parseVisaQuote, quoteVisaUsd, visaQuoteDrifted } from '@/lib/visa/fx'
import { paypalCreateOrder, stripeCreateCheckout, visaPaymentsConfig } from '@/lib/visa/payments'
import { recordVisaEvent, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'
import { VISA_AUTHORIZATION_VERSION, VISA_DECLARATION_VERSION, validateVisaForReview } from '@/lib/visa/schema'

// Start a checkout for a COMPLETE application, for the ONE product THE CASE selected.
//
// ⚠️ THE CASE NAMES THE PRODUCT; THE SERVER NAMES THE PRICE (owner 2026-07-21; product
// source hardened 2026-07-23 per external review). A visa service is an ordinary
// marketplace listing the admin uploaded — one listing per (entry type × processing speed),
// each with its own price on Listing.price. WHICH listing is charged comes from CANONICAL
// CASE STATE, never the request body: visa_applications.selected_listing_id, falling back
// during the Phase-1 transition to the newest dm_product_selected event
// (selectedVisaDmListingId). The body still carries a `listingId`, but it is now a
// CONFIRMATION TOKEN exactly like the quote echo below — it may only AGREE with the
// canonical selection (listing_selection_mismatch otherwise) and can never redirect the
// charge. (Before this, the route trusted the body's listingId and never compared it with
// the case's real selection, so a completed case could check out ANY active visa listing
// whose entry type happened to match — the speed was not even compared.) The đồng amount
// then comes from resolveVisaProduct(canonicalListingId).priceVnd, which re-reads the
// listing on every request, and there is no other source of an amount anywhere in this
// file. (The body never accepted a price; the schema below is `.strict()` so that a client
// which starts sending one gets a loud 400 instead of having it silently stripped.)
//
// ⚠️ A CASE WITH NO SELECTION CANNOT PAY. If neither the column nor a dm_product_selected
// event names a listing, checkout refuses with product_not_selected — fail closed. (Phase 2
// adds the picker that sets selected_listing_id; until then the dm flow's event is the only
// writer of a selection, and a productless case simply has no price to quote.)
//
// ⚠️ AND THE PRICE IS IN ĐỒNG WHILE THE CHARGE IS IN DOLLARS (owner, 2026-07-22):
// "admin posts in vnd and you show in vnd and usd to users they checkout accordingly usd
// from their paypal but the vnd equivalent that admin set." So the dollars are a
// SERVER-ISSUED QUOTE of the đồng price (src/lib/visa/fx.ts), minted here, immediately
// above the charge, and charged unchanged. The client may ECHO the quote it displayed —
// that echo is a CONFIRMATION TOKEN, never money: it can only cause this route to refuse
// and re-quote, and no arithmetic anywhere below reads a number out of it. If FX is
// unavailable the checkout FAILS CLOSED (503 fx_unavailable); there is no fallback rate.
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
  // A CONFIRMATION of which product, never a choice of one and never how much. The charged
  // listing is the case's CANONICAL selection (see the header); this field is only ever
  // checked to EQUAL it, so a body naming a different listing refuses rather than redirects
  // the charge. Listing ids are bounded opaque strings — authority now comes from equalling
  // the canonical selection, not from the shape and not from matching some for-sale listing.
  listingId: z.string().trim().min(1).max(64),
  declarationAccepted: z.literal(true),
  prefillAuthorized: z.literal(true),
  // The quote the buyer was SHOWN, echoed back. Optional (a client that has not been
  // shown one yet simply omits it) and deliberately typed as opaque here: parseVisaQuote()
  // in src/lib/visa/fx.ts is the hostile-input parser, and duplicating its rules in a zod
  // shape would create a second, quieter definition of what a quote is. It is a
  // CONFIRMATION TOKEN — the only thing this route does with it is compare it against a
  // freshly-issued quote and refuse if they disagree.
  quote: z.unknown().optional(),
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
  // (non-positive, fractional, or not priced in ₫ — see sellablePriceVnd in visa-shop).
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
  // The Phase-1 canonical-selection columns (scripts/visa-case-conversation-cols.mjs) are
  // read through this local widening: visa-admin.ts's VisaApplicationRow predates them and
  // is another session's file. `selected_listing_id` is nullable and backfilled only where
  // resolvable, so the code below MUST tolerate null — hence the dm_product_selected
  // fallback and the product_not_selected refusal.
  const app = application as VisaApplicationRow & { paid_at?: string | null; selected_listing_id?: string | null }
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

  // ── WHICH PRODUCT: THE CASE'S OWN SELECTION, NEVER THE CLIENT'S ───────────────────
  // Canonical case state decides what is charged. Prefer the immutable column the picker
  // writes (Phase 2); during the Phase-1 transition it may be null, so fall back to the
  // newest dm_product_selected event — the only writer of a selection until the picker
  // ships. The body's listingId is NOT consulted here: it is a confirmation token, checked
  // for equality below and nowhere trusted to name the product. (A blank/whitespace column
  // is treated as unset — `|| fallback` — because an empty string is not a listing id.)
  const storedSelection = typeof app.selected_listing_id === 'string' ? app.selected_listing_id.trim() : ''
  const canonicalListingId = storedSelection || (await selectedVisaDmListingId(id))
  if (!canonicalListingId) {
    // No column, no event → nothing to price. Fail closed rather than let the body choose.
    return NextResponse.json({ error: 'product_not_selected' }, { status: 409 })
  }
  // The body may only CONFIRM the canonical selection. A mismatch refuses (and names the
  // canonical listing so the UI can re-point at the right product) instead of charging the
  // listing the client asked for. A listing id is a public marketplace fact (it is already
  // echoed on success and on the PDP), so returning it here exposes nothing.
  if (parsed.data.listingId !== canonicalListingId) {
    return NextResponse.json({
      error: 'listing_selection_mismatch',
      selectedListingId: canonicalListingId,
    }, { status: 409 })
  }

  // ── THE PRICE. One lookup, one source, immediately above the charge ───────────────
  // Resolved from the CANONICAL listing id, never parsed.data.listingId.
  const product = await resolveVisaProduct(canonicalListingId)
  if (!product) {
    const { error, status } = await explainUnsellable(canonicalListingId)
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
  // Belt-and-braces at the decision point: visa-shop already guarantees a positive whole
  // number of đồng, and fx.ts re-asserts it before quoting, but a non-positive price must
  // be a NAMED refusal here rather than a provider error string.
  if (!Number.isSafeInteger(product.priceVnd) || product.priceVnd <= 0 || product.currency !== 'VND') {
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

  // ── THE QUOTE: đồng → dollars, issued once, right here ───────────────────────────
  // Nothing above this line has touched an FX rate, so a dormant or invalid checkout
  // never reaches the rate feed. FAIL CLOSED: no rate, an implausible rate or an
  // unusable price ⇒ null ⇒ 503, never a guessed conversion. 503 (not 4xx) because the
  // request is fine and the desk is temporarily unable to price it — retrying works.
  const quote = await quoteVisaUsd({ listingId: product.listingId, priceVnd: product.priceVnd })
  if (!quote) {
    console.error(`[visa/checkout] no FX quote for listing ${product.listingId} at ${product.priceVnd}₫`)
    return NextResponse.json({ error: 'fx_unavailable' }, { status: 503 })
  }

  // ── WHAT THE BUYER WAS SHOWN MUST BE WHAT THE BUYER IS CHARGED ───────────────────
  // The client echoes the quote it rendered. It is compared, never used: every refusal
  // below carries the NEW quote so the UI can say "the price updated, confirm again"
  // instead of this route silently capturing a different number than the one on screen.
  // Omitting the echo is allowed (an older client, a direct call) — the fresh quote is
  // then both shown and charged in the same response, which is the same guarantee.
  if (parsed.data.quote !== undefined) {
    const shown = parseVisaQuote(parsed.data.quote)
    if (!shown) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    // Expired, self-inconsistent, or a rate outside the plausible band ⇒ not a live quote.
    // Note this can NEVER cheapen the charge: a forged-but-consistent quote still has to
    // survive the drift comparison below, and the amount charged is the fresh one either
    // way. The distinct code exists so the UI can say "that price is stale" precisely.
    if (!isQuoteChargeable(shown, new Date())) {
      return NextResponse.json({ error: 'quote_expired', quote }, { status: 409 })
    }
    if (visaQuoteDrifted(shown, quote)) {
      return NextResponse.json({ error: 'quote_changed', quote }, { status: 409 })
    }
  }

  // ⚠️ THE LINE THAT DECIDES THE CHARGED AMOUNT. It reads exactly one thing: the quote
  // this request just issued from the admin's đồng price. Not the body, not the echo,
  // not a config, not a cached catalogue number.
  const amountCents = quote.amountUsdCents

  try {
    const session = parsed.data.provider === 'stripe'
      ? await stripeCreateCheckout({
        applicationId: id, userId, listingId: product.listingId,
        // currency is the CHARGE currency (USD), not the listing's (₫) — see
        // assertChargeableUsdCents. `quote` rides along as dispute evidence only.
        productTitle: product.title, amountCents, currency: 'USD', quote,
      })
      : await paypalCreateOrder({
        applicationId: id, listingId: product.listingId,
        productTitle: product.title, amountCents, currency: 'USD', quote,
      })

    const { error } = await db.from('visa_payments').insert({
      application_id: id,
      user_id: userId,
      provider: parsed.data.provider,
      provider_ref: session.ref,
      // The amount the provider was just asked for — the local truth markVisaPaidAndHandoff
      // makes the capture cover. It is the QUOTE, frozen at this click, so neither a
      // mid-checkout price edit by the admin nor an FX move can raise or lower this
      // session: the buyer pays the number they confirmed or the capture is rejected.
      amount_cents: amountCents,
      // ⚠️ The CHARGE currency, which is what this column has always meant (the capture
      // comparison in markVisaPaidAndHandoff is against a provider's USD). The listing's
      // đồng price is recorded beside it in the audit event below — do not write '₫' here.
      currency: 'USD',
      status: 'created',
      consent_snapshot_hash: snapshotHash,
      consent_at: new Date().toISOString(),
      // The exact consent versions ACCEPTED at this click — the handoff stamps these,
      // never whatever constants are current at payment time (review #8).
      consent_declaration_version: VISA_DECLARATION_VERSION,
      consent_authorization_version: VISA_AUTHORIZATION_VERSION,
    })
    if (error) throw new Error(`visa_payment_insert_failed:${error.message}`)

    // ── Dispute evidence: WHICH product, at WHAT price, at WHAT RATE, under WHICH ref ─
    //
    // The four numbers a currency-converted charge is defended with — priceVnd (the
    // admin's authoritative figure), amountUsdCents (what was captured), vndPerUsd (the
    // rate that connects them) and quotedAt (when that rate was read) — are written HERE,
    // with the payment's provider reference, and NOWHERE ELSE in our datastore.
    //
    // Why it is safe: every one of them is a PUBLIC COMMERCIAL FACT. A listing price is on
    // the PDP, an FX rate is a published number, a timestamp and a provider reference are
    // already in the buyer's own return URL. None of it is applicant data, so the audit
    // log's exposure is exactly what it was — and in particular this is NOT the encrypted
    // payload and NOT any PII column: recording a price must never become a reason to
    // decrypt, re-encrypt, or widen a passport row.
    //
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
      // The charge …
      amountCents,
      currency: 'USD',
      // … and the đồng price it is the converted face of, with the conversion itself.
      priceVnd: quote.priceVnd,
      listingCurrency: 'VND',
      amountUsdCents: quote.amountUsdCents,
      vndPerUsd: quote.vndPerUsd,
      quotedAt: quote.quotedAt,
      quoteExpiresAt: quote.expiresAt,
    })

    return NextResponse.json({
      url: session.url,
      provider: parsed.data.provider,
      // READ-BACK of the server's decision, never an input to it: this is the quote that
      // was charged, so the client renders these two numbers — not a locally converted
      // pair — on the confirmation. Same object shape the client echoes back next time.
      quote,
      listingId: product.listingId,
      priceVnd: quote.priceVnd,
      amountUsdCents: quote.amountUsdCents,
      currency: 'USD',
    })
  } catch (error) {
    console.error('[visa/checkout]', (error as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'checkout_failed' }, { status: 502 })
  }
}
