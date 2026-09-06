import { NextResponse } from 'next/server'
import { PROMO_SLIDES } from '@/lib/promo-slides'
import { SERVICES_PROMO_SLIDES } from '@/lib/promo-slides-services'
import { IS_SERVICES } from '@/lib/edition'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * THE HOME BANNER, FOR THE NATIVE APPS.
 *
 * ⛔ THE APP HAD NO BANNER AT ALL. The web's home opens with the partner carousel — VinWonders,
 * VietKite, GMBR on the marketplace — and the iOS home went straight from the search bar to the
 * category rail. Owner, 2026-09-06: *"no banner etc. look at mobile web version and apply app
 * similarly"*.
 *
 * ⚠️ THE LIST IS SERVED, NOT DUPLICATED IN SWIFT, and that is the whole point of the endpoint. A
 * partner added, reordered or pulled in `promo-slides.ts` reaches the app on its next launch
 * instead of on its next App Store release — and, more importantly, the EDITION SPLIT is decided
 * here by the same `IS_SERVICES` the web uses. A hardcoded Swift list would eventually show a
 * marketplace visitor a slide for a service eno.vn may not advertise, which is the one mistake
 * this codebase must not make twice.
 *
 * Only what a banner needs: the mobile artwork, where it goes, and its alt text in both
 * languages. No CSS surfaces, no icon components, no desktop cuts.
 */
export async function GET() {
  const slides = (IS_SERVICES ? SERVICES_PROMO_SLIDES : PROMO_SLIDES)
    // A slide with no baked artwork is a CSS panel on the web (headline + body + CTA over a
    // coloured surface). The app has no equivalent and must not invent one, so it shows the
    // slides that ARE pictures and silently skips the rest.
    .filter((s) => s.art?.mobile)
    .map((s) => ({
      key: s.key,
      image: s.art!.mobile,
      href: s.href,
      alt: s.art!.alt,
      altVi: s.art!.altVi,
      partner: s.art!.partner ?? null,
    }))

  return NextResponse.json(
    { slides },
    { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } },
  )
}
