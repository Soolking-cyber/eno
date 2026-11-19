import { redirect } from 'next/navigation'
import { AWARDS_PATH } from '@/lib/schools/constants'
import { currentAwardYear } from '@/lib/schools/award-rank'
import { localizedHref } from '@/lib/lang-pinned'

/**
 * /schools/awards → the open year's page. Re-rendered hourly, so the redirect moves on to the new year within an
 * hour of midnight on 1 January in Saigon (a build-time year would be frozen into the cached response).
 */
export const revalidate = 3600

/**
 * ⛔ In the page's own language (localizedHref): `/vi/schools/awards` renders at this route's vi entry, so a plain
 * target would send the Vietnamese twin to the English year page (phase-1 /vi families, 2026-11-19).
 */
export default async function SchoolAwardsIndex({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  redirect(localizedHref(`${AWARDS_PATH}/${currentAwardYear()}`, lang))
}
