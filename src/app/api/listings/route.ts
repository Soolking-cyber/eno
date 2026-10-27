import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizePhone, containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord, isJobTextBlockCode, PublishBlockedError } from '@/lib/publish-guard'
import { isIdentityBlockCode, publishBlockedJson, PUBLISH_BLOCKED_STATUS } from '@/lib/compliance/publish-block-response'
import { consolidateSellerHandle } from '@/lib/handle'
import { getCurrentProfileId } from '@/lib/admin'
import { postingGate } from '@/lib/enforcement'
import { rateLimit } from '@/lib/ratelimit'
import { createListingCore } from '@/lib/core/listings'
import { RELEASED_CHARGE_MAX_ACTIVE } from '@/lib/released-charge-copy'
import { migrateLegacyCategoryParams, paysSalary, resolveListingType, TEACHER_PROFILE_REFUSAL } from '@/lib/taxonomy'
import { PROVIDER_LICENCE_REFUSAL } from '@/lib/provider-licence'
import { JOB_TEXT_REFUSAL } from '@/lib/job-listing'
import { idsFastPath } from './feed-query'
import { buildFeedPayload } from './feed-payload'
import { appReviewGate, isNativeAppUserAgent } from '@/lib/app-review-gates'
import { correctQuery } from '@/lib/spell-correct'
import { fold } from '@/lib/fold'
import { inferDistrictFromQuery } from '@/lib/district-query'
import { resolveSellerForPost } from './resolve-seller'
import { publishOutcome, recordPublishOutcome } from '@/lib/publish-funnel'
import { cutText } from '@/lib/feed-text'

export const dynamic = 'force-dynamic'

// ⚠️ WS6 — NOT MIGRATED (GET). The public browse/search feed: no auth, no rate limit, no request
// body — all four route() options empty, which is the pure-churn shape the migration declines.
// It is also Response-shaped on every path rather than object-shaped: the `fastPath` early
// return, the histogram branch and the feed branch each carry their own Cache-Control (the
// Cloudflare s-maxage tiers below are the point of this route being fast), so every branch would
// take the wrapper's Response escape hatch and the auto-JSON that is most of its value would
// never fire. Wrapping it would add an indirection and remove nothing.
export async function GET(req: NextRequest) {
  // A moved subcategory (hobbies-sports/books → books-stationery) is rewritten once here, so the feed
  // filters and the facet counts below read the same answer.
  const searchParams = migrateLegacyCategoryParams(req.nextUrl.searchParams)

  // Fast path: fetch a specific set of PUBLIC listings by id (used by /saved).
  const fastPath = await idsFastPath(searchParams)
  if (fastPath) return fastPath

  /**
   * ⚠️ App Store gate `app-ai-notice` (Guideline 5.1.2(i)): in either app, typed search words are never sent to Google —
   * the Vertex AI Search ranking (semantic-rank.ts) is skipped and the keyword path answers, so there is no permission to
   * ask for (src/lib/ai-consent.ts). The UA is the apps' own token (app-review-gates.ts). Gate off ⇒ false: unchanged.
   */
  const noAi = appReviewGate('app-ai-notice') && isNativeAppUserAgent(req.headers.get('user-agent'))
  let payload = await buildFeedPayload(searchParams, { noAi })
  /**
   * ⛔ A SEARCH THAT FINDS NOTHING IS ANSWERED FOR ITS LIKELY SPELLING — "iphnoe" found 0 while "iphone"
   * found 3,439 (production, 2026-09-29). Vertex was the typo-tolerant path and it is off in
   * production; src/lib/spell-correct.ts is the stand-in. ONLY on zero results (a query that finds
   * anything is never second-guessed), and never for a query that names a district (district-query.ts
   * owns those words, and "quan" must not be "corrected" into a product). The corrected set is served
   * only if it finds something, and the feed's `correctedQuery` says so — null on every other feed
   * response. Load-more pages repeat it deterministically; the zero they re-check is the memoized count.
   * ⛔ THE HISTOGRAM (`histogram=1`) IS NEVER CORRECTED HERE — the client asks it for the word the
   * feed answered (`correctedQuery`). Its zero is not the feed's zero: it drops priceMin/priceMax
   * (price-histogram.ts) and never takes the semantic path, so deciding from it let the slider
   * describe a different word than the grid (review, 2026-09-29: feed literal at 73 on the semantic
   * path, histogram "corrected" to 3,433). One decision, the feed's.
   * ⛔ OPT-IN: ONLY A REQUEST THAT SENDS `spell=1` IS CORRECTED. Another word's results are only honest
   * beside "Showing results for … · Search instead for …", and a client that cannot draw that line —
   * today's explorer, until its banner lands (W2), and any bundle cached from before it — must get
   * the literal zero rather than a silent swap (review, 2026-09-29). A client that draws the line
   * sends `spell=1` with the feed, and drops it for "Search instead for …".
   */
  let correctedQuery: string | null = null
  const rawQ = searchParams.get('q')?.trim()
  if (!payload.histogram && payload.body.total === 0 && rawQ && searchParams.get('spell') === '1' && !inferDistrictFromQuery(rawQ)) {
    const fixed = await correctQuery(rawQ)
    if (fixed && fixed !== fold(rawQ)) {
      const corrected = new URLSearchParams(searchParams)
      corrected.set('q', fixed)
      const retry = await buildFeedPayload(corrected, { noAi })
      if (retry.body.total > 0) {
        payload = retry
        correctedQuery = fixed
      }
    }
  }
  // The feed says whether it was corrected; the histogram's wire shape stays exactly the price panel's.
  const body = payload.histogram ? payload.body : { ...payload.body, correctedQuery }
  return NextResponse.json(body, { headers: { 'Cache-Control': payload.cacheControl } })
}

// Create a listing from the post wizard. No auth yet → identify the seller by
// phone (Chợ Tốt / Craigslist guest-post pattern). Manual verification is gone:
// listings PUBLISH INSTANTLY (verified=true) unless the account is Restricted
// (low trust) or has no photo — see the autoPublish gate below; abuse is handled
// reactively by the trust score + reporting.
// normalizePhone is shared (src/lib/phone.ts) so the later verified-phone claim
// joins on the exact same canonical form. Image URLs validated via the shared,
// host-pinned isListingImageUrl() (our project's bucket only).

/**
 * ⚠️ THE FUNNEL COUNTER WRAPS THE HANDLER, it is not sprinkled through it.
 *
 * createListing below has eight exit points (rate limit, invalid input, contact-in-text,
 * banned words, unknown category, the seller resolver, the enforcement gate,
 * PublishBlockedError) plus success. Recording at each one guarantees that the day someone
 * adds a ninth and forgets, the funnel silently under-reports — and a missing branch reads
 * as zero, which is worse than no funnel at all. Reading the outcome off the response the
 * handler already produced makes new branches self-instrumenting.
 *
 * The body is re-read from a CLONE: Response bodies are one-shot streams, and consuming the
 * real one here would send an empty body to the client. The clone is cheap (these payloads
 * are small JSON) and the whole thing is wrapped so instrumentation can never break a
 * publish — on any failure to classify, we simply do not count.
 *
 * ⚠️ WS6 — NOT MIGRATED (POST). Three reasons, and the first is structural:
 *
 * · THE LIMITER'S BUCKET *AND* ITS strict FLAG ARE COMPUTED FROM THE CALLER. createListing picks
 *   `listing-create-user`, keyed by profile id and fail-OPEN, for a signed-in seller, or
 *   `listing-create`, keyed by IP and fail-CLOSED, for a guest — two buckets, two strictness
 *   settings, chosen after getCurrentProfileId(). route()'s `rateLimit:` is one static bucket
 *   with one strictness, applied before anything is known. No auth mode fits either: guest
 *   posting by phone IS this endpoint's contract, so 'userId'/'profile' would 401 the wizard's
 *   main path and 'public' resolves nobody, which is what makes the two-bucket choice possible.
 * · route()'s CATCH WOULD SWALLOW THE 'exception' FUNNEL BRANCH. The wrapper above counts a throw
 *   and rethrows it untouched; route() converts the same throw into {"error":"internal_error"}
 *   500, so that branch would silently stop being recorded and start counting as an ordinary
 *   failure — a change to the very numbers this instrumentation exists to produce.
 * · TWO RESPONSE SHAPES ARE NOT `{error: ApiErrorCode}`. The banned-word 400 and the
 *   PublishBlockedError reply both carry a second `detail` field (the duplicate's listing id is
 *   read by the client), and the catch-all 500 is {"error":"Failed to create listing"} — an
 *   English sentence, not a code. apiFail() can express neither, and rewording the 500 to
 *   `internal_error` would be exactly the silent wire change this migration forbids.
 *
 * ✅ SEPARATE FINDING, NOW FIXED (it was deferred here only because it is a shared-file edit and
 * other WS6 clusters were in flight): PublishBlockedError re-emits `e.code`, and 9 of the 12
 * PublishBlockCodes in src/lib/publish-guard.ts:40 were ABSENT from the ApiErrorCode union —
 * identity_unverified, identity_pending, identity_expired, identity_suspended, photo_required,
 * photos_min, contact_in_name, duplicate_listing, location_required. The harvest that built
 * src/lib/api/errors.ts greps for string LITERALS, so a code emitted through a variable was
 * invisible to it, and apiErrorCode() answered null for the most common refusal in the product.
 * All nine are in the union now, `errors.test.ts` derives them from the PublishBlockCode
 * declaration rather than exempting them, and `PublishBlockCode extends ApiErrorCode` is asserted
 * at COMPILE time in errors.ts — so a thirteenth publish code cannot repeat this.
 */
export async function POST(req: NextRequest) {
  let res: NextResponse
  try {
    res = await createListing(req)
  } catch (e) {
    // ⚠️ A THROW MUST STILL COUNT. createListing's own try/catch does not cover everything —
    // the rate-limit call and getCurrentProfileId() run BEFORE it opens — so an exception can
    // escape, and an uncounted branch reads as zero on the funnel page, which is worse than no
    // page at all. Count it, then rethrow untouched so Next's error handling is unchanged.
    void recordPublishOutcome('exception')
    throw e
  }
  try {
    // res.clone() is an independent handle: the original body is untouched and reaches the
    // client whole. Only read on a failure — a 201's body carries the created listing and no
    // error code, so parsing it would be work for nothing.
    const body = res.status >= 200 && res.status < 300 ? null : await res.clone().json().catch(() => null)
    void recordPublishOutcome(publishOutcome(res.status, (body as { error?: unknown } | null)?.error))
  } catch {
    /* never let counting a publish affect the publish */
  }
  return res
}

async function createListing(req: NextRequest) {
  // ⛔ A SESSION IS REQUIRED TO CREATE A LISTING (security review 2026-10-22, item 10). This used to
  // accept anonymous posts (resolve-by-phone): a scripted POST with no cookie could publish instantly
  // — and, by sending a guest storefront's advertised phone as contactPhone, post under that
  // storefront's name, rating and reviews (resolve-seller.ts's guest branch), with the 15/hour IP cap
  // sidesteppable by rotating IPv6 addresses. The web wizard already requires sign-in; platform imports
  // post through /api/v1 and MCP (their own key-authed routes), never here. So the human listing route
  // now refuses without a session. createListingCore keeps its guestCreate path for those API-key
  // callers; it is simply never reached from here anymore.
  const posterId = await getCurrentProfileId()
  if (!posterId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  // Each create can fan out paid translation + social syndication → throttle to cap floods. A
  // signed-in poster is accountable, so fail OPEN on a Redis blip (don't block posting), matching the
  // upload routes.
  const rl = await rateLimit('listing-create-user', posterId, 15, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  try {
    const body = await req.json()
    const categorySlug = String(body.categorySlug || '').trim()
    const title = cutText(String(body.title || '').trim(), 140)
    const contactPhone = normalizePhone(String(body.contactPhone || ''))
    const contactName = cutText(String(body.contactName || '').trim(), 80)
    // ⛔ A JOB IS PAID A SALARY (taxonomy.ts paysSalary): the wizard sends no price for one, and
    // createListingCore derives it from the salary — so there is no price here to require.
    const price = paysSalary(resolveListingType(categorySlug, body.listingType)) ? 0 : Number(body.price)

    if (!categorySlug || title.length < 3 || contactPhone.replace(/\D/g, '').length < 9 || !Number.isFinite(price) || price < 0 || price > 1e12) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }

    // Keep contact info + banned content OFF the public listing — buyers reach sellers
    // in-app. Reject any phone number / email / link / social handle / street address, or
    // a banned word, up-front (before resolving a seller) so the poster can fix it. The
    // Restricted-account gate + photo check run in createListingCore (need the seller).
    for (const tx of [title, String(body.description || ''), contactName]) {
      if (containsPhoneNumber(tx) || containsContactInfo(tx)) {
        return NextResponse.json({ error: 'contact_in_text' }, { status: 400 })
      }
      const banned = findBannedWord(tx)
      if (banned) return NextResponse.json({ error: 'banned_words', detail: banned }, { status: 400 })
    }

    const category = await db.category.findUnique({ where: { slug: categorySlug } })
    if (!category) return NextResponse.json({ error: 'unknown_category' }, { status: 400 })

    // Resolve the storefront (signed-in → owned Seller; guest → by phone) — the
    // one-number-one-account claim rules live in resolveSellerForPost.
    const meId = await getCurrentProfileId()
    const seller = await resolveSellerForPost(meId, contactPhone, contactName)
    if (seller instanceof NextResponse) return seller

    // ONE public handle for the (possibly just-created) storefront so it's shareable
    // as eno.vn/<name>. Frees any handle the owner's profile held (one per account).
    // Idempotent + best-effort. Guest storefronts (no ownerId) just get a shop handle.
    await consolidateSellerHandle(seller.id, seller.name, seller.ownerId)

    // Enforcement ladder + probation (trust Phase 2): a held/suspended account can't
    // post, and a brand-new account (<30d AND <3 transactions) is capped on active
    // listings. Server-side only — guests have no Profile (no enforcement state; the
    // Restricted trust gate still applies inside createListingCore). Pre-migration
    // the gate reads default to good_standing → pure no-op.
    if (meId) {
      const gate = await postingGate(meId, seller.id)
      if (gate) return NextResponse.json(gate, { status: 403 })
    }

    // Build + create + fire side-effects in the shared core (same code path the
    // future /api/v1 create will reuse). Seller + category are already resolved.
    // ⚖️ `guestCreate` is "no session", NOT "no owner": this route is the only one that can see a
    // signed-out poster, and it is the only caller that may set it. A signed-in poster always lands on
    // a storefront they own (resolveSellerForPost), so `!meId` and an ownerless storefront coincide
    // here — the flag just says which of the two the identity gate is actually keyed on.
    const result = await createListingCore({ seller, guestCreate: !meId, category, title, price, body, headers: req.headers })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    // Restricted account / no photo / banned / contact-in-text / duplicate → a clear,
    // fixable code (403 for the trust gate since it isn't fixable now; 409 for a
    // duplicate of a live listing — detail carries the existing listing's id; 400 rest).
    if (e instanceof PublishBlockedError) {
      // ⚖️ The identity (legal) blocks answer 403 with the structured refusal — verify link, legal
      // citation, draft-kept flag — and keep `error: <code>` so every existing client still branches.
      if (isIdentityBlockCode(e.code)) return NextResponse.json(publishBlockedJson(e.code), { status: PUBLISH_BLOCKED_STATUS })
      // The released-scam-charge cap (released-charge-gate.ts) is an ACCOUNT limit like the trust
      // gate — not fixable in the form — so it answers 403 as well, with the limit.
      if (e.code === 'released_charge_listing_cap') {
        return NextResponse.json({ error: e.code, limit: RELEASED_CHARGE_MAX_ACTIVE }, { status: 403 })
      }
      return NextResponse.json(
        // A teacher's job-seeker post (taxonomy.ts TEACHER_SEEKING_POST, 2026-10-12) carries its bilingual sentence for the
        // native apps, whose post schema (/api/categories) offers the pair — the web wizard words it itself (tr).
        // So does an e-Visa / Legal & permits post without the provider's registered name and licence number, or with one
        // that cannot be accepted (owner, 2026-10-14; `detail` '<field>:<reason>'): the current native builds still offer
        // both aisles but send no values, so they get "post from the website" rather than a bare code.
        // And a hiring post the job-text screen refused (job-listing.ts jobTextProblem, 2026-10-18): the sentence of its rule —
        // `detail` '<field>:<snippet>' names the field and the words to take out.
        {
          error: e.code,
          detail: e.detail,
          ...(e.code === 'teacher_profile_instead' ? { message: TEACHER_PROFILE_REFUSAL } : {}),
          ...(e.code === 'provider_licence_required' || e.code === 'provider_licence_invalid' ? { message: PROVIDER_LICENCE_REFUSAL } : {}),
          ...(isJobTextBlockCode(e.code) ? { message: JOB_TEXT_REFUSAL[e.code] } : {}),
        },
        { status: e.code === 'account_restricted' ? 403 : e.code === 'duplicate_listing' ? 409 : 400 },
      )
    }
    console.error('[POST /api/listings]', e)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }
}
