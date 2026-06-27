'use client'

import { useState } from 'react'
import { MessageSquareText, Wrench, CheckCircle2, RotateCcw, Mail, ExternalLink } from 'lucide-react'

export type FeedbackItem = {
  id: string
  kind: string
  message: string
  email: string | null
  url: string | null
  status: string
  createdAt: string
}

const fmt = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function FeedbackClient({ items: initial }: { items: FeedbackItem[] }) {
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<'open' | 'all'>('open')

  const toggle = async (it: FeedbackItem) => {
    const next = it.status === 'resolved' ? 'open' : 'resolved'
    setBusy(it.id)
    setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: next } : x)))
    try {
      await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, status: next }),
      })
    } catch {
      setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: it.status } : x)))
    } finally {
      setBusy(null)
    }
  }

  const shown = filter === 'open' ? items.filter((i) => i.status !== 'resolved') : items
  const openCount = items.filter((i) => i.status !== 'resolved').length

  return (
    <div>
      <div className="mb-4 flex items-center gap-1">
        {(['open', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              'rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer ' +
              (filter === f ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted')
            }
          >
            {f === 'open' ? `Open (${openCount})` : `All (${items.length})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong py-14 text-center text-sm text-muted-foreground">
          {filter === 'open' ? 'No open feedback — all caught up.' : 'No feedback yet.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((it) => {
            const technical = it.kind === 'technical'
            const resolved = it.status === 'resolved'
            return (
              <li key={it.id} className={'rounded-2xl bg-card p-4 shadow-xs ' + (resolved ? 'opacity-60' : '')}>
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ' +
                      (technical ? 'bg-amber-100 text-amber-800' : 'bg-[#e8f1fb] text-[#0a66c2]')
                    }
                  >
                    {technical ? <Wrench className="h-3.5 w-3.5" /> : <MessageSquareText className="h-3.5 w-3.5" />}
                    {technical ? 'Technical' : 'Feedback'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmt(it.createdAt)}</span>
                </div>

                <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{it.message}</p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                  {it.email && (
                    <a href={`mailto:${it.email}`} className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
                      <Mail className="h-3.5 w-3.5" /> {it.email}
                    </a>
                  )}
                  {it.url && (
                    <a href={it.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> {it.url}
                    </a>
                  )}
                  <button
                    onClick={() => toggle(it)}
                    disabled={busy === it.id}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 cursor-pointer"
                  >
                    {resolved ? <><RotateCcw className="h-3.5 w-3.5" /> Reopen</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</>}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
