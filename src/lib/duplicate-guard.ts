import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import { fold } from './fold'
import { isImageRepost } from './image-hash'

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
  try {
    // One seller-scoped scan (sellerId is indexed; a seller holds at most a few hundred
    // active rows) computing the pg_trgm similarity against the stored searchText; `images`
    // (JSON string of URLs) rides along for the perceptual-hash comparison.
    const rows = await db.$queryRaw<
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
