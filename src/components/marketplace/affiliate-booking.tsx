import { ArrowUpRight } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Tr } from '@/context/language-context'
import { Bilingual } from './bilingual'
import { affiliateQrSvg, safeAffiliateUrl } from '@/lib/affiliate-qr'
import { embeddedProductUrl } from '@/lib/affiliate-deeplink'
import { AffiliateCodeCopy } from './affiliate-code-copy'
import { AffiliateProductStep } from './affiliate-product-step'
import { JobApplyBy } from './job-apply-guard'
import { cn } from '@/lib/utils'
import { isCommissionLink } from '@/lib/affiliate-commission'
import { IS_SERVICES } from '@/lib/edition'

/**
 * THE BUY BOX FOR A LISTING WHOSE CHECKOUT HAPPENS ON A PARTNER'S SITE.
 *
 * ⛔ IT REPLACES ContactComposer RATHER THAN SITTING BESIDE IT. There is no eno seller behind an
 * affiliate listing, so "Message seller" would open a thread nobody reads and "Reveal phone" would
 * show a number nobody answers. Offering both a real CTA and a dead one is worse than offering one.
 *
 * ⚠️ rel="sponsored" IS NOT OPTIONAL AND IS NOT DECORATION. Google treats an undisclosed paid or
 * affiliate link as a link-scheme violation, which costs the organic ranking this page exists to
 * earn — the exact opposite of the goal. `noopener` because target="_blank" without it hands the
 * opened tab a window.opener handle back into our origin.
 *
 * ⚠️ THE PRICE ON THIS PAGE IS A STARTING POINT, NOT A QUOTE. The partner sets and changes it, so
 * the copy says "from" and the CTA says where the real price and checkout live. Claiming a fixed
 * price we do not control is the kind of thing consumer-protection rules are written about.
 */
export function AffiliateBooking({
  url,
  partnerName,
  listingId,
  discountCode,
  discountPercent,
  booking,
  rental = false,
  job = false,
  applyBy = null,
  provenance = null,
  lang = 'en',
}: {
  url: string
  partnerName: string
  /** Scopes the "already opened" memory to this listing — see AffiliateProductStep. */
  listingId: string
  discountCode?: string | null
  discountPercent?: number | null
  /** True for a ticket/reservation, false for a boxed product — see isBookingCategory. */
  booking: boolean
  /**
   * True for a rental listing (`listingType === 'rent'`), which is a THIRD action, not a flavour of
   * the other two. Owner, 2026-09-21: "action button not buy but rent on rever.vn". A month's
   * tenancy is not a purchase and not a ticket, and "Buy on Rever.vn" on an apartment reads as
   * though we are selling the flat.
   * ⚠️ SEPARATE FROM `booking` ON PURPOSE. `booking` still means ticket/reservation and drives the
   * "Lowest adult ticket" line and the QR copy; collapsing the two would put ticket wording on a
   * tenancy. They are different facts about the listing.
   */
  rental?: boolean
  /**
   * True for a JOB reference listing (`listingType === 'job'`) — a FOURTH action. You don't buy, book
   * or rent a job: you apply, on the posting itself (eno.vn only links to it). No discount block and no
   * checkout wording apply to it.
   */
  job?: boolean
  /** A job's apply-by date ('YYYY-MM-DD'), printed directly under the Apply button — see JobApplyBy. */
  applyBy?: string | null
  /**
   * Where an IMPORTED listing came from — <ImportProvenance>, built by the page from the server-only
   * import-provenance.ts (SEO wave B, P1). A slot rather than props, so this component never learns
   * which sellers are imports; null on every other listing.
   */
  provenance?: React.ReactNode
  /** The page variant ('vi' | 'en') — only for the QR's accessible name, an SVG attribute string (below). */
  lang?: string
}) {
  // ⛔ https ONLY — see safeAffiliateUrl. A stored `javascript:` value would otherwise be a
  // stored-XSS sink, and this link leads to a payment page so `http:` is refused as well.
  // A bad value renders nothing; the page keeps its gallery, price and description.
  const safeUrl = safeAffiliateUrl(url)
  if (!safeUrl) return null

  // Authored pairs for the rental wording (SEO wave B, P3; copy sheet CS-2 P3-2..P3-4, owner-approved
  // 2026-09-30) — literal `tr(en, vi)` calls so gen-ui-strings harvests them, rendered through
  // <Bilingual> because this component renders on the server. No vi-overrides entry is needed.
  const tr = (en: string, vi: string, values?: Record<string, string>) => <Bilingual en={en} vi={vi} values={values} />

  // ⚠️ THE QR's NAME IS A STRING INSIDE INLINE SVG MARKUP, so it cannot be a <Bilingual> node: a literal
  // pair picked by the page's variant, harvested by gen-ui-strings like every other two-literal t() call
  // (quality-12 — it was English on every Vietnamese page). split/join for {site}, so a `$` in a name
  // prints as typed. ⚠️ Never write a t() call with two quoted literals in a COMMENT here: the harvester
  // reads comments too, and one such example put the words "en" and "vi" into ui-strings.ts.
  const t = (en: string, vi: string) => (lang === 'vi' ? vi : en).split('{site}').join(partnerName)
  const qr = affiliateQrSvg(safeUrl, {
    title: job
      ? t('QR code to open the job posting on {site}', 'Mã QR để mở tin tuyển dụng trên {site}')
      : rental
        ? t('QR code to open the rental on {site}', 'Mã QR để mở tin cho thuê trên {site}')
        : t('QR code to book on {site}', 'Mã QR để đặt trên {site}'),
  })
  // The product this link was minted for, when the campaign is one measured not to deep-link.
  const productStep = embeddedProductUrl(safeUrl)
  // Can this link earn eno a commission? Decides the disclosure at the end of this box (2026-10-01).
  const commission = isCommissionLink(safeUrl)

  return (
    <section aria-labelledby="affiliate-booking-heading" className="flex flex-col gap-4">
      <h2 id="affiliate-booking-heading" className="sr-only">
        {job ? <Tr text="Apply on the original posting" /> : rental ? tr('Open the original ad', 'Mở tin gốc') : booking ? <Tr text="Book this experience" /> : <Tr text="Buy from this shop" />}
      </h2>

      {/*
        * ⚠️ SAY THAT THE PRICE IS A STARTING POINT, RIGHT BESIDE THE CTA. The partner sets and
        * changes the real price at checkout and it varies by date, so the figure above this button
        * is the lowest adult ticket, not a quote. Google also compares structured-data price to the
        * visible price, and a page that implies a fixed price it cannot honour is the mismatch it
        * penalises — as well as the kind of claim consumer-protection rules are written about.
        */}
      {/* ⛔ THE PURCHASE VARIANT SAYS NOTHING HERE (owner, 2026-08-25). "Price shown is the shop's
          current price and can change" was hedging on a number we now REFRESH DAILY from the
          merchant's feed — see scripts/refresh-affiliate-prices.ts. A caveat that exists because
          the data might be stale is worth removing by making the data fresh.
          ⚠️ The BOOKING line stays: a ticket's price genuinely is a floor set at the partner's
          checkout by date, which no refresh cadence can change.
          ⚠️ Render NOTHING, not an empty <p> — the parent is a flex column with `gap`, so an empty
          paragraph is still a flex item and still takes a gap, opening a dead band under the price
          on every purchase PDP. */}
      {booking ? (
        <p className="text-xs text-body">
          <Tr text="Lowest adult ticket — the final price is set at checkout and varies by date." />
        </p>
      ) : null}

      {/* `min-h-11`: this is the primary action on every partner PDP, and size="lg" is `min-h-10` —
          it measured 366x40 on 6 of 7 PDPs while its Chat twin (contact-composer.tsx) already
          reaches the 44px floor. On the PRIMITIVE, where cn() replaces the size's `min-h-10`, rather
          than on the <a> below: the house rule is that size overrides live on the primitive. */}
      <Button asChild variant="cta" size="lg" className="w-full min-h-11">
        {/*
          * An anchor, not a router push: this leaves our origin entirely. Next's Link would
          * prefetch a third-party URL it cannot prefetch and adds nothing.
          */}
        {/*
          * data-affiliate-cta marks THIS anchor as the outbound booking CTA. The guest e2e needs
          * to tell a partner PDP from an ordinary one, and matching the visible copy page-wide
          * would also match an unrelated card in the similar-listings rail whose title happens to
          * start "Book on …" — diverting a healthy ordinary listing into the partner assertions.
          */}
        <a
          data-affiliate-cta="true"
          href={safeUrl}
          target="_blank"
          // A linked JOB is not a paid placement — no commission, no deal with the board — so `sponsored`
          // would declare a relationship that does not exist. The referrer is kept so the board can see
          // the applicant came from eno.vn.
          rel={job ? 'nofollow noopener' : 'sponsored nofollow noopener noreferrer'}
        >
          <CtaLabel job={job} rental={rental} booking={booking} partnerName={partnerName} />
        </a>
      </Button>

      {/* The source and its date sit right under the button whose link they explain, at the column's
          full gap: its link's 44px hit area needs the room (import-provenance.tsx). Never on a job
          (P-b), so it never meets the apply-by line below. */}
      {provenance}

      {/* The deadline belongs to the button it limits, so it sits right under it (8px: `-mt-2` against
          this column's 16px gap) — not below the QR row, where it would read as a caption of the code. */}
      {job && applyBy ? <JobApplyBy applyBy={applyBy} className="-mt-2" /> : null}

      {/* ⚠️ ONLY WHERE THE AFFILIATE LINK CANNOT REACH THE PRODUCT, and only after the button above
          has been used. `embeddedProductUrl` returns null for every campaign that deep-links
          properly, so this is absent from CellphoneS listings and from every ordinary partner —
          there it would point at the page the shopper is already on. */}
      {productStep ? <AffiliateProductStep key={listingId} productUrl={productStep} listingId={listingId} /> : null}

      {discountCode && !job ? (
        <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-4">
          <p className="text-sm font-medium text-foreground">
            {discountPercent ? (
              <>
                <Tr text="Save" /> {discountPercent}% <Tr text="at checkout with this code" />
              </>
            ) : (
              <Tr text="Use this code at checkout" />
            )}
          </p>
          <AffiliateCodeCopy code={discountCode} />
          {/* ⛔ THE SELLER'S NAME, NOT "THE PARTNER SITE" (2026-10-01): "partner" now means a signed agreement
              (partner-badge.tsx), and the shops and ticket sellers whose codes show here hold none. */}
          <p className="text-xs text-body">
            {tr('Sign in on the {site} website and enter the code at the payment step.', 'Đăng nhập trên website {site} và nhập mã tại bước thanh toán.', { site: partnerName })}
          </p>
        </div>
      ) : null}

      {/* ⚠️ A DESKTOP-TO-PHONE HANDOFF, SO IT EXISTS ONLY ON A DESKTOP-CLASS DEVICE. It rendered
          everywhere as a 130px bordered card directly under the CTA — on a phone, a code telling you
          to scan it with the phone you are holding. `pc:` is the house device variant (a ≥64rem window
          AND a fine pointer — globals.css), not a width alone, so a touch tablet in landscape does not
          get it either. And a hairline row, not a box: in-flow content is flat (design-language §3b).
          ⚠️ The visibility lives on this plain div, never on a Button/asChild child, where a class is
          concatenated rather than merged. */}
      {qr ? (
        <div className="hidden items-center gap-4 border-t border-border pt-4 pc:flex">
          {/*
            * Inline SVG rather than an <img>: the CSP pins img-src to our own origin, so a QR
            * service URL would be blocked, and a data: URI costs a base64 round-trip for no gain.
            */}
          <div className="shrink-0 [&>svg]:size-20 [&>svg]:rounded-lg" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {job ? <Tr text="Scan to open the job posting on your phone" /> : booking ? <Tr text="Scan to book on your phone" /> : rental ? tr('Scan to open this rental on your phone', 'Quét để mở tin cho thuê này trên điện thoại') : <Tr text="Scan to open on your phone" />}
            </p>
            <p className="mt-1 text-xs text-body">
              {job ? <Tr text="Opens the same job posting, where you apply." /> : booking ? <Tr text="Opens the same booking page, with the discount code ready to enter." /> : rental ? tr('Opens the original ad on {site}.', 'Mở tin gốc trên {site}.', { site: partnerName }) : <Tr text="Opens the same product page on the shop's website." />}
            </p>
          </div>
        </div>
      ) : null}

      {/*
        * ⛔ THE COMMISSION DISCLOSURE IS BACK — OWNER REVERSAL, 2026-10-01 (ad labelling). It was removed
        * here on owner instruction on 2026-08-24 ("remove this warning"), and this comment then recorded
        * the gap that left: rel="sponsored" tells Google about the paid relationship, but not the person
        * reading the page, and a reader-facing disclosure is what consumer-protection and advertising
        * rules ask for. The owner has now restored it, as one sentence, in his wording.
        * ⚠️ ONLY ON A COMMISSION-BEARING LINK (isCommissionLink — the AccessTrade tracker hosts). A linked
        * rental, a vehicle-hire reference, a scraped shop's own product URL or a job board pays eno
        * nothing, and "we may earn a commission" there would be a false statement, however hedged.
        * The "we don't sell this / don't hold your money" half stays where it was: SafetyStrip's
        * affiliate lines.
        */}
      {commission ? <CommissionNote /> : null}
    </section>
  )
}

/**
 * "We may earn a commission…" — the reader-facing ad disclosure beside a commission-bearing CTA (owner,
 * 2026-10-01, his wording). ONE component for the buy box and its in-flow repeat, so the two cannot
 * disagree.
 * ⚠️ The Vietnamese names the site, so it is edition-split; the English says "We" on both. A literal-pair
 * builder named `tr` (rendered through <Bilingual>, this file is a server component) so gen-ui-strings
 * harvests the English. Plain body ink at 12px: legible, never louder than the CTA it qualifies.
 */
function CommissionNote({ className }: { className?: string }) {
  const tr = (en: string, vi: string) => <Bilingual en={en} vi={vi} />
  return (
    <p data-commission-disclosure="" className={cn('text-xs text-body', className)}>
      {IS_SERVICES
        ? tr('We may earn a commission if you buy through this link, at no extra cost to you.', 'eno.forum có thể nhận hoa hồng nếu bạn mua qua liên kết này, bạn không phải trả thêm.')
        : tr('We may earn a commission if you buy through this link, at no extra cost to you.', 'eno.vn có thể nhận hoa hồng nếu bạn mua qua liên kết này, bạn không phải trả thêm.')}
    </p>
  )
}

/** The CTA's words — one source for the buy box and its in-flow repeat, so the two can never disagree. */
function CtaLabel({ job, rental, booking, partnerName }: { job: boolean; rental: boolean; booking: boolean; partnerName: string }) {
  return (
    <>
      {job ? <Tr text="Apply on" /> : rental ? <Tr text="Rent on" /> : booking ? <Tr text="Book on" /> : <Tr text="Buy on" />} {partnerName}
      <ArrowUpRight className="size-4" aria-hidden />
    </>
  )
}

/**
 * THE PRIMARY CTA, ONCE MORE, IN THE PAGE FLOW (owner, 2026-09-30, P-CTA part B) — on a LONG partner
 * PDP only, placed by page.tsx after the description. A reader who has just finished a long description
 * is a screen or more below the buy box, and on a phone there is no sticky bar to fall back on
 * (PdpMobileBar was deleted deliberately). Not sticky: it scrolls with the text it follows.
 *
 * ⚠️ `data-affiliate-cta-repeat`, NEVER `data-affiliate-cta`. The guest e2e counts `[data-affiliate-cta]`
 * as exactly one anchor — the buy box's. AffiliateProductStep listens for BOTH, because a click here is
 * the same affiliate click and must reveal the second step the same way.
 * ⚠️ Same URL, same rel, same words (CtaLabel) as the buy box: a second button that differed in any of
 * them would be a second, different claim. `lg:hidden` — from lg the buy box is sticky, so the original
 * CTA is already on screen beside the description and a repeat would only be noise.
 */
export function AffiliateCtaRepeat({ url, partnerName, booking, rental = false, job = false, className }: {
  url: string
  partnerName: string
  booking: boolean
  rental?: boolean
  job?: boolean
  className?: string
}) {
  const safeUrl = safeAffiliateUrl(url)
  if (!safeUrl) return null
  return (
    <div className={cn('lg:hidden', className)}>
      <Button asChild variant="cta" size="lg" className="w-full min-h-11">
        <a
          data-affiliate-cta-repeat="true"
          href={safeUrl}
          target="_blank"
          rel={job ? 'nofollow noopener' : 'sponsored nofollow noopener noreferrer'}
        >
          <CtaLabel job={job} rental={rental} booking={booking} partnerName={partnerName} />
        </a>
      </Button>
      {/* The same disclosure as the buy box, under the same CTA (owner, 2026-10-01). */}
      {isCommissionLink(safeUrl) ? <CommissionNote className="mt-2" /> : null}
    </div>
  )
}
