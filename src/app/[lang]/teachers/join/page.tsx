import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { headers } from 'next/headers'
import { SITE_NAME } from '@/lib/edition'
import { withShare } from '@/lib/site-identity'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { TeacherForm } from '@/components/teachers/teacher-form'
import { TeacherHostHeader } from '@/components/teachers/teacher-host-header'
import { apexOrigin, isTeacherHost, teacherOrigin } from '@/lib/teachers/host'
import { getGeminiVertex } from '@/lib/gemini'
import { NATIVE_UA_RE } from '@/lib/consent-value'
import { campaignQuery } from '@/components/teachers/teacher-form-rules'
import { facebookSignInCached } from '@/lib/auth/facebook'
import { FacebookSignInSeed } from '@/components/marketplace/facebook-signin-seed'
import type { TeacherStartProps } from '@/components/teachers/teacher-start'
import type { EscapeOffer } from '@/components/teachers/open-in-browser'
import { META_IN_APP_HOSTS, inAppHost, uaOs } from '@/lib/in-app-browser'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL

// The teacher sign-up form (owner, 2026-09-30). Served at teacher.eno.vn/ (proxy.ts rewrite) and at
// eno.vn/teachers/join, which is where the teacher.eno.vn half hands its draft over (URL fragment).
// ONE canonical — the teacher host — so the two URLs never compete in search.
// ⛔ withShare: its OWN Open Graph + X card (staged 2026-10-12, shipped 2026-10-18 with the teacher visibility plan).
// Without them every teacher.eno.vn link — the Facebook-group invites, the guides' "Make a free teacher profile", partner
// kits — previewed as the layout's "eno.vn — free classifieds for expats and locals in Vietnam" (measured live 2026-10-18).
const METADATA: Metadata = withShare({
  title: `Teach in Vietnam — create your teacher profile | ${SITE_NAME}`,
  description: 'Free teacher profile for English and subject teachers in Vietnam: experience, qualifications and an intro video. Schools and others looking for a teacher can message you; your contact stays private until you share it.',
  alternates: { canonical: teacherOrigin(APP_URL) ? `${teacherOrigin(APP_URL)}/` : '/teachers/join' },
})
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Dạy học tại Việt Nam — tạo hồ sơ giáo viên | ${SITE_NAME}` })
}

// `?goal=cover` — arrived from the cover-lessons page (/teachers/cover): the work question reads "Also looking for a
// job? (optional)" and HCMC opens on its districts. Read here, on the server, so the first paint already says it (the
// page is dynamic anyway: it reads the Host header).
// The form opens on step 1 (owner, 2026-10-16: no start screen — teacher-start.tsx); `?import=cv` (a link to the CV
// reader) opens the reading panel instead, decided HERE for the first paint — eno.vn only: the teacher host has no session
// to read under. A session cookie makes that panel wait for the account.
type JoinParams = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)
export default async function TeacherJoinPage({ searchParams }: { searchParams: Promise<JoinParams> }) {
  const h = await headers()
  const draftHost = isTeacherHost(h.get('host'), APP_URL)
  const q = await searchParams
  const goal = one(q.goal) === 'cover' ? 'cover' : null
  const ua = h.get('user-agent') ?? ''
  const imp = one(q.import)
  const cvImport = getGeminiVertex() !== null
  // The sign-in this page opens on its own after the hand-off knows "Continue with Facebook" before it mounts, when the
  // server already has the answer (src/lib/facebook-flag.ts) — never waited for: this render is the hand-off's landing. No
  // answer cached yet: the page asks for itself. Not on the teacher host: nobody signs in there.
  const facebookOn = draftHost ? null : facebookSignInCached()
  // teacher.eno.vn inside Facebook's, Messenger's or Instagram's built-in browser on a phone: step 1 offers the real
  // browser (owner, 2026-10-17: "drive them to actual website not in facebook browser"). Decided from the user agent
  // HERE so the first paint already has it (open-in-browser.tsx). eno.vn's half is never offered it: the hand-off's
  // answers ride in a fragment an Android intent cannot carry.
  const appHost = inAppHost(ua)
  const os = uaOs(ua)
  const escape: EscapeOffer | null = draftHost && appHost && META_IN_APP_HOSTS.has(appHost) && os !== 'other' ? { host: appHost, os } : null
  const start: TeacherStartProps = {
    // No reader configured: no panel either — a stale link opens the doors (or the form), never a dead end.
    importIntent: !draftHost && cvImport && imp === 'cv' ? 'cv' : null,
    // Supabase's session cookie (`sb-<ref>-auth-token`, or its `.0` chunk — never the PKCE verifier), or the app.
    sessionHint: /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/.test(h.get('cookie') ?? '') || NATIVE_UA_RE.test(ua),
    cvImport,
    campaign: campaignQuery(`?${new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])))}`).slice(1),
  }
  return (
    <div className="flex min-h-page flex-col">
      {draftHost ? <TeacherHostHeader apexOrigin={apexOrigin(APP_URL)} /> : <Header />}
      {/* `data-teacher-host`: on teacher.<base> the phone tab bar is hidden (globals.css) — every tab there led off the
          host, and its Account tab opened a sign-in that cannot hold on it. Decided here, on the server, from the Host
          header (this page is dynamic anyway), so the first paint is already right. `data-teacher-form` (both hosts): the
          floating support button stands down over the form (globals.css). */}
      <main id="main" tabIndex={-1} data-teacher-host={draftHost ? '' : undefined} data-teacher-form="" className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <noscript>
          {/* No JS ⇒ no client i18n — deliberately static bilingual copy. */}
          {/* eslint-disable react/jsx-no-literals */}
          <div className="mx-auto mb-6 max-w-xl rounded-xl bg-warning/10 px-4 py-3 text-center text-sm text-foreground">
            <p className="font-semibold">The teacher profile form needs JavaScript enabled.</p>
            <p>Biểu mẫu hồ sơ giáo viên cần bật JavaScript.</p>
          </div>
          {/* eslint-enable react/jsx-no-literals */}
        </noscript>
        {facebookOn !== null && <FacebookSignInSeed on={facebookOn} />}
        <TeacherForm mode="join" draftHost={draftHost} apexOrigin={apexOrigin(APP_URL)} goal={goal} start={start} escape={escape} />
      </main>
      <Footer />
    </div>
  )
}
