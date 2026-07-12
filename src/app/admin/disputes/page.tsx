import type { Metadata } from 'next'
import Link from 'next/link'
import { Scale } from 'lucide-react'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { reportContext, targetContext, type RawReport } from '@/lib/admin-reports'
import { disputeStage } from '@/lib/dispute'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Disputes — eno.vn admin', robots: { index: false, follow: false } }

// Admin dispute center — every report is a CASE here (the queue at /admin stays the
// fast triage surface; this is the case-room view: thread, evidence, deadlines).
// Open cases sort by urgency: evidence window closing first, then latest activity.

const fmtLeft = (d: Date | null): string | null => {
  if (!d) return null
  const ms = d.getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

export default async function AdminDisputesPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />

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
      // Evidence deadline urgency first (soonest window end), then latest activity.
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
    return (
      <Link
        href={`/admin/disputes/${r.id}`}
        className="flex items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-muted"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint"><Scale className="h-4 w-4 text-ink-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold capitalize text-foreground">{r.reason}</span>
            {r.status === 'open' ? (
              stage === 'evidence'
                ? <span className="rounded-full bg-tint px-2 py-0.5 text-3xs font-bold text-accent-foreground">evidence{left ? ` · ${left} left` : ''}</span>
                : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-3xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">awaiting decision</span>
            ) : (
              <span className={cn('rounded-full bg-tint px-2 py-0.5 text-3xs font-bold capitalize',
                r.status === 'confirmed' ? 'text-success' : r.status === 'abusive' ? 'text-destructive' : 'text-ink-4')}>
                {r.resolvedBy === 'withdrawn-by-reporter' ? 'withdrawn' : r.status}
              </span>
            )}
            {r.appealedAt && r.status === 'open' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-3xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">appeal</span>}
            {target?.isGuest && <span className="rounded-full bg-tint px-2 py-0.5 text-3xs font-bold text-ink-4">respondent unreachable</span>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {reporter ? `by ${reporter.name} (trust ${reporter.trustScore}${reporter.strikes ? `, ${reporter.strikes} strikes` : ''})` : 'by unknown'}
            {' → '}
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

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <div className="mb-5">
          <h1 className="h-title text-foreground">Dispute center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {admin}. Every report is a case: both parties submit evidence during the window, you mediate in the room and decide (AI-assisted).
          </p>
        </div>

        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-4">Open · {open.length}</h2>
        <div className="mt-2">
          {open.length === 0 && <p className="px-2 py-6 text-sm text-muted-foreground">No open cases. 🎉</p>}
          {open.map((r) => <CaseRow key={r.id} r={r} />)}
        </div>

        <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-ink-4">Recently resolved</h2>
        <div className="mt-2 opacity-80">
          {closed.length === 0 && <p className="px-2 py-6 text-sm text-muted-foreground">Nothing resolved yet.</p>}
          {closed.map((r) => <CaseRow key={r.id} r={r} />)}
        </div>
      </main>
    </div>
  )
}
