'use client'

import { memo } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Zap } from '@/components/ui/icons'
import { Badge as UiBadge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Tr, useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useRowPress } from '@/hooks/use-row-press'
import { cardJobType, cardTitle, rowTitle } from '@/lib/card-title'
import { priceUnitSuffix } from '@/lib/price-unit'
import { quickActionSignIn, stashQuickCompose } from '@/lib/quick-contact'
import { openerVoice, quickChatOpener } from '@/lib/teachers/first-message'
import { cardCompactAbove, dropPercent } from '@/lib/vnd'
import { isModifiedClick } from '@/lib/plain-click'
import { cn } from '@/lib/utils'
import { Badge } from './card-badges'
import { FavoriteHeart } from './favorite-heart'
import { PartnerBadge } from './partner-badge'
import { Price } from './price'
import { PostedAgo, useLocalized } from './listing-content'
import type { CompactListingRowProps } from './compact-listing-row'

export type JobCardRowProps = CompactListingRowProps & {
  /**
   * The page's employer (a job page's "More from this employer" rail, same-seller-shelf.tsx): a row whose OWN employer is this
   * name (Unicode form, spacing and case aside) does not print it again — the rail's heading already says whose jobs these are.
   * ⚠️ PER ROW, NEVER PER RAIL: a job board's rail mixes employers, and each of those rows keeps its employer line. Only the
   * employer text goes; a stated pay, "Urgent hiring" and the badges stay.
   */
  hideEmployerNamed?: string
}

const nameKey = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** The tag a stated pay (or an employer's own "Negotiable") sits in: the field fill, 8px corners — the job page's Details tags. */
const PAY_TAG = 'rounded-lg bg-muted px-2.5 py-1'

/**
 * ⛔ A JOB IS ONE CARD (owner-approved 2026-11-14, cook r06 jobs — /c/jobs below sm and the two rails under a job page on a phone;
 * mock cook/final/jobs.css, stills cook/compare/r06/jobs__jobs.jpg). It REVERSES there batch 78's "A JOB ROW IS TEXT BETWEEN
 * HAIRLINES … THE LIST IS RULED" (owner 2026-11-12; canon §3b "lines, not boxes"): every job a white card with a 1px line-strong
 * border and 16px corners, 8px apart (JOB_CARD_LIST), Indeed's list. The explorer's /?category=jobs rows are not this
 * component: they keep CompactListingRow and the ruled list (listings-explorer.tsx).
 * What batch 78 and b54 decided and this keeps, word for word (compact-listing-row.tsx has the record):
 *   · NO TILE: no thumbnail, no initials, no glyph. The role is the strongest line.
 *   · ONE MEANING OF "LINKED" — the flag. The slot prints the EMPLOYER of a no-pay linked job (`jobMeta`) and the title then
 *     drops the importer's " — <employer>" tail (card-title.ts); a linked job with no pay and no employer prints NO slot; an
 *     employer's own job keeps <Price>'s "Negotiable" (cardWords).
 *   · The type ends the meta line ("Hanoi · 5d ago · Full-time"); the chat (with sign-in) only where there is someone to message.
 * What the card changes:
 *   · the ROLE is an h3 in the sub-section role (17/24, bold ink), WHOLE — not clamped (it reverses, here, the row's "TWO LINES,
 *     NOT truncate": both judges read the ellipsis as broken). h3: both lists sit under an h2 ("Listings", the rail's title);
 *   · a stated pay is a filled TAG (Indeed's pay chip; the tag look of the job page's Details), 14px bold ink; "Negotiable" the
 *     same tag in regular body ink; the employer plain 15px body ink;
 *   · "Urgent hiring" in words beside its bolt (the bolt alone was a guess), 13px bold ink;
 *   · the meta line wraps, never truncates, and a posting under a day old prints its age in bold ink (RelativeTime markFresh);
 *   · ONE action column: the heart top right on the role's first line, the chat under it on the meta line, each a 44px box
 *     centred on its line (`-my-2.5` = (44 − 24) / 2, `-my-3` ≈ (44 − 18) / 2) so the card is no taller for them.
 * DOM order = reading and Tab order: the row's link (stretched over the card, z-1, the card's own link rule), the role, the heart,
 * the slot line, the meta line, the chat. Controls sit above the link (z-2), never inside it.
 * ⚠️ job-card-row-skeleton.tsx carries this card's box and line heights: change both or neither.
 */
export const JobCardRow = memo(function JobCardRow({ listing: l, onOpen, onPrefetch, clockInHtml = false, hideEmployerNamed }: JobCardRowProps) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const displayTitle = useLocalized(l.title, l.titleVi, l.titleI18n)
  const place = l.district || l.city || ''
  const linkedJob = l.isPartnerBooking === true
  const jobMeta = linkedJob && l.price === 0 ? (l.jobEmployer || null) : undefined
  const titleInput = { title: displayTitle, lang, sellerId: l.sellerId, categorySlug: l.category?.slug, listingType: l.listingType, condition: l.condition, location: l.location }
  const lineTitle = jobMeta ? cardTitle({ ...titleInput, employer: jobMeta }) : rowTitle(titleInput)
  const jobTypeText = cardJobType(l.jobType, tr)
  // `null` is exactly a linked job at 0 with no employer stored: no slot (compact-listing-row.tsx `salaryLine`).
  const salaryLine = jobMeta !== null
  const hideEmployer = typeof jobMeta === 'string' && !!hideEmployerNamed && nameKey(jobMeta) === nameKey(hideEmployerNamed)
  const slot: 'employer' | 'pay' | 'words' | null = !salaryLine ? null
    : typeof jobMeta === 'string' ? (hideEmployer ? null : 'employer')
    : l.price > 0 ? 'pay' : 'words'
  const drop = l.prevPrice != null ? dropPercent(l.prevPrice, l.price) : null
  const slotLine = slot !== null || l.urgent || !!drop || l.isSponsored || l.seller.officialPartner
  const { user, loading: authLoading, openSignIn, accountType } = useAuth()
  const quickChat = () => {
    const opts = { body: quickChatOpener(l.listingType, tr, openerVoice(accountType)) }
    // A guest's quick action is remembered and finished on the listing's page after sign-in (UX3 J5).
    if (!user) { if (!authLoading) openSignIn({ listingTitle: displayTitle, listingImage: l.images[0] ?? null, ...quickActionSignIn(l, opts) }); return }
    if (stashQuickCompose(l, opts)) router.push('/messages/pending')
    else router.push(`/listings/${l.id}#contact`)
  }
  const { pending, open } = useRowPress(() => onOpen(l))
  const priceProps = { native: true, price: l.price, currency: l.currency, priceUnit: l.priceUnit, listingType: l.listingType, linked: l.isPartnerBooking, compact: true, compactAbove: cardCompactAbove(l), dual: 'sm' as const, unit: (priceUnitSuffix(l.priceUnit) ? true : 'sm') as true | 'sm', cardWords: true }

  return (
    <div
      data-sid={l.sellerId}
      // A modifier or middle click on the card's link is the browser's new tab or window: the card must not open it here too.
      onClick={(e) => { if (!isModifiedClick(e)) open() }}
      onMouseEnter={() => onPrefetch(l.id)}
      onTouchStart={() => onPrefetch(l.id)}
      data-pending={pending || undefined}
      // The press belongs to what was pressed (the row's `has-[button:active]` rule): the heart or the chat press themselves.
      className="group relative grid cursor-pointer grid-cols-[minmax(0,1fr)_2.75rem] gap-x-1 rounded-2xl border border-line-strong bg-background py-4 pl-4 pr-1 text-left transition-[background-color,scale] duration-100 active:scale-[0.99] active:bg-muted has-[button:active]:scale-100 has-[button:active]:bg-background data-pending:scale-[0.99]"
    >
      <a
        href={`/listings/${l.id}`}
        aria-label={displayTitle}
        data-row-link=""
        draggable={false}
        onClick={(e) => { if (!isModifiedClick(e)) e.preventDefault() }}
        className="absolute inset-0 z-[1] rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The link's words in its text too, as the card link (listing-card.tsx): with only an aria-label a crawler reads an empty
            link (Seobility crawl 7, "empty links" to three job listings). The aria-label still names it; sr-only paints nothing. */}
        <span className="sr-only">{displayTitle}</span>
      </a>
      <h3 className="col-start-1 row-start-1 min-w-0 text-t-h3 text-foreground [overflow-wrap:anywhere] group-hover:underline">{lineTitle}</h3>
      <FavoriteHeart id={l.id} className="relative z-[2] col-start-2 row-start-1 -my-2.5 size-11" />
      {slotLine && (
        <div className="col-span-2 row-start-2 mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pr-3">
          {slot === 'employer' && <span className="min-w-0 text-t-card text-body [overflow-wrap:anywhere]">{jobMeta}</span>}
          {/* The figure in the cards' form (batch 94: "80M đ / month", "8,5 triệu / tháng"); its unit always (a rate). It may wrap
              inside its tag (at <Price>'s own break), never clip. */}
          {slot === 'pay' && <span className={PAY_TAG}><Price {...priceProps} className="text-sm leading-5 font-bold" /></span>}
          {slot === 'words' && <span className={PAY_TAG}><Price {...priceProps} className="text-sm leading-5 font-normal text-body" /></span>}
          {l.urgent && (
            <span className="inline-flex items-center gap-0.5 text-t-meta font-bold text-foreground">
              <Zap aria-hidden className="size-3.5 shrink-0 fill-current" />
              {tr('Urgent hiring', 'Tuyển gấp')}
            </span>
          )}
          {drop && <Badge kind="drop" variant="inline" className="shrink-0">{drop}</Badge>}
          {/* "Ad" on a commission-bearing job, and the partner plate — the row's two chip slots, here on the slot line. Ad wins over
              the plate when both apply, the status still announced (listing-card.tsx has the note). */}
          {l.isSponsored && <UiBadge variant="neutral" size="sm" data-ad-marker="" className="shrink-0">{tr('Ad', 'Quảng cáo')}</UiBadge>}
          {l.seller.officialPartner ? (
            l.isSponsored
              ? <span className="sr-only">{tr('Official partner', 'Đối tác chính thức')}</span>
              : <PartnerBadge asLink={false} className="shrink-0" /> /* ⛔ never a link inside a card (partner-badge.tsx) */
          ) : null}
        </div>
      )}
      <p className="col-start-1 row-start-3 mt-1.5 min-w-0 text-t-meta text-muted-foreground [overflow-wrap:anywhere]">
        {place ? <><Tr text={place} />{' · '}</> : null}
        <PostedAgo iso={l.postedAt} inHtml={clockInHtml} markFresh className="data-fresh:font-bold data-fresh:text-foreground" />
        {jobTypeText ? <>{' · '}{jobTypeText}</> : null}
      </p>
      {/* A reference listing has nobody to message (see /api/conversations): a linked job draws no chat. */}
      {!l.isPartnerBooking && (
        <IconButton
          size="md"
          aria-label={tr('Chat with seller', 'Nhắn tin với người bán')}
          onClick={(e) => { e.stopPropagation(); quickChat() }}
          className="press relative z-[2] col-start-2 row-start-3 -my-3 size-11 text-foreground"
        >
          <MessageCircle className="h-5 w-5" />
        </IconButton>
      )}
    </div>
  )
})
