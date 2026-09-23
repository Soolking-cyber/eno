import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
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
import { ENFORCEMENT_SEVERITY } from '@/lib/enforcement-machine'
import { overturnScamHold, profileHasScamHold, releaseScamHold, scamChargesForAction, type ScamHoldOutcome, type ScamHoldRefusal } from '@/lib/scam-hold'

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

// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY, ON BOTH METHODS.
// `auth: 'admin'` is the only mode that reproduces this route's guest/non-admin answer: route()
// emits `{"error":"Forbidden"}` 403 with the capital F, byte-identical to the two hand-written
// `getAdmin()` blocks it replaces. `'profile'` would 401 a guest and `'userId'` would let any
// signed-in user in, so neither is admissible here.
//
// ⚠️ NO `rateLimit:` AND NO `body:` — NEITHER EXISTED. There was never a limiter on the console,
// and adding one is a behaviour change, not a migration. The POST body stays hand-parsed because
// malformed JSON answers `{"error":"Invalid body"}` — a free-text message, NOT an ApiErrorCode, so
// it cannot be expressed as `invalidBodyCode`, and tidying it to `invalid_body` would be exactly the
// silent wire change this migration forbids. `Missing id` 400, `Not found` 404 and `Unknown action`
// 400 are free-text for the same reason and stay verbatim as `NextResponse.json` returns.
//
// ⚠️ `'admin'` RESOLVES NO PROFILE. An earlier draft of this header said it follows getAdmin()
// with getCurrentProfile() and called the extra Profile read an accepted cost. It did, and the
// cost turned out not to be acceptable anywhere: no admin handler reads ctx.profile or
// ctx.userId, the call made read-only admin GETs perform a presence-heartbeat WRITE, and on a
// first-ever call it runs ensureProfile()'s irreversible guest-Seller auto-claim. It was removed
// from the wrapper in this same commit; getAdmin() is Supabase-auth only and touches no DB.
//
// GET branches held: guest / non-admin → 403 `{"error":"Forbidden"}` · queue load failure (the
// inner try/catch, still here verbatim) → 500 `{"error":"queue_failed"}` · pre-migration `preScreen`
// column → its own try, empty set, 200 · success → 200 {actions,flags,appeals,buyerWaiting}.
//
// POST branches held: guest / non-admin → 403 `{"error":"Forbidden"}` · malformed JSON → 400
// `{"error":"Invalid body"}` · lift/overturn/uphold_appeal/dismiss_flag with no id → 400
// `{"error":"Missing id"}` · lift/overturn on a non-active action → 409 `{"error":"not_active"}` ·
// uphold_appeal with nothing pending → 409 `{"error":"no_pending_appeal"}` · dismiss_flag on a
// non-flag → 409 `{"error":"not_a_flag"}` · set-state with a bad profileId/state → 400
// `{"error":"bad_request"}` · unknown profile → 404 `{"error":"Not found"}` · unrecognised action →
// 400 `{"error":"Unknown action"}` · success → 200 `{"ok":true}` (set-state: `{ok,applied}`).
//
// ⛔ SCAM HOLDS (2026-09-23). A scam hold is DERIVED from the trust ledger, and the daily sync
// re-applies what it derives — so moving only the enforcement row (a lift, an overturn, a hand-set
// state below `held`) was undone within a day, after the seller had been told everything was
// restored. Now: `lift` and a downgrading `set-state` answer 409 `{"error":"scam_hold_use_release"}`
// while the account derives a scam hold; `overturn` on a scam_hold row reverses the report(s) in the
// ledger (src/lib/scam-hold.ts); `overturn_scam` does the same from any row of a scam-held account;
// `release_scam_hold` is the release (14 days · no open report · verified identity · a written plan).
// Their refusals carry their own codes and statuses (ScamHoldRefusal) — the console maps each to a
// sentence. An overturn reverses ONLY the reports named in `reportIds` (or the single standing charge
// when none is named; otherwise 409 `choose_reports` with the list): `GET ?charges=<actionId>` returns
// that list for the console's overturn dialog — 200 `{charges}` · 409 `{"error":"not_active"}`.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL, ON EACH METHOD. GET's first query (the SLA candidates
// findMany) sits OUTSIDE the try/catch, and POST has no try/catch at all around liftAction /
// dismissFlag / applyEnforcement — so a DB rejection in either used to reach Next's default 500
// HTML. route() now catches it, logs with an `op`, and returns `{"error":"internal_error"}` 500.
// That is the accepted improvement, and it IS a wire change on those failure paths.
export const GET = route({ auth: 'admin' }, async ({ req }) => {
  // The overturn dialog's read: the standing scam charges behind one action's account, so the admin
  // sees — and chooses — exactly which reports an overturn reverses.
  const chargesFor = new URL(req.url).searchParams.get('charges')?.trim()
  if (chargesFor) {
    const charges = await scamChargesForAction(chargesFor)
    return charges ? NextResponse.json({ charges }) : NextResponse.json({ error: 'not_active' }, { status: 409 })
  }

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
})

/** An overturn's selection bound — far above any real account's standing charges; a body past it is refused. */
const OVERTURN_MAX_REPORTS = 100

export const POST = route({ auth: 'admin' }, async ({ req, admin }) => {
  let body: { action?: string; id?: string; profileId?: string; state?: string; reason?: string; note?: string; days?: number; flagId?: string; plan?: string; reportIds?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const action = String(body.action || '')
  const id = String(body.id || '').trim()
  // The reports an overturn reverses — the admin's selection in the dialog. Absent → the core decides
  // (the one standing charge, or `choose_reports`).
  // ⚠️ REFUSED OVER THE BOUND, NEVER TRUNCATED (review, 2026-09-24): this was `.slice(0, 20)`, so an
  // admin who ticked 25 charges had 20 overturned and was not told — a partial selection, which the
  // overturn itself refuses to apply ("never applied to a partial selection", scam-hold.ts).
  // …and for the same reason a malformed element refuses the whole selection rather than being dropped
  // from it (`['r1', 7]` used to overturn r1 alone and answer ok).
  if (body.reportIds !== undefined && (!Array.isArray(body.reportIds) || body.reportIds.some((x) => typeof x !== 'string'))) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const reportIds = body.reportIds as string[] | undefined
  if (reportIds && reportIds.length > OVERTURN_MAX_REPORTS) return NextResponse.json({ error: 'too_many_rows', max: OVERTURN_MAX_REPORTS }, { status: 400 })

  // A scam-hold outcome on the wire: `{ok, state, charges, remaining?}` (+ held). A REFUSAL is written
  // at each call site as `{ error: r.error, ...scamFields(r) }` with the refusal's own status —
  // spelled out there, next to the call, because src/lib/api/errors.test.ts proves these codes are on
  // the wire by finding `r = await <fn> … error: r.error` in this file (RE_EMITTED_UNIONS).
  const scamOk = (r: ScamHoldOutcome, held: number) => NextResponse.json(held ? { ...r, held } : r)
  const scamFields = (r: ScamHoldRefusal) => {
    const { ok: _ok, status: _status, error: _error, ...rest } = r
    return rest
  }
  const USE_RELEASE = () => NextResponse.json({ error: 'scam_hold_use_release' }, { status: 409 })

  switch (action) {
    case 'lift': {
      // Manual relief: restores pulled listings, resets to good_standing, resolves a
      // pending appeal in the seller's favour, notifies.
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      // A scam hold is not lifted, it is RELEASED (or its report overturned) — a lift would be undone
      // by the next sync. Checked on the PROFILE, not the row: an admin suspension on top of a scam
      // hold would drop straight back into it too.
      const target = await db.enforcementAction.findUnique({ where: { id }, select: { profileId: true } })
      if (target && (await profileHasScamHold(target.profileId))) return USE_RELEASE()
      // `held` = pulled listings the seller identity gate parked instead of restoring (gate on only;
      // present in the body only when non-zero, so the gate-off response is unchanged).
      let held = 0
      const ok = await liftAction(id, { to: 'lifted', by: admin, onHeld: (n) => { held = n } })
      return ok ? NextResponse.json(held ? { ok: true, held } : { ok: true }) : NextResponse.json({ error: 'not_active' }, { status: 409 })
    }

    case 'overturn': {
      // The action was WRONG (not just no-longer-needed) — same effects as lift, but
      // the record says overturned (feeds fairness accounting).
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      const target = await db.enforcementAction.findUnique({ where: { id }, select: { profileId: true, reason: true, status: true } })
      if (target?.status === 'active' && target.reason === ENFORCEMENT_REASON.SCAM_HOLD) {
        // A wrong SCAM hold is a wrong scam REPORT: overturn it in the ledger, or the sync re-holds.
        let held = 0
        const r = await overturnScamHold({ actionId: id, admin, reportIds, onHeld: (n) => { held = n } })
        if (!r.ok) return NextResponse.json({ error: r.error, ...scamFields(r) }, { status: r.status })
        return scamOk(r, held)
      }
      if (target && (await profileHasScamHold(target.profileId))) return USE_RELEASE()
      let held = 0
      const ok = await liftAction(id, { to: 'overturned', by: admin, onHeld: (n) => { held = n } })
      return ok ? NextResponse.json(held ? { ok: true, held } : { ok: true }) : NextResponse.json({ error: 'not_active' }, { status: 409 })
    }

    case 'overturn_scam': {
      // Overturn the chosen scam report(s) behind a hold from ANY active row of the account (an admin
      // suspension on top of a scam hold has no scam_hold row to click). A non-scam row is left alone.
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      let held = 0
      const r = await overturnScamHold({ actionId: id, admin, reportIds, onHeld: (n) => { held = n } })
      if (!r.ok) return NextResponse.json({ error: r.error, ...scamFields(r) }, { status: r.status })
      return scamOk(r, held)
    }

    case 'release_scam_hold': {
      // The release: refuses unless ≥14 days since confirmation, no open report against the account,
      // a live verified identity not shared with another held/suspended account, and a written plan
      // (stored on the audit record).
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      let held = 0
      const r = await releaseScamHold({ actionId: id, admin, plan: String(body.plan ?? ''), onHeld: (n) => { held = n } })
      if (!r.ok) return NextResponse.json({ error: r.error, ...scamFields(r) }, { status: r.status })
      return scamOk(r, held)
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
      // Hand-setting a scam-held account BELOW held is a lift by another name — refused the same way.
      if (ENFORCEMENT_SEVERITY[state] < ENFORCEMENT_SEVERITY.held && (await profileHasScamHold(profileId))) return USE_RELEASE()
      const days = Number(body.days)
      let held = 0
      const applied = await applyEnforcement(
        profileId,
        {
          state,
          reason: String(body.reason || '').trim() || ENFORCEMENT_REASON.ADMIN_MANUAL,
          expiresAt: Number.isFinite(days) && days > 0 ? Date.now() + days * DAY_MS : null,
        },
        { decidedBy: admin, adminNote: String(body.note || '').trim().slice(0, 1000) || null, onHeld: (n) => { held = n } },
      )
      // Acting FROM a review flag answers it — close the flag in the same request so
      // the console never shows a stale "needs review" for a case already decided.
      const flagId = String(body.flagId || '').trim()
      if (flagId) await dismissFlag(flagId)
      // false = no-op (already in that state) — non-fatal.
      return NextResponse.json(held ? { ok: true, applied, held } : { ok: true, applied })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
})
