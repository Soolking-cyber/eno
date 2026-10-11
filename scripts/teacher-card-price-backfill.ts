/**
 * One-off (owner, 2026-10-11): write the card price — teacherCardPriceFromSaved, the rule every save now writes
 * (src/lib/teachers/profile.ts) — onto the Listing of every teacher profile saved before that rule existed, so existing
 * cards show "40.000.000 ₫ / tháng" or "300.000 ₫ / giờ" like new ones. Touches only Listing.price/priceUnit/negotiable
 * of listings that a TeacherProfile owns, and only where they differ. `negotiable: false` is what every save writes (no
 * offers on a person — the column defaults to true, and a card offers a price only while it is negotiable). Never through updateListingCore: no price-drop record, badge or
 * notification (src/lib/price-drop.ts) — a profile price is not an offer.
 *
 *   npx tsx scripts/teacher-card-price-backfill.ts            # dry run: what would change
 *   npx tsx scripts/teacher-card-price-backfill.ts --apply    # write it
 *
 * ⛔ RUN IT AFTER THE DEPLOY: until then a teacher's save writes the old price (0) back over it.
 * Reads DIRECT_URL / DATABASE_URL (prod: through the SSH tunnel). Re-runnable: a second run changes nothing.
 */
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { teacherCardPriceFromSaved } from '../src/lib/teachers/profile'

config({ quiet: true })
const APPLY = process.argv.includes('--apply')
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
if (!DB_URL) { console.error('Set DATABASE_URL / DIRECT_URL'); process.exit(1) }
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) })

/**
 * ⛔ ONE ROW AT A TIME, UNDER THE SAVE'S OWN LOCK (commit gate, codex + opus, 2026-10-11): each row is re-read inside a
 * transaction holding the per-account advisory lock that saveTeacherProfile and saveTeacherCover take, so a teacher saving
 * while this runs is never overwritten with a price computed from the row before their save. Raw SQL on purpose: only
 * the three columns move — no @updatedAt bump, so no sitemap lastmod or ordering changes. Rows the v2 backfill has not
 * migrated (situationVersion NULL) are left alone, as saveTeacherCover leaves them (D1).
 * Cards: the category pages' client fetch shows the new price at once; their ISR first-paint HTML within its window (6h).
 */
async function main() {
  const ids = await db.teacherProfile.findMany({ where: { listingId: { not: null }, situationVersion: { not: null } }, select: { profileId: true } })
  const legacy = await db.teacherProfile.count({ where: { listingId: { not: null }, situationVersion: null } })
  if (legacy) console.log(`⚠️ ${legacy} profile(s) the v2 backfill has not migrated keep their price until their next full save (D1)`)
  const tally = { same: 0, month: 0, hour: 0, none: 0, gone: 0 }
  for (const { profileId } of ids) {
    const r = await db.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
      const tp = await tx.teacherProfile.findUnique({
        where: { profileId },
        select: { listingId: true, situationVersion: true, jobTypes: true, expectedSalaryM: true, coverOpen: true, coverRateVnd: true },
      })
      if (!tp?.listingId || tp.situationVersion == null) return 'gone' as const
      const l = await tx.listing.findUnique({ where: { id: tp.listingId }, select: { price: true, priceUnit: true, negotiable: true } })
      if (!l) return 'gone' as const
      const want = teacherCardPriceFromSaved(tp)
      if (l.price === want.price && l.priceUnit === want.priceUnit && l.negotiable === false) return 'same' as const
      if (APPLY) {
        await tx.$executeRaw`update "Listing" set "price" = ${want.price}, "priceUnit" = ${want.priceUnit}, "negotiable" = false where "id" = ${tp.listingId}`
      }
      return want.price === 0 ? 'none' as const : want.priceUnit === 'VND/hour' ? 'hour' as const : 'month' as const
    }, { timeout: 30_000, maxWait: 30_000 }) // room to wait out a teacher's save holding the lock
    tally[r]++
  }
  console.log(`teacher profiles with a listing: ${ids.length}; unchanged: ${tally.same}; ${APPLY ? 'written' : 'to write'} — a month: ${tally.month}, an hour: ${tally.hour}, back to none: ${tally.none}; gone meanwhile: ${tally.gone}`)
  if (!APPLY) console.log('dry run — nothing written (add --apply)')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => db.$disconnect())
