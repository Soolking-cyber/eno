'use client'

import { fillTemplate, safeTemplate } from '@/lib/i18n/placeholders'
import Link from 'next/link'
import { MessageCircle, Store, Star } from "@/components/ui/icons"
import { useLanguage } from '@/context/language-context'
import { BusinessVerifiedBadge } from '@/components/marketplace/business-verified-badge'
import { PartnerBadge } from './partner-badge'
import { PartnerListingCount, PartnerListingWords } from './partner-listing-count'
import { LinkedShopChip } from './linked-shop-chip'
import { TrustScore } from '@/components/marketplace/trust-score'
import { trustBand } from '@/lib/trust-score'
import { RatingValue, CountValue } from '@/components/marketplace/rating-value'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { storeMember } from './store-pair'
import { lastSeenBucket } from '@/lib/last-seen'
import { useMounted } from '@/hooks/use-mounted'
import type { SellerMetrics } from '@/lib/seller-metrics'

// Only the identity fields SellerCard needs — kept structural so BOTH the PDP
// (serialized seller) and the storefront (raw Seller row) satisfy it. Every trust
// signal (score/tier/rating/reviews/response) rides in via the `metrics` bundle so
// the raw responseRate number never reaches this client component.
/**
 * §0/§0b stopgap for the BUILDING-band mini seal (shared by SellerCard and
 * PdpShopLink — the two seller-surface TrustScore mounts). trust-score.tsx
 * (foundation-owned) tints the quiet mini chip's chief with `currentColor`
 * (neutral slate for Building), which desaturates the signature exactly where
 * it lives: a pixel scan of the chip found ZERO blue — the seal read as lucide
 * ShieldMinus. Until the foundation moves the brand wash INSIDE the mini
 * variant, the call site restores it: the chief (the svg's FIRST path, a
 * stable ordering trust-score.tsx documents) takes the `fill-brand-100` wash
 * at full opacity — the same arbitrary-variant pattern as the category WASH
 * map. Line + bar + digits keep the band's slate ink ("tinted chief + line +
 * bar", icon-language §0b micro tier). EARNED tiers return undefined so their
 * vivid gradient chips stay untouched (§0b addendum), as does restricted (red
 * is a warning surface, not a trust signature). DELETE both call sites' usage
 * when trust-score.tsx lands the wash natively (foundation request filed
 * 2026-08-06, round 2).
 */
export function miniSealWashClass(score: number): string | undefined {
  return trustBand(score) === 'standard'
    ? '[&>svg>path:first-of-type]:fill-brand-100 [&>svg>path:first-of-type]:[fill-opacity:1]'
    : undefined
}

export type SellerCardSeller = {
  id: string
  name: string
  avatarColor: string
  avatarUrl?: string | null
  isBusiness: boolean
  /** The verified-business badge (server-computed isBusinessVerified). Optional so
   *  older serializers that don't send it degrade to the plain "Business" label. */
  businessVerified?: boolean
  /** eno's own commercial partner. Optional for the same reason as businessVerified —
   *  a caller that doesn't send it degrades to no badge, never to a false one. */
  officialPartner?: boolean
  /** No owner account and not an official partner (src/lib/linked-seller.ts): its trustScore is a
   *  ranking default that describes nobody, so the card shows NO trust chip (owner, 2026-10-01).
   *  Optional, and absent reads as "rated" — the pre-2026-10-01 behaviour. */
  unrated?: boolean
  /** An unrated storefront that carries imported/affiliate listings: the neutral "Linked shop" chip
   *  takes the partner badge's place (owner, 2026-10-01). */
  linkedShop?: boolean
}

export type SellerCardProps = {
  seller: SellerCardSeller
  metrics: SellerMetrics
  /** 'pdp' = compact block in the listing sticky column (default); 'storefront' =
   *  header on the seller's own page (no "View shop" link back to itself). */
  variant?: 'pdp' | 'storefront'
  /** Primary "Chat now" action. When omitted the primary button is hidden. */
  onChat?: () => void
  /** "View shop" destination — pdp only; ignored on the storefront variant. */
  storefrontHref?: string
  /** Optional "{N} listings" strip item (e.g. the storefront's active count). */
  listingCount?: number
  /**
   * Storefront only — the page's own controls after "Chat now", in its row: Share and the ⋯ menu holding Report and Block
   * (owner, 2026-11-16 — hub Q21; s/[handle]/page.tsx, seller-storefront.tsx). With them, Chat and Share are an equal pair.
   * ⚠️ They LEAD WITH SHARE, Chat's partner (the one caller, s/[handle]/page.tsx, always draws it): Chat takes the pair's
   * share of the row with `actions` and its own width without them (store-pair.ts `storeMember`). A Share drawn with no
   * Chat (no `onChat`) is told so by the page (ShareButton `alone`).
   */
  actions?: React.ReactNode
  /**
   * Storefront only — decided ON THE SERVER at request time (a storefront renders per request): presence will be drawn
   * (`lastSeenBucket(lastSeenDay).key` is not null — seen in the last 30 days). The phone's facts line holds its 20px from the
   * first paint only then; a dormant shop with no response figure draws no empty line (review, 2026-11-16). Omitted: any
   * stored presence day counts, as before.
   */
  presenceDue?: boolean
  className?: string
}

/**
 * One stat cell of the storefront's phone header (S1, in SellerCard): the numeral in the price role, whole (`text-t-price`,
 * 17/22 bold ink — a figure, not a heading), over its label (the meta role, muted). Cells share the row's width from their
 * content (`flex-auto`), so a long label ("listings on eno.vn") wraps inside its own cell rather than squeezing a short one.
 * ⚠️ NO `min-w-0`: a cell never shrinks below its numeral or its longest word (min-content), or a partner WITH reviews squeezed
 * "2026" / "Joined" 12–14px past its 29px cell into the next one at 320px (measured in Chromium with Open Runde and the app's
 * compiled CSS, 2026-11-16). The three cells' min-contents (about 180px with the gaps) fit the 196px a 320px phone leaves.
 * `labelFirst`: a template whose words come before the number ("Joined {year}") keeps that reading order, and the number is
 * still drawn on top.
 */
function StatCell({ kind, num, label, labelFirst = false }: { kind: string; num: React.ReactNode; label: React.ReactNode; labelFirst?: boolean }) {
  return (
    <div data-store-stat={kind} className="flex flex-auto flex-col">
      {labelFirst && <span className="text-t-meta text-muted-foreground">{label}</span>}
      <span className="order-first text-t-price text-foreground">{num}</span>
      {!labelFirst && <span className="text-t-meta text-muted-foreground">{label}</span>}
    </div>
  )
}

/**
 * Shared seller identity + trust card. Reused by the PDP sticky column and the
 * storefront header. Renders a decomposed, honest metrics strip: only signals that
 * actually exist show (never zero-filled) — response bucket is already suppressed
 * upstream (responseBucket → key:null) when there's no track record.
 */
export function SellerCard({
  seller,
  metrics,
  variant = 'pdp',
  onChat,
  storefrontHref,
  listingCount,
  actions,
  presenceDue,
  className,
}: SellerCardProps) {
  const { tr } = useLanguage()
  const { responseBucket, lastSeenDay, memberSinceYear, reviewCount, rating, trustScore } = metrics
  const storefront = variant === 'storefront'
  const hasListingCount = typeof listingCount === 'number' && listingCount > 0

  // Presence, bucketed from the day-coarse date (never a raw timestamp) — computed
  // client-side so a stale ISR PDP can only under-claim, and rendered only AFTER
  // mount so the leaf can't structurally mismatch server HTML across a bucket
  // boundary (see use-mounted.ts + src/lib/last-seen.ts).
  const mounted = useMounted()
  const lastSeen = mounted ? lastSeenBucket(lastSeenDay) : { key: null as null, en: '', vi: '' }

  // Metrics strip leaves — build only the ones that exist, join with middots. `stat`: on a storefront's phone the leaf is one of
  // the header's stat cells instead (below), so the strip leaves it out there.
  const strip: { node: React.ReactNode; stat?: true }[] = []
  if (responseBucket.key) strip.push({ node: tr(responseBucket.en, responseBucket.vi) })
  if (lastSeen.key) strip.push({ node: tr(lastSeen.en, lastSeen.vi) })
  strip.push({ node: fillTemplate(tr('Joined {memberSinceYear}', 'Tham gia {memberSinceYear}'), 'Joined {memberSinceYear}', { memberSinceYear: String(memberSinceYear) }), stat: true })
  if (reviewCount > 0) {
    strip.push({
      stat: true,
      node: (
        // lucide Star (rating fill), NOT the '★' text glyph — one rating mark across
        // the strip, the reviews header and the review rows (icon-language §1: the
        // base set is lucide; a font glyph drifts per-platform and takes no tokens).
        <span key="reviews" className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5 shrink-0 fill-rating text-rating" aria-hidden />
          <RatingValue value={rating} /> · <CountValue value={reviewCount} />{' '}
          {/* "1 review", not "1 reviews" (break-ui, 2026-10-05); Vietnamese has no plural to fork. */}
          {reviewCount === 1 ? tr('review', 'đánh giá') : tr('reviews', 'đánh giá')}
        </span>
      ),
    })
  }
  if (hasListingCount) {
    strip.push({
      stat: true,
      node:
        // An official partner reads '{n} listings on eno.vn' (owner, 2026-09-30, K-TRUST-BADGE option D):
        // it carries no trust score, so the count is what sizes the partner claim. Everyone else keeps
        // the bare count.
        seller.officialPartner
          ? <PartnerListingCount key="listings" n={listingCount} />
          : (
            <span key="listings">
              <CountValue value={listingCount} /> {listingCount === 1 ? tr('listing', 'tin đăng') : tr('listings', 'tin đăng')}
            </span>
          ),
    })
  }
  /**
   * ⛔ THE STOREFRONT'S PHONE HEADER IS A STAT HEADER (UI climb r12, cook store-r12c S1 — the storefront batch measured +0.90 /
   * +0.50 over live, blind; Instagram's profile and FB Marketplace's seller page were the references). Below sm: the avatar at
   * 84px beside numeral-over-label cells, then the shop's <h1> at full width with its badge or trust chip, then ONE muted facts
   * line (response, presence). From sm the identity is as it was, its initials on the h3 role (17px, was an off-scale 18) — and
   * the [Chat][Share][⋯] row under it is every width's (`actions`, owner 2026-11-16 hub Q21).
   * ⛔ ONLY FACTS THE STRIP ALREADY SHOWS, IN ITS OWN WORDS: the listing count ("5,379" over "listings on eno.vn" for a partner,
   * "listings" for everyone else), the year over "Joined" (the strip's own template, split at its number), and the rating over
   * "12 reviews" ONLY when the shop has reviews — never a zero, never a figure eno does not hold. Each is a leaf the strip drops
   * on a phone (`stat`), so a screen reader meets it once at any width.
   * ⚠️ The facts line keeps its 20px from the first paint when presence WILL arrive (its words are drawn after mount, see
   * `lastSeen`) — the page decided that on the server (`presenceDue`) — so nothing under the header moves when they do; with
   * neither fact it is not drawn on a phone, a dormant shop (seen over 30 days ago) included.
   */
  const phoneFacts = !!responseBucket.key || (presenceDue ?? !!lastSeenDay)
  const joinedTpl = safeTemplate(tr('Joined {memberSinceYear}', 'Tham gia {memberSinceYear}'), 'Joined {memberSinceYear}')
  const [joinedBefore = '', joinedAfter = ''] = joinedTpl.split('{memberSinceYear}').map((s) => s.trim())

  return (
    // 16px from the identity to the storefront's [Chat][Share][⋯] row on a phone (cook store-r12c S2); 12 from sm and beside a listing.
    <div className={cn('flex flex-col gap-3', storefront && 'max-sm:gap-4', className)}>
      <div className={cn('flex items-center gap-3', storefront && 'max-sm:grid max-sm:grid-cols-[5.25rem_minmax(0,1fr)] max-sm:gap-x-4 max-sm:gap-y-3')}>
        {/* ⚠️ `title` IS THE SIGHTED COUNTERPART OF THE sr-only BELOW, not a duplicate of it.
            With the badge gone the ring is the only thing on screen, and a ring means nothing
            to someone who has not been told what it is — including everyone who cannot
            separate this gold from grey. The tooltip is the cheapest way to make the mark
            self-explaining without reinstating the chip the owner removed. */}
        <span title={seller.officialPartner ? tr('Official partner', 'Đối tác chính thức') : undefined} className="flex shrink-0">
          {/* 64px on the storefront, where this card IS the page's identity block; 48px beside a
              listing, where it is one fact among many (ST-HEADER, 2026-09-29). 84px on a storefront's phone (S1, above). Its
              initials on the closed type scale: the display role (28px) in 84, the h3 role (17px) in 64 — a third of the disc,
              as `lg`'s 16 in 48. */}
          <Avatar name={seller.name} url={seller.avatarUrl} color={seller.avatarColor} size="lg" className={storefront ? 'size-21 text-t-display sm:size-16 sm:text-t-h3' : undefined} />
        </span>
        {storefront && (
          <div data-store-stats="" className="flex min-w-0 gap-4 sm:hidden">
            {hasListingCount && (
              <StatCell
                kind="listings"
                num={<CountValue value={listingCount} />}
                label={seller.officialPartner ? <PartnerListingWords n={listingCount} /> : listingCount === 1 ? tr('listing', 'tin đăng') : tr('listings', 'tin đăng')}
              />
            )}
            <StatCell kind="joined" num={memberSinceYear} label={[joinedBefore, joinedAfter].filter(Boolean).join(' ')} labelFirst={!!joinedBefore} />
            {reviewCount > 0 && (
              <StatCell
                kind="reviews"
                num={<span className="inline-flex items-center gap-1"><Star className="size-4 shrink-0 fill-rating text-rating" aria-hidden /><RatingValue value={rating} /></span>}
                label={<><CountValue value={reviewCount} /> {reviewCount === 1 ? tr('review', 'đánh giá') : tr('reviews', 'đánh giá')}</>}
              />
            )}
          </div>
        )}
        <div className={cn('min-w-0 flex-1', storefront && 'max-sm:col-span-2')}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* On the storefront this IS the page's main heading (the listing title owns
                the PDP's <h1>), so it must be an <h1> and read as a title, not 14px body —
                a real SEO/a11y heading on the public /{handle} shop page. */}
            {/* ⚠️ THE TITLE TIER, NOT 18px: at `text-lg` the shop's <h1> was the same size as the
                page's h2 section heads ("Reviews", "Listings by …"), so the page had no top. */}
            {/* ⚠️ ALWAYS THE <h1> ON A STOREFRONT, `<handle>.eno.vn` included: the explorer under it no
                longer draws a site-name H1 when it is seller-scoped (ST-HEADER, 2026-09-29), so there
                is exactly one — this one. */}
            {/* Two lines, then clamped, with the full name on hover (break-ui, 2026-10-05): `truncate`
                left a 120-character shop name (updateSeller's cap) unreadable anywhere on its own page. */}
            {/* On a storefront's phone the h2 role, whole (S1, above: 22/28 bold, the rental sheet's phone H1 too): `.h-title` is
                unlayered, so a plain utility loses to it and its own 1.22 line height would ride any size it is given (24/29.3);
                the role is applied `!important` below sm, which a layered declaration needs to beat an unlayered one. From sm the
                title tier as before. */}
            {variant === 'storefront' ? (
              <h1 title={seller.name} className="h-title line-clamp-2 text-foreground [overflow-wrap:anywhere] max-sm:text-t-h2!">{seller.name}</h1>
            ) : (
              <span className="truncate text-sm font-bold text-foreground">{seller.name}</span>
            )}
            {/* ⚠️ THE RING IS DECORATION; THIS IS THE ACTUAL LABEL. The worded badge was removed
                (owner, 2026-08-11) in favour of the gold ring on the avatar — but a ring carries
                no accessible name, and gold-vs-grey is exactly the distinction a red-green
                colour-blind reader cannot make. On the STOREFRONT this line sits beside the
                shop's <h1>, so it is also the only place the status appears in the page text at
                all. sr-only keeps it in the accessibility tree without reinstating the chip. */}
            {/* ⚠️ THE WORDED BADGE IS BACK (owner, 2026-08-13), AND IT ANSWERS THE NOTE ABOVE
                RATHER THAN IGNORING IT. The chip was dropped on 2026-08-11 for the ring, and the
                ring then needed this `sr-only` span precisely because it carries no accessible
                name and gold-vs-grey is invisible to a colour-blind reader. A word fixes both, so
                the sr-only crutch goes with it — <PartnerBadge> announces "Official partner"
                itself. The ring stays: it is the glance, this is the claim, and unlike the ring
                this one is tappable and explains what a partner actually is. */}
            {seller.officialPartner && <PartnerBadge />}
            {/* A LINKED SHOP gets the neutral chip where the partner badge used to be (owner, 2026-10-01). */}
            {!seller.officialPartner && seller.linkedShop && <LinkedShopChip />}
            {/* ⚠️ A PARTNER SUPPRESSES THE PLAIN "Business" CHIP, BUT NOT "Business verified".
                The two say different things and only one is redundant. "Business" merely reports
                the account TYPE, which "Official partner" already implies — showing both spends a
                third badge slot in a row that also carries the trust chip, to tell the reader
                something they just read. "Business verified" is a document check eno actually
                performed, so it survives: a partner who has ALSO cleared verification has earned
                two distinct claims and should show both. */}
            {/**
              * ⛔ NOT ON THE STOREFRONT — IT IS ALREADY THERE, 40px LOWER. Owner, 2026-08-17:
              * "on storefront remove top business verified badge". The storefront renders its own
              * `size="md"` "Business verified" chip in the row beneath this card (see
              * seller-storefront.tsx), so this small copy said the same thing twice in one header,
              * which is exactly what the one-badge rule (owner, 2026-07-23) exists to prevent.
              *
              * ⚠️ SUPPRESSED BY `variant`, NOT DELETED. This component is a shared primitive and
              * the badge is a real claim — a document check eno actually performed. The PDP variant
              * has no chip row of its own, so removing it outright would silently drop the claim
              * from the surface that still needs it. The variant already encodes which context we
              * are in; a new prop would only restate it.
              *
              * ⚠️ THE PLAIN "Business" CHIP BELOW IS UNAFFECTED — it has no duplicate downstairs,
              * and it reports the account TYPE rather than a verification.
              */}
            {/**
              * ⛔ VERIFIED OR NOTHING. Owner, 2026-08-17: "dont show business badge anywhere if
              * businesses are not verified". The old `else` branch rendered a neutral "Business"
              * chip — the account TYPE, chosen at signup and checked by nobody — at the same size,
              * in the same row, as claims eno actually verified. That is the one confusion the
              * one-badge rule exists to prevent.
              *
              * ⛔ AND NOT ON THE STOREFRONT, WHERE IT IS ALREADY THERE 40px LOWER (owner, same day:
              * "on storefront remove top business verified badge"). The storefront renders its own
              * `size="md"` chip in the row beneath this card. Suppressed by `variant` rather than
              * deleted, because the PDP variant has no such row and still needs the claim.
              */}
            {seller.isBusiness && seller.businessVerified && variant !== 'storefront' && (
              <BusinessVerifiedBadge />
            )}
            {/* ⚠️ AN OFFICIAL PARTNER SHOWS NO TRUST SCORE (owner, 2026-08-13: "wherever the trust
                badge is replace with partner badge, official partners wont need trust score badge
                shown"). The two say different things and the partner claim is the stronger one: a
                trust score is EARNED behaviour, the partner badge is a company eno went and vetted,
                and showing both spends two chips to make one point. The badge renders above in the
                same row, so this branch simply withholds the second. */}
            {/* ⛔ …NOR DOES AN UNRATED STOREFRONT (no owner, not a partner — owner, 2026-10-01): its number
                is the schema default every importer-created storefront starts at, not anyone's record. */}
            {!seller.officialPartner && !seller.unrated && (
              <TrustScore score={trustScore} variant="mini" size="sm" href="/trust" className={miniSealWashClass(trustScore)} />
            )}
          </div>
          {strip.length > 0 && (
            <div className={cn('mt-1 overflow-x-clip', storefront && !phoneFacts && 'max-sm:hidden')}>
              {/* overflow-x-clip, not overflow-hidden: only the side edge has to cut the dots; the links' focus rings and
                  tap-44 areas above and below stay whole (2026-11-06 review). */}
              {/* 2026-11-06 audit: no wrapped line starts on a separator ("· 4,728 listings on eno.vn" on a phone). Every item
                  carries its dot, and the row is pulled 10px left (the dot's 4px box + the 6px gap) inside this clip, so the
                  first item of EVERY line — not only the first line — has its dot cut off at the edge. */}
              {/* 2026-11-07 audit: 14px in body ink from lg, as the PDP's shop row (pdp-shop-link.tsx): at 12px in the quietest grey
                  the storefront's activity and listing count read as fine print beside a desktop's title-size name. */}
              {/* A storefront's phone: the one facts line at 14/20, its stat leaves in the cells above (S1). */}
              <div className={cn('-ml-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground lg:text-sm lg:text-body', storefront && 'max-sm:min-h-5 max-sm:text-sm')}>
                {strip.map(({ node, stat }, i) => (
                  <span key={i} className={cn('inline-flex items-center gap-1.5', storefront && stat && 'max-sm:hidden')}>
                    <span aria-hidden className="w-1 shrink-0 text-center text-border">·</span>
                    {node}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ⛔ A STOREFRONT'S ROW IS [Chat now][Share][⋯] (owner, 2026-11-16 — hub Q21; UI climb r12 cook store-r12c S2, the storefront
          batch +0.90 / +0.50 over live, blind): Chat and Share an equal pair (STORE_PAIR), then the 44px ⋯ that holds Report and
          Block (storefront-more-menu.tsx) — `actions`, from the page. It replaces the page's right-hand column (10-06). */}
      {(onChat || (storefront && actions) || (variant === 'pdp' && storefrontHref)) && (
        <div data-store-actions={storefront ? '' : undefined} className="flex items-center gap-2">
          {onChat && (
            <Button
              type="button"
              variant="cta"
              size="none"
              onClick={onChat}
              // `active:scale-100` dropped (2026-07-21). It was added when this button was
              // migrated from a raw <button className="press …"> to ui/button, to stop the
              // primitive's `active:scale-[0.97]` compounding with .press's own shrink — a real
              // problem back when .press wrote `transform` (an independent property, so the two
              // MULTIPLIED to 0.931). .press now writes `scale` from @layer components, so the
              // button's 0.97 simply wins and there is nothing left to cancel; the class would
              // now genuinely suppress the press feel on this CTA instead of being a no-op.
              //
              // flex-1 on the PDP, where it splits the row with "View shop". On the storefront it
              // was ALONE — flex-1 stretched it edge to edge (owner 2026-07-23: "chat button too
              // long"); content width + padding read right. (owner, 2026-11-16, Q21) With Share
              // beside it the two are an equal pair (STORE_PAIR) in the card's max-w-md column;
              // a storefront card with no `actions` keeps the lone content-width button (STORE_LONE).
              className={cn('press gap-1.5 py-2.5', variant === 'pdp' ? 'flex-1' : storeMember(!!actions))}
            >
              <MessageCircle className="h-4 w-4" /> {tr('Chat now', 'Chat ngay')}
            </Button>
          )}
          {storefront && actions}
          {variant === 'pdp' && storefrontHref && (
            <Link
              href={storefrontHref}
              className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-foreground hover:bg-muted"
            >
              <Store className="h-4 w-4" /> {tr('View shop', 'Xem shop')}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
