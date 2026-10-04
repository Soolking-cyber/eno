import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/edition'
import { db } from '@/lib/db'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ReviewForm } from '@/components/schools/review-form'

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
  return db.school.findFirst({ where: { slug, status: 'active' }, select: { id: true, slug: true, name: true } })
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
      <main id="main" tabIndex={-1} className="flex-1 max-w-2xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-16">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/schools" className="hover:underline"><Bilingual en="Schools" vi="Trường học" /></Link>
          <span aria-hidden> / </span>
          <Link href={`/schools/${school.slug}`} className="hover:underline">{school.name}</Link>
        </nav>
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
      </main>
      <Footer />
    </div>
  )
}
