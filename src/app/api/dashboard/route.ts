import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { computeTrustV2 } from '@/lib/trust'
import { getEnforcement } from '@/lib/enforcement'
import { dashboardStatsCore } from '@/lib/core/dashboard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Enforcement panel data (trust Phase 2) — powers the dashboard banner. Every read
// is DEPLOY-ORDER-SAFE: the columns/table land with scripts/add-enforcement.mjs, so
// pre-migration this degrades to good_standing + empty lists (no banner renders).
async function enforcementPayload(profileId: string, sellerId: string | null) {
  const { state, until } = await getEnforcement(profileId) // guarded raw read inside
  let action: {
    id: string; state: string; reason: string; notice: string | null
    createdAt: string; expiresAt: string | null; appealedAt: string | null; appealOutcome: string | null
  } | null = null
  if (state !== 'good_standing') {
    try {
      const a = await db.enforcementAction.findFirst({
        where: { profileId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, state: true, reason: true, adminNote: true, createdAt: true, expiresAt: true, appealedAt: true, appealOutcome: true },
      })
      if (a) {
        action = {
          id: a.id, state: a.state, reason: a.reason, notice: a.adminNote,
          createdAt: a.createdAt.toISOString(), expiresAt: a.expiresAt?.toISOString() ?? null,
          appealedAt: a.appealedAt?.toISOString() ?? null, appealOutcome: a.appealOutcome,
        }
      }
    } catch { /* migration pending — banner shows reason copy without action detail */ }
  }
  // Open reports the seller hasn't answered yet (buyer-king SLA: replying within
  // 72h keeps them off the admin "buyer waiting" queue). Raw + guarded —
  // sellerRespondedAt is a Phase 2 column.
  // Each card must tell the seller WHICH listing and WHAT the buyer said — a bare
  // "possible scam" left sellers replying "its not what product". Reporter identity
  // is never included (due process = the facts, not the filer).
  let openReports: { id: string; reason: string; detail: string | null; createdAt: string; listing: { id: string; title: string; image: string | null } | null }[] = []
  try {
    const rows = await db.$queryRaw<{ id: string; reason: string; detail: string | null; createdAt: Date; listing_id: string | null; listing_title: string | null; listing_images: string | null }[]>`
      SELECT r."id", r."reason", r."detail", r."createdAt",
             l."id" AS listing_id, l."title" AS listing_title, l."images" AS listing_images
      FROM "Report" r
      LEFT JOIN "Listing" l ON l."id" = r."listingId"
      WHERE r."status" = 'open' AND r."sellerRespondedAt" IS NULL
        AND (r."targetProfileId" = ${profileId}::uuid OR r."targetSellerId" = ${sellerId})
      ORDER BY r."createdAt" ASC
      LIMIT 5`
    openReports = rows.map((r) => {
      let image: string | null = null
      try { image = (JSON.parse(r.listing_images || '[]') as string[])[0] ?? null } catch { /* bad JSON */ }
      return {
        id: r.id, reason: r.reason, detail: r.detail, createdAt: r.createdAt.toISOString(),
        listing: r.listing_id && r.listing_title ? { id: r.listing_id, title: r.listing_title, image } : null,
      }
    })
  } catch { /* migration pending */ }
  return { state, until: until?.toISOString() ?? null, action, openReports }
}

// The seller CRM dashboard payload (owner-scoped). Answers the three questions a
// seller opens the dashboard for: new messages? how are my listings doing? what
// needs action? auth → core → respond (the aggregation is the shared
// dashboardStatsCore, whose `stats` the future /api/v1/analytics/summary reuses).
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ dashboard: null }, { status: 401 })
  // trustProgress: the REAL v2 tier-gate inputs (src/lib/trust-math.ts tierFor) the
  // client can't derive itself — powers the "Your path to {next tier}" panel.
  // computeTrustV2 is a bounded set of owner-scoped indexed queries.
  const [dashboard, breakdown] = await Promise.all([
    dashboardStatsCore(profile),
    computeTrustV2(profile.id).catch(() => null),
  ])
  // Sequential (needs the core's seller id) but cheap: 2–3 indexed PK reads on an
  // authed, owner-scoped route — never a public hot path.
  const enforcement = await enforcementPayload(profile.id, dashboard.seller?.id ?? null)
  const i = breakdown?.inputs
  // Days since the most recent DEMOTION-RELEVANT confirmed report (the dual-threshold
  // windows the tier gates actually read) — null when the recent record is clean.
  const cleanBlocked = !!i && (i.reports90.count > 0 || i.reports180.count > 0)
  return NextResponse.json({
    dashboard: {
      ...dashboard,
      enforcement,
      trustProgress: i
        ? {
            transactions365: i.transactions365,
            distinctBuyerReviews: i.distinctBuyerReviews,
            responseWilson: i.responseWilson,
            accountAgeDays: Math.floor(i.accountAgeDays),
            phoneVerified: i.phoneVerified,
            hasRecentConfirmedReport: cleanBlocked,
            hasScamHold: i.hasScamHold,
          }
        : null,
    },
  })
}
