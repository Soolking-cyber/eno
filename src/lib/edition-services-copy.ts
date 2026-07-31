/**
 * Services-edition-only link and tile copy, in ONE module so it can be aliased away.
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL. These entries were already gated with `IS_SERVICES ? [...] : []`
 * at their call sites, and that gate WORKS — nothing renders on eno.vn. But a gate is a runtime
 * check: the marketplace bundle still contained `h.IS_SERVICES?[{label:e("Vietnam e-Visa online",…)}]:[]`
 * in 21 chunks, because `IS_SERVICES` is not dead-code-eliminated across module boundaries
 * (measured — see src/lib/edition.ts). The footer renders on every page, so the words travelled
 * everywhere.
 *
 * Moving the literals behind a module boundary lets `next.config.ts` alias the whole thing to an
 * empty stub on a marketplace build, which is the only mechanism that removes strings from the
 * artifact rather than merely declining to render them.
 *
 * ⚠️ KEEP THE CALL-SITE GATES TOO. Belt and braces: the alias controls the ARTIFACT, the gate
 * controls BEHAVIOUR, and a future build without the alias must still not render these.
 */

export type ServicesLink = { labelEn: string; labelVi: string; href: string }
export type ServicesTile = { key: string; name: string; nameVi: string; icon: string; kind: 'filter' | 'route'; href: string }

/** Footer entries that point at services surfaces. */
export const SERVICES_FOOTER_LINKS: Record<'popular' | 'explore' | 'help', ServicesLink[]> = {
  popular: [
    { labelEn: 'Services for expats in Vietnam', labelVi: 'Dịch vụ cho người nước ngoài', href: '/services-for-expats-vietnam' },
    { labelEn: 'Vietnam e-Visa online', labelVi: 'e-Visa Việt Nam trực tuyến', href: '/vietnam-evisa' },
  ],
  explore: [
    { labelEn: 'Trip planner', labelVi: 'Lập kế hoạch chuyến đi', href: '/itinerary' },
  ],
  help: [
    { labelEn: 'Vietnam e-Visa help', labelVi: 'Hỗ trợ e-Visa Việt Nam', href: '/eno_visa' },
  ],
}

/** The two home-page desk tiles. */
export const SERVICES_DESK_TILES: ServicesTile[] = [
  { key: 'evisa', name: 'Vietnam e-Visa', nameVi: 'e-Visa Việt Nam', icon: 'Stamp', kind: 'filter', href: '/?category=services&subcategory=visa-legal' },
  { key: 'trip', name: 'Trip planner', nameVi: 'Lên lịch trình', icon: 'CalendarDays', kind: 'route', href: '/itinerary' },
]
