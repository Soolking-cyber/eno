import { beforeAll, describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * ⛔ EVERY WRITE THAT CAN PUT A LISTING IN FRONT OF THE PUBLIC IS ON THIS LIST, OR THIS TEST FAILS.
 *
 * A listing is public iff `verified = true AND status = 'active'`, and there is no central read-side
 * predicate — the feed, search, the sitemap, the product feeds and the PDP each filter for themselves.
 * So the seller identity gate (src/lib/compliance/seller-publish-gate.ts) sits on the WRITES, and it
 * is only as complete as the list of writes it was wired into. That list was built by hand in a
 * 2026-09-23 audit; this test is what keeps it true afterwards. A new file that writes
 * `verified: true` or `status: 'active'` into a Listing fails here until someone decides — and
 * records below — whether it must ask the gate (refuse or hold) or is outside it by design.
 *
 * The counts are EXACT, in both directions: one more write in an audited file is a new path to
 * audit, and one fewer means the list describes code that no longer exists.
 *
 * ── WHAT IT SEES ─────────────────────────────────────────────────────────────────────────────────
 *   · Prisma writes — `<x>.listing.create|createMany|update|updateMany|upsert(…)` and the
 *     `…AndReturn` forms of createMany/updateMany — whose ARGUMENTS contain `verified: true` or
 *     `status: 'active'`, with the read-shaped sub-objects (`where`,
 *     `select`, `include`, `orderBy`, `cursor`) blanked first. The argument list is brace-matched,
 *     so multi-line object literals and ternaries (`data: held ? {…} : { verified: true }`) count.
 *   · Raw SQL `UPDATE "Listing" … SET …` whose SET clause (up to WHERE/FROM/RETURNING) contains
 *     `verified = true` or `status = 'active'` — the SET only, so `WHERE status = 'active'` is a read.
 *   · Every raw `INSERT INTO "Listing" (` — its columns cannot be audited by a regex, so each insert
 *     is listed by name.
 *   · `data.status = 'active'` / `data.verified = true` — the build-the-payload-then-write shape.
 *   · The same shape by LITERAL: an object carrying both `verified: true` and `status: 'active'` (or
 *     an expression that can yield 'active') anywhere in a file that writes Listing rows — how the
 *     importers build `payload` and then `db.listing.update({ data: payload })`.
 *   · NESTED writes through a Seller: `seller.create|update|updateMany|upsert({ … listings: { … } })`
 *     with a public literal inside `listings`.
 *   · Raw SQL with a schema prefix (`public."Listing"`) as well as without.
 * And, in its own list (AUDITED_CLAIMS), every write that hands an existing STOREFRONT to an account
 * (`ownerId` set by seller.update/updateMany/upsert, or raw `UPDATE "Seller" SET "ownerId"`): a claim
 * re-parents every live listing on it, and the gate's first wiring found two of the three.
 * And, for the LICENCE CHECK (owner, 2026-10-14 — src/lib/licence-stamp.ts), two more: every existing-row
 * publish must carry its guard (`publishesWithoutLicenceGuard`, exemptions in LICENCE_GUARD_EXEMPT), and a
 * non-null approval stamp is written in one place only (`stampWrites`, STAMP_WRITERS).
 * And for the teacher card's "Identity verified" tick (owner, 2026-10-15 — src/lib/teachers/identity-mark-card.ts): a
 * non-null Listing.identityMarkNotice — the card cache that makes a card claim "eno checked this person's ID" — is
 * written in one place only (`markWrites`, MARK_WRITERS).
 *
 * ── WHAT IT CANNOT SEE (stated so nobody mistakes it for a proof) ────────────────────────────────
 *   · A value that is not a literal: `data: { status }` (setStatusCore's shorthand), a status read
 *     from input, a payload that sets only ONE of the two columns outside the call (`const p =
 *     { verified: true }` → `update({ data: p })`), or a payload spread in from another module.
 *     setStatusCore is gated in code.
 *   · A payload literal in a file with no RECOGNISED listing write (the write lives in a helper in
 *     another file); a nested write through any model other than Seller.
 *   · A claim whose `ownerId` is not in the call (`data: payload`), or one made by `create` with a
 *     nested `connect` — only the direct write of `ownerId` onto an existing Seller is seen.
 *   · Brace matching skips string contents but not `${…}` inside template literals, and the
 *     enclosing-object search walks raw braces — a `'{'` string beside a payload can mis-scope it.
 *   · A write through a raw client this scan does not recognise (a Prisma `$executeRawUnsafe` string
 *     assembled at runtime, a stored procedure, a trigger).
 *   · Files outside src/ and scripts/, and test files (fixtures are not a publish path).
 * It is a tripwire for the ordinary way a publish path gets added, not a proof that none exists.
 */

const ROOT = process.cwd()

/**
 * The audited writes. Every entry says which way it went: GATED (refuse / hold through the seller
 * identity gate), or OUTSIDE by design and why. Paths are repo-relative with forward slashes.
 */
const AUDITED: Record<string, { count: number; why: string }> = {
  // ── Gated ──
  // (Since 2026-10-14 every EXISTING-row publish below also carries the licence check's guard — licenceClearedWhere /
  // licenceClearedSql, held to it by `publishesWithoutLicenceGuard` further down — and the creates hold a licence-aisle
  // row unpublished: owner, "Anyone posts, live after check".)
  'src/lib/core/listings.ts': { count: 2, why: 'createListingCore insert (assertSellerMayPublish, guests refused; a non-desk e-Visa / Legal & permits post is inserted verified:false — licenceCheckHold) + confirmCore revive (identityGateForRevive → refuse; licenceClearedWhere in the write, R1)' },
  'src/lib/teachers/publish.ts': { count: 1, why: 'saveTeacherProfile insert — assertSellerMayPublish (signed-in owner only); edits never touch status/verified, and setTeacherStatus(live) passes the same gate and cannot lift a moderation pull (verified:false) nor re-show a profile with no job goal and no public cover (D6 — TeacherNoGoalError, under the account lock)' },
  'src/lib/core/bulk.ts': { count: 1, why: 'bulkImportCore insert — whole batch refused before the loop (sellerPublishDecision)' },
  'src/app/api/admin/listings/route.ts': { count: 4, why: 'admin activate/verify — partitionByIdentityGate, refused owners are HELD (identityHold); uncleared licence-aisle rows left out (licenceBlockedIds) and every write ANDs licenceClearedWhere (activate since R1, 2026-10-14); verify is publishListings, which licence-approve reuses' },
  'src/app/api/admin/moderate/route.ts': { count: 1, why: 'moderation approve — partitionByIdentityGate, refused owner HELD; an uncleared licence-aisle row answers 409 licence_check_required before any write, and the write ANDs NOT_REMOVED + licenceClearedWhere' },
  'src/lib/enforcement.ts': { count: 2, why: 'restoreListings (lift/expiry) + applyEnforcement downgrade restore — refused owners HELD; uncleared licence-aisle rows neither published nor parked, both writes AND licenceClearedWhere' },
  'src/lib/compliance/identity-holds.ts': { count: 1, why: 'releaseIdentityHolds — the gate’s own release, only after the owner is verified; an uncleared licence-aisle row stays parked (licenceBlockedIds + licenceClearedWhere)' },
  'scripts/publish-held.ts': { count: 2, why: 'bulk publish of held rows — refused owners PARKED unless --gate=off; + the post-park re-check release for owners verified mid-run; uncleared licence-aisle rows skipped, both UPDATEs AND licenceClearedSql (no desk branch: fails closed)' },
  'scripts/release-identity-holds.ts': { count: 1, why: 'manual release of identity holds after the gate is switched OFF; refuses while enforced; only licenceCleared rows, the UPDATE ANDs licenceClearedSql' },
  'scripts/seed-app-review-thread.mjs': { count: 1, why: 'App Review demo seat (docs/ios-appstore-release.md P11): ONE create-only listing on the script’s own test storefront (owner app-review-seller@eno.vn, seed-marked auth user) so the reviewer can test Block on a non-staff seller — --apply needs the operator to state --gate=off and REFUSES --gate=on, the gate’s own answer for this account (created on/after 2026-09-28, never verified → decideOwned refuses); a re-run never republishes a hidden row' },
  // ── Outside the gate by design ──
  'src/app/api/cron/partner-stock/route.ts': { count: 1, why: 'restock of OWNERLESS partner storefronts only — no person to verify' },
  'src/lib/affiliate-price-refresh.ts': { count: 1, why: 'restore of OWNERLESS affiliate storefronts only — no person to verify' },
  'scripts/import-rever-rentals.ts': { count: 2, why: 'reference-listing importer onto a platform-owned (ownerless) seller' },
  'scripts/import-batdongsan-rentals.ts': { count: 3, why: 'reference-listing importer onto a platform-owned (ownerless) seller — create-only status/verified (2) + the --max-age-days revival (updateMany, status re-checked in the write), which re-activates ONLY rows this pipeline took down — expired (the 7-day fresh-set expiry or the daily age sweep) or stale (retire-stale-batdongsan.ts) — when the listing is freshly posted again: any place type since 2026-10-13 (houses/rooms/offices only when the 3-day job runs with APT_PLACES=1), never with under a day of its window left at the write (tooLateToWrite), never a hidden/moderated row' },
  'scripts/import-nhatot-com.ts': { count: 5, why: 'reference-listing importer onto an ownerless platform seller — create-only status/verified (2) + the dry-run sample literal + the retire rollback .sql line (un-hides only while hidden) + the 7-day-rule revival updateMany (only expired|stale → active, status re-checked in the write; any place type since 2026-10-13 — apartment, house, office, room — whose list_time is inside the 7-day window at its stage’s fetch and that keeps at least a day of it at the write, tooLateToWrite); refuses an owned or badged seller' },
  'scripts/import-muaban-net.ts': { count: 4, why: 'reference-listing importer onto an ownerless platform seller — the upsert’s create-only status/verified (2) + the dry-run sample literal + the 7-day-rule revival updateManyAndReturn (only from the status just read, expired|stale → active; any place type since 2026-10-13 whose created_at is inside the 7-day window at the crawl’s moment — the apartment set’s crawl, or the set-less --fresh-crawl of houses/rooms/offices — and that keeps at least a day of it at the write, tooLateToWrite); refuses an owned or badged seller' },
  'scripts/muaban-net-map.ts': { count: 1, why: 'reference-listing importer onto an ownerless platform seller — retireRollbackSql, the printed undo of a retire pass, scoped to that seller’s rows still hidden' },
  'scripts/import-honeycomb-com-vn.ts': { count: 5, why: 'reference-listing importer onto an ownerless platform seller — create-only status/verified (2) + the dry-run sample literal + the 7-day-rule revival updateMany (only expired|stale → active, lastmod inside the fresh set’s window) + the retire rollback .sql line (un-hides only while hidden and updatedAt is still what the retire wrote); refuses an owned or badged seller' },
  'scripts/import-vehicle-rentals.ts': { count: 2, why: 'reference-listing importer (HCMC car + motorbike hire) onto ownerless per-source platform sellers pinned by id — the create-only status/verified (2); refuses an owned, renamed or badged seller' },
  'scripts/vehicle-rentals-status.ts': { count: 2, why: 'the every-3-days vehicle refresh (owner 2026-10-13) over the ownerless vehicle import storefronts pinned by id (VEHICLE_SELLERS, ownerless + affiliateUrl re-checked) — the revival (only expired → active, for a car that passes the reliability rule again or a bike listed again, only a row this run’s import just refreshed, status + updatedAt re-checked in the write) + --rollback of an expiry (back to active only while still expired with the batch’s own stamp); never a hidden or removed row' },
  'scripts/import-jobs.ts': { count: 3, why: 'reference-listing importer (linked job postings) onto ownerless per-board platform sellers — the create-only status/verified (2) + the dry-run sample literal; refuses an owned or badged seller (sellerRefusal)' },
  'scripts/hide-imageless-imports.ts': { count: 2, why: 'operator repair script over the platform import sellers' },
  'scripts/retire-stale-batdongsan.ts': { count: 1, why: 'retire of the ownerless Batdongsan import seller’s apartment rows (pinned by id) to status stale — only the rollback .sql it WRITES TO A FILE, re-activating exactly those ids while still stale' },
  'scripts/expire-apartment-rentals.ts': { count: 1, why: 'the 7-day rule over the ownerless rental import sellers (pinned by id), apartments only — only the rollback .sql it WRITES TO A FILE, re-activating exactly the rows it marked that are still expired; the script itself only ever sets expired' },
  'scripts/retire-rever-rentals.ts': { count: 2, why: 'liveness check over the ownerless Rever.vn reference seller (pinned by id), apartments only — the rollback .sql it WRITES TO A FILE (re-activating exactly the rows it marked, while still stale and unchanged since) + the 7-day-rule revival (expired|stale → active only when the listing’s own badge says available AND its Cập nhật date is inside the window)' },
  'scripts/seed-visa-shop.mjs': { count: 4, why: 'services-edition desk seed (platform seller)' },
  'scripts/seed-trip-desk.mjs': { count: 2, why: 'services-edition trip desk seed (platform seller)' },
  'scripts/ci-fixtures.ts': { count: 5, why: 'CI fixture data on a disposable database (2 inline + 3 payload literals; the third is the imported rental ci-l-import, P2)' },
  'scripts/import-partners.ts': { count: 1, why: 'partner-catalogue importer — payload literal; refuses a storefront with an ownerId' },
  'scripts/import-supersports.ts': { count: 1, why: 'affiliate importer — payload literal; refuses a storefront with an ownerId' },
  'scripts/import-accesstrade.ts': { count: 1, why: 'affiliate importer — payload literal; refuses a storefront with an ownerId' },
  'scripts/seed-vinwonders.ts': { count: 1, why: 'partner storefront seed — payload literal; the seller stays ownerless (refuses an owned one)' },
  'scripts/seed-hoangphi.ts': { count: 2, why: 'owner-requested offer (2026-10-01) on ONE owned official-partner storefront pinned by seller id AND owner email (lawyer-review@eno.vn); create-only status/verified — and in a licence aisle (Legal & permits) the create is verified:false until the firm’s values are approved; the update never writes verified/status nor moves the row, and keeps the provider values (and so the stamp); operator act — a signed partner, outside the seller identity gate like the other partner seeds' },
  'scripts/import-esim.ts': { count: 2, why: 'carrier eSIM/plan reference listings onto ownerless partner storefronts — the upsert’s create-only status/verified; refuses an owned or ambiguously named storefront' },
  'scripts/e2e-seed.mjs': { count: 1, why: 'e2e fixture on a disposable target' },
  'scripts/test-account-delete.mjs': { count: 1, why: 'throwaway listing for the account-deletion test' },
}

/** Every write that hands an existing storefront to an account. All real ones go through the gate. */
const AUDITED_CLAIMS: Record<string, { count: number; why: string }> = {
  'src/lib/compliance/seller-publish-gate.ts': { count: 2, why: 'claimGuestStorefront — the ONE claim path (login auto-claim, post-time claim, business onboarding all call it); parks live listings in the claim transaction when the gate refuses the account' },
  'scripts/ci-fixtures.ts': { count: 2, why: 'CI fixture seller on a disposable database (the update and create halves of one upsert)' },
}

/**
 * ⛔ EXISTING-ROW PUBLISHES THAT NEED NO LICENCE GUARD — each one a write that can never touch an e-Visa or Legal &
 * permits listing BY CONSTRUCTION (owner, 2026-10-14; R5, plan review 2026-10-14). Everything else that sets
 * `verified: true` or `status: 'active'` on an existing listing carries licenceClearedWhere / licenceClearedSql, or this
 * test fails (`publishesWithoutLicenceGuard`). "Not today" is not a reason: name the construction that keeps it out.
 * The counts are exact, as AUDITED's are.
 */
const LICENCE_GUARD_EXEMPT: Record<string, { count: number; why: string }> = {
  // eno's own desk — exempt from the check by the owner's decision (deskSellerIds), and these seeds write only its rows.
  'scripts/seed-visa-shop.mjs': { count: 2, why: 'the services-edition e-Visa DESK seed — only the desk storefront’s own rows (resolved by owner email), which the licence check exempts; its products and its generic anchor' },
  'scripts/seed-trip-desk.mjs': { count: 1, why: 'the trip DESK seed — only the desk storefront’s anchor row (hidden, price 0)' },
  // Ownerless goods storefronts: their rows are placed by src/lib/feed-taxonomy.ts categoryFor, which has no services
  // rule at all, and an ownerless storefront has nobody to edit a row into another aisle.
  'src/app/api/cron/partner-stock/route.ts': { count: 1, why: 'restock (sold → active) of the ownerless scraped partner shops’ imported goods — placed by feed-taxonomy (no services rule), never in a licence aisle' },
  'src/lib/affiliate-price-refresh.ts': { count: 1, why: 'restore (sold → active) of the ownerless affiliate storefronts’ datafeed goods — placed by feed-taxonomy (no services rule), never in a licence aisle' },
  // The reference-listing pipelines: ownerless import storefronts pinned by id (src/lib/import-sellers.ts and the
  // vehicle sellers), each writing only its own real-estate, vehicle or job rows — never a services row.
  'scripts/expire-apartment-rentals.ts': { count: 1, why: 'the 7-day rule’s rollback .sql over the ownerless rental import sellers’ apartments (pinned by id)' },
  'scripts/hide-imageless-imports.ts': { count: 2, why: '--restore and the printed rollback, over IMPORT_SELLERS’ rows only (the rental storefronts; job rows excluded) — no services row' },
  'scripts/import-batdongsan-rentals.ts': { count: 1, why: 'the revival of its own ownerless Batdongsan rental rows (sellerId pinned in the write)' },
  'scripts/import-honeycomb-com-vn.ts': { count: 2, why: 'the revival and the retire rollback .sql of its own ownerless Honeycomb rental rows (sellerId pinned in the write)' },
  'scripts/import-muaban-net.ts': { count: 1, why: 'the revival of its own ownerless Muaban rental rows (sellerId pinned in the guard)' },
  'scripts/import-nhatot-com.ts': { count: 2, why: 'the revival and the retire rollback .sql line of its own ownerless Nhà Tốt rental rows (sellerId pinned in the write)' },
  'scripts/muaban-net-map.ts': { count: 1, why: 'retireRollbackSql — the printed undo of a Muaban retire pass, pinned to that ownerless seller' },
  'scripts/retire-rever-rentals.ts': { count: 2, why: 'the rollback .sql and the revival of the ownerless Rever seller’s apartment rows (sellerId + apartment subcategory pinned)' },
  'scripts/retire-stale-batdongsan.ts': { count: 1, why: 'the rollback .sql of a stale retire over the ownerless Batdongsan seller (pinned by id)' },
  'scripts/vehicle-rentals-status.ts': { count: 2, why: 'the revival and the expiry rollback over the ownerless vehicle import storefronts (VEHICLE_SELLERS, pinned by id) — car and motorbike hire' },
}

/**
 * ⛔ THE ONE STAMP WRITER (owner, 2026-10-14 — src/lib/licence-stamp.ts). Listing.verificationMethod is REPURPOSED as the
 * licence check's approval stamp, so a non-null write to it IS an approval. Only 'licence-approve' may make one, after an
 * admin compared the values with the provider's licence; every other writer only clears it (null).
 */
const STAMP_WRITERS: Record<string, { count: number; why: string }> = {
  'src/app/api/admin/listings/route.ts': { count: 1, why: '‘licence-approve’ — the compare-and-set stamp of exactly the values the admin’s screen showed, with a compliance_audit row naming the admin' },
}

/**
 * ⛔ THE ONE WRITER OF THE TEACHER CARD'S "IDENTITY VERIFIED" TICK (owner, 2026-10-15; AUTOMATIC since 2026-10-16).
 * Listing.identityMarkNotice is a display cache, and a non-null value in it makes a teacher's card tell every reader "eno
 * checked this person's ID" — so only the file that derives it from the ONE predicate (src/lib/teachers/identity-mark.ts:
 * a live identity, the name within the ID, not hidden by the teacher) may write one. Every other writer only clears it
 * (null — the erasure scrub, PERSONAL_SCRUB_DATA). The count is exact: a second non-null write is a second source of truth.
 */
const MARK_WRITERS: Record<string, { count: number; why: string }> = {
  'src/lib/teachers/identity-mark-card.ts': { count: 1, why: 'writeIdentityMarkCard — the raw, IS DISTINCT FROM-guarded UPDATE of today’s IDENTITY_MARK_NOTICE_VERSION while identityMarkState says shown (NULL otherwise; never a value onto a tombstone), inside the caller’s transaction under the teacher lock; its callers are the switch (hide / show again), every profile save, the identity effects and the nightly card passes (and the profile delete, NULL only)' },
}

// ── The scanner ──────────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'generated' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

/**
 * Blank comments (keeping offsets and newlines) so a file that TALKS about a write is not one. A string literal is kept
 * whole (a quote inside it opens nothing), so `'//'` is not a comment.
 * ⚠️ MEMOISED PER SOURCE, AND CHUNKED (2026-10-14): six scanners read the same ~22 MB, and the char-by-char version,
 * run six times, took this file past vitest's 5s per test under a parallel run. The chunked form was checked byte-for-
 * byte against the char-by-char one over every scanned file before it replaced it.
 */
const stripped = new Map<string, string>()
function stripComments(src: string): string {
  let out = stripped.get(src)
  if (out === undefined) stripped.set(src, (out = stripCommentsOnce(src)))
  return out
}
function stripCommentsOnce(src: string): string {
  const parts: string[] = []
  let last = 0
  const special = /['"`]|\/[/*]/g
  for (let m = special.exec(src); m; m = special.exec(src)) {
    const i = m.index
    const q = src[i]
    if (q !== '/') {
      // A string: skip to its closing quote (escapes honoured) and keep it as it is.
      let j = i + 1
      while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++ }
      special.lastIndex = j + 1
      continue
    }
    // `//` to the end of the line, or `/* … */` — blanked, newlines kept.
    const close = src[i + 1] === '/' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2)
    const end = close < 0 ? src.length : src[i + 1] === '/' ? close : close + 2
    parts.push(src.slice(last, i), src.slice(i, end).replace(/[^\n]/g, ' '))
    last = end
    special.lastIndex = end
  }
  parts.push(src.slice(last))
  return parts.join('')
}

/** Index of the bracket closing the one at `open`, skipping string contents; -1 if unbalanced. */
function matchBalanced(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack: string[] = []
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      i++
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ }
      continue
    }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1
      if (!stack.length) return i
    }
  }
  return -1
}

const PUBLIC_LITERAL = /\bverified\s*:\s*true\b|\bstatus\s*:\s*['"]active['"]/g
const READ_KEYS = /\b(where|select|include|orderBy|cursor)\s*:\s*\{/
/** `"Listing"`, `Listing`, `public."Listing"`, `"public"."Listing"` — a schema prefix is optional. */
const LISTING_TABLE = String.raw`(?:"?public"?\.)?"?Listing"?`
// ⚠️ THE `…AndReturn` FORMS ARE WRITES TOO. The admin batch parks with updateManyAndReturn (it needs
// the ids it actually changed), and without them in this list the scan would silently drop that
// write from its count — and miss any future publish written the same way.
const LISTING_WRITE_CALL = /\b\w+\.listing\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(/g

/** Blank every read-shaped sub-object (`where: {…}`, `select: {…}`, …) in place, offsets kept. */
function blankReads(text: string): string {
  let out = text
  let from = 0
  for (;;) {
    const re = new RegExp(READ_KEYS.source, 'g')
    re.lastIndex = from
    const r = re.exec(out)
    if (!r) break
    const o = r.index + r[0].length - 1
    const c = matchBalanced(out, o)
    if (c < 0) { from = o + 1; continue }
    out = out.slice(0, r.index) + ' '.repeat(c + 1 - r.index) + out.slice(c + 1)
    from = r.index
  }
  return out
}

/** Every `<x>.<model>.<method>(…)` call as [open, close, method], argument list brace-matched. */
function calls(src: string, re: RegExp): Array<{ open: number; close: number; method: string }> {
  const out: Array<{ open: number; close: number; method: string }> = []
  for (const m of src.matchAll(re)) {
    const open = m.index! + m[0].length - 1
    const close = matchBalanced(src, open)
    if (close >= 0) out.push({ open, close, method: m[1] })
  }
  return out
}

/** Index of the innermost `{` enclosing `at`, or -1. Comments are already blanked. */
function enclosingBrace(src: string, at: number): number {
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const c = src[i]
    if (c === '}') depth++
    else if (c === '{') { if (depth === 0) return i; depth-- }
  }
  return -1
}

export function publicStateWrites(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length

  // (1) Prisma listing writes with a public literal in their (non-read) arguments.
  const listingCalls = calls(src, LISTING_WRITE_CALL)
  for (const { open, close, method } of listingCalls) {
    const args = blankReads(src.slice(open, close + 1))
    for (const h of args.matchAll(PUBLIC_LITERAL)) hits.push(`${lineOf(open)}: listing.${method} ${h[0]}`)
  }
  // (2) NESTED writes through a Seller: `seller.update({ data: { listings: { updateMany: { data: { verified: true } } } } })`.
  for (const { open, close, method } of calls(src, /\b\w+\.seller\.(create|update|updateMany|upsert)\s*\(/g)) {
    const args = blankReads(src.slice(open, close + 1))
    for (const l of args.matchAll(/\blistings\s*:\s*\{/g)) {
      const o = l.index! + l[0].length - 1
      const c = matchBalanced(args, o)
      if (c < 0) continue
      for (const h of args.slice(o, c + 1).matchAll(PUBLIC_LITERAL)) hits.push(`${lineOf(open)}: seller.${method} → listings ${h[0]}`)
    }
  }
  // (3) Raw SQL — the SET clause only, so `WHERE status = 'active'` is a read.
  for (const m of src.matchAll(new RegExp(String.raw`UPDATE\s+${LISTING_TABLE}\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|\x60|;|$)`, 'gi'))) {
    for (const h of m[1].matchAll(/\bverified"?\s*=\s*true\b|\bstatus"?\s*=\s*'active'/gi)) hits.push(`${lineOf(m.index!)}: UPDATE "Listing" SET ${h[0]}`)
  }
  for (const m of src.matchAll(new RegExp(String.raw`INSERT\s+INTO\s+${LISTING_TABLE}\s*\(`, 'gi'))) hits.push(`${lineOf(m.index!)}: INSERT INTO "Listing"`)
  // (4) Build-the-payload-then-write, by assignment.
  for (const m of src.matchAll(/\bdata\.(?:verified\s*=\s*true\b|status\s*=\s*['"]active['"])/g)) hits.push(`${lineOf(m.index!)}: ${m[0]}`)
  // (5) Build-the-payload-then-write, by LITERAL: an object carrying BOTH `verified: true` AND
  //     `status: 'active'` outside any write call, in a file that writes Listing rows at all. This is
  //     how the importers do it (`const payload = { …, verified: true, status: 'active' }` →
  //     `db.listing.update({ data: payload })`). Read sub-objects are blanked first, and so are the
  //     arguments of the listing writes (1) already counted, so nothing is counted twice.
  const writesListings = listingCalls.length > 0 || new RegExp(String.raw`(?:UPDATE|INSERT\s+INTO)\s+${LISTING_TABLE}\b`, 'i').test(src)
  if (writesListings) {
    let rest = blankReads(src)
    for (const { open, close } of listingCalls) rest = rest.slice(0, open) + ' '.repeat(close + 1 - open) + rest.slice(close + 1)
    const seen = new Set<number>()
    for (const v of rest.matchAll(/\bverified\s*:\s*true\b/g)) {
      const o = enclosingBrace(rest, v.index!)
      if (o < 0 || seen.has(o)) continue
      const c = matchBalanced(rest, o)
      if (c < 0) continue
      // `status: 'active'`, or an expression that can yield it (`status: inStock ? 'active' : 'sold'`).
      if (/\bstatus\s*:[^,}\n]*['"]active['"]/.test(rest.slice(o, c + 1))) { seen.add(o); hits.push(`${lineOf(o)}: payload literal { verified: true, status: 'active' }`) }
    }
  }
  return hits
}

/**
 * Writes that hand a STOREFRONT to an account — `ownerId` set on an existing Seller. A claim
 * re-parents every live listing on it, so it is a transition into public state for that account
 * (owner decision 3, path h), and the first wiring of the identity gate missed one of three.
 * Seller creates are not claims (a new storefront has no listings) and are not counted.
 */
export function storefrontClaimWrites(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (const { open, close, method } of calls(src, /\b\w+\.seller\.(update|updateMany|upsert)\s*\(/g)) {
    const args = blankReads(src.slice(open, close + 1))
    // `ownerId: x` (never `ownerId: null` — that is a release) or the `{ …, ownerId }` shorthand.
    for (const h of args.matchAll(/\bownerId\s*:\s*(?!null\b)[\w.$!]|[{,]\s*ownerId\s*(?=[,}])/g)) hits.push(`${lineOf(open)}: seller.${method} ${h[0].replace(/\s+/g, ' ').trim()}`)
  }
  for (const m of src.matchAll(/UPDATE\s+(?:"?public"?\.)?"?Seller"?\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|\x60|;|$)/gi)) {
    if (/"?ownerId"?\s*=\s*(?!NULL\b)/i.test(m[1])) hits.push(`${lineOf(m.index!)}: UPDATE "Seller" SET "ownerId"`)
  }
  return hits
}

/**
 * Writes that PUBLISH AN EXISTING ROW (`verified: true` in an update) without also clearing
 * `identityHold` in the same object — or a raw `UPDATE "Listing" SET verified = true` without
 * `"identityHold" = false`.
 *
 * ⛔ WHY THIS IS THE WHOLE INVARIANT, NOT A STYLE RULE: every write that PARKS a row (sets
 * identityHold=true) also sets or guards `verified = false`, so a parked row is never public. The one
 * way a row could end up LIVE AND HELD is a later `verified: true` that leaves the column alone — and
 * a live row carrying identityHold=true is one a takedown that forgets the column would leave for
 * releaseIdentityHolds() to republish. Status-only writes (relist, confirm, sync revive, admin
 * activate) are deliberately NOT required to clear it: they never touch `verified`, so they can only
 * make an already-verified row public, which this invariant keeps hold-free — and clearing the
 * column on them would DISCARD a parked approval on a row that is still verified=false.
 *
 * Creates are not checked (a new row's identityHold defaults to false), nor is an upsert's `create`.
 */
/** Blank every `create: {…}` (an upsert's insert branch) in place, offsets kept: a create is a fresh row, not a publish. */
function blankCreates(args: string): string {
  let out = args
  for (const c of out.matchAll(/\bcreate\s*:\s*\{/g)) {
    const o = c.index! + c[0].length - 1
    const e = matchBalanced(out, o)
    if (e > 0) out = out.slice(0, c.index!) + ' '.repeat(e + 1 - c.index!) + out.slice(e + 1)
  }
  return out
}

/** A raw `UPDATE "Listing" [alias] SET …`; group 1 is the SET clause (up to WHERE/FROM/RETURNING/the literal's end). */
const RAW_LISTING_UPDATE = String.raw`UPDATE\s+${LISTING_TABLE}\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|\x60|;|$)`

export function publishesKeepingHold(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (const { open, close, method } of calls(src, /\b\w+\.listing\.(update|updateMany|updateManyAndReturn|upsert)\s*\(/g)) {
    // An upsert's `create` inserts a fresh row — outside this rule, as every create is.
    const args = blankCreates(blankReads(src.slice(open, close + 1)))
    for (const v of args.matchAll(/\bverified\s*:\s*true\b/g)) {
      const o = enclosingBrace(args, v.index!)
      const c = o < 0 ? -1 : matchBalanced(args, o)
      const obj = c < 0 ? args : args.slice(o, c + 1)
      if (!/\bidentityHold\s*:\s*false\b/.test(obj)) hits.push(`${lineOf(open)}: listing.${method} verified: true without identityHold: false`)
    }
  }
  for (const m of src.matchAll(new RegExp(RAW_LISTING_UPDATE, 'gi'))) {
    if (/\bverified"?\s*=\s*true\b/i.test(m[1]) && !/"?identityHold"?\s*=\s*false\b/i.test(m[1])) hits.push(`${lineOf(m.index!)}: UPDATE "Listing" SET verified = true without "identityHold" = false`)
  }
  return hits
}

/**
 * Writes that PUBLISH AN EXISTING ROW (`verified: true` in an update, or a raw `SET verified = true`) without also dropping
 * the LICENCE HOLD'S MARK — `verificationNotes: null` / `"verificationNotes" = NULL` in the same object or SET clause
 * (commit gate, 2026-10-14 — src/lib/licence-stamp.ts LICENCE_HELD_NOTE).
 *
 * ⛔ WHY: 'licence-approve' publishes only a row carrying the mark, which must mean "the licence check itself took this
 * row down". A row published by any other path and still marked would, once taken down again by something that leaves no
 * report, read as the licence check's hold — and the next approval would undo that takedown. So the mark sits only on an
 * unpublished row: every write that makes a row public drops it, exactly as it drops identityHold above. Status-only
 * writes are outside it for the same reason as there: a marked row is never verified.
 */
export function publishesKeepingLicenceMark(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (const { open, close, method } of calls(src, /\b\w+\.listing\.(update|updateMany|updateManyAndReturn|upsert)\s*\(/g)) {
    const args = blankCreates(blankReads(src.slice(open, close + 1)))
    for (const v of args.matchAll(/\bverified\s*:\s*true\b/g)) {
      const o = enclosingBrace(args, v.index!)
      const c = o < 0 ? -1 : matchBalanced(args, o)
      const obj = c < 0 ? args : args.slice(o, c + 1)
      if (!/\bverificationNotes\s*:\s*null\b/.test(obj)) hits.push(`${lineOf(open)}: listing.${method} verified: true without verificationNotes: null`)
    }
  }
  for (const m of src.matchAll(new RegExp(RAW_LISTING_UPDATE, 'gi'))) {
    if (/\bverified"?\s*=\s*true\b/i.test(m[1]) && !/"?verificationNotes"?\s*=\s*NULL\b/i.test(m[1])) hits.push(`${lineOf(m.index!)}: UPDATE "Listing" SET verified = true without "verificationNotes" = NULL`)
  }
  return hits
}

/** Files allowed to publish without dropping the mark, each with why its rows can never carry one. */
const LICENCE_MARK_EXEMPT: Record<string, string> = {
  'scripts/seed-visa-shop.mjs': "eno's own desk rows only — the desk is exempt from the licence check, so nothing ever marks them",
  'scripts/seed-trip-desk.mjs': "eno's own trip desk rows only — exempt from the licence check like the visa desk, never marked",
}

/**
 * Writes that PUBLISH AN EXISTING ROW without the LICENCE CHECK's guard (owner, 2026-10-14 — src/lib/licence-stamp.ts).
 * A non-desk e-Visa or Legal & permits listing may be public only once eno has approved its provider's licence, and
 * every publish of an existing row decides that with a pre-filter (licenceBlockedIds / licenceCleared) and then ANDs
 * the guard into the write itself, against an edit clearing the stamp in between. This flags:
 *   · a Prisma `listing.update|updateMany|updateManyAndReturn|upsert` whose arguments — reads blanked, an upsert's
 *     `create` blanked (R5: a create is a fresh row, which the create paths hold themselves) — set `verified: true` OR
 *     `status: 'active'` (R1/R5: a verified hidden or sold row goes public on its status alone), and whose call text
 *     does not carry `licenceClearedWhere(` — spelled IN the call, where this can see it;
 *   · a raw `UPDATE "Listing" … SET … verified = true | status = 'active'` whose statement (to the closing backtick or
 *     ';') does not carry `licenceClearedSql(`.
 * Per write, one hit. What it cannot see is what `publicStateWrites` cannot see (the header): a value that is not a
 * literal (setStatusCore's `data: { status }` — gated in code, R1), a payload built away from the call, a guard held
 * in a variable. The daily sweep (/api/cron/licence-holds) is the backstop for those.
 */
export function publishesWithoutLicenceGuard(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (const { open, close, method } of calls(src, /\b\w+\.listing\.(update|updateMany|updateManyAndReturn|upsert)\s*\(/g)) {
    const raw = src.slice(open, close + 1)
    const set = blankCreates(blankReads(raw)).match(/\bverified\s*:\s*true\b|\bstatus\s*:\s*['"]active['"]/)
    // Present, and not negated (commit gate): `NOT: licenceClearedWhere(…)` would publish exactly the rows it should keep out.
    if (set && (!raw.includes('licenceClearedWhere(') || /\bNOT\s*:\s*\[?\s*licenceClearedWhere\(/.test(raw))) hits.push(`${lineOf(open)}: listing.${method} ${set[0]} without licenceClearedWhere`)
  }
  for (const m of src.matchAll(new RegExp(RAW_LISTING_UPDATE, 'gi'))) {
    const set = /\bverified"?\s*=\s*true\b|\bstatus"?\s*=\s*'active'/i.exec(m[1])
    if (!set) continue
    const rest = src.slice(m.index!)
    const end = rest.search(/[`;]/)
    if (!(end < 0 ? rest : rest.slice(0, end)).includes('licenceClearedSql(')) hits.push(`${lineOf(m.index!)}: UPDATE "Listing" SET ${set[0]} without licenceClearedSql`)
  }
  return hits
}

/**
 * Writes of a NON-NULL licence stamp (owner, 2026-10-14). Listing.verificationMethod is the repurposed approval stamp
 * (src/lib/licence-stamp.ts), so a value written to it is an approval: a listing write (any of LISTING_WRITE_CALL, an
 * upsert's `create` included — reads blanked) with `verificationMethod:` anything but `null`, its `{ verificationMethod }`
 * shorthand, or a raw `UPDATE "Listing" SET "verificationMethod" =` anything but NULL. Clearing it (`null`,
 * LICENCE_STAMP_CLEARED spread in) is every other writer's job and is not counted. A raw INSERT is not read (its values
 * are positional); none writes the column.
 */
export function stampWrites(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (const { open, close, method } of calls(src, LISTING_WRITE_CALL)) {
    const args = blankReads(src.slice(open, close + 1))
    // ⚠️ The lookahead sits right after the colon, spaces inside it: `:\s*(?!null)` would backtrack \s* to nothing and
    // read `verificationMethod: null` as a stamp.
    for (const h of args.matchAll(/\bverificationMethod\s*:(?!\s*null\b)|[{,]\s*verificationMethod\s*(?=[,}])/g)) hits.push(`${lineOf(open)}: listing.${method} ${h[0].replace(/\s+/g, ' ').trim()}`)
  }
  for (const m of src.matchAll(new RegExp(RAW_LISTING_UPDATE, 'gi'))) {
    if (/"?verificationMethod"?\s*=(?!\s*NULL\b)/i.test(m[1])) hits.push(`${lineOf(m.index!)}: UPDATE "Listing" SET "verificationMethod"`)
  }
  return hits
}

/** Any Prisma write, on ANY model — `<x>.<model>.<write>(` — so a nested `listing: { update: … }` through another is seen. */
const ANY_WRITE_CALL = /\b\w+\.(\w+\.(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert))\s*\(/g

/**
 * Writes of a NON-NULL teacher-card identity mark (owner, 2026-10-15). Listing.identityMarkNotice is the card's display
 * cache of "Identity verified" (src/lib/teachers/identity-mark-card.ts), so a value written to it is a public claim: a
 * Prisma write on any model (reads blanked — a `where`/`select` naming it is a read) with `identityMarkNotice:` anything
 * but `null`, or its `{ identityMarkNotice }` shorthand — through a nested relation write included — or a raw
 * `UPDATE "Listing" SET "identityMarkNotice" =` anything but NULL. TeacherProfile.identityMarkNoticeVersion (the words a
 * show-again records) is another column and is not matched. Clearing it (`null`, the erasure scrub) is not counted. A raw
 * INSERT is not read (its values are positional); none writes the column.
 */
export function markWrites(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (const { open, close, method } of calls(src, ANY_WRITE_CALL)) {
    const args = blankReads(src.slice(open, close + 1))
    // ⚠️ The lookahead sits right after the colon, spaces inside it — as in stampWrites.
    for (const h of args.matchAll(/\bidentityMarkNotice\s*:(?!\s*null\b)|[{,]\s*identityMarkNotice\s*(?=[,}])/g)) hits.push(`${lineOf(open)}: ${method} ${h[0].replace(/\s+/g, ' ').trim()}`)
  }
  for (const m of src.matchAll(new RegExp(RAW_LISTING_UPDATE, 'gi'))) {
    if (/"?identityMarkNotice"?\s*=(?!\s*NULL\b)/i.test(m[1])) hits.push(`${lineOf(m.index!)}: UPDATE "Listing" SET "identityMarkNotice"`)
  }
  return hits
}

/**
 * Every scanned file (src/ and scripts/), read ONCE for the whole file in beforeAll — six scanners walk the same tree,
 * and each re-reading thousands of files took ~1s alone and past vitest's 5s per-test limit under a parallel run
 * (measured 2026-10-14, when the licence tripwires made it six). A hook has its own, longer limit.
 */
let SOURCES: Array<{ rel: string; src: string }> = []
beforeAll(() => {
  SOURCES = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))].map((f) => ({ rel: relative(ROOT, f).split(sep).join('/'), src: readFileSync(f, 'utf8') }))
  for (const { src } of SOURCES) stripComments(src) // the memo, warmed here rather than in whichever test runs first
}, 120_000)

/** Every repo file's hits for one scanner, keyed by repo-relative path. */
function scanWith(scan: (source: string) => string[]): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const { rel, src } of SOURCES) {
    const hits = scan(src)
    if (hits.length) found.set(rel, hits)
  }
  return found
}

function scanRepo(): Map<string, string[]> {
  return scanWith(publicStateWrites)
}

describe('writes that put a Listing into public state', () => {
  it('⛔ EVERY ONE IS AUDITED — a new publish path must be wired to the identity gate or listed as outside it', () => {
    const found = scanRepo()
    const unaudited = [...found.entries()].filter(([f]) => !AUDITED[f]).map(([f, h]) => `${f}\n    ${h.join('\n    ')}`)
    expect(unaudited, `New write(s) into public listing state. Route them through src/lib/compliance/seller-publish-gate.ts (seller acts REFUSE, admin/system acts HOLD), then add the file to AUDITED with the reason:\n  ${unaudited.join('\n  ')}`).toEqual([])
  })

  it('the audited counts are exact — one more write is a new path, one fewer is a stale entry', () => {
    const found = scanRepo()
    const drift = Object.entries(AUDITED)
      .map(([f, a]) => ({ f, expected: a.count, actual: found.get(f)?.length ?? 0, hits: found.get(f) ?? [] }))
      .filter((d) => d.expected !== d.actual)
      .map((d) => `${d.f}: expected ${d.expected}, found ${d.actual}\n    ${d.hits.join('\n    ')}`)
    expect(drift, `Audited write counts drifted:\n  ${drift.join('\n  ')}`).toEqual([])
  })
})

describe('a publish of an existing row clears identityHold in the same write', () => {
  it('⛔ no update sets `verified: true` and leaves identityHold alone — a live row must never carry a hold', () => {
    const bad = [...scanWith(publishesKeepingHold).entries()].map(([f, hits]) => `${f}\n    ${hits.join('\n    ')}`)
    expect(bad, `A write publishes an existing listing without clearing identityHold. Add \`identityHold: false\` (raw SQL: \`"identityHold" = false\`) to the same data object:\n  ${bad.join('\n  ')}`).toEqual([])
  })
})

describe('⛔ a publish of an existing row drops the licence hold’s mark in the same write (commit gate, 2026-10-14)', () => {
  it('no update sets `verified: true` and leaves verificationNotes alone — a public row is never the licence check’s hold', () => {
    const bad = [...scanWith(publishesKeepingLicenceMark).entries()].filter(([f]) => !LICENCE_MARK_EXEMPT[f]).map(([f, hits]) => `${f}\n    ${hits.join('\n    ')}`)
    expect(bad, `A write publishes an existing listing without dropping the licence hold's mark. Add \`verificationNotes: null\` (raw SQL: \`"verificationNotes" = NULL\`) to the same data object (src/lib/licence-stamp.ts LICENCE_HELD_NOTE):\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('every exemption still names a file that publishes — a stale one is removed, not kept', () => {
    const found = scanWith(publishesKeepingLicenceMark)
    expect(Object.keys(LICENCE_MARK_EXEMPT).filter((f) => !found.has(f))).toEqual([])
  })
})

describe('⛔ the licence check (owner, 2026-10-14): every existing-row publish carries its guard, and one place stamps', () => {
  /** A file's hits against an exact-count list: unlisted files and drifted counts, as one list of problems. */
  function drift(found: Map<string, string[]>, listed: Record<string, { count: number }>): string[] {
    return [
      ...[...found.entries()].filter(([f]) => !listed[f]).map(([f, h]) => `${f} (unlisted)\n    ${h.join('\n    ')}`),
      ...Object.entries(listed).filter(([f, a]) => (found.get(f)?.length ?? 0) !== a.count)
        .map(([f, a]) => `${f}: expected ${a.count}, found ${found.get(f)?.length ?? 0}\n    ${(found.get(f) ?? []).join('\n    ')}`),
    ]
  }

  it('⛔ no existing-row publish without licenceClearedWhere / licenceClearedSql — unless listed as non-aisle by construction', () => {
    const bad = drift(scanWith(publishesWithoutLicenceGuard), LICENCE_GUARD_EXEMPT)
    expect(bad, `A write can publish an existing listing — \`verified: true\` or \`status: 'active'\` — without the licence check's guard, so an e-Visa or Legal & permits listing eno has not checked could go live through it. Pre-filter with licenceBlockedIds (src/lib/core/licence-check.ts) and AND \`licenceClearedWhere(desk)\` into the write's WHERE (raw SQL: \`AND \${licenceClearedSql()}\`); or, only if the write can never touch either aisle BY CONSTRUCTION, list the file in LICENCE_GUARD_EXEMPT with that construction:\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('⛔ a non-null licence stamp is written in ONE place — admin listings ‘licence-approve’', () => {
    const bad = drift(scanWith(stampWrites), STAMP_WRITERS)
    expect(bad, `A write puts a value into Listing.verificationMethod — the licence check's APPROVAL STAMP (src/lib/licence-stamp.ts). Only 'licence-approve' may: clear it with LICENCE_STAMP_CLEARED instead:\n  ${bad.join('\n  ')}`).toEqual([])
  })
})

describe('⛔ the teacher card\'s "Identity verified" tick (owner, 2026-10-15): one writer of a non-null value', () => {
  it('a non-null Listing.identityMarkNotice is written in ONE place — src/lib/teachers/identity-mark-card.ts', () => {
    const found = scanWith(markWrites)
    const bad = [
      ...[...found.entries()].filter(([f]) => !MARK_WRITERS[f]).map(([f, h]) => `${f} (unlisted)\n    ${h.join('\n    ')}`),
      ...Object.entries(MARK_WRITERS).filter(([f, a]) => (found.get(f)?.length ?? 0) !== a.count)
        .map(([f, a]) => `${f}: expected ${a.count}, found ${found.get(f)?.length ?? 0}\n    ${(found.get(f) ?? []).join('\n    ')}`),
    ]
    expect(bad, `A write puts a value into Listing.identityMarkNotice — the teacher card's "Identity verified" claim. Only src/lib/teachers/identity-mark-card.ts may (writeIdentityMarkCard, from the one predicate); call it, or clear the column with null:\n  ${bad.join('\n  ')}`).toEqual([])
  })
})

describe('writes that hand a storefront to an account (claims)', () => {
  function scanClaims(): Map<string, string[]> {
    return scanWith(storefrontClaimWrites)
  }
  it('⛔ EVERY CLAIM GOES THROUGH claimGuestStorefront — or is listed here with the reason', () => {
    const found = scanClaims()
    const bad = [
      ...[...found.entries()].filter(([f]) => !AUDITED_CLAIMS[f]).map(([f, h]) => `${f} (unaudited)\n    ${h.join('\n    ')}`),
      ...Object.entries(AUDITED_CLAIMS).filter(([f, a]) => (found.get(f)?.length ?? 0) !== a.count)
        .map(([f, a]) => `${f}: expected ${a.count}, found ${found.get(f)?.length ?? 0}\n    ${(found.get(f) ?? []).join('\n    ')}`),
    ]
    expect(bad, `Storefront claim writes drifted. A claim re-parents live listings: call claimGuestStorefront (src/lib/compliance/seller-publish-gate.ts) instead, or list the file with the reason:\n  ${bad.join('\n  ')}`).toEqual([])
  })
})

describe('the scanner itself — so a refactor of it cannot quietly make it blind', () => {
  it('sees a multi-line Prisma data literal', () => {
    expect(publicStateWrites(`await db.listing.update({\n  where: { id },\n  data: {\n    title,\n    verified: true,\n  },\n})`)).toHaveLength(1)
  })
  it('sees the …AndReturn write forms', () => {
    expect(publicStateWrites(`db.listing.updateManyAndReturn({ where: { id: { in: ids } }, data: { verified: true }, select: { id: true } })`)).toHaveLength(1)
    expect(publicStateWrites(`tx.listing.createManyAndReturn({ data: [{ title, status: 'active' }] })`)).toHaveLength(1)
    // The returned projection is a read, not a publish.
    expect(publicStateWrites(`db.listing.updateManyAndReturn({ where: { id }, data: { identityHold: true }, select: { verified: true } })`)).toEqual([])
  })
  it('sees a ternary payload and a transaction client', () => {
    expect(publicStateWrites(`tx.listing.update({ where: { id }, data: held ? { identityHold: true } : { verified: true } })`)).toHaveLength(1)
  })
  it('ignores filters and projections — a READ is not a publish', () => {
    expect(publicStateWrites(`db.listing.updateMany({ where: { verified: true, status: 'active' }, data: { verified: false } })`)).toEqual([])
    expect(publicStateWrites(`db.listing.findMany({ where: { verified: true, status: 'active' } })`)).toEqual([])
    expect(publicStateWrites(`db.listing.update({ where: { id }, data: { title }, select: { verified: true } })`)).toEqual([])
  })
  it('reads raw SQL SET clauses but not WHERE clauses', () => {
    expect(publicStateWrites('UPDATE "Listing" SET verified = true WHERE id = ANY($1)')).toHaveLength(1)
    expect(publicStateWrites(`UPDATE "Listing" SET status = 'sold' WHERE status = 'active'`)).toEqual([])
    expect(publicStateWrites(`c.query(\`UPDATE "Listing" SET status = 'active', "updatedAt" = now() WHERE id = $1\`)`)).toHaveLength(1)
  })
  it('does not count a write that only appears in a comment', () => {
    expect(publicStateWrites(`// db.listing.update({ data: { verified: true } })\n/* UPDATE "Listing" SET verified = true */`)).toEqual([])
  })
  it('a "//" or "/*" inside a string is not a comment — the write after it is still seen', () => {
    expect(publicStateWrites(`db.listing.update({ where: { id }, data: { affiliateUrl: 'https://x.vn/a', verified: true } })`)).toHaveLength(1)
    expect(publicStateWrites('const g = "/* not a comment"\ndb.listing.update({ where: { id }, data: { verified: true } })')).toHaveLength(1)
    expect(publicStateWrites('c.query(`UPDATE "Listing" SET verified = true WHERE url LIKE \'%//%\'`)')).toHaveLength(1)
  })
  it('sees a payload literal built beside the write, including a ternary status', () => {
    expect(publicStateWrites(`const payload = { title, verified: true, status: 'active' }\nawait db.listing.update({ where: { id }, data: payload })`)).toHaveLength(1)
    expect(publicStateWrites(`const f = { verified: true, status: inStock ? 'active' : 'sold' }\nawait db.listing.upsert({ where: { id }, update: f, create: f })`)).toHaveLength(1)
    // …but not a read predicate, and not in a file that never writes a listing.
    expect(publicStateWrites(`const rows = await db.listing.findMany({ where: { verified: true, status: 'active' } })\nawait db.listing.update({ where: { id }, data: { title } })`)).toEqual([])
    expect(publicStateWrites(`const PUBLIC = { verified: true, status: 'active' }`)).toEqual([])
  })
  it('sees a nested write through a Seller and a schema-qualified UPDATE', () => {
    expect(publicStateWrites(`db.seller.update({ where: { id }, data: { listings: { updateMany: { where: {}, data: { verified: true } } } } })`)).toHaveLength(1)
    expect(publicStateWrites('UPDATE public."Listing" SET verified = true WHERE id = $1')).toHaveLength(1)
    expect(publicStateWrites('UPDATE "public"."Listing" SET status = \'active\' WHERE id = $1')).toHaveLength(1)
  })
  it('sees a storefront claim, in literal, shorthand and raw-SQL form — but not a release or a filter', () => {
    expect(storefrontClaimWrites(`db.seller.updateMany({ where: { id, ownerId: null }, data: { ownerId: profile.id, claimedAt } })`)).toHaveLength(1)
    expect(storefrontClaimWrites(`db.seller.upsert({ where: { id }, update: { name, ownerId }, create: { id, name } })`)).toHaveLength(1)
    expect(storefrontClaimWrites('UPDATE "Seller" SET "ownerId" = $1 WHERE id = $2')).toHaveLength(1)
    expect(storefrontClaimWrites(`db.seller.updateMany({ where: { ownerId: me }, data: { ownerId: null } })`)).toEqual([])
    expect(storefrontClaimWrites(`db.seller.updateMany({ where: { ownerId: me }, data: { trustScore: 1 } })`)).toEqual([])
  })
  it('flags a publish of an existing row that keeps identityHold — and nothing else', () => {
    expect(publishesKeepingHold(`db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: true } })`)).toHaveLength(1)
    expect(publishesKeepingHold(`tx.listing.update({ where: { id }, data: held ? { verified: false, identityHold: true } : { verified: true } })`)).toHaveLength(1)
    expect(publishesKeepingHold('UPDATE "Listing" SET verified = true WHERE id = ANY($1)')).toHaveLength(1)
    expect(publishesKeepingHold(`db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: true, identityHold: false } })`)).toEqual([])
    expect(publishesKeepingHold(`tx.listing.update({ where: { id }, data: held ? { verified: false, identityHold: true } : { verified: true, identityHold: false } })`)).toEqual([])
    expect(publishesKeepingHold('UPDATE "Listing" SET verified = true, "identityHold" = false WHERE "identityHold"')).toEqual([])
    // Reads, creates and status-only writes are outside it.
    expect(publishesKeepingHold(`db.listing.updateMany({ where: { verified: true }, data: { status: 'active' } })`)).toEqual([])
    expect(publishesKeepingHold(`db.listing.create({ data: { verified: true } })`)).toEqual([])
    expect(publishesKeepingHold(`db.listing.upsert({ where: { id }, create: { verified: true }, update: { title } })`)).toEqual([])
  })
  it('flags a publish of an existing row that keeps the licence hold’s mark — and nothing else', () => {
    expect(publishesKeepingLicenceMark(`db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: true, identityHold: false } })`)).toHaveLength(1)
    expect(publishesKeepingLicenceMark(`tx.listing.update({ where: { id }, data: held ? { verified: false, identityHold: true } : { verified: true, identityHold: false } })`)).toHaveLength(1)
    expect(publishesKeepingLicenceMark('UPDATE "Listing" SET verified = true, "identityHold" = false WHERE id = ANY($1)')).toHaveLength(1)
    expect(publishesKeepingLicenceMark(`db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: true, identityHold: false, verificationNotes: null } })`)).toEqual([])
    expect(publishesKeepingLicenceMark(`tx.listing.update({ where: { id }, data: held ? { verified: false, identityHold: true } : { verified: true, identityHold: false, verificationNotes: null } })`)).toEqual([])
    expect(publishesKeepingLicenceMark('UPDATE "Listing" SET verified = true, "identityHold" = false, "verificationNotes" = NULL WHERE "identityHold"')).toEqual([])
    // A mark in the WHERE is a read, not a drop; status-only writes, creates and takedowns are outside it.
    expect(publishesKeepingLicenceMark(`db.listing.updateMany({ where: { verificationNotes: null }, data: { verified: true, identityHold: false } })`)).toHaveLength(1)
    expect(publishesKeepingLicenceMark(`db.listing.updateMany({ where: { verified: true }, data: { status: 'active' } })`)).toEqual([])
    expect(publishesKeepingLicenceMark(`db.listing.create({ data: { verified: true } })`)).toEqual([])
    expect(publishesKeepingLicenceMark(`db.listing.updateMany({ where: { id }, data: { verified: false, identityHold: false, verificationNotes: 'licence:held' } })`)).toEqual([])
  })
  it('flags every raw INSERT and the build-then-write assignment', () => {
    expect(publicStateWrites('INSERT INTO "Listing" (id, title) VALUES ($1, $2)')).toHaveLength(1)
    expect(publicStateWrites(`if (x) { data.status = 'active' }`)).toHaveLength(1)
  })
  it('flags a Prisma publish of an existing row without the licence guard — and passes a guarded one', () => {
    expect(publishesWithoutLicenceGuard(`db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: true, identityHold: false } })`)).toHaveLength(1)
    expect(publishesWithoutLicenceGuard(`db.listing.updateMany({ where: { id: { in: ids }, ...NOT_REMOVED, AND: [licenceClearedWhere(desk)] }, data: { verified: true, identityHold: false } })`)).toEqual([])
    // A ternary and a transaction client, as moderate 'approve' writes it.
    expect(publishesWithoutLicenceGuard(`tx.listing.updateMany({ where: { id }, data: held ? { verified: false, identityHold: true } : { verified: true, identityHold: false } })`)).toHaveLength(1)
    // ⛔ A STATUS-ONLY write publishes a verified row too (R1/R5): flagged without the guard, passed with it.
    expect(publishesWithoutLicenceGuard(`db.listing.updateMany({ where: { id: { in: ids } }, data: { status: 'active', ...REACTIVATION_SALE_RESET } })`)).toHaveLength(1)
    expect(publishesWithoutLicenceGuard(`db.listing.updateManyAndReturn({ where: { id: { in: ids }, AND: [licenceClearedWhere(desk)] }, data: { status: 'active' }, select: { id: true } })`)).toEqual([])
    // One hit per write, whatever it sets.
    expect(publishesWithoutLicenceGuard(`db.listing.update({ where: { id }, data: { verified: true, status: 'active', identityHold: false } })`)).toHaveLength(1)
  })
  it('a NEGATED guard is no guard', () => {
    expect(publishesWithoutLicenceGuard(`db.listing.updateMany({ where: { id: { in: ids }, NOT: licenceClearedWhere(desk) }, data: { verified: true, identityHold: false } })`)).toHaveLength(1)
    expect(publishesWithoutLicenceGuard(`db.listing.updateMany({ where: { id: { in: ids }, NOT: [licenceClearedWhere(desk)] }, data: { verified: true, identityHold: false } })`)).toHaveLength(1)
  })
  it('the licence guard scan ignores reads, creates, takedowns, comments and a guard named only in a comment', () => {
    // R5: an upsert's create is a fresh row (the create paths hold a licence-aisle row themselves) — its update is not.
    expect(publishesWithoutLicenceGuard(`db.listing.upsert({ where: { id }, create: { verified: true, status: 'active' }, update: { title } })`)).toEqual([])
    expect(publishesWithoutLicenceGuard(`db.listing.upsert({ where: { id }, create: { title }, update: { verified: true } })`)).toHaveLength(1)
    expect(publishesWithoutLicenceGuard(`db.listing.create({ data: { verified: true, status: 'active' } })`)).toEqual([])
    expect(publishesWithoutLicenceGuard(`db.listing.updateMany({ where: { verified: true, status: 'active' }, data: { verified: false, identityHold: false } })`)).toEqual([])
    expect(publishesWithoutLicenceGuard(`// db.listing.updateMany({ data: { verified: true } })`)).toEqual([])
    expect(publishesWithoutLicenceGuard(`db.listing.updateMany({ where: { id } /* licenceClearedWhere(desk) */, data: { verified: true, identityHold: false } })`)).toHaveLength(1)
  })
  it('flags a raw publish without licenceClearedSql — and passes a guarded one, aliased or not', () => {
    expect(publishesWithoutLicenceGuard('c.query(`UPDATE "Listing" SET verified = true, "identityHold" = false WHERE id = ANY($1::text[])`, [ids])')).toHaveLength(1)
    expect(publishesWithoutLicenceGuard('c.query(`UPDATE "Listing" SET verified = true, "identityHold" = false WHERE id = ANY($1::text[]) AND ${licenceClearedSql()}`, [ids])')).toEqual([])
    expect(publishesWithoutLicenceGuard('c.query(`UPDATE "Listing" l SET verified = true, "identityHold" = false FROM "Seller" s WHERE s.id = l."sellerId" AND ${licenceClearedSql(\'l.\')}`)')).toEqual([])
    expect(publishesWithoutLicenceGuard(`UPDATE "Listing" SET status = 'active' WHERE id = 'x';`)).toHaveLength(1)
    // The guard of the NEXT statement does not cover this one: the statement ends at its own ';'.
    expect(publishesWithoutLicenceGuard(`UPDATE "Listing" SET status = 'active' WHERE id = 'x'; UPDATE "Listing" SET verified = true WHERE \${licenceClearedSql()}`)).toHaveLength(1)
    // A raw takedown, and a status read in the WHERE, are not publishes.
    expect(publishesWithoutLicenceGuard(`UPDATE "Listing" SET status = 'hidden' WHERE status = 'active'`)).toEqual([])
  })
  it('flags a non-null identity-mark write, Prisma (any model, nested, shorthand) or raw — and never a cleared one, a read or the consent\'s own version column', () => {
    expect(markWrites(`tx.listing.update({ where: { id }, data: { identityMarkNotice: version } })`)).toHaveLength(1)
    expect(markWrites(`db.listing.updateMany({ where: { id }, data: { identityMarkNotice } })`)).toHaveLength(1)
    expect(markWrites(`db.listing.create({ data: { title, identityMarkNotice: '2026-10-16' } })`)).toHaveLength(1)
    expect(markWrites(`tx.teacherProfile.update({ where: { id }, data: { listing: { update: { identityMarkNotice: v } } } })`)).toHaveLength(1)
    expect(markWrites('UPDATE "Listing" SET "identityMarkNotice" = ${value}::text WHERE "id" = ${id}')).toHaveLength(1)
    expect(markWrites('update public."Listing" l set "identityMarkNotice" = $1 where l.id = $2')).toHaveLength(1)
    // clears, reads and the other column are not writes of the claim
    expect(markWrites(`db.listing.updateMany({ where: { id }, data: { identityMarkNotice: null } })`)).toEqual([])
    expect(markWrites(`db.listing.updateMany({ where: { id }, data: { ...PERSONAL_SCRUB_DATA, verified: false } })`)).toEqual([])
    expect(markWrites('UPDATE "Listing" SET "identityMarkNotice" = NULL WHERE "id" = $1')).toEqual([])
    expect(markWrites(`db.teacherProfile.findMany({ where: { listing: { is: { identityMarkNotice: { not: null } } } } })`)).toEqual([])
    expect(markWrites(`db.listing.updateManyAndReturn({ where: { identityMarkNotice: { not: null } }, data: { featured: false }, select: { identityMarkNotice: true } })`)).toEqual([])
    // the switch's own columns — a show-again, a hide — are not the card's claim
    expect(markWrites(`tx.teacherProfile.update({ where: { id }, data: { identityMarkOn: true, identityMarkAt: now, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION } })`)).toEqual([])
    expect(markWrites(`tx.teacherProfile.update({ where: { id: tp.id }, data: write })`)).toEqual([])
    expect(markWrites(`tx.teacherProfile.update({ where: { id }, data: { identityMarkOn: false, identityMarkWithdrawnAt: now } })`)).toEqual([])
    expect(markWrites(`// db.listing.update({ data: { identityMarkNotice: v } })`)).toEqual([])
  })
  it('flags a non-null stamp write, Prisma or raw — and never a cleared one', () => {
    expect(stampWrites(`tx.listing.updateMany({ where: { id, verificationMethod: r.verificationMethod }, data: { verificationMethod: stamp, verifiedAt: now } })`)).toHaveLength(1)
    expect(stampWrites(`db.listing.update({ where: { id }, data: { verificationMethod } })`)).toHaveLength(1)
    expect(stampWrites(`db.listing.create({ data: { title, verificationMethod: 'manual' } })`)).toHaveLength(1)
    expect(stampWrites('UPDATE "Listing" SET "verificationMethod" = $1 WHERE id = $2')).toHaveLength(1)
    // Cleared: null (with or without spaces), the shared constant spread in, raw NULL — and a read is not a write.
    expect(stampWrites(`db.listing.updateMany({ where: { id }, data: { verificationMethod: null, verifiedAt: null } })`)).toEqual([])
    expect(stampWrites(`db.listing.updateMany({ where: { id }, data: { verificationMethod:null } })`)).toEqual([])
    expect(stampWrites(`db.listing.updateMany({ where: { id }, data: { ...LICENCE_STAMP_CLEARED, verified: false } })`)).toEqual([])
    expect(stampWrites('update "Listing" set "verificationMethod" = NULL, "verifiedAt" = NULL where "id" = $1')).toEqual([])
    expect(stampWrites(`db.listing.findMany({ where: { verificationMethod: { startsWith: 'licence:v1:' } }, select: { verificationMethod: true } })`)).toEqual([])
    expect(stampWrites(`db.listing.updateManyAndReturn({ where: { id }, data: { verified: false }, select: { verificationMethod: true } })`)).toEqual([])
    // Another model's column of the same name (Profile.verificationMethod — the identity check) is not the stamp.
    expect(stampWrites(`db.profile.update({ where: { id }, data: { verificationMethod: source.method } })`)).toEqual([])
  })
})
