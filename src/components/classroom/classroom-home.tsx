'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ClipboardCheck, Mic, Sparkles, UserPlus, WifiOff } from '@/components/ui/icons'
import { teacherJoinUrl } from '@/lib/teachers/host'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'
import type { ClassroomMe } from '@/lib/classroom/me'
import { TeacherHome } from './teacher-home'
import { LearnerHome } from './learner-home'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; me: ClassroomMe }

/** /classroom for everyone: a guest's landing, a teacher's class, a learner's practice — or both for one account. */
export function ClassroomHome() {
  const { user, loading } = useAuth()
  if (loading) return <HomeSkeleton />
  if (!user) return <Landing />
  // Keyed by the account: signing in as someone else on this page starts from nothing of the previous account's (C3b review).
  return <SignedInHome key={user.id} />
}

function SignedInHome() {
  const { tr } = useLanguage()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const seq = useRef(0)
  /**
   * ⛔ A REFRESH KEEPS THE PAGE ON SCREEN (2026-10-26, found by the 390px check): it used to drop back to the skeleton,
   * which unmounted the open "Add a student" sheet the moment the seat was saved — the teacher never saw the invite link
   * the sheet was about to show. Only the first load (or a retry after a failure) shows the skeleton; a refresh that
   * fails keeps what is there; and only the newest answer lands.
   */
  const refresh = useCallback(() => {
    const mine = ++seq.current
    setLoad((l) => (l.state === 'ready' ? l : { state: 'loading' }))
    fetch('/api/classroom/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((me: ClassroomMe) => { if (mine === seq.current) setLoad({ state: 'ready', me }) })
      .catch(() => { if (mine === seq.current) setLoad((l) => (l.state === 'ready' ? l : { state: 'error' })) })
  }, [])
  useEffect(() => { refresh() }, [refresh])

  if (load.state === 'loading') return <HomeSkeleton />
  if (load.state === 'error') {
    return (
      <EmptyState
        variant="fault"
        icon={WifiOff}
        title={tr('Your classroom did not load', 'Chưa tải được lớp học của bạn')}
        subtitle={tr('Check your connection and try again.', 'Hãy kiểm tra kết nối và thử lại.')}
        action={<Button onClick={refresh}>{tr('Try again', 'Thử lại')}</Button>}
        className="mt-16"
      />
    )
  }
  const { me } = load
  // Any learner the account owns — one in no class too, so the parent's controls stay reachable (C3a review, codex).
  const learning = me.learners.length > 0
  if (!me.teacher && !learning) return <NoClassYet />
  return (
    <div className="flex flex-col gap-10">
      {learning && <LearnerHome me={me} onChanged={refresh} />}
      {me.teacher && <TeacherHome teacher={me.teacher} onChanged={refresh} secondary={learning} />}
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-4" aria-hidden>
      <Skeleton className="h-8 w-2/3 rounded-xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
    </div>
  )
}

/** A guest: what the classroom is, in three lines, and one way in. */
function Landing() {
  const { tr } = useLanguage()
  const { openSignIn } = useAuth()
  const steps = [
    { icon: Sparkles, en: 'Your teacher makes an AI avatar of their teaching style', vi: 'Giáo viên tạo avatar AI theo phong cách dạy của mình' },
    { icon: Mic, en: 'You talk with it at home — tap the mic and speak', vi: 'Bạn trò chuyện với avatar tại nhà — chạm micro và nói' },
    { icon: ClipboardCheck, en: 'Your teacher sees what you got wrong, and what to practise next', vi: 'Giáo viên thấy bạn sai ở đâu và cần luyện gì tiếp theo' },
  ]
  return (
    <div className="flex flex-col pt-6">
      <section className="flex flex-col items-center text-center">
        <span aria-hidden className="flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Mic className="size-10" strokeWidth={STROKE_DISPLAY} />
        </span>
        <h1 className="h-display mt-6 text-balance">{tr('Practise speaking English, at home', 'Luyện nói tiếng Anh tại nhà')}</h1>
        <p className="mt-3 max-w-md text-base text-body text-pretty">
          {tr(
            "Talk with your teacher's AI avatar between lessons. It listens, answers, and helps your teacher plan what you practise next.",
            'Trò chuyện với avatar AI của giáo viên giữa các buổi học. Avatar lắng nghe, trả lời và giúp giáo viên lên kế hoạch cho buổi luyện tiếp theo.',
          )}
        </p>
        <Button variant="cta" size="lg" className="mt-6 w-full max-w-xs" onClick={() => openSignIn()}>
          {tr('Sign in to start', 'Đăng nhập để bắt đầu')}
        </Button>
      </section>
      <ol className="mt-12 divide-y divide-border border-y border-border">
        {steps.map(({ icon: Icon, en, vi }) => (
          <li key={en} className="flex items-center gap-4 py-4">
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Icon className="size-5" />
            </span>
            <span className="text-sm text-ink-2">{tr(en, vi)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Signed in, no class on either side yet. */
function NoClassYet() {
  const { tr } = useLanguage()
  return (
    <div className="flex flex-col gap-8 pt-6">
      <EmptyState
        icon={UserPlus}
        title={tr('No class yet', 'Chưa có lớp học')}
        subtitle={tr(
          'Open the invite link your teacher sent you — it brings you straight to your class.',
          'Hãy mở đường link mời mà giáo viên đã gửi — link sẽ đưa bạn thẳng vào lớp.',
        )}
      />
      <div className="border-t border-border pt-6 text-center">
        <p className="text-sm text-body">{tr('Are you a teacher?', 'Bạn là giáo viên?')}</p>
        <Link href={teacherJoinUrl()} prefetch={false} className="mt-1 inline-block text-sm font-semibold text-brand hover:underline">
          {tr('Create your teacher profile, then make your avatar', 'Tạo hồ sơ giáo viên, rồi tạo avatar của bạn')}
        </Link>
      </div>
    </div>
  )
}
