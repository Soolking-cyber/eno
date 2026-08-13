'use client'

import { memo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ArrowRight, MapPin, MessageCircle, Tag, Zap } from '@/components/ui/icons'
import { PartnerBadge } from './partner-badge'
import { TrustScore } from './trust-score'
import { Badge } from './card-badges'
import { Price } from './price'
import { CategoryIcon } from './category-icons'
import { FavoriteHeart } from './favorite-heart'
import { useLanguage, Tr } from '@/context/language-context'
import { useLocalized } from './listing-content'
import type { SerializedListingCard } from '@/lib/types'
import { formatMoneyFull, formatCount, moneyLocale, dropPercent } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/auth-context'
import { stashQuickCompose } from '@/lib/quick-contact'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tooltip } from '@/components/ui/tooltip'
import { EnoSlider } from '@/components/marketplace/eno-slider'

type Props = {
  listing: SerializedListingCard
  index: number
  onOpen: (l: SerializedListingCard) => void
  onPrefetch: (id: string) => void
  onLocate: (id: string) => void
}

// Compact list row (bonbanh-style): thumbnail + title + price/location/trust meta
// + locate/favorite actions. Memoized — compact is the default view mode, so every
// row would otherwise re-render on any explorer state change (hover, page, filters).
// All callbacks passed in are stable useCallback handlers in the explorer.
export const CompactListingRow = memo(function CompactListingRow({ listing: l, index, onOpen, onPrefetch, onLocate }: Props) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const cover = l.images[0]
  // Embedded per-language title (titleI18n, warmed at post time) → instant, no
  // API call; falls back to lazy MT for langs without an embedded value.
  const displayTitle = useLocalized(l.title, l.titleVi, l.titleI18n)
  // Quick-offer: pressing the Tag rolls a discount slider open to the LEFT of the
  // action icons; confirm hands off to the composer's offer mode (?offer=N#contact).
  const [offer, setOffer] = useState<number | null>(null)
  const { user, loading: authLoading, openSignIn } = useAuth()
  const quickGo = (opts: { body?: string; offerAmount?: number | null }) => {
    if (!user) { if (!authLoading) openSignIn({ listingTitle: displayTitle, listingImage: cover ?? null }); return }
    if (stashQuickCompose(l, opts)) router.push('/messages/pending')
    else router.push(`/listings/${l.id}#contact`)
  }

  return (
    <div
      onClick={() => onOpen(l)}
      onMouseEnter={() => onPrefetch(l.id)}
      onTouchStart={() => onPrefetch(l.id)}
      className="group flex items-center gap-3 rounded-xl p-1.5 pr-1 text-left transition-[background-color,transform] duration-100 hover:bg-muted active:scale-[0.99] cursor-pointer"
    >
      {/* Thumbnail — SQUARE, small enough that the row reads as one line.
          ⚠️ IT WAS `h-14 w-16` — 64×56 — AND IT WAS THE ONLY NON-SQUARE PRODUCT PHOTO LEFT IN THE
          APP (owner, 2026-08-12: "make sure all product images are square"). Every other surface
          is square, and the post wizard CROPS UPLOADS TO SQUARE (square-crop-dialog.tsx), so a 7:8
          box does not letterbox a square source — `object-cover` SHAVES IT, ~12% off the top and
          bottom of every thumbnail in the default browse view. The width came down rather than the
          height going up: the thumb sets the row height (measured 68px = 56 + the 12px of `p-1.5`,
          against a 45px text column and 36px actions), so `w-14` keeps the list at exactly the
          density it has today and hands the 8px to the title, which on a 390pt phone is a 162px
          column. `h-16 w-16` was the alternative and costs 8px on every row.
          ⚠️ compact-listing-row-skeleton.tsx CARRIES THE SAME TWO NUMBERS and its own header
          records that the pair has drifted apart once already. Change both or neither.
          ⚠️ THE PARTNER RING BELONGS HERE TOO, AND ITS ABSENCE IS WHY THE FEATURE READ AS BROKEN.
          The gold ring shipped on <ListingCard> only — the GRID view — while `viewMode` defaults
          to 'compact' (listings-explorer.tsx), so the default browse feed showed no ring at all
          and the owner reported it invisible three times running. Measured, not reasoned:
          `document.querySelectorAll('.partner-ring-media').length` was 0 on /?category=services
          with all eight partner listings on screen. Any NEW listing surface has to opt in the
          same way; there is no inherited styling to rely on. */}
      <div
        // `title` is for the SIGHTED reader the sr-only line cannot reach — roughly 8% of men see
        // this gold as a grey-green, and for them a ring with no hover text is decoration with no
        // meaning. It is the same treatment the avatar surfaces already carry, and it is additive:
        // the sr-only text below is what assistive tech announces, since `title` on a plain div is
        // not reliably exposed.
        title={l.seller.officialPartner ? tr('Official partner', 'Đối tác chính thức') : undefined}
        className={cn(
          'relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-tint',
        )}
      >
        {cover ? (
          <Image
            src={cover}
            alt={displayTitle}
            fill
            sizes="56px"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            loading={index < 6 ? 'eager' : 'lazy'}

          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-tint">
            <CategoryIcon name={l.category.icon} className="h-5 w-5 text-ink-4" />
          </div>
        )}
      </div>

      {/* One-liner: title on top, price · location · trust score on a tight meta line */}
      <div className="min-w-0 flex-1">
        {/* On a phone the trust badge rides the TITLE line, not the price line. The
            column is only ~162px on a 390pt device, and the badge cost ~40px of it —
            enough that a real property price (9,500,000,000 VND needs ~195px) got
            CLIPPED by the overflow guard below. A clipped price is a wrong price, so
            the badge yields and the price owns the whole line. At sm+ there is room,
            so it returns to the meta line and keeps the vertical badge column the
            owner picked on 2026-07-14. */}
        <div className="flex min-w-0 items-center gap-x-2">
          <h4 className="truncate text-sm font-medium leading-snug text-foreground group-hover:underline">
            {displayTitle}
          </h4>
          {/* ⚠️ THE RING NEEDS A NAME, AND THIS ROW SHIPPED WITHOUT ONE. The gold ring on the
              thumbnail is an `::after` overlay, and pseudo-element content is never announced —
              so for a screen-reader user, and for the ~8% of men who read this gold as a
              grey-green, partner status was carried by nothing at all. On the DEFAULT browse
              view, which is this one. `<ListingCard>` has carried this same sr-only line since
              the seal was removed; the compact row was simply missed when the ring was added.
              Zero-width by construction, so it costs the one-line layout nothing. */}
          {/* ⚠️ PARTNER REPLACES TRUST (owner, 2026-08-13), and the sr-only line goes with it: it
              existed only because the gold avatar ring carries no accessible name, and the badge
              now says the words on screen. An official partner shows no trust score anywhere —
              same rule in seller-card, pdp-shop-link and listing-card. */}
          {l.seller.officialPartner ? (
            <PartnerBadge className={cn('ml-auto shrink-0 sm:hidden', offer !== null && 'hidden')} />
          ) : (
            <TrustScore
              score={l.seller.trustScore}
              variant="mini"
              size="sm"
              className={cn('ml-auto shrink-0 sm:hidden', offer !== null && 'hidden')}
            />
          )}
        </div>
        {/* min-w-0 is load-bearing: without it this flex row can never shrink below
            its content, so a wide price (shrink-0, and it must stay shrink-0 — a
            truncated price is a wrong price) overflowed the column and painted
            straight over the action icons to its right. */}
        <div className="mt-0.5 flex min-w-0 items-center gap-x-2 overflow-hidden text-xs text-muted-foreground">
          {/* Same app-wide badges as the grid card (card-badges.tsx), inline form:
              urgent before the price, drop % after — the row is one line, so signals
              stay glyph-sized. */}
          {/* The row's single color anchor — brand blue, matching the grid card. */}
          {/* unit="sm" for the same reason as dual="sm": on a phone " / service" is
              the widest and least informative part of the row — every visa row says
              it — and it is what pushed the amount into the action cluster. */}
          {/* ⛔ 16px, AND `sm:text-lg` WAS TRIED AND REVERTED — DO NOT REINTRODUCE IT WITHOUT A
              CONTAINER QUERY. The row gets its extra weight from <Price>'s 900, not from size.
              Why the breakpoint version is wrong: `sm:` asks about the VIEWPORT, but what
              constrains this price is the ROW, and the two move in opposite directions. The
              explorer lays compact rows out `grid-cols-1 lg:grid-cols-2`, so at exactly 1024px
              the row HALVES while the viewport is at its widest — the meta column drops to
              ~228px. Measured there with the bump in place: an 18px price rendered 245px inside
              a 228px column and was CLIPPED by the `overflow-hidden` below, and a clipped price
              is a wrong price. Both external reviewers predicted this from the class alone; the
              measurement only confirmed it.
              A container query on the text column is the correct tool if the size ever needs to
              scale here — `container-type: inline-size` plus `@sm:text-lg` — not a viewport
              breakpoint that cannot see the column it is sizing text for. */}
          <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} compact dual="sm" unit="sm" className="shrink-0 text-base text-accent-foreground" />
          {/* Urgent — RIGHT of the price (user-picked 2026-07-14): the bare black
              bolt on EVERY breakpoint. The desktop chip (outline + "Urgent" word)
              is gone — one glyph reads the same everywhere and keeps the one-line
              meta row quiet. */}
          {l.urgent && (
            <Zap
              className={cn('h-3.5 w-3.5 shrink-0 fill-current text-foreground', offer !== null && 'hidden')}
              aria-label={tr('Urgent', 'Bán gấp')}
            />
          )}
          {l.prevPrice != null && dropPercent(l.prevPrice, l.price) && (
            <Badge kind="drop" variant="inline" className="shrink-0">{dropPercent(l.prevPrice, l.price)}</Badge>
          )}
          {/* Address text is desktop-only (user-picked: it truncated uselessly on
              phones — the map-pin action is the mobile location affordance). */}
          <span className="hidden h-3 w-px shrink-0 bg-border sm:block" />
          <span className="hidden truncate sm:inline"><Tr text={l.district || l.city} /></span>
          {/* Demand proof (≥3 contact reveals) — desktop only: the one-line meta row
              can't spare the width on mobile. */}
          {l.contactCount >= 3 && (
            <span className="hidden shrink-0 text-2xs text-muted-foreground tabular-nums sm:inline">
              {tr(`${formatCount(l.contactCount, moneyLocale(lang))} contacted`, `Đã liên hệ ${formatCount(l.contactCount, moneyLocale(lang))}`)}
            </span>
          )}
          {l.seller.officialPartner ? (
            <PartnerBadge className={cn('ml-auto hidden shrink-0 sm:flex', offer !== null && 'sm:hidden')} />
          ) : (
            <TrustScore score={l.seller.trustScore} variant="mini" size="sm" className={cn('ml-auto hidden shrink-0 sm:flex', offer !== null && 'sm:hidden')} />
          )}
        </div>
      </div>

      {/* Actions paired together (not stranded): offer + quick-chat + locate + favorite.
          The offer slider rolls open leftwards, replacing nothing — icons stay put. */}
      <div className="relative flex shrink-0 items-center" onMouseLeave={() => setOffer(null)}>
        {offer !== null && (
          // A div, not a span: <EnoSlider> renders a <div> root, which is not
          // phrasing content — a span wrapper would be invalid nesting. Same
          // classes, same flex layout, identical render.
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex min-w-0 items-center gap-2 py-1 pr-1 animate-in slide-in-from-right-2 fade-in duration-150"
          >
            <span className="shrink-0 text-2xs font-bold tabular-nums text-foreground">−{offer}%</span>
            {/* THE app slider (ui/slider, re-exported as EnoSlider) — same
                single-handle offer slider the contact composer uses. w-28 keeps
                the row's action cluster from growing. */}
            <EnoSlider
              min={5} max={50} step={1}
              value={offer}
              onChange={setOffer}
              aria-label={tr('Discount', 'Mức giảm')}
              className="w-28 cursor-pointer"
            />
            <Button
              type="button"
              variant="cta"
              size="none"
              onClick={() => quickGo({ offerAmount: Math.round(l.price * (1 - offer / 100)) })}
              className="shrink-0 gap-1 rounded-full px-3 py-1 text-2xs cursor-pointer"
            >
              {/* ArrowRight icon, not the '→' text glyph — mirrors the grid card's offer
                  CTA so both variants speak one arrow language (icon-language §1). */}
              {formatMoneyFull(Math.round(l.price * (1 - offer / 100)), l.currency, moneyLocale(lang))}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        )}
        {l.price > 0 && l.negotiable !== false ? (
          // tapTarget={false} on all three: this cluster is 36px-pitch with ZERO gap, so a
          // baked 44px ::before would overflow into its neighbours and a boundary tap would
          // fire the WRONG action (chat → offer, map → chat). Under-44px is a real a11y cost;
          // a mis-fired money-path action is worse. See ui/icon-button's header.
          <Tooltip content={tr('Make an offer', 'Trả giá')} side="top">
            <IconButton
              size="md"
              tapTarget={false}
              aria-label={tr('Make an offer', 'Trả giá')}
              aria-pressed={offer !== null}
              onClick={(e) => { e.stopPropagation(); setOffer(offer === null ? 10 : null) }}
              className="hidden text-foreground transition-colors hover:bg-accent sm:flex"
            >
              {/* h-5 on ALL FOUR cluster glyphs (Tag/Chat/Pin/Heart) — the old 17/18px
                  mix is exactly the off-grid drift the icon ladder (§4) exists to kill.
                  Open offer = user-state solid (§5): fill-brand + brand line. */}
              <Tag className={cn('h-5 w-5 transition-colors', offer !== null && 'fill-brand text-brand')} />
            </IconButton>
          </Tooltip>
        ) : (
          // Fixed-price / free listings have no offer button — hold its 36px anyway.
          // Without this the actions cluster shrinks, the flex-1 text column grows by
          // the same amount, and the trust badge (ml-auto, so it hangs off that
          // column's right edge) jumps right on exactly those rows — the badges stop
          // forming one vertical column (user-picked 2026-07-14).
          <span aria-hidden className="hidden h-9 w-9 shrink-0 sm:block" />
        )}
        <Tooltip content={tr('Chat with seller', 'Nhắn tin với người bán')} side="top">
          <IconButton
            size="md"
            tapTarget={false}
            aria-label={tr('Chat with seller', 'Nhắn tin với người bán')}
            onClick={(e) => { e.stopPropagation(); quickGo({ body: tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?') }) }}
            className={cn('text-foreground transition-colors hover:bg-accent', offer === null ? 'flex' : 'hidden')}
          >
            <MessageCircle className="h-5 w-5" />
          </IconButton>
        </Tooltip>
        <IconButton
          size="md"
          tapTarget={false}
          aria-label={tr('Show on map', 'Xem trên bản đồ')}
          onClick={(e) => { e.stopPropagation(); onLocate(l.id) }}
          className={cn('text-foreground transition-colors hover:bg-accent', offer === null ? 'flex' : 'hidden')}
        >
          <MapPin className="h-5 w-5" />
        </IconButton>
        {offer === null && <FavoriteHeart id={l.id} className="-mr-0.5" />}
      </div>
    </div>
  )
})
