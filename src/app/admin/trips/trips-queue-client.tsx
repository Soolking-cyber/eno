'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink, Loader2, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoneyFull } from '@/lib/vnd'

// Admin chrome is EN-only by convention — no tr() anywhere in this file.

export type QueueRow = {
  id: string
  status: string
  /**
   * The legal next statuses, DERIVED SERVER-SIDE from TRIP_TRANSITIONS and handed down.
   *
   * ⚠️ NOT imported here, and the build is what taught me why: src/lib/trips/status.ts imports the
   * Prisma client, so a client component reaching for nextTripStatuses() dragged db -> @prisma/
   * adapter-pg -> pg -> node:fs into the browser bundle and the build failed outright. tsc and lint
   * both passed; only `npm run build` caught it.
   *
   * Passing the derived list keeps the property that matters — the machine still decides, and this
   * file still restates nothing — while the derivation happens where the machine actually lives.
   */
  moves: string[]
  itineraryTitle: string
  travellerName: string
  conversationId: string | null
  supplierTotalVnd: number | null
  feeVnd: number | null
  assignedAdmin: string | null
  updatedAt: string
}

/**
 * Human labels for the machine's statuses. PRESENTATION ONLY — the EDGES are never listed here.
 *
 * ⚠️ THE BUTTONS COME FROM nextTripStatuses(), NOT FROM A TABLE. The visa queue keeps a separate
 * VISA_ADMIN_ACTIONS map of per-status action pairs, bound to its state machine by nothing but a
 * comment saying they must agree — which is exactly how an admin UI and its machine drift apart.
 * Here a status the machine can reach is a button, automatically, and a status it cannot reach has
 * no button that could be clicked. Adding a transition to TRIP_TRANSITIONS makes it operable with
 * no change to this file; an unlabelled one falls back to its raw name rather than vanishing.
 */
const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested',
  reviewing: 'Reviewing',
  quoted: 'Quoted',
  accepted: 'Accepted',
  arranging: 'Arranging',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

const STATUS_TONE: Record<string, 'brand' | 'success' | 'neutral' | 'warning'> = {
  requested: 'warning',
  reviewing: 'brand',
  quoted: 'brand',
  accepted: 'success',
  arranging: 'brand',
  completed: 'success',
  declined: 'neutral',
  cancelled: 'neutral',
}

const label = (status: string) => STATUS_LABEL[status] ?? status

export function TripsQueueClient({ rows }: { rows: QueueRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const move = async (id: string, next: string) => {
    if (busyId) return
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/trips/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; from?: string }
        // 409 means somebody else moved this case first — the compare-and-set doing its job. Say
        // that plainly rather than "something went wrong", because the operator's next move is to
        // reload, not to retry.
        setError(res.status === 409
          ? `Case already moved${body.from ? ` (now ${label(body.from)})` : ''} — reloading.`
          : body.error ?? 'Could not move this case.')
      }
      // Refresh either way: on success to show the new status, on conflict to show the real one.
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  if (!rows.length) {
    return (
      <Card className="px-5 py-6">
        <p className="text-sm text-muted-foreground">
          No assistance cases yet. A case appears here the moment a traveller asks for help on a saved trip.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <Card className="border-destructive/40 px-4 py-3">
          <p role="alert" className="text-sm text-destructive">{error}</p>
        </Card>
      )}
      {rows.map((row) => {
        const moves = row.moves
        const quoted = row.supplierTotalVnd !== null && row.feeVnd !== null
        return (
          <Card key={row.id} className="px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_TONE[row.status] ?? 'neutral'}>{label(row.status)}</Badge>
                  <p className="truncate text-sm font-semibold text-foreground">{row.itineraryTitle}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.travellerName} · updated {new Date(row.updatedAt).toLocaleString('en-GB')}
                  {row.assignedAdmin ? ` · ${row.assignedAdmin}` : ''}
                </p>
                {/* The quote is READ here and never written — quoteAssistance in chat is the only
                    writer of these two columns, and this queue is deliberately not a pricing UI. */}
                {quoted && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Suppliers {formatMoneyFull(row.supplierTotalVnd!, '₫', 'en')} · fee {formatMoneyFull(row.feeVnd!, '₫', 'en')}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {row.conversationId ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/messages/${row.conversationId}`}>
                      <MessageSquare className="h-3.5 w-3.5" />
                      Thread
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </Button>
                ) : (
                  // A case with no thread cannot be worked in chat, and that is worth SAYING —
                  // it means the binding never happened, not that the operator missed a link.
                  <span className="text-xs text-muted-foreground">No thread bound</span>
                )}
                {moves.map((next) => (
                  <Button
                    key={next}
                    variant={next === 'cancelled' || next === 'declined' ? 'outline' : 'default'}
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => void move(row.id, next)}
                  >
                    {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {label(next)}
                  </Button>
                ))}
                {/* A terminal status has no exits in the map, so it gets no buttons at all — the
                    machine says so rather than this file deciding it. */}
                {!moves.length && <span className="text-xs text-muted-foreground">Closed</span>}
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
