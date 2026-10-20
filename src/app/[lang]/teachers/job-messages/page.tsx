import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IS_MARKETPLACE, SITE_NAME } from '@/lib/edition'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { JobMessagesPanel } from '@/components/teachers/job-messages-panel'

// One bilingual title (the /teachers/cover convention: both server languages share the page). noindex: an account page.
export const metadata: Metadata = { title: `Job messages · Tin nhắn việc làm | ${SITE_NAME}`, robots: { index: false, follow: false } }

// THE JOB-MESSAGES SWITCH (owner, 2026-10-20) — the teacher's own "Message me matching jobs and cover lessons in eno chat",
// with its notice. The one-time bell invite links here (src/lib/teachers/job-dms/invite.ts), and so does the teacher edit
// form's "Job matches" area. Loads client-side from /api/teachers/me/job-dms: the page itself carries no personal data,
// so it can be static (the teacher edit page's pattern).
export default function TeacherJobMessagesPage() {
  // eno.vn only: the jobs desk runs there (the run and the invite are marketplace-only), so the forum offers no switch for
  // it — the two editions share one database, and an ON given on eno.forum would be messaged on eno.vn (codex, gate 5c).
  if (!IS_MARKETPLACE) notFound()
  return (
    <div className="flex min-h-page flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-2xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <JobMessagesPanel />
      </main>
      <Footer />
    </div>
  )
}
