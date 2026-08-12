'use client'

import Link from 'next/link'
import { ChevronRight, Building2, BadgeCheck, Star } from '@/components/ui/icons'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { TrustScore } from './trust-score'
import { miniSealWashClass } from './seller-card'
import { RatingValue, CountValue } from './rating-value'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { lastSeenBucket } from '@/lib/last-seen'
import { useMounted } from '@/hooks/use-mounted'
import type { SellerMetrics } from '@/lib/seller-metrics'

/** Shopee "shop on top": the SINGLE seller surface on the PDP, sitting directly above the media.
 *  It carries the full seller identity + trust (name, Business badge, trust score, Joined · rating ·
 *  reviews) AND the "Shop >" jump to the storefront — so the old duplicate seller-card lower in the
 *  buy box is gone (its "Chat now" lives on in the ContactComposer). The whole strip is a div (not
 *  one anchor) so the trust chip and the Shop link can each be their own real link. */
export function PdpShopLink({ name, avatarColor, avatarUrl, isBusiness, businessVerified, officialPartner, href, metrics, className }: {
  name: string
  avatarColor?: string | null
  avatarUrl?: string | null
  isBusiness?: boolean
  businessVerified?: boolean
  officialPartner?: boolean
  href: string
  metrics: SellerMetrics
  className?: string
}) {
  const { tr } = useLanguage()
  const { responseBucket, lastSeenDay, memberSinceYear, reviewCount, rating, trustScore } = metrics

  // Presence, bucketed from the day-coarse date (the PDP is 30d-ISR, so a
  // server-baked label would freeze — client recompute only ever under-claims; see
  // src/lib/last-seen.ts). Rendered ONLY after mount: the bucket depends on the
  // client's clock, so baking it into SSR HTML risks a STRUCTURAL hydration mismatch
  // on a stale ISR serve (the span itself appears/disappears across the 1/7/30-day
  // boundaries — suppressHydrationWarning can't cover element topology; dual review
  // caught it). Two-pass render is the React-sanctioned shape for client-time values.
  const mounted = useMounted()
  const lastSeen = mounted ? lastSeenBucket(lastSeenDay) : { key: null as null, en: '', vi: '' }

  // Honest metrics strip — only signals that exist (never zero-filled), joined with middots.
  const strip: React.ReactNode[] = []
  if (responseBucket.key) strip.push(tr(responseBucket.en, responseBucket.vi))
  if (lastSeen.key) strip.push(tr(lastSeen.en, lastSeen.vi))
  strip.push(tr(`Joined ${memberSinceYear}`, `Tham gia ${memberSinceYear}`))
  if (reviewCount > 0) {
    strip.push(
      // lucide Star (rating fill), NOT the '★' text glyph — same rating mark as the
      // shared SellerCard strip and the storefront review rows (icon-language §1).
      <span key="reviews" className="inline-flex items-center gap-1">
        <Star className="h-3.5 w-3.5 shrink-0 fill-rating text-rating" aria-hidden />
        <RatingValue value={rating} /> · <CountValue value={reviewCount} /> {tr('reviews', 'đánh giá')}
      </span>,
    )
  }

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* AVATAR + NAME BOTH GO TO THE STOREFRONT (owner, 2026-07-24: "in product page make sure
          store avatar and name are clickable that leads to storefront"). They are two SEPARATE
          links rather than one wrapper, because the row also holds the trust chip and the
          "Shop ›" link — wrapping the whole strip would nest interactive elements inside an
          anchor, which is invalid and is why this was a plain div to begin with.
          The avatar is aria-hidden with tabIndex -1: it points at the same place as the name
          beside it, so exposing it would add a duplicate tab stop and a second identical
          announcement for no gain. The NAME carries the accessible link. */}
      {/* `title` here, not on the Link: the Link is aria-hidden, and a tooltip is for the
          sighted reader who needs the gold ring explained — see the note in seller-card.tsx. */}
      <Link href={href} aria-hidden tabIndex={-1} className="shrink-0 rounded-full" title={officialPartner ? tr('Official partner', 'Đối tác chính thức') : undefined}>
        <Avatar name={name} url={avatarUrl} color={avatarColor} size="lg" className={cn(officialPartner && 'partner-ring')} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={href} className="truncate text-sm font-bold text-foreground hover:underline">{name}</Link>
          {/* ⚠️ THE RING IS DECORATION; THIS IS THE ACTUAL LABEL. The worded badge was removed
              (owner, 2026-08-11) in favour of the gold ring on the avatar above — but a ring
              has no accessible name and no meaning to anyone who cannot separate that gold
              from grey. `sr-only` keeps "Official partner" in the accessibility tree and in
              the page text, so the status survives the badge it used to live in. */}
          {officialPartner && <span className="sr-only">{tr('Official partner', 'Đối tác chính thức')}</span>}
          {/* Same ranking as seller-card.tsx: the partner badge absorbs the plain "Business"
              chip (which only restates the account type) but never "Business verified"
              (a document check eno actually ran). Keep the two files in step. */}
          {isBusiness && (
            businessVerified ? (
              <Badge variant="success" className="px-1.5 py-0.5 font-semibold">
                <BadgeCheck className="h-3 w-3" /> {tr('Business verified', 'Doanh nghiệp đã xác minh')}
              </Badge>
            ) : !officialPartner ? (
              <Badge variant="neutral" className="px-1.5 py-0.5 font-semibold text-accent-foreground">
                <Building2 className="h-3 w-3" /> {tr('Business', 'Doanh nghiệp')}
              </Badge>
            ) : null
          )}
          {/* Building-band chips get the brand-100 chief wash from the call site —
              the §0 signature at micro scale; see miniSealWashClass in seller-card.tsx
              (stopgap pending the foundation fix inside trust-score.tsx). */}
          <TrustScore score={trustScore} variant="mini" size="sm" href="/trust" className={miniSealWashClass(trustScore)} />
        </div>
        {strip.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {strip.map((node, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <span aria-hidden className="text-border">·</span>}
                {node}
              </span>
            ))}
          </div>
        )}
      </div>
      <Link
        href={href}
        aria-label={tr('Visit shop', 'Vào gian hàng')}
        className="group flex shrink-0 items-center gap-0.5 rounded-xl px-2 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-secondary"
      >
        {tr('Shop', 'Gian hàng')}
        {/* `motion-reduce:group-hover:translate-x-0` is NOT redundant beside
            `motion-reduce:transition-none`: killing the transition removes only the TWEEN,
            leaving the 2px displacement to happen instantly — the jump a reduced-motion
            reader asked not to see. Measured on the sibling copy of this idiom in
            help-center.tsx: 2.00px of movement on hover normally, 0.00px with the pair.
            No `shrink-0` on the icon — the Link above is already `shrink-0` and sized by
            its content, so nothing can compress the glyph and the class would be noise.
            Keep the bare `transition-transform` UTILITY rather than an arbitrary list:
            v4 expands it to transform+translate+scale+rotate, whereas a hand-written
            `transition-[…,transform]` omits `translate` and silently kills the tween. */}
        <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
      </Link>
    </div>
  )
}
