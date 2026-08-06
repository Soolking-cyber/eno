import { db } from '@/lib/db'
import { disputeStage } from '@/lib/dispute'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const firstImg = (images: string | null): string | null => {
  try { const a = JSON.parse(images || '[]'); return Array.isArray(a) && a[0] ? a[0] : null } catch { return null }
}

// My dispute cases — both sides: cases I filed and cases filed about me/my storefront.
// Open cases first, then by latest activity. Powers /disputes.
//
// ⚠️ WS6 MIGRATION — auth preamble only; there was nothing else to hoist (no rate limit, no body).
// `auth: 'userId'` because the old code called getCurrentProfileId() and only ever uses the id as a
// query predicate; `'profile'` would add an auth-server round trip + a Profile read to a list page.
// Guest → 401 `{"error":"auth_required"}`, unchanged. The `{cases}` 200 shape is unchanged: the
// handler returns a plain object and route() JSON-serialises it.
//
// ⚠️ ONE FAILURE-PATH WIRE CHANGE, DELIBERATE: neither Prisma call had a .catch(), so a DB error was
// an unhandled throw and Next answered its own default 500. route() now catches it, logs with an
// `op`, and answers `{"error":"internal_error"}` 500.
export const GET = route({ auth: 'userId' }, async ({ userId: meId }) => {
  const mySeller = await db.seller.findUnique({ where: { ownerId: meId }, select: { id: true } })
  const rows = await db.report.findMany({
    where: {
      OR: [
        { reporterProfileId: meId },
        { targetProfileId: meId },
        ...(mySeller ? [{ targetSellerId: mySeller.id }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, reason: true, status: true, createdAt: true,
      evidenceUntil: true, lastMessageAt: true, resolvedBy: true,
      reporterProfileId: true, targetProfileId: true, targetSellerId: true,
      listing: { select: { id: true, title: true, images: true } },
      _count: { select: { messages: true } },
    },
  })

  const cases = rows
    .map((r) => ({
      id: r.id,
      role: r.reporterProfileId === meId ? ('reporter' as const) : ('respondent' as const),
      reason: r.reason,
      status: r.status,
      stage: disputeStage(r),
      withdrawn: r.resolvedBy === 'withdrawn-by-reporter',
      createdAt: r.createdAt.toISOString(),
      evidenceUntil: r.evidenceUntil?.toISOString() ?? null,
      lastActivityAt: (r.lastMessageAt ?? r.createdAt).toISOString(),
      messageCount: r._count.messages,
      listing: r.listing ? { id: r.listing.id, title: r.listing.title, image: firstImg(r.listing.images) } : null,
    }))
    .sort((a, b) => {
      const ao = a.status === 'open' ? 0 : 1
      const bo = b.status === 'open' ? 0 : 1
      if (ao !== bo) return ao - bo
      return b.lastActivityAt.localeCompare(a.lastActivityAt)
    })

  return { cases }
})
