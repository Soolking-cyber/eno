import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { CheckInPanel } from '@/components/teachers/check-in-panel'

// One bilingual title (the /teachers/cover convention: both server languages share the page). noindex: an account page.
export const metadata: Metadata = { title: `Weekly check-in · Kiểm tra hằng tuần | ${SITE_NAME}`, robots: { index: false, follow: false } }

// THE TEACHERS' WEEKLY CHECK-IN (owner, 2026-10-27 — src/lib/teachers/check-in-copy.ts): "still looking for a job / still
// free for cover?", never "sold". The weekly bell row links here (src/lib/teachers/check-in.ts). Both editions: it is the
// teacher's own profile, which both sites show. Loads client-side from /api/teachers/me/check-in: the page itself carries
// no personal data, so it can be static (the job-messages page's pattern).
export default function TeacherCheckInPage() {
  return (
    <div className="flex min-h-page flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-2xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <CheckInPanel />
      </main>
      <Footer />
    </div>
  )
}
