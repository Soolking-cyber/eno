import { AlertTriangle, Info, ListChecks } from '@/components/ui/icons'
import { HereLink, OfficialLink, P, Ul, type ArticleSection } from './seo-article'
import { parseInline, TEACHER_APP_ORIGIN, type InlineToken } from '@/lib/teach-guides/inline'
import type { TeachBlock, TeachGuide } from '@/lib/teach-guides/schema'
import { formatArticleDate } from '@/lib/dates'

/**
 * THE RENDERER FOR A TEACH GUIDE'S DATA (src/lib/teach-guides/schema.ts) — server-only, no state.
 *
 * It produces exactly what SeoArticle already takes (`ArticleSection[]` + a `ledeRow`), so the guides
 * inherit the house article: the date line, "On this page", Keep reading, the FAQ block and the Article/
 * FAQPage JSON-LD. Nothing here decides SEO; it only turns blocks into the house prose primitives.
 *
 * ⚠️ THE CHROME HERE FOLLOWS THE ARTICLE'S LANGUAGE, NEVER THE VISITOR'S: English for the teach guides, and the `lang` a
 * guide in src/lib/guides declares. seo-article.tsx explains why (`tr()` would follow the visitor). Same rule, same
 * reason: plain constants.
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

function Inline({ src, isLiveHref, lang = 'en' }: { src: string; isLiveHref: (href: string) => boolean; lang?: 'en' | 'vi' }) {
  return <>{renderTokens(parseInline(src, lang), isLiveHref, lang)}</>
}

function renderTokens(tokens: InlineToken[], isLiveHref: (href: string) => boolean, lang: 'en' | 'vi' = 'en'): React.ReactNode[] {
  return tokens.map((t, i) => {
    if (t.t === 'text') return t.v
    // Money never breaks across a line: "25,000,000 đ" split after the comma reads as two numbers.
    if (t.t === 'money') return <span key={i} className="whitespace-nowrap">{t.text}</span>
    if (t.t === 'bold') return <strong key={i} className="font-semibold text-foreground">{renderTokens(t.children, isLiveHref, lang)}</strong>
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
const TONE_LABEL_VI = { note: 'Ghi chú', warning: 'Cảnh báo', tip: 'Mẹo' } as const

function Block({ b, isLiveHref, lang = 'en' }: { b: TeachBlock; isLiveHref: (href: string) => boolean; lang?: 'en' | 'vi' }) {
  switch (b.type) {
    case 'p':
      return <P><Inline src={b.text} isLiveHref={isLiveHref} lang={lang} /></P>
    case 'h3':
      // 2026-11-07 audit: 20px from lg, a step over the guides' 18px desktop body (seo-article.tsx P) and under the 24px h2.
      return <h3 className="mt-7 max-w-[60ch] text-base font-bold text-foreground lg:text-xl">{b.text}</h3>
    case 'ul':
      return (
        <Ul>
          {b.items.map((it, i) => <li key={i}><Inline src={it} isLiveHref={isLiveHref} lang={lang} /></li>)}
        </Ul>
      )
    case 'ol':
      return (
        <ol className="mt-3 max-w-[60ch] list-decimal space-y-2 pl-5 text-base leading-relaxed text-body marker:font-semibold marker:text-ink-4 lg:text-lg">
          {b.items.map((it, i) => <li key={i}><Inline src={it} isLiveHref={isLiveHref} lang={lang} /></li>)}
        </ol>
      )
    case 'table':
      return <GuideTable b={b} isLiveHref={isLiveHref} lang={lang} />
    case 'callout': {
      const Icon = b.tone === 'warning' ? AlertTriangle : Info
      return (
        // The disclosure panel's treatment (seo-article.tsx): information, not alarm — even the warning
        // tone only changes the glyph, so a page of callouts never reads as a page of red boxes.
        <aside className="mt-5 flex max-w-[60ch] items-start gap-3 rounded-xl bg-tint p-4">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" aria-hidden />
          <div className="min-w-0 text-sm leading-relaxed text-body lg:text-base">
            <span className="sr-only">{(lang === 'vi' ? TONE_LABEL_VI : TONE_LABEL)[b.tone]}: </span>
            {b.title && <p className="font-bold text-foreground">{b.title}</p>}
            <p className={b.title ? 'mt-1' : undefined}><Inline src={b.text} isLiveHref={isLiveHref} lang={lang} /></p>
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
                <p className="text-base font-bold text-foreground lg:text-lg">{s.title}</p>
                <p className="mt-1 text-base leading-relaxed text-body lg:text-lg"><Inline src={s.text} isLiveHref={isLiveHref} lang={lang} /></p>
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
 * 2026-11-07 audit, from md (where it is a table): the head row names its columns in sentence case and the primary ink,
 * bottom-aligned on the rule, not in 12px grey capitals, and the first column (each row's name) never narrows below 10rem,
 * so "Teaching certificate" or "Signed, never ratified" no longer stacks a word a line beside the prose columns (judges: eight
 * guide desktops). The floor holds from md on a table of up to three columns, and from xl on a wider one: estimated on the
 * guides' own tables, a four- or five-column table of unbreakable money ranges already needs ~660px at its narrowest, so the
 * floor would push it past the 672px column beside the rail at 1024px; from xl that column is 768px. The cells stay 14px, one
 * size for every table: at 16px the widest money tables would not fit beside the rail below xl.
 */
function GuideTable({ b, isLiveHref, lang = 'en' }: { b: Extract<TeachBlock, { type: 'table' }>; isLiveHref: (href: string) => boolean; lang?: 'en' | 'vi' }) {
  const firstCol = b.headers.length <= 3 ? 'md:min-w-40' : 'xl:min-w-40'
  return (
    <figure className="mt-5 max-w-3xl">
      <table className="w-full text-sm max-md:block">
        <thead className="max-md:sr-only">
          <tr className="text-left text-foreground">
            {b.headers.map((h, i) => (
              <th key={i} scope="col" className={`pb-2 pr-4 align-bottom font-semibold${i === 0 ? ` ${firstCol}` : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="max-md:block">
          {b.rows.map((row, r) => (
            <tr key={r} className="border-t border-border max-md:block max-md:py-3">
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row" className={`text-left align-top font-semibold text-foreground max-md:block ${firstCol} md:py-2 md:pr-4`}>
                    <Inline src={cell} isLiveHref={isLiveHref} lang={lang} />
                  </th>
                ) : (
                  <td key={c} className="align-top text-body max-md:mt-1 max-md:block md:py-2 md:pr-4">
                    <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:hidden">{b.headers[c]}:</span>
                    <Inline src={cell} isLiveHref={isLiveHref} lang={lang} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {/* 2026-11-07 audit: the table's source and the day it was read are its evidence, so body ink, not the faint grey. */}
      <figcaption className="mt-2 text-xs leading-relaxed text-body">
        <Inline src={b.caption} isLiveHref={isLiveHref} lang={lang} />
      </figcaption>
    </figure>
  )
}

/** The guide's sections in SeoArticle's shape, plus the closing "Sources" section. */
export function teachGuideSections(g: TeachGuide, isLiveHref: (href: string) => boolean, lang: 'en' | 'vi' = 'en'): ArticleSection[] {
  const sections: ArticleSection[] = g.sections.map((s) => ({
    id: s.id,
    title: s.title,
    body: (
      <>
        {s.blocks.map((b, i) => <Block key={i} b={b} isLiveHref={isLiveHref} lang={lang} />)}
      </>
    ),
  }))
  sections.push({
    id: 'sources',
    title: lang === 'vi' ? 'Nguồn' : 'Sources',
    body: (
      <>
        {lang === 'vi' ? (
          <P>
            Thông tin trong bài được kiểm tra lần cuối vào{' '}
            <time dateTime={g.lastChecked}>{formatArticleDate(g.lastChecked, 'vi')}</time> dựa trên các nguồn dưới đây.
            Quy định, phí và thủ tục ở Việt Nam có thể thay đổi; với nguồn của cơ quan có thẩm quyền, trang hiện tại của họ có giá trị hơn bài này.
          </P>
        ) : (
          <P>
            Facts in this guide were last checked on{' '}
            <time dateTime={g.lastChecked}>{formatArticleDate(g.lastChecked, 'en')}</time> against the sources below.
            Rules, fees and processes in Vietnam change; where a source is an authority, its current page wins over
            this one.
          </P>
        )}
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

/**
 * The "Key points" box under the lede (SeoArticle `ledeRow`): the page's answer before the long read.
 * 2026-11-06 audit: flat and closed by one hairline, not a grey well. A summary in a tinted box read as a notice and weighed as
 * much as the article around it (judges: teach and guide pages; docs/flat-surface-plan.md, "lines, not boxes"). No top rule:
 * on a phone SeoArticle's contents row sits right above it with its own.
 * 2026-11-07 audit: the points at the prose's 60ch measure and, from lg, its 18px; in the 3xl box they ran ~95 characters a line.
 */
export function TeachKeyPoints({ g, isLiveHref, lang = 'en' }: { g: TeachGuide; isLiveHref: (href: string) => boolean; lang?: 'en' | 'vi' }) {
  return (
    <section aria-labelledby={KEY_POINTS_ID} className="mt-6 max-w-3xl border-b border-border pb-6">
      <h2 id={KEY_POINTS_ID} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-accent-foreground">
        <ListChecks className="h-4 w-4" aria-hidden /> {lang === 'vi' ? 'Điểm chính' : 'Key points'}
      </h2>
      <ul className="mt-3 max-w-[60ch] list-disc space-y-2 pl-5 text-base leading-relaxed text-body marker:text-ink-4 lg:text-lg">
        {g.keyPoints.map((k, i) => <li key={i}><Inline src={k} isLiveHref={isLiveHref} lang={lang} /></li>)}
      </ul>
    </section>
  )
}

/**
 * "Data" — one line under the key points of a guide whose figures an eno.vn data page carries further: the salary and
 * cost-of-living guides point at the HCMC Teacher Cost & Pay Index, which divides the Rent Index's rents by the salary
 * guide's take-home pay (src/lib/teacher-cost-index.ts TEACHER_COST_INDEX_GUIDES picks the guides). ⛔ COMPONENT CODE,
 * NEVER THE GUIDE'S JSON: an edit there voids its review digest (registry.ts `reviewedDigest`).
 */
export function TeachDataLink({ href, label, text }: { href: string; label: string; text: string }) {
  return (
    <p className="mt-4 max-w-3xl text-sm leading-relaxed text-body lg:text-base">
      <span className="font-semibold text-foreground">Data:</span> <HereLink href={href}>{label}</HereLink> — {text}
    </p>
  )
}

/**
 * The "next step" aside after a guide's last section (SeoArticle `afterSections`) — what eno.vn itself offers a
 * teacher, stated only as far as it is true (CLAUDE.md claims rules; src/lib/teachers/*): the profile is free,
 * schools message you there (since 2026-10-13 any signed-in account may, within a daily limit on new chats; only a
 * business can ask about a cover lesson) and your phone, email and CV stay hidden until you choose to share them;
 * the school pages carry reviews written by teachers; linked jobs open the original posting, where you apply.
 * ⛔ No "we find you a job", no "verified schools", no "parents book you" — none of it is true (a parent may
 * message a teacher now, but nothing is booked through eno.vn).
 * ⛔ "LINKED ONES" OPEN THE ORIGINAL ADVERT, NEVER "EACH" POSTING (one wording wherever eno.vn says it, 2026-10-18): an
 * employer's own post has no original elsewhere (taxonomy.ts `linked={false}`), so "each" would be false the day a
 * school posts directly. On 2026-10-18 all 38 teaching jobs were linked; "linked ones" stays true either way.
 */
/** English chrome, as a constant (the guides' chrome follows the article, never `tr()` — see the file header). */
const NEXT_STEP = 'Your next step on eno.vn'

/**
 * THE SECTION'S ONE WAY IN, in one place (UI climb 2026-11-09): the hub's brand button (teach-in-vietnam/page.tsx), every
 * guide's button under its Key Points ([slug]/page.tsx) and the first of TeachNextStep's steps. English, like the articles.
 */
export const TEACH_PROFILE_CTA = { href: TEACHER_APP_ORIGIN, label: 'Make a free teacher profile' } as const

export function TeachNextStep() {
  const items: { href: string; title: string; text: string; own?: boolean }[] = [
    {
      href: TEACH_PROFILE_CTA.href,
      own: true,
      title: TEACH_PROFILE_CTA.label,
      text: 'Schools in Ho Chi Minh City can find and message you; your phone, email and CV stay hidden until you choose to share them.',
    },
    // Most school pages have no review yet, so this promises the directory, not a body of reviews.
    { href: '/schools', title: 'Look up a school before you sign', text: 'Language centres, schools and universities in Ho Chi Minh City, with teachers’ reviews where they have been written and open jobs.' },
    // The teaching-jobs board (plan B2, 2026-10-18) — the page built for teaching-job searches; /c/jobs lists every kind of job.
    { href: '/jobs-vietnam-expats', title: 'Browse teaching jobs', text: 'Current postings; linked ones open the original advert, where you apply. Never pay to get a job.' },
    { href: '/hcmc-rent-index', title: 'Check what rent costs by district', text: 'Median asking rents from thousands of live listings, updated daily.' },
  ]
  return (
    <aside aria-label={NEXT_STEP} className="mt-14 max-w-3xl border-t border-border pt-8">
      <h2 className="h-title mb-4 text-foreground">{NEXT_STEP}</h2>
      <ul className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
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
