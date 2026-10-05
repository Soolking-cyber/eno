'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
import Link from 'next/link'
import { ChevronRight, Star } from '@/components/ui/icons'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { PartnerBadge } from './partner-badge'
import { TrustScore } from './trust-score'
import { miniSealWashClass } from './seller-card'
import { RatingValue, CountValue } from './rating-value'
import { BusinessVerifiedBadge } from '@/components/marketplace/business-verified-badge'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { lastSeenBucket } from '@/lib/last-seen'
import { useMounted } from '@/hooks/use-mounted'
import { PartnerListingCount } from './partner-listing-count'
import { LinkedShopChip } from './linked-shop-chip'
import type { SellerMetrics } from '@/lib/seller-metrics'

/** Shopee "shop on top": the SINGLE seller surface on the PDP, sitting directly above the media.
 *  It carries the full seller identity + trust (name, Business badge, trust score, Joined · rating ·
 *  reviews) AND the "Shop >" jump to the storefront — so the old duplicate seller-card lower in the
 *  buy box is gone (its "Chat now" lives on in the ContactComposer). The whole strip is a div (not
 *  one anchor) so the trust chip and the Shop link can each be their own real link. */
export function PdpShopLink({ name, avatarColor, avatarUrl, isBusiness, businessVerified, officialPartner, href, metrics, className, linked = null, partnerListingCount = null, unrated = false, linkedShop = false }: {
  name: string
  avatarColor?: string | null
  avatarUrl?: string | null
  isBusiness?: boolean
  businessVerified?: boolean
  officialPartner?: boolean
  href: string
  metrics: SellerMetrics
  className?: string
  /**
   * A REFERENCE LISTING whose "seller" is an import storefront (src/lib/import-sellers.ts), which
   * eno.vn never rated:
   * - 'job' — a LINKED JOB POSTING (scripts/import-jobs.ts): the storefront is the job board the
   *   posting lives on, not the employer. A TrustScore chip beside its name reads as eno vouching for
   *   employers it has not vetted, on the most scam-prone vertical.
   * - 'listing' — any other imported reference row (the rental portals: Chợ Tốt, Rever, …). Their
   *   storefronts sit at the default trustScore 100, which is a RANKING default kept for fairness,
   *   not the /trust "Trusted" tier the chip would announce.
   * Either way it shows a plain note instead of the chip, and drops the seller-activity strip
   * (response time, last seen, joined, reviews), which describes nobody.
   */
  linked?: 'job' | 'listing' | null
  /**
   * An OFFICIAL PARTNER's live listing count (edition-scoped, page.tsx), shown as '{n} listings on
   * eno.vn' (owner, 2026-09-30, K-TRUST-BADGE option D). A partner shows no trust score, so this is
   * the one line that says how much of the partner is on the site. null → nothing.
   */
  partnerListingCount?: number | null
  /**
   * No owner account and not an official partner (src/lib/linked-seller.ts isUnratedStorefront): the
   * storefront's trustScore mirrors nobody's behaviour, so NO trust chip — on any listing of it, linked
   * or not (owner, 2026-10-01). Ranking still reads the number; only the display is withheld.
   */
  unrated?: boolean
  /**
   * A LINKED SHOP (isLinkedShop): the neutral "Linked shop" chip takes the partner badge's place in
   * this row (owner, 2026-10-01). Only ever true for an unrated, non-partner storefront.
   */
  linkedShop?: boolean
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
  // First in the strip: for a partner it is the fact that sizes the claim the P plate makes.
  if (officialPartner && typeof partnerListingCount === 'number' && partnerListingCount > 0) strip.push(<PartnerListingCount key="partner-count" n={partnerListingCount} />)
  // ⚠️ "VERIFIED", NOT "VETTED" / "KIỂM DUYỆT" (2026-10-01). "eno.vn chưa kiểm duyệt" read as the platform
  // admitting it had not done its statutory pre-display moderation; what is true, and what this line
  // means, is that eno.vn has not VERIFIED the source's ad or the business behind it.
  if (linked === 'job') strip.push(tr('Linked job posting — not verified by eno.vn', 'Tin tuyển dụng dẫn link — eno.vn chưa xác minh'))
  else if (linked === 'listing') strip.push(tr('Linked listing — not verified by eno.vn', 'Tin đăng dẫn link — eno.vn chưa xác minh'))
  else if (responseBucket.key) strip.push(tr(responseBucket.en, responseBucket.vi))
  if (!linked && lastSeen.key) strip.push(tr(lastSeen.en, lastSeen.vi))
  if (!linked) strip.push(fillTemplate(tr('Joined {memberSinceYear}', 'Tham gia {memberSinceYear}'), 'Joined {memberSinceYear}', { memberSinceYear: String(memberSinceYear) }))
  if (!linked && reviewCount > 0) {
    strip.push(
      // lucide Star (rating fill), NOT the '★' text glyph — same rating mark as the
      // shared SellerCard strip and the storefront review rows (icon-language §1).
      <span key="reviews" className="inline-flex items-center gap-1">
        <Star className="h-3.5 w-3.5 shrink-0 fill-rating text-rating" aria-hidden />
        <RatingValue value={rating} /> · <CountValue value={reviewCount} /> {reviewCount === 1 ? tr('review', 'đánh giá') : tr('reviews', 'đánh giá')}
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
      <Link href={href} aria-hidden tabIndex={-1} className="shrink-0 rounded-full active:opacity-60" title={officialPartner ? tr('Official partner', 'Đối tác chính thức') : undefined}>
        <Avatar name={name} url={avatarUrl} color={avatarColor} size="lg"  />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* ⚠️ THE TRUNCATION MOVED ONTO THE INNER SPAN, AND THAT IS WHAT MAKES `tap-44` WORK HERE. This
              link was 72x20 with no press state. `tap-44` grows the hit area with an absolute ::before —
              but `truncate` is `overflow:hidden`, which clips the element's own ::before to its 20px box,
              so on the link itself the 44px area would exist in the stylesheet and nowhere on screen.
              The link keeps `min-w-0` (what `overflow:hidden` used to give it for free) so a long name
              still shrinks to the row and ellipsises inside the span. */}
          <Link href={href} className="relative min-w-0 tap-44 text-sm font-bold text-foreground hover:underline active:opacity-60"><span className="block truncate">{name}</span></Link>
          {/* ⚠️ THE RING IS DECORATION; THIS IS THE ACTUAL LABEL. The worded badge was removed
              (owner, 2026-08-11) in favour of the gold ring on the avatar above — but a ring
              has no accessible name and no meaning to anyone who cannot separate that gold
              from grey. `sr-only` keeps "Official partner" in the accessibility tree and in
              the page text, so the status survives the badge it used to live in. */}
          {officialPartner && <span className="sr-only">{tr('Official partner', 'Đối tác chính thức')}</span>}
          {/**
            * ⛔ VERIFIED OR NOTHING — and this is the chip the owner pointed at (2026-08-17): the
            * PDP shop line was showing a neutral "Business" pill for an UNVERIFIED seller, which
            * reports the account TYPE nobody checked, in the same row and at the same weight as a
            * document check eno actually ran.
            *
            * ⚠️ THE SHARED COMPONENT REPLACES A "keep the two files in step" COMMENT that used to
            * live here. seller-card.tsx carried the same chip and the same instruction; an
            * instruction only holds until someone does not read it, so there is now one component
            * and nothing to keep in step.
            */}
          {isBusiness && businessVerified && <BusinessVerifiedBadge />}
          {/* Building-band chips get the brand-100 chief wash from the call site —
              the §0 signature at micro scale; see miniSealWashClass in seller-card.tsx
              (stopgap pending the foundation fix inside trust-score.tsx). */}
          {/* ⚠️ PARTNER REPLACES TRUST HERE (owner, 2026-08-13). An official partner shows the gold
              partner badge INSTEAD of a trust score — the partner claim is the stronger of the two
              and showing both spends two chips on one point. Same swap in seller-card,
              pdp-shop-link and compact-listing-row, so a partner reads identically everywhere. */}
          {/* ⚠️ …AND A LINKED SHOP SHOWS THE NEUTRAL "Linked shop" CHIP IN THE PARTNER BADGE'S PLACE, while
              an unrated storefront (no owner, not a partner) shows no trust chip at all (owner, 2026-10-01;
              src/lib/linked-seller.ts). A linked reference listing never showed one either. */}
          {officialPartner
            ? <PartnerBadge />
            : linkedShop ? <LinkedShopChip />
            : linked || unrated ? null : <TrustScore score={trustScore} variant="mini" size="sm" href="/trust" className={miniSealWashClass(trustScore)} />}
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
        // A job board is not a shop: on a linked job the storefront is the BOARD's other postings
        // (import-jobs.ts), never the employer's, so the label says what the link actually opens.
        aria-label={linked === 'job' ? tr('More jobs from this board', 'Việc làm khác từ trang tuyển dụng này') : tr('Visit shop', 'Vào gian hàng')}
        // `relative tap-44`: 64x28 → a 44px-tall hit area around the same pill. `active:bg-secondary`
        // is the press — the hover wash, shown on touch too, in 60ms; the release eases back at the
        // transition's normal 150ms, so the press reads instantly and the let-go does not flash.
        className="group relative tap-44 flex shrink-0 items-center gap-0.5 rounded-xl px-2 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-secondary active:bg-secondary active:duration-[60ms]"
      >
        {linked === 'job' ? tr('More jobs', 'Việc làm khác') : tr('Shop', 'Gian hàng')}
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

