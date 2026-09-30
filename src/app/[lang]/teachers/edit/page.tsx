import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TeacherForm } from '@/components/teachers/teacher-form'
import { apexOrigin } from '@/lib/teachers/host'

export const metadata: Metadata = { title: `Your teacher profile | ${SITE_NAME}`, robots: { index: false, follow: false } }

// The signed-in teacher's own profile: edit, hide/show, CV, delete. Loads client-side from
// /api/teachers/me (the page itself carries no personal data, so it can be static).
export default function TeacherEditPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <TeacherForm mode="edit" draftHost={false} apexOrigin={apexOrigin(process.env.NEXT_PUBLIC_APP_URL)} />
      </main>
      <Footer />
    </div>
  )
}
