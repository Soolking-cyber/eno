'use client'

// ── THE START SCREEN (owner, 2026-10-15; LinkedIn removed 2026-10-16 — "remove linkedin login and profile read only from
// cv is enough") ──
// Two ways into a NEW profile, before step 1: the CV (read with Gemini on Vertex — POST /api/teachers/me/import), then
// "myself". With no reader configured there is nothing to choose between: the form opens on step 1, as it always did.
// ⛔ DECIDED ON THE SERVER, FOR THE FIRST PAINT (teachers/join/page.tsx): every door is a real link that works before
// hydration, and the screen is never swapped in over a step 1 a finger is already on (the measured post-hydration tap
// steal). Once hydrated, the doors on this page switch in place, without a reload.

import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { ChevronRight, FileText, PencilLine } from '@/components/ui/icons'
import { STROKE_UI } from '@/lib/icon-tokens'

export type TeacherStartProps = {
  /** `?import=cv` — the reading panel (eno.vn only: the teacher host has no session to read under). */
  importIntent: 'cv' | null
  /** `?start=self` — the "myself" door, and the hand-off from teacher.eno.vn: no doors. */
  startSelf: boolean
  /** A session cookie (or the app) came with the request: the account is awaited before any door shows. */
  sessionHint: boolean
  /** Gemini on Vertex is configured (getGeminiVertex): the CV reader exists. */
  cvImport: boolean
  /** The campaign tags of this address (campaignQuery, without the `?`) — carried by every door. */
  campaign: string
}

export type Door = 'start' | 'self' | 'cv'

/** The door the page opens on: the panel (`?import=cv`), the form (`?start=self`, or no start screen at all), else the doors. */
export function initialDoor(start: TeacherStartProps | undefined, draftHost: boolean): Door {
  if (!start) return 'self'
  if (start.importIntent && !draftHost && start.cvImport) return start.importIntent
  if (start.startSelf || !doorsOffered(start)) return 'self'
  return 'start'
}

/** Anything to choose between? Only when the CV reader exists — otherwise the form opens on step 1. */
export const doorsOffered = (s: TeacherStartProps): boolean => s.cvImport

const query = (parts: readonly (string | false | null | undefined)[]): string => {
  const q = parts.filter(Boolean).join('&')
  return q ? `?${q}` : ''
}

/** The doors' addresses — absolute to eno.vn from the teacher host, which cannot read (no session there). */
export function doorHrefs(o: { draftHost: boolean; apexOrigin: string; coverIntent: boolean; campaign: string }) {
  const extra = [o.coverIntent && 'goal=cover', o.campaign.replace(/^\?/, '')]
  const onApex = (q: string) => (o.draftHost ? `${o.apexOrigin}/teachers/join${q}` : q)
  return {
    cv: onApex(query(['import=cv', ...extra])),
    self: query(['start=self', ...extra]),
  }
}

type Props = {
  start: TeacherStartProps
  draftHost: boolean
  apexOrigin: string
  coverIntent: boolean
  /** An in-page door, after hydration: the form switches to it without a reload. */
  onDoor: (door: Exclude<Door, 'start'>) => void
}

export function TeacherStart({ start, draftHost, apexOrigin, coverIntent, onDoor }: Props) {
  const { tr } = useLanguage()
  const href = doorHrefs({ draftHost, apexOrigin, coverIntent, campaign: start.campaign })
  // A door that stays on this page: switched in place once hydrated (a plain link before that).
  const inPage = (door: Exclude<Door, 'start'>) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onDoor(door)
  }
  return (
    <div className="mx-auto max-w-xl" data-testid="teacher-start">
      <h1 data-screen-heading tabIndex={-1} className="h-title text-foreground outline-none">{tr('Create your teacher profile', 'Tạo hồ sơ giáo viên')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{tr('Free. Schools across Vietnam see your profile; your phone, email and CV stay private until you share them.', 'Miễn phí. Các trường trên toàn Việt Nam xem được hồ sơ; số điện thoại, email và CV được giữ kín đến khi bạn chia sẻ.')}</p>
      <h2 className="mt-6 text-sm font-semibold text-foreground">{tr('How would you like to start?', 'Bạn muốn bắt đầu thế nào?')}</h2>
      <div className="mt-3 flex flex-col gap-3">
        {start.cvImport && (
          <Button variant="bare" size="none" className="flex w-full items-start justify-start gap-3 whitespace-normal rounded-2xl bg-tint p-4 text-left font-normal hover:bg-muted" asChild>
            <a href={href.cv} onClick={draftHost ? undefined : inPage('cv')} data-testid="door-cv">
              <DoorBody
                icon={<FileText className="size-5" strokeWidth={STROKE_UI} />}
                title={tr('Fill it in from my CV', 'Điền tự động từ CV của tôi')}
                desc={tr('A PDF, a Word file or a photo of it — we fill in your jobs, degree, certificates and more. You check every answer.', 'PDF, Word hoặc ảnh chụp CV — chúng tôi điền công việc, bằng cấp, chứng chỉ và nhiều mục khác. Bạn kiểm tra từng câu trả lời.')}
              />
            </a>
          </Button>
        )}
        <Button variant="bare" size="none" className="flex w-full items-start justify-start gap-3 whitespace-normal rounded-2xl p-4 text-left font-normal hover:bg-muted" asChild>
          <a href={href.self} onClick={inPage('self')} data-testid="door-self">
            <DoorBody
              icon={<PencilLine className="size-5" strokeWidth={STROKE_UI} />}
              title={tr('Fill it in myself', 'Tự điền')}
              desc={tr('About 5 minutes.', 'Khoảng 5 phút.')}
            />
          </a>
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{tr('Either way, have a photo of yourself and a short intro video (up to 60 seconds) ready for the last step.', 'Dù chọn cách nào, hãy chuẩn bị một ảnh của bạn và một video giới thiệu ngắn (tối đa 60 giây) cho bước cuối.')}</p>
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
