'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TrendingDown, Loader2, Sparkles } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, parseVnd, groupVnd, dropPercent } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// The obvious "make a discount" affordance on the seller's own listing (the price
// cut used to be buried inside full Edit). Sends ONLY { price } through the same
// PATCH → updateListingCore path, so a qualifying cut auto-earns the buyer-facing
// price-drop badge (server-computed against the 30-day reference — no seller "was"
// price is ever entered). Presets round to a clean VND figure; a custom amount is
// always available. Lives as a chip in the dashboard row + grid card.
const PRESETS = [10, 20, 30] as const
// ≥20% off the current price is the floor that most reliably clears the drop-badge
// gate (see price-drop rules) — surfaced as a gentle hint, not a hard rule.
const BADGE_HINT_PCT = 20

export function QuickDiscount({
  listing,
  onChanged,
  className,
}: {
  listing: { id: string; price: number; currency: string }
  onChanged: () => void
  className?: string
}) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('') // grouped new-price string, e.g. "160,000"
  const [activePreset, setActivePreset] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const cur = listing.price
  const newPrice = parseVnd(amount)
  const valid = newPrice > 0 && newPrice < cur
  const pctLabel = valid ? dropPercent(cur, newPrice) : null
  const willEarnBadge = valid && newPrice <= cur * (1 - BADGE_HINT_PCT / 100)

  const applyPreset = (pct: number) => {
    const raw = cur * (1 - pct / 100)
    // Round to a tidy step so the price reads clean (no 179,910 ₫).
    const step = raw >= 1_000_000 ? 100_000 : raw >= 100_000 ? 10_000 : 1_000
    const rounded = Math.max(1000, Math.round(raw / step) * step)
    setAmount(groupVnd(String(rounded)))
    setActivePreset(pct)
  }

  const apply = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: newPrice }),
      })
      if (!res.ok) throw new Error('failed')
      toast.success(tr('Price lowered', 'Đã giảm giá'))
      setOpen(false)
      setAmount('')
      setActivePreset(null)
      onChanged()
    } catch {
      toast.error(tr('Could not update the price — try again.', 'Không cập nhật được giá — thử lại.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Distinct warm "deal" chip so the discount action is findable at a glance
          among the neutral row actions (user ask 2026-07-07). Amber, not the red
          drop-badge / report red, and not the blue primary CTA. */}
      <button
        type="button"
        onClick={() => { setOpen(true); if (!amount) applyPreset(10) }}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/40 cursor-pointer',
          className,
        )}
      >
        <TrendingDown className="h-3 w-3" /> {tr('Discount', 'Giảm giá')}
      </button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setAmount(''); setActivePreset(null) } }}>
        <DialogContent className="bg-card rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-bold text-foreground">
              {tr('Lower the price', 'Giảm giá')}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">{tr('Current price', 'Giá hiện tại')}</p>
              <p className="text-sm font-semibold text-foreground">{formatMoneyFull(cur, listing.currency)}</p>
            </div>

            {/* One-tap preset cuts. */}
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => applyPreset(pct)}
                  className={cn(
                    'rounded-xl border py-2 text-sm font-bold transition-colors cursor-pointer',
                    activePreset === pct ? 'border-brand bg-accent text-accent-foreground' : 'border-border text-foreground hover:bg-muted',
                  )}
                >
                  −{pct}%
                </button>
              ))}
            </div>

            {/* Or a custom new price. */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground">{tr('New price', 'Giá mới')}</label>
              <div className="mt-1 flex items-center gap-2 rounded-xl bg-tint px-3 py-2 focus-within:ring-2 focus-within:ring-brand/20">
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => { setAmount(groupVnd(e.target.value)); setActivePreset(null) }}
                  placeholder="0"
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold tabular-nums text-foreground outline-none"
                />
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">VND</span>
              </div>
            </div>

            {/* Live preview: the drop % + whether it clears the buyer-badge floor. */}
            {valid && (
              <div className="rounded-xl bg-accent p-3 text-center">
                <p className="text-sm font-bold text-accent-foreground tabular-nums">
                  {formatMoneyFull(newPrice, listing.currency)} <span className="text-destructive">{pctLabel}</span>
                </p>
                {willEarnBadge ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-accent-foreground">
                    <Sparkles className="h-3 w-3" /> {tr('Buyers see a discount badge on this', 'Người mua sẽ thấy nhãn giảm giá')}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {tr('Cut ≥20% to show buyers a discount badge', 'Giảm ≥20% để hiển thị nhãn giảm giá cho người mua')}
                  </p>
                )}
              </div>
            )}
            {amount && !valid && (
              <p className="text-center text-xs font-semibold text-destructive">
                {tr('Enter a price lower than the current one.', 'Nhập giá thấp hơn giá hiện tại.')}
              </p>
            )}

            <button
              type="button"
              onClick={apply}
              disabled={!valid || saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-40 cursor-pointer"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Apply discount', 'Áp dụng')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
