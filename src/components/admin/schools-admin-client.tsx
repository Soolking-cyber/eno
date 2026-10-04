'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2 } from '@/components/ui/icons'
import { formatMoneyFull } from '@/lib/vnd'
import { cn } from '@/lib/utils'

// Admin chrome is EN-only by repo convention.

type Person = { id: string; createdAt: string; trustTier: string; enforcementState: string; accountType: string | null } | null

export type AdminReview = {
  id: string; school: { name: string; slug: string }; current: boolean; tenure: string; role: string; employment: string
  leftYear: number | null; district: string | null; pros: string; cons: string; advice: string | null
  goodTags: string[]; badTags: string[]; pay: { amount: number; currency: string; period: string; vnd: number | null } | null
  flags: string[]; status: string; replyText: string | null; createdAt: string; updatedAt: string; author: Person
}
export type AdminReport = {
  id: string; kind: 'review_report' | 'school_complaint'; reason: string; detail: string | null; contactEmail: string | null
  createdAt: string; dueBy: string | null; school: { name: string; slug: string; website: string | null }; reporter: Person; review: AdminReview | null
}
export type AdminSchool = { id: string; slug: string; name: string; kind: string; status: string; reviews: number; published: number; aliases: number }

async function act(body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch('/api/admin/schools', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    const code = (await res.json().catch(() => ({}))).error
    toast.error(code === 'review_changed_reload' ? 'The teacher changed this review after you opened it — reload and read it again.'
      : code === 'invalid_status_transition' ? 'This review is no longer in a state where that applies — reload.'
      : `Failed: ${code ?? res.status}`)
  }
  return res.ok
}

const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

export function SchoolsAdminClient({ tab, reviews, reports, schools }: { tab: string; reviews: AdminReview[]; reports: AdminReport[]; schools: AdminSchool[] }) {
  if (tab === 'reviews') {
    return reviews.length
      ? <ul className="flex flex-col gap-3">{reviews.map((r) => <li key={r.id}><ReviewModeration review={r} /></li>)}</ul>
      : <EmptyState tone="admin" icon={CheckCircle2} title="No reviews waiting" subtitle="New and edited reviews appear here before they are public." />
  }
  if (tab === 'reports') {
    return reports.length
      ? <ul className="flex flex-col gap-3">{reports.map((r) => <li key={r.id}><ReportCard report={r} /></li>)}</ul>
      : <EmptyState tone="admin" icon={CheckCircle2} title="Nothing open" subtitle="Reports on reviews and school complaints appear here." />
  }
  return <Directory schools={schools} />
}

function AuthorLine({ who, label }: { who: Person; label: string }) {
  if (!who) return <p className="text-xs text-muted-foreground">{label}: account deleted</p>
  const days = Math.floor((Date.now() - new Date(who.createdAt).getTime()) / 86_400_000)
  return (
    <p className="text-xs text-muted-foreground">
      {label}: <Link href={`/admin/users?q=${who.id}`} className="font-semibold text-accent-foreground hover:underline">account</Link>
      {' · '}{days} days old · {who.accountType ?? 'not onboarded'} · trust {who.trustTier}
      {who.enforcementState !== 'good_standing' && <> · <span className="font-semibold text-destructive">{who.enforcementState}</span></>}
      {days < 7 && <> · <span className="font-semibold text-warning">new account: not public until it is 7 days old</span></>}
    </p>
  )
}

function ReviewBody({ r }: { r: AdminReview }) {
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {r.current ? 'Current' : 'Former'} {r.role} · {r.tenure} · {r.employment}{r.leftYear ? ` · left ${r.leftYear}` : ''}{r.district ? ` · ${r.district}` : ''}
      </p>
      {(r.goodTags.length > 0 || r.badTags.length > 0) && (
        <p className="mt-2 flex flex-wrap gap-1">
          {r.goodTags.map((t) => <Badge key={t} variant="success">{t}</Badge>)}
          {r.badTags.map((t) => <Badge key={t} variant="warning">{t}</Badge>)}
        </p>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><p className="text-xs font-semibold text-success">Good</p><p className="whitespace-pre-line text-sm text-foreground">{r.pros}</p></div>
        <div><p className="text-xs font-semibold text-destructive">Not so good</p><p className="whitespace-pre-line text-sm text-foreground">{r.cons}</p></div>
      </div>
      {r.advice && <div className="mt-2"><p className="text-xs font-semibold text-foreground">Advice</p><p className="whitespace-pre-line text-sm text-foreground">{r.advice}</p></div>}
      {r.pay && (
        <p className="mt-2 text-xs text-muted-foreground">
          Pay (private): {r.pay.currency === 'USD' ? `$${r.pay.amount}` : formatMoneyFull(r.pay.amount, '₫')} per {r.pay.period}
          {r.pay.currency === 'USD' && r.pay.vnd ? ` ≈ ${formatMoneyFull(r.pay.vnd, '₫')}` : ''}
        </p>
      )}
    </>
  )
}

function ReviewModeration({ review: r }: { review: AdminReview }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [rejecting, setRejecting] = React.useState(false)
  const [reason, setReason] = React.useState('')
  async function run(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    if (await act(body)) { toast.success(ok); router.refresh() }
    setBusy(false)
  }
  return (
    <Card className={cn('p-4', r.flags.includes('accusation') && 'ring-2 ring-warning')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          <Link href={`/schools/${r.school.slug}`} className="hover:underline" target="_blank">{r.school.name}</Link>
        </p>
        <p className="text-xs text-muted-foreground">submitted {ago(r.updatedAt)}{r.createdAt !== r.updatedAt ? ' (edited)' : ''}</p>
      </div>
      {r.flags.includes('accusation') && (
        <p className="mt-2 rounded-lg bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">
          Flag: accuses someone of a crime (scam, fraud, theft…). Publish only if it describes the writer&apos;s own experience, not an allegation.
        </p>
      )}
      <AuthorLine who={r.author} label="Writer" />
      <div className="mt-3"><ReviewBody r={r} /></div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="cta" size="sm" disabled={busy} onClick={() => run({ action: 'approve', reviewId: r.id, seenUpdatedAt: r.updatedAt }, 'Published')}>Approve</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setRejecting((x) => !x)}>Reject…</Button>
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="Reason the writer will see (e.g. names a person; describe your own experience instead)" />
          <Button variant="destructive" size="sm" className="self-start" disabled={busy || reason.trim().length < 3}
            onClick={() => run({ action: 'reject', reviewId: r.id, reason: reason.trim(), seenUpdatedAt: r.updatedAt }, 'Rejected')}>Reject with this reason</Button>
        </div>
      )}
    </Card>
  )
}

function ReportCard({ report: rep }: { report: AdminReport }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [reply, setReply] = React.useState(rep.review?.replyText ?? '')
  const [unpublishReason, setUnpublishReason] = React.useState('')
  const overdue = rep.dueBy ? new Date(rep.dueBy).getTime() < Date.now() : false
  async function run(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    if (await act(body)) { toast.success(ok); router.refresh() }
    setBusy(false)
  }
  return (
    <Card className={cn('p-4', overdue && 'ring-2 ring-destructive')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {rep.kind === 'school_complaint' ? 'School complaint' : 'Report on a review'} · {rep.reason}
          {' · '}<Link href={`/schools/${rep.school.slug}`} className="hover:underline" target="_blank">{rep.school.name}</Link>
        </p>
        <p className={cn('text-xs', overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
          {ago(rep.createdAt)}{rep.dueBy ? ` · due ${new Date(rep.dueBy).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short' })}${overdue ? ' — OVERDUE' : ''}` : ''}
        </p>
      </div>
      <AuthorLine who={rep.reporter} label={rep.kind === 'school_complaint' ? 'Sent by' : 'Reporter'} />
      {rep.contactEmail && <p className="mt-1 text-xs text-foreground">Reply to: <a href={`mailto:${rep.contactEmail}`} className="font-semibold text-accent-foreground hover:underline">{rep.contactEmail}</a></p>}
      {rep.kind === 'school_complaint' && <SenderCheck email={rep.contactEmail} website={rep.school.website} />}
      {rep.detail && <p className="mt-2 whitespace-pre-line rounded-lg bg-tint p-2 text-sm text-foreground">{rep.detail}</p>}

      {rep.review && (
        <div className="mt-3 rounded-xl ring-1 ring-border p-3">
          <p className="mb-1 text-xs font-semibold text-foreground">The review ({rep.review.status})</p>
          <AuthorLine who={rep.review.author} label="Writer" />
          <div className="mt-2"><ReviewBody r={rep.review} /></div>
          <div className="mt-3 flex flex-col gap-2">
            <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value.slice(0, 2000))} placeholder="The school's response, published under the review (empty = remove it)" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run({ action: 'reply', reviewId: rep.review!.id, text: reply.trim(), seenUpdatedAt: rep.review!.updatedAt }, reply.trim() ? 'Response published' : 'Response removed')}>
                {reply.trim() ? 'Publish school response' : 'Remove school response'}
              </Button>
            </div>
            {rep.review.status === 'published' && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Textarea rows={1} value={unpublishReason} onChange={(e) => setUnpublishReason(e.target.value.slice(0, 500))} placeholder="Reason to unpublish (the writer sees it)" />
                <Button variant="destructive" size="sm" disabled={busy || unpublishReason.trim().length < 3}
                  onClick={() => run({ action: 'reject', reviewId: rep.review!.id, reason: unpublishReason.trim(), seenUpdatedAt: rep.review!.updatedAt }, 'Unpublished')}>Unpublish review</Button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="cta" size="sm" disabled={busy} onClick={() => run({ action: 'resolve', reportId: rep.id, status: 'resolved' }, 'Resolved')}>Mark resolved</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run({ action: 'resolve', reportId: rep.id, status: 'dismissed' }, 'Dismissed')}>Dismiss</Button>
      </div>
    </Card>
  )
}

/**
 * Anyone signed in can use the school complaint form, so the card says whether the reply address is on
 * the school's own website domain — a strong signal, not proof (staff still confirm by email).
 */
function SenderCheck({ email, website }: { email: string | null; website: string | null }) {
  let host = ''
  try { host = website ? new URL(website).hostname.replace(/^www\./, '').toLowerCase() : '' } catch { host = '' }
  const domain = (email ?? '').toLowerCase().split('@')[1] ?? ''
  const onDomain = !!host && (domain === host || domain.endsWith(`.${host}`))
  return onDomain
    ? <p className="mt-1 text-xs font-semibold text-success">Email is on the school&apos;s own domain ({host}) — still confirm by replying before acting.</p>
    : <p className="mt-1 text-xs font-semibold text-warning">Sender NOT verified{host ? ` — email is not on ${host}` : ' — the school has no website on file'}. Anyone signed in can use this form: confirm by email before acting.</p>
}

function Directory({ schools }: { schools: AdminSchool[] }) {
  const router = useRouter()
  const [q, setQ] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const shown = schools.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${schools.length} schools`} aria-label="Filter schools"
        className="mb-3 min-h-10 w-full max-w-sm rounded-xl px-3 text-sm" />
      <ul className="divide-y divide-border rounded-2xl bg-card ring-1 ring-border">
        {shown.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <Link href={`/schools/${s.slug}`} target="_blank" className="min-w-0 flex-1 truncate font-semibold text-foreground hover:underline">{s.name}</Link>
            <span className="text-xs text-muted-foreground">{s.kind} · {s.published}/{s.reviews} published · {s.aliases} aliases</span>
            <Badge variant={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge>
            <Button variant="outline" size="sm" disabled={busy === s.id} onClick={async () => {
              setBusy(s.id)
              if (await act({ action: 'school_status', schoolId: s.id, status: s.status === 'active' ? 'hidden' : 'active' })) router.refresh()
              setBusy(null)
            }}>{s.status === 'active' ? 'Hide' : 'Show'}</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
