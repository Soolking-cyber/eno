import 'server-only'
import { after } from 'next/server'
import { clearTombstones, writeTombstones } from '@/lib/core/storage-tombstones'
import { purgeStorageObjects } from '@/lib/core/storage-purge'
import { TEACHER_CVS_BUCKET, TEACHER_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { db } from '@/lib/db'
import { reindexListing, removeFromIndex } from '@/lib/listing-index'
import { recordEngagement } from '@/lib/trust'
import { canBump } from '@/lib/stale'
import { containsPhoneNumber } from '@/lib/phone'
import { buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { isListingImageUrl } from '@/lib/listing-image'
import { isCanonicalVideoUrl, removeListingVideoByUrl } from '@/lib/core/media'

/** Evict a listing video's storage object ONLY when no listing references it anymore.
 *  URLs are client-suppliable (the wizard round-trips them), so URL↔listing is not 1:1 —
 *  an unconditional delete would let a throwaway listing pointed at someone else's public
 *  video URL destroy that seller's clip. Best-effort inside after(); GC is the backstop. */
async function removeVideoIfOrphaned(url: string): Promise<void> {
  try {
    const stillReferenced = await db.listing.count({ where: { video: url } })
    if (stillReferenced === 0) await removeListingVideoByUrl(url)
  } catch (e) {
    console.error('[listings] video eviction check', e)
  }
}
import { categoryHasBrand, resolveBrand, bumpBrandCount, enrichBrandLogoIfMissing } from '@/lib/brand'
import { facetsFor, rangeFacetsFor, subcategoriesFor, typesFor, suggestSubcategory, listingMoneyFor, rentalPeriodOf, isPostableSubcategory, isPostableCategory, isPartnerOnlySubcategory, partnerOnlyFallback, paysSalary, salaryPriceFor, salaryMFromPrice, resolveListingType, withoutDisallowedVisaAttrs } from '@/lib/taxonomy'
import { IS_MARKETPLACE } from '@/lib/edition'
import { syndicateListingIfPublic } from '@/lib/syndicate'
import { sendMetaCapiEvent, metaUserDataFromHeaders } from '@/lib/meta-capi'
import { dispatchListingEvent } from '@/lib/webhooks'
import { browseRankScore, recomputeRankScoreForListing } from '@/lib/ranking'
import { identityGateEnforced } from '@/lib/compliance/account-state'
import { assertSellerMayPublish, sellerPublishDecision, type SellerPublishDecision } from '@/lib/compliance/seller-publish-gate'
import { assertPublishable, assertCleanTexts, assertCleanContactName, assertEnoughAngles, PublishBlockedError, type IdentityBlockCode, type PublishBlockCode } from '@/lib/publish-guard'
import { findDuplicateListing } from '@/lib/duplicate-guard'
import { moderateListingById } from '@/lib/ai-moderation'
import { indexAndCheckProvenance } from '@/lib/image-provenance'
import { priceChangeEffects } from '@/lib/price-drop'
import { activateUrgentGate, urgentQuotaFree, URGENT } from '@/lib/urgent'
import { logError } from '@/lib/log'
import { blocksPosting, normalizeEnforcementState } from '@/lib/enforcement-machine'
import { releasedChargeGate } from '@/lib/released-charge-gate'
import type { DeleteHoldReason } from '@/lib/delete-hold-copy'
import { LISTING_REMOVED, NOT_REMOVED } from '@/lib/listing-removed'
import { tombstoneListingsTx } from '@/lib/core/listing-tombstone'
import { POSTED_FACET_KEY } from '@/lib/posted-filter'
import { cutText } from '@/lib/feed-text'
import { REACTIVATION_SALE_RESET, type MarkSoldPatch } from '@/lib/trade-loop'
import { withdrawSaleQuestions } from '@/lib/core/sale-withdraw'
import type { Prisma } from '@/generated/prisma/client'

// ── Listing write-path "cores" (Phase 0 of the Partner API) ──────────────────────
// These hold the business logic for mutating a listing, decoupled from HOW the caller
// was authenticated. Each core takes EXPLICIT, already-authorized identifiers (a
// listingId the caller is proven to own, a profileId/sellerId) and NEVER reads the
// session implicitly — so the exact same logic serves the cookie-authed session routes
// AND a future API-key-authed /api/v1 (no second code path to drift). The caller does
// auth → core → serialize/respond. RLS is bypassed, so ownership MUST be checked by the
// caller (e.g. checkListingOwner) BEFORE invoking these. See docs/PARTNER-API-ROADMAP.md.

export const LISTING_STATUSES = new Set(['active', 'sold', 'hidden'])

// ── Shared create/update field normalizers ───────────────────────────────────────
// createListingCore and updateListingCore must persist IDENTICAL shapes for the same
// input, so the per-field normalization lives here once. Where the two paths GENUINELY
// differ (update's sparse-body semantics — undefined = untouched, null/'' = clear —
// vs create's read-everything coercion), the difference is an explicit parameter or a
// caller-mapped action, never a silent fork. Pure functions; exported for tests.

/** Whitelisted, stringly-typed attribute facets (taxonomy values) → the persisted
 *  JSON string, or null when nothing survives. Keys must be simple identifiers
 *  (/^[a-z0-9_]+$/i); values are non-empty strings capped at 40 chars. Non-object /
 *  array / falsy input → null. */
/**
 * DERIVED facets — computed from what the app already knows, never asked of the poster.
 *
 * Today that is `providerType` (individual | business), which Profile.accountType has
 * recorded since onboarding. Asking for it again was worse than redundant: the two answers
 * could DISAGREE, leaving a registered business publishing as an individual — which is a
 * trust signal buyers read. Deriving it makes the contradiction unrepresentable.
 *
 * Scoped to categories that actually declare the facet (Services today), so an unrelated
 * listing does not accumulate a key its taxonomy never mentions. `sanitizeAttributes` has
 * already run, so the incoming JSON is whitelisted and length-clamped; the derived value is
 * applied AFTER it, and therefore always wins over anything a client tried to send.
 */
async function withDerivedAttributes(
  attributes: string | null,
  sellerId: string,
  categorySlug: string,
  subcategorySlug: string | null,
): Promise<string | null> {
  const derived = facetsFor(categorySlug, subcategorySlug).filter((f) => f.derived)
  if (!derived.length) return attributes
  const parsed: Record<string, string> = attributes ? JSON.parse(attributes) : {}
  if (derived.some((f) => f.key === 'providerType')) {
    const seller = await db.seller.findUnique({
      where: { id: sellerId },
      select: { owner: { select: { accountType: true } } },
    })
    // Default individual: accountType is null until onboarding completes, and claiming to
    // be a business is the stronger claim — never assert it without the account saying so.
    parsed.providerType = seller?.owner?.accountType === 'business' ? 'business' : 'individual'
  }
  return Object.keys(parsed).length ? JSON.stringify(parsed) : null
}

export function sanitizeAttributes(raw: unknown): string | null {
  const clean: Record<string, string> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      // `posted` is a filter-only facet (src/lib/posted-filter.ts) that reads `postedAt`; a stored
      // copy would be dead state nothing reads, so it is never kept.
      if (k === POSTED_FACET_KEY) continue
      if (typeof v === 'string' && v && /^[a-z0-9_]+$/i.test(k)) clean[k] = cutText(v, 40)
    }
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : null
}

/** Structured numeric specs (range facets) → dedicated-column writes, each clamped to
 *  the category's declared range. Engine keeps one decimal (litres); year/mileage etc.
 *  round to integers. `sparse` selects the body contract:
 *  - true (update): an omitted key is untouched (not emitted); explicit null/'' clears
 *    the spec (emits null); non-numeric junk is ignored.
 *  - false (create): every declared column is read with plain Number() coercion (an
 *    absent key → NaN → skipped; null/'' coerce to 0 and clamp to the range minimum —
 *    the create path's long-standing behavior, kept as-is). */
export function clampRangeFacets(
  categorySlug: string,
  subcategorySlug: string | null,
  body: Record<string, unknown>,
  opts: { sparse: boolean },
): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const f of rangeFacetsFor(categorySlug, subcategorySlug)) {
    const col = f.range.column
    if (opts.sparse) {
      if (body[col] === undefined) continue
      if (body[col] === null || body[col] === '') { out[col] = null; continue }
    }
    const raw = Number(body[col])
    if (!Number.isFinite(raw)) continue
    const clamped = Math.min(Math.max(raw, f.range.min), f.range.max)
    out[col] = col === 'engineL' ? Math.round(clamped * 10) / 10 : Math.round(clamped)
  }
  return out
}

/** Precise geo-pin coordinate ("use my current location") → the number when it's a
 *  plausible latitude (limit 90) / longitude (limit 180), else null. */
export function parseGeoCoord(raw: unknown, limit: 90 | 180): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n >= -limit && n <= limit ? n : null
}

/** Canonicalize the optional single-video field. Only a CANONICAL first-party URL (our
 *  bucket + a minted object name) 'set's it; explicit null/'' is a 'clear'; anything
 *  else — foreign hosts, arbitrary bucket paths, malformed suffixes — is 'ignore'd and
 *  never persisted (treating a malformed url as an explicit clear once let a partner-API
 *  typo silently delete + evict a live clip — audit P2). Callers map 'ignore' per their
 *  body contract: create treats it as "no video" (null); update leaves the stored clip
 *  untouched. */
export function parseVideoField(raw: unknown): { action: 'set'; url: string } | { action: 'clear' } | { action: 'ignore' } {
  if (raw === null || raw === '') return { action: 'clear' }
  if (isCanonicalVideoUrl(raw)) return { action: 'set', url: raw }
  return { action: 'ignore' }
}

/**
 * Set the availability status of an OWNED listing: 'active' (live) / 'sold' / 'hidden'
 * (pulled from the public feed, kept in the dashboard). Re-activating also stamps an
 * availability confirmation. Purges the cached detail page + (re)indexes for AI search.
 */
export type SoldMeta = {
  channel?: string | null
  buyerProfileId?: string | null
  platform?: string | null
  /**
   * The trade loop's columns for this sale (POST /api/listings/[id]/sold, from validateMarkSold in
   * src/lib/trade-loop.ts) — written in the SAME UPDATE as the status, so a sold row never exists with
   * a buyer named and the question to them half-recorded.
   */
  sale?: Pick<MarkSoldPatch, 'salePrice' | 'saleConfirmedAt' | 'saleDeclinedAt' | 'saleBuyerHistory' | 'saleConfirmPromptedAt'>
  /**
   * A COMPARE-AND-SWAP on the facts the caller decided on: ANDed into the UPDATE's WHERE, so the write
   * lands only while the row still holds them. Zero rows answers `not_found` (the same as a tombstone);
   * the caller re-reads to tell the two apart and decides again. It is what makes a double tap ask a
   * buyer ONCE, and what stops a mark-sold racing the buyer's own answer from erasing it.
   */
  expect?: Prisma.ListingWhereInput
}

/**
 * Every code `setStatusCore` can put on the wire. Named for the same reason as the union below.
 * The identity codes are reachable only while IDENTITY_GATE_ENFORCED is on (see identityGateForRevive).
 * `account_held` / `account_suspended` are the enforcement refusal (enforcementBlockForRevive) — the
 * same two codes, and the same 403, that postingGate answers a held or suspended poster with.
 * `released_charge_listing_cap` is the released-scam-charge cap (src/lib/released-charge-gate.ts): a
 * relist that would take the storefront past its active-listing limit while a released charge stands.
 * ⚠️ Spelled out as literals, not as `EnforcementBlockCode`: src/lib/api/errors.test.ts harvests this
 * union's string LITERALS to decide what is on the wire, and a named alias would be invisible to it.
 */
export type ListingStatusErrorCode = 'invalid_status' | 'not_found' | 'account_held' | 'account_suspended' | 'released_charge_listing_cap' | IdentityBlockCode

/** The enforcement refusal a revive or a confirm gets while the storefront owner is held or suspended. */
export type EnforcementBlockCode = 'account_held' | 'account_suspended'

/**
 * ⛔ THE HOLD LEAK (2026-09-24, owner-approved). A hold PULLS the seller's live listings (verified=false,
 * recorded so a lift restores exactly those) — but only rows that were ACTIVE at that moment. Their
 * sold and hidden rows keep verified=true, so relisting one (sold/hidden → active), or confirming it
 * "still available" (which re-activates), put it straight back on the public feed while the account
 * was held: a scam-held seller walked their stock back out one listing at a time. Every seller path
 * — the dashboard, the partner API, MCP, the catalogue sync — reaches the status through
 * setStatusCore or confirmCore, so this check lives here and nowhere else.
 *
 * `state` is the STOREFRONT OWNER's Profile.enforcementState (the person the listing is published
 * under, as with the identity gate) — not the caller's. An ownerless storefront (a platform import)
 * has no enforcement state and is never refused. Null = the move may go ahead.
 */
function enforcementBlockForRevive(state: unknown): EnforcementBlockCode | null {
  const s = normalizeEnforcementState(state)
  if (!blocksPosting(s)) return null
  return s === 'suspended' ? 'account_suspended' : 'account_held'
}

/**
 * The seller identity gate for a SELLER-INITIATED revive — a listing moving from sold/hidden back to
 * active (setStatusCore, confirmCore). Returns null when the move may go ahead.
 *
 * ⚠️ ONLY A TRANSITION INTO ACTIVE IS GATED, NOT EVERY WRITE OF 'active'. A listing that is already
 * live stays live: the gate governs entering public state, it does not take down what an unverified
 * seller published before their deadline (that is a separate, deliberate decision nobody has made).
 * This matters most for the partner sync, which re-sends `status: 'active'` for every row on every
 * run — refusing those would fail whole catalogues over listings that are not changing state.
 *
 * ⛔ GATE OFF → RETURNS BEFORE ANY READ, so both callers behave exactly as they did before the gate.
 * `decision` lets a batch caller (the sync) resolve the owner once and pass it in.
 */
async function identityGateForRevive(
  listingId: string,
  opts: { currentStatus?: string; ownerId?: string | null; decision?: SellerPublishDecision },
): Promise<IdentityBlockCode | null> {
  if (!identityGateEnforced()) return null
  let { currentStatus, ownerId } = opts
  if (currentStatus === undefined || (ownerId === undefined && !opts.decision)) {
    const row = await db.listing.findUnique({ where: { id: listingId }, select: { status: true, seller: { select: { ownerId: true } } } })
    if (!row) return null // the write below answers the missing row the way it always has
    currentStatus ??= row.status
    ownerId ??= row.seller.ownerId
  }
  if (currentStatus === 'active') return null
  const d = opts.decision ?? await sellerPublishDecision({ ownerId: ownerId ?? null })
  return d.ok ? null : d.code
}

export async function setStatusCore(
  listingId: string,
  status: string,
  soldMeta?: SoldMeta,
  opts?: { publishDecision?: SellerPublishDecision },
): Promise<{ ok: true; status: string } | { ok: false; code: number; error: ListingStatusErrorCode }> {
  if (!LISTING_STATUSES.has(status)) return { ok: false, code: 400, error: 'invalid_status' }
  let listingType: string | null | undefined
  // The status a relist READ — the write below is conditional on it (see `where`).
  let readStatus: string | null = null
  // Only 'active' can publish; sold/hidden are never gated — taking a listing DOWN is always allowed,
  // held or not. Both refusals below apply only to a TRANSITION into active (sold/hidden → active): a
  // row already active stays where it is (a held seller's active rows are the ones the hold pulled).
  if (status === 'active') {
    // ONE read serves both gates: the row's status and its storefront owner's enforcement state (and
    // the owner id, which the identity gate would otherwise read a second time).
    const row = await db.listing.findUnique({
      where: { id: listingId },
      select: { status: true, sellerId: true, listingType: true, seller: { select: { ownerId: true, owner: { select: { enforcementState: true } } } } },
    })
    listingType = row?.listingType
    readStatus = row?.status ?? null
    // ⛔ A TOMBSTONE IS NOT RELISTABLE (src/lib/listing-removed.ts) — not by its seller, not by a sync.
    if (row?.status === LISTING_REMOVED) return { ok: false, code: 404, error: 'not_found' }
    if (row && row.status !== 'active') {
      // ⛔ The hold leak (enforcementBlockForRevive) — checked FIRST: a held seller is refused whatever
      // the identity gate would say, and the refusal names the hold rather than a verification step.
      const held = enforcementBlockForRevive(row.seller.owner?.enforcementState)
      if (held) return { ok: false, code: 403, error: held }
      // Seller identity gate (NĐ 248/2026): relisting is a seller act, so a refused owner is REFUSED,
      // not held.
      const blocked = await identityGateForRevive(listingId, { currentStatus: row.status, ownerId: row.seller.ownerId, decision: opts?.publishDecision })
      if (blocked) return { ok: false, code: 403, error: blocked }
      // The released-scam-charge cap (released-charge-gate.ts): a relist makes one more listing active.
      const cap = await releasedChargeGate(row.seller.ownerId, row.sellerId)
      if (cap && cap.remaining <= 0) return { ok: false, code: 403, error: 'released_charge_listing_cap' }
    }
  }
  // ⚠️ A RE-MARK OF A LISTING ALREADY SOLD IS NOT A NEW SALE (review of #26, 2026-09-23). Trust
  // times each sale by soldAt (falling back to updatedAt) to count "clean transactions AFTER a
  // scam", and POST /sold re-stamped soldAt on every call — so a seller under a scam hold could
  // re-mark five OLD sales and walk out of it in one minute. On sold→sold the sale time is kept:
  // the existing soldAt, else the updatedAt trust was already reading (legacy/unattributed rows),
  // and a generic re-send that changes nothing is not written at all (the write alone restamps
  // updatedAt). Relisting (→ active) clears soldAt, so a genuine resale still stamps a new time.
  const prior = status === 'sold' || status === 'hidden'
    ? await db.listing.findUnique({ where: { id: listingId }, select: { status: true, soldAt: true, updatedAt: true, listingType: true } })
    : null
  if (prior) listingType = prior.listingType
  if (prior?.status === LISTING_REMOVED) return { ok: false, code: 404, error: 'not_found' }
  // A person is never "sold": a teacher listing can only be shown or hidden (dashboard, API, MCP alike).
  if (status === 'sold' && listingType === TEACHER_LISTING_TYPE) return { ok: false, code: 400, error: 'invalid_status' }
  const wasSold = prior?.status === 'sold' ? prior : null
  if (status === 'sold' && wasSold && soldMeta === undefined) {
    // Nothing to write — but a re-send is also how a caller repairs a sold row whose earlier purge
    // or search sync failed, so those still run.
    revalidatePublicPath(`/listings/${listingId}`)
    after(() => reindexListing(listingId))
    return { ok: true, status }
  }
  // Sale attribution: stamp it when a listing is marked sold; CLEAR it on reactivate
  // so a resold-then-relisted item never carries a stale buyer/channel.
  const saleData =
    status === 'sold'
      ? soldMeta === undefined
        // Generic sold (partner sync, /status, MCP, the daily-review quick tick-off):
        // the caller isn't attributing, so DON'T touch the sold* attribution — a
        // re-sync must never erase attribution captured via the native Mark-sold sheet.
        // ⚠️ BUT A TRANSITION INTO SOLD STILL STAMPS THE SALE TIME (a re-send on a sold row
        // returned above). Left null, trust timed the sale by updatedAt, which any later write
        // to the row moves — the #26 bypass through another door. An earlier sale's soldAt
        // (sold → hidden → sold) is kept: it is the same sale.
        ? { soldAt: prior?.soldAt ?? new Date() }
        : {
            // sold → hidden → sold is the SAME sale: hiding keeps soldAt, so re-marking it must not
            // mint a fresh "sale after the event" either (only relisting → active clears it).
            soldAt: wasSold ? (wasSold.soldAt ?? wasSold.updatedAt) : (prior?.soldAt ?? new Date()),
            soldChannel: soldMeta.channel === 'external' ? 'external' : soldMeta.buyerProfileId ? 'eno' : null,
            soldToProfileId: soldMeta.channel === 'external' ? null : (soldMeta.buyerProfileId ?? null),
            soldPlatform: soldMeta.channel === 'external' ? (soldMeta.platform ?? null) : null,
            // The trade loop's half (the agreed price, the buyer's question) — the attributing route's.
            ...(soldMeta.sale ?? {}),
          }
      // ⛔ A RELIST CLEARS THE WHOLE SALE, `sale*` AS WELL AS `sold*` (src/lib/trade-loop.ts,
      // REACTIVATION_SALE_RESET): a relisted item is a new sale, and a stale salePrice, confirmation or
      // pending question must not ride into it.
      : status === 'active'
        ? { ...REACTIVATION_SALE_RESET }
        // Hiding a sold row with no soldAt (every sale before generic sold stamped one) FREEZES its
        // sale time first: the write restamps updatedAt, the only time trust had for it, and the
        // listing re-marked sold later would otherwise count as a brand-new sale.
        : status === 'hidden' && wasSold && !wasSold.soldAt
          ? { soldAt: wasSold.updatedAt }
          : {}
  /**
   * ⛔ THE WRITE ITSELF REFUSES A TOMBSTONE, NOT ONLY THE READ ABOVE (review, 2026-10-01). The status
   * checks above read the row, and a removal (a moderator, the admin console, the seller's own delete
   * in another tab) can commit between that read and this write — an unconditional update by id would
   * then turn the 'removed' tombstone back into 'hidden'/'sold'/'active', i.e. un-remove it. So the
   * status guard is IN the UPDATE's WHERE (one statement: `… WHERE id = $1 AND status <> 'removed'`)
   * and zero rows is answered exactly as the read path answers a tombstone or a missing row: 404.
   */
  /**
   * ⛔ A RELIST IS CONDITIONAL ON THE STATUS IT READ (commit gate, 2026-10-05) — `equals` beside the
   * tombstone guard, one filter. Every relist clears the whole sale (REACTIVATION_SALE_RESET), so an
   * unconditional write would also erase a sale that committed AFTER the read: a listing the seller just
   * marked sold in another tab — buyer named, question sent — silently back on sale holding nothing. Now
   * that write misses and answers 404 like any other race; and "the row was sold or hidden" — the one
   * fact the question withdrawal below keys on — is exact rather than a guess.
   */
  const relistGuard = status === 'active' && readStatus ? { status: { not: LISTING_REMOVED, equals: readStatus } } : NOT_REMOVED
  const { count } = await db.listing.updateMany({
    // `soldMeta.expect`: the attributing route's compare-and-swap (see SoldMeta) — AND-composed, so it can
    // never replace the tombstone guard beside it.
    where: soldMeta?.expect ? { AND: [{ id: listingId, ...NOT_REMOVED }, soldMeta.expect] } : { id: listingId, ...relistGuard },
    // ⚠️ marketPosition is cleared on REACTIVATION for the same reason the edit path clears it on a
    // price change: it is the denormalized "Good price / Gia tot" verdict, the nightly cron only
    // recomputes rows with status='active', and a hidden/sold row therefore keeps a FROZEN verdict.
    // Without this, a listing hidden for a month comes back wearing a badge derived from a band
    // that has since moved. No badge until the cron re-derives one is the correct fail-safe.
    data: { status, ...(status === 'active' ? { availabilityConfirmedAt: new Date(), marketPosition: null } : {}), ...saleData },
  })
  if (count === 0) return { ok: false, code: 404, error: 'not_found' }
  // A REAL reactivation (sold/hidden → active) asks nobody any more. Not on an active → active re-send — the
  // partner sync's every-row 'active' — where the guard above proves there was nothing to clear.
  if (status === 'active' && readStatus && readStatus !== 'active') after(() => withdrawSaleQuestions([listingId]))
  revalidatePublicPath(`/listings/${listingId}`) // sold/hidden must drop from the cached page (it 404s non-active)
  after(() => reindexListing(listingId)) // active → (re)index for AI search; sold/hidden → remove
  if (status === 'active') after(() => recomputeRankScoreForListing(listingId)) // re-decay on re-activation
  after(() => dispatchListingEvent('listing.status_changed', listingId, undefined, { status })) // notify the shop's partner webhooks
  // ⛔ A teacher's listing IS their profile (2026-09-30): a hide/relist from the dashboard keeps the
  // TeacherProfile in step, or /teachers/edit would say "live" for a hidden card (and vice versa).
  if (listingType === TEACHER_LISTING_TYPE && status !== 'sold') {
    await db.teacherProfile.updateMany({ where: { listingId, status: { in: ['live', 'hidden'] } }, data: { status: status === 'active' ? 'live' : 'hidden' } })
  }
  return { ok: true, status }
}

/**
 * "Still available?" confirm — the Carousell-style bump. Marks the listing active,
 * stamps availabilityConfirmedAt, and (if outside the bump cooldown, per canBump)
 * refreshes feed recency (postedAt). A confirm inside the cooldown still records
 * availability (stops the reminder) but does NOT re-bump. `profileId` is the owner —
 * the day's activity earns a (daily-capped) trust reward. Intentionally does NOT
 * revalidate the cached page (recency surfaces live via the client feed).
 */
export async function confirmCore(listingId: string, profileId: string): Promise<{ ok: true; bumped: boolean } | { ok: false; code: 404; error: 'not_found' } | { ok: false; code: 403; error: IdentityBlockCode | EnforcementBlockCode | 'released_charge_listing_cap' }> {
  const now = new Date()
  const current = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      postedAt: true, status: true, sellerTrustScore: true, featured: true, views: true, contactCount: true, sellerId: true,
      // The storefront owner — for the enforcement refusal below and the identity gate (one read).
      seller: { select: { ownerId: true, owner: { select: { enforcementState: true } } } },
    },
  })
  // Typed 404 instead of letting the update's P2025 surface as a 500 — the row can
  // vanish between the route's ownership check and this call (delete race). A tombstone is "gone" too.
  if (!current || current.status === LISTING_REMOVED) return { ok: false, code: 404, error: 'not_found' }
  // ⛔ THE HOLD LEAK (enforcementBlockForRevive) — EVERY confirm while the owner is held or suspended,
  // not only a revive. A revive would republish a sold/hidden row the hold never pulled; an ordinary
  // confirm on a pulled row would bump its postedAt (so it came back at the top of the feed the day
  // the hold ended) and earn the daily engagement reward on a sanctioned account. Neither is "keeping
  // the listing fresh" — the listing is not for sale while the hold stands.
  const held = enforcementBlockForRevive(current.seller.owner?.enforcementState)
  if (held) return { ok: false, code: 403, error: held }
  // Confirm normally runs on an already-active listing. If it ever runs on a sold/hidden
  // one it's a REACTIVATION — which must clear any sale attribution and re-expose the
  // listing (reindex + revalidate + webhook), exactly like setStatusCore's active branch.
  // Otherwise the listing goes live still de-indexed, its page still 404ing, carrying a
  // stale buyer/channel.
  const wasInactive = current.status !== 'active'
  // Seller identity gate — ONLY when this confirm would REVIVE a sold/hidden listing (owner,
  // 2026-09-23). The ordinary confirm, on a listing that is already live, is untouched in every
  // state of the switch; with the switch off, the revive is untouched too (no read is made).
  // ⚠️ The decision is the STOREFRONT OWNER's (Seller.ownerId, read by the helper), not `profileId`:
  // the caller's profile is only the owner on the session route; on /api/v1 it is whichever profile
  // the key belongs to, and the gate is about the person the listing is published under.
  if (wasInactive) {
    const blocked = await identityGateForRevive(listingId, { currentStatus: current.status, ownerId: current.seller.ownerId })
    if (blocked) return { ok: false, code: 403, error: blocked }
    // The released-scam-charge cap, as on setStatusCore's relist: a revive makes one more listing
    // active. A confirm on a listing that is ALREADY active adds nothing and is never capped.
    const cap = await releasedChargeGate(current.seller.ownerId, current.sellerId)
    if (cap && cap.remaining <= 0) return { ok: false, code: 403, error: 'released_charge_listing_cap' }
  }
  const bump = canBump(current.postedAt, now.getTime())
  // ⛔ CONDITIONAL ON "NOT A TOMBSTONE" IN THE WRITE ITSELF (review, 2026-10-01) — a removal that
  // commits after the read above must not be revived to 'active' by this update (setStatusCore has
  // the same guard and says why). Zero rows — removed, or gone — is the read path's 404.
  // ⛔ …AND ON THE STATUS IT READ (commit gate, 2026-10-05): `wasInactive` is decided by that read, and a
  // mark-sold committing in between turned an ordinary confirm into a silent revive that kept the buyer,
  // the price and the open question on an ACTIVE listing. Now that write misses — the same 404 — so
  // `wasInactive` is exactly what the write did, and only a real revive clears the sale.
  const { count: confirmed } = await db.listing.updateMany({
    where: { id: listingId, status: { not: LISTING_REMOVED, equals: current.status } },
    data: {
      status: 'active',
      availabilityConfirmedAt: now,
      // Same reason as setStatusCore above — a reactivated listing must not carry a stale
      // market-position verdict the cron could not refresh while it was inactive.
      // A revive clears the WHOLE sale — `sale*` as well as `sold*` (REACTIVATION_SALE_RESET, trade-loop.ts).
      ...(wasInactive ? { ...REACTIVATION_SALE_RESET, marketPosition: null } : {}),
      // A bump resets recency (postedAt=now) → recompute rankScore at age 0 so the listing
      // jumps up immediately. No bump (within cooldown) leaves recency to the daily decay.
      ...(bump ? { postedAt: now, rankScore: browseRankScore({ sellerTrustScore: current.sellerTrustScore ?? 100, postedAt: now, featured: current.featured, views: current.views, contactCount: current.contactCount }) } : {}),
    },
  })
  if (confirmed === 0) return { ok: false, code: 404, error: 'not_found' }
  if (wasInactive) after(() => withdrawSaleQuestions([listingId])) // a revived sale asks nobody any more
  if (wasInactive) {
    revalidatePublicPath(`/listings/${listingId}`)
    after(() => reindexListing(listingId))
    after(() => dispatchListingEvent('listing.status_changed', listingId, undefined, { status: 'active' }))
  }
  after(() => recordEngagement(profileId).catch((e) => logError(e, { op: 'listings.recordEngagement' }))) // reward keeping listings fresh (daily-capped)
  return { ok: true, bumped: bump }
}

/**
 * Edit an OWNED listing (title/description/price/district/condition/images/subcategory/
 * intent/attributes/pin/brand/model/range specs). Category isn't editable. Re-runs the
 * create-time guards (phone-in-text block, image allowlist, taxonomy validation),
 * rebuilds searchText, re-publishes a held listing once it's eligible, and re-warms
 * translations + reindexes for AI search. `body` is the raw parsed JSON (sparse: only
 * present keys are touched). Returns a validation error code or { ok: true }.
 */
/**
 * Every code `updateListingCore` can put on the wire.
 *
 * ⚠️ THIS WAS `error: string`, AND THAT IS WHY FOUR LIVE CODES WENT MISSING FROM THE API CONTRACT.
 * `PATCH /api/listings/[id]` answers `{ error: r.error }`, so whatever this function returns IS an
 * API error code — but a bare `string` constrains nothing, so the compiler could not say which, and
 * `src/lib/api/errors.test.ts` harvests the ROUTES by text scan and never looks in here.
 * `title_too_short`, `no_phone_in_listing`, `invalid_price` and `urgent_quota` were therefore
 * returned to real sellers every day while `apiErrorCode()` reported them unknown.
 *
 * Naming the union fixes it at the strongest available layer: `src/lib/api/errors.ts` now asserts
 * `Exclude<ListingUpdateErrorCode, ApiErrorCode> extends never`, so adding a code here without
 * adding it there fails the BUILD rather than silently widening the wire. Same treatment as
 * `PublishBlockCode`, and for the same reason — both reach the wire through a variable.
 */
export type ListingUpdateErrorCode =
  | 'not_found'
  | 'title_too_short'
  | 'no_phone_in_listing'
  | 'invalid_price'
  | 'urgent_quota'
  // The catch re-emits a blocked publish verbatim (`error: e.code`), so the whole guard union is
  // reachable from here too.
  | PublishBlockCode

export async function updateListingCore(
  listingId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; code: number; error: ListingUpdateErrorCode }> {
  const current = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true, description: true, district: true, location: true, brandSlug: true, model: true, subcategorySlug: true, verified: true, images: true, video: true,
      // The market band's key fields besides brand/model/shelf — a change to any of them moves the
      // listing to a different band (or out of banding entirely), so its "Good price" verdict is
      // cleared below. listingType decides eligibility: only a sale is judged against sale prices.
      condition: true, year: true, listingType: true,
      // Read-only here (the wizard cannot edit them), but load-bearing: the folded search blob
      // below must keep BOTH languages or an edit deletes the Vietnamese half of the index.
      titleVi: true, descriptionVi: true,
      // Price-drop pipeline + urgent gate inputs
      price: true, createdAt: true, sellerId: true, previousPrice: true, priceDropAt: true, lowestNotifiedPrice: true, priceDropNotifiedAt: true, urgentUntil: true,
      // A job's pay: its price is re-derived from the salary on every edit, and it never takes offers.
      negotiable: true, salaryM: true, affiliateUrl: true, priceUnit: true,
      // A rent row's unit is re-stamped only when its `rentalPeriod` attribute changes (below).
      attributes: true,
      // officialPartner: an official partner's listing may carry e-visa product attributes (O-34, below).
      seller: { select: { trustTier: true, officialPartner: true } }, category: { select: { slug: true, name: true, nameVi: true } },
      status: true,
    },
  })
  // ⛔ A tombstone cannot be edited back to life (src/lib/listing-removed.ts).
  if (!current || current.status === LISTING_REMOVED) return { ok: false, code: 404, error: 'not_found' }
  // ⛔ A teacher profile is edited through the teacher form only; to every generic editor it does not exist.
  if (!isPostableCategory(current.category.slug)) return { ok: false, code: 404, error: 'not_found' }
  // ⛔ O-34b (owner, 2026-10-05): on eno.vn the visa slot (services/visa-legal) takes an OFFICIAL PARTNER's
  // listings only (taxonomy.ts PARTNER_ONLY_ON_MARKETPLACE). An edit that MOVES another seller's listing into
  // it is refused — first, before anything is read or written, so nothing is half-applied; the route adds the
  // bilingual PARTNER_ONLY_REFUSAL. A listing ALREADY in the slot (posted before the rule) edits as usual —
  // resending its own subcategory is not a move — and may move out.
  if (body.subcategorySlug !== undefined) {
    const sc = body.subcategorySlug ? String(body.subcategorySlug).trim() : null
    if (sc && sc !== current.subcategorySlug && isPartnerOnlySubcategory(current.category.slug, sc) && !current.seller.officialPartner) {
      return { ok: false, code: 400, error: 'subcategory_partner_only' }
    }
  }

  const data: Record<string, unknown> = {}

  // ⛔ THE INTENT THIS LISTING WILL HAVE AFTER THE EDIT (validated exactly as the listingType block
  // below writes it), decided up front because a JOB is edited by different money rules: its price
  // is derived from the salary (any `price` in the body is ignored), it never takes offers, and its
  // urgency does not flip it negotiable. See taxonomy.ts paysSalary.
  const reqType = body.listingType !== undefined ? String(body.listingType).trim() : undefined
  const nextType = reqType !== undefined && (typesFor(current.category.slug) as string[]).includes(reqType) ? reqType : current.listingType
  const salaryPaid = paysSalary(nextType)
  // ⛔ THE SALARY→PRICE RULE IS FOR JOBS POSTED ON eno, PAID PER MONTH. A LINKED job's salaryM is the FLOOR
  // of a range (its price stays 0 with the range in salaryText — job-listing.ts), and an imported HOURLY job
  // is priced per hour: deriving either would print "10.000.000 đ / month" for a 10–30 tr job, or wipe an
  // hourly rate (codex + opus, 2026-10-01). A switch INTO the job intent re-stamps the unit to monthly below.
  const derivesSalaryPrice = salaryPaid && current.affiliateUrl == null &&
    (nextType !== current.listingType || current.priceUnit === 'VND/month')

  const title = body.title !== undefined ? cutText(String(body.title).trim(), 140) : undefined
  const description = body.description !== undefined ? cutText(String(body.description).trim(), 5000) : undefined
  const contactName = body.contactName !== undefined ? cutText(String(body.contactName).trim(), 80) : undefined

  /**
   * ⛔ CLEAR THE *Vi COUNTERPART ONLY WHEN THE PRIMARY ACTUALLY CHANGED, NOT WHENEVER IT IS SENT.
   * The wizard ROUND-TRIPS EVERY FIELD (the `warm` array below says so in its own comment and
   * exists for the same reason), so `description !== undefined` is true on a price-only save that
   * resubmitted byte-identical text. Nulling on that discards a perfectly current Vietnamese
   * translation — and for an imported listing it discards the MERCHANT'S OWN wording, which no
   * cache can give back: the Translation table is keyed by sha1(source) and stores the hash, never
   * the source. Comparing against `current` makes an edit clear it and a no-op leave it alone.
   */
  /**
   * ⚠️ AND THE COMPARISON MUST NORMALISE BOTH SIDES, OR IT REPORTS A CHANGE THAT DID NOT HAPPEN.
   * The incoming value has been through `.trim().slice()` and a textarea round-trip (CRLF → LF);
   * the STORED value never was — scraped imports carry `\r\n` and trailing whitespace. Comparing
   * the normalised input against the raw column therefore reads "changed" on a price-only save of
   * untouched text, which nulls the *Vi column and destroys the merchant's original: precisely the
   * loss the comparison exists to prevent.
   *
   * ⛔ NORMALISE BOTH SIDES, AND APPLY THE LENGTH CAP TO BOTH. Two reviewers found the half-done
   * version, each from a different direction, and both are right:
   *   · A browser textarea submits `\r\n`, so normalising only the STORED side left every
   *     multi-line description comparing unequal — the spurious "changed" this guard exists to
   *     stop, now firing on the common case instead of the rare one.
   *   · `incoming` has already been `.slice()`d to the column cap while the stored value has not,
   *     so any row longer than the cap can never compare equal and would null on every save.
   * One `norm` applied identically to both sides closes both. It is a COMPARISON helper only —
   * what gets STORED is still the caller's value, unchanged.
   */
  const norm = (v: string, cap: number) => v.replace(/\r\n/g, '\n').trim().slice(0, cap)
  const sameText = (incoming: string, stored: string | null, cap: number) =>
    norm(incoming, cap) === norm(stored ?? '', cap)

  if (title !== undefined) {
    if (title.length < 3) return { ok: false, code: 400, error: 'title_too_short' }
    /**
     * ⛔ AN UNCHANGED TITLE IS NOT RE-CUT TO 140 (break-ui, 2026-10-05). The column is unbounded and
     * importers write past the form's cap (180–200, some templates uncapped — e.g. import-partners.ts,
     * job-listing.ts); the wizard ROUND-TRIPS the title, so a price-only edit of such a listing silently
     * cut its title to 140. Compared UNCUT on both sides — `sameText` caps at 140, which is exactly what
     * would call a 180-character title "the same" as its own cut. Only an EDITED title is held to 140.
     */
    // ⚠️ Normalised the way the wizard's <input type="text"> round-trips a value: it STRIPS line breaks (HTML
    // value sanitisation) and imports carry them; plus NFC. Spaces are NOT collapsed — a seller fixing an
    // imported double space must be able to save it (codex + opus, 2026-10-05).
    const asTyped = (v: string) => v.normalize('NFC').replace(/[\r\n]+/g, '').trim()
    const uncut = asTyped(String(body.title))
    const stored = asTyped(current.title ?? '')
    // Only an OVER-CAP title can lose data to the re-cut, so only that one is compared; a title within 140 is
    // written as sent, exactly as before (an API caller removing an imported line break is a real write).
    if (uncut.length <= 140 || uncut !== stored) {
      data.title = title
      // ⚠️ Exact and UNCAPPED here, not `sameText(…, 140)`: an edit past character 140 of an imported
      // title stores the 140-char cut, which `sameText` would call "the same" as the old title's first
      // 140 — leaving the OLD translation over a changed source (codex, 2026-10-05).
      if (asTyped(title) !== stored) data.titleVi = null // stale now; display falls back to the new title (re-warmed below)
    }
  }
  if (description !== undefined) {
    data.description = description
    /**
     * ⛔ THE SAME RULE AS titleVi ABOVE, AND ITS ABSENCE HERE WAS A REAL STALENESS BUG. The two
     * columns are read by the same precedence — useLocalized() prefers the *Vi value over the
     * translation cache, and (since 2026-09-08) both product feeds prefer it over the primary
     * column — so a description edit that left descriptionVi untouched served every Vietnamese
     * reader, the Meta catalogue and the Google Merchant feed the text the seller had just
     * REPLACED, with no way for them to reach the new one.
     *
     * ⚠️ IT WAS HARMLESS UNTIL THE COLUMN WAS POPULATED. descriptionVi was null on almost
     * everything a human posted, so "prefer *Vi" fell through to the primary column and the edit
     * showed. scripts/backfill-bilingual.ts filled it on 11,831 rows; that is what turned a dormant
     * asymmetry into a live one, and it is why this line ships in the same commit.
     *
     * Clearing rather than re-translating is deliberate: warmTranslations() re-warms the changed
     * text a few lines below, so the Vietnamese reader gets a fresh machine translation instead of
     * a stale human one. Losing an imported merchant's original Vietnamese is the right trade when
     * the text it described is gone — and ONLY then, hence the comparison.
     */
    if (!sameText(description, current.description, 5000)) data.descriptionVi = null
  }

  // Phone numbers are never allowed in public text (same rule as create).
  if (containsPhoneNumber(title ?? '') || containsPhoneNumber(description ?? '') || containsPhoneNumber(contactName ?? '')) {
    return { ok: false, code: 400, error: 'no_phone_in_listing' }
  }

  // A job's `price` is never stored as sent (it is read as the salary, then re-derived, below), so it
  // is not validated as a price here: an API client resending a job's old price must not fail the edit.
  if (body.price !== undefined && !salaryPaid) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0 || price > 1e12) return { ok: false, code: 400, error: 'invalid_price' }
    data.price = price
    // ⚠️ THE "Good price" VERDICT MUST NOT SURVIVE A PRICE CHANGE. `marketPosition` is denormalized
    // by the nightly price-stats cron and read by serialize.ts as `goodPrice: marketPosition === 'low'`,
    // which paints the green "Giá tốt" badge on feed and search cards. Nothing else writes the column,
    // so raising the price left the badge in place until the next cron pass: the grid advertised
    // "cheaper than comparable listings" beside a price now above P75, while the PDP one click away
    // computed the band live and said the opposite. Clearing it is the correct fail-safe — no badge
    // until the cron re-derives one, and the PDP keeps showing the live band meanwhile.
    data.marketPosition = null
  }
  if (body.district !== undefined) {
    const district = body.district ? cutText(String(body.district).trim(), 80) : null
    data.district = district
    // Don't stomp the listing's city with a hardcoded "Ho Chi Minh City" (wrong for
    // every non-HCMC listing). Use the new district as the display location; if it's
    // cleared, keep the existing location (a non-nullable column — never write null).
    data.location = district || current.location
  }
  if (body.condition !== undefined) data.condition = body.condition ? cutText(String(body.condition).trim(), 60) : null
  // Price-negotiable toggle (edit): honored on the same edit path the wizard resubmits.
  // Same rule on EDIT, or "post as goods, switch category, enable offers" is a bypass.
  if (body.negotiable !== undefined) data.negotiable = current.category?.slug === 'services' || salaryPaid ? false : Boolean(body.negotiable)
  // Urgent-sale toggle (edit). Activation runs the full server gate (no-op while
  // already active — never a silent renewal; 7-day re-arm cooldown; 2-per-seller
  // quota) and force-enables offers — urgency IS a promise of flexibility. An early
  // switch-OFF stamps urgentUntil=now (not null): the past value anchors the
  // cooldown so off/on cycling can't keep a listing permanently urgent.
  if (body.urgent !== undefined) {
    if (body.urgent === true || body.urgent === 'true') {
      const gate = await activateUrgentGate({ id: listingId, sellerId: current.sellerId, urgentUntil: current.urgentUntil })
      // Over quota is worth telling the seller (409). Cooldown is NOT fatal to the
      // edit: the wizard prefills urgent=true for a listing that was active at open,
      // and it may expire mid-edit — failing the whole (price/photo) edit over a stale
      // chip resend would be maddening. So a cooldown just skips re-arming the chip.
      if (gate.ok === false) { if (gate.error === 'urgent_quota') return { ok: false, code: 409, error: gate.error } }
      // A job's urgency is "Tuyển gấp", a hiring deadline — it opens no offers (salaryPaid).
      else if (gate.ok === true) { data.urgentUntil = gate.urgentUntil; if (!salaryPaid) data.negotiable = true }
    } else if (current.urgentUntil && current.urgentUntil.getTime() > Date.now()) {
      data.urgentUntil = new Date()
    }
  }
  // Fixed price and urgent are mutually exclusive — urgency promises flexibility. If
  // this edit sets a fixed price on a still-urgent listing (and didn't just activate
  // urgent, which forces negotiable=true above), end the urgent run — mirrors the
  // wizard, where picking "Fixed price" clears the urgent chip.
  // ⚠️ NOT ON A JOB: it is never negotiable, so this rule would end every urgent-hiring run on the
  // first edit. Its urgency was never a promise of flexibility.
  if (!salaryPaid && data.negotiable === false && data.urgentUntil === undefined && current.urgentUntil && current.urgentUntil.getTime() > Date.now()) {
    data.urgentUntil = new Date()
  }
  // ⛔ A job is never negotiable, whatever the body said or the row held (a job written before the
  // salary rule defaulted to negotiable=true, and an edit is where it is put right).
  if (salaryPaid && current.negotiable !== false) data.negotiable = false
  if (Array.isArray(body.images)) {
    const images = (body.images as unknown[]).filter(isListingImageUrl).slice(0, 8)
    // An edit must still meet the ≥3-distinct-angles bar (a seller can't quietly strip a live
    // listing down to one shot). Runs whenever the payload includes `images` — the post wizard
    // always resends the current photo set on every edit, so a price-only edit re-validates the
    // (unchanged, already-compliant) photos too. Steady-state listings all pass (same create
    // gate); only pre-rule sub-3 data (wiped pre-launch) would be blocked from editing.
    try {
      // The listing's OWN category — an edit cannot move a listing between categories,
      // so this is the same bar create used, and a 1-photo service listing stays editable.
      assertEnoughAngles(images, current.category.slug)
    } catch (e) {
      if (e instanceof PublishBlockedError) return { ok: false, code: 400, error: e.code }
      throw e
    }
    data.images = JSON.stringify(images)
  }
  // Optional single video — parseVideoField owns the contract (canonical URL sets,
  // null/'' clears, invalid values are IGNORED, not persisted). The old object's
  // eviction is registered ONLY after the DB write commits (below): after() runs
  // even when the response is an error, so queueing it here would delete a live clip
  // on a rejected edit (banned word, failed transaction).
  let evictOldVideo: string | null = null
  if (body.video !== undefined) {
    const parsedVideo = parseVideoField(body.video)
    if (parsedVideo.action === 'clear') {
      data.video = null
      if (current.video) evictOldVideo = current.video
    } else if (parsedVideo.action === 'set') {
      data.video = parsedVideo.url
      if (current.video && current.video !== parsedVideo.url) evictOldVideo = current.video
    }
  }

  // Subcategory — must belong to the listing's (unchanged) category.
  if (body.subcategorySlug !== undefined) {
    const sc = body.subcategorySlug ? String(body.subcategorySlug).trim() : null
    // O-34: an edit may KEEP a withheld subcategory the listing already has, never switch INTO one. A move into
    // the partner-only visa slot by anyone else was refused above (O-34b); a partner's is allowed here.
    const allowed = !sc || sc === current.subcategorySlug || isPostableSubcategory(current.category.slug, sc, IS_MARKETPLACE, { officialPartner: current.seller.officialPartner })
    if (allowed && (!sc || subcategoriesFor(current.category.slug).some((s) => s.slug === sc))) data.subcategorySlug = sc
  }
  // Intent (listingType) — must be valid for the category.
  if (body.listingType !== undefined) {
    const lt = String(body.listingType).trim()
    if ((typesFor(current.category.slug) as string[]).includes(lt)) data.listingType = lt
  }
  // Attribute facets — whitelisted stringly-typed taxonomy values (same rule as create).
  // ⚠️ The derived layer is NOT optional on update. The wizard stopped ASKING for
  // providerType, so an edit posts attributes WITHOUT it — and a bare sanitizeAttributes
  // would therefore ERASE the key from every listing the seller touches, quietly emptying
  // a live browse filter. Re-deriving also refreshes it when an account converts from
  // individual to business. Uses the subcategory being written if the edit changes it,
  // otherwise the stored one.
  if (body.attributes !== undefined) {
    data.attributes = await withDerivedAttributes(
      // ⛔ O-34, THE SERVER HALF (eno.vn): a listing whose seller is not an official partner keeps the
      // e-visa product attributes it ALREADY carries but cannot gain one — the wizard does not offer
      // them, and a direct API call must not add them either. VietKite (a partner) is untouched.
      withoutDisallowedVisaAttrs(sanitizeAttributes(body.attributes), { officialPartner: current.seller.officialPartner, existing: current.attributes }),
      current.sellerId,
      current.category.slug,
      (data.subcategorySlug as string | null | undefined) ?? current.subcategorySlug,
    )
  }
  // Precise pin from "use my current location".
  if (body.city !== undefined && body.city) data.city = cutText(String(body.city).trim(), 80)
  if (body.lat !== undefined) data.lat = parseGeoCoord(body.lat, 90)
  if (body.lng !== undefined) data.lng = parseGeoCoord(body.lng, 180)

  // Brand edit (product categories only) — re-resolve into the catalogue and move
  // the listing-count from the old brand to the new one. Best-effort; never blocks.
  let brandChange: { from: string | null; to: string | null } | null = null
  if (body.brand !== undefined && categoryHasBrand(current.category.slug)) {
    const raw = body.brand ? String(body.brand) : ''
    const next = raw.trim() ? await resolveBrand(raw).catch(() => null) : null
    if (next !== current.brandSlug) {
      data.brandSlug = next
      brandChange = { from: current.brandSlug, to: next }
      if (!next) data.model = null // brand cleared → model is meaningless
    }
  }
  // Model edit (product categories only) — kept alongside a brand.
  if (body.model !== undefined && categoryHasBrand(current.category.slug)) {
    const effectiveBrand = (data.brandSlug as string | null | undefined) ?? current.brandSlug
    data.model = effectiveBrand && body.model ? (cutText(String(body.model).trim(), 60) || null) : null
  }

  // Range specs (year/mileage/engine) → clamped to the category's declared range.
  // Sparse: an explicit null/'' clears the spec; an omitted key leaves it untouched.
  // (Scoped to the CURRENT subcategory's facets, even if this edit also changes it —
  // long-standing behavior, kept as-is.)
  Object.assign(data, clampRangeFacets(current.category.slug, current.subcategorySlug, body, { sparse: true }))

  // A job edit that sends a `price` but no `salaryM` (an API client, a sync row, MCP update_listing) is
  // stating the MONTHLY SALARY in đồng — read as one (taxonomy.ts salaryMFromPrice: whole millions,
  // rounded down), exactly as the bulk CSV reads it on create, rather than dropped while the call
  // reports success. An explicit salaryM always wins. Under 1,000,000 ₫ states no salary → null.
  if (derivesSalaryPrice && data.salaryM === undefined && body.price !== undefined) {
    data.salaryM = salaryMFromPrice(body.price, current.category.slug)
  }

  // ⚠️ THE UNIT FOLLOWS THE INTENT ACROSS THE JOB BOUNDARY AND THE RENT BOUNDARY, AND A RENT ROW'S
  // PERIOD WHEN IT MOVES. listingMoneyFor is otherwise never called on edit (a save that leaves the
  // period alone must not re-stamp a vehicle rental's 'VND/day'), but a post switched INTO the job
  // intent (Wanted → Job) kept its bare 'VND', so its derived salary printed without "/ month"; one
  // switched OUT kept 'VND/month' on a budget. The rent boundary is the same mistake in Rentals: a daily
  // rental switched to "Cần thuê" kept 'VND/day' on a budget, and the reverse kept a bare 'VND' on a
  // rent. The third trigger: a rent row whose `rentalPeriod` attribute this edit changes ("Theo tháng"
  // → "Theo ngày") takes the unit of the period it will have — compared NORMALISED (rentalPeriodOf), so
  // 'long-term' ↔ 'monthly' is no change. The jobs category offers no 'rent', so the job and rent
  // triggers never meet.
  if (nextType !== current.listingType && !salaryPaid && paysSalary(current.listingType)) {
    // OUT of the job intent: a Wanted post carries no salary, and a hiring-urgency run is not a sale's.
    data.salaryM = null
    if (current.urgentUntil && current.urgentUntil.getTime() > Date.now() && data.urgentUntil === undefined) data.urgentUntil = new Date()
  }
  const nextPeriod = rentalPeriodOf(data.attributes !== undefined ? data.attributes : current.attributes)
  const periodMoved = nextType === 'rent' && data.attributes !== undefined && nextPeriod !== rentalPeriodOf(current.attributes)
  // RENT ↔ ANYTHING ELSE moves the unit too, both ways: a daily rental switched to "Cần thuê" (Wanted)
  // states a BUDGET, so it must not keep 'VND/day', and a Wanted switched to Rent must not keep a bare
  // 'VND'. Only a category that offers 'rent' can make the switch (nextType is validated against it).
  const rentCrossed = (nextType === 'rent') !== (current.listingType === 'rent')
  const jobCrossed = nextType !== current.listingType && salaryPaid !== paysSalary(current.listingType)
  if (jobCrossed || rentCrossed || periodMoved) {
    data.priceUnit = listingMoneyFor({ categorySlug: current.category.slug, subcategorySlug: current.subcategorySlug, listingType: nextType, rentalPeriod: nextPeriod }).priceUnit
  }

  // ⛔ A JOB'S PRICE IS ITS SALARY — re-derived from the salary it will have (this edit's, else the
  // stored one) whenever an edit touches its pay (the salary, a `price` — read as the salary above,
  // never stored as sent — or a switch INTO the job intent), so a client can never give a job a price
  // of its own. The wizard sends the salary column on every save of a job (null when "Negotiable"), so
  // a job it edits always comes out derived; an API edit of only the title leaves a pre-rule row's
  // stated pay alone rather than zeroing it. Unchanged → not written.
  if (derivesSalaryPrice && (data.salaryM !== undefined || body.price !== undefined || nextType !== current.listingType)) {
    const salaryM = data.salaryM !== undefined ? (data.salaryM as number | null) : current.salaryM
    const derived = salaryPriceFor(salaryM)
    if (derived !== current.price) { data.price = derived; data.marketPosition = null }
  }

  if (Object.keys(data).length === 0) return { ok: true }

  // ⚠️ NO CURRENCY WRITE HERE, DELIBERATELY. Every listing on eno is stored in ₫
  // (listingMoneyFor) and create is the only path that ever sets `currency` — so an edit
  // has nothing to re-assert and must not touch the column. A rule that re-stamped the
  // currency of listings in one subcategory shipped briefly (f7f8ca40) and was reverted:
  // the admin prices e-visa products in VND like everyone else, and the dollar amount the
  // buyer pays is a server-issued conversion at checkout, not a stored currency.

  // Full content screen on EVERY edited free-text field — the same checks as
  // create. Without this, clean-publish-then-edit was a complete bypass of the
  // banned-goods and contact filters (2026-07-06 compliance verification). Covers
  // the secondary fields too (model/condition/district/city/attribute values —
  // all publicly rendered).
  try {
    const attrTexts = data.attributes ? Object.values(JSON.parse(data.attributes as string) as Record<string, string>) : []
    // Same split as create: the contact name gets its own code so the edit screen can
    // point at Settings rather than at the listing body.
    assertCleanContactName(contactName)
    assertCleanTexts([
      title, description,
      data.district as string | null | undefined,
      data.condition as string | null | undefined,
      data.model as string | null | undefined,
      data.city as string | null | undefined,
      body.brand !== undefined ? String(body.brand ?? '') : undefined,
      ...attrTexts,
    ])
  } catch (e) {
    if (e instanceof PublishBlockedError) {
      // Pass the code through (the wizard maps banned_words / contact_in_text / photos_min etc).
      return { ok: false, code: 400, error: e.code }
    }
    throw e
  }

  // Rebuild the folded search blob from the new values (fall back to current).
  const newTitle = (data.title as string) ?? current.title
  const newDesc = (data.description as string) ?? current.description
  const newDistrict = (data.district as string | null) ?? current.district
  const newBrand = (data.brandSlug as string | null | undefined) ?? current.brandSlug
  const newModel = (data.model as string | null | undefined) ?? current.model
  /**
   * ⛔ BOTH LANGUAGES, OR THE FIRST SELLER EDIT SILENTLY DELETES HALF THE SEARCH INDEX. An imported
   * listing carries an English `title` AND a Vietnamese `titleVi` (scripts/backfill-bilingual.ts),
   * and a buyer may type either — which is why scripts/rebuild-search-text.ts folds all four fields
   * in. This line folded only the primary pair, so editing the price on such a listing rebuilt the
   * blob without any Vietnamese in it and made the row unfindable by the words its own seller used.
   * The *Vi values are not editable here, so they are read from `current`.
   */
  // ⚠️ THE VALUES THAT WILL BE STORED, NOT THE ONES THAT WERE. An edit above sets `data.titleVi` /
  // `data.descriptionVi` to null, so folding `current.*Vi` here would index Vietnamese text the row
  // is not going to have — the search blob would keep matching words the listing no longer says.
  const newTitleVi = 'titleVi' in data ? (data.titleVi as string | null) : current.titleVi
  const newDescVi = 'descriptionVi' in data ? (data.descriptionVi as string | null) : current.descriptionVi
  data.searchText = buildSearchText([newTitle, newTitleVi, newDesc, newDescVi, newDistrict, current.category.name, current.category.nameVi, newBrand, newModel])

  // ⚠️ THERE IS NO AUTO-REPUBLISH ANY MORE, AND REMOVING IT IS THE FIX — not a regression.
  //
  // This branch used to flip `verified` back to true when a seller edited a held listing, on the
  // premise that verified=false meant "created below the photo bar, let them fix it". That premise
  // is dead: EVERY create path now writes `verified: true` (createListingCore's own insert, and
  // bulk.ts:168; sync writes no verified at all) and a publish violation THROWS PublishBlockedError
  // instead of saving a held row. So nothing produces a photo-held listing.
  //
  // What DOES produce verified=false is, exhaustively: an admin unverify
  // (api/admin/listings/route.ts:87), the moderation queue (api/admin/moderate/route.ts:133,168,205),
  // the duplicate/provenance auto-hold (lib/image-provenance.ts:85), the AI moderation auto-hold
  // (lib/ai-moderation.ts:156), and the enforcement ladder pulling a seller's catalogue
  // (lib/enforcement.ts:283). Every one of those is a TAKEDOWN. Auto-republishing any of them
  // because the seller edited the row is exactly the bypass this removal closes — and the old guard
  // could not tell them apart, because all six write the same single boolean and nothing else.
  //
  // ⚠️ Two "smarter" fixes were tried and rejected with evidence before landing on deletion: a
  // `heldReason` column (fails closed only if every one of those six paths is updated AND legacy
  // NULLs are treated as admin holds — otherwise it grandfathers in every existing takedown), and
  // inferring the photo-hold from "the listing had zero photos" (refuted by measurement: the last
  // held listing in production carried 1 image while its category required 3).
  //
  // The escape hatch is real and already built: an operator re-publishes with the admin `verify`
  // action (api/admin/listings/route.ts:86). Restoring a listing a human or a moderation system
  // pulled should take a human, which is the whole point.

  // ⚠️ THE "Good price" VERDICT IS ALSO VOID WHEN THE LISTING CHANGES BAND, not only price. The band
  // is keyed on brand + model + shelf (subcategory) + condition + year band (listingSegment), and
  // "Good price" is now a FILTER people narrow by shelf and model — so a case re-filed from phones to
  // phone-cases, or a model corrected from "iPhone 15" to "iPhone 15 Pro Max", would otherwise keep a
  // verdict judged against the wrong comparables and keep appearing under Good price until 03:00
  // (astra). Compared with the stored value, so an edit that resends the same fields keeps the badge.
  // The category is the sixth key field and is deliberately absent: this path cannot write it (the
  // wizard offers no category change on an edit), so there is nothing to compare against.
  // ⚠️ THIS COVERS THE WIZARD'S EDIT, NOT EVERY WRITER. The partner sync, admin tools and the import
  // scripts move brand/model/shelf without coming through here, and the enrichment apply re-files
  // listings in bulk — for those the nightly cron is the repair, because it CLEARS every active
  // marketPosition before re-deriving. Re-run it after any bulk re-filing instead of waiting for 03:00.
  // `data[k] !== undefined`, not `k in data`: a key present but undefined would read as null and clear a
  // perfectly good verdict on an edit that moved nothing (opus). Nothing writes undefined today —
  // clampRangeFacets `continue`s instead, and every branch above assigns a value or null — so this is a
  // guard on the shape rather than a fix. Both sides are normalised (slug vs slug, '' already → null).
  // `listingType` is in the list because it decides ELIGIBILITY, not just which band: a listing flipped
  // from sell to wanted is no longer judged against sale prices at all, and keeping its old verdict
  // would leave a budget ad under "Good price" until the cron (opus).
  const bandMoved = (['subcategorySlug', 'brandSlug', 'model', 'condition', 'year', 'listingType'] as const)
    .some((k) => data[k] !== undefined && (data[k] ?? null) !== (current[k] ?? null))
  if (bandMoved) data.marketPosition = null

  // Price-drop pipeline — runs LAST, once every validation above has passed, so a
  // rejected edit never writes an audit row. Reads history, computes the 30-day-min
  // reference, merges the badge fields (for a qualifying drop), and hands back the
  // audit-row payload + the buyer-notification thunk. A raise clears any active badge
  // instantly. All rules in src/lib/price-drop.ts.
  let dropNotify: (() => Promise<void>) | null = null
  let dropAudit: { listingId: string; oldPrice: number; newPrice: number } | null = null
  // ⛔ NOT ON A JOB. A changed salary is not a price drop: no "-20%" badge, no "price dropped"
  // notification to the candidates who messaged, no PriceChange audit row. A badge a job row may still
  // carry from before the salary rule is cleared instead.
  if (salaryPaid && data.price !== undefined && (current.previousPrice != null || current.priceDropAt != null)) {
    data.previousPrice = null
    data.priceDropAt = null
  }
  if (!salaryPaid && data.price !== undefined && (data.price as number) !== current.price) {
    const effects = await priceChangeEffects(
      {
        id: listingId,
        price: current.price,
        createdAt: current.createdAt,
        previousPrice: current.previousPrice,
        priceDropAt: current.priceDropAt,
        lowestNotifiedPrice: current.lowestNotifiedPrice,
        priceDropNotifiedAt: current.priceDropNotifiedAt,
      },
      data.price as number,
    )
    Object.assign(data, effects.data)
    dropNotify = effects.notify
    dropAudit = effects.audit
  }

  // Commit the audit row and the listing update ATOMICALLY — a failed update must not
  // leave a phantom PriceChange (it would drag the 30-day reference down and mis-anchor
  // the "was" price on a future drop). Plain update when the price didn't change.
  /**
   * ⛔ BOTH WRITES REFUSE A TOMBSTONE IN THEIR OWN WHERE (review, 2026-10-01). The `current` read at the
   * top is not a lock: a removal committing between it and here would otherwise be overwritten with
   * the seller's edit (and, on the partner sync, a whole re-sent row). `update` with the extra
   * `status` filter is ONE statement — `UPDATE … WHERE id = $1 AND status <> 'removed' RETURNING …`
   * (measured against Prisma 7's query compiler) — and throws P2025 on zero rows, which also rolls the
   * array transaction back, so no PriceChange row is left for an edit that never landed. P2025 is
   * answered as the read path answers a tombstone: 404 not_found.
   */
  const where = { id: listingId, ...NOT_REMOVED }
  try {
    if (dropAudit) {
      await db.$transaction([
        db.priceChange.create({ data: dropAudit }),
        db.listing.update({ where, data }),
      ])
    } else {
      await db.listing.update({ where, data })
    }
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2025') return { ok: false, code: 404, error: 'not_found' }
    throw e
  }
  if (dropNotify) after(dropNotify) // buyer fan-out never delays the response
  // The replaced/removed clip is only NOW (post-commit) safe to evict — and only if no other
  // listing still references the same object (URLs are client-suppliable, so URL↔listing is
  // NOT 1:1; without the refcount, pointing a throwaway listing at a victim's public video
  // URL and clearing it would delete the victim's clip). GC cron remains the backstop.
  if (evictOldVideo) after(() => removeVideoIfOrphaned(evictOldVideo!))
  if (brandChange) after(() => Promise.all([
    brandChange!.from ? bumpBrandCount(brandChange!.from, -1) : Promise.resolve(),
    brandChange!.to ? bumpBrandCount(brandChange!.to, 1) : Promise.resolve(),
  ]))
  revalidatePublicPath(`/listings/${listingId}`) // purge the cached (ISR) detail page so the edit shows
  after(() => reindexListing(listingId)) // refresh the AI-search document with the edited fields
  after(() => dispatchListingEvent('listing.updated', listingId)) // notify the shop's partner webhooks

  // Re-warm translations for CHANGED user text only (after the response flushes). The
  // wizard round-trips every field, so an edit that only touched the price used to re-bill
  // the full title+description fan-out for text that was byte-identical.
  const warm = [
    data.title !== undefined && data.title !== current.title ? (data.title as string) : null,
    data.description !== undefined && data.description !== current.description ? (data.description as string) : null,
    data.location !== undefined && data.location !== current.location ? (data.location as string) : null,
  ].filter((t): t is string => !!t)
  if (warm.length) after(() => warmTranslations(warm))

  // Re-run illegal-content moderation when images OR text changed — closes the clean-publish-
  // then-edit bypass for the VISION signal (the inline word-scan already re-runs on edited
  // text via assertCleanTexts; images/context need the AI pass too). moderateListingById
  // re-reads the now-edited listing, so it scans the new content. Trust-gated + fail-open.
  if (data.images !== undefined || data.title !== undefined || data.description !== undefined) {
    after(() => moderateListingById(listingId))
  }
  // Re-index + re-check image provenance when the photos changed (edited to reuse another
  // seller's photos).
  if (data.images !== undefined) {
    after(() => indexAndCheckProvenance(listingId))
  }

  return { ok: true }
}

/**
 * Build + create a listing for an ALREADY-RESOLVED seller, then fire the after()
 * side-effects (brand catalogue, translation warm, social syndication + Meta CAPI Lead
 * + AI-search index when it publishes live). The caller has already: parsed the body,
 * hard-validated title/price/phone-in-text, looked up the category, and resolved the
 * seller (by-phone for the session post wizard; by-API-key for /api/v1). This core owns
 * the field-building, the auto-publish gate, the create, and the side-effects so both
 * paths produce IDENTICAL listings. `headers` powers CAPI user-matching + event source.
 */
export async function createListingCore(input: {
  // ⚠️ IDENTITY BELONGS TO THE OWNER PROFILE, NOT THE STOREFRONT. Seller is a storefront and may be
  // owner-less (a claimed guest seller); the obligation under NĐ 248/2026 attaches to the HUMAN
  // behind it. Hence `ownerId` rather than a status.
  //
  // ⛔ IT USED TO BE `verificationStatus?: string | null`, PASSED BY THE CALLER, AND BOTH CALLERS
  // FORGOT — the session path handed over a raw Seller row and the partner path a select list
  // without it, so an OPTIONAL field that no caller supplied left the gate inert on every path
  // while looking wired. Taking `ownerId` and resolving here means it cannot be omitted: a new
  // publish path either provides the owner or does not compile.
  //
  // ⚠️ ALL THREE CALL SITES ALREADY SATISFY IT (api/listings, api/v1/listings, lib/mcp/tools —
  // verified, and `tsc` is the standing proof since the field is required). Saying "both callers
  // forgot" in the present tense read as an unfixed break to two external reviewers, who both filed
  // it as "the build is red or the diff is incomplete". It is neither: that sentence is history.
  seller: { id: string; trustTier: string; trustScore: number; phone: string | null; ownerId: string | null }
  // ⚖️ WHO IS POSTING, NOT WHO OWNS THE ROW: true ONLY for a signed-out post through the session web
  // route (api/listings). It was derived here as `!seller.ownerId`, which also caught an ownerless
  // shop posting with an API key (api/v1/listings, MCP create_listing) — refused as a "guest" while
  // /bulk and /sync let the identical shop through as a platform import. Required, like `ownerId`,
  // so a new caller has to decide rather than inherit a default.
  guestCreate: boolean
  category: { id: string; slug: string; name: string; nameVi: string }
  title: string
  price: number
  body: Record<string, unknown>
  headers: Headers
}): Promise<{ id: string; verified: boolean }> {
  const { seller, guestCreate, category, title, price, body, headers } = input
  const categorySlug = category.slug
  // Seller.officialPartner, read at most once and only when an answer depends on it (O-34 / O-34b below).
  let officialPartner: boolean | undefined
  const sellerIsOfficialPartner = async () =>
    (officialPartner ??= (await db.seller.findUnique({ where: { id: seller.id }, select: { officialPartner: true } }))?.officialPartner === true)
  // ⛔ Teacher profiles are written ONLY by src/lib/teachers/publish.ts (2026-09-30). Every generic
  // create path (web wizard, /api/v1, MCP, bulk) ends here, so this one refusal covers them all.
  if (!isPostableCategory(categorySlug)) throw new PublishBlockedError('category_not_postable')

  const images: string[] = Array.isArray(body.images)
    ? (body.images as unknown[]).filter(isListingImageUrl).slice(0, 8)
    : []
  // Optional single listing video — canonical-URL-or-nothing on create: 'clear' and
  // 'ignore' both mean "no video" here (only update distinguishes them).
  const parsedVideo = parseVideoField(body.video)
  const video: string | null = parsedVideo.action === 'set' ? parsedVideo.url : null
  const district = body.district ? cutText(String(body.district).trim(), 80) : null
  const city = body.city ? cutText(String(body.city).trim(), 80) : 'Ho Chi Minh City'
  const location = body.location ? cutText(String(body.location).trim(), 120) : (district || city)
  // Optional precise pin from "use my current location" (validated to plausible ranges).
  const lat = parseGeoCoord(body.lat, 90)
  const lng = parseGeoCoord(body.lng, 180)

  // Publish gate — NO held-for-review queue (manual verification removed; nothing waits on
  // an admin). A Restricted (low-trust) account can't post until its score recovers; a
  // missing photo / banned words / contact info in the text are REJECTED so the seller fixes
  // them (the wizard maps these codes to inline messages). Throws PublishBlockedError; the
  // caller turns it into an HTTP error. Pass → the listing goes live instantly.
  const description = cutText(String(body.description || '').trim(), 5000)
  // The contact NAME is screened first and on its own, so "your name is an email"
  // reports as contact_in_name (fixable in Settings) instead of being folded into
  // contact_in_text, which tells the seller to edit a listing that is already clean.
  const guardName = body.contactName ? cutText(String(body.contactName).trim(), 80) : null
  assertCleanContactName(guardName)
  // Services sell at the price stated: no offers, no urgency run.
  const fixedPriceOnly = categorySlug === 'services'

  // ⚠️ IDENTITY IS GATED PER EDITION (owner, 2026-08-03: "eno.forum doesnt need it"). The mandate
  // binds the licensed Vietnamese platform, and eno.forum has no VNPT channel — so passing a status
  // here on the services build would refuse every forum publish with no way for the seller to ever
  // clear it. `undefined` is the guard's documented "not this caller's job" value.
  // ⚠️ TWO CONDITIONS, NOT ONE: the right EDITION and the switch actually thrown. Passing a status
  // while the gate is unenforced would refuse every seller the moment the column starts being
  // populated — with no way for them to clear it until VNPT works.
  // ⛔ THIS READ WAS DEAD, AND SILENTLY SO. `seller.verificationStatus` does not exist — the column
  // lives on PROFILE (prisma/schema.prisma:119). So `identityStatus` was ALWAYS undefined and
  // assertIdentityVerified returned early every time; the gate was inert at a second level, beneath
  // the env flag, and flipping IDENTITY_GATE_ENFORCED=1 would have changed nothing at all.
  //
  // ⛔ AND IT RE-READS identity_verifications RATHER THAN THE CACHE, because schema.prisma:116 says
  // publishing must: "a cache that has drifted is exactly how a lapsed document keeps a verified
  // badge". Expiry here is DERIVED, so a passport that lapsed this morning still reads `verified`
  // in Profile until a sweep runs — reading the cache would let precisely that seller publish.
  //
  // ⛔ THE GUEST HOLE THIS COMMENT USED TO DESCRIBE IS CLOSED (owner, 2026-09-23). A guest seller has
  // no ownerId and therefore no identity; this path used to pass `undefined` for it — "not this
  // caller's job" — so a guest post bypassed verification entirely while the gate was on. The
  // decision now lives in ONE helper shared by every publish path (seller-publish-gate.ts). A guest
  // is a SIGNED-OUT web post (`guestCreate`, set by the caller that knows there is no session), which
  // the gate refuses with `identity_sign_in_required` — the wizard turns that into "sign in, then
  // verify". An ownerless shop reached by API key is a platform import, allowed exactly as on /bulk.
  //
  // ⚠️ STILL CHECKED FIRST, as assertPublishable's step 0 was: a legal block outranks every content
  // complaint, so a seller who cannot publish anyway is not sent to fix their photos first. The
  // helper is a no-op (no reads) while the gate is off, and assertPublishable gets no status, i.e.
  // its identity step stays the documented "not this caller's job".
  await assertSellerMayPublish({ ownerId: seller.ownerId, guestCreate })
  // The released-scam-charge regime (released-charge-gate.ts): a seller whose only standing scam
  // charges an admin RELEASED may post despite the restricted tier the frozen charge keeps them in,
  // up to the active-listing cap. Null for everyone else (one cheap read) — the gate is unchanged.
  const releasedCharge = await releasedChargeGate(seller.ownerId, seller.id)
  assertPublishable({ trustTier: seller.trustTier, releasedCharge, images, texts: [title, description], categorySlug, lat, lng, district })

  // Intent + subcategory from the taxonomy. listingType must be valid for the category
  // (else its primary type); subcategory falls back to keyword-suggest.
  const listingType: string = resolveListingType(categorySlug, body.listingType)
  // ⛔ A JOB IS PAID A SALARY (taxonomy.ts paysSalary): no offers, and its price is DERIVED from the
  // salary facet below — a `price` the caller sent is at most read as that salary, never stored as sent.
  const salaryPaid = paysSalary(listingType)
  // ⛔ A NEW listing can only take a POSTABLE subcategory (O-34, 2026-09-30): the marketplace edition
  // withholds `tickets-travel/visa-runs` from the picker, and a restored draft or a crafted request must
  // not get it past the server either. Editing an existing listing is a different path (updateListing).
  // `{ officialPartner: true }` here is the EDITION rule alone: whether THIS seller may use a partner-only
  // subcategory is decided just below, with at most one read.
  const subs = subcategoriesFor(categorySlug).filter((s) => isPostableSubcategory(categorySlug, s.slug, IS_MARKETPLACE, { officialPartner: true }))
  let subcategorySlug: string | null = String(body.subcategorySlug || '').trim()
  const subcategoryPicked = subs.some((s) => s.slug === subcategorySlug)
  if (!subcategoryPicked) {
    // TITLE FIRST (gate, 2026-10-05): the longest keyword wins (taxonomy.ts), and a description names the extras —
    // "Honda Vision 2022" + "kèm mũ bảo hiểm" must stay a motorbike. The description is read only when the
    // title alone matches nothing, which is all it was ever needed for.
    const suggested = suggestSubcategory(categorySlug, title) ?? suggestSubcategory(categorySlug, `${title} ${body.description || ''}`)
    subcategorySlug = (suggested && subs.some((s) => s.slug === suggested) ? suggested : null) || (subs[0]?.slug ?? null)
  }
  // ⛔ O-34b (owner, 2026-10-05): on eno.vn the visa slot (services/visa-legal) takes an OFFICIAL PARTNER's
  // listings only (taxonomy.ts PARTNER_ONLY_ON_MARKETPLACE). A seller who PICKED it is refused — they chose it,
  // so they are told, with the bilingual PARTNER_ONLY_REFUSAL the route adds; a keyword GUESS (or the
  // first-subcategory fallback) that lands there is re-filed to Services › Other — the place that refusal
  // names — because the seller never asked for the slot. VietKite (a partner) posts there as before.
  if (subcategorySlug && isPartnerOnlySubcategory(categorySlug, subcategorySlug) && !(await sellerIsOfficialPartner())) {
    if (subcategoryPicked) throw new PublishBlockedError('subcategory_partner_only')
    subcategorySlug = partnerOnlyFallback(categorySlug, subcategorySlug)
  }
  // Currency + price unit — ₫ for EVERY listing, unit follows the intent (monthly for
  // rent/job, per-service for a service). Derived in one place so create and the taxonomy
  // can't drift; `money.currency` is typed as the literal '₫', so tsc, not a reviewer,
  // guarantees the row below is written in đồng.
  // ⚠️ THE RENT PERIOD IS READ FROM THE SANITIZED ATTRIBUTES, BEFORE THE STAMP. The wizard's "Kỳ thuê"
  // chip used to be stored and ignored: every rent post was stamped monthly, so a scooter at
  // 150.000 đ a day printed "150.000 đ / tháng". rentalPeriodOf normalises 'long-term' → monthly and
  // anything unknown → null (= monthly), so the unit can never read "VND/undefined".
  const sanitized = sanitizeAttributes(body.attributes)
  // ⛔ O-34, THE SERVER HALF (eno.vn): an ordinary seller's NEW post carries no e-visa product
  // attributes — the wizard does not ask for them (askableFacetsFor), and a direct API call must not get
  // them in either. An official partner (VietKite) keeps them. The seller's flag is read only when such
  // a key was actually sent (the stripped value then differs) — and at most once per create, shared with
  // the visa-slot check above — so an ordinary create costs no query.
  const forNonPartner = withoutDisallowedVisaAttrs(sanitized, { officialPartner: false })
  const cleanAttributes = forNonPartner === sanitized || (await sellerIsOfficialPartner())
    ? sanitized
    : forNonPartner
  const money = listingMoneyFor({ categorySlug, subcategorySlug, listingType, rentalPeriod: rentalPeriodOf(cleanAttributes) })
  const priceUnit = money.priceUnit
  // Whitelisted, stringly-typed attribute facets (taxonomy values), then the DERIVED ones
  // (providerType from the account) layered on top so a client value can never win.
  const attributes = await withDerivedAttributes(
    cleanAttributes,
    seller.id,
    categorySlug,
    subcategorySlug,
  )

  // Structured numeric specs (range facets) → dedicated columns, each clamped to the
  // category's declared range (non-sparse: every declared column is read).
  const rangeData = clampRangeFacets(categorySlug, subcategorySlug, body, { sparse: false })
  // A job sent with a `price` and no `salaryM` (an API client, MCP, a stale wizard tab) is stating the
  // MONTHLY SALARY in đồng: read as one (taxonomy.ts salaryMFromPrice), the rule the bulk CSV and every
  // edit apply. The wizard sends salaryM and no price, so it never reaches this.
  if (salaryPaid && rangeData.salaryM === undefined && body.price !== undefined) {
    const fromPrice = salaryMFromPrice(body.price, categorySlug)
    if (fromPrice != null) rangeData.salaryM = fromPrice
  }
  // ⛔ THE STORED PRICE OF A JOB IS ITS SALARY (salaryM × 1,000,000 ₫/month, 0 when unstated) —
  // never the caller's `price` as sent.
  const storedPrice = salaryPaid ? salaryPriceFor(rangeData.salaryM) : price

  // Brand (product categories only): canonicalize + typo-dedupe into the catalogue,
  // growing it on first sight. Never blocks the post if resolution fails.
  let brandSlug: string | null = null
  if (categoryHasBrand(categorySlug) && body.brand) {
    try { brandSlug = await resolveBrand(String(body.brand)) } catch { brandSlug = null }
  }
  // Specific model — only kept alongside a resolved brand.
  const model = brandSlug && body.model ? (cutText(String(body.model).trim(), 60) || null) : null

  // Urgent-sale chip at posting. Quota-gated (max 2 concurrently urgent per seller) —
  // but NEVER fails the post over a chip: over quota, the listing is simply created
  // without it (the seller can re-arm from edit once a slot frees). No cooldown check
  // here — a brand-new listing has no urgent history.
  // ACCEPTED RACE (check-then-create TOCTOU, here and on the edit path's
  // activateUrgentGate): two concurrent requests can both see a free slot and
  // briefly exceed MAX_ACTIVE_PER_SELLER. Worst case is one extra free cosmetic
  // chip with zero rank effect — not worth advisory-lock serialization.
  const urgentOk = (body.urgent === true || body.urgent === 'true') && (await urgentQuotaFree(seller.id))

  // Screen the SECONDARY free-text fields too (all publicly rendered): district,
  // condition, model, raw brand input, city, LOCATION, attribute values. The primary
  // texts were screened by assertPublishable above; without this a banned term or
  // phone number could ride in via e.g. `model` or the free-text `location` (which
  // is card/detail-rendered AND auto-syndicated to Telegram/Facebook, so a direct-
  // or partner-API caller could smuggle "Zalo 090… - bán súng đạn" past the gate —
  // 2026-07-06 launch audit; the UI wizard sends controlled geo names).
  const conditionText = body.condition ? cutText(String(body.condition).trim(), 60) : null
  assertCleanTexts([
    district, conditionText, model, city, location,
    body.brand ? String(body.brand) : undefined,
    ...(attributes ? Object.values(JSON.parse(attributes) as Record<string, string>) : []),
  ])

  // Duplicate-listing protection: the same product can't be posted again while a copy of
  // it is still LIVE (repost-to-bump spam). Re-listing after sold/hidden/deleted is fine,
  // and the check is seller-scoped so nobody is blocked by other sellers' items. The
  // candidate searchText uses the exact recipe of the create below. detail = the existing
  // listing's id so clients can link "edit / bump it instead". Fail-open inside the guard.
  // Same ACCEPTED check-then-create race as the urgent quota above: two simultaneous
  // posts of the same item can both pass — the dup is visible and admin-removable.
  const searchText = buildSearchText([title, String(body.description || ''), district, category.name, category.nameVi, brandSlug, model])
  // `attributes` is the taxonomy facet set — two listings that differ by facet are variants,
  // not reposts. It is the JSON string built above, so parse it back to the shape the guard
  // compares; a malformed value degrades to "no facets", i.e. the guard's old behaviour.
  const dupFacets = (() => {
    if (!attributes) return null
    try { return JSON.parse(attributes) as Record<string, string> } catch { return null }
  })()
  const dup = await findDuplicateListing({ sellerId: seller.id, categoryId: category.id, title, searchText, price: storedPrice, images, attributes: dupFacets })
  if (dup) throw new PublishBlockedError('duplicate_listing', dup.id)

  const listing = await db.listing.create({
    data: {
      title,
      description,
      price: storedPrice,
      priceUnit,
      currency: money.currency,
      // Default to negotiable when the caller omits it (matches the column default +
      // the pre-feature norm); the wizard sends an explicit true/false, partner API /
      // MCP send it when they want a fixed price. Urgent force-enables offers —
      // urgency is a promise of flexibility (the wizard mirrors this client-side).
      // ⚠️ SERVICES ARE FIXED-PRICE, and the server decides that — not the wizard, which
      // merely hides the controls (owner, 2026-07-22: "for services category all products
      // non negotiable"). A service is quoted work at a stated price; an offer on it is a
      // renegotiation of scope, which the offer flow cannot express. This also has to beat
      // the urgent coupling below it: Urgent normally FORCES negotiable=true, so without
      // this ordering a service posted as urgent would come back negotiable anyway.
      // ⛔ A JOB TAKES NO OFFERS, and its urgency ("Tuyển gấp") is a hiring deadline, not a promise
      // to haggle — so for a job Urgent does NOT flip negotiable, and the salary flag wins first.
      negotiable: fixedPriceOnly || salaryPaid ? false : urgentOk ? true : body.negotiable === undefined ? true : Boolean(body.negotiable),
      ...(urgentOk && !fixedPriceOnly ? { urgentUntil: new Date(Date.now() + URGENT.DURATION_MS) } : {}),
      location,
      district,
      city,
      lat,
      lng,
      condition: conditionText,
      images: JSON.stringify(images),
      video,
      searchText, // built above (same recipe the duplicate guard compared against)
      categoryId: category.id,
      subcategorySlug,
      listingType,
      attributes,
      ...rangeData,
      brandSlug,
      model,
      sellerId: seller.id,
      sellerTrustScore: seller.trustScore, // denormalized ranking key (kept in sync by src/lib/trust.ts)
      // Balanced feed rank at age≈0 (recency=1) — matches the SQL re-decay exactly. New
      // listings land fresh; the daily cron + trust changes re-decay it afterwards.
      rankScore: browseRankScore({ sellerTrustScore: seller.trustScore, postedAt: new Date(), featured: false }),
      verified: true,
    },
  })
  if (brandSlug) after(() => { bumpBrandCount(brandSlug!); enrichBrandLogoIfMissing(brandSlug!).catch((e) => logError(e, { op: 'listings.enrichBrandLogoIfMissing' })) })

  // Tier-2 illegal-content moderation: an AI vision+text pass runs AFTER the response
  // flushes (the listing is already live — instant-publish stays instant). Trust-gated to
  // the risky population inside; a high-confidence prohibited hit auto-hides + flags + notifies.
  // Cross-app image provenance: index this listing's photo hashes + check them against the
  // whole platform; reusing another seller's photos (stolen-listing scam) auto-hides + flags.
  // ⚠️ ONE after(), and social syndication waits for BOTH checks: posting ran concurrently with them,
  // so a listing they held seconds after creation could already be on eno's Facebook Page. Each
  // check catches its own errors, so allSettled is belt and braces.
  after(async () => {
    await Promise.allSettled([moderateListingById(listing.id), indexAndCheckProvenance(listing.id)])
    await syndicateListingIfPublic({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
      // A job's caption states its pay as a salary, not a sale price (syndicate.ts priceLine).
      listingType: listing.listingType,
      priceUnit: listing.priceUnit,
      location: listing.location,
      district: listing.district,
      image: images[0] || null,
      categoryName: category.name,
    })
  })

  // Pre-translate every user-authored text field into the TOP visitor languages (the
  // eager set in lib/translate.ts) so the listing renders from cache where it matters
  // most; the nightly warm-translations cron completes the long-tail languages. Runs
  // after the response flushes.
  const attrValues: string[] = (() => {
    try {
      const a = listing.attributes ? JSON.parse(listing.attributes) : {}
      return Object.values(a).map((v) => String(v))
    } catch { return [] }
  })()
  const warmFields = [listing.title, listing.description, listing.location, ...attrValues].filter(Boolean)
  after(() => warmTranslations(warmFields))

  // Meta CAPI Lead + AI-search index (social syndication runs above, once moderation has settled).
  // Best-effort, after the response.
  {
    after(() =>
      sendMetaCapiEvent('Lead', {
        eventSourceUrl: headers.get('referer') || undefined,
        userData: metaUserDataFromHeaders(headers, { phone: seller.phone, externalId: seller.id }),
        // `money.isoCode` rather than a 'VND' literal: it is typed as the literal 'VND'
        // and comes from the same derivation as the stored row, so the reported value and
        // the stored one cannot drift apart.
        // A job's stored price is a SALARY — not a value this lead is worth, so it reports 0.
        customData: { content_ids: [listing.id], content_type: 'product', content_category: category.name, value: salaryPaid ? 0 : listing.price, currency: money.isoCode },
      }),
    )
    after(() => reindexListing(listing.id)) // add the new live listing to AI search
  }

  after(() => dispatchListingEvent('listing.created', listing.id, seller.id)) // notify the shop's partner webhooks
  return { id: listing.id, verified: true }
}

/** Why a seller's DELETE was turned into a hide (deleteListingCore). */
export type { DeleteHoldReason } from '@/lib/delete-hold-copy'

export type DeleteListingResult =
  | { ok: true; deleted: true }
  | { ok: true; deleted: false; hidden: true; reason: DeleteHoldReason }
  | { ok: false; code: 404; error: 'not_found' }
  /** The hide a held delete turns into was refused (hideInsteadOfDelete) — setStatusCore's own answer,
   *  passed through. Today a hide can only be refused as not_found; anything else must not be relabelled. */
  | { ok: false; code: number; error: ListingStatusErrorCode }

/** Plain-English answer for the API/MCP callers (the web dashboard words it itself, bilingual). */
// ⚠️ THESE SENTENCES USED TO SAY "deleting would also erase buyers' reports and chats about it". Since
// 2026-10-01 a delete is a tombstone that erases nothing (src/lib/listing-removed.ts), so that reason
// would now be false — the hold itself stays (an investigated listing stays manageable by the review).
export const DELETE_HOLD_MESSAGE: Record<DeleteHoldReason, string> = {
  account_suspended: 'The listing was hidden, not deleted: this account is under review. It can be deleted once the review is over.',
  account_held: 'The listing was hidden, not deleted: this account is under review. It can be deleted once the review is over.',
  open_report: 'The listing was hidden, not deleted: a report about it or this shop is still open. It can be deleted once the report is resolved.',
}

// The seller-facing, bilingual words for the same outcome live in @/lib/delete-hold-copy (DELETE_HOLD_COPY):
// a plain module, so the web route, the dashboard hook's drift test and the native clients' contract
// can all read them without importing this server-only core.

/**
 * Should this seller-initiated delete become a hide? Same predicate account erasure applies
 * (core/account-erasure.ts, "INVESTIGATION HOLD"), at listing scope: a held or suspended seller, or one
 * with an OPEN report against them or the listing, keeps the listing as a plain hidden row the
 * investigation can still act on. Null = delete (tombstone) as asked.
 * (Historically the reason was that a delete CASCADED the reports and buyers' chats; since 2026-10-01 a
 * delete is a tombstone and destroys nothing, but an investigated listing still stays in the seller's
 * hands as `hidden` rather than leaving their dashboard mid-review.)
 */
async function deleteHoldReason(listingId: string, sellerId: string, ownerId: string | null): Promise<DeleteHoldReason | null> {
  const [owner, openReports] = await Promise.all([
    ownerId ? db.profile.findUnique({ where: { id: ownerId }, select: { enforcementState: true } }) : Promise.resolve(null),
    db.report.count({
      where: {
        status: 'open',
        OR: [{ listingId }, { targetSellerId: sellerId }, ...(ownerId ? [{ targetProfileId: ownerId }] : [])],
      },
    }),
  ])
  const state = normalizeEnforcementState(owner?.enforcementState)
  if (blocksPosting(state)) return state === 'suspended' ? 'account_suspended' : 'account_held'
  if (openReports > 0) return 'open_report'
  return null
}

/** The zero-row delete inside the transaction — thrown to ROLL BACK the report detach before it. */
class DeleteRaced extends Error {}

/**
 * Delete an OWNED listing — or, when it is under investigation (deleteHoldReason), HIDE it instead and
 * say so. The one core behind every seller-initiated delete: the dashboard (DELETE /api/listings/[id]),
 * the partner API (DELETE /api/v1/listings/[id]) and the MCP `delete_listing` tool. Bulk import and the
 * partner sync never delete (the sync RETIRES by hiding).
 *
 * ⛔ A "DELETE" IS A TOMBSTONE (2026-10-01, Law 122/2025 Art 17.1(e) — src/lib/listing-removed.ts):
 * status → 'removed', unpublished, with a compliance_audit row, conditionally on the listing still
 * having no open report (a report filed between the check and the write turns it into a hide). The
 * row, its photos (and video), its reports and every buyer's conversation are KEPT; to the seller and
 * the public it is gone. The partner's externalId is released (kept in the audit row) so a later sync
 * of the same SKU can create a fresh listing, as it could after a hard delete. Then: brand count,
 * cached page, AI search, the partner webhook.
 * ⛔ EXCEPT A TEACHER'S PROFILE LISTING, whose tombstone is SCRUBBED of the person (name, bio, photo,
 * video, location — PERSONAL_SCRUB_DATA) and whose photo and clip are purged: see `personal` below.
 * Tombstones in general are kept for the retention period and then scrubbed the same way
 * (src/lib/core/listing-tombstone-retention.ts).
 */
export async function deleteListingCore(listingId: string): Promise<DeleteListingResult> {
  const gone = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      brandSlug: true, sellerId: true, status: true, listingType: true, seller: { select: { ownerId: true } },
      // A teacher's listing IS their profile — deleting it deletes the profile too (below).
      teacherProfile: { select: { id: true } },
    },
  })
  // Vanished, or ALREADY a tombstone (a second delete, a concurrent one) — a typed not-found; callers
  // that ignore it treat it as an idempotent no-op.
  if (!gone || gone.status === LISTING_REMOVED) return { ok: false, code: 404, error: 'not_found' }

  const hold = await deleteHoldReason(listingId, gone.sellerId, gone.seller.ownerId)
  if (hold) return hideInsteadOfDelete(listingId, gone.status, hold)

  /**
   * ⛔ A TEACHER'S LISTING IS A PERSON, NOT AN ADVERTISEMENT — ITS TOMBSTONE IS SCRUBBED (2026-10-01,
   * review). The row holds the teacher's full name, headline, bio, photo, video and location, and the
   * teacher form promises "Delete your profile, video link and CV for good". A plain tombstone kept all
   * of it indefinitely. So the removal record stays (status 'removed', the audit row) but every column
   * that describes the person is blanked in the same write (PERSONAL_SCRUB_DATA), and the first-party
   * photo and clip are tombstoned for the storage sweep and purged on the fast path below.
   */
  const personal = gone.listingType === TEACHER_LISTING_TYPE || !!gone.teacherProfile
  let scrubbedMedia: string[] = []
  try {
    await db.$transaction(async (tx) => {
      const removed = await tombstoneListingsTx(tx, [listingId], {
        actor: { kind: 'seller', profileId: gone.seller.ownerId, sellerId: gone.sellerId },
        reason: 'seller_deleted',
        releaseExternalId: true,
        where: { reports: { none: { status: 'open' } } },
        ...(personal ? { scrub: { storageReason: 'teacher_profile_deleted' as const } } : {}),
      })
      // ⚠️ THROW, DO NOT RETURN (agy, plan review): a zero-row write must roll the transaction back.
      if (removed.length === 0) throw new DeleteRaced()
      scrubbedMedia = removed[0].scrubbedMedia ?? []
      // ⛔ A TEACHER'S LISTING IS THEIR PROFILE (2026-09-30). The dashboard's generic delete used to
      // remove only the listing, and the FK nulled TeacherProfile.listingId — a "live" profile nobody
      // could see (found on prod the first evening). The profile, its private row and its matches go
      // with it, and the CV is tombstoned for the sweeper, exactly as the teacher's own delete does.
      if (gone.teacherProfile) {
        // Re-read INSIDE the transaction: a CV replaced after the read above would otherwise escape.
        const priv = await tx.teacherPrivate.findUnique({ where: { teacherProfileId: gone.teacherProfile.id }, select: { cvPath: true, videoPath: true } })
        // The CV and a PRIVATE intro video (2026-10-07) — both live only in TeacherPrivate, which dies with the profile.
        const refs = [
          ...(priv?.cvPath ? [{ bucket: TEACHER_CVS_BUCKET, path: priv.cvPath }] : []),
          ...(priv?.videoPath ? [{ bucket: TEACHER_VIDEOS_BUCKET, path: priv.videoPath }] : []),
        ]
        if (refs.length) await writeTombstones(tx, refs, 'teacher_profile_deleted')
        await tx.teacherProfile.deleteMany({ where: { id: gone.teacherProfile.id } })
      }
    })
  } catch (e) {
    if (!(e instanceof DeleteRaced)) throw e
    // Zero rows: the listing vanished / was removed concurrently, or an OPEN report landed after the check.
    const still = await db.listing.findUnique({ where: { id: listingId }, select: { status: true } })
    if (!still || still.status === LISTING_REMOVED) return { ok: false, code: 404, error: 'not_found' }
    return hideInsteadOfDelete(listingId, still.status, 'open_report')
  }
  if (gone.brandSlug) after(() => bumpBrandCount(gone.brandSlug!, -1))
  // ⚠️ A GOODS LISTING'S VIDEO IS NOT EVICTED ANY MORE: it is part of what was posted, kept with the
  // tombstone (the tombstone row still references it, so removeVideoIfOrphaned would find it
  // referenced anyway). A SCRUBBED (teacher) tombstone references nothing: its photo and clip go now —
  // reference-checked, so an object another row still uses is kept — and whatever this fast path does
  // not settle, the StorageTombstones written with the scrub let /api/cron/storage-tombstones finish.
  if (scrubbedMedia.length) {
    const media = scrubbedMedia
    after(async () => {
      try {
        const { settled } = await purgeStorageObjects(media)
        if (settled.length) await clearTombstones(settled)
      } catch (e) {
        logError(e, { op: 'listings.deleteScrubbedMedia' })
      }
    })
  }
  revalidatePublicPath(`/listings/${listingId}`)
  after(() => removeFromIndex(listingId)) // drop the deleted listing from AI search
  after(() => dispatchListingEvent('listing.deleted', listingId, gone.sellerId)) // the listing is gone — pass sellerId explicitly
  return { ok: true, deleted: true }
}

/**
 * The hide a refused delete becomes: out of the public feed, search and its page — everything the
 * seller asked the delete for — with every report and chat intact. Through setStatusCore so the
 * side effects (purge, de-index, webhook) are the ordinary hide's. An already-hidden row is not
 * rewritten. A pulled listing (held seller: active + verified=false) leaves the hold's restore list
 * in effect: restoreListings only republishes rows still 'active'.
 */
async function hideInsteadOfDelete(listingId: string, currentStatus: string, reason: DeleteHoldReason): Promise<DeleteListingResult> {
  if (currentStatus !== 'hidden') {
    // setStatusCore's write is conditional on "not a tombstone" and answers zero rows (gone, or removed
    // concurrently) with a typed 404 rather than a P2025 throw. ⛔ Its refusal is passed through AS IT
    // IS — relabelling every refusal as 404 would turn any future refusal of a hide (a gate, a 400) into
    // the "already gone" answer the callers treat as an idempotent success.
    const r = await setStatusCore(listingId, 'hidden')
    if (!r.ok) return r
  }
  return { ok: true, deleted: false, hidden: true, reason }
}
