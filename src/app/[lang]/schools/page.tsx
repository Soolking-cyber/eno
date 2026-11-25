import type { Metadata } from 'next'
import Link from 'next/link'
import { pageShare } from '@/lib/site-identity'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { localizedHref } from '@/lib/lang-pinned'
import { langAlternatesFor } from '@/lib/lang-alternates'
import { TEACH_HUB_PATH } from '@/lib/teach-guides/hub-path'
import { PostJobLink } from '@/app/[lang]/c/[category]/teaching-links'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SchoolsBoard } from '@/components/schools/schools-board'
import { SchoolsMethodology } from '@/components/schools/schools-methodology'
import { SchoolsSidebar } from '@/components/schools/schools-sidebar'
import { CoverPromoCard } from '@/components/teachers/cover-promo-card'
import { listAllSchools } from '@/lib/schools/queries'
import { AWARDS_PATH, HCMC_AREAS } from '@/lib/schools/constants'
import { currentAwardYear } from '@/lib/schools/award-rank'
import { ViTwinLink } from '@/components/marketplace/vi-twin-link'

/**
 * /schools — teacher-ranked schools, English centres, international schools and recruiters in Ho Chi
 * Minh City (owner, 2026-10-04). schools.eno.vn 302s here (src/proxy.ts): the vote and review APIs need the
 * eno.vn session, which is host-scoped, so the feature lives on the apex.
 *
 * ⚠️ ISR, NOT PER REQUEST: the HTML is anonymous and up to REVALIDATE old; live counts and the visitor's
 * own votes come from /api/schools/state (no-store) after hydration. Moderation purges this path.
 * ⚠️ NO searchParams HERE — reading them would make every filter combination its own render. The board
 * filters in the browser over the full list, which also keeps every school a crawlable link.
 * ⚠️ NO loading.tsx for this segment: a Suspense boundary above the list hides it from crawlers.
 */
export const revalidate = 300

const PATH = '/schools'
// One title per language since the page has a /vi twin (Seobility, 2026-11-24: the bilingual one measured 664 px against ~580);
// both halves are the bilingual title's own words.
const TITLE = `Saigon schools ranked by teachers | ${SITE_NAME}`
const TITLE_VI = `Đánh giá trường tại TP.HCM | ${SITE_NAME}`
// ≤150 characters (Seobility, 2026-11-24: 1073 px against ~1000).
const DESCRIPTION =
  'English centres, international schools and recruiters in Ho Chi Minh City, rated by teachers who worked there, with pay ranges and open jobs.'

const METADATA: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...pageShare({ title: TITLE, description: DESCRIPTION, url: PATH }),
}

/**
 * ⛔ THE CANONICAL FOLLOWS THE VARIANT (phase-1 /vi families, 2026-11-19 — src/lib/lang-alternates.ts): the Vietnamese
 * one says `/vi/schools`, with reciprocal hreflang; null (eno.forum) keeps METADATA as it was. The title is bilingual
 * and the share card (og:url included) the same on both variants.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params
  const twin = langAlternatesFor(PATH, lang, METADATA.robots)
  if (!twin) return METADATA
  return lang === 'vi' ? { ...METADATA, title: TITLE_VI, alternates: twin } : { ...METADATA, alternates: twin }
}

export default async function SchoolsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const rows = await listAllSchools()
  const present = new Set(rows.flatMap((r) => r.districts))
  const areas = HCMC_AREAS.filter((a) => present.has(a))
  // ONE year for the Teachers' Choice link's label AND its target (plan P1 item 17, 2026-10-20): straight to that year's
  // page — the bare AWARDS_PATH answers a 307 to it (awards/page.tsx). Read per render (ISR, 5 min), so both move on
  // to the new year together.
  const awardYear = currentAwardYear()
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {/* The header's own container (max-w-7xl and its gutters), so the page spans from the logo to the last
          header button on desktop (owner, 2026-10-05); the sidebar takes the width the list does not need. */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 pb-16 pt-8 sm:px-6 lg:px-8">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <h1 className="h-display text-foreground"><Bilingual en="Saigon schools, ranked by teachers" vi="Trường học ở Sài Gòn, do giáo viên xếp hạng" /></h1>
            <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
              {/* One sentence: what a vote means and what the reviews cover, four lines on a 390px phone where two sentences ran six above
                  the links and the search (2026-11-07 audit). The kinds of place the first sentence listed are the type chips over the
                  list, which name and count them; the city is the title's. */}
              <Bilingual
                en="Teachers who worked or interviewed at a school vote it up if they would recommend working there, down if not, and review its pay, hours and contracts."
                vi="Giáo viên từng làm việc hoặc phỏng vấn ở một trường bình chọn lên nếu thấy nên làm việc ở đó, xuống nếu không, và đánh giá về lương, giờ dạy và hợp đồng."
              />
            </p>
            {/* Grouped (2026-11-07 audit: six links of one weight read as a loose cluster beside the search): first the places a
                teacher reads on to, in bold, then the two asks, suggest a school and post a job, in the link ink at text weight. In
                English on a 390px phone the row runs four lines where it ran five. */}
            {/* ⚠️ EACH LINK IS A 24px BOX (WCAG 2.2 AA's minimum target), and the row gap went to 0 so the rows keep their 24px pitch
                (UI climb 2026-11-09, phone UX hunt: ~20px boxes 4px apart wrapped onto four lines on a phone, easy to mis-tap). The
                2026-11-07 grouping, order and weights are unchanged. */}
            <p className="mt-3 flex flex-wrap gap-x-4 text-sm">
              <a href="#how-it-works" className="inline-flex min-h-6 items-center font-semibold text-accent-foreground hover:underline"><Bilingual en="How the ranking works" vi="Cách xếp hạng hoạt động" /></a>
              <Link href={`${AWARDS_PATH}/${awardYear}`} className="inline-flex min-h-6 items-center font-semibold text-accent-foreground hover:underline"><Bilingual en="Teachers' Choice {y}" vi="Giáo viên bình chọn {y}" values={{ y: String(awardYear) }} /></Link>
              {/* The teacher library's hub (teacher visibility plan, 2026-10-18 — src/lib/teach-guides/site-links.ts): the
                  page teachers reach to vet a school linked nothing in it. English-only guides, so `hrefLang` and the
                  Vietnamese label says so. Marketplace only: eno.forum 308s the library to eno.vn. */}
              {!IS_SERVICES && (
                <Link href={TEACH_HUB_PATH} hrefLang="en" className="inline-flex min-h-6 items-center font-semibold text-accent-foreground hover:underline"><Bilingual en="Guide to teaching in Vietnam" vi="Cẩm nang dạy học ở Việt Nam (tiếng Anh)" /></Link>
              )}
              <Link href="/c/jobs" className="inline-flex min-h-6 items-center font-semibold text-accent-foreground hover:underline"><Bilingual en="Browse all jobs" vi="Xem mọi việc làm" /></Link>
              <Link href="/schools/suggest" className="inline-flex min-h-6 items-center text-accent-foreground hover:underline"><Bilingual en="Missing a school? Suggest it" vi="Thiếu trường? Đề xuất ngay" /></Link>
              {/* The school side's way in (teacher visibility plan §4 channel 6; copy approved in the plan, 2026-10-18 —
                  teaching-links.tsx PostJobLink): "Hiring? Post your job ad free on eno", to the post form with Jobs picked.
                  Last in the row, after the teachers' links and "Missing a school? Suggest it", at the row's top level — no edition
                  gate around it (the test pins that); the whole prompt is the link, in that link's classes (the two asks at text
                  weight since 2026-11-07). Both editions — the post form is on both. */}
              <PostJobLink row href={localizedHref('/post?category=jobs', lang)} className="inline-flex min-h-6 items-center text-accent-foreground hover:underline" />
            </p>
            <SchoolsBoard rows={rows} areas={areas} />
          </div>
          {/* Not sticky: the three cards are taller than a 1440×900 laptop's viewport, and a pinned column
              would hide its own last card until the 172-row list ends (diff review). */}
          <aside className="mt-10 lg:mt-0">
            <CoverPromoCard className="mb-6" />
            <SchoolsSidebar rows={rows} lang={lang} />
          </aside>
        </div>
        <SchoolsMethodology />
        <ViTwinLink path="/schools" lang={lang} name="Trường học ở Sài Gòn, do giáo viên xếp hạng" />
      </main>
      <Footer />
    </div>
  )
}
