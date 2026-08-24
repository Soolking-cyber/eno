import { ArrowUpRight } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Tr } from '@/context/language-context'
import { affiliateQrSvg, safeAffiliateUrl } from '@/lib/affiliate-qr'
import { AffiliateCodeCopy } from './affiliate-code-copy'

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
  discountCode,
  discountPercent,
  booking,
}: {
  url: string
  partnerName: string
  discountCode?: string | null
  discountPercent?: number | null
  /** True for a ticket/reservation, false for a boxed product — see isBookingCategory. */
  booking: boolean
}) {
  // ⛔ https ONLY — see safeAffiliateUrl. A stored `javascript:` value would otherwise be a
  // stored-XSS sink, and this link leads to a payment page so `http:` is refused as well.
  // A bad value renders nothing; the page keeps its gallery, price and description.
  const safeUrl = safeAffiliateUrl(url)
  if (!safeUrl) return null

  const qr = affiliateQrSvg(safeUrl, { title: `QR code to book on ${partnerName}` })

  return (
    <section aria-labelledby="affiliate-booking-heading" className="flex flex-col gap-4">
      <h2 id="affiliate-booking-heading" className="sr-only">
        {booking ? <Tr text="Book this experience" /> : <Tr text="Buy from this shop" />}
      </h2>

      {/*
        * ⚠️ SAY THAT THE PRICE IS A STARTING POINT, RIGHT BESIDE THE CTA. The partner sets and
        * changes the real price at checkout and it varies by date, so the figure above this button
        * is the lowest adult ticket, not a quote. Google also compares structured-data price to the
        * visible price, and a page that implies a fixed price it cannot honour is the mismatch it
        * penalises — as well as the kind of claim consumer-protection rules are written about.
        */}
      <p className="text-xs text-body">
        {booking ? <Tr text="Lowest adult ticket — the final price is set at checkout and varies by date." /> : <Tr text="Price shown is the shop's current price and can change." />}
      </p>

      <Button asChild variant="cta" size="lg" className="w-full">
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
          rel="sponsored nofollow noopener noreferrer"
        >
          {booking ? <Tr text="Book on" /> : <Tr text="Buy on" />} {partnerName}
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </Button>

      {discountCode ? (
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
          <p className="text-xs text-body">
            <Tr text="Sign in on the partner site and enter the code at the payment step." />
          </p>
        </div>
      ) : null}

      {qr ? (
        <div className="flex items-center gap-4 rounded-xl border border-border/70 p-4">
          {/*
            * Inline SVG rather than an <img>: the CSP pins img-src to our own origin, so a QR
            * service URL would be blocked, and a data: URI costs a base64 round-trip for no gain.
            */}
          <div className="shrink-0 [&>svg]:size-24 [&>svg]:rounded-lg" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {booking ? <Tr text="Scan to book on your phone" /> : <Tr text="Scan to open on your phone" />}
            </p>
            <p className="mt-1 text-xs text-body">
              {booking ? <Tr text="Opens the same booking page, with the discount code ready to enter." /> : <Tr text="Opens the same product page on the shop's website." />}
            </p>
          </div>
        </div>
      ) : null}

      {/*
        * ⛔ THE PAID-LINK DISCLOSURE PARAGRAPH WAS REMOVED HERE ON OWNER INSTRUCTION (2026-08-24,
        * "remove this warning"). What it said is not gone from the page: SafetyStrip's
        * variant="affiliate" line already tells the reader to book only on the partner's own site
        * and that eno.vn never takes payment or a deposit for a partner ticket and cannot refund
        * one, so the "we don't sell this / don't hold your money" half is still stated.
        *
        * ⚠️ WHAT IS NO LONGER STATED ANYWHERE IS THE COMMISSION. rel="sponsored" on the anchor
        * discloses the paid relationship to Google, but not to the person reading the page, and a
        * reader-facing disclosure is what consumer-protection rules ask for. If that needs to come
        * back, it is one sentence — "We may earn a commission if you book through this link, at no
        * extra cost to you." — and this is the element it belongs on.
        */}
    </section>
  )
}
