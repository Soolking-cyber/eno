import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SuggestForm } from '@/components/schools/suggest-form'

/**
 * /schools/suggest — a teacher asks us to add a school that is not listed (owner, 2026-10-05). A moderator adds
 * it (admin → Suggestions); the form and the teacher's own suggestions are client islands over
 * /api/schools/suggest. Static: nothing on the page is per visitor until it hydrates.
 * noindex: a form is not something to find in search.
 */
export const metadata: Metadata = {
  title: `Suggest a school · Đề xuất trường | ${SITE_NAME}`,
  description: `Ask ${SITE_NAME} to add a school, English centre or recruiter in Ho Chi Minh City to the teacher-ranked directory.`,
  alternates: { canonical: '/schools/suggest' },
  robots: { index: false, follow: true },
}

export default function SuggestSchoolPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 pb-16 pt-8 sm:px-6 lg:px-8">
        <Link href="/schools" className="text-sm font-semibold text-accent-foreground hover:underline">
          <Bilingual en="← All schools" vi="← Tất cả trường" />
        </Link>
        <h1 className="h-display mt-3 text-foreground"><Bilingual en="Suggest a school" vi="Đề xuất một trường" /></h1>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
          <Bilingual
            en="Taught at a school, English centre or recruiter in Ho Chi Minh City that is not on the list? Tell us, and a moderator adds it, usually within a few days. You can then vote on it and review it."
            vi="Bạn từng dạy ở một trường, trung tâm tiếng Anh hay đơn vị tuyển dụng tại TP. Hồ Chí Minh chưa có trong danh sách? Hãy cho chúng tôi biết, kiểm duyệt viên sẽ thêm vào, thường trong vài ngày. Sau đó bạn có thể bình chọn và đánh giá nơi đó."
          />
        </p>
        <SuggestForm />
      </main>
      <Footer />
    </div>
  )
}
