import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import {
  ENFORCEMENT_REASON,
  ENFORCEMENT_STATES,
  applyEnforcement,
  liftAction,
  upholdAppeal,
  type EnforcementState,
} from '@/lib/enforcement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000
const SLA_HOURS = 72 // buyer-king: a report the seller hasn't answered in 72h jumps the queue

// Admin enforcement console. Every request re-checks the session server-side via
// getAdmin() — never trust a client-side gate. Pre-migration (table/columns absent)
// the GET degrades to an empty queue with migrationPending:true instead of a 500.

type QueueAction = {
  id: string
  profileId: string
  state: string
  reason: string
  adminNote: string | null
  triggerReportId: string | null
  decidedBy: string
  status: string
  expiresAt: string | null
  pulledCount: number
  appealText: string | null
  appealedAt: string | null
  appealOutcome: string | null
  createdAt: string
  profile: { displayName: string | null; email: string | null; trustScore: number; trustTier: string } | null
}

export async function GET() {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Buyer-waiting reports (>72h, unanswered) — raw + guarded (sellerRespondedAt is a
  // Phase 2 column). Sorted OLDEST first: the longest-waiting buyer is served first.
  let buyerWaiting: Array<Record<string, unknown>> = []
  try {
    const rows = await db.$queryRaw<Array<{
      id: string; reason: string; detail: string | null; createdAt: Date
      listingId: string | null; conversationId: string | null
      reporterProfileId: string | null; targetProfileId: string | null; targetSellerId: string | null
    }>>`
      SELECT "id", "reason", "detail", "createdAt", "listingId", "conversationId",
             "reporterProfileId", "targetProfileId", "targetSellerId"
      FROM "Report"
      WHERE "status" = 'open' AND "sellerRespondedAt" IS NULL AND "createdAt" < now() - interval '72 hours'
      ORDER BY "createdAt" ASC
      LIMIT 100`
    buyerWaiting = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      waitingHours: Math.floor((Date.now() - r.createdAt.getTime()) / 3_600_000),
    }))
  } catch { /* migration pending */ }

  try {
    const [actions, appeals] = await Promise.all([
      db.enforcementAction.findMany({
        where: { status: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      // Pending appeals (submitted, unresolved) — including on already-lifted actions
      // (an appeal answered by events still deserves a human close-out).
      db.enforcementAction.findMany({
        where: { appealedAt: { not: null }, appealResolvedAt: null },
        orderBy: { appealedAt: 'asc' },
        take: 100,
      }),
    ])

    // One batched profile lookup for display (name/email/trust) — no N+1.
    const profileIds = [...new Set([...actions, ...appeals].map((a) => a.profileId))]
    const profiles = profileIds.length
      ? await db.profile.findMany({
          where: { id: { in: profileIds } },
          select: { id: true, displayName: true, email: true, trustScore: true, trustTier: true },
        })
      : []
    const profileById = new Map(profiles.map((p) => [p.id, p]))

    const serialize = (a: (typeof actions)[number]): QueueAction => {
      const p = profileById.get(a.profileId)
      let pulledCount = 0
      try { pulledCount = a.pulledListingIds ? (JSON.parse(a.pulledListingIds) as unknown[]).length : 0 } catch { pulledCount = 0 }
      return {
        id: a.id,
        profileId: a.profileId,
        state: a.state,
        reason: a.reason,
        adminNote: a.adminNote,
        triggerReportId: a.triggerReportId,
        decidedBy: a.decidedBy,
        status: a.status,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        pulledCount,
        appealText: a.appealText,
        appealedAt: a.appealedAt?.toISOString() ?? null,
        appealOutcome: a.appealOutcome,
        createdAt: a.createdAt.toISOString(),
        profile: p ? { displayName: p.displayName, email: p.email, trustScore: p.trustScore, trustTier: p.trustTier } : null,
      }
    }

    return NextResponse.json({
      actions: actions.map(serialize),
      appeals: appeals.map(serialize),
      buyerWaiting,
    })
  } catch {
    // Table not there yet — degrade to an empty queue the UI can label.
    return NextResponse.json({ actions: [], appeals: [], buyerWaiting, migrationPending: true })
  }
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { action?: string; id?: string; profileId?: string; state?: string; reason?: string; note?: string; days?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const action = String(body.action || '')
  const id = String(body.id || '').trim()

  switch (action) {
    case 'lift': {
      // Manual relief: restores pulled listings, resets to good_standing, resolves a
      // pending appeal in the seller's favour, notifies.
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const ok = await liftAction(id, { to: 'lifted', by: admin })
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not_active' }, { status: 409 })
    }

    case 'overturn': {
      // The action was WRONG (not just no-longer-needed) — same effects as lift, but
      // the record says overturned (feeds fairness accounting).
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const ok = await liftAction(id, { to: 'overturned', by: admin })
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not_active' }, { status: 409 })
    }

    case 'uphold_appeal': {
      // The appeal was reviewed and the decision stands (action stays active).
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const ok = await upholdAppeal(id)
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'no_pending_appeal' }, { status: 409 })
    }

    case 'set-state': {
      // Manual state set (e.g. suspend a ban-evader, or hand-hold a case). An
      // admin-decided action is precedence-protected: the system won't downgrade it.
      const profileId = String(body.profileId || '').trim()
      const state = String(body.state || '') as EnforcementState
      if (!profileId || !(ENFORCEMENT_STATES as readonly string[]).includes(state)) {
        return NextResponse.json({ error: 'bad_request' }, { status: 400 })
      }
      const profile = await db.profile.findUnique({ where: { id: profileId }, select: { id: true } })
      if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const days = Number(body.days)
      const applied = await applyEnforcement(
        profileId,
        {
          state,
          reason: String(body.reason || '').trim() || ENFORCEMENT_REASON.ADMIN_MANUAL,
          expiresAt: Number.isFinite(days) && days > 0 ? Date.now() + days * DAY_MS : null,
        },
        { decidedBy: admin, adminNote: String(body.note || '').trim().slice(0, 1000) || null },
      )
      // false = no-op (already in that state) OR migration pending — both non-fatal.
      return NextResponse.json({ ok: true, applied })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
