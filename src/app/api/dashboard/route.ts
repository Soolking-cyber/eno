import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdmin, getCurrentProfile } from '@/lib/admin'
import { computeTrustV2 } from '@/lib/trust'
import { FLAG_REASONS, getEnforcement } from '@/lib/enforcement'
import { dashboardStatsCore } from '@/lib/core/dashboard'
import { userHasVisaApplication } from '@/lib/visa/records'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Enforcement panel data (trust Phase 2) — powers the dashboard banner. Typed reads
// throughout: the Phase 2 columns/table are live on prod (add-enforcement.mjs ran).
async function enforcementPayload(profileId: string, sellerId: string | null) {
  const { state, until } = await getEnforcement(profileId)
  let action: {
    id: string; state: string; reason: string; notice: string | null
    createdAt: string; expiresAt: string | null; appealedAt: string | null; appealOutcome: string | null
  } | null = null
  if (state !== 'good_standing') {
    // Silent review flags EXCLUDED (Phase 3): the seller must never see them — a
    // flag row created after the real action would otherwise shadow it here and
    // leak the flag reason into the seller's banner.
    const a = await db.enforcementAction.findFirst({
      where: { profileId, status: 'active', reason: { notIn: [...FLAG_REASONS] } },
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
  }
  // Open reports the seller hasn't answered yet (buyer-king SLA: replying within
  // 72h keeps them off the admin "buyer waiting" queue).
  // Each card must tell the seller WHICH listing and WHAT the buyer said — a bare
  // "possible scam" left sellers replying "its not what product". Reporter identity
  // is never included (due process = the facts, not the filer).
  const rows = await db.report.findMany({
    where: {
      status: 'open',
      sellerRespondedAt: null,
      OR: [{ targetProfileId: profileId }, ...(sellerId ? [{ targetSellerId: sellerId }] : [])],
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
    select: {
      id: true, reason: true, detail: true, createdAt: true, evidenceUntil: true,
      listing: { select: { id: true, title: true, images: true } },
    },
  })
  const openReports = rows.map((r) => {
    let image: string | null = null
    try { image = (JSON.parse(r.listing?.images || '[]') as string[])[0] ?? null } catch { /* bad JSON */ }
    return {
      id: r.id, reason: r.reason, detail: r.detail, createdAt: r.createdAt.toISOString(),
      evidenceUntil: r.evidenceUntil?.toISOString() ?? null,
      listing: r.listing ? { id: r.listing.id, title: r.listing.title, image } : null,
    }
  })
  return { state, until: until?.toISOString() ?? null, action, openReports }
}

// The seller CRM dashboard payload (owner-scoped). Answers the three questions a
// seller opens the dashboard for: new messages? how are my listings doing? what
// needs action? auth → core → respond (the aggregation is the shared
// dashboardStatsCore, whose `stats` the future /api/v1/analytics/summary reuses).
//
// ⚠️ WS6 — NOT MIGRATED: THE 401 CARRIES A PAYLOAD KEY, NOT AN ERROR CODE. A guest gets
// `{"dashboard":null}` with status 401 — the status is right but the body is the route's ordinary
// envelope with a null payload, and the dashboard client reads `data.dashboard` rather than
// `data.error`. `auth: 'profile'` would replace it with `{"error":"auth_required"}` and the page
// would render its loaded state against `undefined`. Everything else here is a single authed read
// path with no rate limit and no body, so the wrapper has nothing left to contribute.
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
      // Role flag for the nav rail's admin group. Server-computed against ADMIN_EMAILS;
      // profile.email is the auth session email (ensureProfile mirrors it), so this
      // matches getAdmin()'s verdict without a second auth round-trip. Display-only:
      // every /admin page + API still enforces getAdmin() server-side.
      // Session email, not Profile.email — an email change resyncs the JWT immediately
      // but existing Profile rows are not re-synced, and the rail must agree with the
      // server's own getAdmin() verdict.
      isAdmin: !!(await getAdmin()),
      // Gates the "My e-Visa" rail row to people who have actually applied (chat-only flow).
      hasVisa: await userHasVisaApplication(profile.id),
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
