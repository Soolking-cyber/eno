import type { Metadata } from 'next'
import Link from 'next/link'
import { Compass, Home, LifeBuoy, MapPin, Bike, Armchair, Tag, Building2, Briefcase, ShoppingBag, KeyRound, Search } from 'lucide-react'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { EnoMascot } from '@/components/marketplace/eno-mascot'
import { Tr } from '@/context/language-context'

export const metadata: Metadata = { title: 'Page not found | eno.vn' }

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

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-3 py-16">
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
          <EnoMascot className="mx-auto h-24 w-24 text-accent-foreground" />
          <p className="eyebrow mt-6 text-accent-foreground"><Tr text="Error 404" /></p>
          <h1 className="h-display mt-2 text-foreground"><Tr text="This page has moved on." /></h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-body">
            <Tr text="The listing may have sold, been taken down, or the link is broken — let's get you back to the good stuff." />
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            <Link href="/" className="flex items-center gap-2 rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]">
              <Home className="h-4 w-4" /> <Tr text="Back to home" />
            </Link>
            <Link href="/" className="flex items-center gap-2 rounded-xl border border-line-strong bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-[#0a66c2] hover:text-accent-foreground">
              <Compass className="h-4 w-4" /> <Tr text="Browse listings" />
            </Link>
            <Link href="/help" className="flex items-center gap-2 rounded-xl border border-line-strong bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-[#0a66c2] hover:text-accent-foreground">
              <LifeBuoy className="h-4 w-4" /> <Tr text="Help center" />
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
