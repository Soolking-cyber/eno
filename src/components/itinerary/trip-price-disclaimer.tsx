'use client'

import { Info } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * What every price in a saved trip actually is (owner, 2026-07-30).
 *
 * ⚠️ ONE COPY, RENDERED IN BOTH PLACES. The saved-trip list and the trip page both show money, and
 * a disclaimer that says two slightly different things on two screens is worse than none — the
 * reader learns the terms are approximate in more than one sense. The dual-currency rule had to be
 * pulled back into one place for exactly this reason after I wrote it three times; this starts
 * shared.
 *
 * ⚠️ IT MAKES FOUR CLAIMS AND EACH ONE IS LOAD-BEARING, so do not trim it for layout:
 *   · the figures are ESTIMATES, not quotes;
 *   · they are an AVERAGE ACROSS THE YEAR — which is why an August price can look wrong in March;
 *   · we cannot promise an exact figure, stated plainly rather than implied by "≈";
 *   · anything actually booked is confirmed with an INVOICE, so the traveller knows where a real
 *     number will come from.
 * The last one is the reason this is not just a hedge: it names the artefact that replaces the
 * estimate, which is what makes the first three fair rather than evasive.
 */
export function TripPriceDisclaimer({ className }: { className?: string }) {
  const { tr } = useLanguage()
  return (
    <p className={cn('flex items-start gap-2 rounded-xl bg-tint px-3 py-2.5 text-2xs leading-relaxed text-body', className)}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
      <span>
        {tr(
          'Prices shown are estimates — an average across the year. Real costs move with the season, so we cannot promise an exact figure. Anything we book for you is confirmed with an invoice as proof.',
          'Giá hiển thị là ước tính — mức trung bình cả năm. Chi phí thực tế thay đổi theo mùa, nên chúng tôi không thể cam kết con số chính xác. Mọi khoản chúng tôi đặt giúp bạn đều được xác nhận bằng hóa đơn.',
        )}
      </span>
    </p>
  )
}
