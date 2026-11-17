import { db } from '@/lib/db'
import { EDITION } from '@/lib/edition'

/**
 * ⛔ PAGE LOADS BY BROWSERS THAT PAINTED A PAGE — NOT THE FOOTER'S "VISITS" (owner 2026-11-17, "Honest visitor count"). The footer
 * counts every client that runs its script, scanners and our own test runs included: 1,443–1,726 a day in mid-November while the
 * page-speed beacons (rum_daily, one `fcp` per page a browser actually painted) counted 250–340 before the Facebook ads and ~600–900
 * with them. Phones apart, because the desktop share also carries headless runs (ours, the agent-readiness scanners'), which paint
 * like any browser. Days are Vietnam days, as the beacons store them (api/page-speed, vnDay).
 */
export type PageLoads = { phone: number; other: number }

/** Never throws: a failed read is null (the tile says it could not be read), and the overview stays up. */
export async function pageLoadsLastDays(days: number): Promise<PageLoads | null> {
  try {
    return await readPageLoads(days)
  } catch (e) {
    console.error('[admin] rum_daily page loads read failed:', e instanceof Error ? e.message : e)
    return null
  }
}

async function readPageLoads(days: number): Promise<PageLoads | null> {
  const rows = await db
    .$queryRaw<Array<{ phone: number; other: number }>>`
      select coalesce(sum(n) filter (where dims like '%.phone.%'), 0)::int as phone,
             coalesce(sum(n) filter (where dims not like '%.phone.%'), 0)::int as other
        from rum_daily
       where family = 'fcp' and edition = ${EDITION}
         and day >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - ${days - 1}::int`
  return rows[0] ?? null
}
