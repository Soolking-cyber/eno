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
  return bySeller.get(job.sellerId) || namedSchoolId(job, byAlias)
}

/** The second half of the rule: the school an HCMC job's employer NAME exactly matches, never a generic phrase. */
function namedSchoolId(job: JobPlace & { employer: unknown }, byAlias: ReadonlyMap<string, string>): string | undefined {
  if (!inHcmc(job)) return undefined
  const key = typeof job.employer === 'string' ? normEmployer(job.employer) : ''
  return key && !isGenericEmployer(key) ? byAlias.get(key) : undefined
}

/**
 * EVERY school whose page lists a live job (2026-10-20): each school judged ALONE by the rule above — the job its own
 * linked shop posted, wherever it is, and an HCMC job whose employer is exactly one of its names. With the maps of
 * every school at once this answers, for each of them, what jobSchoolId answers with that school's maps alone — which
 * is how a school's page has always read its jobs (queries.ts jobsBySchool([school])). So the board and pages.xml,
 * which read every school at once, count exactly what each page lists; the two differ from jobSchoolId only for a job
 * one school's shop posts under ANOTHER school's name, which is on both pages. jobSchoolId keeps the shop first for the
 * one school a job page links to.
 * ⚠️ IT RELIES ON ONE SCHOOL PER KEY, WHICH THE SCHEMA GUARANTEES: School.sellerId is @unique (one shop ↔ at most one
 * school) and SchoolAlias.alias is the primary key (an alias names one school) — so a map built from every school
 * never loses a school a page alone would find. job-match.test.ts pins both constraints.
 */
export function jobSchoolIds(
  job: JobPlace & { employer: unknown; sellerId: string },
  bySeller: ReadonlyMap<string, string>,
  byAlias: ReadonlyMap<string, string>,
): string[] {
  const own = bySeller.get(job.sellerId)
  const named = namedSchoolId(job, byAlias)
  return [own, named].filter((id, i, all): id is string => !!id && all.indexOf(id) === i)
}
