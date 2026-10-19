import { Fragment } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/edition'
import { pageShare } from '@/lib/site-identity'
import { HereLink, P, SeoArticle, type ArticleContent } from '@/components/marketplace/seo-article'
import { LiveCounts } from '@/components/marketplace/live-count'
import { Row, Rows } from '@/components/ui/rows'
import { loadRentIndex } from '@/app/[lang]/hcmc-rent-index/load-rent-index'
import { listSchools } from '@/lib/schools/queries'
import type { SchoolKind } from '@/lib/schools/constants'
import { formatMoneyFull } from '@/lib/vnd'
import { formatArticleDate } from '@/lib/dates'
import { moneyText, TEACHER_APP_ORIGIN } from '@/lib/teach-guides/inline'
import { requestNow } from '@/lib/teach-guides/request-clock'
import { releasedGuides, TEACH_BASE, TEACH_CLUSTERS, TEACH_START_PATHS, teachGuideDates, teachHubNewest, teachPath, type TeachGuideEntry } from '@/lib/teach-guides/registry'

/**
 * /teach-in-vietnam — THE HUB of the teacher guide library (src/lib/teach-guides/registry.ts).
 *
 * ⚠️ A DATA PAGE, NOT A LINK LIST (plan review 2026-10-10). A hub that is only ninety links is the doorway
 * shape Google's spam policies name; this one answers "teach English in Vietnam" itself — the requirements,
 * the pay, the market — with eno.vn's OWN live numbers (the school directory, live teaching jobs, the Rent
 * Index), each with where it comes from, and then routes the reader by situation, not by alphabet.
 * ⚠️ ONE NATIONAL PAGE THAT ANSWERS FIRST (teacher visibility plan B1; the copy was approved in the plan, 2026-10-18).
 * The title and the H1 are about Vietnam, not Saigon: the Ho Chi Minh City guide owns the Saigon queries (plan B6),
 * and the hub — the page meant to own "teach English in Vietnam" — drew 21 impressions in launch week against 2,322
 * for its guides (Search Console, Oct 11–17). Ho Chi Minh City stays the first city in the body. Six short answers
 * open the page (`shortAnswers`), each restating a guide and linking it; the sixth says what eno.vn itself offers, as
 * the finding-a-job guide states it.
 * ⚠️ CODE, NOT REVIEWED CONTENT: the hub has no registry entry and no `reviewedDigest` (registry.ts, content.ts), so
 * editing its copy voids no guide's review — which is exactly why its claims are pinned by tests instead
 * (hub-page.test.tsx: every figure in a short answer is one its guides print, and every guide it links is released).
 * ⚠️ A READER-VISIBLE EDIT HERE MOVES registry.ts `TEACH_HUB_UPDATED` in the same change: the hub's dateModified, its
 * date line, its title year and its sitemap <lastmod> come from it or the newest guide, whichever is later.
 * ⚠️ RELEASED GUIDES ONLY, AND NO GUIDE = NO HUB: before wave one the page is a 404 (an empty hub is a thin
 * URL), and the sitemap submits it only from the same moment (pages.xml/build.ts).
 * ⛔ The edition rule holds here too: no entry/stay vocabulary (registry.ts header).
 * ⚠️ ENGLISH CHROME AS PLAIN STRINGS, never `tr()`: an English article page (seo-article.tsx header).
 */
export const revalidate = 3600

// National, like the title and the H1, whose three promises it opens with; the live numbers it promises are the facts
// box's (school directory, jobs, Rent Index). ⚠️ site-links.ts `teachHubLink` restates it as its blurb: change both.
const DESCRIPTION =
  'Teaching English in Vietnam: what you need, what you earn and where the jobs are, Ho Chi Minh City first, with live job, school and rent numbers from eno.vn.'

/**
 * Published: the first live guide's release (registry.ts `teachGuideDates`). Updated: the hub's newest edit, its own
 * copy's (`TEACH_HUB_UPDATED`) or its newest guide's, whichever is later (`teachHubNewest`, which the sitemap's
 * <lastmod> reads too).
 */
function hubDates(live: TeachGuideEntry[]): { published: string; updated?: string } {
  const published = live.map((g) => teachGuideDates(g.slug).published).sort()[0]
  const newest = teachHubNewest(live)
  // Like teachGuideDates: no "updated" that only repeats the publication date.
  return { published, ...(newest > published ? { updated: newest } : {}) }
}

/**
 * ⚠️ THE YEAR IN THE TITLE COMES FROM THE CONTENT, NOT THE CLOCK: it is the year of the newest edit, the hub's own
 * or a guide's (`hubDates`), so it never claims a freshness the library does not have (a hard-coded "(2026)" goes
 * stale on 1 January; `new Date()` would refresh it with nothing new behind it). ≤ 60 characters with the site name.
 * ⚠️ "rules, pay & jobs", NOT the plan's "requirements, pay and jobs": that is 68 characters with " | eno.vn" and this
 * is 59 — the same three promises as the H1 (what you need, what you earn, where the jobs are), with "Teach English in
 * Vietnam" first. ⛔ No live count in a <title>: cached HTML and search snippets keep a number long after it moved.
 */
export async function generateMetadata(): Promise<Metadata> {
  const live = releasedGuides(requestNow())
  if (!live.length) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const { published, updated } = hubDates(live)
  const title = `Teach English in Vietnam (${(updated ?? published).slice(0, 4)}): rules, pay & jobs | ${SITE_NAME}`
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

/**
 * A đồng amount in the guides' own format (inline.ts `moneyText`: "390,000–600,000 đ"), so a figure restated here
 * reads exactly as its guide prints it — and never breaks across a line, as in the guides (teach-guide-body.tsx).
 */
function Money({ v, to }: { v: number; to?: number }) {
  return <span className="whitespace-nowrap">{moneyText(v, to)}</span>
}

const strong = 'font-semibold text-foreground'

type ShortAnswer = {
  /** The answer's anchor (`/teach-in-vietnam#pay`): stable, because it can be linked to. */
  id: string
  q: string
  a: React.ReactNode
  /** The guides the answer restates, linked under it — only the released ones render (`bySlug`). */
  guides: readonly string[]
  /**
   * YYYY-MM-DD: the day the facts restated here were last checked — the source guides' `lastChecked`, or, for what
   * eno.vn itself offers, the day it was checked against the code (never older than a cited guide's `lastChecked`).
   */
  checked: string
}

/**
 * THE SHORT ANSWERS — the six questions the hub answers before it routes anyone anywhere (plan B1, "answer first").
 *
 * ⛔ THEY RESTATE THE GUIDES AND ADD NOTHING. Every figure and rule below is one the cited guide states (its fields are
 * named beside each answer) or a number this page already loads (the Rent Index median, as in the facts box); what
 * eno.vn itself offers is said only as its guide states it and the site does it (the last answer names both). The
 * guides are fact-checked and owner-approved claim by claim; this file is code that no review digest covers, so the
 * guarantee is mechanical instead (hub-page.test.tsx): every figure in an answer must appear in one of its guides
 * (an answer citing none states no figure), and `checked` may not be older than any cited guide's `lastChecked`.
 * ⚠️ So when a guide's facts are re-checked, that test fails on purpose: re-read the answer against the guide, fix
 * what moved, then re-date it.
 * ⚖️ The canonical positions are stated as STYLE.md states them (~/eno-teach-guides/briefs/STYLE.md), wording free,
 * substance fixed. The 2-year rule: "at least 2 years" (Decree 219/2025 Art 3(3)(a)) and, for less, ask the employer
 * which proof they will file — never "normally", never "you can't without it", never "you can". It is said IN FULL
 * once, in the lead (decree, alternative proof, "in writing"); the first answer keeps the rule and a short caveat, so
 * the first screen does not say the same sentence twice. Pay: centres offered 390,000–600,000 đ an hour, most
 * new-teacher offers 430,000–560,000 đ — always both.
 * ⛔ The edition rule: no entry/stay vocabulary (registry.ts header; teach-guides.test.ts scans this file).
 * ⚠️ US dollar amounts never share a sentence with a đồng amount, and every pay, budget or rent amount says "an hour"
 * or "a month" (STYLE.md, the guides' money rules; a one-off fee needs neither) — hub-page.test.tsx checks both.
 */
function shortAnswers(rent: { median: number } | null): ShortAnswer[] {
  return [
    {
      id: 'who-can-teach',
      q: 'Who can teach English in Vietnam?',
      // requirements guide: keyPoints[0] (the gate, degree + at least 2 years), section no-teaching-experience (with
      // less, ask which proof they will file — in full, with the decree and "in writing", in the lead), intro (police
      // check, health check, the teaching certificate and the 120-hour convention, no maximum age, non-native
      // speakers), keyPoints[3] (no established legal route without a degree).
      a: (
        <>
          The work permit is the gate: a bachelor’s degree plus <strong className={strong}>at least 2 years of relevant
          experience</strong> (with less, ask your employer which proof they will file), a police check issued within 6
          months of filing and a health check done in Vietnam. Language centres must also see a suitable teaching
          certificate; employers usually want a 120-hour TEFL, TESOL or CELTA. There is no legal maximum age, and
          non-native speakers are not barred, though language centres may need C1-level English proof from them. There is
          no established legal route without a degree.
        </>
      ),
      guides: ['requirements-to-teach-english-in-vietnam'],
      checked: '2026-10-11',
    },
    {
      id: 'pay',
      q: 'What does teaching English in Vietnam pay?',
      // salary guide: keyPoints[0] (centres, and most new-teacher offers — STYLE.md's pay position, both ranges always),
      // pay-by-employer-type table (public-school agencies), keyPoints[1] and the monthly-income-hourly table "hours
      // taught × rate" (78–95 hours a month at its 450,000 đ lower and 550,000 đ upper full-time rates: the gross is NOT
      // the full 390,000–600,000 đ span times the hours), keyPoints[2] and the gross-to-net table (resident, no
      // dependants, 12-month contract: 45,000,000 đ gross keeps about 38,700,000 đ), intro (bilingual and international
      // schools). language-centre guide: keyPoints[0–1], the same position, with the rate printed as one range.
      a: (
        <>
          In July–October 2026 Ho Chi Minh City job ads, language centres offered <Money v={390_000} to={600_000} /> an hour
          (most new-teacher offers <Money v={430_000} to={560_000} /> an hour) and public-school agencies{' '}
          <Money v={430_000} to={600_000} /> an hour. A full-time centre load of about 78–95 teaching hours a month, at{' '}
          <Money v={450_000} to={550_000} /> an hour, comes to roughly <Money v={35_000_000} to={52_000_000} /> gross a
          month. A tax resident with no dependants on a 12-month contract earning <Money v={45_000_000} /> gross a month
          keeps about <strong className={strong}><Money v={38_700_000} /></strong> a month after social insurance and
          income tax. Bilingual schools advertise US$1,700–3,000 a month, and premium international schools pay licensed
          teachers about US$2,500–4,000+ a month.
        </>
      ),
      guides: ['english-teacher-salary-in-vietnam', 'language-centre-jobs-in-ho-chi-minh-city'],
      checked: '2026-10-11',
    },
    {
      id: 'work-permit',
      q: 'How does the work permit work, and how long does it take?',
      // work-permit guide: intro (the school applies; HCMC's Department of Home Affairs, 5 working days published, up to
      // 2 years), keyPoints[3] (filing window, fee paid by the employer), step-by-step (the decree's 10 working days;
      // 1 to 6 months end to end; no teaching before the permit), keyPoints[4] (one employer, one position).
      a: (
        <>
          Your school applies for it, not you, and files 60 to 10 days before your start date. In Ho Chi Minh City the
          Department of Home Affairs issues it, with 5 working days published for a decision (the decree allows up to 10),
          and the <Money v={600_000} /> fee is the employer’s. End to end, with documents from abroad to authenticate,
          practitioners report <strong className={strong}>1 to 6 months</strong>. A permit lasts up to 2 years and covers
          one employer and one position, and you may not teach a paid class before it is issued.
        </>
      ),
      guides: ['vietnam-work-permit-for-english-teachers'],
      checked: '2026-10-11',
    },
    {
      id: 'where-the-jobs-are',
      q: 'Where are the teaching jobs?',
      // Hanoi vs HCMC guide: section why-most-jobs-are-in-hcmc-and-hanoi ("most of them live in the two big cities"),
      // intro (HCMC the biggest market by a wide margin; Hanoi pays the same or slightly more per hour in 2026 ads; Da
      // Nang far fewer jobs), keyPoints[0] (1,961 centres, August 2025; Hanoi the clear second market).
      // ⛔ NOT "most are in Ho Chi Minh City": no guide says it, and eno.vn's own listings disagree (2026-10-18, a GET of
      // the teaching jobs: Hanoi 13, Ho Chi Minh City 12 of 38). Finding-a-job guide: intro (where jobs are advertised;
      // never pay to be hired), keyPoints[1] (centres hire all year, busiest June–August).
      a: (
        <>
          Most are in Ho Chi Minh City and Hanoi. Ho Chi Minh City is Vietnam’s biggest market for English teachers by a
          wide margin (1,961 licensed language and IT centres in August 2025); Hanoi is the clear second, and its 2026 job
          ads pay the same per hour as Saigon or slightly more. Da Nang has far fewer jobs. Language centres hire all year,
          busiest from June to August. Employers advertise on their own careers sites, on teaching job boards and in
          Facebook groups, and international schools through group portals and international boards; never pay anyone to
          be hired.
        </>
      ),
      guides: ['finding-a-teaching-job-in-vietnam', 'hanoi-vs-ho-chi-minh-city-for-teachers'],
      checked: '2026-10-11',
    },
    {
      id: 'cost-of-living',
      q: 'What does Ho Chi Minh City cost?',
      // Cost-of-living guide: keyPoints[1] (the two budgets), keyPoints[2] (full-time take-home after insurance and
      // resident tax) — the salary guide's what-you-can-save section says the same — and intro ("Rent decides the gap").
      // The median: the Rent Index this page loads. ⚠️ POINTED AT, NOT REPEATED: the facts box above prints it with its
      // listing count and date, and the same sentence twice on one screen reads as filler; both render only when the
      // index loads, so "above" is always there when this is.
      a: (
        <>
          On eno.vn’s budgets a frugal single teacher in a private room spends about <Money v={14_000_000} to={17_000_000} />{' '}
          a month and a comfortable one in a one-bedroom flat about <Money v={25_000_000} to={35_000_000} /> a month, against
          full-time take-home pay of about <Money v={30_500_000} to={44_300_000} /> a month at a language centre.
          {rent && (
            <>
              {' '}Rent decides the gap: the median one-bedroom asks <strong className={strong}><Money v={rent.median} /></strong>{' '}
              a month (<HereLink href="/hcmc-rent-index">Rent Index</HereLink>, above).
            </>
          )}
        </>
      ),
      guides: ['cost-of-living-in-ho-chi-minh-city-for-teachers'],
      checked: '2026-10-11',
    },
    {
      id: 'how-eno-helps',
      q: 'How does eno.vn help?',
      // What eno.vn itself offers, as the finding-a-job guide's eno.vn paragraph states it (its first section, as
      // re-approved in wave 1a, 2026-10-18), and as the site does it: a free teacher profile that anyone signed in to
      // eno.vn can message (teachers/constants.ts TEACHER_DM_LIMITS: any account, within a daily limit on new chats);
      // the phone, email and CV hidden until the teacher shares them in that chat (teacher-contact.tsx); job postings
      // that open the original ad, where you apply (affiliate-booking.tsx "Apply on the original posting"); the school
      // directory, with teachers' reviews where there are any. hub-page.test.tsx checks the guide still says each one.
      // ⛔ "LINKED" JOBS OPEN THE ORIGINAL ADVERT — NEVER "EACH" JOB (one wording wherever eno.vn says it, 2026-10-18).
      // On 2026-10-18 all 38 teaching jobs were linked (imported, an affiliateUrl to the advert), but an employer's own
      // post is not (taxonomy.ts: `linked={false}`), so "each" would be false the day a school posts directly; "linked
      // ones" stays true either way. The guide's own "each opens the original ad" is approved text, locked by its
      // review digest: the hub does not repeat it. The facts box makes no link claim, so this is said once.
      a: (
        <>
          <a href={TEACHER_APP_ORIGIN} rel="noopener" className="font-semibold text-accent-foreground hover:underline">
            Make a free teacher profile
          </a>
          : schools and others looking for a teacher can message you, and your phone, email and CV stay private until you
          share them. Linked <HereLink href="/jobs-vietnam-expats">teaching jobs</HereLink> on eno.vn open the original advert, where you
          apply, and the <HereLink href="/schools">school directory</HereLink> lists Ho Chi Minh City employers with
          teachers’ reviews where they have been written.
        </>
      ),
      guides: ['finding-a-teaching-job-in-vietnam'],
      checked: '2026-10-18',
    },
  ]
}

/** The short answers as ruled rows (the flat canon's list — ui/rows), each closed by its date and its guides. */
function ShortAnswers({ answers, bySlug }: { answers: ShortAnswer[]; bySlug: ReadonlyMap<string, TeachGuideEntry> }) {
  return (
    <Rows bordered className="max-w-3xl">
      {answers.map((x) => {
        const guides = x.guides.map((s) => bySlug.get(s)).filter((g): g is TeachGuideEntry => !!g)
        return (
          <Row key={x.id} className="py-4">
            {/* The anchor is on the question, so a jump lands on it below the sticky header. */}
            <h3 id={x.id} className="scroll-mt-24 text-base font-bold text-foreground">{x.q}</h3>
            <p className="mt-1 max-w-[60ch] text-base leading-relaxed text-body">{x.a}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-4">
              Facts checked <time dateTime={x.checked}>{formatArticleDate(x.checked, 'en')}</time>
              {guides.length > 0 && (
                <>
                  {' · More in '}
                  {guides.map((g, i) => (
                    <Fragment key={g.slug}>
                      {i > 0 && ' and '}
                      <HereLink href={teachPath(g.slug)}>{g.label}</HereLink>
                    </Fragment>
                  ))}
                </>
              )}
            </p>
          </Row>
        )
      })}
    </Rows>
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
  // ONE condition for the facts box's rent line and the cost answer that points "above" at it.
  const rentFact = br1?.median && rentDate ? { median: br1.median, n: br1.n, date: rentDate } : null

  // No school count and no rent figure: no box (a heading over an empty list, or over the job count alone, is worse than none).
  const facts = !((schools && schools.total > 0) || rentFact) ? null : (
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
        {/* ⛔ A NATIONAL COUNT, SAID AS ONE. The count has no province (and `allIn` can only say whether EVERY job is in
            one province, not count those that are), so under a Saigon heading it must name Vietnam: on 2026-10-18, 12
            of the 38 were in Ho Chi Minh City and 13 in Hanoi. ⛔ NO LINK CLAIM HERE: the short answer "How does eno.vn
            help?" makes it once, in the one wording (linked ones open the original advert, where you apply) — never
            "each", which an employer's own post would falsify, and no "most" to keep true as direct posts arrive. */}
        <LiveCounts targets={{ jobs: { categorySlug: 'jobs', subcategoryIn: ['teaching'] } }} lang="en">
          {({ jobs }) =>
            jobs && jobs.n > 0 ? (
              <li>
                <strong className="font-semibold text-foreground">{jobs.count} {jobs.n === 1 ? 'teaching job' : 'teaching jobs'} in Vietnam</strong> listed
                now — <HereLink href="/jobs-vietnam-expats">browse them</HereLink>.
              </li>
            ) : null
          }
        </LiveCounts>
        {rentFact && (
          <li>
            A one-bedroom apartment in Ho Chi Minh City has a median asking rent of{' '}
            <strong className="font-semibold text-foreground whitespace-nowrap">{formatMoneyFull(rentFact.median, '₫', 'en')}</strong> a month (
            {rentFact.n.toLocaleString('en-US')} listings, <HereLink href="/hcmc-rent-index">eno.vn Rent Index</HereLink>, {rentFact.date}).
          </li>
        )}
      </ul>
    </section>
  )

  const start = TEACH_START_PATHS.map((p) => ({ ...p, guides: p.slugs.map((s) => bySlug.get(s)).filter((g): g is TeachGuideEntry => !!g) })).filter((p) => p.guides.length)

  const sections: ArticleContent['sections'] = [
    // FIRST, before any list of links: the page answers, then routes (plan B1).
    {
      id: 'short-answers',
      title: 'The short answers',
      body: <ShortAnswers answers={shortAnswers(rentFact)} bySlug={bySlug} />,
    },
  ]
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
    h1: 'Teaching English in Vietnam: what you need, what you earn, where the jobs are',
    intro:
      // ⚖️ The library's canonical position (briefs/STYLE.md): the permit's "expert" test is a degree plus AT LEAST 2
      // years of relevant experience (Decree 219/2025 Art 3(3)(a)); Art 19(3)(đ) lists an alternative proof for
      // education, and how Ho Chi Minh City applies it to a teacher with less is unpublished — so: if you have less,
      // ask the employer in writing which proof they will file. The condition comes first, so the alternative never
      // reads as a way round the rule. Never "normally", never "you can't without it", never "you can".
      // This is the paragraph answer engines quote and the Article JSON-LD description (seo-article.tsx `intro`), and
      // the one place the hub says the 2-year rule in full (the first short answer shortens it).
      'To teach English legally in Vietnam you need a bachelor’s degree, a teaching certificate, a clean criminal record and a work permit, which your employer applies for. For the permit you need at least 2 years of relevant experience (Decree 219/2025); if you have less, an alternative proof exists, so ask your employer in writing which one they will file. Most teaching jobs are at language centres paid by the hour, and Ho Chi Minh City is the biggest market. These guides take you from deciding to your first payday and beyond.',
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
