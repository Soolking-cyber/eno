'use client'

// ── THE TEACHERS' WEEKLY CHECK-IN (/teachers/check-in — owner, 2026-10-27; why: src/lib/teachers/check-in-copy.ts) ──────
//   · ONE question, in the teacher's own terms (a job, private students, cover lessons), and three answers:
//       "Yes, I'm still available" — POST /api/teachers/me/check-in: the week's answer is recorded, nothing else moves;
//       "Change my details" — the edit form;
//       "Not available now — hide my profile" — ⛔ BEHIND A CONFIRM that says what it does, then the existing Visibility
//       switch (PATCH /api/teachers/me/status). Never "sold": the goods review's "Tick anything that sold" took four
//       teachers' profiles down when they meant "yes".
//   · ⛔ NEVER OPTIMISTIC: the page shows the server's answer — a "yes" refused (the profile was hidden or held meanwhile)
//     re-reads the state and shows it, never a "thanks".
//   · Signed out → a sign-in prompt. No teacher profile → the door to create one. Hidden or not live → what that means and
//     the way to the edit form (showing it again is the Visibility switch's job, behind its gates).
// The page itself carries no personal data and is static (noindex); everything here is read client-side.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Check, Loader2 } from '@/components/ui/icons'
import { checkInQuestion } from '@/lib/teachers/check-in-copy'
import { coverSlotLabel } from '@/lib/teachers/cover'
import { formatCalendarDay } from '@/lib/calendar-day'

const ENDPOINT = '/api/teachers/me/check-in'

/** The endpoint's answer (check-in.ts CheckInView). */
export type CheckInViewData = {
  teacher: boolean; live: boolean; hidden: boolean; jobTypes: string[]; coverOpen: boolean; coverSlots: string[]; confirmedAt: string | null
}

/** The endpoint's answer, field by field — or null for anything that is not one (a proxy page, an error body). */
export function checkInViewOf(d: unknown): CheckInViewData | null {
  if (!d || typeof d !== 'object') return null
  const x = d as Record<string, unknown>
  if (typeof x.teacher !== 'boolean' || typeof x.live !== 'boolean' || typeof x.hidden !== 'boolean' || typeof x.coverOpen !== 'boolean') return null
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  return {
    teacher: x.teacher, live: x.live, hidden: x.hidden, coverOpen: x.coverOpen,
    jobTypes: strings(x.jobTypes), coverSlots: strings(x.coverSlots),
    confirmedAt: typeof x.confirmedAt === 'string' ? x.confirmedAt : null,
  }
}

/** The work the profile offers, as the taxonomy's jobType facet words it (taxonomy.ts, Teachers › Looking for). */
const JOB_TYPE_LABELS: Record<string, { en: string; vi: string }> = {
  fulltime: { en: 'Full-time', vi: 'Toàn thời gian' },
  parttime: { en: 'Part-time', vi: 'Bán thời gian' },
  private: { en: 'Private tutoring', vi: 'Gia sư' },
}

/** The line after a refusal or a failure — '' for none. */
type Line = '' | 'not_live' | 'rate_limited' | 'failed'
/** What the last answer did — shown until the next one. */
type Done = '' | 'confirmed' | 'hidden'

function Loading() {
  return <div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
}

/** Keyed by the ACCOUNT, so nothing of one account — its answer, a line, a request on its way — reaches the next. */
export function CheckInPanel() {
  const { user } = useAuth()
  return <CheckInFor key={user?.id ?? 'guest'} />
}

function CheckInFor() {
  const { tr, lang } = useLanguage()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const uid = user?.id ?? null
  // undefined = not read yet; null = the read failed.
  const [view, setView] = useState<CheckInViewData | null | undefined>(undefined)
  const [reloads, setReloads] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [line, setLine] = useState<Line>('')
  const [done, setDone] = useState<Done>('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const lineIsNotLive = useRef(false)

  const read = useCallback(async (): Promise<CheckInViewData | null> => {
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      return res.ok ? checkInViewOf(await res.json().catch(() => null)) : null
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

  /**
   * One request at a time; whatever happens, the page ends on the server's state. ⚠️ A HIDE THAT WENT THROUGH WHILE THE
   * RE-READ FAILED must not leave the old live view under "Your profile is hidden" — with a "Yes" still offered (codex +
   * opus, gate): the view is then drawn as the hide left it. A 409 is "not live" for the "yes" only (hiding is never refused).
   */
  const act = async (send: () => Promise<Response>, onOk: Done) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setLine('')
    let ok = false
    lineIsNotLive.current = false
    try {
      const res = await send()
      ok = res.ok
      lineIsNotLive.current = !ok && res.status === 409 && onOk === 'confirmed'
      if (ok) { setDone(onOk); setConfirmOpen(false) } else setLine(res.status === 429 ? 'rate_limited' : lineIsNotLive.current ? 'not_live' : 'failed')
    } catch {
      setLine('failed')
    } finally {
      const fresh = await read()
      if (fresh) setView(fresh)
      else if (ok && onOk === 'hidden') setView((v) => (v ? { ...v, live: false, hidden: true } : v))
      // …and a "yes" refused as not live (409) with the re-read failed: no live question or "Yes" left beside the line (codex, gate).
      else if (!ok && onOk === 'confirmed' && lineIsNotLive.current) setView((v) => (v ? { ...v, live: false } : v))
      busyRef.current = false
      setBusy(false)
    }
  }
  const confirm = () => act(() => fetch(ENDPOINT, { method: 'POST' }), 'confirmed')
  const hide = () => act(() => fetch('/api/teachers/me/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'hidden' }) }), 'hidden')

  const title = tr('Weekly check-in', 'Kiểm tra hằng tuần')
  if (authLoading) return <Loading />
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="h-title text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-body">{tr('Sign in to tell schools you are still available to teach.', 'Đăng nhập để cho các trường biết bạn vẫn sẵn sàng đi dạy.')}</p>
        <Button variant="cta" className="mt-4" onClick={() => openSignIn({ note: tr('Sign in to answer your weekly check-in.', 'Đăng nhập để trả lời câu hỏi hằng tuần.') })}>{tr('Sign in', 'Đăng nhập')}</Button>
      </div>
    )
  }
  if (view === undefined) return <Loading />
  if (view === null) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="h-title text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-body">{tr('We could not load your teacher profile. Check your connection and try again.', 'Chúng tôi không tải được hồ sơ giáo viên của bạn. Hãy kiểm tra kết nối và thử lại.')}</p>
        <Button variant="secondary" className="mt-4" onClick={() => { setView(undefined); setReloads((n) => n + 1) }}>{tr('Try again', 'Thử lại')}</Button>
      </div>
    )
  }

  const q = checkInQuestion(view)
  const editLink = <Button variant="secondary" asChild><Link href="/teachers/edit">{tr('Change my details', 'Thay đổi thông tin')}</Link></Button>

  return (
    <div className="space-y-5">
      <PageHeader title={title} meta={tr('Schools see teachers who are still available. One question, once a week.', 'Các trường thấy những giáo viên vẫn sẵn sàng đi dạy. Một câu hỏi, mỗi tuần một lần.')} />

      {!view.teacher && (
        <section className="rounded-2xl bg-tint p-5 text-center">
          <h2 className="text-base font-semibold text-foreground">{tr('You don’t have a teacher profile yet', 'Bạn chưa có hồ sơ giáo viên')}</h2>
          <Button variant="cta" className="mt-4" asChild><Link href="/teachers/join">{tr('Create my teacher profile', 'Tạo hồ sơ giáo viên')}</Link></Button>
        </section>
      )}

      {view.teacher && done === 'hidden' && (
        <Alert tone="info" appearance="flat" size="md" role="status">
          {tr('Your profile is hidden. Schools can’t find it until you show it again — from your profile, any time. Nothing was deleted.', 'Hồ sơ của bạn đã được ẩn. Các trường sẽ không tìm thấy hồ sơ cho đến khi bạn hiển thị lại — trong hồ sơ của bạn, bất cứ lúc nào. Không có gì bị xóa.')}
        </Alert>
      )}

      {view.teacher && !view.live && done !== 'hidden' && (
        <Alert tone="warning" appearance="flat" size="md" role="status">
          {view.hidden
            ? tr('Your profile is hidden, so schools can’t find it. You can show it again from your profile.', 'Hồ sơ của bạn đang ẩn nên các trường không tìm thấy. Bạn có thể hiển thị lại trong hồ sơ của mình.')
            : tr('Your profile isn’t visible to schools right now. Open your profile to see why.', 'Hồ sơ của bạn hiện không hiển thị với các trường. Mở hồ sơ để xem lý do.')}
        </Alert>
      )}

      {view.teacher && view.live && (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="h-title text-foreground">{tr(q.en, q.vi)}</h2>
          <dl className="space-y-1 text-sm text-body">
            {view.jobTypes.length > 0 && (
              <div><dt className="inline font-semibold text-foreground">{tr('Looking for', 'Tìm việc')}: </dt><dd className="inline">{view.jobTypes.map((j) => (JOB_TYPE_LABELS[j] ? tr(JOB_TYPE_LABELS[j].en, JOB_TYPE_LABELS[j].vi) : j)).join(' · ')}</dd></div>
            )}
            {view.coverOpen && view.coverSlots.length > 0 && (
              <div><dt className="inline font-semibold text-foreground">{tr('Cover lessons', 'Dạy thay')}: </dt><dd className="inline">{view.coverSlots.map((s) => coverSlotLabel(s, lang)).join(' · ')}</dd></div>
            )}
          </dl>
          {done === 'confirmed' ? (
            <Alert tone="success" appearance="flat" size="md" role="status">
              <Check className="inline size-4" /> {tr('Thanks — your profile stays up. We’ll ask again next week.', 'Cảm ơn bạn — hồ sơ của bạn vẫn hiển thị. Tuần sau chúng tôi sẽ hỏi lại.')}
            </Alert>
          ) : (
            view.confirmedAt && <p className="text-xs text-muted-foreground">{tr('Last answered', 'Trả lời lần cuối')}: {formatCalendarDay(view.confirmedAt, lang)}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {done !== 'confirmed' && (
              <Button variant="cta" loading={busy} disabled={busy} onClick={() => { void confirm() }}>
                {tr('Yes, I’m still available', 'Có, tôi vẫn sẵn sàng')}
              </Button>
            )}
            {editLink}
          </div>
          <AlertDialog open={confirmOpen} onOpenChange={(next) => { if (!busy) setConfirmOpen(next) }}>
            <AlertDialogTrigger render={<Button variant="link" size="none" type="button" className="text-sm font-semibold text-muted-foreground" />}>
              {tr('Not available now — hide my profile', 'Hiện chưa sẵn sàng — ẩn hồ sơ của tôi')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr('Hide your teacher profile?', 'Ẩn hồ sơ giáo viên của bạn?')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tr('Schools won’t find your profile or be able to start a new chat about it until you show it again from your profile. Nothing is deleted, and you can show it again any time.', 'Các trường sẽ không tìm thấy hồ sơ của bạn hay bắt đầu cuộc trò chuyện mới về hồ sơ cho đến khi bạn hiển thị lại trong hồ sơ của mình. Không có gì bị xóa, và bạn có thể hiển thị lại bất cứ lúc nào.')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr('Keep it visible', 'Vẫn hiển thị')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" disabled={busy} onClick={() => { void hide() }}>{tr('Hide my profile', 'Ẩn hồ sơ')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      )}

      {view.teacher && !view.live && <div>{editLink}</div>}

      {line === 'not_live' && <p role="alert" className="text-sm text-destructive">{tr('Your profile isn’t visible right now, so there is nothing to confirm. Open your profile to see why.', 'Hồ sơ của bạn hiện không hiển thị nên không có gì để xác nhận. Mở hồ sơ để xem lý do.')}</p>}
      {line === 'rate_limited' && <p role="alert" className="text-sm text-destructive">{tr('Too many answers in a short time — try again in a little while.', 'Bạn đã trả lời quá nhiều lần trong thời gian ngắn — hãy thử lại sau ít phút.')}</p>}
      {line === 'failed' && <p role="alert" className="text-sm text-destructive">{tr('We could not save your answer. Check your connection and try again.', 'Chúng tôi không lưu được câu trả lời của bạn. Hãy kiểm tra kết nối và thử lại.')}</p>}
    </div>
  )
}
