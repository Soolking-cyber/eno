import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { SITE_NAME } from '@/lib/edition'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TeacherForm } from '@/components/teachers/teacher-form'
import { TeacherHostHeader } from '@/components/teachers/teacher-host-header'
import { LinkedInSignInFlag } from '@/components/teachers/linkedin-signin-flag'
import { apexOrigin, isTeacherHost, teacherOrigin } from '@/lib/teachers/host'
import { linkedinSignInEnabled } from '@/lib/auth/linkedin'
import { linkedinAvailableForUA } from '@/lib/linkedin-signin'
import { getGeminiVertex } from '@/lib/gemini'
import { IN_APP_UA_RE } from '@/lib/in-app-browser'
import { NATIVE_UA_RE } from '@/lib/consent-value'
import { campaignQuery } from '@/components/teachers/teacher-form-rules'
import type { LinkedInOutcome, TeacherStartProps } from '@/components/teachers/teacher-start'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL

// The teacher sign-up form (owner, 2026-09-30). Served at teacher.eno.vn/ (proxy.ts rewrite) and at
// eno.vn/teachers/join, which is where the teacher.eno.vn half hands its draft over (URL fragment).
// ONE canonical — the teacher host — so the two URLs never compete in search.
export const metadata: Metadata = {
  title: `Teach in Vietnam — create your teacher profile | ${SITE_NAME}`,
  description: 'Free teacher profile for English and subject teachers in Vietnam: experience, qualifications and an intro video. Schools and others looking for a teacher can message you; your contact stays private until you share it.',
  alternates: { canonical: teacherOrigin(APP_URL) ? `${teacherOrigin(APP_URL)}/` : '/teachers/join' },
}

// `?goal=cover` — arrived from the cover-lessons page (/teachers/cover): the work question reads "Also looking for a
// job? (optional)" and HCMC opens on its districts. Read here, on the server, so the first paint already says it (the
// page is dynamic anyway: it reads the Host header).
// THE START SCREEN (owner, 2026-10-15: LinkedIn / "Fill it in from my CV" / "Fill it in myself") is decided HERE, for the
// first paint — never swapped in after hydration over a step 1 a finger is already on (teacher-start.tsx): `?import=`
// opens the reading panel (eno.vn only — the teacher host has no session to read under), `?start=self` (the "myself"
// door, the hand-off) skips the doors, `?li=` says how a LinkedIn sign-in ended, the user agent says whether LinkedIn can
// work here (never in the apps; Facebook/Zalo… browsers are told, on the start screen, to open a real one), and a
// session cookie means "wait for the account" rather than the signed-out doors.
type JoinParams = Record<string, string | string[] | undefined>
const LI_OUTCOMES: readonly LinkedInOutcome[] = ['cancelled', 'failed', 'off', 'notice', 'signed_in', 'email']
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)
export default async function TeacherJoinPage({ searchParams }: { searchParams: Promise<JoinParams> }) {
  const h = await headers()
  const draftHost = isTeacherHost(h.get('host'), APP_URL)
  const q = await searchParams
  const goal = one(q.goal) === 'cover' ? 'cover' : null
  const ua = h.get('user-agent') ?? ''
  const linkedinOn = await linkedinSignInEnabled()
  const imp = one(q.import)
  const li = LI_OUTCOMES.find((o) => o === one(q.li)) ?? null
  const cvImport = getGeminiVertex() !== null
  const start: TeacherStartProps = {
    // No reader configured: no panel either — a stale link opens the doors (or the form), never a dead end.
    importIntent: !draftHost && cvImport && (imp === 'cv' || imp === 'linkedin') ? imp : null,
    startSelf: one(q.start) === 'self',
    li,
    // Supabase's session cookie (`sb-<ref>-auth-token`, or its `.0` chunk — never the PKCE verifier), or the app.
    sessionHint: /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/.test(h.get('cookie') ?? '') || NATIVE_UA_RE.test(ua),
    cvImport,
    linkedin: !linkedinOn ? 'off' : linkedinAvailableForUA(ua) ? 'on' : IN_APP_UA_RE.test(ua) ? 'browser' : 'off',
    mobile: /Mobi|Android|iPhone|iPad|iPod/i.test(ua),
    campaign: campaignQuery(`?${new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])))}`).slice(1),
  }
  return (
    <div className="flex min-h-page flex-col">
      {draftHost ? <TeacherHostHeader apexOrigin={apexOrigin(APP_URL)} /> : <Header />}
      {/* `data-teacher-host`: on teacher.<base> the phone tab bar is hidden (globals.css) — every tab there led off the
          host, and its Account tab opened a sign-in that cannot hold on it. Decided here, on the server, from the Host
          header (this page is dynamic anyway), so the first paint is already right. */}
      <main id="main" tabIndex={-1} data-teacher-host={draftHost ? '' : undefined} className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <noscript>
          {/* No JS ⇒ no client i18n — deliberately static bilingual copy. */}
          {/* eslint-disable react/jsx-no-literals */}
          <div className="mx-auto mb-6 max-w-xl rounded-xl bg-warning/10 px-4 py-3 text-center text-sm text-foreground">
            <p className="font-semibold">The teacher profile form needs JavaScript enabled.</p>
            <p>Biểu mẫu hồ sơ giáo viên cần bật JavaScript.</p>
          </div>
          {/* eslint-enable react/jsx-no-literals */}
        </noscript>
        <LinkedInSignInFlag enabled={linkedinOn} />
        <TeacherForm mode="join" draftHost={draftHost} apexOrigin={apexOrigin(APP_URL)} goal={goal} start={start} />
      </main>
      <Footer />
    </div>
  )
}
