'use client'

// ── THE JOB-MESSAGES SWITCH (/teachers/job-messages — owner, 2026-10-20, plan v2 "CONSENT") ──────────────────────────
//   · ONE switch, "Message me matching jobs and cover lessons in eno chat" — ON for every live teacher until they switch
//     it off (since 2026-10-21, src/lib/teachers/job-dms/constants.ts JOB_DM_DEFAULT_ON; the server draws it so) — with its
//     notice beside it (JobMessagesNotice — ⛔ ITS MEANING IS JOB_DM_NOTICE_VERSION, src/lib/teachers/job-dms/constants.ts:
//     change who sends, from where, what is used or where it runs, and that version must be bumped in the same change).
//   · It SAVES ON TOGGLE through its own endpoint (POST /api/teachers/me/job-dms — the rules and the evidence:
//     src/lib/teachers/job-dms/consent.ts). An ON sends the version THIS BUNDLE'S notice is — never one read back from the
//     server — so a page opened before a notice change is refused (409 notice_changed: "reload") instead of recording
//     consent to words the teacher never saw. An OFF sends nothing else and is never refused.
//   · ⛔ NEVER OPTIMISTIC: the switch draws the server's last answer (`current` — ON under the notice in force) and moves
//     only on the next one; while a toggle is on its way it is disabled. After anything but a clean answer the page
//     re-reads the server, and the line says what THAT read shows ("could not save" only when it really differs).
//   · Signed out → a sign-in prompt. No teacher profile → the door to create one (an ON needs a profile to match) — and
//     a switch still ON from a profile since deleted stays offered, so it can always be switched off.
// The page itself carries no personal data and is static (noindex); everything here is read client-side.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { SwitchRow } from '@/components/ui/switch'
import { Loader2 } from '@/components/ui/icons'
import { JOB_DM_NOTICE_VERSION } from '@/lib/teachers/job-dms/constants'

const ENDPOINT = '/api/teachers/me/job-dms'

/** The endpoint's answer (consent.ts JobDmState). */
export type JobDmView = { on: boolean; noticeVersion: string | null; current: boolean; teacher: boolean; paused: boolean }

/** The endpoint's answer, field by field — or null for anything that is not one (a proxy page, an error body). */
export function jobDmViewOf(d: unknown): JobDmView | null {
  if (!d || typeof d !== 'object') return null
  const x = d as Record<string, unknown>
  if (typeof x.on !== 'boolean' || typeof x.current !== 'boolean' || typeof x.teacher !== 'boolean') return null
  if (x.noticeVersion !== null && typeof x.noticeVersion !== 'string') return null
  return { on: x.on, noticeVersion: x.noticeVersion, current: x.current, teacher: x.teacher, paused: x.paused === true }
}

/** A toggle's body: an ON carries the notice version this page SHOWS; an OFF carries nothing else. */
export function jobDmRequest(on: boolean): { on: true; notice: string } | { on: false } {
  return on ? { on: true, notice: JOB_DM_NOTICE_VERSION } : { on: false }
}

/**
 * THE NOTICE — ⛔ ITS MEANING IS JOB_DM_NOTICE_VERSION (above). What it must say, all of it true of the code: who sends
 * (eno.vn's jobs desk, shown as "Alex · eno.vn", automatic messages — compose.ts discloses it in every message), where (eno
 * chat), what (jobs and cover lessons that fit the profile), the sources (run.ts / ingest: Facebook groups, LinkedIn job
 * alerts, posts the team forwards, eno.vn's own listings), where the matching runs (the box — gates.ts on the profile,
 * Laya only on the posts: no AI company outside Vietnam receives the profile), exactly the fields gates.ts reads, the
 * caps (constants.ts JOB_DM_RULES: perDayPerKind 1, jobsPerDm 5, unansweredMax 2), that replies reach the team (the
 * desk's operator inbox), and STOP / the switch. /privacy says the same at length ("Job messages for teachers").
 * The switch's DESCRIPTION (SwitchRow — read with it, never a tap target), as the cover switch's notice is.
 */
export function JobMessagesNotice() {
  const { tr } = useLanguage()
  return (
    <span data-testid="job-dm-notice">
      {tr('Job messages are on for every teacher profile on eno.vn until you switch them off. eno.vn’s jobs desk, shown in chat as “Alex · eno.vn”, may send you automatic messages in eno.vn chat about jobs and cover lessons that fit your teacher profile. We find them in Facebook teaching-job groups, LinkedIn job alerts, posts our team passes on and eno.vn’s own job listings, and match them automatically on eno’s own server in Vietnam — no AI company outside Vietnam receives your profile for this. The matching uses where you live, the places you can teach, the work you want, your subjects, age groups, English level, degree, certificate types, years of experience and expected salary — and, while cover lessons are on, your cover areas, free periods and hourly rate. At most one jobs message and one cover-lesson message a day, with at most 5 jobs in each, and at most two messages until you reply; your replies go to our team. Reply STOP, or switch this off here, at any time. See our', 'Tin nhắn việc làm được bật cho mọi hồ sơ giáo viên trên eno.vn cho đến khi bạn tắt. Bộ phận việc làm của eno.vn, hiển thị trong tin nhắn là “Alex · eno.vn”, có thể gửi cho bạn tin nhắn tự động trong mục tin nhắn của eno.vn về các việc làm và buổi dạy thay phù hợp với hồ sơ giáo viên của bạn. Chúng tôi tìm các tin này trong các nhóm Facebook tuyển giáo viên, thông báo việc làm của LinkedIn, các tin do đội ngũ của chúng tôi chuyển đến và các tin tuyển dụng của chính eno.vn, rồi so khớp tự động trên máy chủ riêng của eno tại Việt Nam — không có công ty AI nào ngoài Việt Nam nhận hồ sơ của bạn cho việc này. Việc so khớp dùng nơi bạn đang sống, các nơi bạn có thể dạy, loại công việc bạn muốn, môn dạy, độ tuổi học viên, trình độ tiếng Anh, bằng cấp, loại chứng chỉ, số năm kinh nghiệm và mức lương mong muốn — và, khi bạn bật dạy thay, các khu vực dạy thay, các buổi rảnh và mức phí theo giờ. Tối đa một tin nhắn việc làm và một tin nhắn dạy thay mỗi ngày, mỗi tin tối đa 5 việc, và tối đa hai tin nhắn cho đến khi bạn trả lời; tin trả lời của bạn được gửi đến đội ngũ của chúng tôi. Bạn có thể trả lời STOP, hoặc tắt mục này tại đây, bất cứ lúc nào. Xem')}{' '}
      <Link href="/privacy" className="underline">{tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}</Link>.
    </span>
  )
}

/** The line after a refusal or a failure — '' for none. */
type Line = '' | 'notice' | 'rate_limited' | 'failed'

function Loading() {
  return <div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
}

/**
 * The page's body. Keyed by the ACCOUNT (a sign-in, a sign-out or another account remounts it), so nothing of one account
 * — its switch, a line, a toggle on its way — is ever shown to, or saved for, the next.
 */
export function JobMessagesPanel() {
  const { user } = useAuth()
  return <JobMessagesFor key={user?.id ?? 'guest'} />
}

function JobMessagesFor() {
  const { tr } = useLanguage()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const uid = user?.id ?? null
  // undefined = not read yet; null = the read failed.
  const [view, setView] = useState<JobDmView | null | undefined>(undefined)
  const [reloads, setReloads] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [line, setLine] = useState<Line>('')

  const read = useCallback(async (): Promise<JobDmView | null> => {
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      return res.ok ? jobDmViewOf(await res.json().catch(() => null)) : null
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!uid) return
    let live = true
    void read().then((v) => { if (live) setView(v) })
    return () => { live = false }
  }, [uid, read, reloads])

  const toggle = async (next: boolean) => {
    if (busyRef.current || !uid || !view) return
    busyRef.current = true
    setBusy(true)
    setLine('')
    // Not saved — or not KNOWN to be: read the truth, and say "could not save" only when it differs from the tap.
    const reread = async () => {
      const fresh = await read()
      if (fresh) setView(fresh)
      // An OFF is saved when the grant is gone (`on`), not when the switch merely draws OFF — a paused or lapsed ON
      // already draws OFF (opus, gate 5a).
      setLine(fresh && (next ? fresh.current === true || !fresh.teacher : fresh.on === false) ? '' : 'failed')
    }
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobDmRequest(next)) })
      const d: unknown = await res.json().catch(() => null)
      const saved = res.ok ? jobDmViewOf(d) : null
      if (saved) { setView(saved); return }
      const code = d && typeof d === 'object' ? (d as { error?: unknown }).error : null
      // Refused before anything was written: the switch still shows the last answer.
      if (res.status === 409 && code === 'notice_changed') { setLine('notice'); return }
      if (res.status === 429) { setLine('rate_limited'); return }
      await reread()
    } catch {
      await reread()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (authLoading) return <Loading />
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="h-title text-foreground">{tr('Job messages', 'Tin nhắn việc làm')}</h1>
        <p className="mt-2 text-sm text-body">{tr('Sign in to choose whether eno.vn may message you about jobs and cover lessons that fit your teacher profile.', 'Đăng nhập để chọn có cho phép eno.vn nhắn tin cho bạn về các việc làm và buổi dạy thay phù hợp với hồ sơ giáo viên hay không.')}</p>
        <Button variant="cta" className="mt-4" onClick={() => openSignIn({ note: tr('Sign in to choose your job messages.', 'Đăng nhập để chọn nhận tin nhắn việc làm.') })}>{tr('Sign in', 'Đăng nhập')}</Button>
      </div>
    )
  }
  if (view === undefined) return <Loading />
  if (view === null) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="h-title text-foreground">{tr('Job messages', 'Tin nhắn việc làm')}</h1>
        <p className="mt-2 text-sm text-body">{tr('We could not load your choice. Check your connection and try again.', 'Chúng tôi không tải được lựa chọn của bạn. Hãy kiểm tra kết nối và thử lại.')}</p>
        <Button variant="secondary" className="mt-4" onClick={() => { setView(undefined); setReloads((n) => n + 1) }}>{tr('Try again', 'Thử lại')}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr('Job messages', 'Tin nhắn việc làm')}
        meta={tr('Jobs and cover lessons that fit your teacher profile, sent to you in eno chat.', 'Việc làm và buổi dạy thay phù hợp với hồ sơ giáo viên, gửi cho bạn qua tin nhắn eno.')}
      />

      {!view.teacher && (
        <section className="rounded-2xl bg-tint p-5 text-center">
          <h2 className="text-base font-semibold text-foreground">{tr('You don’t have a teacher profile yet', 'Bạn chưa có hồ sơ giáo viên')}</h2>
          <p className="mt-1 text-sm text-body">{tr('Job messages are matched to your teacher profile, and they are on once it is live. Create one — it is free.', 'Tin nhắn việc làm được so khớp với hồ sơ giáo viên của bạn và được bật khi hồ sơ được hiển thị. Hãy tạo hồ sơ — miễn phí.')}</p>
          <Button variant="cta" className="mt-4" asChild><Link href="/teachers/join">{tr('Create my teacher profile', 'Tạo hồ sơ giáo viên')}</Link></Button>
        </section>
      )}

      {(view.teacher || view.on) && (
        <div className="space-y-3">
          {view.teacher && view.paused && (
            <Alert tone="warning" appearance="flat" size="md" role="status">
              {tr('Job messages are paused after one of your replies. Switch this on again — or tap “Keep sending jobs” in the chat — to get them again.', 'Tin nhắn việc làm đang tạm dừng sau một tin trả lời của bạn. Hãy bật lại mục này — hoặc chạm “Gửi tiếp việc làm” trong cuộc trò chuyện — để nhận lại.')}
            </Alert>
          )}
          {/* A switch that draws OFF while a grant is still on record — paused, given under an older notice, or kept with no
              profile left — needs its own way OFF: tapping the switch would only grant it again (opus, gates 3n + 5a). */}
          {view.on && !view.current && (
            <Button variant="link" size="none" type="button" className="text-sm font-semibold" disabled={busy} onClick={() => { void toggle(false) }}>
              {tr('Stop job messages completely', 'Dừng hẳn tin nhắn việc làm')}
            </Button>
          )}
          {view.teacher && view.on && !view.paused && !view.current && (
            <Alert tone="warning" appearance="flat" size="md" role="status">
              {tr('The notice below has changed since you switched this on. Switch it on again to keep getting job messages.', 'Thông báo bên dưới đã thay đổi kể từ khi bạn bật mục này. Hãy bật lại để tiếp tục nhận tin nhắn việc làm.')}
            </Alert>
          )}
          <SwitchRow
            id="job-dms-switch"
            checked={view.current}
            onChange={(next) => { void toggle(next) }}
            // No profile left: nothing to switch ON (the save would 404) — "Stop job messages completely" stays (opus, 5b).
            disabled={busy || (!view.teacher && !view.current)}
            label={tr('Message me matching jobs and cover lessons in eno chat', 'Nhắn cho tôi các việc làm và buổi dạy thay phù hợp qua tin nhắn eno')}
            description={<JobMessagesNotice />}
          />
          {line === 'notice' && (
            <p role="alert" className="text-sm text-destructive">
              {tr('This page is out of date: the notice changed while it was open. Reload the page to read it, then switch this on.', 'Trang này đã cũ: thông báo đã thay đổi khi trang đang mở. Hãy tải lại trang để đọc, rồi bật lại mục này.')}{' '}
              <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={() => window.location.reload()}>{tr('Reload', 'Tải lại')}</Button>
            </p>
          )}
          {line === 'rate_limited' && <p role="alert" className="text-sm text-destructive">{tr('Too many changes in a short time — try again in a little while.', 'Bạn đã thay đổi quá nhiều lần trong thời gian ngắn — hãy thử lại sau ít phút.')}</p>}
          {line === 'failed' && <p role="alert" className="text-sm text-destructive">{tr('We could not save your choice. Check your connection and try again.', 'Chúng tôi không lưu được lựa chọn của bạn. Hãy kiểm tra kết nối và thử lại.')}</p>}
        </div>
      )}

      {view.teacher && (
        <p className="text-sm">
          <Link href="/teachers/edit" className="font-semibold text-accent-foreground hover:underline">{tr('Edit my teacher profile', 'Sửa hồ sơ giáo viên')}</Link>
        </p>
      )}
    </div>
  )
}
