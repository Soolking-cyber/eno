import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import {
  ENFORCEMENT_REASON,
  ENFORCEMENT_STATES,
  FLAG_REASONS,
  applyEnforcement,
  dismissFlag,
  liftAction,
  upholdAppeal,
  type EnforcementState,
} from '@/lib/enforcement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000
const SLA_HOURS = 72 // buyer-king: a report the seller hasn't answered in 72h jumps the queue

// Admin enforcement console. Every request re-checks the session server-side via
// getAdmin() — never trust a client-side gate. The Phase 2 columns/table are live;
// only the Phase 3 preScreen read is still deploy-order-guarded.

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

  // Buyer-waiting reports (>72h, unanswered), OLDEST first: the longest-waiting
  // buyer is served first. Phase 3: pre-screened reports (repeat-false reporters)
  // are EXCLUDED — they must not jump the queue on the SLA clock.
  const candidates = await db.report.findMany({
    where: {
      status: 'open',
      sellerRespondedAt: null,
      createdAt: { lt: new Date(Date.now() - SLA_HOURS * 3_600_000) },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: {
      id: true, reason: true, detail: true, createdAt: true, listingId: true,
      conversationId: true, reporterProfileId: true, targetProfileId: true, targetSellerId: true,
    },
  })
  // preScreen is @ignore'd until scripts/add-ban-evasion.mjs runs → guarded raw
  // lookup of the screened ids; pre-migration nothing is screened (empty set).
  let preScreened = new Set<string>()
  if (candidates.length) {
    try {
      const rows = await db.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "Report" WHERE "id" IN (${Prisma.join(candidates.map((r) => r.id))}) AND "preScreen" = true`,
      )
      preScreened = new Set(rows.map((r) => r.id))
    } catch { /* migration pending */ }
  }
  const buyerWaiting = candidates
    .filter((r) => !preScreened.has(r.id))
    .map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      waitingHours: Math.floor((Date.now() - r.createdAt.getTime()) / 3_600_000),
    }))

  try {
    const [actions, flags, appeals] = await Promise.all([
      db.enforcementAction.findMany({
        where: { status: 'active', reason: { notIn: [...FLAG_REASONS] } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      // Phase 3 silent review flags (velocity spikes, ban-evasion email matches) —
      // their own group: annotations to dismiss or act on, not ladder actions.
      db.enforcementAction.findMany({
        where: { status: 'active', reason: { in: [...FLAG_REASONS] } },
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
    const profileIds = [...new Set([...actions, ...flags, ...appeals].map((a) => a.profileId))]
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
      flags: flags.map(serialize),
      appeals: appeals.map(serialize),
      buyerWaiting,
    })
  } catch (e) {
    // Phase 2 tables are live, so a failure here is a real error — surface it to the
    // client's retry path instead of a misleading "migration pending" empty queue.
    console.error('[admin/enforcement] queue load failed', e)
    return NextResponse.json({ error: 'queue_failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { action?: string; id?: string; profileId?: string; state?: string; reason?: string; note?: string; days?: number; flagId?: string }
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

    case 'dismiss_flag': {
      // Close a silent review flag (velocity / ban-evasion email) — the flag row
      // lifts and NOTHING else moves: deliberately not liftAction, which would reset
      // the profile to good_standing (dismissing a flag must never un-suspend).
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const ok = await dismissFlag(id)
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not_a_flag' }, { status: 409 })
    }

    case 'set-state': {
      // Manual state set (e.g. suspend a ban-evader, or hand-hold a case). An
      // admin-decided action is precedence-protected: the system won't downgrade it.
      // Suspension also records the account's identity anchors (BannedIdentity) —
      // and lift/overturn clears them — inside applyEnforcement/liftAction.
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
      // Acting FROM a review flag answers it — close the flag in the same request so
      // the console never shows a stale "needs review" for a case already decided.
      const flagId = String(body.flagId || '').trim()
      if (flagId) await dismissFlag(flagId)
      // false = no-op (already in that state) — non-fatal.
      return NextResponse.json({ ok: true, applied })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
