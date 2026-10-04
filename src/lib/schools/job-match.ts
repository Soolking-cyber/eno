import { jobProvinces } from '@/lib/job-listing'
import { isGenericEmployer, normEmployer } from './logic'

export type JobPlace = { city?: string | null }

/**
 * A listing whose CITY is Ho Chi Minh City, by the job importer's own place rule (job-listing.ts
 * jobProvinces): every spelling counts ("TP. Hồ Chí Minh", "Saigon", "TPHCM", "HCMC"), and since the 2025
 * merger so do Bình Dương and Vũng Tàu. The free-text location is NOT consulted: "Đường Hồ Chí Minh" is a
 * road and a highway in many provinces, and every listing has a city (the importers and the post wizard
 * both set it), so a listing without one is not placed and never borrows a Saigon school by name.
 */
export const inHcmc = (place: JobPlace): boolean => jobProvinces(place.city).includes('Hồ Chí Minh')

/**
 * Which school a live job belongs to: the school whose linked shop posted it, wherever the job is; otherwise
 * the school its employer NAME exactly matches (normEmployer, never a generic phrase) — but only for a job in
 * Ho Chi Minh City. Common names ("Royal School", "ABC English") belong to other schools in other cities, and
 * a Hà Nội ad must not land on a Saigon school's page (diff review, 2026-10-05).
 */
export function jobSchoolId(
  job: JobPlace & { employer: unknown; sellerId: string },
  bySeller: ReadonlyMap<string, string>,
  byAlias: ReadonlyMap<string, string>,
): string | undefined {
  const own = bySeller.get(job.sellerId)
  if (own) return own
  if (!inHcmc(job)) return undefined
  const key = typeof job.employer === 'string' ? normEmployer(job.employer) : ''
  return key && !isGenericEmployer(key) ? byAlias.get(key) : undefined
}
