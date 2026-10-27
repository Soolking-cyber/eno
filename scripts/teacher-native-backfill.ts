/**
 * One-off (owner, 2026-10-27: "this filter should derive from their nationality, not their fluency … sort again
 * properly"): re-sort every live teacher listing's "Native speaker" facet by NATIONALITY — profile.ts nativeFacet, the
 * rule every save now writes. Touches only Listing.facetTokens of listings a TeacherProfile owns, only its `native:`
 * token (projection.ts withNativeFacet — every other token stays as stored), and only where it differs.
 *
 *   npx tsx scripts/teacher-native-backfill.ts            # dry run: what would change
 *   npx tsx scripts/teacher-native-backfill.ts --apply    # write it
 *
 * ⛔ RUN IT AFTER THE DEPLOY: until then a teacher's save writes the old English-level token back over it.
 * Reads DIRECT_URL / DATABASE_URL (prod: through the SSH tunnel). Re-runnable: a second run changes nothing.
 * Prints counts only — never a name.
 */
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { facetValues } from '../src/lib/facet-tokens'
import { nativeFacet } from '../src/lib/teachers/profile'
import { withNativeFacet } from '../src/lib/teachers/projection'

config({ quiet: true })
const APPLY = process.argv.includes('--apply')
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
if (!DB_URL) { console.error('Set DATABASE_URL / DIRECT_URL'); process.exit(1) }
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) })

/**
 * ⛔ ONE ROW AT A TIME, UNDER THE SAVE'S OWN LOCK — teacher-card-price-backfill.ts's pattern: each row is re-read inside a
 * transaction holding the per-account advisory lock saveTeacherProfile and saveTeacherCover take, so a teacher saving
 * while this runs is never overwritten from the row before their save. Raw SQL on purpose: only facetTokens moves — no
 * @updatedAt bump, so no sitemap lastmod or ordering change.
 * ⚠️ ROWS THE v2 BACKFILL HAS NOT MIGRATED (situationVersion NULL) ARE RE-SORTED TOO (commit gate, codex 2026-10-27: left
 * out, one filter would run on two rules for as long as such a teacher never saves). D1 forbids RE-PROJECTING them from
 * their empty v2 answers; this is not one — it reads nationality and subjects, columns every row has had since v1, and
 * moves the native token alone (withNativeFacet), as saveTeacherCover moves only the cover tokens on such a row.
 * Filter counts and results follow at once (they read facetTokens live); category ISR HTML within its window.
 */
async function main() {
  const ids = await db.teacherProfile.findMany({ where: { listingId: { not: null } }, select: { profileId: true } })
  const tally = { same: 0, toNative: 0, toNonNative: 0, dropped: 0, odd: 0, gone: 0 }
  for (const { profileId } of ids) {
    const r = await db.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
      const tp = await tx.teacherProfile.findUnique({ where: { profileId }, select: { listingId: true, subjects: true, nationality: true } })
      if (!tp?.listingId) return 'gone' as const
      // ⛔ A NATIONALITY THAT IS NOT TWO LETTERS ("USA", "British" — a row older than ISO_COUNTRY) IS UNRESOLVED: nativeFacet
      // answers null, so it carries no native token — what its next save writes too — and it is counted on its own so
      // someone fixes the value (commit gate, codex + opus 2026-10-27). Never filed non-native by default.
      const nat = (tp.nationality ?? '').trim()
      const odd = !!nat && !/^[A-Za-z]{2}$/.test(nat)
      const l = await tx.listing.findUnique({ where: { id: tp.listingId }, select: { facetTokens: true } })
      if (!l) return 'gone' as const
      const want = nativeFacet(tp)
      const have = facetValues(l.facetTokens, 'native')
      if (want ? have.length === 1 && have[0] === want : have.length === 0) return odd ? 'odd' as const : 'same' as const
      if (APPLY) {
        await tx.$executeRaw`update "Listing" set "facetTokens" = ${withNativeFacet(l.facetTokens, want)} where "id" = ${tp.listingId}`
      }
      if (odd) return 'odd' as const
      return want === 'native' ? 'toNative' as const : want === 'non-native' ? 'toNonNative' as const : 'dropped' as const
    }, { timeout: 30_000, maxWait: 30_000 }) // room to wait out a teacher's save holding the lock
    tally[r]++
  }
  console.log(`teacher profiles with a listing: ${ids.length}; unchanged: ${tally.same}; ${APPLY ? 'written' : 'to write'} — now native: ${tally.toNative}, now non-native: ${tally.toNonNative}, token dropped: ${tally.dropped}; gone meanwhile: ${tally.gone}`)
  if (tally.odd) console.log(`⚠️ ${tally.odd} profile(s) have a nationality that is not a two-letter code — no native label until it is fixed; re-run after`)
  if (!APPLY) console.log('dry run — nothing written (add --apply)')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => db.$disconnect())
