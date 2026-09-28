import { SITE_NAME } from '@/lib/edition'
import { LANGS } from '@/lib/i18n/langs'
import { SOCIALS } from '@/lib/socials'
import type { LegalOperator } from '@/lib/site-legal'

/**
 * WHO THIS SITE IS, IN THE SHAPE MACHINES READ — the pieces the root layout's Organization/WebSite
 * JSON-LD, /about and /llms.txt must agree on.
 *
 * ⚠️ PURE AND IMPORT-LIGHT ON PURPOSE (no db, no server-only): the root layout, a server page, a route
 * handler and the tests all read it, and none of them should pay for a database client to learn a
 * URL fragment.
 */

/**
 * ⚠️ POSTING IS FREE TODAY, AND THIS IS THE ONE FLAG THE MACHINE-FACING SURFACES READ FOR IT.
 * Source of truth is legal copy, not this file: Operating Regulations Article 8
 * (src/app/[lang]/regulations/page.tsx, `id: 'fees'` — "Posting, browsing and contacting sellers
 * on … are currently free") and the Terms' Fees section (src/app/[lang]/terms/page.tsx, `id: 'fees'`
 * — "Creating an account, browsing and posting are currently free"). Both promise that any fee is
 * published in VND at least 5 days before it applies.
 * ⛔ THE DAY A FEE IS ANNOUNCED, FLIP THIS WITH THOSE TWO PAGES. /about, /llms.txt and the homepage
 * sentence stop saying "free" the moment it is false; nothing else needs finding by grep.
 */
export const POSTING_IS_FREE = true

/**
 * This deployment's origin — same derivation as src/app/llms.txt/route.ts and robots.txt/route.ts:
 * NEXT_PUBLIC_APP_URL, which next.config.ts asserts matches the edition, with an edition-correct
 * fallback. A function, not a constant, so a test can stub the env and see the change.
 */
export function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
}

/**
 * The JSON-LD node ids. `#organization` / `#website` fragments on the site root are the convention
 * Google's own examples use; what matters is that every page that REFERS to the entity writes the
 * same string the layout DECLARES, which is why these are functions here and never typed inline.
 */
export const organizationId = (origin: string) => `${origin}/#organization`
export const websiteId = (origin: string) => `${origin}/#website`

/**
 * Profiles eno OWNS that are not social channels, so they belong in `sameAs` but not in the footer
 * row (src/lib/socials.ts renders every entry there). Owner, 2026-09-28: the Crunchbase company
 * profile and the Pinterest business account (its website claim is the p:domain_verify tag in the
 * layout). Directory listings and review pages eno does not control stay out.
 */
export const ENTITY_PROFILES: readonly string[] = [
  'https://www.crunchbase.com/organization/eno-vn-9f19',
  'https://www.pinterest.com/enovietnam/',
]

/**
 * The fields that make the Organization node an ENTITY rather than a name — @id, the owned social
 * profiles, where it operates and the languages its interface runs in.
 *
 * ⛔ MARKETPLACE EDITION ONLY — the caller gates it, and must. These are eno.vn's profiles and
 * identity; asserting them from eno.forum would tell search engines the two sites are one entity,
 * which is the opposite of what the edition split and the layout's own comment establish. Omitting is
 * the reversible choice until counsel says otherwise.
 *
 * `sameAs` is every SOCIALS entry marked `me: true` plus ENTITY_PROFILES below — the profiles eno
 * OWNS. The community group is
 * deliberately not one (a place members post, not an identity of eno; see src/lib/socials.ts).
 *
 * `knowsLanguage` is the interface roster in src/lib/i18n/langs.ts as BCP 47 codes. ⚠️ That is the
 * languages the SERVICE runs in (UI plus machine-translated listings and chat); the languages a human
 * answers support in stay on `contactPoint.availableLanguage` (vi, en). Do not merge the two.
 *
 * `areaServed` is the country and nothing narrower: a city list here would be a static claim about
 * where stock is, and stock moves (measured 2026-09-27: every rental is in Ho Chi Minh City, yet
 * /llms.txt used to promise Hanoi and Da Nang). /about and /llms.txt state the city split live.
 */
export function marketplaceOrganizationFields(origin: string) {
  return {
    '@id': organizationId(origin),
    sameAs: [...SOCIALS.filter((s) => s.me).map((s) => s.href), ...ENTITY_PROFILES],
    areaServed: { '@type': 'Country', name: 'Vietnam' },
    knowsLanguage: [...LANGS],
  }
}

/**
 * legalName + registration number, ONLY when the operator's certificate exists.
 *
 * ⛔ GATED ON `registered`, the same gate as the layout's address/contactPoint: an unregistered
 * operator's fields are the "đang cập nhật" placeholders, and emitting those as a legalName would be
 * a false business identity in machine-readable form. It is keyed on the operator passed in (COMPANY
 * = OPERATORS[EDITION]), so eno.forum emits its OWN entity the day it registers — never eno.vn's.
 *
 * `identifier`, not `taxID`: the number is the ERC's mã số doanh nghiệp. It is also the tax code under
 * the 2020 Enterprise Law, but the certificate is what src/lib/site-legal.ts transcribes, so that is
 * what is claimed.
 */
export function registeredOperatorFields(op: Pick<LegalOperator, 'registered' | 'name' | 'erc'>) {
  if (!op.registered) return {}
  return {
    legalName: op.name,
    identifier: { '@type': 'PropertyValue', propertyID: 'VN business registration number (mã số doanh nghiệp)', value: op.erc },
  }
}

/**
 * /about as an AboutPage whose subject is the Organization node the layout declares.
 *
 * Marketplace only, for the reason above: on eno.forum the layout emits no @id to point at, and a
 * second inline Organization node on that page would be the one-entity signal by another route.
 */
export function aboutPageJsonLd(origin: string, page: { name: string; description: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${origin}/about#webpage`,
    url: `${origin}/about`,
    name: page.name,
    description: page.description,
    isPartOf: { '@id': websiteId(origin) },
    about: { '@id': organizationId(origin) },
    mainEntity: { '@id': organizationId(origin) },
  }
}

/**
 * The link-preview card, for a page that sets its own `openGraph`.
 *
 * ⚠️ WHY A PAGE NEEDS IT AT ALL: Next REPLACES a parent's `openGraph` object with the page's, it does
 * not merge into it. A page that overrides only title/description ships no og:image, og:type or
 * og:site_name (measured on the marketplace guides, 2026-09-27). Same file and dimensions as the root
 * layout's OG_IMAGE (src/app/[lang]/layout.tsx), whose comment explains the 1200x630 shape; the
 * layout should import this rather than keep its own literal.
 */
export const SHARE_CARD = { url: '/og/share-card.jpg', width: 1200, height: 630 } as const
