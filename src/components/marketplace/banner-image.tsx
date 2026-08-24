/**
 * A shop's banner, rendered with ART DIRECTION.
 *
 * ⛔ ONE IMAGE CANNOT SERVE BOTH SHAPES, AND CROPPING IT IS NOT A COMPROMISE — IT IS A BROKEN
 * BANNER. Partners compose per shape: VinWonders' web creative is 1280x300 (4.3:1) with the
 * wordmark and "Get Your Ticket Now" laid out beside the photo; their mobile one is 366x188
 * (1.9:1) with the same elements re-stacked. Squeeze the wide one into a phone-width 1.9:1 box
 * with object-cover and the crop takes the CTA off the side.
 *
 * ⛔ <picture> + <source media>, NEVER TWO <Image>s HIDDEN BY CSS. A display:none <img> STILL
 * DOWNLOADS — CSS runs after the preload scanner has already queued it — so the two-div version
 * of this component fetched BOTH creatives on every view, and `priority` on both injected two
 * <link rel="preload"> entries, which ignore CSS entirely. A desktop visitor would preload the
 * mobile asset at high priority against the real LCP. <source media> is the only thing the
 * preload scanner actually honours. promo-banner.tsx has done it this way since the partner
 * artwork landed; this follows it.
 *
 * ⚠️ NO MOBILE CREATIVE MEANS ONE BOX AT THE WIDE RATIO, not the wide artwork crammed into the
 * narrow box. Cropping a 4.3:1 banner to 1.9:1 is exactly the damage described above, so a shop
 * that uploaded only one file gets it whole and smaller rather than large and cut.
 */
export function BannerImage({
  url,
  mobileUrl,
  alt,
  priority,
  className,
}: {
  url: string
  mobileUrl?: string | null
  alt: string
  priority?: boolean
  className?: string
}) {
  const shared = `relative w-full overflow-hidden rounded-2xl bg-tint ${className ?? ''}`
  // The aspect box has to match whichever creative will actually be shown at that width, or the
  // reserved space is the wrong height and the page still shifts when the image lands.
  const box = mobileUrl ? 'aspect-[366/188] sm:aspect-[1280/300]' : 'aspect-[1280/300]'
  return (
    <div className={`${shared} ${box}`}>
      <picture>
        {mobileUrl ? <source media="(min-width: 640px)" srcSet={url} width={1280} height={300} /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image cannot art-direct; a
            <source media> inside <picture> is the only switch the preload scanner honours. */}
        <img
          src={mobileUrl || url}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
        />
      </picture>
    </div>
  )
}
