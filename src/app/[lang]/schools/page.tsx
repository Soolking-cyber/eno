import type { Metadata } from 'next'
import Link from 'next/link'
import { pageShare } from '@/lib/site-identity'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { localizedHref } from '@/lib/lang-pinned'
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
const TITLE = `Saigon schools ranked by teachers · Đánh giá trường tại TP.HCM | ${SITE_NAME}`
const DESCRIPTION =
  'English centres, international and bilingual schools and recruiters in Ho Chi Minh City, voted on and reviewed by teachers who worked there — with pay ranges and open jobs.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...pageShare({ title: TITLE, description: DESCRIPTION, url: PATH }),
}

export default async function SchoolsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const rows = await listAllSchools()
  const present = new Set(rows.flatMap((r) => r.districts))
  const areas = HCMC_AREAS.filter((a) => present.has(a))
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
              <Bilingual
                en="English centres, international and bilingual schools and teacher recruiters in Ho Chi Minh City. Teachers who worked or interviewed there vote them up or down and say what is good and bad, so the next teacher knows what to expect: pay, hours, management and how contracts really work."
                vi="Trung tâm tiếng Anh, trường quốc tế, trường song ngữ và đơn vị tuyển dụng giáo viên tại TP. Hồ Chí Minh. Giáo viên từng làm việc hoặc phỏng vấn ở đó bình chọn lên hoặc xuống và chia sẻ điểm tốt, điểm chưa tốt, để giáo viên đến sau biết trước: lương, giờ dạy, cách quản lý và hợp đồng thực tế ra sao."
              />
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a href="#how-it-works" className="font-semibold text-accent-foreground hover:underline"><Bilingual en="How the ranking works" vi="Cách xếp hạng hoạt động" /></a>
              <Link href="/c/jobs" className="font-semibold text-accent-foreground hover:underline"><Bilingual en="Browse all jobs" vi="Xem mọi việc làm" /></Link>
              {/* The teacher library's hub (teacher visibility plan, 2026-10-18 — src/lib/teach-guides/site-links.ts): the
                  page teachers reach to vet a school linked nothing in it. English-only guides, so `hrefLang` and the
                  Vietnamese label says so. Marketplace only: eno.forum 308s the library to eno.vn. */}
              {!IS_SERVICES && (
                <Link href={TEACH_HUB_PATH} hrefLang="en" className="font-semibold text-accent-foreground hover:underline"><Bilingual en="Guide to teaching in Vietnam" vi="Cẩm nang dạy học ở Việt Nam (tiếng Anh)" /></Link>
              )}
              <Link href="/schools/suggest" className="font-semibold text-accent-foreground hover:underline"><Bilingual en="Missing a school? Suggest it" vi="Thiếu trường? Đề xuất ngay" /></Link>
              <Link href={AWARDS_PATH} className="font-semibold text-accent-foreground hover:underline"><Bilingual en="Teachers' Choice {y}" vi="Giáo viên bình chọn {y}" values={{ y: String(currentAwardYear()) }} /></Link>
              {/* The school side's way in (teacher visibility plan §4 channel 6; copy approved in the plan, 2026-10-18 —
                  teaching-links.tsx PostJobLink): "Hiring? Post your job ad free on eno", to the post form with Jobs picked.
                  Last in the row, after the teachers' links, at the row's top level — no edition gate around it (the test
                  pins that); the whole prompt is the link, in the row's classes, like "Missing a school? Suggest it".
                  Both editions — the post form is on both. */}
              <PostJobLink row href={localizedHref('/post?category=jobs', lang)} className="font-semibold text-accent-foreground hover:underline" />
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
      </main>
      <Footer />
    </div>
  )
}
