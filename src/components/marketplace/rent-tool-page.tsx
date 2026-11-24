import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Bilingual } from '@/components/marketplace/bilingual'
import { SITE_NAME } from '@/lib/edition'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { langAlternatesFor } from '@/lib/lang-alternates'
import { localizedHref } from '@/lib/lang-pinned'
import { titleWithSite } from '@/lib/meta-description'
import { RENT_TOOLS, RENT_TOOL_SLUGS, rentToolPath, type RentToolSlug } from '@/lib/rent-tools/registry'
import { pageShare } from '@/lib/site-identity'
import { ViTwinLink } from '@/components/marketplace/vi-twin-link'

/**
 * The page around each rent tool (src/lib/rent-tools/registry.ts): the answer first, the calculator, how it works with the
 * exact formula, a worked example the server prints (so the page answers without JavaScript), the FAQ with its FAQPage
 * node, and the other tools. Server-rendered in English and Vietnamese; every line is authored in both and rendered
 * through <Bilingual>, so the nine machine-translated languages translate the English like any other page.
 * ⚠️ THE FAQPage NODE IS BUILT FROM THE SAME ENTRIES THE PAGE PRINTS (`faqPageJsonLd` / `copyIn`), in the page's language —
 * Google penalises structured data that does not match the visible page, and rent-tools-pages.test.tsx reads both back
 * from the render.
 * ⚠️ BOTH HALVES OF A PAIR MUST NAME THE SAME `{placeholders}`: fillTemplate falls back to the English template when they
 * differ, so a Vietnamese line missing one prints English on /vi (the same test parses every pair in these files).
 */
export type Copy = { en: string; vi: string }
export type Values = Record<string, string>
export type FaqEntry = { q: Copy; a: Copy; values?: Values }

/** A line of copy in the page's language, `{placeholders}` filled — the string <T> prints for en and vi. */
export function copyIn(c: Copy, lang: string, values: Values = {}): string {
  return fillTemplate(lang === 'vi' ? c.vi : c.en, c.en, values)
}

/** A line of copy: the authored Vietnamese for `vi`, the English (machine-translated client-side) for the rest. */
export function T({ c, values }: { c: Copy; values?: Values }) {
  return <Bilingual en={c.en} vi={c.vi} values={values} />
}

/** Title, description, canonical and the reciprocal `/vi` alternates, one language per variant. */
export function rentToolMetadata(slug: RentToolSlug, lang: string, meta: { title: Copy; description: Copy }): Metadata {
  return toolPageMetadata(`/${slug}`, lang, meta)
}

/** The same for any tool page by its plain path: the generated tools (/tools/<slug>) and their hub (/tools). */
export function toolPageMetadata(path: string, lang: string, meta: { title: Copy; description: Copy }): Metadata {
  const title = titleWithSite(copyIn(meta.title, lang), SITE_NAME)
  const description = copyIn(meta.description, lang)
  const metadata: Metadata = { title, description, alternates: { canonical: path } }
  const twin = langAlternatesFor(path, lang, metadata.robots)
  return {
    ...metadata,
    ...(twin ? { alternates: twin } : {}),
    ...pageShare({ title, description, url: twin?.canonical ?? path }),
  }
}

export function faqPageJsonLd(faqs: readonly FaqEntry[], lang: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: copyIn(f.q, lang, f.values),
      acceptedAnswer: { '@type': 'Answer', text: copyIn(f.a, lang, f.values) },
    })),
  }
}

export function ToolSection({ id, title, children }: { id: string; title: Copy; children: React.ReactNode }) {
  return (
    <section className="mt-12 max-w-3xl" aria-labelledby={id}>
      <h2 id={id} className="h-section text-foreground mb-4"><T c={title} /></h2>
      {children}
    </section>
  )
}

/** A paragraph of the "How it works" / example prose. */
export function P({ c, values }: { c: Copy; values?: Values }) {
  return <p className="mt-3 max-w-prose text-base leading-relaxed text-body first:mt-0"><T c={c} values={values} /></p>
}

/** The exact formula, one line per step, set apart as a tint well (no coloured edge). */
export function Formula({ lines }: { lines: { c: Copy; values?: Values }[] }) {
  return (
    <div className="rounded-2xl bg-tint px-4 py-3 text-base leading-relaxed text-foreground">
      {lines.map((l, i) => <p key={i} className="font-semibold"><T c={l.c} values={l.values} /></p>)}
    </div>
  )
}

/** Each input and what it means. */
export function Inputs({ items }: { items: { term: Copy; def: Copy }[] }) {
  return (
    <dl className="mt-4 grid gap-3">
      {items.map((it, i) => (
        <div key={i}>
          <dt className="text-sm font-bold text-foreground"><T c={it.term} /></dt>
          <dd className="mt-0.5 text-base leading-relaxed text-body"><T c={it.def} /></dd>
        </div>
      ))}
    </dl>
  )
}

export function Limits({ items }: { items: Copy[] }) {
  return (
    <ul className="mt-4 list-disc space-y-1 pl-5 text-base leading-relaxed text-body">
      {items.map((c, i) => <li key={i}><T c={c} /></li>)}
    </ul>
  )
}

/** The worked example's figures: a label and a value per row, the result rows in bold. */
export function ExampleRows({ rows }: { rows: { label: Copy; values?: Values; value: string; strong?: boolean }[] }) {
  return (
    <dl className="mt-4 divide-y divide-border border-y border-border">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className={r.strong ? 'text-base font-bold text-foreground' : 'text-base text-body'}><T c={r.label} values={r.values} /></dt>
          <dd className={r.strong ? 'shrink-0 text-base font-bold text-foreground' : 'shrink-0 text-base text-foreground'}>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const LINKS = {
  rentIndex: { href: '/hcmc-rent-index', label: { en: 'HCMC rent index: median asking rent by district', vi: 'Chỉ số giá thuê nhà TP.HCM: giá thuê trung vị theo quận' } },
  rentals: { href: '/c/rentals', label: { en: 'Homes for rent on eno.vn', vi: 'Nhà cho thuê trên eno.vn' } },
} as const

const TEXT = {
  runs: { en: 'The calculator runs in your browser and needs JavaScript. Nothing you type is stored or sent.', vi: 'Công cụ chạy ngay trên trình duyệt và cần bật JavaScript. Những gì bạn nhập không được lưu hay gửi đi đâu.' },
  how: { en: 'How it works', vi: 'Cách tính' },
  example: { en: 'Worked example', vi: 'Ví dụ cụ thể' },
  faq: { en: 'Frequently asked questions', vi: 'Câu hỏi thường gặp' },
  more: { en: 'More tools and data', vi: 'Công cụ và dữ liệu khác' },
}

export function RentToolPage({
  slug, lang, related, ...page
}: Omit<ToolPageProps, 'more'> & {
  slug: RentToolSlug
  /** Which of the site's pages fit this tool, after the other tools. */
  related: readonly (keyof typeof LINKS)[]
}) {
  const more: MoreLink[] = [
    ...RENT_TOOL_SLUGS.filter((s) => s !== slug).map((s) => ({ href: rentToolPath(s, lang), label: RENT_TOOLS[s].label, blurb: RENT_TOOLS[s].blurb })),
    ...related.map((k) => ({ href: localizedHref(LINKS[k].href, lang), label: LINKS[k].label })),
  ]
  return <ToolPageShell lang={lang} path={`/${slug}`} {...page} more={more} />
}

/** A link under "More tools and data": the page's own address for it, its name, and a line on what it does (optional). */
export type MoreLink = { href: string; label: Copy; blurb?: Copy }

type ToolPageProps = {
  lang: string
  /** The page's plain path, for its "Tiếng Việt" link (vi-twin-link.tsx); none, no link. */
  path?: string
  h1: Copy
  /** The answer, first: what the tool tells you and the one formula behind it. */
  intro: Copy
  introValues?: Values
  calculator: React.ReactNode
  how: React.ReactNode
  example: React.ReactNode
  faqs: readonly FaqEntry[]
  more: readonly MoreLink[]
}

/**
 * The page itself, for the rent tools above and the generated tools (src/app/[lang]/tools/[slug]): one layout, so a tool Reach
 * writes reads like the four written by hand.
 */
export function ToolPageShell({ lang, path, h1, intro, introValues, calculator, how, example, faqs, more }: ToolPageProps) {
  const node = faqPageJsonLd(faqs, lang)
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }} />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <h1 className="h-display text-pretty text-foreground"><T c={h1} /></h1>
        <p className="mt-4 max-w-prose text-base leading-relaxed text-body"><T c={intro} values={introValues} /></p>

        <div className="mt-8 max-w-3xl">
          {calculator}
          <p className="mt-3 text-t-meta text-muted-foreground"><T c={TEXT.runs} /></p>
        </div>

        <ToolSection id="how" title={TEXT.how}>{how}</ToolSection>
        <ToolSection id="example" title={TEXT.example}>{example}</ToolSection>

        <section className="mt-12" aria-labelledby="faq">
          <h2 id="faq" className="h-section text-foreground mb-4"><T c={TEXT.faq} /></h2>
          <div className="grid grid-cols-1 gap-x-14 gap-y-5 lg:grid-cols-2">
            {faqs.map((f, i) => (
              <div key={i}>
                <h3 className="text-base font-bold text-foreground"><T c={f.q} values={f.values} /></h3>
                <p className="mt-1 text-base leading-relaxed text-body"><T c={f.a} values={f.values} /></p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 max-w-3xl" aria-labelledby="more">
          <h2 id="more" className="h-section text-foreground mb-2"><T c={TEXT.more} /></h2>
          <ul className="divide-y divide-border">
            {more.map((m) => (
              <li key={m.href} className="py-3">
                <Link href={m.href} className="font-semibold text-accent-foreground hover:underline"><T c={m.label} /></Link>
                {m.blurb && <p className="mt-0.5 text-sm text-body"><T c={m.blurb} /></p>}
              </li>
            ))}
          </ul>
        </section>
        {path && <ViTwinLink path={path} lang={lang} />}
      </main>
      <Footer />
    </div>
  )
}
