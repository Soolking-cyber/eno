import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { applyTrustEvent, penalizeSeller, recomputeTrust, SEVERITY_PENALTY, FALSE_REPORT_PENALTY, REPORT_COOLDOWN_DAYS } from '@/lib/trust'
import { syncEnforcement } from '@/lib/enforcement'
import { APPEAL_NOTICE, pickLocale } from '@/lib/admin-macros'
import { DISPUTE_BODY_MAX, DISPUTE_WINDOW_MS, addDisputeMessage, notifyDispute, respondentProfileId } from '@/lib/dispute'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000

// Notify the reported party (if they have an account) that their content was actioned.
// Deep-links into the dispute room, where the decision + appeal path live. In their
// language (Profile.locale, EN/VI). Best-effort.
async function notifyActioned(targetProfileId: string, reportId: string) {
  const p = await db.profile.findUnique({ where: { id: targetProfileId }, select: { locale: true } })
  const l = pickLocale(p?.locale)
  await db.notification.create({
    data: { recipientId: targetProfileId, type: 'dispute', title: APPEAL_NOTICE.title[l], body: APPEAL_NOTICE.body[l], actorName: 'eno.vn moderation', url: `/disputes/${reportId}` },
  }).catch((e) => logError(e, { op: 'moderate.appealNotice' }))
}

// Tell each reporter their case closed with no violation — but ONLY for rows the
// caller actually transitioned this instant (matched by the unique resolve stamp),
// so a bulk/target dismiss can't double-notify on a concurrent resolve or replay.
async function notifyDismissedReporters(match: { resolvedBy: string; resolvedAt: Date } & Record<string, unknown>) {
  const rows = await db.report.findMany({
    where: { ...match, status: 'dismissed' },
    select: { id: true, reporterProfileId: true },
  })
  for (const r of rows) {
    if (r.reporterProfileId) await notifyDispute(r.reporterProfileId, r.id, 'decided_dismissed_reporter')
  }
}

// Single admin endpoint for the moderation queue. Every action re-checks the
// session server-side via getAdmin() — never trust a client-side gate.
//
// With manual verification removed, listings publish instantly; admin's job is
// (1) clearing the rare held listing (restricted/low-trust accounts) and
// (2) RESOLVING reports — which is what moves trust scores.
export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { action?: string; id?: string; severity?: string; ids?: string[]; note?: string; decisionNote?: string; message?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  // Optional outcome note on resolutions — shown to BOTH parties in the dispute room
  // (unlike internalNote, which stays staff-only).
  const decisionNote = String(body.decisionNote ?? '').trim().slice(0, DISPUTE_BODY_MAX) || null

  const action = String(body.action || '')
  const id = String(body.id || '').trim()
  const isBulk = action === 'bulk-dismiss' || action === 'bulk-confirm'
  if (!id && !isBulk) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const normSeverity = (v: unknown): 'minor' | 'moderate' | 'severe' =>
    (['minor', 'moderate', 'severe'].includes(String(v)) ? String(v) : 'moderate') as 'minor' | 'moderate' | 'severe'

  switch (action) {
    case 'set-note': {
      // Staff-only note on the case — never shown to users.
      await db.report.update({ where: { id }, data: { internalNote: String(body.note ?? '').slice(0, 2000) || null } }).catch((e) => logError(e, { op: 'moderate.internalNote' }))
      return NextResponse.json({ ok: true })
    }

    case 'append-note': {
      // ATOMIC append (audit P2): the AI panel used to read the note from a PROP and
      // send the full concatenation — a stale read-modify-write that dropped whatever a
      // NoteEditor save, a second admin, or an earlier AI save wrote in between. One
      // SQL statement appends server-side; the 2000-char cap is enforced in the SET.
      const line = String(body.note ?? '').slice(0, 500)
      if (line) {
        await db.$executeRaw`UPDATE "Report" SET "internalNote" = left(coalesce("internalNote" || E'\n', '') || ${line}, 2000) WHERE id = ${id}`.catch((e) => logError(e, { op: 'moderate.appendInternalNote' }))
      }
      return NextResponse.json({ ok: true })
    }

    case 'dismiss-target': {
      // Clear a pile-on: dismiss EVERY open report sharing this report's target identity.
      const report = await db.report.findUnique({ where: { id }, select: { targetProfileId: true, targetSellerId: true, listingId: true } })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const where = report.targetProfileId ? { targetProfileId: report.targetProfileId }
        : report.targetSellerId ? { targetSellerId: report.targetSellerId }
        : report.listingId ? { listingId: report.listingId } : { id }
      const stamp = new Date()
      const upd = await db.report.updateMany({ where: { ...where, status: 'open' }, data: { status: 'dismissed', resolvedBy: admin, resolvedAt: stamp } })
      // Notify from the rows THIS call actually transitioned (matched by our exact
      // resolve stamp), not a pre-read snapshot — so a concurrent resolve / double
      // click can't double-fire or send a "no violation" note on a case another admin
      // just confirmed.
      await notifyDismissedReporters({ ...where, resolvedBy: admin, resolvedAt: stamp })
      return NextResponse.json({ ok: true, dismissed: upd.count })
    }

    case 'bulk-dismiss': {
      const ids = (body.ids || []).map((x) => String(x)).slice(0, 200)
      if (!ids.length) return NextResponse.json({ error: 'No ids' }, { status: 400 })
      const stamp = new Date()
      const upd = await db.report.updateMany({ where: { id: { in: ids }, status: 'open' }, data: { status: 'dismissed', resolvedBy: admin, resolvedAt: stamp } })
      await notifyDismissedReporters({ id: { in: ids }, resolvedBy: admin, resolvedAt: stamp })
      return NextResponse.json({ ok: true, dismissed: upd.count })
    }

    case 'bulk-confirm': {
      const ids = (body.ids || []).map((x) => String(x)).slice(0, 100)
      if (!ids.length) return NextResponse.json({ error: 'No ids' }, { status: 400 })
      const severity = normSeverity(body.severity)
      const penalty = -SEVERITY_PENALTY[severity]
      // ONE read for the whole batch (was a sequential per-id findUnique). The per-id
      // updateMany below stays: its open→confirmed guard is the idempotency gate that
      // keeps a retry / concurrent resolve from double-docking trust.
      const reports = await db.report.findMany({
        where: { id: { in: ids } },
        select: { id: true, targetProfileId: true, targetSellerId: true, listingId: true, reporterProfileId: true },
      })
      let confirmed = 0
      // Listing ids whose takedown write failed — the report is docked but the listing is STILL PUBLIC.
      const takedownFailures: string[] = []
      for (const report of reports) {
        const rid = report.id
        const upd = await db.report.updateMany({ where: { id: rid, status: 'open' }, data: { status: 'confirmed', severity, resolvedBy: admin, resolvedAt: new Date() } })
        if (upd.count === 0) continue // already resolved — no double-dock
        if (report.targetProfileId) {
          const res = await applyTrustEvent(report.targetProfileId, 'report_confirmed', penalty, { reason: `report:${rid}`, reportId: rid })
          // Enforcement ladder: re-derive now that the confirmation landed (fail-quiet inside).
          if (res) await syncEnforcement(report.targetProfileId, res.breakdown, { persistedScore: res.score, triggerReportId: rid })
        } else if (report.targetSellerId) await penalizeSeller(report.targetSellerId, penalty, { reason: `report:${rid}`, reportId: rid })
        // ⚠️ A FAILED TAKEDOWN MUST NOT BE COUNTED AS A CONFIRMATION. This used to swallow the
        // error and fall through to `confirmed++` and a 200, so staff were told a listing had been
        // pulled while it was still public and still selling. Logging it (WS4) made the failure
        // visible in Cloud Logging but changed nothing the operator sees.
        if (report.listingId) {
          try {
            await db.listing.update({ where: { id: report.listingId }, data: { verified: false } })
            revalidatePath(`/listings/${report.listingId}`)
          } catch (e) {
            logError(e, { op: 'moderate.unverifyListing', reportId: rid, listingId: report.listingId })
            // Do NOT throw: the trust dock above already landed for THIS report, and aborting the
            // loop would strand the remaining reports half-applied with no way for the client to
            // tell which. Record it and report the count instead.
            takedownFailures.push(report.listingId)
          }
        }
        if (report.targetProfileId) await notifyActioned(report.targetProfileId, rid)
        if (report.reporterProfileId) await notifyDispute(report.reporterProfileId, rid, 'decided_upheld_reporter')
        confirmed++
      }
      // Counts back to the client: `skipped` = ids that were missing or already
      // resolved (idempotency skips) — surfaced in the admin toast.
      // ⚠️ NON-2xx WHEN ANY TAKEDOWN FAILED. The trust docks DID land, so this is a partial
      // success and the body says exactly which listings are still public — the operator has to
      // pull those by hand. moderation-client.tsx throws on !res.ok, so this surfaces without a
      // client change; the point is that "some listings are still up" can never read as success.
      if (takedownFailures.length) {
        return NextResponse.json(
          { error: 'takedown_failed', confirmed, skipped: ids.length - confirmed, stillPublic: takedownFailures },
          { status: 500 },
        )
      }
      return NextResponse.json({ ok: true, confirmed, skipped: ids.length - confirmed })
    }

    case 'approve': {
      // Publish a held listing and dismiss any open reports against it.
      const listing = await db.listing.findUnique({ where: { id }, select: { id: true } })
      if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await db.$transaction([
        db.listing.update({ where: { id }, data: { verified: true } }),
        db.report.updateMany({
          where: { listingId: id, status: 'open' },
          data: { status: 'dismissed', resolvedBy: admin, resolvedAt: new Date() },
        }),
      ])
      revalidatePath(`/listings/${id}`)
      return NextResponse.json({ ok: true })
    }

    case 'reject': {
      // Remove the listing entirely (cascade deletes its reports).
      const listing = await db.listing.findUnique({ where: { id }, select: { id: true } })
      if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await db.listing.delete({ where: { id } })
      revalidatePath(`/listings/${id}`)
      return NextResponse.json({ ok: true })
    }

    case 'unpublish': {
      await db.listing.update({ where: { id }, data: { verified: false } })
      revalidatePath(`/listings/${id}`)
      return NextResponse.json({ ok: true })
    }

    case 'confirm-report': {
      // Confirm → dock the TARGET's trust by the severity weight and pull the
      // offending listing. Works for owned accounts (audited via event log) AND
      // guest sellers (Seller mirror docked directly via penalizeSeller).
      const report = await db.report.findUnique({
        where: { id },
        select: { id: true, status: true, targetProfileId: true, targetSellerId: true, listingId: true, severity: true },
      })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const sevInput = String(body.severity || '')
      const severity = (['minor', 'moderate', 'severe'].includes(sevInput)
        ? sevInput
        : report.severity || 'moderate') as 'minor' | 'moderate' | 'severe'
      // Idempotent: only the open→confirmed transition applies a penalty (admin
      // double-click / retry can't re-dock the score).
      const upd = await db.report.updateMany({
        where: { id, status: 'open' },
        data: { status: 'confirmed', severity, resolvedBy: admin, resolvedAt: new Date(), decisionNote },
      })
      if (upd.count === 0) return NextResponse.json({ ok: true })
      const penalty = -SEVERITY_PENALTY[severity]
      if (report.targetProfileId) {
        const res = await applyTrustEvent(report.targetProfileId, 'report_confirmed', penalty, { reason: `report:${id}`, reportId: id })
        // Enforcement ladder: re-derive the state now that the confirmation landed —
        // a frozen scam → held (listings pulled), conduct-restricted → throttled,
        // a corroborated pattern → warned. Fail-quiet inside (deploy-order safe).
        if (res) await syncEnforcement(report.targetProfileId, res.breakdown, { persistedScore: res.score, triggerReportId: id })
      } else if (report.targetSellerId) {
        await penalizeSeller(report.targetSellerId, penalty, { reason: `report:${id}`, reportId: id })
      }
      // Reactive: take the reported listing down immediately.
      // ⚠️ IF THIS FAILS, THE REQUEST FAILS. It used to swallow the error and return 200, so an
      // admin confirming a scam report was told the listing was pulled while it stayed public.
      let takedownFailed = false
      if (report.listingId) {
        try {
          await db.listing.update({ where: { id: report.listingId }, data: { verified: false } })
          revalidatePath(`/listings/${report.listingId}`)
        } catch (e) {
          logError(e, { op: 'moderate.unverifyListing', reportId: id, listingId: report.listingId })
          takedownFailed = true
        }
      }
      // Tell the reported party (if they have an account) + give them an appeal path,
      // and close the loop for the reporter (dispute center: outcomes reach both sides).
      if (report.targetProfileId) await notifyActioned(report.targetProfileId, id)
      const upheldReporter = await db.report.findUnique({ where: { id }, select: { reporterProfileId: true } })
      if (upheldReporter?.reporterProfileId) await notifyDispute(upheldReporter.reporterProfileId, id, 'decided_upheld_reporter')
      // ⚠️ A DISTINCT 500 — NOT AN UNCAUGHT THROW, and the difference matters. The report row
      // already flipped to `confirmed` above, so a retry hits the `upd.count === 0` idempotency
      // guard and returns a clean 200 with the listing still public — a bare throw would let the
      // operator "fix" it by retrying and be lied to a second time. The distinct code lets the
      // console say what is actually true: the trust dock landed, the listing did NOT come down,
      // pull it by hand.
      if (takedownFailed) {
        return NextResponse.json({ error: 'takedown_failed', listingId: report.listingId }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    case 'dismiss-report': {
      const report = await db.report.findUnique({
        where: { id },
        select: { id: true, reporterProfileId: true, targetProfileId: true, targetSellerId: true },
      })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const upd = await db.report.updateMany({
        where: { id, status: 'open' },
        data: { status: 'dismissed', resolvedBy: admin, resolvedAt: new Date(), decisionNote },
      })
      if (upd.count === 0) return NextResponse.json({ ok: true })
      // Outcome to both sides: reporter learns the finding; the respondent (who got
      // due-process notice at filing) learns the case closed with no action.
      if (report.reporterProfileId) await notifyDispute(report.reporterProfileId, id, 'decided_dismissed_reporter')
      const dismissedRespondent = await respondentProfileId(report)
      if (dismissedRespondent) await notifyDispute(dismissedRespondent, id, 'decided_closed_respondent')
      return NextResponse.json({ ok: true })
    }

    case 'abusive-report': {
      // The report was false/abusive → penalize the REPORTER (anti-fake-report):
      // a trust hit + a strike + a reporting cooldown. Idempotent on open→abusive.
      const report = await db.report.findUnique({
        where: { id },
        select: { id: true, reporterProfileId: true, targetProfileId: true, targetSellerId: true },
      })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const upd = await db.report.updateMany({
        where: { id, status: 'open' },
        data: { status: 'abusive', resolvedBy: admin, resolvedAt: new Date(), decisionNote },
      })
      if (upd.count === 0) return NextResponse.json({ ok: true })
      // Outcome to both sides (best-effort, before the purge below).
      if (report.reporterProfileId) await notifyDispute(report.reporterProfileId, id, 'decided_abusive_reporter')
      const clearedRespondent = await respondentProfileId(report)
      if (clearedRespondent) await notifyDispute(clearedRespondent, id, 'decided_closed_respondent')
      if (report.reporterProfileId) {
        await db.profile.update({
          where: { id: report.reporterProfileId },
          data: {
            falseReportStrikes: { increment: 1 },
            reportCooldownUntil: new Date(Date.now() + REPORT_COOLDOWN_DAYS * DAY_MS),
          },
        })
        await applyTrustEvent(report.reporterProfileId, 'manual_adjust', -FALSE_REPORT_PENALTY, {
          reason: `false_report:${id}`,
          reportId: id,
        })
        // eBay-style retroactive purge: every OTHER report this reporter got CONFIRMED
        // is overturned, and each affected seller recomputed — computeTrustV2 EXCLUDES
        // overturned reports, so the stolen points restore exactly. Uncapped: getting
        // back what a false report took isn't "earning" (no +6/day wait). Best-effort.
        try {
          const purged = await db.report.findMany({
            where: { reporterProfileId: report.reporterProfileId, status: 'confirmed', id: { not: id } },
            select: { id: true, targetProfileId: true, targetSellerId: true, severity: true },
            take: 200,
          })
          if (purged.length) {
            await db.report.updateMany({
              where: { id: { in: purged.map((r) => r.id) } },
              data: { status: 'overturned', resolvedBy: admin, resolvedAt: new Date() },
            })
            const affected = [...new Set(purged.map((r) => r.targetProfileId).filter((x): x is string => !!x))]
            for (const pid of affected) {
              const res = await recomputeTrust(pid, { uncapped: true })
              if (res) await syncEnforcement(pid, res.breakdown, { persistedScore: res.score })
            }
            // Storefront-only targets (no owning profile at report time): the original
            // dock was a direct mirror mutation, so mirror the reversal the same way —
            // unless the shop was claimed since (then the owner recompute above/below
            // is the source of truth).
            for (const r of purged) {
              if (r.targetProfileId || !r.targetSellerId) continue
              const s = await db.seller.findUnique({ where: { id: r.targetSellerId }, select: { ownerId: true } })
              if (!s) continue
              if (s.ownerId) {
                const res = await recomputeTrust(s.ownerId, { uncapped: true })
                if (res) await syncEnforcement(s.ownerId, res.breakdown, { persistedScore: res.score })
              } else {
                await penalizeSeller(r.targetSellerId, SEVERITY_PENALTY[normSeverity(r.severity)], { reason: `overturned:${r.id}` })
              }
            }
          }
        } catch (e) {
          console.error('[moderate] abusive-reporter purge failed', e)
        }
      }
      return NextResponse.json({ ok: true })
    }

    case 'extend-window': {
      // Give both sides 72 more hours of evidence (Binance CS "requesting more proof").
      // Extends from now (or the current deadline if it's still in the future).
      const report = await db.report.findUnique({
        where: { id },
        select: { id: true, status: true, evidenceUntil: true, reporterProfileId: true, targetProfileId: true, targetSellerId: true },
      })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (report.status !== 'open') return NextResponse.json({ error: 'already_resolved' }, { status: 409 })
      const base = Math.max(Date.now(), report.evidenceUntil?.getTime() ?? 0)
      const until = new Date(base + DISPUTE_WINDOW_MS)
      await db.report.update({ where: { id }, data: { evidenceUntil: until } })
      // A visible thread event (notify:false — the richer copy below covers both sides).
      await addDisputeMessage(report, {
        senderProfileId: null, senderRole: 'system',
        body: `Evidence window extended until ${until.toISOString()}`,
      }, { notify: false }).catch((e) => logError(e, { op: 'moderate.extendWindowMessage' }))
      if (report.reporterProfileId) await notifyDispute(report.reporterProfileId, id, 'window_extended')
      const extendedRespondent = await respondentProfileId(report)
      if (extendedRespondent) await notifyDispute(extendedRespondent, id, 'window_extended')
      return NextResponse.json({ ok: true, evidenceUntil: until.toISOString() })
    }

    case 'dispute-message': {
      // Free-text admin message INTO the case room — the mediation channel the old
      // macro-only one-way notifications never allowed. The admin's individual
      // identity is never stored/exposed; rows render as "eno.vn moderation".
      const text = String(body.message ?? '').trim().slice(0, DISPUTE_BODY_MAX)
      if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 })
      const report = await db.report.findUnique({
        where: { id },
        select: { id: true, status: true, reporterProfileId: true, targetProfileId: true, targetSellerId: true },
      })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const row = await addDisputeMessage(report, { senderProfileId: null, senderRole: 'admin', body: text })
      return NextResponse.json({ ok: true, id: row.id })
    }

    case 'remediated': {
      // Amazon-style remediation: the seller demonstrably fixed the issue — the
      // confirmed report STAYS on record but its conduct weight halves (computeTrustV2
      // reads Report.remediatedAt). Idempotent (only the first mark recomputes).
      const report = await db.report.findUnique({ where: { id }, select: { id: true, status: true, targetProfileId: true } })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (report.status !== 'confirmed') return NextResponse.json({ error: 'not_confirmed' }, { status: 400 })
      // Typed one-shot write (the Phase 2 column is live) — remediatedAt:null keeps
      // an admin double-click from re-marking + re-recomputing.
      const upd = await db.report.updateMany({
        where: { id, remediatedAt: null },
        data: { remediatedAt: new Date() },
      })
      const marked = upd.count
      if (marked > 0 && report.targetProfileId) {
        const res = await recomputeTrust(report.targetProfileId)
        if (res) await syncEnforcement(report.targetProfileId, res.breakdown, { persistedScore: res.score })
      }
      return NextResponse.json({ ok: true, remediated: marked > 0 })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
