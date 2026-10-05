import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { db } from '@/lib/db'
import { queuedReviewCount, queuedReviewIds } from '@/lib/schools/queries'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell, pickTab } from '@/components/admin/section-shell'
import { SchoolsAdminClient, type AdminProof, type AdminReview, type AdminReport, type AdminSchool } from '@/components/admin/schools-admin-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Schools — eno.vn admin', robots: { index: false, follow: false } }

// /schools moderation (2026-10-04). Reviews are PRE-MODERATED: nothing a teacher writes is public until
// it is approved here. Reports never hide anything on their own — they land in the second tab, and a
// school's complaint carries a 24 h due-by (plan v2). The third tab hides or shows a directory entry.
// 2026-10-05: "Proofs" — a teacher's private proof of employment (their LinkedIn profile) waits here; a
// review can only be approved once its writer's proof is verified.
const TABS = ['reviews', 'proofs', 'reports', 'directory'] as const
const DAY_MS = 86_400_000

export default async function AdminSchoolsPage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const tab = pickTab((await searchParams)?.tab, TABS, 'reviews')
  // ⛔ NO WRITES ON A GET (diff review: a prefetch of this page would have deleted). Retention runs on its schedule
  // (/api/cron/school-proof-retention); here a proof past its date is simply not offered (actionableProof).
  const now = new Date()
  const [pendingCount, openCount, proofCount] = await Promise.all([
    queuedReviewCount(),
    db.schoolReport.count({ where: { status: 'open' } }),
    db.schoolEmployment.count({ where: actionableProof(now) }),
  ])

  let reviews: AdminReview[] = [], reports: AdminReport[] = [], schools: AdminSchool[] = [], proofs: AdminProof[] = []
  if (tab === 'reviews') {
    // In the queue's own order — approvable first (queries.ts queuedReviewIds) — not re-sorted by date here.
    const queue = await queuedReviewIds(100)
    const place = new Map(queue.map((id, i) => [id, i]))
    const rows = (await db.schoolReview.findMany({
      where: { id: { in: queue } },
      include: { school: { select: { name: true, slug: true } } },
    })).sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0))
    const authors = await authorInfo(rows.map((r) => r.profileId))
    // ⚠️ Never `OR: []` (diff review): an empty queue asks for no proofs at all.
    const proofRows = rows.length
      ? await db.schoolEmployment.findMany({
          where: { OR: rows.map((r) => ({ profileId: r.profileId, schoolId: r.schoolId })) },
          select: { id: true, profileId: true, schoolId: true, status: true, method: true },
        })
      : []
    const owners = await keyOwners(proofRows.map((p) => p.profileId))
    const proofOf = new Map(proofRows.map((p) => [`${p.profileId}:${p.schoolId}`, { id: p.id, status: p.status, method: p.method, revocable: revocable(p, owners) }]))
    reviews = rows.map((r) => ({ ...toAdminReview(r, authors.get(r.profileId) ?? null), proof: proofOf.get(`${r.profileId}:${r.schoolId}`) ?? null }))
  } else if (tab === 'proofs') {
    const rows = await db.schoolEmployment.findMany({
      where: actionableProof(now), orderBy: { updatedAt: 'asc' }, take: 100,
      select: { id: true, method: true, linkedinUrl: true, challenge: true, flags: true, createdAt: true, updatedAt: true, profileId: true, school: { select: { name: true, slug: true, website: true } } },
    })
    const people = await authorInfo(rows.map((r) => r.profileId))
    proofs = rows.map((r) => ({
      id: r.id, method: r.method, linkedinUrl: r.linkedinUrl, challenge: r.challenge, flags: r.flags,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), school: r.school, author: people.get(r.profileId) ?? null,
    }))
  } else if (tab === 'reports') {
    const rows = await db.schoolReport.findMany({
      where: { status: 'open' }, orderBy: { createdAt: 'asc' }, take: 200,
      include: { school: { select: { name: true, slug: true, website: true } }, review: { include: { school: { select: { name: true, slug: true } } } } },
    })
    const ids = rows.flatMap((r) => [r.reporterProfileId, r.review?.profileId].filter((x): x is string => !!x))
    const reviewed = rows.flatMap((r) => (r.review ? [{ profileId: r.review.profileId, schoolId: r.review.schoolId }] : []))
    const people = await authorInfo(ids)
    const proofRows = reviewed.length
      ? await db.schoolEmployment.findMany({ where: { OR: reviewed }, select: { id: true, profileId: true, schoolId: true, status: true, method: true } })
      : []
    const owners = await keyOwners(proofRows.map((p) => p.profileId))
    const proofOf = new Map(proofRows.map((p) => [`${p.profileId}:${p.schoolId}`, { id: p.id, status: p.status, method: p.method, revocable: revocable(p, owners) }] as const))
    reports = rows.map((r) => ({
      id: r.id, kind: r.kind as AdminReport['kind'], reason: r.reason, detail: r.detail, contactEmail: r.contactEmail,
      createdAt: r.createdAt.toISOString(),
      dueBy: r.kind === 'school_complaint' ? new Date(r.createdAt.getTime() + DAY_MS).toISOString() : null,
      school: r.school,
      reporter: r.reporterProfileId ? people.get(r.reporterProfileId) ?? null : null,
      review: r.review ? { ...toAdminReview(r.review, people.get(r.review.profileId) ?? null), proof: proofOf.get(`${r.review.profileId}:${r.review.schoolId}`) ?? null } : null,
    }))
  } else {
    const rows = await db.school.findMany({ orderBy: { name: 'asc' }, select: { id: true, slug: true, name: true, kind: true, status: true, _count: { select: { reviews: true, aliases: true } } } })
    const published = await db.schoolReview.groupBy({ by: ['schoolId'], where: { status: 'published' }, _count: { _all: true } })
    const pub = new Map(published.map((p) => [p.schoolId, p._count._all]))
    schools = rows.map((s) => ({ id: s.id, slug: s.slug, name: s.name, kind: s.kind, status: s.status, reviews: s._count.reviews, published: pub.get(s.id) ?? 0, aliases: s._count.aliases }))
  }

  return (
    <AdminSectionShell
      title="Schools"
      description={<>Signed in as {admin}. Teacher reviews wait here until approved; reports and school complaints never act on their own.</>}
      basePath="/admin/schools"
      tabs={[
        { key: 'reviews', label: 'Pending reviews', count: pendingCount },
        { key: 'proofs', label: 'Proofs of employment', count: proofCount },
        { key: 'reports', label: 'Reports & complaints', count: openCount },
        { key: 'directory', label: 'Directory' },
      ]}
      active={tab}
    >
      <SchoolsAdminClient tab={tab} reviews={reviews} reports={reports} schools={schools} proofs={proofs} />
    </AdminSectionShell>
  )
}

/** A proof a moderator can decide: a LinkedIn profile waiting to be checked, inside its window (past it the daily sweep closes it). */
const actionableProof = (now: Date) => ({ status: 'pending', linkedinHash: { not: null }, purgeAt: { gt: now } })

/**
 * Which accounts still own a live ledger key (proved with some LinkedIn profile, not yet burnt) — what makes a proof
 * in any state revocable (api/admin/schools proof_revoke). Computed here so the console offers Revoke only where the server
 * would accept it (diff review).
 */
async function keyOwners(profileIds: string[]): Promise<Set<string>> {
  if (!profileIds.length) return new Set()
  const rows = await db.schoolProofKey.findMany({ where: { kind: 'linkedin', profileId: { in: [...new Set(profileIds)] }, rejectedAt: null }, select: { profileId: true } })
  return new Set(rows.flatMap((k) => (k.profileId ? [k.profileId] : [])))
}
const revocable = (p: { status: string; profileId: string }, owners: Set<string>) => p.status === 'verified' || owners.has(p.profileId)

/** What a moderator needs to judge the WRITER: age, standing, trust tier and type. Never shown publicly. */
async function authorInfo(ids: string[]) {
  const rows = ids.length
    ? await db.profile.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, createdAt: true, trustTier: true, enforcementState: true, accountType: true } })
    : []
  return new Map(rows.map((p) => [p.id, { id: p.id, createdAt: p.createdAt.toISOString(), trustTier: p.trustTier, enforcementState: p.enforcementState, accountType: p.accountType }]))
}

function toAdminReview(
  r: { id: string; current: boolean; tenure: string; role: string; employment: string; leftYear: number | null; district: string | null; pros: string; cons: string; advice: string | null; goodTags: string[]; badTags: string[]; payAmount: number | null; payCurrency: string | null; payPeriod: string | null; payVnd: number | null; flags: string[]; status: string; replyText: string | null; createdAt: Date; updatedAt: Date; school: { name: string; slug: string } },
  author: AdminReview['author'],
): Omit<AdminReview, 'proof'> {
  return {
    id: r.id, school: r.school, current: r.current, tenure: r.tenure, role: r.role, employment: r.employment, leftYear: r.leftYear, district: r.district,
    pros: r.pros, cons: r.cons, advice: r.advice, goodTags: r.goodTags, badTags: r.badTags,
    pay: r.payAmount && r.payCurrency && r.payPeriod ? { amount: r.payAmount, currency: r.payCurrency, period: r.payPeriod, vnd: r.payVnd } : null,
    flags: r.flags, status: r.status, replyText: r.replyText, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), author,
  }
}
