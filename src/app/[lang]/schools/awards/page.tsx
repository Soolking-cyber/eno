import { redirect } from 'next/navigation'
import { AWARDS_PATH } from '@/lib/schools/constants'
import { currentAwardYear } from '@/lib/schools/award-rank'

/**
 * /schools/awards → the open year's page. Re-rendered hourly, so the redirect moves on to the new year within an
 * hour of midnight on 1 January in Saigon (a build-time year would be frozen into the cached response).
 */
export const revalidate = 3600

export default function SchoolAwardsIndex() {
  redirect(`${AWARDS_PATH}/${currentAwardYear()}`)
}
