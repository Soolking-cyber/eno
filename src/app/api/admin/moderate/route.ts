import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { applyTrustEvent, penalizeSeller, recomputeTrust, SEVERITY_PENALTY, FALSE_REPORT_PENALTY, REPORT_COOLDOWN_DAYS } from '@/lib/trust'
import { syncEnforcement } from '@/lib/enforcement'
import { APPEAL_NOTICE, pickLocale } from '@/lib/admin-macros'

export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000

// Notify the reported party (if they have an account) that their content was actioned,
// with a deep-link to appeal. In their language (Profile.locale, EN/VI). Best-effort.
async function notifyActioned(targetProfileId: string, reportId: string) {
  const p = await db.profile.findUnique({ where: { id: targetProfileId }, select: { locale: true } })
  const l = pickLocale(p?.locale)
  await db.notification.create({
    data: { recipientId: targetProfileId, type: 'system', title: APPEAL_NOTICE.title[l], body: APPEAL_NOTICE.body[l], actorName: 'eno.vn moderation', url: `/appeal/${reportId}` },
  }).catch(() => {})
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

  let body: { action?: string; id?: string; severity?: string; ids?: string[]; note?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const action = String(body.action || '')
  const id = String(body.id || '').trim()
  const isBulk = action === 'bulk-dismiss' || action === 'bulk-confirm'
  if (!id && !isBulk) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const normSeverity = (v: unknown): 'minor' | 'moderate' | 'severe' =>
    (['minor', 'moderate', 'severe'].includes(String(v)) ? String(v) : 'moderate') as 'minor' | 'moderate' | 'severe'

  switch (action) {
    case 'set-note': {
      // Staff-only note on the case — never shown to users.
      await db.report.update({ where: { id }, data: { internalNote: String(body.note ?? '').slice(0, 2000) || null } }).catch(() => {})
      return NextResponse.json({ ok: true })
    }

    case 'dismiss-target': {
      // Clear a pile-on: dismiss EVERY open report sharing this report's target identity.
      const report = await db.report.findUnique({ where: { id }, select: { targetProfileId: true, targetSellerId: true, listingId: true } })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const where = report.targetProfileId ? { targetProfileId: report.targetProfileId }
        : report.targetSellerId ? { targetSellerId: report.targetSellerId }
        : report.listingId ? { listingId: report.listingId } : { id }
      const upd = await db.report.updateMany({ where: { ...where, status: 'open' }, data: { status: 'dismissed', resolvedBy: admin, resolvedAt: new Date() } })
      return NextResponse.json({ ok: true, dismissed: upd.count })
    }

    case 'bulk-dismiss': {
      const ids = (body.ids || []).map((x) => String(x)).slice(0, 200)
      if (!ids.length) return NextResponse.json({ error: 'No ids' }, { status: 400 })
      const upd = await db.report.updateMany({ where: { id: { in: ids }, status: 'open' }, data: { status: 'dismissed', resolvedBy: admin, resolvedAt: new Date() } })
      return NextResponse.json({ ok: true, dismissed: upd.count })
    }

    case 'bulk-confirm': {
      const ids = (body.ids || []).map((x) => String(x)).slice(0, 100)
      if (!ids.length) return NextResponse.json({ error: 'No ids' }, { status: 400 })
      const severity = normSeverity(body.severity)
      const penalty = -SEVERITY_PENALTY[severity]
      let confirmed = 0
      for (const rid of ids) {
        const report = await db.report.findUnique({ where: { id: rid }, select: { targetProfileId: true, targetSellerId: true, listingId: true } })
        if (!report) continue
        const upd = await db.report.updateMany({ where: { id: rid, status: 'open' }, data: { status: 'confirmed', severity, resolvedBy: admin, resolvedAt: new Date() } })
        if (upd.count === 0) continue // already resolved — no double-dock
        if (report.targetProfileId) {
          const res = await applyTrustEvent(report.targetProfileId, 'report_confirmed', penalty, { reason: `report:${rid}`, reportId: rid })
          // Enforcement ladder: re-derive now that the confirmation landed (fail-quiet inside).
          if (res) await syncEnforcement(report.targetProfileId, res.breakdown, { persistedScore: res.score, triggerReportId: rid })
        } else if (report.targetSellerId) await penalizeSeller(report.targetSellerId, penalty, { reason: `report:${rid}`, reportId: rid })
        if (report.listingId) { await db.listing.update({ where: { id: report.listingId }, data: { verified: false } }).catch(() => {}); revalidatePath(`/listings/${report.listingId}`) }
        if (report.targetProfileId) await notifyActioned(report.targetProfileId, rid)
        confirmed++
      }
      return NextResponse.json({ ok: true, confirmed })
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
        data: { status: 'confirmed', severity, resolvedBy: admin, resolvedAt: new Date() },
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
      if (report.listingId) {
        await db.listing.update({ where: { id: report.listingId }, data: { verified: false } }).catch(() => {})
        revalidatePath(`/listings/${report.listingId}`)
      }
      // Tell the reported party (if they have an account) + give them an appeal path.
      if (report.targetProfileId) await notifyActioned(report.targetProfileId, id)
      return NextResponse.json({ ok: true })
    }

    case 'dismiss-report': {
      await db.report.updateMany({
        where: { id, status: 'open' },
        data: { status: 'dismissed', resolvedBy: admin, resolvedAt: new Date() },
      })
      return NextResponse.json({ ok: true })
    }

    case 'abusive-report': {
      // The report was false/abusive → penalize the REPORTER (anti-fake-report):
      // a trust hit + a strike + a reporting cooldown. Idempotent on open→abusive.
      const report = await db.report.findUnique({ where: { id }, select: { id: true, reporterProfileId: true } })
      if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const upd = await db.report.updateMany({
        where: { id, status: 'open' },
        data: { status: 'abusive', resolvedBy: admin, resolvedAt: new Date() },
      })
      if (upd.count === 0) return NextResponse.json({ ok: true })
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
