'use client'

// ── THE START SCREEN (owner, 2026-10-15: "at the beginning add the connect linkedin feature … alternatively when they
// upload their cv it should read and upload all necessary parts of teacher profile … linkedin connect is priority") ──
// Three ways into a NEW profile, before step 1: LinkedIn first, then the CV, then "myself".
// ⛔ WHAT LINKEDIN CAN AND CANNOT DO (October 2026, verified against LinkedIn's own documentation): its only self-serve API
// signs a member in and sends a name, an email, a 100px photo link and a language — never jobs, education or skills
// (Apply with LinkedIn takes no new partners; Verified on LinkedIn closed to new developers on 2026-10-14). So the
// LinkedIn door is a one-tap sign-up with the name offered, and then LinkedIn's own "Save to PDF" file, read like a CV
// (POST /api/teachers/me/import) — the way Fiverr, Malt and Indeed onboard from LinkedIn today.
// ⛔ DECIDED ON THE SERVER, FOR THE FIRST PAINT (teachers/join/page.tsx): every door is a real link that works before
// hydration, and the screen is never swapped in over a step 1 a finger is already on (the measured post-hydration tap
// steal). Once hydrated, the doors on this page switch in place, without a reload.

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Briefcase, ChevronRight, FileText, PencilLine } from '@/components/ui/icons'
import { STROKE_UI } from '@/lib/icon-tokens'
import { LinkedInNotice } from '@/components/teachers/linkedin-notice'
import { LINKEDIN_NOTICE_VERSION } from '@/lib/teachers/import-notice'
import { linkedinAvailableHere, linkedinStartPath } from '@/lib/linkedin-signin'

/** Sign in with LinkedIn: `on` here; `browser` — on, but this in-app browser cannot ("open in your browser"); `off`. */
export type LinkedInSignIn = 'on' | 'browser' | 'off'
/** How a LinkedIn sign-in ended (/auth/linkedin/start, /auth/callback) — said on this screen. */
export type LinkedInOutcome = 'cancelled' | 'failed' | 'off' | 'notice' | 'signed_in' | 'email'

export type TeacherStartProps = {
  /** `?import=cv|linkedin` — the reading panel (eno.vn only: the teacher host has no session to read under). */
  importIntent: 'cv' | 'linkedin' | null
  /** `?start=self` — the "myself" door, and the hand-off from teacher.eno.vn: no doors. */
  startSelf: boolean
  li: LinkedInOutcome | null
  /** A session cookie (or the app) came with the request: the account is awaited before any door shows. */
  sessionHint: boolean
  /** Gemini on Vertex is configured (getGeminiVertex): the CV reader exists. */
  cvImport: boolean
  linkedin: LinkedInSignIn
  /** A phone or tablet (user agent): LinkedIn's "Save to PDF" needs a computer, so its door comes after the CV's. */
  mobile: boolean
  /** The campaign tags of this address (campaignQuery, without the `?`) — carried by every door. */
  campaign: string
}

export type Door = 'start' | 'self' | 'cv' | 'linkedin'

/** The door the page opens on: the panel (`?import=`), the form (`?start=self`, or no start screen at all), else the doors. */
export function initialDoor(start: TeacherStartProps | undefined, draftHost: boolean): Door {
  if (!start) return 'self'
  if (start.importIntent && !draftHost) return start.importIntent
  if (start.startSelf || !doorsOffered(start)) return 'self'
  return 'start'
}

/** Anything to choose between? Neither the reader nor LinkedIn: the form opens on step 1, as it always did. */
export const doorsOffered = (s: TeacherStartProps): boolean => s.cvImport || s.linkedin === 'on'
/** …for this visitor: signed in, LinkedIn sign-in has nothing left to do — only the reader makes the doors worth a screen. */
export const doorsFor = (s: TeacherStartProps, signedIn: boolean): boolean => s.cvImport || (s.linkedin === 'on' && !signedIn)

const query = (parts: readonly (string | false | null | undefined)[]): string => {
  const q = parts.filter(Boolean).join('&')
  return q ? `?${q}` : ''
}

/** The doors' addresses — absolute to eno.vn from the teacher host, which cannot read (no session there). */
export function doorHrefs(o: { draftHost: boolean; apexOrigin: string; coverIntent: boolean; campaign: string; cvImport: boolean }) {
  const extra = [o.coverIntent && 'goal=cover', o.campaign.replace(/^\?/, '')]
  const onApex = (q: string) => (o.draftHost ? `${o.apexOrigin}/teachers/join${q}` : q)
  return {
    cv: onApex(query(['import=cv', ...extra])),
    linkedinFile: onApex(query(['import=linkedin', ...extra])),
    // Back from LinkedIn to the panel that reads its PDF — or, with no reader, straight to the form.
    linkedinSignIn: linkedinStartPath(`/teachers/join${query([o.cvImport ? 'import=linkedin' : 'start=self', ...extra])}`, LINKEDIN_NOTICE_VERSION, o.draftHost ? o.apexOrigin : ''),
    self: query(['start=self', ...extra]),
  }
}

type Props = {
  start: TeacherStartProps
  draftHost: boolean
  apexOrigin: string
  coverIntent: boolean
  signedIn: boolean
  /** How a LinkedIn sign-in came back, said here (the form holds it: teacher-form.tsx liOutcome). */
  outcome: string | null
  /** An in-page door, after hydration: the form switches to it without a reload. */
  onDoor: (door: Exclude<Door, 'start'>) => void
}

export function TeacherStart({ start, draftHost, apexOrigin, coverIntent, signedIn, outcome, onDoor }: Props) {
  const { tr } = useLanguage()
  const href = doorHrefs({ draftHost, apexOrigin, coverIntent, campaign: start.campaign, cvImport: start.cvImport })
  // Signed out with LinkedIn sign-in here: the LinkedIn door IS the sign-in (its notice beside it, before the redirect —
  // LinkedIn API Terms 5.2). Signed in — or LinkedIn sign-in off — it is the LinkedIn PDF, read like a CV; never in an
  // in-app browser (a phone, and "Save to PDF" needs a computer — the open-in-your-browser line says what to do).
  const linkedinSignIn = !signedIn && start.linkedin === 'on'
  const linkedinFile = !linkedinSignIn && start.cvImport && start.linkedin !== 'browser'
  // ⛔ THE BROWSER HAS THE LAST WORD (review, 2026-10-16): an iOS home-screen app looks like Safari to the server, but
  // LinkedIn's sign-in cannot finish there (linkedinAvailableHere — the sign-in form's own test). Nothing moves under
  // a finger: the door stays, and a tap on it says why instead of leaving.
  const [linkedinHere, setLinkedinHere] = useState(true)
  const [linkedinRefused, setLinkedinRefused] = useState(false)
  useEffect(() => { if (!linkedinAvailableHere()) setLinkedinHere(false) }, [])
  // A door that stays on this page: switched in place once hydrated (a plain link before that).
  const inPage = (door: Exclude<Door, 'start'>) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onDoor(door)
  }
  const DOOR = 'flex w-full items-start justify-start gap-3 whitespace-normal rounded-2xl bg-tint p-4 text-left font-normal hover:bg-muted'
  const cvDoor = start.cvImport && (
    <Button variant="bare" size="none" className={DOOR} asChild>
      <a href={href.cv} onClick={draftHost ? undefined : inPage('cv')} data-testid="door-cv">
        <DoorBody
          icon={<FileText className="size-5" strokeWidth={STROKE_UI} />}
          title={tr('Fill it in from my CV', 'Điền tự động từ CV của tôi')}
          desc={tr('A PDF, a Word file or a photo of it — we fill in your jobs, degree, certificates and more. You check every answer.', 'PDF, Word hoặc ảnh chụp CV — chúng tôi điền công việc, bằng cấp, chứng chỉ và nhiều mục khác. Bạn kiểm tra từng câu trả lời.')}
        />
      </a>
    </Button>
  )
  const linkedinFileDoor = linkedinFile && (
    <Button variant="bare" size="none" className={DOOR} asChild>
      <a href={href.linkedinFile} onClick={draftHost ? undefined : inPage('linkedin')} data-testid="door-linkedin">
        <DoorBody
          icon={<Briefcase className="size-5" strokeWidth={STROKE_UI} />}
          title={tr('Use my LinkedIn profile', 'Dùng hồ sơ LinkedIn của tôi')}
          desc={start.mobile
            ? tr('On a computer, save your LinkedIn profile as a PDF — we fill in your profile from it.', 'Trên máy tính, lưu hồ sơ LinkedIn dưới dạng PDF — chúng tôi điền hồ sơ từ đó.')
            : tr('Save your LinkedIn profile as a PDF — we fill in your profile from it.', 'Lưu hồ sơ LinkedIn dưới dạng PDF — chúng tôi điền hồ sơ từ đó.')}
        />
      </a>
    </Button>
  )
  return (
    <div className="mx-auto max-w-xl" data-testid="teacher-start">
      <h1 data-screen-heading tabIndex={-1} className="h-title text-foreground outline-none">{tr('Create your teacher profile', 'Tạo hồ sơ giáo viên')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{tr('Free. Schools across Vietnam see your profile; your phone, email and CV stay private until you share them.', 'Miễn phí. Các trường trên toàn Việt Nam xem được hồ sơ; số điện thoại, email và CV được giữ kín đến khi bạn chia sẻ.')}</p>
      {outcome && <p role="alert" className="mt-4 rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm text-warning">{outcome}</p>}
      <h2 className="mt-6 text-sm font-semibold text-foreground">{tr('How would you like to start?', 'Bạn muốn bắt đầu thế nào?')}</h2>
      <div className="mt-3 flex flex-col gap-3">
        {linkedinSignIn && (
          <div className="space-y-2">
            <Button variant="bare" size="none" className={DOOR} asChild>
              <a
                href={href.linkedinSignIn}
                aria-describedby="teacher-start-li-notice"
                data-testid="door-linkedin"
                onClick={(e) => { if (!linkedinHere) { e.preventDefault(); setLinkedinRefused(true) } }}
              >
                <DoorBody
                  icon={<Briefcase className="size-5" strokeWidth={STROKE_UI} />}
                  title={tr('Continue with LinkedIn', 'Tiếp tục với LinkedIn')}
                  desc={start.cvImport
                    ? tr('Sign up in one tap, then add your LinkedIn profile as a PDF — we fill in your profile from it.', 'Đăng ký chỉ với một chạm, rồi thêm hồ sơ LinkedIn dưới dạng PDF — chúng tôi điền hồ sơ từ đó.')
                    : tr('Sign up in one tap with your LinkedIn account.', 'Đăng ký chỉ với một chạm bằng tài khoản LinkedIn.')}
                />
              </a>
            </Button>
            {linkedinRefused && (
              <p role="alert" className="px-1 text-sm text-warning">{tr('LinkedIn sign-in can’t finish in this app. Open eno.vn in Safari or Chrome to use it — or choose another way below.', 'Không thể hoàn tất đăng nhập LinkedIn trong ứng dụng này. Hãy mở eno.vn bằng Safari hoặc Chrome để dùng — hoặc chọn cách khác bên dưới.')}</p>
            )}
            <div className="px-1"><LinkedInNotice id="teacher-start-li-notice" /></div>
          </div>
        )}
        {/* LinkedIn's "Save to PDF" needs a computer: on a phone the CV comes first. */}
        {start.mobile ? <>{cvDoor}{linkedinFileDoor}</> : <>{linkedinFileDoor}{cvDoor}</>}
        <Button variant="bare" size="none" className="flex w-full items-start justify-start gap-3 whitespace-normal rounded-2xl p-4 text-left font-normal hover:bg-muted" asChild>
          <a href={href.self} onClick={inPage('self')} data-testid="door-self">
            <DoorBody
              icon={<PencilLine className="size-5" strokeWidth={STROKE_UI} />}
              title={tr('Fill it in myself', 'Tự điền')}
              desc={tr('About 5 minutes.', 'Khoảng 5 phút.')}
            />
          </a>
        </Button>
        {start.linkedin === 'browser' && !signedIn && (
          // Facebook, Messenger, Zalo… hold no LinkedIn session, and LinkedIn's own "Continue with Google" is refused in
          // them — so no LinkedIn button here, and the way to it said instead (linkedinAvailableForUA).
          <p className="px-1 text-xs text-muted-foreground">{tr('Want to sign up with LinkedIn? Open this page in your phone’s browser (Safari or Chrome) — LinkedIn sign-in doesn’t work inside this app.', 'Muốn đăng ký bằng LinkedIn? Hãy mở trang này trong trình duyệt của điện thoại (Safari hoặc Chrome) — đăng nhập LinkedIn không hoạt động trong ứng dụng này.')}</p>
        )}
      </div>
    </div>
  )
}

function DoorBody({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <>
      <span aria-hidden className="mt-0.5 shrink-0 text-body">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-sm text-body">{desc}</span>
      </span>
      <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </>
  )
}

/** What the page says when a LinkedIn sign-in came back without signing anyone in — on whichever screen it opens. */
export function liLine(li: Exclude<LinkedInOutcome, 'signed_in'>, tr: (en: string, vi: string) => string): string {
  switch (li) {
    case 'cancelled': return tr('LinkedIn sign-in was cancelled. Try again, or choose another way to start.', 'Đã huỷ đăng nhập bằng LinkedIn. Hãy thử lại, hoặc chọn cách khác để bắt đầu.')
    case 'email': return tr('Your LinkedIn email address isn’t confirmed yet. Confirm it on LinkedIn, or choose another way to start.', 'Địa chỉ email LinkedIn của bạn chưa được xác nhận. Hãy xác nhận trên LinkedIn, hoặc chọn cách khác để bắt đầu.')
    case 'off': return tr('LinkedIn sign-in isn’t available right now. Choose another way to start.', 'Hiện chưa thể đăng nhập bằng LinkedIn. Hãy chọn cách khác để bắt đầu.')
    case 'notice': return tr('The words about LinkedIn sign-in were updated. Read them again beside the LinkedIn button, then try again.', 'Nội dung về đăng nhập bằng LinkedIn vừa được cập nhật. Hãy đọc lại bên cạnh nút LinkedIn rồi thử lại.')
    default: return tr('LinkedIn sign-in didn’t work. Try again, or choose another way to start.', 'Đăng nhập bằng LinkedIn không thành công. Hãy thử lại, hoặc chọn cách khác để bắt đầu.')
  }
}
