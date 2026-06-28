'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Check, X, Flag, Loader2, ExternalLink, EyeOff } from 'lucide-react'
import { formatMoneyFull } from '@/lib/vnd'
import { cn } from '@/lib/utils'

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
  image: string | null
  createdAt: string
  reports: { id: string; reason: string; detail: string | null; createdAt: string }[]
}

export type AccountReport = {
  id: string
  reason: string
  detail: string | null
  createdAt: string
  targetName: string | null
  targetSellerId: string | null
}

const REASON_LABEL: Record<string, string> = {
  scam: 'Scam',
  counterfeit: 'Counterfeit',
  sold: 'Already sold',
  'wrong-info': 'Wrong info',
  duplicate: 'Duplicate',
  offensive: 'Offensive',
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
          <span className="shrink-0 text-[11px] text-ink-4">{new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </div>

        {item.reports.length > 0 && (
          <div className="mt-2 space-y-2 rounded-lg bg-red-50 p-2">
            {item.reports.map((r) => (
              <div key={r.id} className="space-y-1.5">
                <div className="flex items-start gap-1.5 text-[11px] text-red-800">
                  <Flag className="mt-0.5 h-3 w-3 shrink-0" />
                  <span><strong>{REASON_LABEL[r.reason] || r.reason}</strong>{r.detail ? ` — ${r.detail}` : ''}</span>
                </div>
                {/* Resolving a report is what moves trust: confirm docks the
                    target's score; abusive penalizes the reporter (anti-fake). */}
                <div className="flex flex-wrap gap-1.5 pl-4">
                  <button onClick={() => run('confirm-report', r.id)} disabled={!!busy} className="rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-red-700 disabled:opacity-40 cursor-pointer">Confirm (−trust)</button>
                  <button onClick={() => run('dismiss-report', r.id)} disabled={!!busy} className="rounded-md border border-line-strong bg-card px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">Dismiss</button>
                  <button onClick={() => run('abusive-report', r.id)} disabled={!!busy} className="rounded-md border border-warning/40 bg-card px-2 py-0.5 text-[10px] font-bold text-warning hover:bg-warning/10 disabled:opacity-40 cursor-pointer">Abusive (penalize reporter)</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => run('approve', item.id)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-40 transition-colors cursor-pointer"
          >
            {busy === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {mode === 'reported' ? 'Keep & clear reports' : 'Approve & publish'}
          </button>

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

  const run = async (action: string) => {
    setBusy(true); setError('')
    try { await moderate(action, r.id); router.refresh() } catch { setError('Action failed — try again.'); setBusy(false) }
  }

  return (
    <div className="rounded-2xl bg-card p-4 shadow-pop">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{r.targetName || r.targetSellerId || 'Unknown storefront'}</p>
          <div className="mt-1 flex items-start gap-1.5 text-[11px] text-red-800">
            <Flag className="mt-0.5 h-3 w-3 shrink-0" />
            <span><strong>{REASON_LABEL[r.reason] || r.reason}</strong>{r.detail ? ` — ${r.detail}` : ''}</span>
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-ink-4">{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button onClick={() => run('confirm-report')} disabled={busy} className="rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-red-700 disabled:opacity-40 cursor-pointer">Confirm (−trust)</button>
        <button onClick={() => run('dismiss-report')} disabled={busy} className="rounded-md border border-line-strong bg-card px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">Dismiss</button>
        <button onClick={() => run('abusive-report')} disabled={busy} className="rounded-md border border-warning/40 bg-card px-2 py-0.5 text-[10px] font-bold text-warning hover:bg-warning/10 disabled:opacity-40 cursor-pointer">Abusive (penalize reporter)</button>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {error && <span className="text-xs font-semibold text-red-600">{error}</span>}
      </div>
    </div>
  )
}

export function ModerationClient({ pending, reported, accountReports }: { pending: ModItem[]; reported: ModItem[]; accountReports: AccountReport[] }) {
  const [tab, setTab] = useState<'pending' | 'reported' | 'accounts'>('reported')

  return (
    <div>
      <div className="mb-5 flex w-fit rounded-full bg-tint p-1 text-sm font-semibold">
        {([['reported', `Reported listings (${reported.length})`], ['accounts', `Reported accounts (${accountReports.length})`], ['pending', `Held (${pending.length})`]] as const).map(([k, label]) => (
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
          <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">No open account reports.</div>
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
