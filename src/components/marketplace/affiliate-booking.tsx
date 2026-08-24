import { ArrowUpRight, ShieldCheck } from '@/components/ui/icons'
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
}: {
  url: string
  partnerName: string
  discountCode?: string | null
  discountPercent?: number | null
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
        <Tr text="Book this experience" />
      </h2>

      {/*
        * ⚠️ SAY THAT THE PRICE IS A STARTING POINT, RIGHT BESIDE THE CTA. The partner sets and
        * changes the real price at checkout and it varies by date, so the figure above this button
        * is the lowest adult ticket, not a quote. Google also compares structured-data price to the
        * visible price, and a page that implies a fixed price it cannot honour is the mismatch it
        * penalises — as well as the kind of claim consumer-protection rules are written about.
        */}
      <p className="text-xs text-body">
        <Tr text="Lowest adult ticket — the final price is set at checkout and varies by date." />
      </p>

      <Button asChild variant="cta" size="lg" className="w-full">
        {/*
          * An anchor, not a router push: this leaves our origin entirely. Next's Link would
          * prefetch a third-party URL it cannot prefetch and adds nothing.
          */}
        <a href={safeUrl} target="_blank" rel="sponsored nofollow noopener noreferrer">
          <Tr text="Book on" /> {partnerName}
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
              <Tr text="Scan to book on your phone" />
            </p>
            <p className="mt-1 text-xs text-body">
              <Tr text="Opens the same booking page, with the discount code ready to enter." />
            </p>
          </div>
        </div>
      ) : null}

      {/*
        * The disclosure. Required by Vietnamese consumer-protection rules and by Google's own
        * guidance, and it is also simply true: we are paid if this link converts, and a reader who
        * finds that out later trusts every other page here less.
        */}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-body">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          <Tr text="Booking and payment happen on the partner's website — eno does not sell this ticket, hold your money, or process refunds. We may earn a commission if you book through this link, at no extra cost to you." />
        </span>
      </p>
    </section>
  )
}
