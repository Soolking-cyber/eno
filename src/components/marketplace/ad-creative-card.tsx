'use client'

import Image from 'next/image'
import { useLocalized } from '@/components/marketplace/listing-content'
import { Badge } from '@/components/ui/badge'
import { useLanguage } from '@/context/language-context'
import type { AdCreativeCardData } from '@/lib/ads/creative-card'

/**
 * ── AN ADVERTISER'S OWN AD, AS THE FEED'S FIRST CARD (owner 2026-11-25: "any type of ads … standardized places where they
 * show up"; the one placement is the feed card). The explorer draws ONE of these just before the grid's rows, on page 1 in
 * the grid view only (listings-explorer.tsx) — never inside `listings[]`.
 *   · the WHOLE card is one link to the advertiser's own https page, in a new tab, `rel="sponsored noopener noreferrer"`
 *     (Google's paid-link rule; no referrer, no window.opener);
 *   · `data-ad-id` lets <AdBeacons> count it (a viewable impression; click and auxclick);
 *   · the same square, edge-grid photo as the listing cards around it (`card-root` / `card-media` / `card-img`: the edge
 *     grid takes their corner off, globals.css), the label in the viewer's language — "Ad" / "Quảng cáo", the listing ads' own tr() (owner 2026-11-25: "just quang cao or ad … in their respected language no need for both") (the disclosure the law asks
 *     for), the advertiser's name as written;
 *   · the headline and line in the viewer's language through the listing titles' own path (useLocalized: the embedded
 *     translation, else the client's cached one), the picture untouched — its language is the advertiser's choice.
 * Base UI is not involved: a link and a picture are not a control (the ad's Badge is the ui primitive).
 */
export function AdCreativeCard({ ad }: { ad: AdCreativeCardData }) {
  const { tr } = useLanguage()
  const label = tr('Ad', 'Quảng cáo')
  const headline = useLocalized(ad.headline, null, ad.headlineI18n ?? null)
  const body = useLocalized(ad.body ?? '', null, ad.bodyI18n ?? null, 'description')
  return (
    <div data-ad-creative-cell="" className="flex flex-col h-full">
      <a
        href={ad.clickUrl}
        target="_blank"
        rel="sponsored noopener noreferrer"
        data-ad-id={ad.adId}
        aria-label={`${label}: ${headline} — ${ad.advertiserName}`}
        className="group rounded-media corner-round card-root focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="plate-lg media-hairline aspect-square rounded-media corner-round card-media">
          <Image src={ad.imageUrl} alt={headline} fill sizes="(min-width: 1280px) 300px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" className="object-cover card-img" />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 pt-2">
          <p className="line-clamp-2 text-t-card font-semibold text-foreground">{headline}</p>
          {ad.body ? <p className="line-clamp-2 text-t-meta text-muted-foreground">{body}</p> : null}
          <p className="flex min-w-0 items-center gap-1.5 text-t-meta text-muted-foreground">
            <Badge variant="neutral" size="sm" data-ad-marker="" className="shrink-0">{label}</Badge>
            <span className="truncate">{ad.advertiserName}</span>
          </p>
        </div>
      </a>
    </div>
  )
}
