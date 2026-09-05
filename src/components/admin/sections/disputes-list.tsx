import Link from 'next/link'
import {
  ArrowRight, Ban, CircleEllipsis, Copy, Copyright, ImageOff, Info,
  MessageSquareWarning, PackageCheck, TriangleAlert,
} from '@/components/ui/icons'
import type { IconComponent } from '@/components/ui/icons'
import { db } from '@/lib/db'
import { reportContext, targetContext, type RawReport } from '@/lib/admin-reports'
import { disputeStage } from '@/lib/dispute'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

// The dispute center — every report is a CASE here (the Reports tab stays the fast triage surface;
// this is the case-room view: thread, evidence, deadlines). Open cases sort by urgency: evidence
// window closing first, then latest activity. A tab of /admin/moderation since console v2.
const REASON_GLYPH: Record<string, IconComponent> = {
  scam: TriangleAlert, counterfeit: Copyright, sold: PackageCheck, 'wrong-info': Info,
  duplicate: Copy, offensive: MessageSquareWarning, prohibited: Ban,
  stolen_photos: ImageOff, other: CircleEllipsis,
}

const fmtLeft = (d: Date | null): string | null => {
  if (!d) return null
  const ms = d.getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

export async function DisputesList() {
  const rows = await db.report.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, reason: true, status: true, severity: true, createdAt: true,
      evidenceUntil: true, lastMessageAt: true, resolvedBy: true, appealedAt: true,
      reporterProfileId: true, targetProfileId: true, targetSellerId: true, listingId: true, conversationId: true,
      _count: { select: { messages: true } },
    },
  })

  const raw: RawReport[] = rows.map((r) => ({
    id: r.id, reporterProfileId: r.reporterProfileId, listingId: r.listingId,
    conversationId: r.conversationId, targetSellerId: r.targetSellerId, targetProfileId: r.targetProfileId,
  }))
  const [{ reporterById }, { targetByReportId }] = await Promise.all([reportContext(raw), targetContext(raw)])

  const open = rows
    .filter((r) => r.status === 'open')
    .sort((a, b) => {
      const ae = a.evidenceUntil?.getTime() ?? Infinity
      const be = b.evidenceUntil?.getTime() ?? Infinity
      if (ae !== be) return ae - be
      return (b.lastMessageAt ?? b.createdAt).getTime() - (a.lastMessageAt ?? a.createdAt).getTime()
    })
  const closed = rows.filter((r) => r.status !== 'open').slice(0, 40)

  const CaseRow = ({ r }: { r: (typeof rows)[number] }) => {
    const target = targetByReportId.get(r.id)
    const reporter = r.reporterProfileId ? reporterById.get(r.reporterProfileId) : null
    const stage = disputeStage(r)
    const left = stage === 'evidence' ? fmtLeft(r.evidenceUntil) : null
    const Lead = REASON_GLYPH[r.reason] ?? CircleEllipsis
    return (
      <Link href={`/admin/disputes/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted">
        <Lead className="h-5 w-5 shrink-0 text-ink-4" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold capitalize text-foreground">{r.reason}</span>
            {r.status === 'open' ? (
              stage === 'evidence'
                ? <Badge variant="brand">evidence{left ? ` · ${left} left` : ''}</Badge>
                : <Badge variant="warning">awaiting decision</Badge>
            ) : (
              <Badge variant={r.status === 'confirmed' ? 'success' : r.status === 'abusive' ? 'destructive' : 'neutral'} className="capitalize">
                {r.resolvedBy === 'withdrawn-by-reporter' ? 'withdrawn' : r.status}
              </Badge>
            )}
            {r.appealedAt && r.status === 'open' && <Badge variant="warning">appeal</Badge>}
            {target?.isGuest && <Badge variant="neutral">respondent unreachable</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {reporter ? `by ${reporter.name} (trust ${reporter.trustScore}${reporter.strikes ? `, ${reporter.strikes} strikes` : ''})` : 'by unknown'}
            <ArrowRight className="mx-1 inline h-3 w-3 align-[-1.5px] text-ink-4" aria-label="against" />
            {target ? `${target.name}${target.trustScore != null ? ` (trust ${target.trustScore})` : ''}` : 'unknown target'}
            {target?.listing ? ` · ${target.listing.title}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-semibold text-body">{r._count.messages} msg</p>
          <p className="text-3xs text-ink-4">{(r.lastMessageAt ?? r.createdAt).toLocaleDateString('en-GB')}</p>
        </div>
      </Link>
    )
  }

  // Plain render helper, NOT a component — a capitalized component created during render remounts
  // its subtree every pass (and trips react-hooks/static-components).
  const renderCaseList = (list: typeof rows) => (
    <Card className="py-0">
      <ul className="divide-y divide-border">
        {list.map((r) => <li key={r.id}><CaseRow r={r} /></li>)}
      </ul>
    </Card>
  )

  return (
    <section aria-labelledby="disputes-list">
      <h2 id="disputes-list" className="sr-only">Disputes</h2>
      <p className="mb-4 text-sm text-muted-foreground">Every report is a case: both parties submit evidence during the window, you mediate in the room and decide (AI-assisted).</p>
      <h3 className="text-sm font-bold uppercase tracking-wide text-ink-4">Open · {open.length}</h3>
      <div className="mt-2">
        {open.length === 0 ? <p className="px-2 py-6 text-sm text-muted-foreground">No open cases. 🎉</p> : renderCaseList(open)}
      </div>
      <h3 className="mt-10 text-sm font-bold uppercase tracking-wide text-ink-4">Recently resolved</h3>
      <div className="mt-2 opacity-80">
        {closed.length === 0 ? <p className="px-2 py-6 text-sm text-muted-foreground">Nothing resolved yet.</p> : renderCaseList(closed)}
      </div>
    </section>
  )
}
