'use client'

import { useState } from 'react'
import { MessageSquareText, Wrench, CheckCircle2, RotateCcw, Mail, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from 'sonner'

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
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, status: next }),
      })
      // fetch resolves on 4xx/5xx (audit P2): an expired session or server error left
      // the optimistic flip on screen while the row never changed server-side.
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, status: it.status } : x)))
      toast.error('Could not update — status restored.')
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
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'ghost'}
            className={filter === f ? 'font-semibold' : 'font-semibold text-body'}
            onClick={() => setFilter(f)}
          >
            {f === 'open' ? `Open (${openCount})` : `All (${items.length})`}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title={filter === 'open' ? 'No open feedback — all caught up.' : 'No feedback yet.'}
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((it) => {
            const technical = it.kind === 'technical'
            const resolved = it.status === 'resolved'
            return (
              <li key={it.id}>
                <Card className={resolved ? 'opacity-60' : undefined}>
                  <CardContent>
                    <div className="flex items-start justify-between gap-3">
                      <Badge variant={technical ? 'warning' : 'brand'} size="md" className="gap-1.5">
                        {technical ? <Wrench className="h-3.5 w-3.5" /> : <MessageSquareText className="h-3.5 w-3.5" />}
                        {technical ? 'Technical' : 'Feedback'}
                      </Badge>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggle(it)}
                        disabled={busy === it.id}
                        className="ml-auto gap-1.5 text-xs font-semibold text-foreground"
                      >
                        {resolved ? <><RotateCcw className="size-4" /> Reopen</> : <><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</>}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
