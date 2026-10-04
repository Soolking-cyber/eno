import 'server-only'
import { cache } from 'react'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { fold } from '@/lib/fold'
import { scopedListingWhere } from '@/lib/edition-scope'
import { LISTING_CARD_SELECT, serializeListingCard, safeParse } from '@/lib/serialize'
import { ELIGIBLE_ACCOUNT_AGE_DAYS, REQUIRE_PHONE, type SchoolKind, type GoodTag, type BadTag, isGoodTag, isBadTag } from './constants'
import { compareSchools, isGenericEmployer, normEmployer, summarisePay, type PaySummary, type SchoolSort } from './logic'
import { inHcmc, jobSchoolId, type JobPlace } from './job-match'

/**
 * Server reads for /schools. Every public number is computed HERE at read time from the rows, with the
 * eligibility rule applied in SQL (plan review 2026-10-04): no stored counters to drift under concurrent
 * votes, and an account starts counting the moment it ages into eligibility.
 */

/**
 * ⛔ WHOSE VOICE COUNTS — the one place it is written. `p` = the author's Profile, `s` = the School.
 * An individual account (a NULL accountType is an individual who has not onboarded yet), in good
 * standing, not trust-restricted, not an owner of the school's own linked shop, and (eligibleSql) at
 * least ELIGIBLE_ACCOUNT_AGE_DAYS old. ONE RULE FOR EVERYTHING PUBLIC — votes, helpful votes, and which
 * published reviews (with their tags and pay) show — so an account that is later held, restricted or
 * turns out to own the school drops out everywhere at once, a new account's approved review waits for
 * the same 7 days its vote does, and there is no stored counter to correct (diff review: the page must
 * not state two rules).
 */
function standingSql(): Prisma.Sql {
  return Prisma.sql`
    coalesce(p."accountType", 'individual') <> 'business'
    and p."enforcementState" = 'good_standing'
    and p."trustTier" <> 'restricted'
    and (s."sellerId" is null or not exists (select 1 from "Seller" se where se.id = s."sellerId" and se."ownerId" = p.id))
    ${REQUIRE_PHONE ? Prisma.sql`and p.phone is not null` : Prisma.empty}`
}

/** The full rule. `::int` because a JS number may bind as bigint, and make_interval(days => bigint) does not exist. */
function eligibleSql(): Prisma.Sql {
  // ⚠️ UTC EXPLICITLY: Prisma stores naive UTC timestamps, and comparing one with now() (timestamptz)
  // reads it in the SESSION time zone — a +7 h error on a database whose session runs in Saigon time.
  return Prisma.sql`p."createdAt" <= (now() at time zone 'UTC') - make_interval(days => ${ELIGIBLE_ACCOUNT_AGE_DAYS}::int) and ${standingSql()}`
}

type VoteRow = { schoolId: string; up: number; down: number }

async function eligibleVotes(schoolIds: string[]): Promise<Map<string, { up: number; down: number }>> {
  const out = new Map<string, { up: number; down: number }>()
  if (!schoolIds.length) return out
  const rows = await db.$queryRaw<VoteRow[]>`
    select v."schoolId" as "schoolId",
           count(*) filter (where v.value = 1)::int as up,
           count(*) filter (where v.value = -1)::int as down
      from "SchoolVote" v
      join "Profile" p on p.id = v."profileId"
      join "School" s on s.id = v."schoolId"
     where v."schoolId" in (${Prisma.join(schoolIds)})
       and ${eligibleSql()}
     group by v."schoolId"`
  for (const r of rows) out.set(r.schoolId, { up: r.up, down: r.down })
  return out
}

/** The PUBLIC reviews: published by a moderator AND by an author who counts (eligibleSql). */
async function visibleReviewIds(schoolIds: string[]): Promise<{ id: string; schoolId: string }[]> {
  if (!schoolIds.length) return []
  return db.$queryRaw<{ id: string; schoolId: string }[]>`
    select r.id, r."schoolId" as "schoolId"
      from "SchoolReview" r
      join "Profile" p on p.id = r."profileId"
      join "School" s on s.id = r."schoolId"
     where r."schoolId" in (${Prisma.join(schoolIds)})
       and r.status = 'published'
       and ${eligibleSql()}`
}

/** Public reviews per school. */
async function publishedReviewCounts(schoolIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const r of await visibleReviewIds(schoolIds)) out.set(r.schoolId, (out.get(r.schoolId) ?? 0) + 1)
  return out
}

/**
 * The PUBLIC shape of pay: ONLY the periods that cleared the floor. Below it nothing period-specific leaves
 * the server — not the count ("1 of 5" tells readers the lone reviewer reported pay) and not even that a
 * period HAS reports (an "Hourly — not enough yet" card says the same, and hints at part-time work).
 */
export type PublicPay = { period: 'hour' | 'month'; shown: true; lo: number; hi: number }
const publicPay = (xs: PaySummary[]): PublicPay[] => xs.filter((p): p is Extract<PaySummary, { shown: true }> => p.shown)

/**
 * Pay reports from the PUBLIC reviews (the same rule as the reviews themselves), per school.
 * ⚠️ ONLY REVIEWS PUBLISHED BEFORE THIS WEEK (Opus, diff review): if the range moved the moment a review
 * went live, comparing two snapshots would tie that dated review to its pay ("the range rose, so the new
 * teacher reported above it"). Batching by week blurs which review moved it.
 */
async function payReports(schoolIds: string[]) {
  if (!schoolIds.length) return new Map<string, PublicPay[]>()
  const rows = await db.$queryRaw<{ schoolId: string; profileId: string; payVnd: number; payPeriod: 'hour' | 'month'; createdAt: Date }[]>`
    select r."schoolId" as "schoolId", r."profileId"::text as "profileId", r."payVnd" as "payVnd",
           r."payPeriod" as "payPeriod", r."submittedAt" as "createdAt"
      from "SchoolReview" r
      join "Profile" p on p.id = r."profileId"
      join "School" s on s.id = r."schoolId"
     where r."schoolId" in (${Prisma.join(schoolIds)})
       and r.status = 'published' and r."payVnd" is not null
       and coalesce(r."moderatedAt", r."submittedAt") < date_trunc('week', now() at time zone 'UTC')
       and ${eligibleSql()}`
  const by = new Map<string, typeof rows>()
  for (const r of rows) by.set(r.schoolId, [...(by.get(r.schoolId) ?? []), r])
  const out = new Map<string, PublicPay[]>()
  for (const [id, list] of by) out.set(id, publicPay(summarisePay(list)))
  return out
}

// ── jobs ───────────────────────────────────────────────────────────────────────────────────────

/** Category id of `jobs`, or null when the row does not exist (then there are no jobs to match). */
async function jobsCategoryId(): Promise<string | null> {
  const row = await db.category.findUnique({ where: { slug: 'jobs' }, select: { id: true } })
  return row?.id ?? null
}

/**
 * Live job listings → school ids (job-match.ts jobSchoolId: the school's own linked shop anywhere, else an
 * EXACT normalised employer against the alias table for a job in HCMC). Active jobs are a few hundred rows;
 * one scan per request is cheaper and more truthful than a materialised table that has to follow every import.
 */
async function jobsBySchool(schools: { id: string; sellerId: string | null }[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const catId = await jobsCategoryId()
  if (!catId || !schools.length) return out
  const [jobs, aliases] = await Promise.all([
    db.listing.findMany({
      where: await scopedListingWhere({ categoryId: catId, status: 'active', verified: true }),
      select: { id: true, attributes: true, sellerId: true, city: true },
      orderBy: { postedAt: 'desc' },
      // Live jobs were 25 on 2026-10-04; the cap only bounds a pathological import.
      take: 5000,
    }),
    db.schoolAlias.findMany({ where: { schoolId: { in: schools.map((s) => s.id) } }, select: { alias: true, schoolId: true } }),
  ])
  const byAlias = new Map(aliases.map((a) => [a.alias, a.schoolId]))
  const bySeller = new Map(schools.filter((s) => s.sellerId).map((s) => [s.sellerId as string, s.id]))
  for (const j of jobs) {
    const employer = safeParse<Record<string, unknown>>(j.attributes, {})?.employer
    const sid = jobSchoolId({ employer, sellerId: j.sellerId, city: j.city }, bySeller, byAlias)
    if (sid) out.set(sid, [...(out.get(sid) ?? []), j.id])
  }
  return out
}

// ── list page ──────────────────────────────────────────────────────────────────────────────────

export type SchoolListRow = {
  id: string; slug: string; name: string; kind: SchoolKind; districts: string[]; aliases: string[]
  up: number; down: number; reviews: number; jobs: number; pay: PublicPay[]
}

export async function listSchools(opts: { kind?: SchoolKind | null; area?: string | null; q?: string | null; sort: SchoolSort }): Promise<SchoolListRow[]> {
  const schools = await db.school.findMany({
    where: {
      status: 'active',
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.area ? { districts: { has: opts.area } } : {}),
    },
    select: { id: true, slug: true, name: true, kind: true, districts: true, sellerId: true, aliases: { select: { alias: true } } },
  })
  const q = opts.q ? fold(opts.q).trim() : ''
  // ⚠️ "the" or "Vietnam" normalise to '' — and every alias includes ''. Alias matching needs a real term.
  const alias = normEmployer(q)
  const filtered = q
    ? schools.filter((s) => fold(s.name).includes(q) || (alias.length > 1 && s.aliases.some((a) => a.alias.includes(alias))))
    : schools
  const ids = filtered.map((s) => s.id)
  const [votes, reviews, pay, jobs] = await Promise.all([eligibleVotes(ids), publishedReviewCounts(ids), payReports(ids), jobsBySchool(filtered)])
  const rows: SchoolListRow[] = filtered.map((s) => ({
    id: s.id, slug: s.slug, name: s.name, kind: s.kind as SchoolKind, districts: s.districts, aliases: s.aliases.map((a) => a.alias),
    up: votes.get(s.id)?.up ?? 0, down: votes.get(s.id)?.down ?? 0,
    reviews: reviews.get(s.id) ?? 0, jobs: jobs.get(s.id)?.length ?? 0, pay: pay.get(s.id) ?? [],
  }))
  return rows.sort(compareSchools(opts.sort))
}

/**
 * Every active school, ranked 'top'. The list page renders ALL of them (a few hundred rows) and filters
 * and re-sorts in the browser, so its HTML can be cached (ISR) and every school is a crawlable link.
 */
export function listAllSchools(): Promise<SchoolListRow[]> {
  return listSchools({ sort: 'top' })
}

// ── detail page ────────────────────────────────────────────────────────────────────────────────

export type PublicReview = {
  id: string; current: boolean; tenure: 'lt1' | '1to2' | '2plus'; role: 'teacher' | 'head_teacher' | 'assistant' | 'other'
  employment: 'full_time' | 'part_time' | 'contract'; leftYear: number | null; showLeftYear: boolean; district: string | null
  pros: string; cons: string; advice: string | null; goodTags: GoodTag[]; badTags: BadTag[]
  up: number; down: number; replyText: string | null; replyAt: string | null; createdAt: string
}

async function loadSchoolPage(slug: string) {
  const school = await db.school.findFirst({
    where: { slug, status: 'active' },
    select: { id: true, slug: true, name: true, kind: true, website: true, districts: true, curricula: true, summary: true, summaryVi: true, sellerId: true, updatedAt: true },
  })
  if (!school) return null
  const ids = [school.id]
  const visible = (await visibleReviewIds(ids)).map((r) => r.id)
  const [votes, pay, jobIds, reviewRows] = await Promise.all([
    eligibleVotes(ids), payReports(ids), jobsBySchool([school]),
    db.schoolReview.findMany({
      where: { id: { in: visible } },
      orderBy: { submittedAt: 'desc' },
      take: 200,
      // ⛔ NO profileId, NO pay: neither ever leaves the server on a public page.
      select: {
        id: true, current: true, tenure: true, role: true, employment: true, leftYear: true, showLeftYear: true, district: true,
        pros: true, cons: true, advice: true, goodTags: true, badTags: true, replyText: true, replyAt: true, submittedAt: true,
      },
    }),
  ])
  const helpful = await eligibleReviewVotes(reviewRows.map((r) => r.id), school.id)
  const reviews: PublicReview[] = reviewRows.map((r) => ({
    ...r,
    // ⛔ A HIDDEN YEAR NEVER LEAVES THE SERVER (codex, diff review): stintParts only hid it from the
    // screen, while the exact year still rode in the page payload for anyone reading the source.
    leftYear: r.showLeftYear ? r.leftYear : null,
    tenure: r.tenure as PublicReview['tenure'], role: r.role as PublicReview['role'], employment: r.employment as PublicReview['employment'],
    goodTags: r.goodTags.filter(isGoodTag), badTags: r.badTags.filter(isBadTag),
    up: helpful.get(r.id)?.up ?? 0, down: helpful.get(r.id)?.down ?? 0,
    replyAt: r.replyAt?.toISOString() ?? null, createdAt: r.submittedAt.toISOString(),
  }))
  // tag counts across published reviews
  const goodCounts = new Map<GoodTag, number>(), badCounts = new Map<BadTag, number>()
  for (const r of reviews) {
    for (const t of r.goodTags) goodCounts.set(t, (goodCounts.get(t) ?? 0) + 1)
    for (const t of r.badTags) badCounts.set(t, (badCounts.get(t) ?? 0) + 1)
  }
  const jobIdsHere = jobIds.get(school.id) ?? []
  const jobRows = jobIdsHere.length
    ? await db.listing.findMany({ where: await scopedListingWhere({ id: { in: jobIdsHere.slice(0, 24) } }), select: { ...LISTING_CARD_SELECT, attributes: true }, orderBy: { postedAt: 'desc' } })
    : []
  const jobs = jobRows.map((j) => ({
    card: serializeListingCard(j),
    employer: (() => { const e = safeParse<Record<string, unknown>>(j.attributes, {})?.employer; return typeof e === 'string' ? e : null })(),
  }))
  return {
    school: { ...school, kind: school.kind as SchoolKind },
    up: votes.get(school.id)?.up ?? 0,
    down: votes.get(school.id)?.down ?? 0,
    pay: pay.get(school.id) ?? [],
    reviews,
    goodTags: [...goodCounts.entries()].sort((a, b) => b[1] - a[1]),
    badTags: [...badCounts.entries()].sort((a, b) => b[1] - a[1]),
    jobs,
  }
}

/** One load per request, shared by generateMetadata and the page. */
export const getSchoolPage = cache(loadSchoolPage)
export type SchoolPage = NonNullable<Awaited<ReturnType<typeof loadSchoolPage>>>

async function eligibleReviewVotes(reviewIds: string[], schoolId: string): Promise<Map<string, { up: number; down: number }>> {
  const out = new Map<string, { up: number; down: number }>()
  if (!reviewIds.length) return out
  const rows = await db.$queryRaw<{ reviewId: string; up: number; down: number }[]>`
    select v."reviewId" as "reviewId",
           count(*) filter (where v.value = 1)::int as up,
           count(*) filter (where v.value = -1)::int as down
      from "SchoolReviewVote" v
      join "SchoolReview" r on r.id = v."reviewId"
      join "Profile" p on p.id = v."profileId"
      join "School" s on s.id = ${schoolId}
     where v."reviewId" in (${Prisma.join(reviewIds)})
       and v."profileId" <> r."profileId" -- an author's own helpful vote never counts (the API refuses it too)
       and ${eligibleSql()}
     group by v."reviewId"`
  for (const r of rows) out.set(r.reviewId, { up: r.up, down: r.down })
  return out
}

/**
 * Schools for pages.xml: active, with at least one PUBLIC review (the page's own rule — published AND by an
 * author who counts), dated by the newest approval. ⚠️ The same rule as the page's noindex, so the sitemap
 * never submits a school page that answers noindex (diff review).
 */
export async function schoolsForSitemap(): Promise<{ slug: string; lastmod: Date | null }[]> {
  return db.$queryRaw<{ slug: string; lastmod: Date | null }[]>`
    select s.slug as slug, max(r."moderatedAt") as lastmod
      from "School" s
      join "SchoolReview" r on r."schoolId" = s.id and r.status = 'published'
      join "Profile" p on p.id = r."profileId"
     where s.status = 'active'
       and ${eligibleSql()}
     group by s.slug
     order by s.slug`
}

// ── live state for the client islands (no-store) ───────────────────────────────────────────────

/** Eligible helpful-vote counts for the given reviews (the school comes from each review). */
export async function liveReviewCounts(reviewIds: string[]): Promise<Record<string, { up: number; down: number }>> {
  const ids = [...new Set(reviewIds)].slice(0, 400)
  if (!ids.length) return {}
  const rows = await db.$queryRaw<{ reviewId: string; up: number; down: number }[]>`
    select v."reviewId" as "reviewId",
           count(*) filter (where v.value = 1)::int as up,
           count(*) filter (where v.value = -1)::int as down
      from "SchoolReviewVote" v
      join "SchoolReview" r on r.id = v."reviewId"
      join "School" s on s.id = r."schoolId"
      join "Profile" p on p.id = v."profileId"
     where v."reviewId" in (${Prisma.join(ids)})
       and r.status = 'published' and s.status = 'active'
       and v."profileId" <> r."profileId"
       and ${eligibleSql()}
     group by v."reviewId"`
  // Zero-filled only for PUBLIC reviews: a pending or rejected id gets nothing back.
  const published = await db.schoolReview.findMany({ where: { id: { in: ids }, status: 'published', school: { status: 'active' } }, select: { id: true } })
  const out: Record<string, { up: number; down: number }> = Object.fromEntries(published.map((r) => [r.id, { up: 0, down: 0 }]))
  for (const r of rows) if (out[r.reviewId]) out[r.reviewId] = { up: r.up, down: r.down }
  return out
}

/** Eligible counts for the given schools and the caller's own votes (and whether they count yet). */
export async function liveState(schoolIds: string[], profileId: string | null) {
  const ids = [...new Set(schoolIds)].slice(0, 400)
  const [votes, mine] = await Promise.all([
    eligibleVotes(ids),
    profileId ? db.schoolVote.findMany({ where: { profileId, schoolId: { in: ids } }, select: { schoolId: true, value: true } }) : Promise.resolve([]),
  ])
  return {
    counts: Object.fromEntries(ids.map((id) => [id, votes.get(id) ?? { up: 0, down: 0 }])),
    mine: Object.fromEntries(mine.map((v) => [v.schoolId, v.value])),
  }
}

export async function myReviewVotes(reviewIds: string[], profileId: string) {
  const rows = await db.schoolReviewVote.findMany({ where: { profileId, reviewId: { in: reviewIds.slice(0, 400) } }, select: { reviewId: true, value: true } })
  return Object.fromEntries(rows.map((r) => [r.reviewId, r.value]))
}

/**
 * Can this account cast a vote / write a review AT ALL (write-time), and does it count YET (read-time)?
 * A business account, a suspended/held/throttled account or a trust-restricted one cannot; a young account
 * can, and its vote starts counting when it reaches ELIGIBLE_ACCOUNT_AGE_DAYS.
 */
export function writeEligibility(p: { accountType: string | null; enforcementState: string; trustTier: string; createdAt: Date; phone?: string | null }) {
  if (p.accountType === 'business') return { ok: false as const, code: 'business_account' as const }
  // ⚠️ AN ALLOWLIST, THE SAME ONE THE READ RULE USES (eligibleSql): a state this code has never heard of
  // must not be able to write something that then silently never counts (diff review, Opus).
  if (p.enforcementState !== 'good_standing') return { ok: false as const, code: 'account_restricted' as const }
  if (p.trustTier === 'restricted') return { ok: false as const, code: 'account_restricted' as const }
  if (REQUIRE_PHONE && !p.phone) return { ok: false as const, code: 'phone_required' as const }
  const countsFrom = new Date(p.createdAt.getTime() + ELIGIBLE_ACCOUNT_AGE_DAYS * 86_400_000)
  return { ok: true as const, countsNow: countsFrom <= new Date(), countsFrom }
}

/**
 * The school a job ad belongs to, for the "What teachers say" link on a job page: the school's own linked
 * shop, else the EXACT normalised employer against the alias table (the same rule as jobsBySchool).
 * ⛔ NEVER THROWS: it runs inside the listing page, the site's most-visited render, and a missing table
 * or a slow read must cost the link, not the page.
 */
export async function schoolForJob(employer: unknown, sellerId: string, place: JobPlace): Promise<{ slug: string; name: string } | null> {
  try {
    // jobSchoolId's first rule, answered before the alias read so a failed or slow alias lookup can never
    // cost a school its own shop's job (diff review): the school's linked shop counts wherever the job is.
    const own = await db.school.findFirst({ where: { sellerId, status: 'active' }, select: { slug: true, name: true } })
    if (own) return own
    const key = typeof employer === 'string' ? normEmployer(employer) : ''
    // Read the alias only when the rule could accept it — not for a generic name or a job outside HCMC.
    const named = key && !isGenericEmployer(key) && inHcmc(place)
      ? await db.schoolAlias.findUnique({ where: { alias: key }, select: { school: { select: { id: true, slug: true, name: true, status: true } } } })
      : null
    const hit = named?.school.status === 'active' ? named.school : null
    // The rest of the SAME rule as jobsBySchool (job-match.ts): HCMC only, never a generic name.
    return hit && jobSchoolId({ employer, sellerId, ...place }, new Map(), new Map([[key, hit.id]])) === hit.id ? { slug: hit.slug, name: hit.name } : null
  } catch {
    return null
  }
}
