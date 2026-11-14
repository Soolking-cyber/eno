'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
import { memo, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { PhotoFill } from './photo-fill'
import { useRouter } from 'next/navigation'
import { ArrowRight, MapPin, MessageCircle, Tag, Zap } from '@/components/ui/icons'
import { PartnerBadge } from './partner-badge'
import { Badge } from './card-badges'
import { Badge as UiBadge } from '@/components/ui/badge'
import { Price } from './price'
import { priceUnitSuffix } from '@/lib/price-unit'
import { CategoryIcon } from './category-icons'
import { FavoriteHeart } from './favorite-heart'
import { IdentityVerifiedMark } from './identity-verified-mark'
import { useLanguage, Tr } from '@/context/language-context'
import { useLocalized, PostedAgo } from './listing-content'
import { timeAgo, type SerializedListingCard } from '@/lib/types'
import { cardTitle, cardJobType, rowTitle } from '@/lib/card-title'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { formatMoneyFull, formatCount, moneyLocale, dropPercent, cardCompactAbove } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/auth-context'
import { quickActionSignIn, stashQuickCompose } from '@/lib/quick-contact'
import { openerVoice, quickChatOpener } from '@/lib/teachers/first-message'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tooltip } from '@/components/ui/tooltip'
import { isModifiedClick } from '@/lib/plain-click'
import dynamic from 'next/dynamic'

/**
 * THE OFFER SLIDER LOADS WHEN THE OFFER CONTROL IS OPENED (2026-11-10). It is drawn only after "Make an offer" is pressed,
 * a control that exists from `sm` up, yet its code (the app slider and what it stands on: 8.5 KB compressed, measured in
 * the built chunk) was two thirds of this row's weight and rode along wherever a row was drawn, a phone's list included.
 * The placeholder is the slider's own box (`h-5`, the width the call site gives it), so the cluster does not move when it
 * arrives; the button asks for the chunk on pointer-enter and focus, so a press usually finds it there.
 */
const loadOfferSlider = () => import('@/components/marketplace/eno-slider')
const EnoSlider = dynamic(() => loadOfferSlider().then((m) => m.EnoSlider), { ssr: false, loading: () => <span aria-hidden className="block h-5 w-28" /> })

export type CompactListingRowProps = {
  listing: SerializedListingCard
  index: number
  onOpen: (l: SerializedListingCard) => void
  onPrefetch: (id: string) => void
  onLocate: (id: string) => void
  /**
   * The row is in the SERVER'S HTML (a category page's phone list, seller-listings.tsx `rowsOnPhone`; the explorer's rows
   * are `ssr: false` and leave this off). The posted time then goes through <PostedAgo inHtml>, the card's own
   * hydration-safe clock: a cached page's "2d ago" is a day old by the time a reader hydrates it.
   */
  clockInHtml?: boolean
  /** The thumbnail never loads eagerly: this list may be the one a wider screen hides, and an eager image loads hidden or not. */
  lazyThumb?: boolean
}

/** A floor under a navigation that never arrives — the same 4s as ListingCard's. */
const PENDING_MAX_MS = 4000

// Compact list row (bonbanh-style): thumbnail + title + price/location/trust meta
// + locate/favorite actions. Memoized — compact is the default view mode, so every
// row would otherwise re-render on any explorer state change (hover, page, filters).
// All callbacks passed in are stable useCallback handlers in the explorer.
export const CompactListingRow = memo(function CompactListingRow({ listing: l, index, onOpen, onPrefetch, onLocate, clockInHtml = false, lazyThumb = false }: CompactListingRowProps) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const cover = l.images[0]
  const teacher = l.listingType === TEACHER_LISTING_TYPE
  // Embedded per-language title (titleI18n, warmed at post time) → instant, no
  // API call; falls back to lazy MT for langs without an embedded value.
  // ⛔ …EXCEPT A TEACHER'S, WHICH IS THEIR NAME: never machine-translated, in any language (ListingCard's rule, 2026-10-16
  // — the "Identity verified" tick sits beside it). The hook runs with '', its no-op; the name prints as stored.
  const localizedTitle = useLocalized(teacher ? '' : l.title, teacher ? null : l.titleVi, teacher ? null : l.titleI18n)
  const displayTitle = teacher ? l.title : localizedTitle
  // Where it is: the district, else the city. ⚠️ A TEACHER ABROAD HAS NEITHER (teacher onboarding redesign, 2026-10-08 —
  // city '' by design, projection.ts teacherHome): their location is the fact ("Not in Vietnam yet · Online"), so it
  // stands in; and a row with no place at all draws no divider beside nothing.
  const place = l.district || l.city || (teacher ? l.location : '')
  /**
   * ⛔ A JOB ROW IS TEXT BETWEEN HAIRLINES, WITH NO TILE (UI climb batch 78; owner, 2026-11-12: "continue the ui ux
   * improvement towards 10/10"). Blind A/B on the live Jobs list, phone: codex 7.07 → 7.46 (+0.39, trust +0.1), Opus
   * 6.60 → 7.15 (+0.55, trust +0.3). This view is the one a job hunter switches to (Indeed, VietnamWorks and TopCV all list
   * jobs as rows). It REPLACES batch 54/60's tile (UI climb, 2026-11-10): a linked job's thumbnail was the employer's
   * initials on the tint, or the category glyph with no employer stored, and both judges read every one of them as a
   * placeholder ("a grey two-letter monogram tile or a generic briefcase icon"). "Never the poster" still holds — the
   * importer's 1200px poster at 56px is a picture of words nobody can read (the PDP dropped it on 2026-09-30; the grid card
   * keeps it, where it is large enough to read) — and now there is nothing in its place. So, a JOB only (`job`, linked or
   * an employer's own), and nothing else in this file:
   *   · NO THUMBNAIL: not the initials, not the glyph, not a photo (`!job &&` around the block below). The role takes the
   *     width, and on a phone it starts on the page gutter (no side padding below `sm`);
   *   · the ROLE is the strongest line, one step up the ramp: the title `text-base` semibold, snug leading;
   *   · the price slot prints the EMPLOYER of a no-pay linked job (the card's `jobMeta`, the same slot in <Price>), and the
   *     title then drops the importer's " — <employer>" tail (card-title.ts `employer`); the link keeps the full title;
   *   · a no-pay slot (the employer, an employer's own "Salary: negotiable") is regular `text-sm` in ink-3; a real salary is
   *     the only coloured thing, bold and no larger than the title (both blind judges on the first cut, 2026-11-10: "the job
   *     title is the lightest text while the line under it is larger and heavier");
   *   · ⛔ A LINKED JOB WITH NO PAY AND NO EMPLOYER PRINTS NO SLOT AT ALL (`salaryLine`): "Salary: see posting" told a list
   *     reader nothing, on every such row. The job PAGE's "Salary: see the original posting" is untouched, <Price> keeps its
   *     words for every other surface, and an employer's own job keeps "Salary: negotiable" (price.tsx's ⛔ `jobMeta` rule);
   *   · the phone line ends with the job type the card's info line prints ("Hanoi · 5d ago · Full-time");
   *   · 12px above and below the text, and the heart (or chat) level with the title's first line. A LIST of jobs is ruled
   *     by the canon's hairline between its rows (docs/design-language.md §3b, "lines, not boxes"): the CONTAINER draws it
   *     (`JOB_ROWS_RULED`, compact-listing-row-skeleton.tsx), so a job row inside a mixed list draws no stray line;
   *   · on a phone the title takes the 36px the row holds for a chat button a linked job never has, when no chip hangs there.
   * ⚠️ compact-listing-row-skeleton.tsx carries a job row's numbers in its `job` variant (one title line + the employer line
   * + the phone's place line): change both or neither.
   */
  const job = l.listingType === 'job'
  // ⛔ ONE MEANING OF "LINKED" IN THIS ROW: THE FLAG, the test the chat slot below has always used (commit review, two rounds:
  // inferring it for a payload without the flag made a new half-linked state each time). A row whose payload carries no
  // flag gets none of the LINKED treatment (the employer slot, the shortened title, the chat slot's width).
  // What every job row gets, linked or not, is no thumbnail, the type on its phone line and the role as the strongest line.
  const linkedJob = job && l.isPartnerBooking === true
  const jobMeta = linkedJob && l.price === 0 ? (l.jobEmployer || null) : undefined
  // Only when the slot really prints an employer does the card's shortening run: every other row keeps its stored title (commit
  // review) — in the card's display grammar since batch 87 (rowTitle: no shouting, no "[Job Opening]", no trailing ".").
  const titleInput = { title: displayTitle, lang, sellerId: l.sellerId, categorySlug: l.category?.slug, listingType: l.listingType, condition: l.condition, location: l.location }
  const lineTitle = jobMeta ? cardTitle({ ...titleInput, employer: jobMeta }) : rowTitle(titleInput)
  const jobTypeText = job ? cardJobType(l.jobType, tr) : null
  // `null` is exactly a linked job at 0 with no employer stored, whose slot would say "Salary: see posting" (see above).
  const salaryLine = jobMeta !== null
  const drop = l.prevPrice != null ? dropPercent(l.prevPrice, l.price) : null
  // Anything on the meta line before the place: without it the sm+ divider would stand beside nothing, and on a phone, where
  // every other thing on that line is `sm:` only, the line would be an empty 2px gap.
  const metaLead = salaryLine || l.urgent || !!drop
  // No chip rides this row's title line (a linked job shows no trust score; a partner's or a sponsored one keeps its chip and the slot).
  const jobTitleTakesChatSlot = linkedJob && !l.seller.officialPartner && !l.isSponsored
  // Quick-offer: pressing the Tag rolls a discount slider open to the LEFT of the
  // action icons; confirm hands off to the composer's offer mode (?offer=N#contact).
  const [offer, setOffer] = useState<number | null>(null)
  const { user, loading: authLoading, openSignIn, accountType } = useAuth()
  const quickGo = (opts: { body?: string; offerAmount?: number | null }) => {
    // A guest's quick action is remembered and finished on the listing's page after sign-in (UX3 J5).
    if (!user) { if (!authLoading) openSignIn({ listingTitle: displayTitle, listingImage: cover ?? null, ...quickActionSignIn(l, opts) }); return }
    if (stashQuickCompose(l, opts)) router.push('/messages/pending')
    else router.push(`/listings/${l.id}#contact`)
  }

  /**
   * ⛔ THE PRESS BELONGS TO WHAT WAS PRESSED, AND IT HOLDS UNTIL THE NEXT SCREEN PAINTS — ListingCard's
   * two fixes, which this row never got (listing-card.tsx has the measurements):
   * · `has-[button:active]:scale-100` — `:active` matches ANCESTORS, so tapping the heart, offer, chat
   *   or map button (each stops propagation; none of them OPENS the listing — chat goes to the thread)
   *   also shrank the whole row as if it were opening. Each now presses itself instead (`press`; they
   *   anchor no popup, which is why IconButton leaves the press to the caller).
   * · `pending` — `onOpen` is a router push and the PDP paints 0.5–2.3s after the tap, while `:active`
   *   released at touchend; the row looked untouched and invited a second tap. It now stays pressed
   *   until this row unmounts (a 4s floor frees it if the push never lands), and a second tap is a
   *   no-op instead of a duplicate push.
   */
  const [pending, setPending] = useState(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pendingTimer.current) clearTimeout(pendingTimer.current) }, [])
  const open = () => {
    if (pending) return
    setPending(true)
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(() => { pendingTimer.current = null; setPending(false) }, PENDING_MAX_MS)
    onOpen(l)
  }

  return (
    <div
      data-sid={l.sellerId}
      // A modifier or middle click on the row's link is the browser's new tab or window: the row must not open it here too.
      onClick={(e) => { if (!isModifiedClick(e)) open() }}
      onMouseEnter={() => onPrefetch(l.id)}
      onTouchStart={() => onPrefetch(l.id)}
      data-pending={pending || undefined}
      // A job (batch 78, the note on `job`): top-aligned, 12px above and below the text, no side padding on a phone so the
      // role sits on the page gutter; from `sm` the usual side padding, so the hover fill a pointer gets still has an inset.
      className={cn(
        'group relative flex rounded-xl text-left transition-[background-color,scale] duration-100 hover:bg-muted active:scale-[0.99] has-[button:active]:scale-100 data-pending:scale-[0.99] cursor-pointer',
        job ? 'items-start gap-2 py-3 sm:pl-1.5 sm:pr-1' : 'items-center gap-3 p-1.5 pr-1',
      )}
    >
      {/* ⛔ THE ROW'S LINK (owner, 2026-11-07: "on desktop clicking right and opening in new tab doesnt work"). The row was
          a clickable div with no href anywhere in it: no right-click "Open link in new tab", no Cmd/Ctrl or middle click,
          no URL in the status bar, and no keyboard stop at all. ListingCard's shape: a real <a> stretched over the row
          (z-[1]), with the photo and the text UNDER it and every control ABOVE it (the actions cluster and the chips that
          carry their own tooltip or link, z-[2]), so no control is nested in the link. A plain click is prevented here
          and bubbles on to the row's onClick, which opens the listing in the app (and keeps the pressed state); a
          modifier or middle click is the browser's own, untouched, and the row's onClick leaves it alone.
          draggable={false}, as on the card. */}
      <a
        href={`/listings/${l.id}`}
        aria-label={displayTitle}
        data-row-link=""
        draggable={false}
        onClick={(e) => { if (!isModifiedClick(e)) e.preventDefault() }}
        className="absolute inset-0 z-[1] rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {/* Thumbnail — SQUARE, small enough that the row reads as one line.
          ⚠️ IT WAS `h-14 w-16` — 64×56 — AND IT WAS THE ONLY NON-SQUARE PRODUCT PHOTO LEFT IN THE
          APP (owner, 2026-08-12: "make sure all product images are square"). Every other surface
          is square, and the post wizard then cropped uploads to square, so a 7:8 box did not
          letterbox a square source — `object-cover` SHAVED IT, ~12% off the top and bottom of every
          thumbnail in the default browse view. ⚠️ SINCE 2026-11-12 UPLOADS ARE NO LONGER SQUARED (owner:
          "do not crop but fit in"; use-post-media.ts), so a new photo is often NOT square and
          the photo is shown whole (object-contain) over a blurred fill (photo-fill.tsx); the box stays square. The width came down rather than the
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
          same way; there is no inherited styling to rely on.
          ⛔ A JOB ROW DRAWS NONE (batch 78, owner 2026-11-12; the note on `job` above): not the employer's initials, not the
          category glyph, not a photo. The guard wraps the whole block and nothing else; every other row's tile is as it was. */}
      {!job && (
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
          <>
            {/* ⛔ THE WHOLE PHOTO OVER ITS OWN BLURRED FILL (owner, 2026-11-12; photo-fill.tsx): same file, no second request.
                A teacher's portrait stays cover, as on <ListingCard>: it is a face, not a product photo. */}
            {!teacher && <PhotoFill src={cover} sizes="56px" blur="small" loading={!lazyThumb && index < 6 ? 'eager' : 'lazy'} />}
            <Image
              src={cover}
              alt={displayTitle}
              fill
              sizes="56px"
              // ⚠️ THE PHOTO DOES NOT SCALE ON HOVER — the owner's rule for every listing photo (2026-08-05,
              // written out on ListingCard's <Image>). This thumbnail was the one surface it never reached.
              className={teacher ? 'object-cover' : 'object-contain'}
              loading={!lazyThumb && index < 6 ? 'eager' : 'lazy'}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-tint">
            <CategoryIcon name={l.category.icon} className="h-5 w-5 text-ink-4" />
          </div>
        )}
      </div>
      )}

      {/* Title (up to two lines) on top, then price · location · trust score on a tight meta line —
          and on phones, where that line has room for the price alone, place · time under it. */}
      <div className="min-w-0 flex-1">
        {/* On a phone the trust badge rides the TITLE line, not the price line. The
            column is only ~162px on a 390pt device, and the badge cost ~40px of it —
            enough that a real property price (9,500,000,000 VND needs ~195px) got
            CLIPPED by the overflow guard below. A clipped price is a wrong price, so
            the badge yields and the price owns the whole line. At sm+ there is room,
            so it returns to the meta line and keeps the vertical badge column the
            owner picked on 2026-07-14. */}
        {/* ⚠️ TWO LINES, NOT `truncate`. Measured at 390px (2026-09-29): 23 of 24 titles run past one
            line even in today's wider 206px column, so a one-line row was cutting nearly every title
            mid-phrase — usually before the district or the spec that tells two listings apart.
            `items-start` pins the trust chip beside the FIRST line when the title wraps. */}
        <div className="flex min-w-0 items-start gap-x-2">
          {/* min-w-0: beside a teacher's "Identity verified" tick (a non-shrinking flex sibling) a long name must clamp,
              not push the row's chips out — commit gate, 2026-10-16. Harmless on every other row. */}
          {/* A job's role is one step up the ramp (batch 78): 16px on a snug 22px line, so the skeleton's job variant holds 22px.
              ⚠️ The size BEFORE `leading-snug`, in each branch: tailwind-merge drops a leading that a later `text-<size>`
              follows (a size carries its own line height), which would leave every row on the size's default line. */}
          <h4 className={cn('line-clamp-2 min-w-0 text-foreground group-hover:underline', job ? 'text-base leading-snug font-semibold' : 'text-sm leading-snug font-medium')}>
            {lineTitle}
          </h4>
          {/* "Identity verified" (owner, 2026-10-15) — the card's tick, right after the name it vouches for, on the first
              line (`items-start` + the glyph's 2px drop); a marked TEACHER row only, from the server's boolean. Before the
              chips, which hang `ml-auto` off the right edge as before. */}
          {teacher && l.identityMark === true && <IdentityVerifiedMark className="relative z-[2] mt-0.5" />}
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
          {/* ⛔ …and NO TRUST CHIP ON A REFERENCE LISTING (a portal import or a linked job): eno.vn
              never rated the source, and its storefront's 100 is a ranking default — ListingCard has
              the full note. Partner first, exactly as there, so a partner reads the same in both views. */}
          {/* "Quảng cáo / Ad" on a commission-bearing row (owner, 2026-10-01) — the grid card's marker, in
              this row's two chip slots (phone: beside the title; sm+: in the meta line), hidden with them
              while a quick offer is open. A linked rental, vehicle hire or linked job carries none. */}
          {l.isSponsored && <UiBadge variant="neutral" size="sm" data-ad-marker="" className={cn('ml-auto shrink-0 sm:hidden', offer !== null && 'hidden')}>{tr('Ad', 'Quảng cáo')}</UiBadge>}
          {/* Ad wins over the partner plate when both apply — ListingCard has the note; the PDP and storefront keep it.
              The status is still ANNOUNCED (sr-only, zero width): this row has no other partner line. One slot only. */}
          {l.seller.officialPartner ? (
            l.isSponsored
              ? <span className="sr-only">{tr('Official partner', 'Đối tác chính thức')}</span>
              : <PartnerBadge className={cn('relative z-[2] ml-auto shrink-0 sm:hidden', offer !== null && 'hidden')} />
          ) : null}
          {/* ⛔ NO TRUST NUMBER ON A BROWSE SURFACE (owner, 2026-11-10; listing-card.tsx has the note): the mini chip that
              hung here, and its twin on the sm+ meta line below, are gone. The partner plate and the Ad label keep both slots. */}
        </div>
        {/* min-w-0 is load-bearing: without it this flex row can never shrink below
            its content, so a wide price (shrink-0, and it must stay shrink-0 — a
            truncated price is a wrong price) overflowed the column and painted
            straight over the action icons to its right. (Below sm the price may
            now WRAP instead — never truncate; see the note on it.) */}
        <div className={cn('mt-0.5 flex min-w-0 items-center gap-x-2 overflow-hidden text-xs text-muted-foreground', !metaLead && 'max-sm:hidden')}>
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
          {/* ⛔ EXCEPT ON A RATE: "/ month" is what separates a rent from a sale price, so hiding it
              below sm changed the meaning of the number (price.tsx's `unit` doc forbids exactly that
              on cards). The row can afford it now that the map button yields its 36px on phones.
              Since 2026-10-14 every RATE keeps it — an hourly service's or a teacher's "/ giờ", a job's
              "/ tháng" — read from the unit itself (priceUnitSuffix), not from the intent.
              ⚠️ AND BELOW sm THE PRICE MAY WRAP, NOT CLIP — `shrink-0` only from sm up. With the unit
              shown, a commercial rent outgrows a phone column: measured at 360px, "1,368,000,000 đ /
              month" ran 20px past the 176px column (54–60px at 320) and `overflow-hidden` below cut
              it to "/ mo…". Shrinkable, it breaks at <Price>'s own opportunities — before "/ month",
              or between the digits and "đ" — so the whole figure stays readable on two lines. Below
              sm nothing else on this line competes for the width (the place and the trust chip are
              sm-only here), so an ordinary price never wraps; from sm up it stays one line, as the
              note above requires. */}
          {/* A JOB's slot (batch 78): `text-sm` on its own 20px line; at 0 (the employer, "Salary: negotiable") regular weight
              in ink-3, a real salary keeps <Price>'s bold price ink. ⛔ Not drawn at all for a linked job with no pay and no
              employer (`salaryLine`; the note on `job`) — <Price>'s words stay as they are everywhere else. */}
          {/* The card's price form (batch 94, owner-approved 2026-11-14, decision 4): `cardCompactAbove`, so a sale price, a rent
              and a salary of a million or more read in millions — "12.8M đ", "8.5M đ / month", "8,5 triệu / tháng" (/c/jobs
              "80M đ / month" in the approved mock). Every digit under a million or when not a whole thousand; the PDP keeps
              them all. The unit, dual="sm", 16px and the wrap-never-clip above are unchanged. */}
          {salaryLine && <Price native price={l.price} currency={l.currency} priceUnit={l.priceUnit} listingType={l.listingType} linked={l.isPartnerBooking} compact compactAbove={cardCompactAbove(l)} dual="sm" unit={l.listingType === 'rent' || priceUnitSuffix(l.priceUnit) ? true : 'sm'} jobMeta={jobMeta} cardWords className={job ? cn('text-sm leading-5 sm:shrink-0', l.price === 0 && 'font-normal text-ink-3') : 'text-base sm:shrink-0'} />}
          {/* Urgent — RIGHT of the price (user-picked 2026-07-14): the bare black
              bolt on EVERY breakpoint. The desktop chip (outline + "Urgent" word)
              is gone — one glyph reads the same everywhere and keeps the one-line
              meta row quiet. */}
          {l.urgent && (
            <Zap
              className={cn('h-3.5 w-3.5 shrink-0 fill-current text-foreground', offer !== null && 'hidden')}
              aria-label={l.listingType === 'job' ? tr('Urgent hiring', 'Tuyển gấp') : tr('Urgent', 'Bán gấp')}
            />
          )}
          {drop && (
            <Badge kind="drop" variant="inline" className="shrink-0">{drop}</Badge>
          )}
          {/* Address text on this line is desktop-only (user-picked: it truncated uselessly
              beside the price on phones). Phones get it on its own line below instead.
              The divider only when something stands before it (`metaLead`). */}
          {place && metaLead && <span className="hidden h-3 w-px shrink-0 bg-border sm:block" />}
          {place && <span className="hidden truncate sm:inline"><Tr text={place} /></span>}
          {/* Demand proof (≥3 contact reveals) — desktop only: the one-line meta row
              can't spare the width on mobile. */}
          {l.contactCount >= 3 && (
            <span className="hidden shrink-0 text-2xs text-muted-foreground tabular-nums sm:inline">
              {fillTemplate(tr('{n} contacted', 'Đã liên hệ {n}'), '{n} contacted', { n: String(formatCount(l.contactCount, moneyLocale(lang))) })}
            </span>
          )}
          {l.isSponsored && <UiBadge variant="neutral" size="sm" data-ad-marker="" className={cn('ml-auto hidden shrink-0 sm:inline-flex', offer !== null && 'sm:hidden')}>{tr('Ad', 'Quảng cáo')}</UiBadge>}
          {l.seller.officialPartner ? (
            l.isSponsored ? null : <PartnerBadge className={cn('relative z-[2] ml-auto hidden shrink-0 sm:flex', offer !== null && 'sm:hidden')} />
          ) : null}
        </div>
        {/* PHONES: where and how fresh, on a line of its own — the facts the desktop meta line carries
            beside the price, which a phone row has no width for there. It stands in for the map button
            that yields below sm (the row's only location signal on a phone used to be that glyph).
            ⚠️ `timeAgo` DIRECTLY, NOT <PostedAgo>: this row is `ssr: false` (listings-explorer.tsx), so
            there is no server HTML to mismatch, and the mount-gated form would flash an ISO date for a
            frame first. Same function, so the same string the card and the PDP print.
            ⚠️ …UNLESS THE ROW IS SERVER-RENDERED (`clockInHtml`, a category page's phone list): then <PostedAgo inHtml>, as on the card. */}
        <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">
          {place ? <><Tr text={place} />{' · '}</> : null}
          {clockInHtml ? <PostedAgo iso={l.postedAt} inHtml /> : timeAgo(l.postedAt, lang)}
          {jobTypeText ? <>{' · '}{jobTypeText}</> : null}
        </p>
      </div>

      {/* Actions paired together (not stranded): offer + quick-chat + locate + favorite.
          The offer slider rolls open leftwards, replacing nothing — icons stay put.
          On a job row (top-aligned, batch 78) the cluster rises 6px into the row's 12px padding, so the 20px glyph in each
          36px button centres on the title's first 22px line (24px from the row's top against the line's 23px). */}
      <div className={cn('relative z-[2] flex shrink-0 items-center', job && '-mt-1.5')} onMouseLeave={() => setOffer(null)}>
        {offer !== null && (
          // A div, not a span: <EnoSlider> renders a <div> root, which is not
          // phrasing content — a span wrapper would be invalid nesting. Same
          // classes, same flex layout, identical render.
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex min-w-0 items-center gap-2 py-1 pr-1 animate-in slide-in-from-right-2 fade-in duration-150 ease-out"
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
              // A guess at what comes next, so a failure is nobody's error: the press itself asks again.
              onPointerEnter={() => { loadOfferSlider().catch(() => {}) }}
              onFocus={() => { loadOfferSlider().catch(() => {}) }}
              onClick={(e) => { e.stopPropagation(); setOffer(offer === null ? 10 : null) }}
              className="press hidden text-foreground hover:bg-accent sm:flex"
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
        {l.isPartnerBooking ? (
          // A reference listing has nobody to message (see /api/conversations) — hold the 36px so
          // the trust-badge column stays aligned, same as the no-offer placeholder above.
          <span aria-hidden className={cn('h-9 w-9 shrink-0', offer === null ? (jobTitleTakesChatSlot ? 'hidden sm:block' : 'block') : 'hidden')} />
        ) : (
        <Tooltip content={teacher ? tr('Message teacher', 'Nhắn tin cho giáo viên') : tr('Chat with seller', 'Nhắn tin với người bán')} side="top">
          <IconButton
            size="md"
            tapTarget={false}
            aria-label={teacher ? tr('Message teacher', 'Nhắn tin cho giáo viên') : tr('Chat with seller', 'Nhắn tin với người bán')}
            // A teacher is hired, never asked whether "this" is still available (src/lib/teachers/first-message.ts).
            onClick={(e) => { e.stopPropagation(); quickGo({ body: quickChatOpener(l.listingType, tr, openerVoice(accountType)) }) }}
            className={cn('press text-foreground hover:bg-accent', offer === null ? 'flex' : 'hidden')}
          >
            <MessageCircle className="h-5 w-5" />
          </IconButton>
        </Tooltip>
        )}
        {/* ⛔ A teacher is never a map pin (map-pin-rows.ts — a person is not a place), so their row offers no "Show on
            map": it would open the map focused on nothing. */}
        {!teacher && (
        <IconButton
          size="md"
          tapTarget={false}
          aria-label={tr('Show on map', 'Xem trên bản đồ')}
          onClick={(e) => { e.stopPropagation(); onLocate(l.id) }}
          // `sm:` only: on a phone its 36px is the room a rental's "/ month" and a two-line title need,
          // and the place it pointed at is now written on the row itself (the line under the price).
          className={cn('press text-foreground hover:bg-accent', offer === null ? 'hidden sm:flex' : 'hidden')}
        >
          <MapPin className="h-5 w-5" />
        </IconButton>
        )}
        {offer === null && <FavoriteHeart id={l.id} className="-mr-0.5" />}
      </div>
    </div>
  )
})
