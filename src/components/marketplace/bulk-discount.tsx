'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Sparkles } from 'lucide-react'
import { PercentPicker, tidyPrice, BADGE_HINT_PCT } from './quick-discount'
import { useLanguage } from '@/context/language-context'
import { DROP } from '@/lib/price-drop-rules'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Item = { id: string; price: number; currency: string }

// Apply ONE percentage cut across many listings at once. Percentage (not a fixed
// VND figure) because the selected items have different prices. Each listing goes
// through the same PATCH → updateListingCore path as the single-listing dialog, so
// a qualifying cut auto-earns the price-drop badge per item. Fired in small
// concurrent batches so a big selection doesn't open 100 sockets at once.
export function BulkDiscount({
  open,
  onOpenChange,
  listings,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  listings: Item[]
  onDone: () => void
}) {
  const { tr } = useLanguage()
  const [pct, setPct] = useState(10)
  const [saving, setSaving] = useState(false)

  const n = listings.length
  // ⚠️ Same eligibility/promise distinction as quick-discount, and the inversion matters MORE
  // here: this applies one percentage across every selected listing, so a -90% sweep gave away
  // real margin on all of them for a badge none of them could earn.
  const tooDeep = pct > (1 - DROP.TYPO_FLOOR) * 100
  const willEarnBadge = pct >= BADGE_HINT_PCT && !tooDeep

  const apply = async () => {
    if (saving || n === 0) return
    setSaving(true)
    let ok = 0
    let failed = 0
    const queue = [...listings]
    // Cut each price by the chosen %, tidy-rounded; never below 1,000 ₫, and only
    // if it actually goes down (a rounding edge on a tiny price could no-op). A no-op is
    // SKIPPED (no counter bump) — counting it as `ok` made the toast over-report a discount
    // that was never PATCHed; a lower `ok` now reflects only the rows that actually changed.
    const run = async (item: Item) => {
      const next = tidyPrice(item.price * (1 - pct / 100))
      if (!(next < item.price)) { return }
      try {
        const res = await fetch(`/api/listings/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price: next }),
        })
        if (!res.ok) throw new Error('failed')
        ok++
      } catch {
        failed++
      }
    }
    // Bounded concurrency (6 at a time).
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift()
        if (item) await run(item)
      }
    })
    await Promise.all(workers)
    setSaving(false)
    onOpenChange(false)
    if (ok === 0 && failed === 0) toast.message(tr('No prices changed', 'Không có giá nào thay đổi'))
    else if (failed === 0) toast.success(tr(`Discounted ${ok} listings`, `Đã giảm giá ${ok} tin`))
    else toast.warning(tr(`Discounted ${ok}, ${failed} failed`, `Đã giảm ${ok}, lỗi ${failed}`))
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-bold text-foreground">
            {tr('Discount selected', 'Giảm giá đã chọn')}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <p className="text-center text-xs text-muted-foreground">
            {tr(`Applies to ${n} ${n === 1 ? 'listing' : 'listings'}`, `Áp dụng cho ${n} tin`)}
          </p>

          <PercentPicker pct={pct} onPct={setPct} />

          <div className="rounded-xl bg-accent p-3 text-center">
            <p className="text-sm font-bold text-accent-foreground tabular-nums">
              −{pct}% · {n} {tr(n === 1 ? 'listing' : 'listings', 'tin')}
            </p>
            {willEarnBadge ? (
              <p className="mt-1 inline-flex items-center gap-1 text-2xs font-semibold text-accent-foreground">
                <Sparkles className="h-3 w-3" /> {tr('Each may show buyers a discount badge', 'Mỗi tin có thể hiển thị nhãn giảm giá')}
              </p>
            ) : (
              <p className="mt-1 text-2xs text-muted-foreground">
                {tr('Cut ≥20% to show buyers a discount badge', 'Giảm ≥20% để hiển thị nhãn giảm giá')}
              </p>
            )}
          </div>

          <Button
            type="button"
            variant="cta"
            size="none"
            onClick={apply}
            disabled={saving || n === 0}
            className={cn('w-full py-2.5 disabled:opacity-40 cursor-pointer')}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Apply discount', 'Áp dụng')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
