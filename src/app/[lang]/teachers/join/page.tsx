import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { SITE_NAME } from '@/lib/edition'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TeacherForm } from '@/components/teachers/teacher-form'
import { TeacherHostHeader } from '@/components/teachers/teacher-host-header'
import { apexOrigin, isTeacherHost, teacherOrigin } from '@/lib/teachers/host'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL

// The teacher sign-up form (owner, 2026-09-30). Served at teacher.eno.vn/ (proxy.ts rewrite) and at
// eno.vn/teachers/join, which is where the teacher.eno.vn half hands its draft over (URL fragment).
// ONE canonical — the teacher host — so the two URLs never compete in search.
export const metadata: Metadata = {
  title: `Teach in Vietnam — create your teacher profile | ${SITE_NAME}`,
  description: 'Free teacher profile for English and subject teachers in Vietnam: experience, qualifications and an intro video. Schools message you; your contact stays private until you share it.',
  alternates: { canonical: teacherOrigin(APP_URL) ? `${teacherOrigin(APP_URL)}/` : '/teachers/join' },
}

export default async function TeacherJoinPage() {
  const draftHost = isTeacherHost((await headers()).get('host'), APP_URL)
  return (
    <div className="flex min-h-screen flex-col">
      {draftHost ? <TeacherHostHeader apexOrigin={apexOrigin(APP_URL)} /> : <Header />}
      <main id="main" tabIndex={-1} className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <noscript>
          {/* No JS ⇒ no client i18n — deliberately static bilingual copy. */}
          {/* eslint-disable react/jsx-no-literals */}
          <div className="mx-auto mb-6 max-w-xl rounded-xl bg-warning/10 px-4 py-3 text-center text-sm text-foreground">
            <p className="font-semibold">The teacher profile form needs JavaScript enabled.</p>
            <p>Biểu mẫu hồ sơ giáo viên cần bật JavaScript.</p>
          </div>
          {/* eslint-enable react/jsx-no-literals */}
        </noscript>
        <TeacherForm mode="join" draftHost={draftHost} apexOrigin={apexOrigin(APP_URL)} />
      </main>
      <Footer />
    </div>
  )
}
