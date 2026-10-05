import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/edition'
import { db } from '@/lib/db'
import { BreadcrumbNav } from '@/components/schools/breadcrumb-nav'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ReviewForm } from '@/components/schools/review-form'
import { SchoolLogo } from '@/components/schools/school-bits'
import { schoolLogo } from '@/lib/schools/logos'
import type { SchoolKind } from '@/lib/schools/constants'

/**
 * /schools/<slug>/review — write or edit the signed-in teacher's review. The shell is static per school;
 * everything about the teacher (signed in? an existing review?) is fetched by the client form.
 * Never indexed: it is a form, and its canonical content is the school page.
 */
export const revalidate = 300
export async function generateStaticParams() {
  return []
}

type Props = { params: Promise<{ lang: string; slug: string }> }
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

async function load(slug: string) {
  if (!SLUG.test(slug) || slug.length > 80) return null
  return db.school.findFirst({ where: { slug, status: 'active' }, select: { id: true, slug: true, name: true, kind: true } })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const school = await load((await params).slug)
  return {
    title: school ? `Review ${school.name} | ${SITE_NAME}` : `Not found | ${SITE_NAME}`,
    robots: { index: false, follow: false },
  }
}

export default async function SchoolReviewPage({ params }: Props) {
  const school = await load((await params).slug)
  if (!school) notFound()
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {/* The header's own container (owner, 2026-10-05): the form, and beside it on desktop what a useful
          review covers. */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 pb-16 pt-6 sm:px-6 lg:px-8">
        <BreadcrumbNav className="text-sm text-muted-foreground">
          <Link href="/schools" className="hover:underline"><Bilingual en="Schools" vi="Trường học" /></Link>
          <span aria-hidden> / </span>
          <Link href={`/schools/${school.slug}`} className="hover:underline">{school.name}</Link>
        </BreadcrumbNav>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-10">
          <div className="min-w-0">
            <h1 className="mt-3 h-title text-foreground">
              <Bilingual en="Review {name}" vi="Đánh giá {name}" values={{ name: school.name }} />
            </h1>
            <p className="mt-2 text-sm text-body">
              <Bilingual
                en="Help the next teacher: what is it really like to work here?"
                vi="Giúp giáo viên đến sau: làm việc ở đây thực sự thế nào?"
              />
            </p>
            <div className="mt-6">
              <ReviewForm schoolId={school.id} slug={school.slug} schoolName={school.name} />
            </div>
          </div>
          <aside className="mt-10 flex flex-col gap-4 lg:mt-3">
            <Link href={`/schools/${school.slug}`} className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border hover:bg-tint">
              <SchoolLogo slug={school.slug} logo={schoolLogo(school.slug)} name={school.name} kind={school.kind as SchoolKind} />
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">{school.name}</span>
            </Link>
            <section aria-labelledby="review-tips-h" className="rounded-2xl bg-tint p-4">
              <h2 id="review-tips-h" className="text-base font-bold text-foreground">
                <Bilingual en="What helps the next teacher" vi="Điều giúp giáo viên đến sau" />
              </h2>
              <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-body">
                <li><Bilingual en="Pay and how it was paid: on time, in full, per hour or per month" vi="Lương và cách trả: đúng hạn, đủ, theo giờ hay theo tháng" /></li>
                <li><Bilingual en="Hours, class sizes and last-minute changes" vi="Giờ dạy, sĩ số lớp và các thay đổi phút chót" /></li>
                <li><Bilingual en="The contract and the work permit: what was promised and what happened" vi="Hợp đồng và giấy phép lao động: những gì được hứa và thực tế ra sao" /></li>
                <li><Bilingual en="Management, training and support" vi="Cách quản lý, đào tạo và hỗ trợ" /></li>
              </ul>
              <p className="mt-3 text-sm leading-relaxed text-body">
                <Bilingual
                  en="Your name is never shown, and a moderator reads every review before it appears."
                  vi="Tên của bạn không bao giờ hiển thị, và mọi đánh giá đều được kiểm duyệt trước khi hiển thị."
                />
              </p>
            </section>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  )
}
