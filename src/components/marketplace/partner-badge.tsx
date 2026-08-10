'use client'

import { useId } from 'react'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { SEAL_CHIEF, SEAL_CHECK, SEAL_OUTLINE } from './eno-seal'
import { STROKE_UI } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'

/**
 * OFFICIAL PARTNER — a company eno itself has an agreement with, and created the account for.
 *
 * ⚠️ IT IS NOT A TRUST TIER AND MUST NEVER LOOK LIKE ONE. The trust ladder's top tiers already own
 * a glossy gold pill (.trust-fill-exceptional), and the first version of this badge reused it. Both
 * external reviewers refused that independently and the reasoning is the same one the trust tokens
 * are built on: a viewer pattern-matches COLOUR before they read a word, so two gold pills collapse
 * an EARNED behavioural score and a GRANTED commercial relationship into one signal — and a partner
 * who later earns Exceptional would wear both at once, side by side, meaning different things.
 *
 * The fix is not a second gold, which is how a palette rots. It is the same metal with the stamp
 * inverted: the trust chip is dark ink ON light gold, this is gold foil ON dark ink. One family,
 * two grammars — and the grammars stay separable at 12px, where a hue difference would not.
 *
 * ⚠️ NO OUTER GLOW, DESPITE THE WORD IN THE REQUEST. The owner asked for a "shiny gold glow"; a
 * literal glow is a zero-offset shadow, which globals.css bans by name ("a halo — light coming from
 * the viewer") under the one-light-source rule that was audited three days before this was written.
 * "Shiny" for metal means a SPECULAR gradient, not a bloom, so the shine lives in the seal's foil
 * ramp and the pill's inset highlight — which is what actually reads as gold rather than as a
 * blurred yellow smudge. There is also no sheen ANIMATION: the owner is removing always-running
 * animations for performance, and this badge renders on every card in a partner's storefront.
 *
 * The glyph is the eno seal, reused rather than redrawn ("a seal that drifts is a counterfeit" —
 * eno-seal.tsx). Its reserved meaning is first-party trust, which is exactly the claim here: this
 * is eno vouching, not the seller asserting.
 */
/**
 * The eno seal painted in partner foil — the glyph on its own.
 *
 * Exported because the feed card's badge grammar is ICON-ONLY (it carries a bare Building2 for
 * "business", never a worded chip): a ~110px "Official partner" pill would not fit the row and
 * would crowd out the title it sits under. So the card gets the mark and the tooltip, and the
 * storefront and PDP — where there is room and the seller is the subject — get the worded badge.
 */
export function PartnerSeal({ size = 14, className }: { size?: number; className?: string }) {
  // ⚠️ Gradient ids are DOCUMENT-global, and this renders once per card in a feed of 24+. A
  // hardcoded id would leave every instance after the first pointing at a dangling `url(#…)`,
  // which paints them BLACK rather than gold — and only on the busiest pages, which is exactly
  // where it would be least likely to be caught in a spot check.
  const gid = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cn('shrink-0', className)}>
      <defs>
        {/* 135° with the mid at 55% — the trust shield's stop geometry, kept because that
            ratio is what makes a 13px gradient read as metal instead of as a blur. */}
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--partner-foil-from)" />
          <stop offset="55%" stopColor="var(--partner-foil-mid)" />
          <stop offset="100%" stopColor="var(--partner-foil-to)" />
        </linearGradient>
      </defs>
      {/* Chief filled with the foil, silhouette and check stroked in it: the same two-part
          construction the tier badges use, so the mark stays recognisably the eno seal. */}
      <path d={SEAL_CHIEF} fill={`url(#${gid})`} />
      <path d={SEAL_OUTLINE} fill="none" stroke={`url(#${gid})`} strokeWidth={STROKE_UI} strokeLinecap="round" strokeLinejoin="round" />
      <path d={SEAL_CHECK} fill="none" stroke={`url(#${gid})`} strokeWidth={STROKE_UI} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PartnerBadge({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const { tr } = useLanguage()
  return (
    <Badge
      variant="partner"
      size={size === 'sm' ? 'sm' : 'md'}
      className={cn('font-bold [box-shadow:inset_0_1px_0_rgb(255_255_255/0.12)]', className)}
    >
      <PartnerSeal size={size === 'sm' ? 11 : 13} />
      {tr('Official partner', 'Đối tác chính thức')}
    </Badge>
  )
}
