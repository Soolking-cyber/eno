import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/edition'
import { pageShare } from '@/lib/site-identity'
import { HereLink, P, SeoArticle, type ArticleContent } from '@/components/marketplace/seo-article'
import { LiveCounts } from '@/components/marketplace/live-count'
import { loadRentIndex } from '@/app/[lang]/hcmc-rent-index/load-rent-index'
import { listSchools } from '@/lib/schools/queries'
import type { SchoolKind } from '@/lib/schools/constants'
import { formatMoneyFull } from '@/lib/vnd'
import { formatArticleDate } from '@/lib/dates'
import { requestNow } from '@/lib/teach-guides/request-clock'
import { releasedGuides, TEACH_BASE, TEACH_CLUSTERS, TEACH_START_PATHS, teachGuideDates, teachPath, type TeachGuideEntry } from '@/lib/teach-guides/registry'

/**
 * /teach-in-vietnam — THE HUB of the teacher guide library (src/lib/teach-guides/registry.ts).
 *
 * ⚠️ A DATA PAGE, NOT A LINK LIST (plan review 2026-10-10). A hub that is only ninety links is the doorway
 * shape Google's spam policies name; this one answers "teach English in Vietnam" itself — the requirements,
 * the pay, the market — with eno.vn's OWN live numbers (the school directory, live teaching jobs, the Rent
 * Index), each with where it comes from, and then routes the reader by situation, not by alphabet.
 * ⚠️ RELEASED GUIDES ONLY, AND NO GUIDE = NO HUB: before wave one the page is a 404 (an empty hub is a thin
 * URL), and the sitemap submits it only from the same moment (pages.xml/build.ts).
 * ⛔ The edition rule holds here too: no entry/stay vocabulary (registry.ts header).
 * ⚠️ ENGLISH CHROME AS PLAIN STRINGS, never `tr()`: an English article page (seo-article.tsx header).
 */
export const revalidate = 3600

const DESCRIPTION =
  'What you need, what you earn and how to start teaching English in Vietnam, Ho Chi Minh City first, with live school, job and rent numbers from eno.vn.'

/** The live guides' release and edit dates (registry.ts `teachGuideDates`): the hub is as new as its newest guide. */
function hubDates(live: TeachGuideEntry[]): { published: string; updated?: string } {
  const dates = live.map((g) => teachGuideDates(g.slug))
  const published = dates.map((d) => d.published).sort()[0]
  const newest = dates.map((d) => d.updated ?? d.published).sort().at(-1)!
  // Like teachGuideDates: no "updated" that only repeats the publication date.
  return { published, ...(newest > published ? { updated: newest } : {}) }
}

/**
 * ⚠️ THE YEAR IN THE TITLE COMES FROM THE CONTENT, NOT THE CLOCK: it is the year of the newest guide edit,
 * so it never claims a freshness the library does not have (a hard-coded "(2026)" goes stale on 1 January;
 * `new Date()` would refresh it with nothing new behind it). ≤ 60 characters with the site name.
 */
export async function generateMetadata(): Promise<Metadata> {
  const live = releasedGuides(requestNow())
  if (!live.length) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const { published, updated } = hubDates(live)
  const title = `Teach English in Vietnam: the ${(updated ?? published).slice(0, 4)} guide for Saigon | ${SITE_NAME}`
  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical: TEACH_BASE },
    ...pageShare({ title, description: DESCRIPTION, url: TEACH_BASE, type: 'article' }),
  }
}

const FACTS_LABEL = 'Ho Chi Minh City for teachers, in numbers'

/** [one, many] — the counts are live, so "1 universities" is a real possibility. */
const KIND_NAMES: Record<SchoolKind, [string, string]> = {
  language_centre: ['language centre', 'language centres'],
  international_school: ['international school', 'international schools'],
  bilingual_school: ['bilingual school', 'bilingual schools'],
  agency: ['teacher agency', 'teacher agencies'],
  university: ['university', 'universities'],
}
const plural = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`

/** The Rent Index lookup, or "unknown" if it fails — the facts box must never take the hub down. */
async function rentIndexSafe(): ReturnType<typeof loadRentIndex> {
  try {
    return await loadRentIndex()
  } catch {
    return { known: false } as Awaited<ReturnType<typeof loadRentIndex>>
  }
}

async function schoolCounts(): Promise<{ total: number; byKind: [SchoolKind, number][] } | null> {
  try {
    const rows = await listSchools({ sort: 'name' })
    const by = new Map<SchoolKind, number>()
    for (const r of rows) by.set(r.kind, (by.get(r.kind) ?? 0) + 1)
    return { total: rows.length, byKind: [...by.entries()].sort((a, b) => b[1] - a[1]) }
  } catch {
    return null // the sentence that uses it falls back to one with no number in it
  }
}

function GuideRows({ guides }: { guides: TeachGuideEntry[] }) {
  return (
    <ul className="mt-2 max-w-3xl divide-y divide-border border-y border-border">
      {guides.map((g) => (
        <li key={g.slug} className="py-3">
          <HereLink href={teachPath(g.slug)}>{g.label}</HereLink>
          <p className="mt-1 text-sm leading-relaxed text-body">{g.blurb}</p>
        </li>
      ))}
    </ul>
  )
}

export default async function TeachHubPage() {
  const now = requestNow()
  const live = releasedGuides(now)
  if (!live.length) notFound()
  const bySlug = new Map(live.map((g) => [g.slug, g]))
  const [schools, rent] = await Promise.all([schoolCounts(), rentIndexSafe()])
  const br1 = rent.known ? rent.index.cityBands.br1 : null
  const rentDate = rent.known ? formatArticleDate(rent.index.computedAt.slice(0, 10), 'en') : null

  // No school count and no rent figure: no box (a heading over an empty list, or over the job count alone, is worse than none).
  const facts = !((schools && schools.total > 0) || (br1?.median && rentDate)) ? null : (
    <section aria-label={FACTS_LABEL} className="mt-6 max-w-3xl rounded-xl bg-tint p-5">
      <p className="text-sm font-bold uppercase tracking-wide text-accent-foreground">Saigon for teachers, today</p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-body marker:text-ink-4">
        {schools && schools.total > 0 && (
          <li>
            <strong className="font-semibold text-foreground">{plural(schools.total, ['employer', 'employers'])}</strong> in{' '}
            <HereLink href="/schools">eno.vn&apos;s Ho Chi Minh City school directory</HereLink>:{' '}
            {schools.byKind.map(([k, n], i) => `${i ? ', ' : ''}${plural(n, KIND_NAMES[k] ?? ['other employer', 'other employers'])}`).join('')}.
          </li>
        )}
        <LiveCounts targets={{ jobs: { categorySlug: 'jobs', subcategoryIn: ['teaching'] } }} lang="en">
          {({ jobs }) =>
            jobs && jobs.n > 0 ? (
              <li>
                <strong className="font-semibold text-foreground">{jobs.count} {jobs.n === 1 ? 'teaching job' : 'teaching jobs'}</strong> listed now, each linked to the
                original advert — <HereLink href="/c/jobs">browse them</HereLink>.
              </li>
            ) : null
          }
        </LiveCounts>
        {br1?.median && rentDate && (
          <li>
            A one-bedroom apartment in Ho Chi Minh City has a median asking rent of{' '}
            <strong className="font-semibold text-foreground whitespace-nowrap">{formatMoneyFull(br1.median, '₫', 'en')}</strong> a month (
            {br1.n.toLocaleString('en-US')} listings, <HereLink href="/hcmc-rent-index">eno.vn Rent Index</HereLink>, {rentDate}).
          </li>
        )}
      </ul>
    </section>
  )

  const start = TEACH_START_PATHS.map((p) => ({ ...p, guides: p.slugs.map((s) => bySlug.get(s)).filter((g): g is TeachGuideEntry => !!g) })).filter((p) => p.guides.length)

  const sections: ArticleContent['sections'] = []
  if (start.length)
    sections.push({
      id: 'start-here',
      title: 'Start here',
      body: (
        <div className="grid max-w-3xl gap-x-8 gap-y-6 sm:grid-cols-2">
          {start.map((p) => (
            <div key={p.title} className="min-w-0">
              <h3 className="text-base font-bold text-foreground">{p.title}</h3>
              <ul className="mt-2 space-y-1.5 text-base">
                {p.guides.map((g) => <li key={g.slug}><HereLink href={teachPath(g.slug)}>{g.label}</HereLink></li>)}
              </ul>
            </div>
          ))}
        </div>
      ),
    })
  for (const c of TEACH_CLUSTERS) {
    const gs = live.filter((g) => g.cluster === c.id)
    if (!gs.length) continue
    sections.push({ id: c.id, title: c.title, body: (<><P>{c.lede}</P><GuideRows guides={gs} /></>) })
  }
  sections.push({
    id: 'how-these-guides-are-made',
    title: 'How these guides are made',
    body: (
      <>
        <P>
          Each guide is drafted with AI assistance from a researched fact base — Vietnamese legal texts and official
          portals first, then employers&apos; own pages and reputable reporting — checked claim by claim, and approved by
          the eno.vn team before it is published. Every guide lists its sources and the date its facts were last checked.
        </P>
        <P>
          The numbers that come from eno.vn itself are measured, not estimated: the school directory, the live job
          listings and the <HereLink href="/hcmc-rent-index">Rent Index</HereLink>. Rules in Vietnam change often; if
          something here is out of date, <HereLink href="/contact">tell us</HereLink> and we will correct it.
        </P>
      </>
    ),
  })

  const content: ArticleContent = {
    eyebrow: 'Teach in Vietnam',
    h1: 'Teaching English in Vietnam: the guide for teachers moving to Ho Chi Minh City',
    intro:
      // ⚖️ The library's canonical position (briefs/STYLE.md): the permit's "expert" test normally asks for two
      // years of relevant experience — never "you can't without it", never "you can".
      'To teach English legally in Vietnam you need a bachelor’s degree, a teaching certificate, a clean criminal record and a work permit, which your employer applies for; the permit rules normally also ask for two years of relevant experience. Most teaching jobs are at language centres paid by the hour, and Ho Chi Minh City is the biggest market. These guides take you from deciding to your first payday and beyond.',
    canonical: TEACH_BASE,
    lang: 'en',
    ...hubDates(live),
    breadcrumb: [
      { label: 'Home', href: '/' },
      { label: 'Teach in Vietnam', href: TEACH_BASE },
    ],
    ledeRow: facts,
    cta: { href: 'https://teacher.eno.vn', label: 'Make a free teacher profile', repeatAtEnd: true },
    sections,
    faqs: [],
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Teach in Vietnam guides',
        itemListElement: live.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'}${teachPath(g.slug)}`, name: g.label })),
      },
    ],
  }
  return <SeoArticle content={content} />
}
