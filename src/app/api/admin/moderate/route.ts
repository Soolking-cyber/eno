import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { applyTrustEvent, penalizeSeller, SEVERITY_PENALTY, FALSE_REPORT_PENALTY, REPORT_COOLDOWN_DAYS } from '@/lib/trust'

export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000

// Single admin endpoint for the moderation queue. Every action re-checks the
// session server-side via getAdmin() — never trust a client-side gate.
//
// With manual verification removed, listings publish instantly; admin's job is
// (1) clearing the rare held listing (restricted/low-trust accounts) and
// (2) RESOLVING reports — which is what moves trust scores.
export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { action?: string; id?: string; severity?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const action = String(body.action || '')
  const id = String(body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  switch (action) {
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
        await applyTrustEvent(report.targetProfileId, 'report_confirmed', penalty, { reason: `report:${id}`, reportId: id })
      } else if (report.targetSellerId) {
        await penalizeSeller(report.targetSellerId, penalty, { reason: `report:${id}`, reportId: id })
      }
      // Reactive: take the reported listing down immediately.
      if (report.listingId) {
        await db.listing.update({ where: { id: report.listingId }, data: { verified: false } }).catch(() => {})
        revalidatePath(`/listings/${report.listingId}`)
      }
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
      }
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
