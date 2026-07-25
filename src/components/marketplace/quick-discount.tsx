'use client'

import { useId, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TrendingDown, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldControl, FieldError } from '@/components/ui/field'
import { EnoSlider } from './eno-slider'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, parseVnd, groupVnd, dropPercent, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// Discount % model shared by the single-listing dialog + the bulk-discount bar.
export const DISCOUNT_PRESETS = [10, 20, 30] as const
// ≥20% off the current price is the floor that most reliably clears the drop-badge
// gate (see price-drop rules) — surfaced as a gentle hint, not a hard rule.
export const BADGE_HINT_PCT = 20

const clampPct = (p: number) => Math.max(1, Math.min(99, Math.round(p)))
// Round a raw discounted price to a tidy VND figure so it never reads 3,599,910 ₫.
export function tidyPrice(raw: number): number {
  const step = raw >= 1_000_000 ? 100_000 : raw >= 100_000 ? 10_000 : 1_000
  return Math.max(1000, Math.round(raw / step) * step)
}

/** The 1–99% discount picker: a big live %, a slider, and the quick presets.
 *  Shared so the single + bulk discount dialogs feel identical.
 *
 *  ⚠️ The picker and the exact-VND field are TWO CONTROLS BOUND TO ONE VALUE, so they
 *  share one validity. The slider is not a labelable control (no <Field> around it),
 *  so the association is done by hand: the group carries the LABEL and the
 *  `aria-describedby` pointed at the SAME error node the VND field describes itself
 *  with, while the validity state rides on the SLIDER.
 *
 *  ⚠️ aria-invalid must NOT go on the `role="group"` div. ARIA 1.2 does not list
 *  aria-invalid as a supported property of `group`, so assistive tech simply DROPS it —
 *  the flag would read as correct in the source and reach nobody. It is supported on
 *  `slider`, which is what EnoSlider renders. Same trap as the rest of this sweep: a
 *  control that looks like it reports its state and doesn't. */
export function PercentPicker({ pct, onPct, invalid, describedBy }: {
  pct: number
  onPct: (p: number) => void
  invalid?: boolean
  describedBy?: string
}) {
  const { tr } = useLanguage()
  return (
    <div
      className="space-y-3"
      role="group"
      aria-label={tr('Discount percent', 'Phần trăm giảm')}
      aria-describedby={invalid ? describedBy : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{tr('Discount', 'Mức giảm')}</span>
        <span className="text-lg font-bold tabular-nums text-destructive">−{pct}%</span>
      </div>
      <EnoSlider value={pct} min={1} max={99} step={1} onChange={(v) => onPct(clampPct(v))} aria-invalid={invalid || undefined} aria-label={tr('Discount percent', 'Phần trăm giảm')} />
      <div className="grid grid-cols-3 gap-2">
        {DISCOUNT_PRESETS.map((p) => (
          <Button
            key={p}
            type="button"
            variant="bare"
            size="none"
            onClick={() => onPct(p)}
            className={cn(
              'rounded-xl border py-1.5 text-sm font-bold transition-colors cursor-pointer',
              pct === p ? 'border-brand bg-accent text-accent-foreground' : 'border-border text-foreground hover:bg-muted',
            )}
          >
            −{p}%
          </Button>
        ))}
      </div>
    </div>
  )
}

// The obvious "make a discount" affordance on the seller's own listing (the price
// cut used to be buried inside full Edit). Sends ONLY { price } through the same
// PATCH → updateListingCore path, so a qualifying cut auto-earns the buyer-facing
// price-drop badge (server-computed against the 30-day reference — no seller "was"
// price is ever entered). The slider gives any 1–99% cut; the VND field stays in
// sync for exact figures. Lives as a chip in the dashboard row + grid card.
export function QuickDiscount({
  listing,
  onChanged,
  className,
}: {
  listing: { id: string; price: number; currency: string }
  onChanged: () => void
  className?: string
}) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang) // amounts + live grouping follow the viewer's language
  const errId = useId()
  const [open, setOpen] = useState(false)
  const [pct, setPctState] = useState(10)
  const [amount, setAmount] = useState('') // grouped new-price string, e.g. "3,600,000"
  const [saving, setSaving] = useState(false)

  const cur = listing.price

  // % → price (tidy-rounded). Slider + presets drive this.
  const setPct = (p: number) => {
    const c = clampPct(p)
    setPctState(c)
    setAmount(groupVnd(String(tidyPrice(cur * (1 - c / 100))), locale))
  }
  // Typed price → %. Keeps the exact typed figure; the slider follows.
  const onAmount = (raw: string) => {
    setAmount(groupVnd(raw, locale))
    const np = parseVnd(raw)
    if (np > 0 && np < cur) setPctState(clampPct((1 - np / cur) * 100))
  }

  const newPrice = parseVnd(amount)
  const valid = newPrice > 0 && newPrice < cur
  const showErr = !!amount && !valid
  const pctLabel = valid ? dropPercent(cur, newPrice) : null
  const willEarnBadge = valid && newPrice <= cur * (1 - BADGE_HINT_PCT / 100)

  const openDialog = () => { setOpen(true); setPct(pct) }
  const reset = () => { setPctState(10); setAmount('') }

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
      reset()
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
      <Button
        variant="bare"
        size="none"
        type="button"
        onClick={openDialog}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning transition-colors hover:bg-warning/15',
          className,
        )}
      >
        <TrendingDown className="h-3 w-3" /> {tr('Discount', 'Giảm giá')}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-bold text-foreground">
              {tr('Lower the price', 'Giảm giá')}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">{tr('Current price', 'Giá hiện tại')}</p>
              <p className="text-sm font-semibold text-foreground">{formatMoneyFull(cur, listing.currency, locale)}</p>
            </div>

            <PercentPicker pct={pct} onPct={setPct} invalid={showErr} describedBy={errId} />

            {/* Exact new price (kept in sync with the slider).
                The WRAPPER owns the box + the focus-within ring, so the control stays
                variant="unstyled" and <Field> adds no second ring — it only wires the
                label, aria-invalid and aria-describedby. */}
            <Field invalid={showErr} className="gap-0">
              <FieldLabel className="text-xs font-semibold text-muted-foreground">{tr('New price', 'Giá mới')}</FieldLabel>
              <div className="mt-1 flex items-center gap-2 rounded-xl bg-tint px-3 py-2 focus-within:ring-2 focus-within:ring-brand/20">
                <FieldControl
                  render={
                    <Input
                      variant="unstyled"
                      inputMode="numeric"
                      placeholder="0"
                      className="min-w-0 flex-1 text-sm font-semibold tabular-nums"
                    />
                  }
                  value={amount}
                  onChange={(e) => onAmount(e.target.value)}
                />
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">VND</span>
              </div>
              {/* role="alert" as well as being the field's description: a validation
                  message that appears while typing is otherwise announced to nobody. */}
              {showErr && (
                <FieldError id={errId} role="alert" className="mt-4 text-center font-semibold">
                  {tr('Enter a price lower than the current one.', 'Nhập giá thấp hơn giá hiện tại.')}
                </FieldError>
              )}
            </Field>

            {/* Live preview: the drop % + whether it clears the buyer-badge floor. */}
            {valid && (
              <div className="rounded-xl bg-accent p-3 text-center">
                <p className="text-sm font-bold text-accent-foreground tabular-nums">
                  {formatMoneyFull(newPrice, listing.currency, locale)} <span className="text-destructive">{pctLabel}</span>
                </p>
                {willEarnBadge ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-2xs font-semibold text-accent-foreground">
                    <Sparkles className="h-3 w-3" /> {tr('Buyers see a discount badge on this', 'Người mua sẽ thấy nhãn giảm giá')}
                  </p>
                ) : (
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {tr('Cut ≥20% to show buyers a discount badge', 'Giảm ≥20% để hiển thị nhãn giảm giá cho người mua')}
                  </p>
                )}
              </div>
            )}

            <Button
              variant="cta"
              size="none"
              type="button"
              onClick={apply}
              disabled={!valid || saving}
              className="w-full py-2.5 disabled:opacity-40 cursor-pointer"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Apply discount', 'Áp dụng')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
