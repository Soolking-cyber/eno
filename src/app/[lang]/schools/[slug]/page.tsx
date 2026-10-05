import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageShare } from '@/lib/site-identity'
import { SITE_NAME } from '@/lib/edition'
import { formatInteger, moneyLocale } from '@/lib/vnd'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Tr } from '@/context/language-context'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExternalLink, PencilLine } from '@/components/ui/icons'
import { SchoolLiveProvider } from '@/components/schools/school-live'
import { SchoolScore } from '@/components/schools/school-stats'
import { SchoolReviews } from '@/components/schools/school-reviews'
import { SchoolJobs } from '@/components/schools/school-jobs'
import { SchoolClaim } from '@/components/schools/school-claim'
import { KindLabel, PayRange, SchoolLogo } from '@/components/schools/school-bits'
import { AwardBadge } from '@/components/schools/award-badge'
import { getSchoolPage, type SchoolPage } from '@/lib/schools/queries'
import { KIND_LABEL, PAY_MAX_AGE_YEARS, PAY_MIN_REPORTS, TAG_LABEL } from '@/lib/schools/constants'

/**
 * /schools/<slug> — one school: the teachers' score, pay ranges, what is good and bad, the reviews and
 * the school's open jobs. ISR like the list (moderation purges it); live counts come from the client.
 * ⚠️ NOINDEX UNTIL IT HAS SOMETHING OF ITS OWN (plan review 2026-10-04): a directory entry with no
 * review and no job is a thin page, hundreds of them would read as a doorway farm.
 * ⚠️ No loading.tsx in this segment, so notFound() is a real 404 (see c/[category]/(index)/page.tsx).
 */
export const revalidate = 300
export async function generateStaticParams() {
  return []
}

type Props = { params: Promise<{ lang: string; slug: string }> }
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

async function load(slug: string) {
  return SLUG.test(slug) && slug.length <= 80 ? getSchoolPage(slug) : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = await load(slug)
  if (!page) return { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
  const { school } = page
  const title = `${school.name}: teacher reviews, pay and jobs | ${SITE_NAME}`
  const description = `What teachers say about ${school.name} (${KIND_LABEL[school.kind].en.toLowerCase()}, Ho Chi Minh City): votes, what is good and bad, pay reported by teachers and open jobs.`
  const path = `/schools/${school.slug}`
  return {
    title,
    description,
    alternates: { canonical: path },
    ...(page.reviews.length || page.jobs.length ? {} : { robots: { index: false, follow: true } }),
    ...pageShare({ title, description, url: path }),
  }
}

export default async function SchoolPageRoute({ params }: Props) {
  const { lang, slug } = await params
  const page = await load(slug)
  if (!page) notFound()
  const { school } = page
  const loc = moneyLocale(lang)
  const summary = lang === 'vi' && school.summaryVi ? school.summaryVi : school.summary
  const host = school.website ? safeHost(school.website) : null
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Schools', item: `${ORIGIN}/schools` },
        { '@type': 'ListItem', position: 2, name: school.name, item: `${ORIGIN}/schools/${school.slug}` },
      ],
    },
  ]

  return (
    <div className="flex min-h-screen flex-col">
      {jsonLd.map((node, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }} />
      ))}
      <Header />
      {/* The header's own container, so the page spans from the logo to the last header button on desktop
          (owner, 2026-10-05). */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 pb-16 pt-6 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/schools" className="hover:underline"><Bilingual en="Schools ranked by teachers" vi="Trường do giáo viên xếp hạng" /></Link>
          <span aria-hidden> / </span>
          <span className="text-foreground">{school.name}</span>
        </nav>

        <SchoolLiveProvider schoolIds={[school.id]} reviewIds={page.reviews.map((r) => r.id)} initial={{ [school.id]: { up: page.up, down: page.down } }}>
          <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
              <SchoolLogo slug={school.slug} logo={school.logo} name={school.name} kind={school.kind} size="lg" />
              <div className="min-w-0">
                <h1 className="h-title text-foreground">{school.name}</h1>
                {page.awards.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-2">{page.awards.map((a) => <AwardBadge key={a.year} year={a.year} rank={a.rank} />)}</p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  <KindLabel kind={school.kind} />
                  {school.districts.length > 0 && <> · {school.districts.slice(0, 3).join(', ')}</>}
                  {school.districts.length > 3 && (
                    <> <Bilingual en="+{n} more areas" vi="+{n} khu vực khác" values={{ n: String(school.districts.length - 3) }} /></>
                  )}
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <SchoolScore schoolId={school.id} schoolName={school.name} />
            </div>
          </header>

          {/* An authored Vietnamese summary when there is one; otherwise the English through the site's own
              translation layer (<Tr>), as listing text is, so a Vietnamese reader is not handed English. */}
          {summary && <p className="mt-5 max-w-prose text-base leading-relaxed text-body">{lang === 'vi' && school.summaryVi ? summary : <Tr text={summary} />}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="cta" asChild>
              <Link href={`/schools/${school.slug}/review`}><PencilLine aria-hidden /> <Bilingual en="Write a review" vi="Viết đánh giá" /></Link>
            </Button>
            {page.jobs.length > 0 && (
              <Button variant="outline" asChild>
                <a href="#jobs">
                  {page.jobs.length === 1
                    ? <Bilingual en="1 open job" vi="1 việc đang tuyển" />
                    : <Bilingual en="{n} open jobs" vi="{n} việc đang tuyển" values={{ n: formatInteger(page.jobs.length, loc) }} />}
                </a>
              </Button>
            )}
            <SchoolClaim schoolId={school.id} schoolName={school.name} />
          </div>

          {/* The facts first in the DOM, so on a phone pay comes before the reviews; on desktop they are the
              right-hand column, beside what teachers wrote. */}
          <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-10">
            <aside className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1">
              <PaySection pay={page.pay} />
              <AboutCard school={school} host={host} />
            </aside>
            <div className="mt-10 flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1 lg:mt-0">
              <TagSection good={page.goodTags} bad={page.badTags} reviews={page.reviews.length} />

              <section aria-labelledby="reviews-h">
                <h2 id="reviews-h" className="text-lg font-bold text-foreground sm:text-xl">
                  <Bilingual en="Reviews from teachers ({n})" vi="Đánh giá từ giáo viên ({n})" values={{ n: formatInteger(page.reviews.length, loc) }} />
                </h2>
                <div className="mt-4">
                  <SchoolReviews reviews={page.reviews} slug={school.slug} schoolName={school.name} />
                </div>
              </section>

              <section id="jobs" aria-labelledby="jobs-h" className="scroll-mt-24">
                <h2 id="jobs-h" className="text-lg font-bold text-foreground sm:text-xl">
                  <Bilingual en="Open jobs ({n})" vi="Việc đang tuyển ({n})" values={{ n: formatInteger(page.jobs.length, loc) }} />
                </h2>
                {page.jobs.length ? (
                  <div className="mt-4"><SchoolJobs jobs={page.jobs} /></div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    <Bilingual en="No open jobs listed right now." vi="Hiện chưa có tin tuyển dụng." />{' '}
                    <Link href="/c/jobs" className="font-semibold text-accent-foreground hover:underline"><Bilingual en="Browse all jobs" vi="Xem mọi việc làm" /></Link>
                  </p>
                )}
              </section>

              <p className="text-sm text-muted-foreground">
                <Bilingual en="Reviews are the opinions of individual teachers, checked by a moderator before they appear." vi="Đánh giá là ý kiến của từng giáo viên, được kiểm duyệt trước khi hiển thị." />{' '}
                {school.logo && (
                  <><Bilingual en="The logo belongs to the school and is shown only to identify it; {site} is not affiliated with it." vi="Logo thuộc về trường và chỉ dùng để nhận diện trường; {site} không liên kết với trường." values={{ site: SITE_NAME }} />{' '}</>
                )}
                <Link href="/schools#how-it-works" className="font-semibold text-accent-foreground hover:underline"><Bilingual en="How the ranking works" vi="Cách xếp hạng hoạt động" /></Link>
              </p>
            </div>
          </div>
        </SchoolLiveProvider>
      </main>
      <Footer />
    </div>
  )
}

/** The directory facts in full: every area (the header names three), the curricula and the school's own site. */
function AboutCard({ school, host }: { school: SchoolPage['school']; host: string | null }) {
  return (
    <section aria-labelledby="about-h" className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <h2 id="about-h" className="text-sm font-semibold text-muted-foreground"><Bilingual en="About" vi="Thông tin" /></h2>
      <dl className="mt-3 flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground"><Bilingual en="Type" vi="Loại" /></dt>
          <dd className="mt-0.5 text-foreground"><KindLabel kind={school.kind} /></dd>
        </div>
        {school.districts.length > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground"><Bilingual en="Areas" vi="Khu vực" /></dt>
            <dd className="mt-0.5 text-foreground">{school.districts.join(', ')}</dd>
          </div>
        )}
        {school.curricula.length > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground"><Bilingual en="Curricula" vi="Chương trình" /></dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">{school.curricula.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}</dd>
          </div>
        )}
        {host && (
          <div>
            <dt className="text-xs text-muted-foreground"><Bilingual en="Website" vi="Trang web" /></dt>
            <dd className="mt-0.5">
              <a href={school.website!} target="_blank" rel="nofollow noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
                {host} <ExternalLink aria-hidden className="size-3.5" />
              </a>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

function safeHost(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

function PaySection({ pay }: { pay: SchoolPage['pay'] }) {
  // ⚠️ `pay` holds ONLY the periods that cleared the floor (queries.ts publicPay): below it the page says
  // nothing period-specific, so it never reveals that a lone reviewer reported pay, or which kind.
  return (
    <section aria-labelledby="pay-h">
      <h2 id="pay-h" className="text-lg font-bold text-foreground sm:text-xl"><Bilingual en="Pay reported by teachers" vi="Mức lương giáo viên báo cáo" /></h2>
      {pay.length === 0 ? (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-body">
          <Bilingual
            en="Not enough pay reports yet. Teachers can add their pay to a review; it is never shown with the review, and a range appears here once {n} teachers have reported."
            vi="Chưa đủ báo cáo lương. Giáo viên có thể ghi mức lương trong đánh giá; mức lương không bao giờ hiển thị cùng đánh giá, và khoảng lương chỉ xuất hiện ở đây khi có {n} giáo viên báo cáo."
            values={{ n: String(PAY_MIN_REPORTS) }}
          />
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {pay.map((p) => (
            <div key={p.period} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <p className="text-sm font-semibold text-muted-foreground">
                {p.period === 'hour' ? <Bilingual en="Hourly" vi="Theo giờ" /> : <Bilingual en="Monthly" vi="Theo tháng" />}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground"><PayRange s={p} /></p>
              <p className="mt-1 text-xs text-muted-foreground">
                <Bilingual en="Middle 60% of reports from {min} or more teachers in the last {years} years, widened to round figures" vi="60% ở giữa các báo cáo của từ {min} giáo viên trở lên trong {years} năm gần nhất, làm tròn ra ngoài" values={{ min: String(PAY_MIN_REPORTS), years: String(PAY_MAX_AGE_YEARS) }} />
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** One tag with how many published reviews picked it; the bar is that share of all reviews. */
function TagRow({ tag, n, of, tone }: { tag: keyof typeof TAG_LABEL; n: number; of: number; tone: 'good' | 'bad' }) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-44 shrink-0 text-sm text-foreground sm:w-56"><Bilingual en={TAG_LABEL[tag].en} vi={TAG_LABEL[tag].vi} /></span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={tone === 'good' ? 'block h-full rounded-full bg-success' : 'block h-full rounded-full bg-warning'} style={{ width: `${Math.max(6, Math.round((n / Math.max(1, of)) * 100))}%` }} />
      </span>
      <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{n}</span>
    </li>
  )
}

function TagSection({ good, bad, reviews }: { good: SchoolPage['goodTags']; bad: SchoolPage['badTags']; reviews: number }) {
  if (!good.length && !bad.length) return null
  return (
    <section aria-labelledby="tags-h">
      <h2 id="tags-h" className="text-lg font-bold text-foreground sm:text-xl"><Bilingual en="What teachers say" vi="Giáo viên nói gì" /></h2>
      <div className="mt-3 grid gap-6 sm:grid-cols-2">
        {good.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-success"><Bilingual en="Good" vi="Điểm tốt" /></h3>
            <ul className="mt-2 flex flex-col gap-2">{good.map(([t, n]) => <TagRow key={t} tag={t} n={n} of={reviews} tone="good" />)}</ul>
          </div>
        )}
        {bad.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-warning"><Bilingual en="Not so good" vi="Điểm chưa tốt" /></h3>
            <ul className="mt-2 flex flex-col gap-2">{bad.map(([t, n]) => <TagRow key={t} tag={t} n={n} of={reviews} tone="bad" />)}</ul>
          </div>
        )}
      </div>
    </section>
  )
}
