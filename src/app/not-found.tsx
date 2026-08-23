import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Home, MapPin, Bike, Armchair, Tag, Building2, Briefcase, ShoppingBag, KeyRound, Search } from '@/components/ui/icons'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Mascot } from '@/components/marketplace/mascot'
import { Tr } from '@/context/language-context'

export const metadata: Metadata = { title: `Page not found | ${SITE_NAME}` }

// Faint, on-brand marketplace icons scattered as a lightweight background motif —
// inline SVG (lucide), so ZERO extra network weight (no raster images). Positions
// are deterministic so it renders identically every time.
const MOTIF: { Icon: typeof MapPin; top: string; left: string; size: number; rotate: number }[] = [
  { Icon: MapPin, top: '11%', left: '8%', size: 58, rotate: -12 },
  { Icon: Home, top: '20%', left: '83%', size: 74, rotate: 10 },
  { Icon: Bike, top: '63%', left: '5%', size: 66, rotate: 8 },
  { Icon: Armchair, top: '72%', left: '86%', size: 60, rotate: -8 },
  { Icon: Tag, top: '40%', left: '91%', size: 44, rotate: 14 },
  { Icon: Building2, top: '7%', left: '47%', size: 50, rotate: -6 },
  { Icon: Briefcase, top: '83%', left: '45%', size: 46, rotate: 6 },
  { Icon: ShoppingBag, top: '47%', left: '4%', size: 52, rotate: -10 },
  { Icon: KeyRound, top: '29%', left: '25%', size: 40, rotate: 16 },
  { Icon: Search, top: '58%', left: '71%', size: 46, rotate: -14 },
]

const RECOVERY_LINK = 'font-semibold text-accent-foreground hover:underline'

// ⚠️ CONSTANTS, NOT `<Tr>`. eslint's react/jsx-no-literals routes every JSX string through the
// translation catalogue, which is right for copy and wrong for these: they are FILENAMES. Wrapping
// them would put "sitemap.xml" into gen-ui-strings.mjs's catalogue as a translatable phrase, ship
// it to every visitor, and invite a translator to localise a path that must never change.
const SITEMAP_FILE = 'sitemap.xml'
const LLMS_FILE = 'llms.txt'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="relative flex flex-1 items-center justify-center overflow-hidden px-3 py-16">
        {/* Brand glow — pure CSS gradients, no images */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(55% 45% at 50% 28%, rgba(10,102,194,0.09), transparent 70%), radial-gradient(40% 40% at 85% 82%, rgba(10,102,194,0.06), transparent 70%)' }}
        />
        {/* Scattered marketplace icon motif (very faint) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 select-none">
          {MOTIF.map(({ Icon, top, left, size, rotate }, i) => (
            <Icon
              key={i}
              className="absolute"
              style={{ top, left, width: size, height: size, transform: `rotate(${rotate}deg)`, color: 'rgba(10,102,194,0.07)' }}
            />
          ))}
        </div>

        <div className="relative w-full max-w-lg text-center">
          <Mascot name="search" className="mx-auto h-72 w-72" />
          <p className="eyebrow mt-6 text-accent-foreground"><Tr text="Error 404" /></p>
          <h1 className="h-display mt-2 text-foreground"><Tr text="This page has moved on." /></h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-body">
            <Tr text="The listing may have sold, been taken down, or the link is broken — let's get you back to the good stuff." />
          </p>

          {/*
            ⛔ THE RECOVERY LINKS ARE FOR AGENTS AS MUCH AS PEOPLE, AND THEY ARE DELIBERATELY
            EDITION-NEUTRAL. A 404 that offers no route onward tells a crawler the path is dead and
            nothing more; these give it somewhere to go and a machine-readable index to go to.

            ⚠️ EVERY HREF HERE EXISTS ON BOTH EDITIONS, ON PURPOSE. This file is shared, and it is
            the wrong place to enumerate a site map: eno.vn 404s /visa and /itinerary BY LICENSING
            DESIGN, so a "where to look next" list that named services surfaces would advertise, in
            the response that exists to say a path is absent, that those paths exist somewhere. The
            sitemap and llms.txt links solve the discovery problem properly — each deployment
            generates its own, so each one lists only what that deployment may serve.

            ⚠️ NO SERVICES VOCABULARY AS A `<Tr>` LITERAL EITHER — src/app/not-found.tsx is not on
            gen-ui-strings.mjs's services path list, so a services word here ships in the catalogue
            every eno.vn visitor downloads. See the header of src/app/about/page.tsx.
          */}
          <nav aria-label="Where to go next" className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
            <Link href="/" className={RECOVERY_LINK}><Tr text="Search all listings" /></Link>
            <Link href="/help" className={RECOVERY_LINK}><Tr text="Help centre" /></Link>
            <Link href="/contact" className={RECOVERY_LINK}><Tr text="Contact us" /></Link>
          </nav>
          <p className="mt-3 text-xs text-body">
            {/* Plain <a>, not <Link>: these are non-HTML documents served by route handlers, and
                the client router should not try to prefetch or soft-navigate them. */}
            <Tr text="Looking for a machine-readable index?" />{' '}
            <a href="/sitemap.xml" className={RECOVERY_LINK}>{SITEMAP_FILE}</a>
            {' · '}
            <a href="/llms.txt" className={RECOVERY_LINK}>{LLMS_FILE}</a>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
