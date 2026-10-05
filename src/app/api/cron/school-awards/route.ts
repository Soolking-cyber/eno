import { ApiError, route } from '@/lib/api/handler'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { AWARD_FIRST_YEAR, AWARDS_PATH } from '@/lib/schools/constants'
import { currentAwardYear } from '@/lib/schools/award-rank'
import { finaliseAwards } from '@/lib/schools/awards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Teachers' Choice (src/lib/schools/awards.ts): finalise LAST year's awards, once. Daily, so a box that was down at
// midnight on 1 January still closes the year the next time it runs; every later run finds the year's marker and
// writes nothing. When a year closes the list, every award page and the placed schools' pages are purged.
//
// Installed as a systemd timer by infra/vn-node/cron/install-cron-timers.sh; the box calls it on 127.0.0.1
// with the app's CRON_SECRET. One edition is enough — database work on the shared project, idempotent.
export const GET = route({ auth: 'cron' }, async () => {
  const year = currentAwardYear() - 1
  if (year < AWARD_FIRST_YEAR) return { ok: true, year, skipped: 'before the first award year' }
  const result = await finaliseAwards(year, 'cron')
  // ⛔ A BLOCKED CLOSE IS A FAILED RUN (diff review): non-200, so the timer's unit fails and the journal shows that
  // the year is still open. Each code as a literal (errors.test.ts harvests the vocabulary from literals).
  if (!result.ok) {
    if (result.code === 'award_reviews_pending') throw new ApiError('award_reviews_pending', 409)
    if (result.code === 'award_year_open') throw new ApiError('award_year_open', 409)
    throw new ApiError('award_year_invalid', 400)
  }
  if (!result.already) {
    revalidatePublicPath('/schools')
    revalidatePublicPath(`${AWARDS_PATH}/[year]`, 'page')
    for (const slug of result.slugs) revalidatePublicPath(`/schools/${slug}`)
  }
  return { ...result, year, checkedAt: new Date().toISOString() }
})
