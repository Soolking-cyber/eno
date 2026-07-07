import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { disputeStage } from '@/lib/dispute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const firstImg = (images: string | null): string | null => {
  try { const a = JSON.parse(images || '[]'); return Array.isArray(a) && a[0] ? a[0] : null } catch { return null }
}

// My dispute cases — both sides: cases I filed and cases filed about me/my storefront.
// Open cases first, then by latest activity. Powers /disputes.
export async function GET() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

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

  return NextResponse.json({ cases })
}
