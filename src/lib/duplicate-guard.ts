import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import { fold } from './fold'
import { isImageRepost } from './image-hash'
import { isVerifiedCatalogueSeller } from './catalogue-seller'

// Duplicate-listing protection: stop a seller re-posting the SAME product while a copy
// of it is still live (the repost-to-bump spam pattern — the legit path is the dashboard
// "confirm available" bump, which refreshes postedAt). Scoped to the seller's own ACTIVE
// listings only, so re-listing after a sale/hide/delete is always allowed, and one
// seller can never be blocked by another seller's items.
//
// Signals (any one ⇒ duplicate). Both are anchored on the TITLE, because repost spam
// virtually always reuses it (verbatim or lightly tweaked), while legit catalogues with
// TEMPLATED descriptions score high on whole-text similarity across DIFFERENT products —
// verified against prod data: a seller's "Clean Cats — Da Nang" vs "Clean Dogs — Da Nang"
// (different products, boilerplate descriptions, same price) score 0.89 on searchText
// trigrams, so a text-similarity-only rule would false-positive. Title-token overlap
// separates them cleanly (0.6) from true reposts (≥0.9):
//   1. Title tokens ≥ 0.9 Jaccard (≈ same title) + same category + price within ±25%.
//   2. searchText trigram similarity ≥ 0.95 + title tokens ≥ 0.7 + price within ±10%
//      (copy-paste whole listing with a slightly reworded title).
// Variants like "iPhone 15 Pro 128GB" vs "…256GB" differ in title tokens AND price → pass.
//
// FAIL-OPEN: any error here must never block a legitimate post — return null and log.

export type DuplicateMatch = { id: string; title: string }

const TITLE_SAME = 0.9 // token-Jaccard ⇒ effectively the same title
const TITLE_NEAR = 0.7 // token-Jaccard floor for the whole-text signal
const SIM_HARD = 0.95 // near-identical searchText (title+description+brand…)
const PRICE_TITLE = 0.25 // ±25% for the same-title signal
const PRICE_SOFT = 0.1 // ±10% for the whole-text signal
// The relaxed price bar for a registry-backed business — the title side is not a threshold at
// all but `titleContains`, for the reason recorded there. Deliberately much tighter than above.
const EXEMPT_PRICE = 0.02 // ±2%: catches "move the price by one dong", clears real variants

function priceDelta(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b, 1)
}

/** Listing.images is a JSON string of URLs; parse defensively (never throw). */
function parseImages(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Token-set Jaccard over accent-folded title words ("clean cats da nang" vs
 *  "clean dogs da nang" → 3/5 = 0.6; a verbatim repost → 1). */
/**
 * Are these the same title, as a word set? (Order and repeats ignored.)
 *
 * ⛔ THIS RULE IS DELIBERATELY THE LENIENT ONE, AFTER TRYING TWO STRICTER ONES AND MEASURING
 * WHAT THEY COST. It only ever applies to registry-backed sellers, and the whole reason that
 * path exists is that the ordinary guard was blocking a real company's catalogue. Three versions:
 *   1. set equality (this one) — a bumper defeats it by appending "#2026".
 *   2. Jaccard ≥ 0.85 — caught one appended word (8/9 = 0.889), missed two ("#2026 v2" = 0.80).
 *   3. token CONTAINMENT — caught appends at any N, but reviewers then produced the case that
 *      matters more: a seller legitimately listing "Airport Transfer" and "Airport Transfer SUV",
 *      or "Sofa Bed" and "Sofa Bed Grey", at the same price. Containment blocks the second one.
 * Version 3 traded a spam channel for a false positive, and a false positive is the failure that
 * started this work — the owner's standing instruction is that launch gates stay as lenient as
 * possible and that false positives get fixed rather than tolerated. So the rule went back to
 * equality, knowingly.
 *
 * ⚠️ SUBSTITUTION AND APPENDING BOTH REMAIN OPEN FOR AN EXEMPT SELLER, AND THAT IS THE TRADE, NOT
 * AN OVERSIGHT. Note also that no threshold could close substitution anyway: a one-token swap in
 * an eight-token title scores 0.778 on Jaccard, and so does the REAL variant this exemption
 * exists to unblock ("Single Entry" vs "Multiple Entry" = 0.778). They are indistinguishable from
 * the title alone. What bounds the risk is WHO is exempt: `officialPartner` is set by hand and
 * `isBusinessVerified` needs a live tax-registry match, so abuse here is a named, revocable
 * account doing the most visible thing a seller can do. This rule catches the ACCIDENT — the
 * double-submit — and leaves deliberate abuse by a vetted partner to moderation, which is the
 * correct division of labour between a spam heuristic and a contract.
 */
function titleSameWords(a: string, b: string): boolean {
  const ta = new Set(fold(a).split(' ').filter(Boolean))
  const tb = new Set(fold(b).split(' ').filter(Boolean))
  if (!ta.size || !tb.size || ta.size !== tb.size) return false
  for (const t of ta) if (!tb.has(t)) return false
  return true
}

function titleJaccard(a: string, b: string): number {
  const ta = new Set(fold(a).split(' ').filter(Boolean))
  const tb = new Set(fold(b).split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

/**
 * Do these two listings describe different taxonomy VARIANTS?
 *
 * True only when both sides actually carry facets and those facets differ. Absent or empty
 * attributes on either side return false, so a category without facets is completely
 * unaffected and the guard behaves exactly as before for it.
 */
function differsByFacet(candidate: Record<string, string> | null | undefined, existingJson: string | null): boolean {
  if (!candidate || Object.keys(candidate).length === 0) return false
  let existing: Record<string, string>
  try {
    const parsed = existingJson ? JSON.parse(existingJson) : null
    if (!parsed || typeof parsed !== 'object') return false
    existing = parsed as Record<string, string>
  } catch {
    return false // unreadable attributes must not silently WAIVE the guard
  }
  if (Object.keys(existing).length === 0) return false
  // ⚠️ ONLY KEYS PRESENT ON BOTH SIDES COUNT, AND THAT CLOSES A REAL BYPASS. The first version
  // treated "absent on the existing row" as different — so a candidate that simply ADDED a key
  // the old listing never had (`{color:'x'}`, anything) waived the guard completely, since this
  // check short-circuits every other signal including the image one. Two reviewers found it
  // independently, and it is worse than the false-positive it was written to fix: one blocks a
  // real seller, the other hands every seller a one-field spam bypass.
  //
  // Requiring a SHARED key with a differing value is the honest test of "different variant":
  // both listings describe the same facet and disagree about it (single vs multiple entry,
  // 1H vs 2D). A key only one side declares says nothing about whether the products differ —
  // it is an incomplete comparison, not evidence.
  //
  // ⚠️ KNOWN LIMIT, not closed here: these keys are not validated against the CATEGORY's real
  // taxonomy, so a direct-API caller could still post two listings that both declare an invented
  // facet with different values. That is a narrower hole than the one being fixed (it needs two
  // cooperating listings and leaves an obviously bogus facet on both, visible to moderation),
  // but validating against the facet list for the category is the proper closure.
  for (const [k, v] of Object.entries(candidate)) {
    if (!(k in existing)) continue // one-sided key: not evidence either way
    if (String(existing[k] ?? '') !== String(v ?? '')) return true
  }
  return false
}

export async function findDuplicateListing(input: {
  sellerId: string
  categoryId: string
  title: string
  /** Candidate searchText built with the SAME buildSearchText recipe the create uses. */
  searchText: string
  price: number
  /** The new listing's stored image URLs — their embedded dHashes drive the IMAGE signal
   *  (catches a repost that reuses the same photos but reworded the title/price). */
  images: string[]
  /**
   * The candidate's taxonomy attributes (the create's `attributes` JSON, already parsed).
   *
   * ⚠️ THIS EXISTS BECAUSE THE GUARD WAS BLOCKING LEGITIMATE VARIANTS. Reported 2026-08-11:
   * an official partner could not post a NINTH e-visa product even with a different photo.
   * Their catalogue is eight rows that differ ONLY by facet — single/multiple entry × 1 hour,
   * 2 hours, 1 day, 2 days — and they naturally share product artwork. Measured against the
   * real rows: no PAIR trips the title or text signals at all, so the culprit is the IMAGE
   * signal, whose bar is only "2+ photos in common and a bare majority" (isImageRepost).
   * Swapping one image cannot clear that when the rest of the set legitimately repeats.
   *
   * A listing that differs in its structured facets is a different PRODUCT, not a repost —
   * which is exactly what the taxonomy exists to express — so a facet difference is now
   * enough to say "not a duplicate", whatever the photos look like.
   *
   * ⚠️ It does weaken the guard against a determined bumper who edits one facet per repost.
   * That is an accepted trade rather than an oversight: facets are a small closed set per
   * category and changing one changes what the listing CLAIMS to be, which is visible to
   * buyers and to moderation. Blocking real sellers from their own catalogue is the worse
   * failure, and the text/price signals still apply to genuine same-facet reposts.
   */
  attributes?: Record<string, string> | null
  excludeId?: string
}): Promise<DuplicateMatch | null> {
  const { sellerId, categoryId, title, searchText, price, images, attributes, excludeId } = input
  // ⛔ THE EXEMPTION LOOKUP HAS ITS OWN try/catch AND MUST KEEP IT — DO NOT FOLD IT INTO THE ONE
  // BELOW. Inside that block, a thrown error returns null, i.e. "no duplicate", so a single failed
  // seller query would silently disable duplicate detection FOR EVERY SELLER ON THE PLATFORM while
  // every request still returned 200. Both external reviewers found this independently and called
  // it the ship-blocker in the change; it is the difference between a degraded feature and an
  // invisible one. The two failure directions are not symmetric, so they get opposite defaults:
  // the SCAN fails open (never block a legitimate post over a database blip) and the EXEMPTION
  // fails closed (an unproven seller is treated as ordinary, so the full guard still runs).
  let exactOnly = false
  try {
    exactOnly = await isVerifiedCatalogueSeller(sellerId)
  } catch (e) {
    console.error('[duplicate-guard] exemption lookup failed (applying the full guard)', e)
  }
  try {
    // ⚠️ A REGISTRY-BACKED BUSINESS GETS THE EXACT-REPOST RULE ONLY, AND THE NUMBERS BELOW ARE WHY.
    // Reported twice by the owner (2026-08-11) — an official partner could not add a product to
    // an eight-row e-visa catalogue, and swapping the photo did not help. Measured against the
    // real rows rather than reasoned about, which corrected an earlier wrong diagnosis of mine:
    //   · The IMAGE signal CANNOT be the cause. Each row carries exactly one photo and
    //     `isImageRepost` needs `count >= 2`, so it is unreachable for a single-image listing.
    //   · The TEXT signal is the one living in the danger zone. pg_trgm similarity between these
    //     catalogue rows measures 0.962–0.987 (SELECT similarity over the 28 pairs), against a
    //     SIM_HARD bar of 0.95. A catalogue is BUILT out of near-identical rows — that is what
    //     makes it a catalogue — so every new row this seller adds arrives pre-loaded above the
    //     threshold, and only the ±10% price window is keeping it out of a false positive.
    // A guard tuned for anonymous repost-to-bump spam has no business adjudicating a company's
    // product grid. But a blanket waiver is the wrong correction too: the one duplicate a real
    // business genuinely produces is the accidental double-submit (two taps on Publish), and
    // that is precisely what the strictest rule catches. So the guard is RELAXED, not removed —
    // same category, near-identical title, near-identical price still blocks; a variant never does.
    // One seller-scoped scan (sellerId is indexed; a seller holds at most a few hundred
    // active rows) computing the pg_trgm similarity against the stored searchText; `images`
    // (JSON string of URLs) rides along for the perceptual-hash comparison.
    //
    // ⚠️ THE CANDIDATE WINDOW HAS TO MATCH THE RULE THAT WILL JUDGE IT, WHICH IS WHY THERE ARE
    // TWO. `ORDER BY similarity DESC LIMIT 25` is the right window for the ordinary signals —
    // they are all keyed on text. It is the WRONG window for `exactOnly`, which keys on
    // (category, title tokens, price) and is uncorrelated with text similarity once descriptions
    // differ: an exempt seller with more than 25 active rows could re-submit the same title and
    // price with an edited description, rank below the cut, and post twice — the ONE duplicate
    // this rule promises to still catch. And exempt sellers are exactly the ones with big
    // catalogues, since the same predicate also waives their listing cap.
    // So the relaxed path asks the database the question it actually needs: same category, price
    // inside the window, no ordering, no limit. It is cheaper too — `sellerId` is indexed and the
    // predicate is narrow — and it drops the pg_trgm call that path never reads.
    //
    // ⚠️ THE PRICE BAND'S UPPER EDGE IS price/(1-p), NOT price*(1+p), AND THE ASYMMETRY MATTERS.
    // `priceDelta` normalises by the LARGER of the two prices, so for an existing row b above the
    // candidate a the loop's test is (b-a)/b <= p, i.e. b <= a/(1-p) — very slightly wider than
    // a*(1+p). A symmetric band would drop rows at ~1.0203a that the loop would then have
    // accepted, letting a duplicate escape via the WINDOW rather than the rule. A prefilter must
    // be a strict SUPERSET of the predicate it feeds; that is the only safe relationship.
    // ⚠️ And keep prose OUT of the Prisma.sql template: a backtick in an SQL comment closes the
    // template literal, which is how this first landed as a parse error rather than a bug.
    const rows = exactOnly
      ? await db.$queryRaw<
          { id: string; title: string; price: number; categoryId: string; images: string | null; attributes: string | null; score: number }[]
        >(Prisma.sql`
          SELECT id, title, price, "categoryId", images, attributes, 0::float4 AS score
          FROM "Listing"
          WHERE "sellerId" = ${sellerId} AND status = 'active'
            AND "categoryId" = ${categoryId}
            AND price BETWEEN ${Math.floor(price * (1 - EXEMPT_PRICE))} AND ${Math.ceil(price / (1 - EXEMPT_PRICE))}
            ${excludeId ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
        `)
      : await db.$queryRaw<
          { id: string; title: string; price: number; categoryId: string; images: string | null; attributes: string | null; score: number }[]
        >(Prisma.sql`
          SELECT id, title, price, "categoryId", images, attributes, similarity("searchText", ${searchText}) AS score
          FROM "Listing"
          WHERE "sellerId" = ${sellerId} AND status = 'active'
            ${excludeId ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
          ORDER BY score DESC
          LIMIT 25
        `)

    for (const r of rows) {
      // ⚠️ A DIFFERENT FACET SET MEANS A DIFFERENT PRODUCT — checked FIRST, so it short-circuits
      // every signal below including the image one. See the `attributes` doc on the input.
      if (differsByFacet(attributes, r.attributes)) continue
      const score = Number(r.score) || 0
      const dPrice = priceDelta(price, Number(r.price) || 0)
      const tj = titleJaccard(title, r.title)
      // The relaxed rule (see `exactOnly` above): a row that is, to a near approximation, the
      // same listing. Nothing else is consulted — not the text score, not the photos.
      //
      // ⚠️ CONTAINMENT + A PRICE WINDOW, AND BOTH HALVES CLOSE A BYPASS REVIEWERS FOUND. The
      // first version demanded an identical token set and an identical price, which a bumper
      // defeats without effort: append one junk token ("… 2 Business Days #2026", then #2027),
      // or move the price by a single dong, and the repost sails past every signal forever.
      //   · TITLE by word-set equality — see `titleSameWords` for the two stricter rules that
      //     were tried first and why each was reverted. Short version: anything strict enough to
      //     stop an appended "#2026" also blocks "Airport Transfer" beside "Airport Transfer
      //     SUV", and a false positive is the bug this exemption exists to fix.
      //   · PRICE at 2% — kills the one-dong dodge, which needs no wording change at all.
      //     Measured against the real rows, the CLOSEST pair in that catalogue differs by 11.6%,
      //     so a genuine variant has enormous headroom.
      // Both are far tighter than the ordinary guard's (0.7 title / ±10% price), which is the
      // point: this still only catches a listing a seller could not honestly call new.
      if (exactOnly) {
        if (r.categoryId === categoryId && titleSameWords(title, r.title) && dPrice <= EXEMPT_PRICE) return { id: r.id, title: r.title }
        continue
      }
      // 3. IMAGE signal — MOST of the same photos reused in the same category is a repost
      //    regardless of how the title/price were reworded (you don't have the same set of
      //    shots for two different products). Majority rule (see isImageRepost) so a shop's
      //    shared banner/logo image never trips it. Price/title-independent, so it catches
      //    the case the text signals miss; an image repost can score low on text, so this
      //    scans all 25 candidates, not just the top text match.
      if (r.categoryId === categoryId && images.length > 0 && isImageRepost(images, parseImages(r.images))) {
        return { id: r.id, title: r.title }
      }
      if (tj >= TITLE_SAME && r.categoryId === categoryId && dPrice <= PRICE_TITLE) {
        return { id: r.id, title: r.title }
      }
      if (score >= SIM_HARD && tj >= TITLE_NEAR && dPrice <= PRICE_SOFT) {
        return { id: r.id, title: r.title }
      }
    }
    return null
  } catch (e) {
    console.error('[duplicate-guard] check failed (allowing post)', e)
    return null
  }
}
