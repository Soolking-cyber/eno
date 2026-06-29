'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Check, X, Flag, Loader2, ExternalLink, EyeOff, MessageSquare, Send } from 'lucide-react'
import { formatMoneyFull } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// Who filed a report — surfaced so an admin can weigh it (a 135-trust reporter vs a
// serial false-reporter) and click through to the reporter's storefront.
export type Reporter = {
  id: string
  name: string
  email: string | null
  trustScore: number
  strikes: number
  sellerId: string | null
}

export type ModReport = {
  id: string
  reason: string
  detail: string | null
  severity: string | null
  createdAt: string
  reporter: Reporter | null
  conversationId: string | null // link to the reporter↔seller thread (chat report, or derived)
}

export type ModItem = {
  id: string
  title: string
  price: number
  currency: string
  priceUnit: string
  location: string
  category: string
  sellerName: string
  sellerPhone: string | null
  sellerProfileId: string | null // the seller's owner account (null for an unclaimed guest storefront)
  image: string | null
  createdAt: string
  reports: ModReport[]
}

export type AccountReport = ModReport & {
  targetName: string | null
  targetSellerId: string | null
  targetProfileId: string | null
}

type MsgTarget = { recipientId: string; label: string }

const REASON_LABEL: Record<string, string> = {
  scam: 'Scam',
  counterfeit: 'Counterfeit',
  sold: 'Already sold',
  'wrong-info': 'Wrong info',
  duplicate: 'Duplicate',
  offensive: 'Offensive / harassment',
  other: 'Other',
}

async function moderate(action: string, id: string) {
  const res = await fetch('/api/admin/moderate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
  })
  if (!res.ok) throw new Error(`${action} failed`)
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

// Admin → user message from a report (e.g. "warn the seller" / "ask the reporter for
// more detail"). Delivered to the recipient's notifications via /api/admin/message.
function AdminMessageButton({ target, listingId, conversationId }: { target: MsgTarget; listingId?: string | null; conversationId?: string | null }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setState('sending')
    try {
      const res = await fetch('/api/admin/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId: target.recipientId, text: t, listingId, conversationId }),
      })
      if (!res.ok) throw new Error()
      setState('sent'); setText('')
      setTimeout(() => { setOpen(false); setState('idle') }, 1400)
    } catch {
      setState('error')
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-card px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted cursor-pointer">
        <MessageSquare className="h-3 w-3" /> Message {target.label}
      </button>
    )
  }
  return (
    <div className="w-full rounded-lg border border-border bg-card p-2">
      <p className="mb-1 text-[10px] font-semibold text-muted-foreground">Message {target.label}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Write a message — it lands in their notifications…"
        className="w-full resize-none rounded-md border border-line-strong px-2 py-1.5 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <button onClick={send} disabled={state === 'sending' || !text.trim()} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10px] font-bold text-white hover:bg-brand-dark disabled:opacity-40 cursor-pointer">
          {state === 'sending' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {state === 'sent' ? 'Sent ✓' : 'Send'}
        </button>
        <button onClick={() => { setOpen(false); setText(''); setState('idle') }} className="rounded-md px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted cursor-pointer">Cancel</button>
        {state === 'error' && <span className="text-[10px] font-semibold text-red-600">Failed — try again.</span>}
      </div>
    </div>
  )
}

// One report, fully detailed: reason + severity + detail, WHO filed it (+ trust/strikes,
// linked to their storefront), a link to the conversation, and the resolve actions.
function ReportCard({ r, onAction, busy, messageTargets = [], listingId }: { r: ModReport; onAction: (action: string, id: string) => void; busy: boolean; messageTargets?: MsgTarget[]; listingId?: string | null }) {
  // De-dupe in case the reporter and the reported party resolve to the same account.
  const targets = messageTargets.filter((t, i, a) => t.recipientId && a.findIndex((x) => x.recipientId === t.recipientId) === i)
  return (
    <div className="space-y-1.5 rounded-lg bg-red-50 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5 text-[11px] text-red-800">
          <Flag className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <strong>{REASON_LABEL[r.reason] || r.reason}</strong>
            {r.severity ? <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold uppercase">{r.severity}</span> : null}
            {r.detail ? <span className="text-red-900"> — {r.detail}</span> : null}
          </span>
        </div>
        <span className="shrink-0 text-[10px] text-ink-4">{shortDate(r.createdAt)}</span>
      </div>

      {/* Reporter + conversation context */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-[11px] text-muted-foreground">
        {r.reporter ? (
          <span>
            By{' '}
            {r.reporter.sellerId ? (
              <a href={`/sellers/${r.reporter.sellerId}`} target="_blank" rel="noreferrer" className="font-semibold text-foreground hover:underline">{r.reporter.name}</a>
            ) : (
              <span className="font-semibold text-foreground">{r.reporter.name}</span>
            )}
            <span className="text-ink-4"> · trust {r.reporter.trustScore}</span>
            {r.reporter.strikes > 0 && <span className="font-semibold text-warning"> · {r.reporter.strikes} false-report strike{r.reporter.strikes > 1 ? 's' : ''}</span>}
          </span>
        ) : (
          <span className="italic">reporter account removed</span>
        )}
        {r.conversationId && (
          <a href={`/admin/conversation/${r.conversationId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
            <MessageSquare className="h-3 w-3" /> View conversation
          </a>
        )}
      </div>

      {/* Resolving a report is what moves trust: confirm docks the target's score;
          abusive penalizes the reporter (anti-fake). */}
      <div className="flex flex-wrap gap-1.5 pl-4">
        <button onClick={() => onAction('confirm-report', r.id)} disabled={busy} className="rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-red-700 disabled:opacity-40 cursor-pointer">Confirm (−trust)</button>
        <button onClick={() => onAction('dismiss-report', r.id)} disabled={busy} className="rounded-md border border-line-strong bg-card px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">Dismiss</button>
        <button onClick={() => onAction('abusive-report', r.id)} disabled={busy} className="rounded-md border border-warning/40 bg-card px-2 py-0.5 text-[10px] font-bold text-warning hover:bg-warning/10 disabled:opacity-40 cursor-pointer">Abusive (penalize reporter)</button>
      </div>

      {/* Reach out to either party (seller and/or buyer/reporter) about this report. */}
      {targets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-4 pt-0.5">
          {targets.map((t) => (
            <AdminMessageButton key={t.recipientId} target={t} listingId={listingId} conversationId={r.conversationId} />
          ))}
        </div>
      )}
    </div>
  )
}

function ListingRow({ item, mode }: { item: ModItem; mode: 'pending' | 'reported' }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const run = async (action: string, id: string) => {
    setBusy(action); setError('')
    try {
      await moderate(action, id)
      router.refresh()
    } catch {
      setError('Action failed — try again.')
      setBusy(null)
    }
  }

  return (
    <div className="flex gap-4 rounded-2xl bg-card p-4 shadow-pop">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-tint">
        {item.image ? (
          <Image src={item.image} alt={item.title} fill sizes="96px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-ink-4">No image</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <a href={`/listings/${item.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-sm font-bold text-foreground hover:text-accent-foreground">
              <span className="truncate">{item.title}</span>
              <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
            </a>
            <p className="mt-0.5 text-sm font-semibold text-accent-foreground">{formatMoneyFull(item.price, item.currency)}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.category} · {item.location}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.sellerName}{item.sellerPhone ? ` · ${item.sellerPhone}` : ''}</p>
          </div>
          <span className="shrink-0 text-[11px] text-ink-4">{shortDate(item.createdAt)}</span>
        </div>

        {item.reports.length > 0 && (
          <div className="mt-2 space-y-2">
            {item.reports.map((r) => (
              <ReportCard
                key={r.id}
                r={r}
                onAction={run}
                busy={!!busy}
                listingId={item.id}
                messageTargets={[
                  r.reporter ? { recipientId: r.reporter.id, label: `reporter (${r.reporter.name})` } : null,
                  item.sellerProfileId ? { recipientId: item.sellerProfileId, label: `seller (${item.sellerName})` } : null,
                ].filter((x): x is MsgTarget => x !== null)}
              />
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="cta" size="none"
            onClick={() => run('approve', item.id)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs disabled:opacity-40 transition-colors cursor-pointer"
          >
            {busy === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {mode === 'reported' ? 'Keep & clear reports' : 'Approve & publish'}
          </Button>

          {mode === 'reported' && (
            <button
              onClick={() => run('unpublish', item.id)}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-card px-4 py-1.5 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-40 transition-colors cursor-pointer"
            >
              {busy === 'unpublish' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
              Unpublish
            </button>
          )}

          <button
            onClick={() => run('reject', item.id)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-card px-4 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors cursor-pointer"
          >
            {busy === 'reject' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Delete
          </button>

          {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  )
}

function AccountReportRow({ r }: { r: AccountReport }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (action: string, id: string) => {
    setBusy(true); setError('')
    try { await moderate(action, id); router.refresh() } catch { setError('Action failed — try again.'); setBusy(false) }
  }

  return (
    <div className="rounded-2xl bg-card p-4 shadow-pop">
      <p className="mb-2 truncate text-sm font-bold text-foreground">
        {r.targetSellerId ? (
          <a href={`/sellers/${r.targetSellerId}`} target="_blank" rel="noreferrer" className="hover:underline">{r.targetName || r.targetSellerId}</a>
        ) : (
          r.targetName || 'Reported account / conversation'
        )}
      </p>
      <ReportCard
        r={r}
        onAction={run}
        busy={busy}
        messageTargets={[
          r.reporter ? { recipientId: r.reporter.id, label: `reporter (${r.reporter.name})` } : null,
          r.targetProfileId ? { recipientId: r.targetProfileId, label: `reported user${r.targetName ? ` (${r.targetName})` : ''}` } : null,
        ].filter((x): x is MsgTarget => x !== null)}
      />
      {error && <span className="mt-1 block text-xs font-semibold text-red-600">{error}</span>}
    </div>
  )
}

export function ModerationClient({ pending, reported, accountReports }: { pending: ModItem[]; reported: ModItem[]; accountReports: AccountReport[] }) {
  const [tab, setTab] = useState<'pending' | 'reported' | 'accounts'>(reported.length === 0 && accountReports.length > 0 ? 'accounts' : 'reported')

  return (
    <div>
      <div className="mb-5 flex w-fit rounded-full bg-tint p-1 text-sm font-semibold">
        {([['reported', `Reported listings (${reported.length})`], ['accounts', `Reported accounts & chats (${accountReports.length})`], ['pending', `Held (${pending.length})`]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn('rounded-full px-4 py-1.5 transition-colors cursor-pointer', tab === k ? 'bg-card text-accent-foreground shadow-sm' : 'text-muted-foreground')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'accounts' ? (
        accountReports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">No open account or chat reports.</div>
        ) : (
          <div className="space-y-3">{accountReports.map((r) => <AccountReportRow key={r.id} r={r} />)}</div>
        )
      ) : (() => {
        const list = tab === 'pending' ? pending : reported
        return list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">
            {tab === 'pending' ? 'Nothing held. 🎉' : 'No reported listings.'}
          </div>
        ) : (
          <div className="space-y-3">
            {list.map((item) => <ListingRow key={item.id} item={item} mode={tab} />)}
          </div>
        )
      })()}
    </div>
  )
}
