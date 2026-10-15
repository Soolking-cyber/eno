/**
 * One-off data step for "Offer a service" (owner, 2026-10-14) — two moves, both dry-run unless --apply:
 *
 *   1. LEGAL OUT OF THE e-VISA SLOT. services/visa-legal became the dedicated e-Visa subcategory (legal work has its own,
 *      `legal-permits`). A row in the slot that carries NO e-visa product chip (visaEntryType / visaSpeed) is a legal or
 *      permit service from before (measured 2026-10-14: the Hoàng Phi law firm's one hidden listing) — it moves to
 *      legal-permits. A candidate whose title or description reads like a visa ("visa", "thị thực") is LISTED, never
 *      moved: an unchipped e-visa offer is still an e-visa offer — the desk's generic anchor (no chip, "Visa" in its
 *      title) is one, and stays LEFT. eno's desk rows otherwise all carry chips, so none of them moves.
 *      ⛔ THE MOVE RE-HOLDS (owner, 2026-10-14: Legal & permits is a licence aisle too — taxonomy.ts licenceCheckHold).
 *      The same conditional UPDATE sets verified=false and identityHold=false and clears the four licence-stamp columns
 *      (src/lib/licence-stamp.ts): a moved row is UNPUBLISHED until its provider has entered the registered name and
 *      licence number and eno's team has approved them under Admin › Catalogue › Licence checks. A stamp from the e-Visa
 *      aisle could not clear it anyway (the stamp binds the aisle); clearing it says so in the row.
 *   2. THE PRICING ANSWER FOR OLDER SERVICES. Services posted before the services › Pricing chip carry no `priceBasis`,
 *      so the "One-time" browse filter cannot find them. Each service / services Wanted where the chip applies (not
 *      e-Visa, not eSIM) gets the answer its stored unit already states ('VND/hour' → hourly, else one-time) — the same
 *      rule every edit now applies (core/listings.ts, taxonomy.ts servicePriceBasisOfUnit). Nothing else moves:
 *      withPriceBasis keeps every other key, so a Legal & permits row's provider values — and the approval stamp that
 *      binds them, which no attribute other than those two enters — stay as they are.
 *
 *   npx tsx scripts/services-offer-backfill.ts            # dry run: what would change
 *   npx tsx scripts/services-offer-backfill.ts --apply    # write it
 *
 * ⛔ RUN IT AFTER THE DEPLOY (the new subcategory and chip must exist on the site first). Raw SQL on purpose: only the
 * named column moves — no @updatedAt bump, so no sitemap lastmod, ranking or "edited" change. Re-runnable: a second run
 * changes nothing. Reads DIRECT_URL / DATABASE_URL (prod: through the SSH tunnel).
 * ⚠️ EACH STEP IS ONE TRANSACTION (codex, commit gate): all of its rows or none. And each write is CONDITIONAL on the
 * row still holding what was read — a seller's edit between the read and the write is never overwritten; that row is
 * skipped and counted, and a re-run picks it up.
 */
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { servicePriceBasisApplies, servicePriceBasisOf, servicePriceBasisOfUnit, withPriceBasis } from '../src/lib/taxonomy'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { LICENCE_HELD_NOTE } from '../src/lib/licence-stamp'

config({ quiet: true })
const APPLY = process.argv.includes('--apply')
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
if (!DB_URL) { console.error('Set DATABASE_URL / DIRECT_URL'); process.exit(1) }
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) })

/** true: an e-visa chip; false: none; null: attributes that do not parse — never moved on a guess (codex, commit gate). */
const chip = (attributes: string | null): boolean | null => {
  try {
    const a = attributes ? (JSON.parse(attributes) as Record<string, unknown>) : {}
    return [a.visaEntryType, a.visaSpeed].some((v) => typeof v === 'string' && v.trim() !== '')
  } catch { return null }
}
// Anything that reads like a visa or an entry service stays where it is and is LISTED for a person to decide.
const VISA_WORDS = /visa|thị thực|nhập cảnh|xuất cảnh|immigration|entry permit|landing/i

async function legalOutOfEvisa() {
  const rows = await db.listing.findMany({
    where: { category: { slug: 'services' }, subcategorySlug: 'visa-legal' },
    select: { id: true, title: true, description: true, status: true, attributes: true, seller: { select: { name: true } } },
  })
  const unchipped = rows.filter((r) => chip(r.attributes) !== true)
  const visaLike = unchipped.filter((r) => chip(r.attributes) === null || VISA_WORDS.test(`${r.title} ${r.description ?? ''}`))
  const move = unchipped.filter((r) => !visaLike.includes(r))
  console.log(`e-Visa slot: ${rows.length} row(s), ${rows.length - unchipped.length} with an e-visa chip (stay)`)
  for (const r of visaLike) console.log(`  · LEFT (reads like a visa offer, or unreadable attributes): ${r.id} [${r.status}] ${r.seller.name} — ${r.title}`)
  for (const r of move) console.log(`  → legal-permits (unpublished: waits for the provider's values + eno's licence check): ${r.id} [${r.status}] ${r.seller.name} — ${r.title}`)
  if (APPLY && move.length) {
    // Conditional on everything the decision read: the slot, the chip (attributes) and the words (title, description).
    // The move re-holds (header): unpublished, no identity hold, no stamp — in the same statement, so never one without the other.
    // "verificationNotes" is the licence hold's mark (src/lib/licence-stamp.ts licenceHeldMark), decided on the row as it
    // stood — every right-hand side of a Postgres SET reads the OLD row: kept for a row that was live, identity-parked or
    // marked already.
    const done = await db.$transaction(move.map((r) => db.$executeRaw`update "Listing" set "subcategorySlug" = 'legal-permits', "verified" = false, "identityHold" = false, "verificationMethod" = NULL, "verifiedAt" = NULL, "verifiedBy" = NULL, "verificationNotes" = case when "verified" or "identityHold" or "verificationNotes" = ${LICENCE_HELD_NOTE} then ${LICENCE_HELD_NOTE} else NULL end where "id" = ${r.id} and "subcategorySlug" = 'visa-legal' and "attributes" is not distinct from ${r.attributes} and "title" = ${r.title} and "description" is not distinct from ${r.description}`))
    const moved = done.reduce((a, n) => a + n, 0)
    console.log(`  moved ${moved} → legal-permits (unpublished: waits for the provider's values + eno's licence check)${moved < move.length ? `, ${move.length - moved} changed since read — skipped (re-run)` : ''}`)
    // The pages of the moved rows stop showing at once (commit gate): a script has no revalidatePath, and an unpublished
    // row's cached page would otherwise stay up until it expires. Tombstoning a row that was already hidden is harmless.
    const movedIds = move.filter((_, i) => done[i] > 0).map((r) => r.id)
    // A failed tombstone FAILS THE RUN (commit gate): a moved row is unpublished, but its cached page could still show it.
    try { console.log(`  page tombstones: ${await tombstonePdps(db, movedIds)}`) } catch (e) {
      console.error(`  ⛔ page tombstones FAILED (${e instanceof Error ? e.message : String(e)}) — a cached page can show a moved row until it expires: re-run scripts/purge-isr-listings.mjs for these ids`)
      process.exitCode = 1
    }
  }
  return move.length
}

async function pricingAnswers() {
  const rows = await db.listing.findMany({
    where: { category: { slug: 'services' }, listingType: { in: ['service', 'wanted'] } },
    select: { id: true, subcategorySlug: true, listingType: true, priceUnit: true, attributes: true },
  })
  const todo = rows.filter((r) => servicePriceBasisApplies('services', r.subcategorySlug) && !servicePriceBasisOf(r.attributes))
  console.log(`services without a Pricing answer: ${todo.length} of ${rows.length} service / Wanted row(s) ${APPLY ? 'to write now' : 'to write'}`)
  if (APPLY && todo.length) {
    // Conditional on the row still holding everything the decision read: attributes, subcategory, intent and unit.
    const done = await db.$transaction(todo.map((r) => db.$executeRaw`update "Listing" set "attributes" = ${withPriceBasis(r.attributes, servicePriceBasisOfUnit(r.priceUnit))} where "id" = ${r.id} and "attributes" is not distinct from ${r.attributes} and "subcategorySlug" is not distinct from ${r.subcategorySlug} and "listingType" = ${r.listingType} and "priceUnit" is not distinct from ${r.priceUnit}`))
    const written = done.reduce((a, n) => a + n, 0)
    console.log(`  written ${written}${written < todo.length ? `, ${todo.length - written} changed since read — skipped (re-run)` : ''}`)
  }
  return todo.length
}

async function main() {
  await legalOutOfEvisa()
  await pricingAnswers()
  if (!APPLY) console.log('dry run — nothing written (add --apply)')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
