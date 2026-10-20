import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SITE_NAME } from '@/lib/edition'

/**
 * ⛔ A SCHOOL PAGE IS SUBMITTED IN pages.xml EXACTLY WHEN IT ANSWERS INDEX (plan P1 item 17, 2026-10-20).
 *
 * Until then the page indexed a review OR an open job and the sitemap wanted a review: measured that day, all 7
 * indexable school pages on eno.vn were job-only and none of them was submitted. Both now call page-seo.ts
 * schoolPageIndexable — and that is not enough on its own: they must also feed it the SAME counts. So this runs the
 * real page (generateMetadata, and the page itself for its structured data) and the real schoolsForSitemap over ONE
 * fake database, and asserts school by school that "submitted" and "indexable" agree.
 *
 * The SQL that decides which reviews are public is not under test here (a mock would only echo it back — the real
 * Postgres probes cover it, queries.probe.test.ts); the fake answers the PUBLIC reviews of the schools asked for. What
 * is under test is that the page and pages.xml read the same reviews, the same jobs, and one rule — and that the board
 * (listAllSchools), which reads every school at once like pages.xml, counts what each page lists.
 */

type School = {
  id: string; slug: string; name: string; kind: string; website: string | null; sellerId: string | null; status: string
  aliases: string[]
}
type Review = { id: string; schoolId: string; visible: boolean; moderatedAt: Date }
type Job = { id: string; sellerId: string; city: string; employer: string; postedAt: Date; status?: string; verified?: boolean }

const d = (s: string) => new Date(`${s}T03:00:00Z`)
const h = vi.hoisted(() => ({
  schools: [] as School[],
  reviews: [] as Review[],
  jobs: [] as Job[],
}))

h.schools = [
  { id: 's-reviewed', slug: 'reviewed-school', name: 'Reviewed School', kind: 'international_school', website: 'https://reviewed.edu.vn', sellerId: null, status: 'active', aliases: ['reviewed school'] },
  { id: 's-jobs', slug: 'jobs-only-centre', name: 'Jobs Only Centre', kind: 'language_centre', website: 'https://www.jobsonly.vn/en', sellerId: null, status: 'active', aliases: ['jobs only centre'] },
  { id: 's-both', slug: 'both-school', name: 'Both School', kind: 'bilingual_school', website: null, sellerId: 'seller-both', status: 'active', aliases: ['both school'] },
  { id: 's-empty', slug: 'empty-school', name: 'Empty School', kind: 'language_centre', website: 'https://empty.vn', sellerId: null, status: 'active', aliases: ['empty school'] },
  { id: 's-hanoi', slug: 'hanoi-named', name: 'Hanoi Named', kind: 'language_centre', website: null, sellerId: null, status: 'active', aliases: ['hanoi named'] },
  { id: 's-hidden', slug: 'hidden-school', name: 'Hidden School', kind: 'language_centre', website: null, sellerId: null, status: 'hidden', aliases: ['hidden school'] },
  { id: 's-pending', slug: 'pending-review', name: 'Pending Review', kind: 'university', website: null, sellerId: null, status: 'active', aliases: [] },
  // A recruiter with its own linked shop, and a school it posts a job for by name.
  { id: 's-agency', slug: 'agency-co', name: 'Agency Co', kind: 'agency', website: 'https://agency.vn', sellerId: 'seller-agency', status: 'active', aliases: ['agency co'] },
  { id: 's-named', slug: 'named-by-agency', name: 'Named By Agency', kind: 'university', website: 'javascript:alert(1)', sellerId: null, status: 'active', aliases: ['named by agency'] },
  // A website a URL parser accepts but that would close the structured data's <script> if it were not escaped.
  { id: 's-script', slug: 'script-site', name: 'Script Site', kind: 'language_centre', website: 'https://x.vn/</script><script>alert(1)</script>', sellerId: null, status: 'active', aliases: ['script site'] },
]
h.reviews = [
  { id: 'r-1', schoolId: 's-reviewed', visible: true, moderatedAt: d('2026-10-10') },
  { id: 'r-2', schoolId: 's-both', visible: true, moderatedAt: d('2026-10-01') },
  // Approved, but its author does not count (yet): not public, so not content.
  { id: 'r-3', schoolId: 's-pending', visible: false, moderatedAt: d('2026-10-11') },
  // Approved AFTER the agency's job was posted: the review dates its page (verifier, 2026-10-20).
  { id: 'r-4', schoolId: 's-agency', visible: true, moderatedAt: d('2026-10-18') },
]
h.jobs = [
  { id: 'j-1', sellerId: 'someone', city: 'Hồ Chí Minh', employer: 'Jobs Only Centre', postedAt: d('2026-10-15') },
  // An older second job at the same school: the page lists both, and the newer one dates it (verifier, 2026-10-20).
  { id: 'j-8', sellerId: 'someone', city: 'Hồ Chí Minh', employer: 'Jobs Only Centre', postedAt: d('2026-10-09') },
  // The school's own shop counts wherever the job is.
  { id: 'j-2', sellerId: 'seller-both', city: 'Hà Nội', employer: 'Anything', postedAt: d('2026-10-12') },
  // A name match outside HCMC is another school.
  { id: 'j-3', sellerId: 'someone', city: 'Hà Nội', employer: 'Hanoi Named', postedAt: d('2026-10-13') },
  { id: 'j-4', sellerId: 'someone', city: 'Hồ Chí Minh', employer: 'Hidden School', postedAt: d('2026-10-13') },
  // The agency's shop posts a job under the named school's name: on BOTH pages (job-match.ts jobSchoolIds).
  { id: 'j-5', sellerId: 'seller-agency', city: 'Saigon', employer: 'Named By Agency', postedAt: d('2026-10-14') },
  // Not live: never content.
  { id: 'j-6', sellerId: 'someone', city: 'Hồ Chí Minh', employer: 'Empty School', postedAt: d('2026-10-16'), status: 'expired' },
  { id: 'j-7', sellerId: 'someone', city: 'Hồ Chí Minh', employer: 'Empty School', postedAt: d('2026-10-16'), verified: false },
]

vi.mock('@/lib/db', () => {
  /** The school ids a raw query was asked about (its first interpolation is `Prisma.join(schoolIds)`). */
  const idsOf = (values: unknown[]) => ((values[0] as { values?: unknown[] })?.values ?? []) as string[]
  const live = (j: Job) => (j.status ?? 'active') === 'active' && (j.verified ?? true)
  const has = (where: Record<string, unknown>, row: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'in' in v ? (v as { in: unknown[] }).in.includes(row[k]) : row[k] === v))
  return {
    db: {
      // ⚠️ Only the raw reads these two paths make; anything else is a new query this fake does not know, so it fails.
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?')
        if (sql.includes('from "SchoolReviewVote" v')) return []
        if (sql.includes('from "SchoolVote" v')) return []
        if (sql.includes('"payVnd" as "payVnd"')) return []
        if (sql.includes('r."moderatedAt" as "moderatedAt"')) {
          const ids = idsOf(values)
          return h.reviews.filter((r) => r.visible && ids.includes(r.schoolId)).map(({ id, schoolId, moderatedAt }) => ({ id, schoolId, moderatedAt }))
        }
        throw new Error(`fake db: unexpected raw query ${sql.slice(0, 80)}`)
      },
      school: {
        findFirst: async ({ where }: { where: { slug: string; status: string } }) => {
          const s = h.schools.find((x) => x.slug === where.slug && x.status === where.status)
          return s ? { ...s, districts: ['District 1'], curricula: [], summary: '', summaryVi: null, updatedAt: new Date('2026-10-01T03:00:00Z') } : null
        },
        // pages.xml (id, slug, sellerId) and the board (name, kind, districts, aliases) read the same rows.
        findMany: async ({ where }: { where: { status: string } }) =>
          h.schools.filter((s) => s.status === where.status).sort((a, b) => (a.slug < b.slug ? -1 : 1))
            .map(({ id, slug, name, kind, sellerId, aliases }) => ({ id, slug, name, kind, sellerId, districts: ['District 1'], aliases: aliases.map((alias) => ({ alias })) })),
      },
      schoolAlias: {
        findMany: async ({ where }: { where: { schoolId: { in: string[] } } }) =>
          h.schools.filter((s) => where.schoolId.in.includes(s.id)).flatMap((s) => s.aliases.map((alias) => ({ alias, schoolId: s.id }))),
      },
      category: { findUnique: async () => ({ id: 'cat-jobs' }) },
      listing: {
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          h.jobs
            .map((j) => ({ ...j, categoryId: 'cat-jobs', status: j.status ?? 'active', verified: j.verified ?? true, attributes: JSON.stringify({ employer: j.employer }) }))
            .filter((j) => has(where, j) && ('id' in where || live(j)))
            .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime()),
      },
      schoolReview: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          h.reviews.filter((r) => where.id.in.includes(r.id)).map((r) => ({
            id: r.id, current: true, tenure: 'lt1', role: 'teacher', employment: 'full_time', leftYear: null, showLeftYear: false, district: null,
            pros: 'p'.repeat(30), cons: 'c'.repeat(30), advice: null, goodTags: [], badTags: [], replyText: null, replyAt: null, submittedAt: r.moderatedAt,
          })),
      },
      schoolAward: { findMany: async () => [] },
    },
  }
})
// The edition's listing scope is not what is under test: both paths call it, and here it adds nothing.
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (where: unknown) => where }))
vi.mock('@/lib/kyc/identity', () => ({ verifiedProfileIds: async () => new Set<string>() }))
vi.mock('@/lib/serialize', async (orig) => ({ ...(await orig<typeof import('@/lib/serialize')>()), serializeListingCard: (l: { id: string }) => ({ id: l.id }) }))

// The page's chrome and client islands: stand-ins that render only what this test reads.
vi.mock('next/link', () => ({ default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => <a href={href} className={className}>{children}</a> }))
vi.mock('@/context/language-context', () => ({ Tr: ({ text }: { text?: string | null }) => text ?? null }))
vi.mock('@/components/marketplace/bilingual', () => ({
  Bilingual: ({ en, values }: { en: string; values?: Record<string, string> }) => Object.entries(values ?? {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), en),
}))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/components/schools/breadcrumb-nav', () => ({ BreadcrumbNav: ({ children }: { children: ReactNode }) => <nav>{children}</nav> }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/components/ui/icons', () => ({ ExternalLink: () => null, PencilLine: () => null }))
vi.mock('@/components/schools/school-live', () => ({ SchoolLiveProvider: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/components/schools/school-stats', () => ({ SchoolScore: () => null }))
vi.mock('@/components/schools/school-reviews', () => ({ SchoolReviews: () => null }))
vi.mock('@/components/schools/school-jobs', () => ({ SchoolJobs: ({ jobs }: { jobs: { card: { id: string } }[] }) => <ul>{jobs.map((j) => <li key={j.card.id} data-job={j.card.id} />)}</ul> }))
vi.mock('@/components/schools/school-claim', () => ({ SchoolClaim: () => null }))
vi.mock('@/components/schools/school-bits', () => ({ KindLabel: ({ kind }: { kind: string }) => kind, PayRange: () => null, SchoolLogo: () => null }))
vi.mock('@/components/schools/award-badge', () => ({ AwardBadge: () => null }))

vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
afterAll(() => { vi.unstubAllEnvs() })
const { generateMetadata, default: SchoolPageRoute } = await import('./page')
const { getSchoolPage, listAllSchools, schoolsForSitemap } = await import('@/lib/schools/queries')

const meta = (slug: string, lang = 'en') => generateMetadata({ params: Promise.resolve({ lang, slug }) })
const indexes = (m: Awaited<ReturnType<typeof meta>>) => (m.robots as { index?: boolean } | undefined)?.index !== false
const render = async (slug: string, lang = 'en') => renderToStaticMarkup(await SchoolPageRoute({ params: Promise.resolve({ lang, slug }) }))
const ldOf = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]))

let submitted: { slug: string; lastmod: Date | null }[] = []
beforeAll(async () => {
  submitted = await schoolsForSitemap()
})

describe('the index rule: pages.xml submits exactly the school pages that answer index', () => {
  it('⛔ agrees with every page, school by school — reviewed, job-only, both, neither, hidden', async () => {
    const slugs = new Set(submitted.map((s) => s.slug))
    for (const s of h.schools) expect(slugs.has(s.slug), s.slug).toBe(indexes(await meta(s.slug)))
  })

  it('submits a job-only page now, and still nothing without a public review or a live HCMC job of its own', () => {
    expect(submitted.map((s) => s.slug)).toEqual(['agency-co', 'both-school', 'jobs-only-centre', 'named-by-agency', 'reviewed-school'])
  })

  it("a job one school's shop posts under another school's name puts BOTH pages in — as both pages list it", async () => {
    for (const slug of ['agency-co', 'named-by-agency']) {
      expect(await render(slug), slug).toContain('data-job="j-5"')
      expect(indexes(await meta(slug)), slug).toBe(true)
    }
  })

  it('dates each page by the newest thing it lists: a review approval or a job posting', () => {
    const lastmod = Object.fromEntries(submitted.map((s) => [s.slug, s.lastmod?.toISOString().slice(0, 10)]))
    expect(lastmod).toEqual({
      'reviewed-school': '2026-10-10',
      'jobs-only-centre': '2026-10-15', // the newer of its two jobs, never the older one
      'both-school': '2026-10-12', // its own shop's job is newer than its review
      'agency-co': '2026-10-18', // its review is newer than its job
      'named-by-agency': '2026-10-14',
    })
  })

  it('counts every job a page lists, not just one — and the page lists them all', async () => {
    const html = await render('jobs-only-centre')
    for (const id of ['j-1', 'j-8']) expect(html, id).toContain(`data-job="${id}"`)
    expect((await getSchoolPage('jobs-only-centre'))?.jobs.length).toBe(2)
  })

  it('keeps the thin entries noindex,follow and a hidden school a 404', async () => {
    for (const slug of ['empty-school', 'hanoi-named', 'pending-review', 'script-site']) expect((await meta(slug)).robots, slug).toEqual({ index: false, follow: true })
    expect(await meta('hidden-school')).toMatchObject({ robots: { index: false } })
  })

  it('the board, reading every school at once, counts the jobs and reviews each page lists', async () => {
    const rows = await listAllSchools()
    expect(rows.map((r) => r.slug).sort()).toEqual(h.schools.filter((s) => s.status === 'active').map((s) => s.slug).sort())
    for (const r of rows) {
      const page = await getSchoolPage(r.slug)
      expect({ jobs: r.jobs, reviews: r.reviews }, r.slug).toEqual({ jobs: page?.jobs.length, reviews: page?.reviews.length })
    }
    // Including the job the agency's shop posted under the named school's name, on both rows.
    expect(Object.fromEntries(rows.filter((r) => r.jobs).map((r) => [r.slug, r.jobs]))).toEqual({ 'agency-co': 1, 'both-school': 1, 'jobs-only-centre': 2, 'named-by-agency': 1 })
  })
})

describe('a job-only page is titled for its jobs', () => {
  it('in English, and in Vietnamese on the Vietnamese variant — the share cards stay English', async () => {
    const en = await meta('jobs-only-centre')
    expect(en.title).toBe(`Jobs Only Centre: open teaching jobs | ${SITE_NAME}`)
    expect(en.description).toBe('Open teaching jobs at Jobs Only Centre (language centre, Ho Chi Minh City). No reviews or pay reports from teachers yet.')
    const vi_ = await meta('jobs-only-centre', 'vi')
    expect(vi_.title).toBe(`Jobs Only Centre: việc làm giáo viên đang tuyển | ${SITE_NAME}`)
    expect(vi_.openGraph?.title).toBe(en.title)
    expect(vi_.twitter?.title).toBe(en.title)
    expect(vi_.description).toBe(en.description)
  })

  it('never promises reviews or pay it does not have; a page with a review keeps its title on both variants', async () => {
    expect(String((await meta('jobs-only-centre')).title)).not.toMatch(/review|pay/i)
    for (const lang of ['en', 'vi']) {
      expect((await meta('reviewed-school', lang)).title, lang).toBe(`Reviewed School: teacher reviews, pay and jobs | ${SITE_NAME}`)
      expect((await meta('both-school', lang)).title, lang).toBe(`Both School: teacher reviews, pay and jobs | ${SITE_NAME}`)
    }
  })

  it('the "no reviews yet" description is for a jobs-only page alone — never over a review, never over no job', async () => {
    const said = (name: string, kind: string) => `What teachers say about ${name} (${kind}, Ho Chi Minh City): votes, what is good and bad, pay reported by teachers and open jobs.`
    for (const lang of ['en', 'vi']) {
      expect((await meta('reviewed-school', lang)).description, lang).toBe(said('Reviewed School', 'international school'))
      expect((await meta('both-school', lang)).description, lang).toBe(said('Both School', 'bilingual school'))
      expect((await meta('agency-co', lang)).description, lang).toBe(said('Agency Co', 'teacher agency'))
      // A thin entry (noindex) lists no job, so it keeps the title and description it had (verifier, 2026-10-20).
      const thin = await meta('empty-school', lang)
      expect(thin.title, lang).toBe(`Empty School: teacher reviews, pay and jobs | ${SITE_NAME}`)
      expect(thin.description, lang).toBe(said('Empty School', 'language centre'))
    }
  })
})

describe('the school as structured data, from what the page shows', () => {
  it('an EducationalOrganization: the H1 name, this page, and the website the About card links', async () => {
    const html = await render('jobs-only-centre')
    const org = ldOf(html).find((n) => n['@type'] === 'EducationalOrganization')
    expect(org).toEqual({
      '@context': 'https://schema.org',
      '@type': 'EducationalOrganization',
      '@id': 'https://eno.vn/schools/jobs-only-centre#school',
      name: 'Jobs Only Centre',
      mainEntityOfPage: 'https://eno.vn/schools/jobs-only-centre',
      url: 'https://www.jobsonly.vn/en',
    })
    // The same address the card links, by its host.
    expect(html).toContain('href="https://www.jobsonly.vn/en"')
    expect(html).toContain('jobsonly.vn')
    // The breadcrumb stays.
    expect(ldOf(html).map((n) => n['@type'])).toEqual(['BreadcrumbList', 'EducationalOrganization'])
  })

  it('no website in the markup when the page links none; a teacher agency is an Organization', async () => {
    const named = await render('named-by-agency')
    const org = ldOf(named).find((n) => n['@id'] === 'https://eno.vn/schools/named-by-agency#school')
    expect(org?.['@type']).toBe('EducationalOrganization')
    expect(org).not.toHaveProperty('url')
    expect(named).not.toContain('javascript:')
    expect(ldOf(await render('agency-co')).find((n) => n['@id'] === 'https://eno.vn/schools/agency-co#school')?.['@type']).toBe('Organization')
  })

  it('a website that would close the <script> stays inside it — the structured data escapes `<` (page.tsx)', async () => {
    const html = await render('script-site')
    expect(html).not.toContain('<script>alert(1)')
    const org = ldOf(html).find((n) => n['@id'] === 'https://eno.vn/schools/script-site#school')
    // The same address the About card links, carried whole.
    expect(org?.url).toBe('https://x.vn/</script><script>alert(1)</script>')
  })

  it('⛔ never a rating — not even on a page with a published review', async () => {
    for (const slug of ['reviewed-school', 'both-school', 'jobs-only-centre']) {
      const html = await render(slug)
      expect(html, slug).not.toMatch(/aggregateRating|ratingValue|"review"/)
    }
  })
})
