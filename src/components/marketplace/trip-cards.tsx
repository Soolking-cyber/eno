'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Check, Loader2, MapPinned, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

// ── TRIP ASSISTANCE CARDS, RENDERED INSIDE THE CHAT THREAD ─────────────────────────
//
// Two cards, and the asymmetry between them is the whole design (see TripQuoteMeta /
// TripStatusMeta in src/lib/messages.ts):
//
//   · TripQuoteCard is a LIVE HANDLE. Its message row carries a requestId and nothing else, so
//     the amounts are fetched here on every render. An operator who re-quotes never leaves a
//     contradicting number sitting in the traveller's timeline, and the accept/decline buttons
//     disappear on their own once the case is no longer `quoted` — including when it moved in
//     another tab, because the state is re-read rather than remembered.
//   · TripStatusCard is a HISTORICAL FACT. Its status was proven true at write time (the card
//     write re-asserts it against the case row), so it renders from meta and never re-reads.
//     Re-reading it would rewrite the past: a card posted on Tuesday would start claiming
//     today's status.
//
// ⚠️ NOTHING HERE IS AN AUTHORITY. The buttons call the API and re-read; every gate that matters
// (ownership, admin-ness, the legal transition) is enforced server-side, and `mine` comes from
// the server rather than being inferred from the viewer, so an operator is never shown an accept
// button that would accept on the traveller's behalf.

type AssistanceView = {
  requestId: string
  status: string
  supplierTotalVnd: number | null
  feeVnd: number | null
  quotedAt: string | null
  mine: boolean
}

/** Statuses the traveller can still act on from the card. */
const ACTIONABLE = 'quoted'

export function TripQuoteCard({ requestId }: { requestId: string }) {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  const [view, setView] = useState<AssistanceView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/assistance/${encodeURIComponent(requestId)}`, { cache: 'no-store' })
      setView(res.ok ? await res.json() : null)
    } catch {
      // A card that cannot read its case renders as unavailable rather than as a broken bubble.
      setView(null)
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => { void load() }, [load])

  const act = async (action: 'accept' | 'decline') => {
    if (busy) return
    setBusy(true)
    try {
      await fetch(`/api/trips/assistance/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      // Re-read rather than trust the response: the server is the only thing that knows what the
      // case ended up as, and a 409 (someone else moved it) must show the REAL state, not ours.
      // ⚠️ This makes the card correct AT THE MOMENT OF ACTING, not permanently. There is no
      // polling or subscription, so a case moved by an operator seconds later is not reflected
      // until the next render — the accept POST would then 409 and the re-read would correct it.
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-[22rem] rounded-2xl border border-line bg-surface-1 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>
    )
  }

  if (!view || view.supplierTotalVnd === null || view.feeVnd === null) {
    return (
      <div className="w-full max-w-[22rem] rounded-2xl border border-line bg-surface-1 p-4 text-sm text-ink-4">
        {tr('This quote is no longer available.', 'Báo giá này không còn khả dụng.')}
      </div>
    )
  }

  const total = view.supplierTotalVnd + view.feeVnd
  const live = view.mine && view.status === ACTIONABLE

  return (
    <div className="w-full max-w-[22rem] rounded-2xl border border-line bg-surface-1 p-4">
      <div className="flex items-center gap-2">
        <MapPinned className="size-4 text-accent-foreground" aria-hidden />
        <span className="text-sm font-semibold text-ink-1">{tr('Trip quote', 'Báo giá chuyến đi')}</span>
      </div>

      <dl className="mt-3 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-ink-3">{tr('Suppliers', 'Nhà cung cấp')}</dt>
          <dd className="text-sm tabular-nums text-ink-2">{formatMoneyFull(view.supplierTotalVnd, '₫', locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-ink-3">{tr('Our fee', 'Phí dịch vụ')}</dt>
          <dd className="text-sm tabular-nums text-ink-2">{formatMoneyFull(view.feeVnd, '₫', locale)}</dd>
        </div>
        <Separator className="my-2" />
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm font-semibold text-ink-1">{tr('Total', 'Tổng cộng')}</dt>
          <dd className="text-base font-bold tabular-nums text-ink-1">{formatMoneyFull(total, '₫', locale)}</dd>
        </div>
      </dl>

      {/* ⚠️ Says what eno does and does NOT do with this money. The traveller pays suppliers
          directly — no amount here is ever charged — and stating it on the card is the honest
          place, not a help page they would have to go looking for. */}
      <p className="mt-3 text-xs text-ink-4">
        {tr(
          'You pay suppliers directly. Nothing is charged here.',
          'Bạn thanh toán trực tiếp cho nhà cung cấp. Không có khoản nào bị trừ ở đây.',
        )}
      </p>

      {live ? (
        <div className="mt-4 flex gap-2">
          <Button variant="cta" className="flex-1" disabled={busy} onClick={() => void act('accept')}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            {tr('Accept', 'Chấp nhận')}
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void act('decline')}>
            <X className="size-4" aria-hidden />
            {tr('Decline', 'Từ chối')}
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <TripStatusBadge status={view.status} />
        </div>
      )}
    </div>
  )
}

/** The announcement card. Renders from its own meta — see the note at the top of this file. */
export function TripStatusCard({ status }: { status: string }) {
  const { tr } = useLanguage()
  return (
    <div className="flex w-full max-w-[22rem] items-center gap-2 rounded-2xl border border-line bg-surface-1 px-4 py-3">
      <CalendarCheck className="size-4 shrink-0 text-accent-foreground" aria-hidden />
      <span className="text-sm text-ink-2">{tr('Trip assistance', 'Hỗ trợ chuyến đi')}</span>
      <span className="ml-auto"><TripStatusBadge status={status} /></span>
    </div>
  )
}

function TripStatusBadge({ status }: { status: string }) {
  const { tr } = useLanguage()
  // One row per status of the machine. An unknown status renders its raw name rather than
  // nothing, so a card from a newer build degrades to something legible instead of a blank chip.
  const label: Record<string, string> = {
    requested: tr('Requested', 'Đã gửi yêu cầu'),
    reviewing: tr('Being reviewed', 'Đang xem xét'),
    quoted: tr('Quote ready', 'Đã có báo giá'),
    accepted: tr('Accepted', 'Đã chấp nhận'),
    arranging: tr('Arranging', 'Đang sắp xếp'),
    completed: tr('Arranged', 'Đã hoàn tất'),
    declined: tr('Declined', 'Đã từ chối'),
    cancelled: tr('Cancelled', 'Đã huỷ'),
  }
  // Tones from the badge primitive's own vocabulary — no new variant invented for this card.
  const tone = status === 'completed' || status === 'accepted'
    ? 'success' as const
    : status === 'declined' || status === 'cancelled'
      ? 'neutral' as const
      : 'brand' as const
  return <Badge variant={tone}>{label[status] ?? status}</Badge>
}
