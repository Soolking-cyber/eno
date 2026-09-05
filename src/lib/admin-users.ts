import 'server-only'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'
import { recomputeVerification } from '@/lib/compliance/recompute-verification'

// ── THE USERS CONSOLE (admin, 2026-09-05: "manage the existing userbase") ──────────────────────
//
// One place to find any account and see everything the platform knows about it — identity, the
// storefront, reports filed and received, the enforcement ladder, the audit trail — and to take
// the few actions that are an admin's to take: revoke a verification, erase the account on a
// written request, and (through the existing enforcement API) move it on the ladder.
//
// ⛔ EVERY READ HERE IS GATED BY route({ auth: 'admin' }) OR getAdmin() AT THE CALL SITE. This
// module deliberately has no notion of "who is asking": it is only ever reached from admin code,
// and it never signs a document URL (the identity queue does that, with its own ownership proof).
// It returns EMAIL and PHONE — the identifiers an operator searches by — and nothing a report
// would call a document.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AdminUserFilter = 'all' | 'pending_identity' | 'verified' | 'enforced' | 'sellers'
export const ADMIN_USER_FILTERS: readonly AdminUserFilter[] = ['all', 'pending_identity', 'verified', 'enforced', 'sellers']

export type AdminUserRow = {
  id: string
  email: string | null
  displayName: string | null
  phone: string | null
  createdAt: string
  lastSeenAt: string | null
  verificationStatus: string
  verificationTier: string | null
  enforcementState: string
  trustScore: number
  trustTier: string
  seller: { id: string; name: string; verifiedSeller: boolean; listings: number } | null
}

const PAGE = 50

export async function searchAdminUsers(input: { q?: string; filter?: AdminUserFilter; cursor?: string | null }): Promise<{ rows: AdminUserRow[]; nextCursor: string | null }> {
  const q = (input.q ?? '').trim().slice(0, 120)
  const filter: AdminUserFilter = ADMIN_USER_FILTERS.includes(input.filter ?? 'all') ? (input.filter ?? 'all') : 'all'
  const and: object[] = []
  if (q) {
    and.push({
      OR: [
        // Profile.id is a uuid column: a non-uuid literal is a P2023 throw, not a miss.
        ...(UUID_RE.test(q) ? [{ id: q }] : []),
        { email: { contains: q, mode: 'insensitive' as const } },
        { displayName: { contains: q, mode: 'insensitive' as const } },
        { phone: { contains: q.replace(/\s+/g, '') } },
        { seller: { name: { contains: q, mode: 'insensitive' as const } } },
      ],
    })
  }
  if (filter === 'pending_identity') and.push({ verificationStatus: 'pending' })
  if (filter === 'verified') and.push({ verificationStatus: 'verified' })
  if (filter === 'enforced') and.push({ enforcementState: { not: 'good_standing' } })
  if (filter === 'sellers') and.push({ seller: { isNot: null } })

  const rows = await db.profile.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: PAGE + 1,
    ...(input.cursor && UUID_RE.test(input.cursor) ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true, email: true, displayName: true, phone: true, createdAt: true, lastSeenAt: true,
      verificationStatus: true, verificationTier: true, enforcementState: true, trustScore: true, trustTier: true,
      seller: { select: { id: true, name: true, verifiedSeller: true, _count: { select: { listings: true } } } },
    },
  })
  const page = rows.slice(0, PAGE)
  return {
    rows: page.map((p) => ({
      id: p.id, email: p.email, displayName: p.displayName, phone: p.phone,
      createdAt: p.createdAt.toISOString(), lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
      verificationStatus: p.verificationStatus, verificationTier: p.verificationTier,
      enforcementState: p.enforcementState, trustScore: p.trustScore, trustTier: p.trustTier,
      seller: p.seller ? { id: p.seller.id, name: p.seller.name, verifiedSeller: p.seller.verifiedSeller, listings: p.seller._count.listings } : null,
    })),
    nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
  }
}

export type AdminUserDetail = {
  profile: {
    id: string; email: string | null; displayName: string | null; phone: string | null; locale: string | null
    accountType: string | null; businessName: string | null; createdAt: string; lastSeenAt: string | null; tosAcceptedAt: string | null
    trustScore: number; trustTier: string; falseReportStrikes: number
    enforcementState: string; enforcementUntil: string | null
    verificationStatus: string; verificationTier: string | null; verificationMethod: string | null; verifiedAt: string | null; documentExpiresAt: string | null
    complianceFlag: string | null
  }
  seller: {
    id: string; name: string; verified: boolean; verifiedSeller: boolean; officialPartner: boolean; memberSince: string
    legalName: string | null; taxCode: string | null; verifiedUntil: string | null
    listings: { total: number; active: number }
    verificationCases: Array<{ id: string; status: string; submittedAt: string | null; reviewedAt: string | null; reviewedBy: string | null }>
  } | null
  identity: Array<{ id: string; tier: string; method: string; status: string; submittedAt: string; decidedAt: string | null; decidedBy: string | null; rejectReason: string | null; documentExpiresAt: string | null; nationality: string | null }>
  reports: { filed: number; against: number; openAgainst: number }
  enforcement: Array<{ id: string; state: string; reason: string; status: string; decidedBy: string; createdAt: string; expiresAt: string | null; liftedAt: string | null; adminNote: string | null }>
  audit: Array<{ occurredAt: string; actorType: string; actorId: string | null; action: string }>
}

export async function getAdminUserDetail(id: string): Promise<AdminUserDetail | null> {
  const p = await db.profile.findUnique({
    where: { id },
    select: {
      id: true, email: true, displayName: true, phone: true, locale: true, accountType: true, businessName: true,
      createdAt: true, lastSeenAt: true, tosAcceptedAt: true, trustScore: true, trustTier: true, falseReportStrikes: true,
      enforcementState: true, enforcementUntil: true, verificationStatus: true, verificationTier: true, verificationMethod: true,
      verifiedAt: true, documentExpiresAt: true, complianceFlag: true,
      seller: {
        select: {
          id: true, name: true, verified: true, verifiedSeller: true, officialPartner: true, memberSince: true,
          legalName: true, taxCode: true, verifiedUntil: true,
          _count: { select: { listings: true } },
        },
      },
    },
  })
  if (!p) return null
  const sellerId = p.seller?.id ?? null
  const [activeListings, identity, filed, against, openAgainst, enforcement, audit, verificationCases] = await Promise.all([
    sellerId ? db.listing.count({ where: { sellerId, status: 'active' } }) : Promise.resolve(0),
    db.identityVerification.findMany({
      where: { profileId: id },
      orderBy: { submittedAt: 'desc' },
      take: 10,
      select: { id: true, tier: true, method: true, status: true, submittedAt: true, decidedAt: true, decidedBy: true, rejectReason: true, documentExpiresAt: true, nationality: true },
    }),
    db.report.count({ where: { reporterProfileId: id } }),
    db.report.count({ where: { OR: [{ targetProfileId: id }, ...(sellerId ? [{ targetSellerId: sellerId }] : [])] } }),
    db.report.count({ where: { status: 'open', OR: [{ targetProfileId: id }, ...(sellerId ? [{ targetSellerId: sellerId }] : [])] } }),
    db.enforcementAction.findMany({
      where: { profileId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, state: true, reason: true, status: true, decidedBy: true, createdAt: true, expiresAt: true, liftedAt: true, adminNote: true },
    }),
    db.complianceAudit.findMany({
      where: { subjectType: 'profile', subjectId: id },
      orderBy: { occurredAt: 'desc' },
      take: 15,
      select: { occurredAt: true, actorType: true, actorId: true, action: true },
    }).catch(() => []),
    sellerId
      ? db.sellerVerification.findMany({ where: { sellerId }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, status: true, submittedAt: true, reviewedAt: true, reviewedBy: true } })
      : Promise.resolve([]),
  ])
  const iso = (d: Date | null | undefined) => d?.toISOString() ?? null
  return {
    profile: {
      id: p.id, email: p.email, displayName: p.displayName, phone: p.phone, locale: p.locale, accountType: p.accountType, businessName: p.businessName,
      createdAt: p.createdAt.toISOString(), lastSeenAt: iso(p.lastSeenAt), tosAcceptedAt: iso(p.tosAcceptedAt),
      trustScore: p.trustScore, trustTier: p.trustTier, falseReportStrikes: p.falseReportStrikes,
      enforcementState: p.enforcementState, enforcementUntil: iso(p.enforcementUntil),
      verificationStatus: p.verificationStatus, verificationTier: p.verificationTier, verificationMethod: p.verificationMethod,
      verifiedAt: iso(p.verifiedAt), documentExpiresAt: iso(p.documentExpiresAt), complianceFlag: p.complianceFlag,
    },
    seller: p.seller ? {
      id: p.seller.id, name: p.seller.name, verified: p.seller.verified, verifiedSeller: p.seller.verifiedSeller, officialPartner: p.seller.officialPartner,
      memberSince: p.seller.memberSince.toISOString(), legalName: p.seller.legalName, taxCode: p.seller.taxCode, verifiedUntil: iso(p.seller.verifiedUntil),
      listings: { total: p.seller._count.listings, active: activeListings },
      verificationCases: verificationCases.map((c) => ({ id: c.id, status: c.status, submittedAt: iso(c.submittedAt), reviewedAt: iso(c.reviewedAt), reviewedBy: c.reviewedBy })),
    } : null,
    identity: identity.map((v) => ({
      id: v.id, tier: v.tier, method: v.method, status: v.status, submittedAt: v.submittedAt.toISOString(), decidedAt: iso(v.decidedAt),
      decidedBy: v.decidedBy, rejectReason: v.rejectReason, documentExpiresAt: iso(v.documentExpiresAt), nationality: v.nationality,
    })),
    reports: { filed, against, openAgainst },
    enforcement: enforcement.map((e) => ({ ...e, createdAt: e.createdAt.toISOString(), expiresAt: iso(e.expiresAt), liftedAt: iso(e.liftedAt) })),
    audit: audit.map((a) => ({ occurredAt: a.occurredAt.toISOString(), actorType: a.actorType, actorId: a.actorId, action: a.action })),
  }
}

export type RevokeResult = { ok: true; status: string } | { ok: false; code: 'not_found' | 'nothing_to_revoke' | 'illegal_transition' }

/**
 * Revoke a person's identity verification — the admin/authority act the transition table reserves
 * for exactly this caller (`verified → revoked`, `expired → revoked`; there is no self-service way
 * back out). Every verified/expired row becomes `revoked` with the reason on the record; a PENDING
 * re-submission is rejected in the same act (otherwise approving it from the queue would restore
 * verified status without an admin decision); the profile status is recomputed from the rows
 * (never set by hand); and the audit row is written in the same transaction as the rows it
 * describes. A profile with nothing verified has nothing to revoke — `nothing_to_revoke`, and no
 * audit row is written for an act that did nothing.
 */
export async function revokeIdentity(input: { profileId: string; admin: string; reason: string; now?: Date }): Promise<RevokeResult> {
  const now = input.now ?? new Date()
  const reason = input.reason.trim().slice(0, 500)
  const profile = await db.profile.findUnique({ where: { id: input.profileId }, select: { id: true, verificationStatus: true } })
  if (!profile) return { ok: false, code: 'not_found' }
  if (!['verified', 'expired'].includes(profile.verificationStatus)) return { ok: false, code: 'nothing_to_revoke' }
  await db.$transaction(async (tx) => {
    await tx.identityVerification.updateMany({
      where: { profileId: profile.id, status: { in: ['verified', 'expired'] } },
      data: { status: 'revoked', decidedAt: now, decidedBy: input.admin, rejectReason: 'manual' },
    })
    await tx.identityVerification.updateMany({
      where: { profileId: profile.id, status: 'pending' },
      data: { status: 'rejected', decidedAt: now, decidedBy: input.admin, rejectReason: 'manual' },
    })
    await appendAudit(tx, {
      actorType: 'admin', actorId: input.admin, action: 'identity.revoked', subjectType: 'profile', subjectId: profile.id,
      detail: { reason, from: profile.verificationStatus },
    })
  })
  const r = await recomputeVerification(profile.id, now)
  if (r.illegalTransition) return { ok: false, code: 'illegal_transition' }
  return { ok: true, status: r.status }
}
