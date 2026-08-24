'use client'

import Link from 'next/link'
import { ShieldCheck } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// Above-the-fold scam inoculation on the listing page — deposit-link fraud is the
// #1 marketplace scam, so the warning must be read BEFORE the buyer contacts the
// seller, not buried in the footer note. Copy is category-aware: vehicles get the
// papers/chassis check, property & rentals get the visit-before-deposit rule.
export function SafetyStrip({ categorySlug, action, protections, className, variant }: { categorySlug: string; action?: React.ReactNode; /** The "ENO protects you" trigger, folded in as the quiet second line — see the note at its render. */ protections?: React.ReactNode; className?: string; /**
   * ⛔ A VARIANT, FOR LISTINGS WHERE THE CATEGORY COPY WOULD BE A FALSE PROMISE. The default advice
   * below is written for an eno seller you meet: "Meet, inspect, then pay". On a PARTNER affiliate
   * listing there is nobody to meet, eno holds no money and runs no dispute for it, so that line —
   * and the "ENO protects you" second line beside it — would tell the buyer they have cover they do
   * not have. The block is not suppressed, because the safety advice is the half that can stop
   * someone losing money; the wording is replaced with one that is true here.
   *
   * ⚠️ A VARIANT RATHER THAN A `line` STRING PROP, AND THAT IS THE POINT. This is a client component
   * that translates its own copy through tr(). A string handed in from the server page cannot be
   * translated — the first draft did exactly that and Vietnamese readers would have got the English
   * sentence, on the one line of the page that exists to prevent someone losing money.
   */ variant?: 'affiliate' }) {
  const { tr } = useLanguage()

  const line = variant === 'affiliate'
    ? tr(
        "Book only on the partner's own website — eno.vn never takes payment or a deposit for partner tickets, and cannot refund one.",
        'Chỉ đặt vé trên website chính thức của đối tác — eno.vn không bao giờ nhận thanh toán hay tiền cọc cho vé của đối tác, và không thể hoàn tiền.',
      )
    :
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
    // ⚠️ THE INK IS THE POINT — this strip carries the one sentence that can stop a buyer losing
    // money on a marketplace where deposit-link fraud is THE loss mode, and it once rendered as
    // decoration: at `bg-warning/10` with neutral `text-foreground` it read as a tinted note, and
    // on the PDP it sits directly beneath the "ENO protects you" panel — same rounded shape, same
    // padding, near-identical value — so the informational box and the scam warning formed one
    // grey blob. A design review flagged it as carrying less visual weight than the price.
    //
    // ⚠️ IT USED TO ANSWER THAT WITH A LEFT RULE, AND THE RULE IS NOW GONE (owner, 2026-08-13:
    // "remove accent line on left, look all across the app if any section have it remove").
    // What holds the hierarchy without it: the `bg-warning/10` tint, the amber shield glyph, and the first
    // line's own `font-semibold text-warning` ink. The warning still speaks in the warning's voice,
    // it just no longer wears a bar. If this ever reads as a grey note again, the fix is ink and
    // weight — do not put the rule back.
    // ⚠️ `--warning` is amber-800 (#92400e) in light and amber-400 in dark, both chosen for
    // contrast as TEXT (see the token note in globals.css) — so this is safe as ink, which is
    // exactly why the token exists rather than a raw amber.
    <div className={cn('flex items-start gap-2.5 rounded-xl bg-warning/10 px-3 py-2.5 text-xs leading-relaxed', className)}>
      {/* ⚠️ SOLAR, NOT THE HAND-DRAWN SEAL (owner, 2026-08-13: "old icon make sure all icons are
          solar"). This mount used to re-draw the eno seal inline — SEAL_CHIEF + SEAL_OUTLINE +
          SEAL_CHECK stroked by hand — purely so the chief could take the strip's amber ink instead
          of <EnoSeal>'s fixed fill-brand-100. That is three hand-maintained paths, a strokeLinejoin
          that had already shipped mitered here while every other seal was round, and a glyph that
          drifts from the icon set the rest of the app draws from.
          `shield-check` is the same idea in the shared vocabulary: it takes `currentColor`, so the
          amber comes for free, and it gains the outline/bold weights every other icon has. */}
      <ShieldCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
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
