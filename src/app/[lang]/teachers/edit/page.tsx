import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { SITE_NAME } from '@/lib/edition'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TeacherForm } from '@/components/teachers/teacher-form'
import { apexOrigin } from '@/lib/teachers/host'

const METADATA: Metadata = { title: `Your teacher profile | ${SITE_NAME}`, robots: { index: false, follow: false } }
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Hồ sơ giáo viên của bạn | ${SITE_NAME}` })
}

// The signed-in teacher's own profile: edit, hide/show, CV, delete. Loads client-side from
// /api/teachers/me (the page itself carries no personal data, so it can be static).
export default function TeacherEditPage() {
  return (
    <div className="flex min-h-page flex-col">
      <Header />
      {/* `data-teacher-form`: the floating support button stands down over the form (globals.css). */}
      <main id="main" tabIndex={-1} data-teacher-form="" className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <TeacherForm mode="edit" draftHost={false} apexOrigin={apexOrigin(process.env.NEXT_PUBLIC_APP_URL)} />
      </main>
      <Footer />
    </div>
  )
}
