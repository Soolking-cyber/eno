import type { Metadata } from 'next'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { langAlternatesFor } from '@/lib/lang-alternates'
import { POSTING_IS_FREE, organizationId, pageShare, siteOrigin, websiteId } from '@/lib/site-identity'
import { MARKETPLACE_TAGLINE, SITE_TITLE } from '@/lib/site-title'

/**
 * THE HOME PAGE'S OWN METADATA, BY `[lang]` VARIANT (SEO wave B, V2; copy sheet CS-3, approved by the
 * owner 2026-10-01). Pure, so the variants are testable without the page's data (home-metadata.test.ts).
 *
 * ⛔ ONLY THE MARKETPLACE'S VIETNAMESE VARIANT SETS A TITLE AND DESCRIPTION, the pattern of `/about`
 * (about/page.tsx). The English variant, and eno.forum in both, keep the root layout's title and
 * description (layout.tsx) byte for byte. A Vietnamese reader of `/` got the English title.
 * ⚠️ `openGraph` / `twitter` STAY THE LAYOUT'S ENGLISH ON BOTH VARIANTS, as /about decided: a share scraper
 * sends no language, so the card must not depend on which variant it happened to hit.
 * ⚠️ "MIỄN PHÍ" ONLY THROUGH `POSTING_IS_FREE` (site-identity.ts), which cites the legal clauses it rests
 * on; it is rendered from the flag, never typed. "cho người nước ngoài và người Việt" is the site's
 * positioning, word for word from the live /about title. No "trusted" (CS-3 claim 1).
 * ⚠️ THE TITLE IS AT 60 CHARACTERS WITH THE FLAG ON. Do not lengthen it.
 */
export const HOME_TITLE_VI = `${SITE_NAME} — ${POSTING_IS_FREE ? 'rao vặt miễn phí' : 'rao vặt'} cho người nước ngoài và người Việt`
/** The four shelves are the English description's typed list (layout.tsx SITE_DESCRIPTION); they change together. */
export const HOME_DESCRIPTION_VI = `${SITE_NAME} là chợ rao vặt${POSTING_IS_FREE ? ' miễn phí' : ''} cho người nước ngoài và người Việt tại Việt Nam: nhà cho thuê, việc làm, nội thất, đồ điện tử và nhiều hơn nữa.`

/**
 * Self-canonical so Google attributes ranking signals to the no-redirect www host.
 *
 * ⛔ UNDER THE `/vi` PILOT (SEO wave B, V3b — dormant until V5 puts `/` in VI_PREFIX_PATHS, marketplace
 * only): the plain URL is always the English variant and `/vi` the Vietnamese one, so each is
 * self-canonical with reciprocal hreflang (en, vi-VN, x-default → plain; decision V-g), and each carries a
 * share card in its own words with a matching og:url and og:locale — `/vi` gets V2's Vietnamese card
 * (CS-3 V3b-2), which the plain URL never does. With `/` not in the list, `langAlternatesFor` is null and this
 * returns exactly what V2 did.
 */
/**
 * The home page's markdown twin, advertised as `<link rel="alternate" type="text/markdown" href="…/index.md">` (ora's
 * "Markdown alternate link", 2026-11-16). /index.md is the document `Accept: text/markdown` on `/` returns
 * (llms.txt's bytes) with a frontmatter block on top (src/app/md/index/route.ts), so the advertised URL really serves
 * markdown, and its frontmatter names `/` as canonical.
 * The HTTP `Link:` header on `/` (next.config.ts headers()) advertises the same twin.
 */
export const HOME_MARKDOWN_TWIN = { 'text/markdown': '/index.md' } as const
/**
 * …and the Atom feed of the newest listings (src/app/feed.xml; owner 2026-11-19, from an agent-readiness scan: "No RSS or Atom
 * feed declared in the page head"), declared beside the twin as `<link rel="alternate" type="application/atom+xml">`. The `Link:`
 * header on `/` (next.config.ts headers()) names it too.
 */
export const HOME_ALTERNATE_TYPES = { ...HOME_MARKDOWN_TWIN, 'application/atom+xml': '/feed.xml' } as const

/**
 * The home page's explicit crawler rules (owner 2026-11-19, an SEO/AI-search scan: "robots: missing"): the default index,
 * follow made explicit, plus large image previews and full snippets (Google Discover, AI answers). On THIS page only, not the
 * root layout: a page's own robots replaces a layout's (Next does not merge them), and the Teach in Vietnam pages set theirs
 * (teach-in-vietnam/[slug]/page.test.ts holds every layout above them robots-free).
 */
export const HOME_ROBOTS = {
  index: true,
  follow: true,
  googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
} as const satisfies Metadata['robots']

export function homeMetadata(lang: string): Metadata {
  // The one head helper every `/vi` twin uses (src/lib/lang-alternates.ts).
  const pilot = IS_SERVICES ? null : langAlternatesFor('/', lang, undefined, siteOrigin())
  const base: Metadata = pilot
    ? { alternates: { canonical: pilot.canonical, languages: pilot.languages, types: HOME_ALTERNATE_TYPES }, robots: HOME_ROBOTS }
    : { alternates: { canonical: '/', types: HOME_ALTERNATE_TYPES }, robots: HOME_ROBOTS }
  if (IS_SERVICES || lang !== 'vi') {
    return pilot ? { ...base, ...pageShare({ title: SITE_TITLE, description: MARKETPLACE_TAGLINE, url: pilot.canonical }) } : base
  }
  return {
    ...base,
    title: HOME_TITLE_VI,
    description: HOME_DESCRIPTION_VI,
    ...(pilot ? pageShare({ title: HOME_TITLE_VI, description: HOME_DESCRIPTION_VI, url: pilot.canonical }) : {}),
  }
}

/**
 * The home page as a schema.org WebPage (owner 2026-11-17, "go" on the AEO checker's "Article/WebPage schema" item): the
 * home page declared the site (WebSite) and its lists (ItemList), never itself. Its name is the title the variant
 * shows (homeMetadata's rule: Vietnamese only on the marketplace's vi variant), its url the canonical. It points at the
 * layout's WebSite and Organization nodes by @id on the marketplace, where those carry one (layout.tsx).
 */
export function homeWebPageJsonLd(lang: string): Record<string, unknown> {
  const origin = siteOrigin().replace(/\/+$/, '')
  const vi = !IS_SERVICES && lang === 'vi'
  // Under the /vi pilot each variant has its own canonical, so each is its own page: the @id follows the url. `href`
  // normalises the pilot's bare origin ("https://eno.vn") to "https://eno.vn/", so the fragment sits on a path.
  const url = new URL((IS_SERVICES ? null : langAlternatesFor('/', lang, undefined, origin))?.canonical ?? `${origin}/`).href
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: vi ? HOME_TITLE_VI : SITE_TITLE,
    inLanguage: lang === 'vi' ? 'vi' : 'en',
    ...(IS_SERVICES ? {} : { isPartOf: { '@id': websiteId(origin) }, about: { '@id': organizationId(origin) } }),
    // The page's place in the site (owner 2026-11-22, an audit's "Add breadcrumbs + BreadcrumbList JSON-LD" on the home page): the home
    // page is the trail's first and only step. Nested here rather than a script of its own, so it adds a few hundred bytes, not a node.
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [{ '@type': 'ListItem', position: 1, name: vi ? 'Trang chủ' : 'Home', item: url }],
    },
  }
}

/**
 * The home WebPage node's @id, for the questions block's Article (`isPartOf`, home-faq.ts). null on eno.forum, whose home node
 * carries no Organization links (the IS_SERVICES branch above), and null if the id ever goes missing: the Article is then left
 * out, never printed with a dangling id and never a reason for the page to fail (home-faq.test.ts pins the marketplace value).
 */
export function homeWebPageId(lang: string): string | null {
  if (IS_SERVICES) return null
  const id = homeWebPageJsonLd(lang)['@id']
  return typeof id === 'string' && id.endsWith('#webpage') ? id : null
}
