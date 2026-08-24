import Image from 'next/image'
import Link from 'next/link'
import type { PartnerBanner } from '@/lib/partner-banners'
import { Tr } from '@/context/language-context'

/**
 * Official partners' banners, above the home feed.
 *
 * ⚠️ RENDERS NOTHING WHEN THERE ARE NONE, which is today's state and must stay cheap: no heading,
 * no empty frame, no reserved space. A section that collapses from a skeleton to nothing was this
 * homepage's dominant layout shift once already (CLS 0.142, fixed by making rail geometry
 * server-known) — an empty strip that still occupied height would reintroduce it.
 *
 * ⚠️ THE BOX IS SIZED BEFORE THE IMAGE LOADS, for the same reason: this sits above the listings,
 * so an unreserved banner pushes the entire feed down as it arrives.
 *
 * ⚠️ AN ORDINARY LINK, NOT A CARD. It goes to the partner's storefront on THIS site — it is not an
 * outbound affiliate link and must not carry rel="sponsored", which would be a false declaration
 * about an internal navigation.
 */
export function PartnerBannerStrip({ banners }: { banners: PartnerBanner[] }) {
  if (!banners.length) return null
  return (
    <section aria-labelledby="partner-banners-heading" className="mb-6">
      {/* ⚠️ A HIDDEN HEADING, NOT aria-label="Official partners". This is a Server Component, so the
          `tr()` hook every client component uses is unavailable here — and a bare English
          aria-label would name the loudest landmark on the home page in English for every
          Vietnamese screen-reader user. <Tr> is a client component that a server one may render,
          so the name goes through the same catalogue as the rest of the site. */}
      <h2 id="partner-banners-heading" className="sr-only">
        <Tr text="Official partners" />
      </h2>
      <div className="flex flex-col gap-3">
        {banners.map((b) => (
          <Link
            key={b.id}
            href={b.handle ? `/${b.handle}` : `/sellers/${b.id}`}
            className="group relative block w-full overflow-hidden rounded-2xl bg-tint aspect-[3/1] sm:aspect-[5/1] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Image
              src={b.bannerUrl}
              /* The link needs an accessible name and the image is the only content in it, so the
                 alt carries it here — unlike the storefront cover, where the shop's own <h1> sits
                 directly beneath and an alt would say the name twice. */
              alt={b.name}
              fill
              className="object-cover transition-transform duration-[240ms] ease-[var(--ease-spring-snappy)] group-hover:scale-[1.015]"
              sizes="(min-width: 1280px) 1280px, 100vw"
              /* Only the first is priority: it is the plausible LCP element. Marking all of them
                 would have the browser fetch every banner before the listings. */
              priority={b === banners[0]}
            />
          </Link>
        ))}
      </div>
    </section>
  )
}
