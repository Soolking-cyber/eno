import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { CoverZaloPanel } from '@/components/teachers/cover-zalo-panel'

// One bilingual title (the /teachers/job-messages convention). noindex: an account page.
export const metadata: Metadata = { title: `Zalo for urgent cover · Zalo cho dạy thay khẩn | ${SITE_NAME}`, robots: { index: false, follow: false } }

// "ZALO FOR URGENT COVER" (owner, 2026-10-28) — the teacher's own switch, number, notice and the schools that saw it. The
// bell for each reveal and the desk's one-time message link here (src/lib/teachers/zalo.ts). Loads client-side from
// /api/teachers/me/cover-zalo: the page itself carries no personal data, so it can be static. Both editions: teacher
// profiles and their cover lessons are on both, and a school may reveal on either.
export default function TeacherCoverZaloPage() {
  return (
    <div className="flex min-h-page flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-2xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <CoverZaloPanel />
      </main>
      <Footer />
    </div>
  )
}
