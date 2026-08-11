'use client'

import Link from 'next/link'
import { SEAL_BAR, SEAL_CHIEF, SEAL_OUTLINE } from '@/components/marketplace/eno-seal'
import { STROKE_UI } from '@/lib/icon-tokens'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// Above-the-fold scam inoculation on the listing page — deposit-link fraud is the
// #1 marketplace scam, so the warning must be read BEFORE the buyer contacts the
// seller, not buried in the footer note. Copy is category-aware: vehicles get the
// papers/chassis check, property & rentals get the visit-before-deposit rule.
export function SafetyStrip({ categorySlug, action, protections, className }: { categorySlug: string; action?: React.ReactNode; /** The "ENO protects you" trigger, folded in as the quiet second line — see the note at its render. */ protections?: React.ReactNode; className?: string }) {
  const { tr } = useLanguage()

  const line =
    categorySlug === 'vehicles'
      ? tr(
          'Check the papers match the chassis before paying — and never pay a deposit through a link.',
          'Kiểm tra giấy tờ trùng số khung, số máy trước khi trả tiền — và đừng bao giờ đặt cọc qua đường link.',
        )
      : categorySlug === 'property' || categorySlug === 'rentals'
        ? tr(
            'Visit in person before paying any deposit — never wire money to hold a place.',
            'Đến xem tận nơi trước khi đặt cọc — đừng bao giờ chuyển khoản để giữ chỗ.',
          )
        : tr(
            'Never send a deposit through a link — eno.vn never asks for one. Meet, inspect, then pay.',
            'Đừng bao giờ chuyển tiền cọc qua đường link — eno.vn không bao giờ yêu cầu đặt cọc. Gặp trực tiếp, kiểm tra hàng rồi mới trả tiền.',
          )

  return (
    // ⚠️ THE LEFT RULE AND THE INK ARE THE POINT — this strip carries the one sentence that can
    // stop a buyer losing money on a marketplace where deposit-link fraud is THE loss mode, and
    // it was rendering as decoration. At `bg-warning/10` with neutral `text-foreground` it read
    // as a tinted note, and on the PDP it sits directly beneath the "ENO protects you" panel —
    // same rounded shape, same padding, near-identical value — so the informational box and the
    // scam warning formed one grey blob. A design review flagged it as having less visual weight
    // than the price.
    // `border-l-2 border-warning` is the smallest thing that restores hierarchy without breaking
    // the flat-canvas canon (§3b): it is an accent RULE, not a second box, and it distinguishes
    // this strip from every neutral panel around it at a glance. The line itself goes
    // `font-semibold text-warning` so the warning speaks in the warning's own voice.
    // ⚠️ `--warning` is amber-800 (#92400e) in light and amber-400 in dark, both chosen for
    // contrast as TEXT (see the token note in globals.css) — so this is safe as ink, which is
    // exactly why the token exists rather than a raw amber.
    <div className={cn('flex items-start gap-2.5 rounded-xl border-l-2 border-warning bg-warning/10 px-3 py-2.5 text-xs leading-relaxed', className)}>
      {/* The eno seal replaces lucide ShieldAlert in this first-party safety moment
          (§0b + foundation handoff request: seal-in-chip on the safety strip). On the
          warning tint the chief takes the strip's OWN ink — the trust-chip micro form
          (tinted chief + line + bar) — never brand blue over amber. Paths imported
          from eno-seal.tsx, never redrawn (§0b: a seal that drifts is a counterfeit). */}
      <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-warning">
        <path d={SEAL_CHIEF} fill="currentColor" fillOpacity={0.25} />
        <path
          d={SEAL_OUTLINE}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_UI}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d={SEAL_BAR} fill="none" stroke="currentColor" strokeWidth={STROKE_UI} strokeLinecap="round" />
      </svg>
      {/* ⚠️ THE RHYTHM CARRIES THE HIERARCHY. At `space-y-0.5` the three lines — warning,
          protections, actions — sat at the same distance from each other as the words within
          them, so the block read as a pile of links rather than one statement with a footnote.
          `space-y-1.5` separates them enough to be read in order, which is the whole reason
          they are stacked in this order in the first place. */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* `text-warning`, not `text-foreground` — see the note on the container. A warning
            printed in body ink is a sentence; printed in its own ink it is a warning. */}
        <p className="font-semibold text-warning">{line}</p>
        {/* ⚠️ "ENO protects you" MOVED IN HERE, and the ORDER is the whole design (owner,
            2026-08-11: combine these two). They were two adjacent blocks — a neutral
            protections panel at order-7 and this warning at order-9 — saying related things
            in two boxes. Merging them is right, but the direction matters: this strip carries
            the one sentence that can stop someone losing money, and a design review already
            found it reading as LESS weighty than the panel above it. So the warning keeps the
            container, the ink and the top line; protections becomes the quiet second line
            inside it, still tappable, still opening the same dialog.
            It also drops a duplicate seal — one mark per block, and this block already has it.
            The result is one thing that says "here is the risk, and here is what we do about
            it", which is the sentence the two boxes were circling separately. */}
        {protections}
        {/* Guide link left, Report right (user-picked 2026-07-14) — the old
            standalone tips|report footer was a duplicate of this same link. */}
        {/* Guide left, Report right (user-picked 2026-07-14). `-my-1` pulls the row back into
            the block: Report is a `tap-44` control, so its 44px hit area otherwise pushed a
            visible gap below the strip that looked like stray padding. */}
        <div className="-my-1 flex items-center justify-between gap-3">
          <Link href="/safety" className="font-semibold text-accent-foreground hover:underline">
            {tr('Safe trading guide', 'Cẩm nang giao dịch an toàn')}
          </Link>
          {action}
        </div>
      </div>
    </div>
  )
}
