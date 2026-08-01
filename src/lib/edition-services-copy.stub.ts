/**
 * MARKETPLACE-EDITION STUB for edition-services-copy.ts.
 *
 * eno.vn is a licensed sàn TMĐT. next.config.ts aliases the real module here so its link labels and
 * tile names — "Vietnam e-Visa online", "Trip planner", "Hỗ trợ e-Visa Việt Nam" — are never emitted
 * into a client chunk. Empty arrays render nothing at every call site.
 */
/**
 * ⚠️ EMPTY, AND THIS ONE SEVERS THE LAST UNALIASED PATH FROM A SHARED FILE INTO A SERVICES TREE.
 * The real module re-exports `VIETNAM_EVISA_PATHS` from `@/app/vietnam-evisa/links` purely so the
 * shared sitemap route can stop importing that module directly — a plain `.ts` full of e-visa
 * labels and blurbs that `pageExtensions` does NOT exclude. Empty here means a marketplace build
 * never resolves it, so none of those words reach eno.vn's bundle. The sitemap loop is also gated
 * on IS_SERVICES, so this emits nothing either way.
 */
export const SERVICES_SITEMAP_PATHS: readonly string[] = []

export type ServicesLink = { labelEn: string; labelVi: string; href: string; rel?: string }
export type ServicesTile = { key: string; name: string; nameVi: string; icon: string; kind: 'filter' | 'route'; href: string }
export type ServicesFooterGroup = { titleEn: string; titleVi: string; links: ServicesLink[] }

export const SERVICES_FOOTER_LINKS: Record<'popular' | 'explore' | 'help', ServicesLink[]> = { popular: [], explore: [], help: [] }
/**
 * ⚠️ EMPTY, AND THAT ALSO SEVERS AN IMPORT. The real module builds this group from
 * @/lib/cross-site-links, so the stub is what stops eno.vn pulling in a list of links to itself
 * along with the copy describing them — a titled "On eno.vn" column on eno.vn is both pointless and
 * a page full of self-links. cross-site-links is aliased on its own account too; see next.config.ts
 * for why neither alias is redundant.
 */
export const SERVICES_FOOTER_GROUPS: ServicesFooterGroup[] = []
export const SERVICES_DESK_TILES: ServicesTile[] = []

/**
 * ⚠️ EMPTY HREFS AND EMPTY LABELS, AND BOTH MATTER FOR THE SAME REASON THE MODULE EXISTS. These
 * three rows are ALSO constructed inside an `IS_SERVICES ?` gate in dashboard-nav.tsx, so nothing
 * here is ever read on eno.vn — the gate is the belt. This file is the braces: it is what actually
 * keeps "My e-Visa" / "E-Visa của tôi" out of the client chunks the licensed marketplace serves,
 * which a runtime gate cannot do (measured — see src/lib/edition.ts).
 *
 * ⚠️ NO PLACEHOLDER COPY. A helpful "Visas" or "/dashboard/visa" here would put the vocabulary
 * straight back into the artifact this stub exists to keep it out of.
 */
export type ServicesNavRow = { href: string; en: string; vi?: string }
export const SERVICES_NAV_TRIPS: ServicesNavRow = { href: '', en: '' }
export const SERVICES_NAV_CASES: ServicesNavRow = { href: '', en: '' }
export const SERVICES_NAV_ADMIN_QUEUE: ServicesNavRow = { href: '', en: '' }

/**
 * ⚠️ EMPTY, NOT A MARKETPLACE DESCRIPTION. These are only ever read inside an `IS_SERVICES ? … : …`
 * ternary, so on eno.vn the value is never used — and writing a helpful marketplace sentence here
 * would mean two places own eno.vn's own description, which is how they drift.
 */
export const SERVICES_SITE_DESCRIPTION = ''
export const SERVICES_SITE_TAGLINE = ''
export const SERVICES_SITE_KEYWORDS: string[] = []

export type ServicesSafetyTip = { icon: string; title: string; body: string }
export type ServicesSafetyCopy = {
  navId: string
  navLabel: string
  metaDescription: string
  sectionTitle: string
  intro: string
  tips: ServicesSafetyTip[]
  willTitle: string
  will: string[]
  wontTitle: string
  wont: string[]
  crossLink: { before: string; label: string; href: string; after: string }
}

/**
 * ⚠️ EMPTY, AND THE EMPTY ARRAYS ARE LOAD-BEARING. /safety renders on BOTH editions from one file;
 * its visa block is gated on IS_SERVICES, and this is what additionally keeps "evisa.gov.vn" and the
 * surrounding vocabulary out of the artifact eno.vn serves. The page maps over `tips`/`will`/`wont`,
 * so empty arrays also make the section render nothing if a future build ever loses the gate.
 *
 * ⚠️ NO EXPLANATORY COPY HERE. A stub that said "visa guidance is on eno.forum" would put the words
 * straight back into the bundle it exists to keep them out of.
 */
export const SERVICES_SAFETY: ServicesSafetyCopy = {
  navId: '',
  navLabel: '',
  metaDescription: '',
  sectionTitle: '',
  intro: '',
  tips: [],
  willTitle: '',
  will: [],
  wontTitle: '',
  wont: [],
  crossLink: { before: '', label: '', href: '', after: '' },
}
