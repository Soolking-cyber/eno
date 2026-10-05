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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2 } from '@/components/ui/icons'
import { formatMoneyFull } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { SCHOOL_KINDS } from '@/lib/schools/constants'

// Admin chrome is EN-only by repo convention.

type Person = { id: string; createdAt: string; trustTier: string; enforcementState: string; accountType: string | null } | null

export type AdminReview = {
  id: string; school: { name: string; slug: string }; current: boolean; tenure: string; role: string; employment: string
  leftYear: number | null; district: string | null; pros: string; cons: string; advice: string | null
  goodTags: string[]; badTags: string[]; pay: { amount: number; currency: string; period: string; vnd: number | null } | null
  flags: string[]; status: string; replyText: string | null; createdAt: string; updatedAt: string; author: Person
  /** The writer's proof of employment at this school (pending reviews, and reviews under a report). Approval needs `verified`. */
  proof?: { id: string; status: string; method: string; revocable: boolean } | null
}
export type AdminProof = {
  id: string; method: string; linkedinUrl: string | null; challenge: string | null; flags: string[]
  createdAt: string; updatedAt: string; school: { name: string; slug: string; website: string | null }; author: Person
}
export type AdminReport = {
  id: string; kind: 'review_report' | 'school_complaint'; reason: string; detail: string | null; contactEmail: string | null
  createdAt: string; dueBy: string | null; school: { name: string; slug: string; website: string | null }; reporter: Person; review: AdminReview | null
}
export type AdminSchool = { id: string; slug: string; name: string; kind: string; status: string; reviews: number; published: number; aliases: number }
export type AdminAwards = { open: number; ended: { year: number; finalisedAt: string | null; finalisedBy: string | null }[] }
export type AdminSuggestion = {
  id: string; name: string; kind: string; website: string | null; districts: string[]; note: string; createdAt: string; author: Person
  /** Schools it may already be (hidden ones included): same name, same website, or a name that holds the other. */
  matches: { slug: string; name: string; status: string; why: 'name' | 'website' | 'similar' }[]
}

async function act(body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch('/api/admin/schools', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    const code = (await res.json().catch(() => ({}))).error
    toast.error(code === 'review_changed_reload' ? 'The teacher changed this after you opened it — reload and read it again.'
      : code === 'proof_not_verified' ? 'Verify the writer’s proof of employment first (Proofs tab).'
      : code === 'linkedin_already_used' ? 'This LinkedIn profile already proved employment for another account. Reject this proof, without saying why: the teacher reads the reason.'
      : code === 'invalid_status_transition' ? 'This is no longer in a state where that applies — reload.'
      : code === 'proof_rejected' ? 'This LinkedIn profile was revoked before: it can never prove employment. Reject this proof, without saying why: the teacher reads the reason.'
      : code === 'already_resolved' ? 'Someone already decided this — reload.'
      : code === 'award_reviews_pending' ? 'Reviews submitted in that year are still waiting in the queue. Decide them first, then close the year.'
      : code === 'alias_taken' ? 'A listed school already answers to this name. Mark the suggestion as a duplicate of it instead.'
      : code === 'school_name_invalid' ? 'That name cannot be a school: give its own name, not a description.'
      : code === 'website_invalid' ? 'That website address is not valid.'
      : code === 'district_invalid' ? 'Areas must be from the HCMC area list, separated by commas.'
      : `Failed: ${code ?? res.status}`)
  }
  return res.ok
}

const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

export function SchoolsAdminClient({ tab, reviews, reports, schools, proofs, suggestions, awards }: { tab: string; reviews: AdminReview[]; reports: AdminReport[]; schools: AdminSchool[]; proofs: AdminProof[]; suggestions: AdminSuggestion[]; awards: AdminAwards }) {
  if (tab === 'reviews') {
    return reviews.length
      ? <ul className="flex flex-col gap-3">{reviews.map((r) => <li key={r.id}><ReviewModeration review={r} /></li>)}</ul>
      : <EmptyState tone="admin" icon={CheckCircle2} title="No reviews waiting" subtitle="New and edited reviews appear here before they are public." />
  }
  if (tab === 'proofs') {
    return proofs.length
      ? <ul className="flex flex-col gap-3">{proofs.map((p) => <li key={p.id}><ProofCard proof={p} /></li>)}</ul>
      : <EmptyState tone="admin" icon={CheckCircle2} title="No proofs waiting" subtitle="Teachers' LinkedIn proofs of employment wait here until a moderator checks them." />
  }
  if (tab === 'suggestions') {
    return suggestions.length
      ? <ul className="flex flex-col gap-3">{suggestions.map((x) => <li key={x.id}><SuggestionCard suggestion={x} /></li>)}</ul>
      : <EmptyState tone="admin" icon={CheckCircle2} title="No suggestions waiting" subtitle="Schools teachers ask us to add (/schools/suggest) wait here." />
  }
  if (tab === 'reports') {
    return reports.length
      ? <ul className="flex flex-col gap-3">{reports.map((r) => <li key={r.id}><ReportCard report={r} /></li>)}</ul>
      : <EmptyState tone="admin" icon={CheckCircle2} title="Nothing open" subtitle="Reports on reviews and school complaints appear here." />
  }
  return (
    <div className="flex flex-col gap-4">
      <AwardsCard awards={awards} />
      <Directory schools={schools} />
    </div>
  )
}

/**
 * Teachers' Choice years. A moderator closes a year here once its reviews are decided (the daily
 * /api/cron/school-awards that could do it is installed but not enabled — install-cron-timers.sh POLICY). Closing is
 * once and final: the places are frozen and later votes never change them.
 */
function AwardsCard({ awards }: { awards: AdminAwards }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  async function close(year: number) {
    setBusy(true)
    if (await act({ action: 'awards_finalise', year })) { toast.success(`${year} awards closed`); router.refresh() }
    setBusy(false)
  }
  return (
    <Card className="p-4 text-sm">
      <p className="font-semibold text-foreground">Teachers&apos; Choice</p>
      <p className="mt-1 text-muted-foreground">
        {awards.open} is open: <Link href={`/schools/awards/${awards.open}`} target="_blank" className="font-semibold text-accent-foreground hover:underline">its page</Link> lists who qualifies so far.
      </p>
      {awards.ended.map((y) => (
        <p key={y.year} className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{y.year}</span>
          {y.finalisedAt
            ? <span className="text-muted-foreground">closed {ago(y.finalisedAt)} by {y.finalisedBy}</span>
            : <Button variant="cta" size="sm" disabled={busy} onClick={() => void close(y.year)}>Close {y.year} and publish results</Button>}
        </p>
      ))}
      {/* What closing cannot undo (diff review): the moderator times the close, so the moderator is told. */}
      {awards.ended.some((y) => !y.finalisedAt) && (
        <p className="mt-2 text-xs text-muted-foreground">
          Closing is final. It waits until the year&apos;s queued reviews are decided, and it places only schools that are
          listed at that moment: settle any school hidden while a complaint is open first.
        </p>
      )}
    </Card>
  )
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
      <p className={cn('mt-1 text-xs font-semibold', r.proof?.status === 'verified' ? 'text-success' : 'text-warning')}>
        Proof of employment: {r.proof ? `${r.proof.status} (LinkedIn)` : 'none'}
        {r.proof?.status === 'pending' && ' — it can be approved only once the proof is verified (Proofs tab).'}
        {r.proof && r.proof.status !== 'pending' && r.proof.status !== 'verified' && ' — it cannot be approved: the writer has no live proof.'}
      </p>
      <div className="mt-3"><ReviewBody r={r} /></div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="cta" size="sm" disabled={busy || r.proof?.status !== 'verified'} onClick={() => run({ action: 'approve', reviewId: r.id, seenUpdatedAt: r.updatedAt }, 'Published')}>Approve</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setRejecting((x) => !x)}>Reject…</Button>
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="Reason the writer will see (e.g. names a person; describe your own experience instead)" />
          <Button variant="destructive" size="sm" className="self-start" disabled={busy || reason.trim().length < 3}
            onClick={() => run({ action: 'reject', reviewId: r.id, reason: reason.trim(), seenUpdatedAt: r.updatedAt }, 'Rejected')}>Reject with this reason</Button>
          {/* A verified proof found false while reading the review — a borrowed profile — is revoked here too, not only
              from a report (diff review): every proof made with that profile goes, with the reviews it backed. */}
          {r.proof?.revocable && (
            <Button variant="outline" size="sm" className="self-start text-destructive" disabled={busy || reason.trim().length < 3}
              onClick={() => run({ action: 'proof_revoke', proofId: r.proof!.id, reason: reason.trim() }, 'Proof revoked; reviews unpublished')}>Revoke the proof of employment instead</Button>
          )}
        </div>
      )}
    </Card>
  )
}

const FLAG_NOTE: Record<string, string> = {
  linkedin_shared: 'This LinkedIn profile was also submitted from another eno account. Check both before verifying either. Never mention another account in the reason: the teacher reads it, and must not learn who else is here.',
  account_revoked: 'A moderator REVOKED a proof from this account before (a profile it used was found false). Check this one with that in mind. Never mention it in the reason: the teacher reads it.',
  linkedin_changed: 'This account proved employment before with a DIFFERENT LinkedIn profile. Check why it changed before verifying. Never mention another account in the reason: the teacher reads it, and must not learn who else is here.',
  linkedin_revoked: 'A moderator revoked a proof made with this LinkedIn profile. It cannot verify any account again: reject this one. Never mention another account in the reason: the teacher reads it, and must not learn who else is here.',
}

/**
 * One proof of employment. NEVER shown to anyone but a moderator. For LinkedIn: open the profile, check the
 * school is in Experience and the code is on the profile (headline or About); we never scrape it.
 */
function ProofCard({ proof: p }: { proof: AdminProof }) {
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
    <Card className={cn('p-4', p.flags.length > 0 && 'ring-2 ring-warning')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          <Link href={`/schools/${p.school.slug}`} className="hover:underline" target="_blank">{p.school.name}</Link>
          {' · LinkedIn'}
        </p>
        <p className="text-xs text-muted-foreground">submitted {ago(p.updatedAt)}</p>
      </div>
      {p.flags.map((f) => <p key={f} className="mt-2 rounded-lg bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">{FLAG_NOTE[f] ?? f}</p>)}
      <AuthorLine who={p.author} label="Teacher" />
      {p.method === 'linkedin' && p.linkedinUrl && (
        <div className="mt-3 flex flex-col gap-1 text-sm">
          <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-semibold text-accent-foreground hover:underline">{p.linkedinUrl}</a>
          <p className="text-xs text-muted-foreground">
            Verify only if (1) {p.school.name} is in the profile&apos;s Experience and (2) this code is on the profile:{' '}
            <code className="rounded-lg bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{p.challenge}</code>
          </p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="cta" size="sm" disabled={busy} onClick={() => run({ action: 'proof_verify', proofId: p.id, seenUpdatedAt: p.updatedAt }, 'Verified')}>Verify</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setRejecting((x) => !x)}>Reject…</Button>
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="Reason the teacher will see: about their own profile only, never another account (e.g. the code is not on the profile)" />
          <Button variant="destructive" size="sm" className="self-start" disabled={busy || reason.trim().length < 3}
            onClick={() => run({ action: 'proof_reject', proofId: p.id, reason: reason.trim(), seenUpdatedAt: p.updatedAt }, 'Rejected')}>Reject with this reason</Button>
        </div>
      )}
    </Card>
  )
}

const KINDS = SCHOOL_KINDS
const MATCH_WHY = { name: 'same name', website: 'same website', similar: 'similar name' } as const

/**
 * A teacher's suggested school. Add it (correct the facts first — the server applies the importer's validation),
 * say it is already listed, or reject it with a reason the teacher sees. The suggester is not told who decided.
 */
function SuggestionCard({ suggestion: x }: { suggestion: AdminSuggestion }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [name, setName] = React.useState(x.name)
  const [kind, setKind] = React.useState(x.kind)
  const [website, setWebsite] = React.useState(x.website ?? '')
  const [districts, setDistricts] = React.useState(x.districts.join(', '))
  const [dupSlug, setDupSlug] = React.useState('')
  const [rejecting, setRejecting] = React.useState(false)
  const [reason, setReason] = React.useState('')
  async function run(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    if (await act(body)) { toast.success(ok); router.refresh() }
    setBusy(false)
  }
  const areas = districts.split(',').map((d) => d.trim()).filter(Boolean)
  return (
    <Card className={cn('p-4', x.matches.length > 0 && 'ring-2 ring-warning')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{x.name}</p>
        <p className="text-xs text-muted-foreground">suggested {ago(x.createdAt)}</p>
      </div>
      <AuthorLine who={x.author} label="Suggested by" />
      {x.website && <a href={x.website} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 block break-all text-sm font-semibold text-accent-foreground hover:underline">{x.website}</a>}
      {x.note && <p className="mt-2 whitespace-pre-line text-sm text-body">{x.note}</p>}
      {x.matches.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 rounded-lg bg-warning/10 px-2 py-2 text-xs">
          <p className="font-semibold text-warning">It may already be listed:</p>
          {x.matches.map((m) => (
            <p key={m.slug} className="flex flex-wrap items-center gap-2">
              <Link href={`/schools/${m.slug}`} target="_blank" className="font-semibold text-foreground hover:underline">{m.name}</Link>
              <span className="text-muted-foreground">{MATCH_WHY[m.why]}{m.status !== 'active' ? ` · ${m.status}` : ''}</span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => run({ action: 'suggestion_duplicate', suggestionId: x.id, schoolSlug: m.slug }, 'Marked as already listed')}>It is this one</Button>
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} />
        <Select items={Object.fromEntries(KINDS.map((k) => [k, k]))} value={kind} onValueChange={(v) => typeof v === 'string' && setKind(v)}>
          <SelectTrigger aria-label="Kind" className="w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
        </Select>
        <Input aria-label="Website" placeholder="https://…" value={website} onChange={(e) => setWebsite(e.target.value.slice(0, 300))} />
        <Input aria-label="Areas" placeholder="District 1, District 7" value={districts} onChange={(e) => setDistricts(e.target.value.slice(0, 600))} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="cta" size="sm" disabled={busy || name.trim().length < 2}
          onClick={() => run({ action: 'suggestion_add', suggestionId: x.id, name: name.trim(), kind, website: website.trim() || null, districts: areas }, 'School added')}>Add school</Button>
        <Input aria-label="Slug of the listed school" placeholder="already listed as… (slug)" value={dupSlug} onChange={(e) => setDupSlug(e.target.value.slice(0, 80))} className="w-56" />
        <Button variant="outline" size="sm" disabled={busy || !dupSlug.trim()} onClick={() => run({ action: 'suggestion_duplicate', suggestionId: x.id, schoolSlug: dupSlug.trim() }, 'Marked as already listed')}>Already listed</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setRejecting((v) => !v)}>Reject…</Button>
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="Reason the teacher will see (e.g. not in Ho Chi Minh City; not a school)" />
          <Button variant="destructive" size="sm" className="self-start" disabled={busy || reason.trim().length < 3}
            onClick={() => run({ action: 'suggestion_reject', suggestionId: x.id, reason: reason.trim() }, 'Rejected')}>Reject with this reason</Button>
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
  const [revokeReason, setRevokeReason] = React.useState('')
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
            {/* A verified proof that turns out false (a borrowed LinkedIn profile): taking it back unpublishes the
                review it backs, and that profile can never prove employment again. */}
            {rep.review.proof?.revocable && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Textarea rows={1} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value.slice(0, 500))} placeholder="Why the proof of employment is revoked (the writer sees it)" />
                <Button variant="destructive" size="sm" disabled={busy || revokeReason.trim().length < 3}
                  onClick={() => run({ action: 'proof_revoke', proofId: rep.review!.proof!.id, reason: revokeReason.trim() }, 'Proof revoked; review unpublished')}>Revoke proof and unpublish</Button>
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
