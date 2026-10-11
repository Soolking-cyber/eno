import { AlertTriangle, Info, ListChecks } from '@/components/ui/icons'
import { HereLink, OfficialLink, P, Ul, type ArticleSection } from './seo-article'
import { parseInline, type InlineToken } from '@/lib/teach-guides/inline'
import type { TeachBlock, TeachGuide } from '@/lib/teach-guides/schema'
import { formatArticleDate } from '@/lib/dates'

/**
 * THE RENDERER FOR A TEACH GUIDE'S DATA (src/lib/teach-guides/schema.ts) — server-only, no state.
 *
 * It produces exactly what SeoArticle already takes (`ArticleSection[]` + a `ledeRow`), so the guides
 * inherit the house article: the date line, "On this page", Keep reading, the FAQ block and the Article/
 * FAQPage JSON-LD. Nothing here decides SEO; it only turns blocks into the house prose primitives.
 *
 * ⚠️ EVERY WORD OF CHROME HERE IS ENGLISH ON PURPOSE — the guides are English articles, and seo-article.tsx
 * explains why an article's chrome follows the ARTICLE's language and never the visitor's (`tr()` would
 * follow the visitor). Same rule, same reason: plain constants.
 *
 * ⚠️ A LINK TO A GUIDE THAT IS NOT LIVE YET RENDERS AS ITS TEXT. The library is released in waves
 * (registry.ts `published`), so a live guide may mention one that is scheduled; `isLiveHref` decides,
 * and the sentence reads the same either way. The page re-renders hourly (ISR), so the link appears
 * on its own the hour its target goes live.
 */

/**
 * *.eno.vn absolute links (teacher.eno.vn) are our own family: followed, like VnLink, never nofollow. eno.vn
 * itself never arrives here — inline.ts rejects https://eno.vn/… so every site link is a path that goes
 * through `isLiveHref`.
 */
const OWN_HOST = /^https:\/\/([a-z0-9-]+\.)*eno\.vn(\/|$)/i

function Inline({ src, isLiveHref }: { src: string; isLiveHref: (href: string) => boolean }) {
  return <>{renderTokens(parseInline(src), isLiveHref)}</>
}

function renderTokens(tokens: InlineToken[], isLiveHref: (href: string) => boolean): React.ReactNode[] {
  return tokens.map((t, i) => {
    if (t.t === 'text') return t.v
    // Money never breaks across a line: "25,000,000 đ" split after the comma reads as two numbers.
    if (t.t === 'money') return <span key={i} className="whitespace-nowrap">{t.text}</span>
    if (t.t === 'bold') return <strong key={i} className="font-semibold text-foreground">{renderTokens(t.children, isLiveHref)}</strong>
    if (!t.external) return isLiveHref(t.href) ? <HereLink key={i} href={t.href}>{t.label}</HereLink> : t.label
    if (OWN_HOST.test(t.href))
      return (
        <a key={i} href={t.href} rel="noopener" className="font-semibold text-accent-foreground hover:underline">
          {t.label}
        </a>
      )
    return <OfficialLink key={i} href={t.href}>{t.label}</OfficialLink>
  })
}

/** Said to a screen reader before a callout: the icon is the only other difference between the tones. */
const TONE_LABEL = { note: 'Note', warning: 'Warning', tip: 'Tip' } as const

function Block({ b, isLiveHref }: { b: TeachBlock; isLiveHref: (href: string) => boolean }) {
  switch (b.type) {
    case 'p':
      return <P><Inline src={b.text} isLiveHref={isLiveHref} /></P>
    case 'h3':
      return <h3 className="mt-7 max-w-[60ch] text-base font-bold text-foreground">{b.text}</h3>
    case 'ul':
      return (
        <Ul>
          {b.items.map((it, i) => <li key={i}><Inline src={it} isLiveHref={isLiveHref} /></li>)}
        </Ul>
      )
    case 'ol':
      return (
        <ol className="mt-3 max-w-[60ch] list-decimal space-y-2 pl-5 text-base leading-relaxed text-body marker:font-semibold marker:text-ink-4">
          {b.items.map((it, i) => <li key={i}><Inline src={it} isLiveHref={isLiveHref} /></li>)}
        </ol>
      )
    case 'table':
      return <GuideTable b={b} isLiveHref={isLiveHref} />
    case 'callout': {
      const Icon = b.tone === 'warning' ? AlertTriangle : Info
      return (
        // The disclosure panel's treatment (seo-article.tsx): information, not alarm — even the warning
        // tone only changes the glyph, so a page of callouts never reads as a page of red boxes.
        <aside className="mt-5 flex max-w-[60ch] items-start gap-3 rounded-xl bg-tint p-4">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
          <div className="min-w-0 text-sm leading-relaxed text-body">
            <span className="sr-only">{TONE_LABEL[b.tone]}: </span>
            {b.title && <p className="font-bold text-foreground">{b.title}</p>}
            <p className={b.title ? 'mt-1' : undefined}><Inline src={b.text} isLiveHref={isLiveHref} /></p>
          </div>
        </aside>
      )
    }
    case 'steps':
      return (
        // /guide's "do this, then this" treatment: a tint number chip per step.
        <ol className="mt-4 max-w-[60ch] space-y-5">
          {b.items.map((s, i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-accent-foreground tabular-nums">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-base font-bold text-foreground">{s.title}</p>
                <p className="mt-1 text-base leading-relaxed text-body"><Inline src={s.text} isLiveHref={isLiveHref} /></p>
              </div>
            </li>
          ))}
        </ol>
      )
  }
}

/**
 * ⚠️ ONE TABLE AT EVERY WIDTH, RESTYLED BELOW md — the Rent Index's solution (rent-index-sections.tsx,
 * C-RENT-INDEX), not a sideways scroller: below md each row becomes a block and every cell carries its
 * column's name, so a phone never scrolls a table inside the page. The <table> stays one table, which is
 * what a crawler and an answer engine read.
 */
function GuideTable({ b, isLiveHref }: { b: Extract<TeachBlock, { type: 'table' }>; isLiveHref: (href: string) => boolean }) {
  return (
    <figure className="mt-5 max-w-3xl">
      <table className="w-full text-sm max-md:block">
        <thead className="max-md:sr-only">
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            {b.headers.map((h, i) => (
              <th key={i} scope="col" className="pb-2 pr-4 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="max-md:block">
          {b.rows.map((row, r) => (
            <tr key={r} className="border-t border-border max-md:block max-md:py-3">
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row" className="text-left align-top font-semibold text-foreground max-md:block md:py-2 md:pr-4">
                    <Inline src={cell} isLiveHref={isLiveHref} />
                  </th>
                ) : (
                  <td key={c} className="align-top text-body max-md:mt-1 max-md:block md:py-2 md:pr-4">
                    <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:hidden">{b.headers[c]}:</span>
                    <Inline src={cell} isLiveHref={isLiveHref} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">
        <Inline src={b.caption} isLiveHref={isLiveHref} />
      </figcaption>
    </figure>
  )
}

/** The guide's sections in SeoArticle's shape, plus the closing "Sources" section. */
export function teachGuideSections(g: TeachGuide, isLiveHref: (href: string) => boolean): ArticleSection[] {
  const sections: ArticleSection[] = g.sections.map((s) => ({
    id: s.id,
    title: s.title,
    body: (
      <>
        {s.blocks.map((b, i) => <Block key={i} b={b} isLiveHref={isLiveHref} />)}
      </>
    ),
  }))
  sections.push({
    id: 'sources',
    title: 'Sources',
    body: (
      <>
        <P>
          Facts in this guide were last checked on{' '}
          <time dateTime={g.lastChecked}>{formatArticleDate(g.lastChecked, 'en')}</time> against the sources below.
          Rules, fees and processes in Vietnam change; where a source is an authority, its current page wins over
          this one.
        </P>
        <Ul>
          {g.sources.map((s) => (
            <li key={s.url}>
              {/* eno.vn's own data pages (the Rent Index, the school directory) are followed, never nofollow. */}
              {OWN_HOST.test(s.url) ? (
                <a href={s.url} rel="noopener" className="font-semibold text-accent-foreground hover:underline">{s.title}</a>
              ) : (
                <OfficialLink href={s.url}>{s.title}</OfficialLink>
              )}
              <span className="text-ink-4"> — {s.publisher}</span>
            </li>
          ))}
        </Ul>
      </>
    ),
  })
  return sections
}

const KEY_POINTS_ID = 'key-points'

/** The "Key points" box under the lede (SeoArticle `ledeRow`): the page's answer before the long read. */
export function TeachKeyPoints({ g, isLiveHref }: { g: TeachGuide; isLiveHref: (href: string) => boolean }) {
  return (
    <section aria-labelledby={KEY_POINTS_ID} className="mt-6 max-w-3xl rounded-xl bg-tint p-5">
      <h2 id={KEY_POINTS_ID} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-accent-foreground">
        <ListChecks className="h-4 w-4" aria-hidden /> Key points
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-body marker:text-ink-4">
        {g.keyPoints.map((k, i) => <li key={i}><Inline src={k} isLiveHref={isLiveHref} /></li>)}
      </ul>
    </section>
  )
}

/**
 * The "next step" aside after a guide's last section (SeoArticle `afterSections`) — what eno.vn itself offers a
 * teacher, stated only as far as it is true (CLAUDE.md claims rules; src/lib/teachers/*): the profile is free,
 * schools message you there and your phone, email and CV stay hidden until you choose to share them; the
 * school pages carry reviews written by teachers; jobs link to the original posting, where you apply.
 * ⛔ No "we find you a job", no "verified schools", no "parents book you" — none of it is true.
 */
/** English chrome, as a constant (the guides' chrome follows the article, never `tr()` — see the file header). */
const NEXT_STEP = 'Your next step on eno.vn'

export function TeachNextStep() {
  const items: { href: string; title: string; text: string; own?: boolean }[] = [
    {
      href: 'https://teacher.eno.vn',
      own: true,
      title: 'Make a free teacher profile',
      text: 'Schools in Ho Chi Minh City can find and message you; your phone, email and CV stay hidden until you choose to share them.',
    },
    // Most school pages have no review yet, so this promises the directory, not a body of reviews.
    { href: '/schools', title: 'Look up a school before you sign', text: 'Language centres, schools and universities in Ho Chi Minh City, with teachers’ reviews where they have been written and open jobs.' },
    { href: '/c/jobs', title: 'Browse teaching jobs', text: 'Current postings, each linked to the original advert where you apply. Never pay to get a job.' },
    { href: '/hcmc-rent-index', title: 'Check what rent costs by district', text: 'Median asking rents from thousands of live listings, updated daily.' },
  ]
  return (
    <aside aria-label={NEXT_STEP} className="mt-14 max-w-3xl border-t border-border pt-8">
      <h2 className="h-title mb-4 text-foreground">{NEXT_STEP}</h2>
      <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.href} className="min-w-0">
            {it.own ? (
              <a href={it.href} rel="noopener" className="text-base font-bold text-foreground hover:text-accent-foreground hover:underline">{it.title}</a>
            ) : (
              <HereLink href={it.href}>{it.title}</HereLink>
            )}
            <p className="mt-1 text-sm leading-relaxed text-body">{it.text}</p>
          </li>
        ))}
      </ul>
    </aside>
  )
}
