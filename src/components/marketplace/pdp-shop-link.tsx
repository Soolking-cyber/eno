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
import { SITE_NAME } from '@/lib/edition'
import { brandForCopy } from '@/lib/app-review-gates'
import { useMounted } from '@/hooks/use-mounted'
import { PartnerListingCount } from './partner-listing-count'
import { LinkedShopChip } from './linked-shop-chip'
import type { SellerMetrics } from '@/lib/seller-metrics'
import { PILL_BOX, PILL_REST } from '@/components/ui/chip-style'

/** The strip's type, and the linked job's counsel line in the same type (batch 95): 12px in the quietest grey on a phone; from lg
 *  14px in body ink (2026-11-07 audit — at 12px a desktop read who it is dealing with as fine print). */
const STRIP_TYPE = 'text-xs text-muted-foreground lg:text-sm lg:text-body'

/** Shopee "shop on top": the SINGLE seller surface on the PDP, sitting directly above the media.
 *  It carries the full seller identity + trust (name, Business badge, trust score, Joined · rating ·
 *  reviews — "Joined" not below md when another item holds the line, batch 90) AND the "Shop >" jump to the storefront — so the old duplicate seller-card lower in the
 *  buy box is gone (its "Chat now" lives on in the ContactComposer). The whole strip is a div (not
 *  one anchor) so the trust chip and the Shop link can each be their own real link. */
export function PdpShopLink({ name, avatarColor, avatarUrl, isBusiness, businessVerified, officialPartner, href, metrics, className, linked = null, partnerListingCount = null, unrated = false, linkedShop = false, variant = 'row', head = false }: {
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
  /**
   * ⛔ 'card': THE RENTAL LISTING PAGE'S HOST CARD, ON A PHONE (owner-approved 2026-11-14, cook r05 "rental-c": "after this cook
   * round build all best options and deploy"; src/lib/rental-sheet.ts). It reverses, on that page only, batch 79's "Hosted by"
   * band ("⛔ ONE LINE, OVER IT ONLY") and the canon's "almost no boxes" (owner 2026-07-24): the seller is ONE bordered, raised
   * object — the app's one raised recipe, the header search pill's `shadow-raised` — the PDP's one approved box. Inside it,
   * the same nodes and words as the row, in this order (DOM = paint): the avatar (56, aria-hidden), the name (the h3 role,
   * ink) with its badge, the status line (14px muted: the strip minus the partner count, dots and all), and — only when the
   * partner count is shown — a hairline and the count as the card's one figure (PartnerListingCount `stat`, the same words)
   * with "Shop ›" at its end; without it "Shop ›" ends the first row. The status line always reserves one line (`min-h-5`):
   * "Active …" is client-only (the clock) and arrives after mount. Batch 90's partner "Joined" hide and a linked listing's
   * "not verified" counsel line are kept as they are. The page renders it only in its `md:hidden` phone slot.
   */
  /**
   * ⛔ 'band': THE GOODS LISTING PAGE'S SELLER BAND, ON A PHONE (owner-approved 2026-11-14, cook r06 "item": "after this cook
   * round build all best options and deploy"; src/lib/goods-sheet.ts). The row's nodes and words in one compact grid, DOM =
   * paint: the avatar (44, aria-hidden) spanning both lines; the name (the h3 role, ink) with its badge on the first line,
   * and "Shop" at its end as the shell's outline chip (36 drawn, 44 to tap, no chevron); the status strip (13px muted, the
   * row's dots and clip) on ONE line under them, running under the chip's column. ⛔ The neutral "Linked shop" chip is left out
   * whenever the strip carries "Linked listing: not verified by eno.vn" (`linked === 'listing'`): one says it — it reverses
   * there the 2026-10-01 "A LINKED SHOP SHOWS THE NEUTRAL 'Linked shop' CHIP IN THE PARTNER BADGE'S PLACE" (the row note
   * below), on the phone band only; desktop keeps it. The page renders it only in its `md:hidden` phone slot.
   */
  variant?: 'row' | 'card' | 'band'
  /**
   * A linked JOB's employer line in the page's head, under the role (owner-approved 2026-11-14, cook r06 jobs; page.tsx renders
   * this copy `md:hidden` right after the H1 and draws no phone band for the job): the name at the sub-section role (17/24 bold
   * ink) with an 18px chevron, the kept counsel line at the meta role (13/18). Its tap-44 sits on the head's own 8px gaps. Only
   * the job branch reads it; every other row ignores it.
   */
  head?: boolean
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
  // First in the strip: for a partner it is the fact that sizes the claim the P plate makes. ⛔ Never the item a phone drops
  // (K-TRUST-BADGE option D, owner 2026-09-30) — see `joinedAt` below.
  // Whether the partner's count heads the line — the one case a phone drops "Joined" (see `joinedAt` below).
  let partnerCountShown = false
  if (officialPartner && typeof partnerListingCount === 'number' && partnerListingCount > 0) { strip.push(<PartnerListingCount key="partner-count" n={partnerListingCount} />); partnerCountShown = true }
  // ⚠️ "VERIFIED", NOT "VETTED" / "KIỂM DUYỆT" (2026-10-01). "eno.vn chưa kiểm duyệt" read as the platform
  // admitting it had not done its statutory pre-display moderation; what is true, and what this line
  // means, is that eno.vn has not VERIFIED the source's ad or the business behind it.
  // ⚠️ App Store gate `site-brand-copy` (R7): on eno.forum (both apps render eno.vn since 2026-10-06) the verifier is
  // eno.forum, not eno.vn. brandForCopy keeps today's words until the owner switches it on.
  // Literal strings on both branches, not a template: the i18n harvest (gen-ui-strings) only collects
  // literals, and the nine machine-translated languages read their keys from it.
  const forumVerifies = brandForCopy(SITE_NAME) === 'eno.forum'
  /**
   * ⛔ A LINKED JOB NAMES ITS STOREFRONT ONCE, AS ONE LINK (UI climb batch 95, owner-approved 2026-11-14, decision 3, "the job
   * page says it once"; mock variants13/d2c3). It reverses, on a job only, the avatar + "Linked shop" chip row (owner
   * 2026-10-01) and "More jobs ›" (aria "More jobs from this board"): the employer's name, 16px bold in the foreground ink,
   * with a chevron, and under it the kept counsel line. Both call sites in page.tsx are unchanged, so the phone's "Hosted by"
   * band keeps its one hairline (section-hairline.test.tsx).
   * ⛔ "Linked job posting — not verified by eno.vn" STAYS, on every width (counsel-sensitive; the mock's one deliberate
   * difference from d2c): it is what tells a reader eno.vn has not vetted the employer.
   * A block-level link (flex, w-fit), never inside a run of text, so axe's link-in-text-block does not apply and it needs no
   * underline at rest. `tap-44` is centred on its 24px box, 10px into the band's 16px top padding (phone) or the buy box's
   * 16px gap (md+), and over the plain counsel line below — nothing else to press there.
   * Aggregators too (LinkedIn, TEAST…): the link names the BOARD, which is what /sellers/<id> opens; their H1 keeps the
   * employer (pdp-repeat-rows.ts roleOnlyHeading). Every other row — 'listing', partners, people, businesses — is below, as it was.
   */
  if (linked === 'job') {
    return (
      <div className={className}>
        <Link href={href} prefetch={false} className={cn('relative tap-44 flex w-fit max-w-full items-center gap-0.5 text-base font-bold text-foreground hover:underline active:opacity-60', head && 'text-t-h3')}>
          {/* The truncation is on the span, not the link: `overflow:hidden` on the link would clip tap-44's ::before (see below). */}
          <span className="min-w-0 truncate">{name}</span>
          <ChevronRight className={cn('h-4 w-4 shrink-0', head && 'size-4.5')} aria-hidden />
        </Link>
        <p className={cn('mt-1', head ? 'mt-0 text-t-meta text-muted-foreground' : STRIP_TYPE)}>
          {forumVerifies
            ? tr('Linked job posting — not verified by eno.forum', 'Tin tuyển dụng dẫn link — eno.forum chưa xác minh')
            : tr('Linked job posting — not verified by eno.vn', 'Tin tuyển dụng dẫn link — eno.vn chưa xác minh')}
        </p>
      </div>
    )
  }
  // ': ', not ' — ' (owner-approved 2026-11-14, cook r06 "item": no em dashes in UI copy; punctuation only, no word changed).
  if (linked === 'listing') strip.push(forumVerifies
    ? tr('Linked listing: not verified by eno.forum', 'Tin đăng dẫn link: eno.forum chưa xác minh')
    : tr('Linked listing: not verified by eno.vn', 'Tin đăng dẫn link: eno.vn chưa xác minh'))
  else if (responseBucket.key) strip.push(tr(responseBucket.en, responseBucket.vi))
  if (!linked && lastSeen.key) strip.push(tr(lastSeen.en, lastSeen.vi))
  /**
   * ⛔ A PHONE DROPS "Joined <year>" ONLY FOR AN OFFICIAL PARTNER WHOSE LISTING COUNT HEADS THE LINE (UI climb batch 90,
   * 2026-11-14; owner 2026-11-13: "reduce lines … super clean, minimal wording, only what's necessary"; blind A/B on live
   * eno.vn — measured on the GoPlus and Blvck pages — Opus +0.14/+0.12, GPT +0.17, trust ±0). There "5,379 listings on eno.vn"
   * already sizes the shop (K-TRUST-BADGE option D, owner 2026-09-30) and the account's year adds nothing, so below md the
   * strip keeps one line, as Airbnb's host row does. ⛔ NEVER FOR A PERSON: a private seller's "Joined" is the one item that
   * tells a buyer the account is new — codex and Opus both refused hiding it (2026-11-14). The count is server-rendered, so
   * the line is held in the server HTML and nothing shifts when the client-only "Active …" arrives. Order unchanged (as
   * seller-card.tsx); md and up print it as before.
   */
  const joinedAt = !linked && partnerCountShown ? strip.length : -1
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

  // ⚠️ PARTNER REPLACES TRUST, and a linked shop shows its neutral chip — the notes at the row's badge below.
  const badge = officialPartner
    ? <PartnerBadge />
    : linkedShop ? <LinkedShopChip />
    : linked || unrated ? null : <TrustScore score={trustScore} variant="mini" size="sm" href="/trust" className={miniSealWashClass(trustScore)} />

  if (variant === 'band') {
    // The counsel line in the strip already says the shop is linked and unverified: the chip would say it twice.
    const bandBadge = linked === 'listing' && linkedShop ? null : badge
    return (
      <div data-seller-band="" className={cn('grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3', className)}>
        {/* The avatar and the name both open the storefront (owner, 2026-07-24); the avatar is the aria-hidden twin — the row's
            note below. */}
        <Link href={href} prefetch={false} aria-hidden tabIndex={-1} className="col-start-1 row-span-2 row-start-1 shrink-0 self-center rounded-full active:opacity-60" title={officialPartner ? tr('Official partner', 'Đối tác chính thức') : undefined}>
          <Avatar name={name} url={avatarUrl} color={avatarColor} size="lg" className="size-11" />
        </Link>
        <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-1.5 self-end">
          {/* `truncate` on the span, `tap-44` on the link: the row's note below. */}
          <Link href={href} prefetch={false} className="relative min-w-0 tap-44 text-t-h3 text-foreground hover:underline active:opacity-60"><span className="block truncate">{name}</span></Link>
          {officialPartner && <span className="sr-only">{tr('Official partner', 'Đối tác chính thức')}</span>}
          {isBusiness && businessVerified && <BusinessVerifiedBadge />}
          {bandBadge}
        </div>
        {/* The shell's chip: 36px drawn (`-my-1.5` gives 12px back to the 24px line), 44 to tap (PILL_BOX's tap-44). */}
        <Link href={href} prefetch={false} aria-label={tr('Visit shop', 'Vào gian hàng')} className={cn(PILL_BOX, PILL_REST, 'col-start-3 row-start-1 -my-1.5 flex shrink-0 items-center self-center transition-colors')}>
          {tr('Shop', 'Gian hàng')}
        </Link>
        {strip.length > 0 && (
          <div className="col-span-2 col-start-2 row-start-2 self-start overflow-x-clip">
            {/* The row's dot geometry: every item carries its dot, the row sits 10px left, so each line's first dot is cut. */}
            <div className="-ml-2.5 flex flex-wrap items-center gap-x-1.5 text-t-meta text-muted-foreground">
              {strip.map((node, i) => (
                <span key={i} className={cn('inline-flex items-center gap-1.5', i === joinedAt && 'max-md:hidden')}>
                  <span aria-hidden className="w-1 shrink-0 text-center text-border">·</span>
                  {node}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (variant === 'card') {
    // The status line: the strip without the partner count, which is the card's figure below (the same words, never twice).
    const status = partnerCountShown ? strip.slice(1) : strip
    const statusJoinedAt = partnerCountShown ? joinedAt - 1 : joinedAt
    // "Shop ›": 700 14 in the accent, a 44px-tall target (the row's pill is 28 and leans on tap-44).
    const shop = (
      <Link
        href={href}
        prefetch={false}
        aria-label={tr('Visit shop', 'Vào gian hàng')}
        className="group relative tap-44 flex min-h-11 shrink-0 items-center gap-0.5 text-sm font-bold text-accent-foreground hover:underline active:opacity-60"
      >
        {tr('Shop', 'Gian hàng')}
        <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
      </Link>
    )
    return (
      <div data-host-card="" className={cn('rounded-2xl border border-line-strong bg-background p-4 shadow-raised', className)}>
        <div className="flex items-center gap-4">
          {/* The avatar and the name both open the storefront (owner, 2026-07-24); the avatar is the aria-hidden twin — the
              row's note below. */}
          <Link href={href} prefetch={false} aria-hidden tabIndex={-1} className="shrink-0 rounded-full active:opacity-60" title={officialPartner ? tr('Official partner', 'Đối tác chính thức') : undefined}>
            <Avatar name={name} url={avatarUrl} color={avatarColor} size="lg" className="size-14" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* `truncate` on the span, `tap-44` on the link: the row's note below. */}
              <Link href={href} prefetch={false} className="relative min-w-0 tap-44 text-t-h3 text-foreground hover:underline active:opacity-60"><span className="block truncate">{name}</span></Link>
              {officialPartner && <span className="sr-only">{tr('Official partner', 'Đối tác chính thức')}</span>}
              {isBusiness && businessVerified && <BusinessVerifiedBadge />}
              {badge}
            </div>
            {/* One line held from the server HTML (`min-h-5`), so the client-only "Active …" lands in a box that is there. The
                dots and the clip are the row's (each item carries its dot; a line's first dot is cut). */}
            <div className="mt-0.5 min-h-5 overflow-x-clip">
              <div className="-ml-2.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                {status.map((node, i) => (
                  <span key={i} className={cn('inline-flex items-center gap-1.5', i === statusJoinedAt && 'max-md:hidden')}>
                    <span aria-hidden className="w-1 shrink-0 text-center text-border">·</span>
                    {node}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {!partnerCountShown && shop}
        </div>
        {partnerCountShown && (
          <div className="mt-4 flex items-end justify-between gap-4 border-t border-border pt-4">
            <PartnerListingCount n={partnerListingCount as number} layout="stat" />
            {shop}
          </div>
        )}
      </div>
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
      {/* prefetch={false} on all three links to the shop (speed plan item 7, measured on production 2026-10-16): the
          row is on every PDP, twice, and /sellers/<id> is a real render (`private, no-store`) — auto prefetch cost
          two origin renders per listing view, for a link most visitors never take. */}
      <Link href={href} prefetch={false} aria-hidden tabIndex={-1} className="shrink-0 rounded-full active:opacity-60" title={officialPartner ? tr('Official partner', 'Đối tác chính thức') : undefined}>
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
          <Link href={href} prefetch={false} className="relative min-w-0 tap-44 text-sm font-bold text-foreground hover:underline active:opacity-60 lg:text-base"><span className="block truncate">{name}</span></Link>
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
              src/lib/linked-seller.ts). A linked reference listing never showed one either.
              (The goods page's phone band leaves the chip out beside its "Linked listing: not verified" line: owner-approved
              2026-11-14, cook r06 "item" — `variant="band"` above. This row, desktop's, keeps it.) */}
          {badge}
        </div>
        {strip.length > 0 && (
          <div className="mt-1 overflow-x-clip">
            {/* overflow-x-clip, not overflow-hidden: only the side edge has to cut the dots; the links' focus rings and
                tap-44 areas above and below stay whole (2026-11-06 review). */}
            {/* 2026-11-06 audit: no wrapped line starts on a separator — seller-card.tsx's strip, the same clip: every item carries
                its dot, and the row sits 10px left (the dot's 4px box + the 6px gap) inside this box, so each line's first dot is cut. */}
            {/* 2026-11-07 audit: from lg the strip is 14px in body ink under a 16px name, and "Shop ›" 14px: at 12px in the quietest
                grey a desktop read who it is dealing with as fine print. A phone keeps 12px. The dot geometry above is size-free. */}
            <div className={cn('-ml-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5', STRIP_TYPE)}>
              {strip.map((node, i) => (
                <span key={i} className={cn('inline-flex items-center gap-1.5', i === joinedAt && 'max-md:hidden')}>
                  <span aria-hidden className="w-1 shrink-0 text-center text-border">·</span>
                  {node}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <Link
        href={href}
        prefetch={false}
        // (A linked job never reaches here since batch 95: its one employer link is the branch above.)
        aria-label={tr('Visit shop', 'Vào gian hàng')}
        // `relative tap-44`: 64x28 → a 44px-tall hit area around the same pill. `active:bg-secondary`
        // is the press — the hover wash, shown on touch too, in 60ms; the release eases back at the
        // transition's normal 150ms, so the press reads instantly and the let-go does not flash.
        className="group relative tap-44 flex shrink-0 items-center gap-0.5 rounded-xl px-2 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-secondary active:bg-secondary active:duration-[60ms] lg:text-sm"
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

