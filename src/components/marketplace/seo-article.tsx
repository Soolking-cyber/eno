import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Info } from '@/components/ui/icons'
import { SITE_NAME } from '@/lib/edition'
import { AFFILIATION } from '@/lib/site-legal'
import { CROSS_SITE_REL, MARKETPLACE_LINKS } from '@/lib/cross-site-links'
import { Header } from './header'
import { Footer } from './footer'
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
 * ⚠️ ENGLISH ONLY, matching the SEO landing pages (see the note on SeoLanding). These target English
 * expat search queries; the machine-translation layer covers a reader who needs another language.
 * The one exception is the affiliation line, which is legal copy and comes from site-legal.ts.
 */

/**
 * ⚠️ THE FALLBACK IS A LAST RESORT, NOT A DEFAULT — same reasoning as src/app/layout.tsx.
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
}

export type ArticleContent = {
  eyebrow: string
  h1: string
  /** One paragraph, plain text — also the `description` on the Article JSON-LD. */
  intro: string
  /** Path only, e.g. `/moving-to-vietnam`. Used for `mainEntityOfPage`. */
  canonical: string
  /** ISO date (YYYY-MM-DD). */
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
  sections: ArticleSection[]
  related?: { href: string; label: string; blurb: string }[]
  faqs: { q: string; a: string }[]
  /**
   * Additional JSON-LD nodes, emitted verbatim beside the Article and FAQPage blocks.
   *
   * The e-visa pages use this for a `Service` node whose `provider` is the licensed partner and
   * whose `broker` is this site — see src/app/vietnam-evisa/service-jsonld.ts.
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
}

/** Body paragraph. */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-base leading-relaxed text-body first:mt-0">{children}</p>
}

/** Body list. Markers are inside the content box so a wrapped line aligns under the text. */
export function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-body marker:text-ink-4">{children}</ul>
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

/** An in-site link (another guide on this deployment). */
export function HereLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-accent-foreground hover:underline">
      {children}
    </Link>
  )
}

const ldJson = (o: object) => JSON.stringify(o).replace(/</g, '\\u003c')

export function SeoArticle({ content }: { content: ArticleContent }) {
  const url = `${SITE_ORIGIN}${content.canonical}`

  /**
   * ⚠️ THE PUBLISHER IS THIS DEPLOYMENT, DERIVED FROM ITS OWN ORIGIN. It is the same defect the
   * Organization block in src/app/layout.tsx was fixed for: a hardcoded publisher would have
   * eno.forum telling Google that eno.vn — the licensed company that may not touch this subject
   * matter — is the entity behind these pages.
   *
   * `author` is the same organisation on purpose: these are house guides, not bylined pieces, and
   * inventing a human author would be a fabrication in structured data.
   */
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: content.h1,
    description: content.intro,
    inLanguage: 'en',
    datePublished: content.published,
    dateModified: content.updated ?? content.published,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_ORIGIN },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_ORIGIN, logo: `${SITE_ORIGIN}/logo.svg` },
    isAccessibleForFree: true,
  }

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: content.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(articleLd) }} />
      {content.faqs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(faqLd) }} />
      )}
      {content.jsonLd?.map((node, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(node) }} />
      ))}

      <Header />

      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <p className="eyebrow text-accent-foreground mb-2">{content.eyebrow}</p>
        <h1 className="h-display max-w-3xl text-foreground">{content.h1}</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-body">{content.intro}</p>

        {content.disclosure && (
          // Lines and a tinted panel rather than a shouty callout: this is a statement of who is
          // responsible for what, and it should read as information, not as a warning.
          <aside className="mt-6 flex max-w-3xl items-start gap-3 rounded-xl bg-tint p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
            <p className="text-sm leading-relaxed text-body">{content.disclosure}</p>
          </aside>
        )}

        {/* "On this page" — a plain anchor list. These guides run long by design and a reader who
            arrived from a query about one of the sections should be able to reach it. It is also
            how Google finds the jump links it sometimes shows under a result. */}
        {content.sections.length >= 4 && (
          <nav aria-label="On this page" className="mt-8 max-w-3xl border-t border-border pt-5">
            <p className="eyebrow mb-3 text-ink-4">On this page</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {content.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-sm font-semibold text-body hover:text-accent-foreground hover:underline">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="mt-10 max-w-3xl space-y-10">
          {content.sections.map((s) => (
            // `scroll-mt` so the sticky header does not sit on top of the heading after a jump.
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="h-section mb-2 text-foreground">{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>

        {content.related && content.related.length > 0 && (
          <section className="mt-14 max-w-3xl">
            <h2 className="h-section mb-4 text-foreground">Keep reading</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {content.related.map((r) => (
                <li key={r.href}>
                  <Link href={r.href} className="group flex flex-col rounded-xl border border-border p-4 hover:border-accent-foreground/40">
                    <span className="flex items-center gap-1 text-sm font-semibold text-foreground group-hover:text-accent-foreground">
                      {r.label} <ArrowRight className="h-4 w-4 shrink-0" />
                    </span>
                    <span className="mt-1 text-sm leading-relaxed text-body">{r.blurb}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {content.faqs.length > 0 && (
          <section className="mt-14 max-w-3xl">
            <h2 className="h-section mb-4 text-foreground">Frequently asked questions</h2>
            <div className="space-y-5">
              {content.faqs.map((f, i) => (
                <div key={i}>
                  <h3 className="text-sm font-bold text-foreground">{f.q}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-body">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {content.crossSitePromo && <CrossSitePromo />}

        {/* ⚠️ THE AFFILIATION LINE IS NOT OPTIONAL ON A PAGE THAT LINKS TO THE SISTER SITE, and every
            page rendered by this component does. A recommendation between two sites in one brand
            family is only honest if the reader is told they are in one brand family — and the
            constant may never be reworded to say the sites are unrelated, which they are not. When
            CrossSitePromo is rendered it already carries this line; showing it twice is worse than
            showing it once, hence the guard. */}
        {!content.crossSitePromo && (
          <p className="mt-14 max-w-3xl border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
            {AFFILIATION.shortEn}
          </p>
        )}

        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          <ArrowUpRight className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
          Published by <strong className="font-semibold text-foreground">{SITE_NAME}</strong>. Rules, fees and
          official processes change — where this guide names an authority, that authority is the one to
          check before you act on anything here.
        </p>
      </main>

      <Footer />
    </div>
  )
}
