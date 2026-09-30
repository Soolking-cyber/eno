import type { Metadata } from 'next'
import { detectContentLang, looksVietnamese } from '@/lib/detect-lang'
import { SITE_NAME } from '@/lib/edition'
import { LANGS } from '@/lib/i18n/langs'
import { normalizePhone } from '@/lib/phone'
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
 * The marketplace Organization node's `@type`: the most specific schema.org subtype that is TRUE.
 *
 * Google asks for "the most specific schema.org subtype of Organization" and gives OnlineStore as the
 * e-commerce example. eno is not one: it sells nothing itself, takes no payment and ships nothing
 * (the layout's own description says there are no payments on the platform), so OnlineStore would
 * claim a checkout that does not exist. OnlineBusiness, "a particular online business, either
 * standalone or the online part of a broader organization", is what a classifieds site is. Not a
 * LocalBusiness either: the head office is a registered address, not a place customers visit.
 *
 * ⚠️ MARKETPLACE ONLY. The layout keeps plain `Organization` on eno.forum, whose operator is not yet
 * incorporated (src/lib/site-legal.ts); the node there carries no entity fields to type more
 * precisely. The pages that REFER to the node by @id (help articles, guides) keep
 * `"@type": "Organization"` on the reference: OnlineBusiness is its subtype, so the two agree.
 */
export const ORGANIZATION_TYPE = 'OnlineBusiness'

/**
 * A Vietnamese number in E.164 ("+84772007921") for structured data, or null when it is not one.
 *
 * Google's Organization docs: telephone must "include the country code". site-legal.ts transcribes
 * the local form the certificate prints ("0772007921") and must keep doing so, so the conversion
 * happens here, at the machine-facing edge. It rides normalizePhone (src/lib/phone.ts), the repo's
 * one Vietnamese normaliser (the stored Seller.phone key and every tel: link), rather than a second
 * copy of its rules, and only adds a shape check on the result.
 *
 * ⛔ NULL, NEVER A GUESS. The pending operator's phone is the "đang cập nhật" placeholder (no digits),
 * and a foreign or malformed number would normalise to something that is not a Vietnamese number:
 * both come back null and the caller drops the field. +84 plus 9 digits is a mobile, plus 10 a
 * landline (two-digit area code since the 2017 renumbering).
 */
export function toE164VN(phone: string | null | undefined): string | null {
  const e164 = normalizePhone(phone ?? '')
  return /^\+84\d{9,10}$/.test(e164) ? e164 : null
}

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
 * The link-preview card, for a page that sets its own `openGraph` — which it does through
 * pageOpenGraph() below, never by hand.
 *
 * ⚠️ WHY A PAGE NEEDS IT AT ALL: Next REPLACES a parent's `openGraph` object with the page's, it does
 * not merge into it. A page that overrides only title/description ships no og:image, og:type or
 * og:site_name (measured on the marketplace guides, 2026-09-27). The root layout's OG_IMAGE
 * (src/app/[lang]/layout.tsx) is built from this, and its comment explains the 1200x630 shape.
 */
export const SHARE_CARD = { url: '/og/share-card.jpg', width: 1200, height: 630 } as const
/** The share card's alt — what the image SHOWS, the site, so it is the same on every page that uses it. */
export const SHARE_CARD_ALT = `${SITE_NAME} — buy, sell, rent and connect in Vietnam`

type OgImage = { url: string; width?: number; height?: number; alt?: string }
/** What a page says about itself in a link preview. `images` omitted = the site's share card. */
export type PageOg = { title: string; description: string; url?: string; type?: 'website' | 'article'; images?: OgImage[] }

/**
 * og:locale for a preview — the language its words are WRITTEN in, not the reader's. The Vietnamese
 * guides ("Bán đồ cũ ở đâu được giá") and a category's Vietnamese variant say vi_VN, everything
 * written in English says en_US, and text in another script says nothing (Facebook's default, en_US,
 * would be a lie there).
 * ⛔ FOR COPY WE WRITE, NOT A SELLER'S. The listing page sets none: a seller's description naming
 * "Samsung Galaxy Tab Pro" is four unmarked words, and this reads it as English (review, 2026-09-29).
 * ⚠️ THE DESCRIPTION DECIDES; the title only when there is none. A title is where the NAMES are — a
 * shop ("Honeycomb House | eno.vn" over "Honeycomb House trên eno.vn: 229 tin đăng…" said en_US on the
 * Vietnamese storefront), a bilingual heading ("Prohibited items & services | Hàng hóa & dịch vụ cấm",
 * settled by the English sentence under it) — while the description is a sentence in one language.
 * Judging one string also keeps the two from being GLUED: that made a false unmarked run across the
 * seam ("Minh | eno.vn tin cho" — four words) and read a wholly Vietnamese /c/rentals preview as English.
 * ⚠️ looksVietnamese, not detectContentLang, decides Vietnamese: the detector calls "… for rent —
 * Tây Thạnh Ward" Vietnamese on one letter, and that title is English.
 */
export function ogLocaleFor(title: string, description = ''): 'vi_VN' | 'en_US' | undefined {
  const words = description.trim() ? description : title
  if (looksVietnamese(words)) return 'vi_VN'
  const script = detectContentLang(words)
  return script === null || script === 'vi' ? 'en_US' : undefined
}

/**
 * A page's `openGraph`, ALWAYS with an image, the site name, a type and a locale.
 *
 * ⛔ NEXT REPLACES THE PARENT'S `openGraph`, IT DOES NOT MERGE INTO IT. A page that wrote only
 * `{ title, description }` shipped no og:image at all — /c/rentals, /c/rentals/d1, /hcmc-rent-index
 * and the guides that named themselves unfurled with no picture (curl as facebookexternalhit on
 * prod, 2026-09-29) — and a page with no `openGraph` of its own (/trust, /help, the 36 phone guides)
 * announced itself with the home page's title. src/app/[lang]/og-images-contract.test.ts fails any
 * page that goes back to a literal. `images` defaults to the share card; the PDP writes its own
 * object, with the listing's photos.
 */
export function pageOpenGraph(og: PageOg): NonNullable<Metadata['openGraph']> {
  const { images, type = 'website', ...rest } = og
  const locale = ogLocaleFor(og.title, og.description)
  return {
    ...rest,
    siteName: SITE_NAME,
    type,
    ...(locale ? { locale } : {}),
    images: images?.length ? images : [{ ...SHARE_CARD, alt: SHARE_CARD_ALT }],
  }
}

/**
 * The X/Twitter card for the same page. ⚠️ SAME REPLACE-NOT-MERGE RULE, AND IT BIT HARDER: a page
 * that set only `openGraph` inherited the LAYOUT's `twitter`, so every one of them — /c/rentals, the
 * guides — shipped twitter:title "eno.vn - Trusted Expat Marketplace in Vietnam" beside its own
 * og:title (prod, 2026-09-29), and X reads twitter:title first.
 */
export function pageTwitter(og: PageOg): NonNullable<Metadata['twitter']> {
  return { card: 'summary_large_image', title: og.title, description: og.description, images: [og.images?.[0]?.url ?? SHARE_CARD.url] }
}

/** Both cards from one description — what a page spreads into its metadata: `...pageShare({ … })`. */
export function pageShare(og: PageOg): Pick<Metadata, 'openGraph' | 'twitter'> {
  return { openGraph: pageOpenGraph(og), twitter: pageTwitter(og) }
}

/**
 * A page whose preview says exactly what its <title> and meta description say: wrap its metadata,
 * `export const metadata: Metadata = withShare({ title, description, alternates })`, and both cards
 * take those two strings — one copy, so they cannot drift — with the canonical as og:url.
 */
export function withShare(m: Metadata & { title: string; description: string }, og?: Pick<PageOg, 'type' | 'images'>): Metadata {
  const canonical = m.alternates?.canonical
  return {
    ...m,
    ...pageShare({ title: m.title, description: m.description, ...(typeof canonical === 'string' ? { url: canonical } : {}), ...og }),
  }
}
