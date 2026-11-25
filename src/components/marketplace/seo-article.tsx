import Link from 'next/link'
import { ArrowRight, ArrowUpRight, ChevronDown, ChevronRight, Info } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Rows, Row } from '@/components/ui/rows'
import { Avatar } from '@/components/ui/avatar'
import { ARTICLE_AUTHORS, authorPersonLd } from '@/lib/article-authors'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { organizationId } from '@/lib/site-identity'
import { AFFILIATION } from '@/lib/site-legal'
import { CROSS_SITE_REL, MARKETPLACE_LINKS } from '@/lib/cross-site-links'
import { formatArticleDate } from '@/lib/dates'
import { pinnedVariant } from '@/lib/lang-pinned'
import { EXPAT_GUIDES, MARKETPLACE_GUIDES } from '@/lib/expat-guides'
import { PHONE_GUIDES } from '@/lib/phone-guides'
import { LANGUAGES } from '@/lib/languages'
import { Header } from './header'
import { Footer } from './footer'
import { keepReading } from './seo-article-related'
import { SeoListingRail, type SeoBrowseLinkProps, type SeoRailTarget } from './seo-listing-rail'
import { phoneGuideRail } from '@/lib/phone-guides-rail'
/**
 * ⚠️ `@/components/marketplace/cross-site-promo`, NOT `./cross-site-promo`, AND THE DIFFERENCE IS
 * THE WHOLE STUB MECHANISM. next.config.ts aliases this module away on a marketplace build, and a
 * Turbopack `resolveAlias` key matches the REQUEST STRING — so the aliased specifier is replaced by
 * the stub and the relative one silently is not. The sibling imports above are relative because
 * nothing aliases them; this one may never be. cross-site-links.test.ts asserts it repo-wide.
 */
import { CrossSitePromo } from '@/components/marketplace/cross-site-promo'

/**
 * LONG-FORM EDITORIAL GUIDE — the shape `seo-landing.tsx` cannot be.
 *
 * ⚠️ WHY THIS IS NOT AN OPTION ON SeoLanding. `SeoContent.sections[].body` is a `string`, rendered as
 * `<p>{s.body}</p>`. That is exactly right for a category landing page, and it makes a CONTEXTUAL
 * LINK impossible — you cannot put an anchor inside a string. Contextual in-body links are the whole
 * point of these pages: a link inside a sentence that earns it carries weight that a link in a
 * footer block does not, for a reader and for a crawler. Widening `body` to `ReactNode` would have
 * meant touching the component every marketplace landing page renders, to serve three pages that
 * also want no listing rail, no CTA button and no category. Two shapes, two components.
 *
 * ⚠️ AND THEY MUST STAY SUBSTANTIAL. A cluster of short pages whose reason for existing is the links
 * they carry is a doorway set, and Google's guidance names that pattern directly. It is also the
 * evidence somebody would point at to argue the two-site split is a sham. Every page rendered here
 * has to be worth reading with the outbound links removed — that is the test, and it is not a
 * stylistic preference.
 *
 * ⚠️ NO `web-only` WRAPPER, DELIBERATELY, AND THIS IS THE DIFFERENCE FROM SeoLanding. That component
 * hides its editorial prose in the native shell because the prose is a supporting layer under a
 * listings grid — hide it and a useful page remains. Here the prose IS the page: `html.native
 * .web-only { display: none }` would render these as a headline over an empty screen in the app.
 *
 * ⛔ EVERY WORD THIS COMPONENT ADDS IS IN THE ARTICLE'S LANGUAGE (`content.lang`), NEVER THE VISITOR'S —
 * the date line, "On this page", "Keep reading", the FAQ heading, the affiliation line and the
 * "Published by" note (ARTICLE_CHROME and DATE_LINE below). SEO wave B settled the old open decision
 * (L-SEO-LANG) this way, with V1: on the site's own hosts a guide with a declared language is also
 * served in that language to every visitor (src/lib/lang-pinned.ts), so the header and footer around
 * it match too. A storefront host (`apple.eno.vn/<guide>`) is not pinned and still negotiates. Before, a
 * Vietnamese guide carried English labels for every reader, Googlebot included.
 * ⚠️ PLAIN CONSTANTS, NOT `tr()`: they follow the article, and `tr()` follows the visitor. A reader in a
 * third language gets the article's language here, as they get it in the prose.
 * The Vietnamese is from the owner-approved copy sheet CS-2 (2026-09-30, rows V1-1 to V1-6).
 * ⚠️ AN ARTICLE WITH A DECLARED LANGUAGE AT A URL THAT IS NOT PINNED (the teach-in-vietnam library) renders under the
 * VISITOR's `<html lang>`, so it marks its own text with its language instead — see `ArticleText`.
 */

/**
 * ⚠️ THE FALLBACK IS A LAST RESORT, NOT A DEFAULT — same reasoning as src/app/[lang]/layout.tsx.
 * next.config.ts refuses to build when the edition is declared and NEXT_PUBLIC_APP_URL is absent or
 * on the wrong host, so in any real deployment this is present and correct. It matters here because
 * the Article JSON-LD names the PUBLISHER: getting it wrong would have eno.forum telling Google that
 * the licensed marketplace published its guides.
 */
const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

export type ArticleSection = {
  /** Anchor id — also the "On this page" target. Kebab-case, stable: it can be linked to. */
  id: string
  title: string
  /** Prose. `<P>`, `<Ul>` and `<VnLink>` below are the vocabulary; anything else is fine too. */
  body: React.ReactNode
  /** Sub-entries listed under this section in "On this page" (a guide's question sub-headings); each id is an anchor in `body`. */
  children?: { id: string; title: string }[]
}

export type ArticleContent = {
  eyebrow: string
  h1: string
  /** One paragraph, plain text — also the `description` on the Article JSON-LD. */
  intro: string
  /** Path only, e.g. `/moving-to-vietnam`. Used for `mainEntityOfPage`. */
  canonical: string
  /**
   * The Article JSON-LD `image`: paths on this deployment (like `canonical`), made absolute here. Google's Article
   * guidance asks for several shapes of one picture — the teach pages pass their share card in the three it names
   * (src/lib/teach-guides/share-cards.ts). Optional: an article with no picture of its own declares none rather than
   * borrowing the site's card. An absolute https URL (a guide picture in storage) is passed through as is.
   */
  image?: string[]
  /** "N min read" after the date line (a guide's computed reading time). */
  readingMinutes?: number
  /**
   * The day a person on the eno.vn team approved THIS text, and the page that says how guides are made: " · Approved by the eno.vn
   * team on …" in the date line, and `reviewedBy` + `lastReviewed` on the WebPage in JSON-LD (owner 2026-11-22: tell search engines
   * the guides are checked and approved by a person). ⛔ ONLY FROM AN APPROVAL ON RECORD: the guides library passes its registry's
   * `reviewed` date, which src/lib/guides/content.ts ties to a digest of the approved text at build. Never set it on a page no one
   * approved — a "reviewed by" nobody did is a fabrication, in the markup or on the page.
   */
  approved?: { on: string; how: string }
  /**
   * `false` on a hub or a landing page (the guides hub, the Teach in Vietnam hub, a vehicle hub): no byline under it, and the
   * Organization stays the JSON-LD author. Every article carries the byline of its language (src/lib/article-authors.ts).
   */
  byline?: false
  /** What the article cites (its Sources list): the Article's `citation` in JSON-LD, so a machine reads the sources a reader sees. */
  citations?: { name: string; url: string }[]
  /**
   * ISO date (YYYY-MM-DD). With `updated`, the ONE source of both the visible date line and the Article
   * JSON-LD's datePublished/dateModified — so what a reader sees and what Google is told cannot drift.
   */
  published: string
  updated?: string
  /**
   * A boxed note directly under the intro — in practice the provider-of-record disclosure from
   * src/lib/visa-provider.ts on any page that mentions the e-visa service.
   *
   * ⚠️ PASSED IN, NEVER IMPORTED HERE. `@/lib/visa-provider` is aliased to an empty stub on a
   * marketplace build; importing it in this shared component would work, but it would also mean this
   * file has an opinion about a service, and the point of the prop is that it does not. The page
   * that names the service owns the disclosure that goes with it.
   */
  disclosure?: string
  /**
   * The language this article is WRITTEN in — it drives `inLanguage` on the Article node and the
   * `hreflang` pair below.
   *
   * ⛔ IT IS NOT THE VISITOR'S LANGUAGE. `src/app/[lang]/` renders UI strings per visitor, but an
   * article's prose is fixed text in one language: a Vietnamese guide stays Vietnamese for an
   * English reader. Declaring `inLanguage: 'en'` on a Vietnamese article — which every article did
   * until 2026-09-19, because the value was hardcoded — tells Google the page is in a language it
   * demonstrably is not, and that is the kind of contradiction that costs the rich result.
   */
  lang?: 'en' | 'vi'
  /**
   * The same article written in the other language, as a path. Emitted as reciprocal `hreflang`
   * alternates so Google serves the Vietnamese page to Vietnamese searchers instead of picking one
   * and treating the other as a duplicate.
   *
   * ⚠️ RECIPROCAL OR NOTHING: Google ignores a one-way alternate. If A names B, B must name A.
   */
  /** `name`: the pair's own title, for its "Tiếng Việt" link (ViPairLink); without it, the guide registries are asked. */
  alternate?: { lang: 'en' | 'vi'; href: string; name?: string }
  sections: ArticleSection[]
  related?: { href: string; label: string; blurb: string }[]
  faqs: { q: string; a: string }[]
  /**
   * Additional JSON-LD nodes, emitted verbatim beside the Article and FAQPage blocks.
   *
   * The e-visa pages use this for a `Service` node whose `provider` is the licensed partner and
   * whose `broker` is this site — see src/lib/vietnam-evisa/service-jsonld.ts.
   */
  jsonLd?: Record<string, unknown>[]
  /**
   * Render the "Already in Vietnam?" eno.vn block at the foot.
   *
   * ⚠️ NOT ON EVERY PAGE. cross-site-promo.tsx argues the case in full: a disclosed recommendation
   * below the content a visitor came for is editorial, and the same block on every route is an ad
   * unit that a crawler discounts and a reader resents. Set it where the block is genuinely on
   * topic, and leave it off where the article already ends with its own contextual links.
   */
  crossSitePromo?: boolean
  /**
   * A live listing rail after the last section, before "Keep reading" — the inventory the guide has
   * just explained how to use (C-GUIDES-CTA). Same query and markup as the SEO landing pages'
   * (seo-listing-rail.tsx); it renders only with at least four listings, so a thin or failed query
   * leaves the article ending as it always did. Strings are in the article's language, like its prose.
   * `browseLink`: props for the rail's own browse link — a page whose `cta` points at the same narrowed
   * feed passes the CTA's (`rel: 'nofollow'`, `prefetch: false`) so the two links agree.
   */
  rail?: { target: SeoRailTarget; title: string; cta: string; browseLink?: SeoBrowseLinkProps }
  /**
   * Render `rail` right after THIS section (by id) instead of after the last one — for a guide whose
   * reader came for the inventory, so it is in view before the long read (A11-SEO-CTA: the secondhand
   * furniture hub ranks 13–20 for "second hand furniture", field-03). Unknown id → the default place.
   */
  railAfter?: string
  /**
   * The ONE brand CTA (`<Button variant="cta">`) directly under the lede, and with `repeatAtEnd` again
   * after the last section — the article explains, the button acts (A11-SEO-CTA, disc-04 / sell-05).
   * ⚠️ `href` ARRIVES LOCALIZED: the page knows its own fixed language and passes it through
   * localizedHref, so a Vietnamese guide never links into the English-pinned plain `/`.
   * `nofollow` for a browse link — a query string on the self-canonical `/` is not a page to rank.
   * `prefetch={false}` always: a guide is read for minutes, and a prefetched feed is wasted bytes.
   * The label is in the article's language, like its prose.
   */
  cta?: { href: string; label: string; nofollow?: boolean; repeatAtEnd?: boolean }
  /**
   * A row of controls directly under the lede — the vehicle hubs' Filters · Map · type chips (NAV-9,
   * vehicle-hub-filter-row.tsx), as the district hubs carry theirs under the lede (A13). It renders before
   * `cta` and the disclosure: a reader who came for the inventory gets the way in before the fine print.
   * The node brings its own top margin.
   */
  ledeRow?: React.ReactNode
  /**
   * The trail above the eyebrow — `Home › Teach in Vietnam › This guide` — AND, from the same list, the
   * BreadcrumbList JSON-LD. One list, two consumers, so what a reader sees and what Google is told cannot
   * disagree (the C-DATES argument, applied to the trail). The last crumb is this page: rendered as text,
   * not a link. Optional: the single-page guides have no section above them to show.
   */
  breadcrumb?: { label: string; href: string }[]
  /**
   * A block after the last section and before "Keep reading" — the teach guides' "next step on eno.vn"
   * aside. Kept out of `sections` on purpose: it is not part of the article, so it does not belong in
   * "On this page", and a repeated block inside the prose column would read as boilerplate in the text.
   */
  afterSections?: React.ReactNode
}

/**
 * ⛔ THE ARTICLE'S OWN WORDS CARRY ITS LANGUAGE WHERE `<html lang>` MAY NOT (teacher visibility plan §3a item 9).
 * `<html lang>` is the variant the server rendered (src/app/[lang]/layout.tsx): the article's language on a pinned URL
 * (src/lib/lang-pinned.ts FIXED_LANG), the VISITOR's everywhere else. So an article that declares a `lang` at a URL that
 * is not pinned — the teach-in-vietnam hub and guides, English for every reader — was declared Vietnamese, prose and all,
 * on every Vietnamese render, and `lang` is what a screen reader picks its voice by. Such a page wraps its own text in
 * `<div lang>` (`textLang` in SeoArticle): unstyled blocks, which their children's margins collapse through, so the page
 * lays out as before (measured 2026-10-19 in Chromium on the real hub and a guide, 390 and 1280 px: every box in `<main>`
 * the same). No redirect and no new URL; canonical and hreflang are untouched. A pinned URL, and an article
 * with no declared language, render exactly as before (lang-pinned's own rule decides, so pinning the library later
 * would retire this by itself).
 * ⚠️ TWO ISLANDS STAY OUTSIDE AND KEEP THE PAGE'S LANGUAGE: the listing rail, whose prices are written in the visitor's
 * (price.tsx — "Lương: xem chi tiết" on a Vietnamese render), and CrossSitePromo, which is `tr()` copy. The rail's own
 * heading and browse link ARE the article's words, so they take `textLang` themselves (SeoListingGrid `lang`).
 */
function ArticleText({ lang, children }: { lang: 'en' | 'vi' | undefined; children: React.ReactNode }) {
  return lang ? <div lang={lang}>{children}</div> : <>{children}</>
}

/** The prose column. Two of them only when `railAfter` puts the page-width rail between the sections. */
function ArticleSections({ sections, className }: { sections: ArticleSection[]; className: string }) {
  return (
    <div className={`max-w-3xl space-y-10 ${className}`}>
      {sections.map((s) => (
        // `scroll-mt` so the sticky header does not sit on top of the heading after a jump.
        // h-title (20→24px) over 16px prose, not the 18px dense-UI step (C-TYPO).
        <section key={s.id} id={s.id} className="scroll-mt-24">
          <h2 className="h-title mb-3 text-foreground">{s.title}</h2>
          {s.body}
        </section>
      ))}
    </div>
  )
}

function ArticleCta({ cta, className }: { cta: NonNullable<ArticleContent['cta']>; className: string }) {
  return (
    <div className={className}>
      {/* Sizing on the BUTTON, not the <Link>: a class on an asChild child is concatenated, not merged (CLAUDE.md). */}
      <Button asChild variant="cta" size="none" className="gap-1.5 px-5 py-2.5 text-sm font-semibold">
        <Link href={cta.href} prefetch={false} rel={cta.nofollow ? 'nofollow' : undefined}>
          {cta.label} <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  )
}

/**
 * Body paragraph. `max-w-[60ch]` holds the reading measure inside the 3xl column: the column alone
 * set 768px lines — ~80 characters at 16px (C-TYPO).
 * 2026-11-07 audit: 18px from lg, an editorial size at desktop distance — at 16px the guides read small on the wide canvas
 * (judges: eight guide desktops). `ch` resolves at the element's own size, so the measure stays ~65–70 characters a line
 * (≈675px). Below lg every size is as before.
 */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-body first:mt-0 lg:text-lg">{children}</p>
}

/** Body list. Markers are inside the content box so a wrapped line aligns under the text. 18px from lg, as P. */
export function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 max-w-[60ch] list-disc space-y-2 pl-5 text-base leading-relaxed text-body marker:text-ink-4 lg:text-lg">{children}</ul>
}

/**
 * Resolve one of `MARKETPLACE_LINKS` by key — and THROW if the key is gone.
 *
 * ⚠️ THROWING IS THE POINT, AND THE ALTERNATIVES ARE ALL SILENT. `MARKETPLACE_LINKS.find(…)?.href`
 * yields `undefined`, React renders `<a>` with no href, and the page ships with a sentence whose
 * link does nothing — invisible to tsc (an href is a string), invisible to lint, invisible in a
 * screenshot. Falling back to the homepage is worse: the link works, so nobody ever looks at it
 * again, and a page about housing quietly points at a feed.
 *
 * These pages are statically generated, so a missing key fails `next build` — loud, in CI, before
 * anything reaches a crawler. That is the correct blast radius for "an internal link is broken".
 *
 * ⚠️ ON A MARKETPLACE BUILD THIS WOULD THROW FOR EVERY KEY, because next.config.ts aliases
 * cross-site-links to a stub whose list is empty. That is safe only because every consumer is a
 * `page.svc.tsx` that a marketplace build does not compile — so if this component is ever imported
 * from a shared page, it must take the href as data instead.
 */
export function marketplaceHref(key: string): string {
  const found = MARKETPLACE_LINKS.find((l) => l.key === key)
  if (!found) {
    throw new Error(
      `seo-article: no cross-site link with key "${key}". Keys live in src/lib/cross-site-links.ts ` +
        `(available: ${MARKETPLACE_LINKS.map((l) => l.key).join(', ') || 'none — is this a marketplace build?'}).`,
    )
  }
  return found.href
}

/**
 * A CONTEXTUAL LINK TO eno.vn, inside a sentence.
 *
 * ⚠️ DOFOLLOW, and `CROSS_SITE_REL` is what says so — `noopener` and nothing else. The constant in
 * src/lib/cross-site-links.ts carries the argument for why `nofollow`/`sponsored` are banned on
 * these anchors; do not add one here "to be safe", because being safe in that direction forfeits the
 * only thing this link is for.
 *
 * ⚠️ NO `handleExternalClick`, AND THAT IS A DECISION. The promo block attaches it because it is
 * already a client component; attaching it here would make every guide page a client component to
 * add a handler that is a no-op for this destination anyway (eno.vn is in the native shell's
 * allowNavigation list — see the note in cross-site-promo.tsx). A static article stays static.
 *
 * ⚠️ `href` COMES FROM `marketplaceHref()`, NEVER FROM A LITERAL AT THE CALL SITE. Those hrefs are
 * absolute, point at the apex (www 301s), and are checked against the real route tree by
 * cross-site-links.test.ts. A hand-typed URL gets none of that and is invisible to tsc.
 */
export function VnLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} rel={CROSS_SITE_REL} className="font-semibold text-accent-foreground hover:underline">
      {children}
    </a>
  )
}

/** An outbound link to an authority (evisa.gov.vn and friends). Named so it reads differently. */
export function OfficialLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      rel="noopener nofollow"
      className="font-semibold text-accent-foreground hover:underline"
    >
      {children}
    </a>
  )
}

/**
 * An in-site link (another guide on this deployment). A client leaf (here-link.tsx) so it can follow
 * the page's language: a Vietnamese guide links the `/vi` twin, never the English-pinned plain URL.
 */
export { HereLink } from './here-link'

const ldJson = (o: object) => JSON.stringify(o).replace(/</g, '\\u003c')

/**
 * The words of the date line, in the ARTICLE's language (`content.lang`), like the prose it dates — a
 * Vietnamese guide says "Cập nhật 23/9/2026" to every reader. Plain constants, never `tr()`: they
 * follow the article, not the visitor, so they must not reach the translation layer.
 */
const DATE_LINE = {
  en: { updated: 'Updated', published: 'Published', read: (n: number) => `${n} min read`, approved: (site: string) => `Approved by the ${site} team on` },
  vi: { updated: 'Cập nhật', published: 'Đăng ngày', read: (n: number) => `${n} phút đọc`, approved: (site: string) => `Đội ngũ ${site} duyệt ngày` },
} as const

/**
 * The rest of the article's chrome, in the article's language — same rule as DATE_LINE, and for the
 * same reason. `publishedBy` wraps the site name, which is rendered between its two halves.
 */
const ARTICLE_CHROME = {
  en: {
    breadcrumb: 'Breadcrumb',
    onThisPage: 'On this page',
    keepReading: 'Keep reading',
    faq: 'Frequently asked questions',
    affiliation: AFFILIATION.shortEn,
    publishedBy: [
      'Published by ',
      '. Rules, fees and official processes change — where this guide names an authority, check with that authority before you act on anything here.',
    ],
  },
  vi: {
    breadcrumb: 'Đường dẫn',
    onThisPage: 'Trên trang này',
    keepReading: 'Đọc thêm',
    faq: 'Câu hỏi thường gặp',
    affiliation: AFFILIATION.shortVi,
    publishedBy: [
      'Bài viết do ',
      ' xuất bản. Quy định, phí và thủ tục chính thức có thể thay đổi — khi bài viết nhắc tới một cơ quan có thẩm quyền, hãy kiểm tra với chính cơ quan đó trước khi làm theo bất cứ điều gì ở đây.',
    ],
  },
} as const

export async function SeoArticle({ content }: { content: ArticleContent }) {
  const url = `${SITE_ORIGIN}${content.canonical}`
  const articleLang = content.lang ?? 'en'
  const chrome = ARTICLE_CHROME[articleLang]
  // ONE date, two consumers: the visible line under the h1 and the JSON-LD below (C-DATES). The guides
  // declared dateModified to Google and showed a reader no date at all.
  const modified = content.updated ?? content.published
  const revised = !!content.updated && content.updated !== content.published
  // ⚠️ CAPPED HERE, NOT AT EACH CALL SITE. The phone guides passed all sixteen same-language siblings
  // and the block grew with every guide added; seo-article-related.ts picks at most six (the most
  // related first, plus alphabetical neighbours so no sibling is left without an inbound card).
  const related = keepReading(content.related, { canonical: content.canonical, h1: content.h1 })
  const rail = content.rail ?? phoneGuideRail(content.canonical)
  // `railAfter` splits the prose column in two — the sections up to and including the named one, the
  // rail at the page width, then the rest. No rail, no `railAfter` or an unknown id: one column, rail last.
  const railAt = rail && content.railAfter ? content.sections.findIndex((s) => s.id === content.railAfter) : -1
  const leadSections = railAt >= 0 ? content.sections.slice(0, railAt + 1) : content.sections
  const restSections = railAt >= 0 ? content.sections.slice(railAt + 1) : []
  // ArticleText: a declared language the URL does not pin (pinnedVariant answers null for a negotiating path).
  const textLang = content.lang && pinnedVariant(content.canonical) !== content.lang ? content.lang : undefined

  /**
   * ⚠️ THE PUBLISHER IS THIS DEPLOYMENT, DERIVED FROM ITS OWN ORIGIN. It is the same defect the
   * Organization block in src/app/[lang]/layout.tsx was fixed for: a hardcoded publisher would have
   * eno.forum telling Google that eno.vn — the licensed company that may not touch this subject
   * matter — is the entity behind these pages.
   *
   * `author` is a PERSON since 2026-11-26 (owner: "under each blog content write author … for authority"): the byline of the
   * article's language — English Shanazar Babakulyyev (COO), Vietnamese Nguyễn Quốc Lập (Chuyên viên Marketing), src/lib/article-authors.ts — the
   * same name the page prints under the article, working for the site's Organization node. A hub (`byline: false`) keeps the
   * Organization: it is a list, not a piece someone wrote.
   *
   * ⚠️ ON THE MARKETPLACE BOTH CARRY THE LAYOUT'S Organization `@id` (src/lib/site-identity.ts), so the
   * article's publisher IS that node rather than a second, unlinked one. eno.forum's layout declares
   * no @id (the editions must not read as one entity), so there the inline node stays as it was.
   */
  const orgRef = IS_SERVICES ? {} : { '@id': organizationId(SITE_ORIGIN) }
  // ⛔ eno.vn ONLY: the authors are the licensed company's officers, and eno.forum's guides are its visa and itinerary desk — the
  // boundary this file's publisher comment keeps. A hub (`byline: false`) has none either.
  const author = IS_SERVICES || content.byline === false ? null : ARTICLE_AUTHORS[articleLang]
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: content.h1,
    description: content.intro,
    ...(content.image?.length ? { image: content.image.map((path) => (path.startsWith('https://') ? path : `${SITE_ORIGIN}${path}`)) } : {}),
    inLanguage: content.lang ?? 'en',
    datePublished: content.published,
    dateModified: modified,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
      // Only an approval on record (`approved` above): who approved the text and when, as schema.org's WebPage says it.
      ...(content.approved ? { reviewedBy: { '@type': 'Organization', ...orgRef, name: SITE_NAME, url: SITE_ORIGIN }, lastReviewed: content.approved.on } : {}),
    },
    author: author ? authorPersonLd(author, SITE_ORIGIN, SITE_NAME, orgRef) : { '@type': 'Organization', ...orgRef, name: SITE_NAME, url: SITE_ORIGIN },
    publisher: { '@type': 'Organization', ...orgRef, name: SITE_NAME, url: SITE_ORIGIN, logo: `${SITE_ORIGIN}/logo.svg` },
    isAccessibleForFree: true,
    ...(content.citations?.length ? { citation: content.citations.map((c) => ({ '@type': 'CreativeWork', name: c.name, url: c.url })) } : {}),
    ...(content.alternate ? { workTranslation: { '@type': 'Article', inLanguage: content.alternate.lang, url: `${SITE_ORIGIN}${content.alternate.href}` } } : {}),
  }

  const breadcrumbLd = content.breadcrumb?.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: content.breadcrumb.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.label,
          item: `${SITE_ORIGIN}${c.href}`,
        })),
      }
    : null

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: content.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  /** Four sections or more: the phone's "On this page" row and, from lg, the rail beside the article. */
  const hasToc = content.sections.length >= 4
  /**
   * The phone's "On this page" row (lg:hidden: from lg the rail beside the sections does this job). Built once, rendered in one
   * of two places below: straight under the lede when the article has a lede row, else above the first section.
   */
  const phoneToc = hasToc ? (
    <details className="group mt-6 max-w-3xl border-y border-border lg:hidden">
      {/* 2026-11-06 audit: ContentPage's contents row, one treatment for both families — the label in primary
          ink and a 20px chevron that turns on open, a wash on press; the count is for a screen reader only (a bare
          number beside the chevron read as unexplained). The links are ContentPage's 44px rows, not 20px inline
          links a thumb had to hit. */}
      <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2 text-sm font-semibold text-foreground active:bg-muted [&::-webkit-details-marker]:hidden">
        <span>{chrome.onThisPage}<span className="sr-only"> · {content.sections.length}</span></span>
        <ChevronDown className="size-5 shrink-0 text-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <ul className="pb-3">
        {content.sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="-mx-2 block rounded-lg px-2 py-3 text-sm text-body hover:bg-muted hover:text-foreground active:bg-muted">{s.title}</a>
            {s.children?.length ? (
              <ul className="pl-4">
                {s.children.map((c) => (
                  <li key={c.id}><a href={`#${c.id}`} className="-mx-2 block rounded-lg px-2 py-2.5 text-sm text-ink-4 hover:bg-muted hover:text-foreground active:bg-muted">{c.title}</a></li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  ) : null

  return (
    <div className="flex min-h-page flex-col blob-bg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(articleLd) }} />
      {content.faqs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(faqLd) }} />
      )}
      {breadcrumbLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd) }} />}
      {content.jsonLd?.map((node, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(node) }} />
      ))}

      <Header />

      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <ArticleText lang={textLang}>
          {content.breadcrumb && content.breadcrumb.length > 1 && (
            <nav aria-label={chrome.breadcrumb} className="mb-4">
              <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-4">
                {content.breadcrumb.map((c, i, all) => (
                  // 2026-11-06 audit: below sm a trail of three or more keeps its last crumb for a screen reader only, and the chevron
                  // before it goes too. That crumb repeats the h1 printed right under it, and on a phone it wrapped the trail onto two
                  // or three lines on every guide; "Home › Teach in Vietnam" still says where the page sits.
                  <li key={c.href} className={`flex items-center gap-x-1.5${i === all.length - 1 && all.length > 2 ? ' max-sm:sr-only' : ''}`}>
                    {i < all.length - 1 ? (
                      <>
                        <Link href={c.href} prefetch={false} className="hover:text-accent-foreground hover:underline">{c.label}</Link>
                        <ChevronRight className={`size-3.5 text-ink-4${i === all.length - 2 && all.length > 2 ? ' max-sm:hidden' : ''}`} aria-hidden />
                      </>
                    ) : (
                      <span aria-current="page" className="text-body">{c.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <p className="eyebrow text-muted-foreground mb-2">{content.eyebrow}</p>
          <h1 className="h-display max-w-3xl text-foreground">{content.h1}</h1>
          {/* The date, as ContentPage places its "Last updated" line: under the title, before the lede.
              No relative time (ISR HTML would freeze "3 days ago") and no invented "reviewed by": the approval is shown only when one is on
              record (`approved`), and links to how the guides are made. */}
          <p className="mt-3 text-sm text-ink-4" lang={articleLang}>
            {revised ? DATE_LINE[articleLang].updated : DATE_LINE[articleLang].published}{' '}
            <time dateTime={modified}>{formatArticleDate(modified, articleLang)}</time> · {SITE_NAME}
            {content.readingMinutes ? <> · {DATE_LINE[articleLang].read(content.readingMinutes)}</> : null}
            {content.approved ? (
              <>
                {' · '}
                <Link href={content.approved.how} prefetch={false} className="underline underline-offset-2 hover:text-accent-foreground">
                  {DATE_LINE[articleLang].approved(SITE_NAME)} <time dateTime={content.approved.on}>{formatArticleDate(content.approved.on, articleLang)}</time>
                </Link>
              </>
            ) : null}
          </p>
          {/* 2026-11-07 audit: the lede at the body's 60ch measure and, from lg, its 18px. In the 3xl column it ran ~95 characters
              a line on a desktop, longer than any paragraph under it. */}
          <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-body lg:text-lg">{content.intro}</p>
          {/* 2026-11-06 audit: with a lede row (a guide's Key points, the teach hub's facts, a vehicle hub's filters) the phone's
              contents row comes first, straight under the lede. Below a long Key points box it landed a screen or more down,
              behind the summary a reader may want to skip (judges: teach pages, the VinFast and driving-permit guides). With no
              lede row it stays below the CTA and the disclosure, so a hub's one brand button keeps its place under the lede. */}
          {content.ledeRow ? phoneToc : null}

          {/* "On this page". These guides run long by design, and a reader who arrived from a query about one section should reach it; it is also how
              Google finds the jump links it sometimes shows under a result. One row on a phone, where the open list took most of a screen before
              the first section; beside the text on desktop, where the column stood empty.
              2026-11-06 audit: `justify-start`, not `-between`. Between handed the spare width (~230px at 1440) to the gap, so the rail
              floated ~450px from the 60ch prose and ~280px from a vehicle hub's grid; it now sits 48px off the column it indexes.
              2026-11-07 audit: the grid opens right under the lede, so the rail stands beside the Key points (or the CTA), where the
              phone's row sits, not a screen lower beside the first section (judges: the teach pages and the VinFast guide). From xl
              it is 17rem, 64px off the column: fewer entries wrap, and less of a wide screen stands empty. Below lg nothing moves. */}
          <div className={hasToc ? 'lg:grid lg:grid-cols-[minmax(0,48rem)_15rem] lg:justify-start lg:gap-x-12 xl:grid-cols-[minmax(0,48rem)_17rem] xl:gap-x-16' : undefined}>
            <div className="min-w-0">
              {content.ledeRow}
              {content.cta && <ArticleCta cta={content.cta} className="mt-6" />}

              {content.disclosure && (
                // Lines and a tinted panel rather than a shouty callout: this is a statement of who is
                // responsible for what, and it should read as information, not as a warning.
                <aside className="mt-6 flex max-w-3xl items-start gap-3 rounded-xl bg-tint p-4">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
                  <p className="text-sm leading-relaxed text-body">{content.disclosure}</p>
                </aside>
              )}

              {content.ledeRow ? null : phoneToc}
              <ArticleSections sections={leadSections} className="mt-10" />
            </div>
            {hasToc && (
              // Level with the first block beside it: a lede row, the CTA and the disclosure open 24px down, the first section 40px.
              // Scrolls on its own when a guide's question sub-headings make it taller than the screen (lg:max-h…): every entry stays reachable. The
              // 8px padding (and -mx-2 to keep its place) holds the list's own -mx-2 rows inside the scroll box: no clipped wash, no sideways scroll.
              <nav aria-label={chrome.onThisPage} className={`hidden self-start lg:sticky lg:top-24 lg:block lg:-mx-2 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overflow-x-hidden lg:px-2 ${content.ledeRow || content.cta || content.disclosure ? 'lg:mt-6' : 'lg:mt-10'}`}>
                <p className="eyebrow mb-2 text-ink-4">{chrome.onThisPage}</p>
                {/* 2026-11-07 audit: ContentPage's rail rows (px-2, a wash under the pointer), the list pulled out 8px so the labels keep
                    the eyebrow's edge. No current-section mark yet: it needs ContentRail's scroll-spy (client JavaScript on a server
                    page) or CSS scroll-target-group, whose focus rules (focus can follow the current entry while the reader
                    scrolls) are not settled. */}
                <ul className="-mx-2 space-y-0.5">
                  {content.sections.map((s) => (
                    <li key={s.id}>
                      <a href={`#${s.id}`} className="block rounded-lg px-2 py-1.5 text-sm font-medium text-body transition-colors hover:bg-muted hover:text-foreground active:bg-muted">{s.title}</a>
                      {s.children?.length ? (
                        <ul className="space-y-0.5 pl-3">
                          {s.children.map((c) => (
                            <li key={c.id}><a href={`#${c.id}`} className="block rounded-lg px-2 py-1 text-sm text-ink-4 transition-colors hover:bg-muted hover:text-foreground active:bg-muted">{c.title}</a></li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
        </ArticleText>

        {/* Full width, not the 3xl prose column: in 768px the grid's four cards were ~180px and every
            price broke onto two lines, against the owner's one-line card price (2026-09-13). At the
            page width the cards are the SEO landing pages' own size. */}
        {/* A phone guide gets the second-hand phones rail by default (phone-guides-rail.ts, 2026-10-03).
            With `railAfter` it sits right after that section and the rest of the prose follows it.
            Outside ArticleText, like CrossSitePromo: its prices are in the visitor's language; its heading and
            browse link are the article's words and carry textLang. */}
        {rail && <SeoListingRail {...rail} lang={textLang} className="mt-14" heading="h-title" />}

        <ArticleText lang={textLang}>
          {restSections.length > 0 && <ArticleSections sections={restSections} className="mt-14" />}

          {content.afterSections}

          {content.cta?.repeatAtEnd && <ArticleCta cta={content.cta} className="mt-10" />}

          {/* The byline, under the article (owner, 2026-11-26): the author of the ARTICLE's language, with the photo from eno's
              partner page. The same Person is the Article's JSON-LD author above. A hub passes `byline: false`. */}
          {author && (
            <section aria-label={author.label} className="mt-14 flex max-w-3xl items-center gap-4 border-t border-border pt-6">
              <Avatar name={author.name} url={author.image} alt={author.name} size="lg" />
              <div className="min-w-0">
                <p className="text-xs text-ink-4">{author.label}</p>
                <p className="text-base font-bold text-foreground">{author.name}</p>
                <p className="text-sm text-body">{`${author.jobTitle}, ${SITE_NAME}`}</p>
              </div>
            </section>
          )}

          {related.length > 0 && (
            <section className="mt-14 max-w-3xl">
              <h2 className="h-title mb-4 text-foreground">{chrome.keepReading}</h2>
              {/* Ruled rows, not a grid of bordered cards (flat-surface canon §3b; C-BOXES): one column,
                  so every chevron sits on the same right edge and each title gets the full measure. */}
              <Rows bordered>
                {related.map((r) => (
                  <Row key={r.href} className="py-0">
                    {/* ⛔ THE LINK IS THE TITLE, STRETCHED OVER THE ROW (category-text.tsx's guide rows, the same reason): the whole
                        row as one <a> made its anchor text the title AND the blurb — over 120 characters on 98 guides (Seobility
                        crawl 3, "anchor text too long"). The row still takes the click, the hover and the focus ring. */}
                    <div className="group relative grid grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 py-4">
                      <span className="min-w-0">
                        <span className="block text-base font-bold text-foreground group-hover:text-accent-foreground lg:text-lg">
                          <Link href={r.href} className="outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring">{r.label}</Link>
                        </span>
                        <span className="mt-1 block line-clamp-2 text-sm leading-relaxed text-body lg:text-base">{r.blurb}</span>
                      </span>
                      <ChevronRight className="size-4 text-ink-4 group-hover:text-accent-foreground" aria-hidden />
                    </div>
                  </Row>
                ))}
              </Rows>
            </section>
          )}

          {content.faqs.length > 0 && (
            <section className="mt-14 max-w-3xl">
              <h2 className="h-title mb-4 text-foreground">{chrome.faq}</h2>
              <div className="space-y-6">
                {content.faqs.map((f, i) => (
                  <div key={i}>
                    {/* ⛔ A HEADING TO A SCREEN READER, NOT AN <h3> (Seobility crawl 3, 2026-11-24: 23 guides repeat a section's
                        <h2> as an FAQ question, "duplicate headings", and 75 carry "too many headings"). The FAQ restates the
                        article by design, so the questions keep role="heading" — the footer's pattern — and drop the tag a
                        crawler counts. Preflight styles <p> and <h3> alike, so nothing moves. */}
                    <p role="heading" aria-level={3} className="text-base font-bold text-foreground lg:text-lg">{f.q}</p>
                    <p className="mt-1 max-w-[60ch] text-base leading-relaxed text-body lg:text-lg">{f.a}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </ArticleText>

        {content.crossSitePromo && <CrossSitePromo />}

        <ArticleText lang={textLang}>
          {/* ⚠️ THE AFFILIATION LINE IS NOT OPTIONAL ON A PAGE THAT LINKS TO THE SISTER SITE, and every
              page rendered by this component does. A recommendation between two sites in one brand
              family is only honest if the reader is told they are in one brand family — and the
              constant may never be reworded to say the sites are unrelated, which they are not. When
              CrossSitePromo is rendered it already carries this line; showing it twice is worse than
              showing it once, hence the guard.
              2026-11-07 audit: one colophon under one hairline — who published the page and its caveat, then the family line —
              not two blocks 32px apart, which gave the fine print the weight of a section of its own (judges: the guides hub). The
              words of both lines are unchanged. */}
          <div className="mt-14 max-w-3xl space-y-2 border-t border-border pt-6 text-sm leading-relaxed text-muted-foreground">
            <p>
              <ArrowUpRight className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
              {chrome.publishedBy[0]}<strong className="font-semibold text-foreground">{SITE_NAME}</strong>{chrome.publishedBy[1]}
            </p>
            {!content.crossSitePromo && <p className="text-xs leading-relaxed">{chrome.affiliation}</p>}
          </div>
          {content.alternate?.lang === 'vi' && <ViPairLink href={content.alternate.href} name={content.alternate.name} />}
        </ArticleText>
      </main>

      <Footer />
    </div>
  )
}

/**
 * "Tiếng Việt" at the end of an English article that has a Vietnamese pair (owner, 2026-11-25, "1 ok": hub links for the pages
 * Seobility's crawl 6 found 4–5 clicks deep). The pair was named by hreflang alone, which a crawler does not walk: the 18
 * Vietnamese phone guides were reached only through each other. The look and the phone rule are vi-twin-link.tsx's (the
 * owner's 2026-11-24 "Add the link"); a PLAIN link, not LangPilotLink — that one switches the UI language and, on a page
 * that is not a pilot, stays on this URL, while the pair is another article at its own address.
 * The pair's own title follows for screen readers and crawlers: "Tiếng Việt" alone would be one anchor for 19 targets.
 */
function ViPairLink({ href, name: given }: { href: string; name?: string }) {
  const slug = href.replace(/^\//, '')
  const name = given ?? [...PHONE_GUIDES, ...EXPAT_GUIDES, ...MARKETPLACE_GUIDES].find((g) => g.slug === slug)?.label
  return (
    <div className="max-sm:sr-only max-sm:focus-within:not-sr-only">
      <div className="mt-8 flex justify-end">
        <Link href={href} hrefLang="vi-VN" lang="vi" className="relative tap-44 text-xs font-semibold text-accent-foreground hover:underline">
          {LANGUAGES.find((l) => l.code === 'vi')!.native}
          {name ? <span className="sr-only">: {name}</span> : null}
        </Link>
      </div>
    </div>
  )
}
