'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ExternalLink, Link2, WifiOff } from '@/components/ui/icons'
import { escapeInAppBrowser, inAppHost, inAppHostName, type InAppHost } from '@/lib/in-app-browser'
import { isInviteCodeShape, normalizeInviteCode } from '@/lib/classroom/invite-code'
import { ADULT_AGE, CHILD_ASSENT_AGE } from '@/lib/classroom/constants'
import {
  ADULT_ATTESTATION, ADULT_NOTICE_VERSION, ASSENT_TEXT, ASSENT_VERSION, ASSENT_YES, GUARDIAN_ATTESTATION, GUARDIAN_NOTICE_VERSION, PRACTICE_NOTICE, PRACTICE_NOTICE_VERSION,
  TEACHER_VIEW_NOTICE, TEACHER_VIEW_NOTICE_VERSION,
} from '@/lib/classroom/notices'
import type { ClassroomMe } from '@/lib/classroom/me'
import { api } from './api'
import { refusalCopy } from './classroom-copy'
import { PageActions, type PageAction } from './page-actions'

type Preview = { seatName: string; avatarName: string; teacher: { fullName: string; photoUrl: string | null }; expiresAt: string }
type Who = 'self' | 'child' | string // a learner id = an existing child
type Step = 'who' | 'consent' | 'assent' | 'done'

/**
 * JOINING A CLASS FROM AN INVITE (plan "MVP scope › Learner › 1"): whose class this is → sign in → who will practise (me,
 * a new child, or a child already on this account) → the agreements, one per purpose → a child of 7+ says yes in their
 * own words → in. The server repeats every check (join.ts); this page only asks the questions in order.
 */
export function JoinFlow({ code: raw }: { code: string }) {
  const code = normalizeInviteCode(raw) // a hand-typed link may arrive capitalised
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const router = useRouter()
  const [preview, setPreview] = useState<Preview | null | 'invalid' | 'unreachable'>(null)
  const [attempt, setAttempt] = useState(0)
  const [children, setChildren] = useState<ClassroomMe['learners']>([])
  const [step, setStep] = useState<Step>('who')
  const [who, setWho] = useState<Who>('self')
  const [childName, setChildName] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [guardian, setGuardian] = useState(false)
  const [adult, setAdult] = useState(false)
  const [practice, setPractice] = useState(false)
  const [teacherView, setTeacherView] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [iab, setIab] = useState<InAppHost | null>(null)

  useEffect(() => { setIab(inAppHost()) }, [])
  useEffect(() => {
    if (!isInviteCodeShape(code)) { setPreview('invalid'); return }
    let gone = false
    // ⛔ A network blip or a server error is NOT an invalid invite (C3a round 2, Opus): on flaky 4G a learner was told a
    // good one-use link had expired. Only an answer about the invite itself says "invalid".
    api<{ invite: Preview }>(`/api/classroom/join/${code}`).then((r) => {
      if (gone) return
      setPreview(r.ok ? r.data.invite : r.status === 0 || r.status >= 500 || r.status === 429 ? 'unreachable' : 'invalid')
    })
    return () => { gone = true }
  }, [code, attempt])
  useEffect(() => {
    // ⛔ This account's children only (C3a round 2, codex): a sign-in as someone else on this page starts from none, and an
    // answer for the previous account arriving late is dropped.
    setChildren([])
    setWho('self')
    if (!user) return
    let gone = false
    api<ClassroomMe>('/api/classroom/me').then((r) => { if (!gone && r.ok) setChildren(r.data.learners.filter((l) => l.kind === 'child')) })
    return () => { gone = true }
  }, [user?.id])

  const thisYear = new Date().getFullYear()
  // The years limits.ts childBirthYearOk accepts: a child certainly 3 (born ≤ this year − 4) who may still be 17 (≥ − 18).
  const years = useMemo(() => Array.from({ length: ADULT_AGE - 3 }, (_, i) => String(thisYear - 4 - i)), [thisYear])
  const existing = children.find((c) => c.id === who)
  // The statement this learner joins under, for THIS class too: the guardian's for a child, the adult's for "me".
  const asGuardian = who === 'child' || (!!existing && existing.kind !== 'self')
  const asAdult = who === 'self' || existing?.kind === 'self'
  const childYear = who === 'child' ? Number(birthYear) : existing?.birthYear ?? null
  const needsAssent = (who === 'child' || !!existing) && childYear != null && thisYear - childYear >= CHILD_ASSENT_AGE

  if (preview === null || loading) return <Skeleton className="mt-6 h-72 w-full rounded-2xl" />
  if (preview === 'unreachable') {
    return <EmptyState variant="fault" icon={WifiOff} title={tr('The invite did not load', 'Chưa tải được link mời')}
      subtitle={tr('Check your connection and try again.', 'Hãy kiểm tra kết nối và thử lại.')} className="mt-12"
      action={<Button className="min-h-11" onClick={() => { setPreview(null); setAttempt((n) => n + 1) }}>{tr('Try again', 'Thử lại')}</Button>} />
  }
  if (preview === 'invalid') {
    return <EmptyState icon={Link2} title={tr(refusalCopy('invite_invalid').en, refusalCopy('invite_invalid').vi)} className="mt-12"
      action={<Button variant="outline" className="min-h-11" asChild><Link href="/classroom" prefetch={false}>{tr('Go to eno Classroom', 'Đến eno Classroom')}</Link></Button>} />
  }

  const submit = async (assent: boolean) => {
    setBusy(true)
    setError(null)
    const base = { practice: PRACTICE_NOTICE_VERSION, teacherView: TEACHER_VIEW_NOTICE_VERSION, ...(assent ? { assent: ASSENT_VERSION } : {}) }
    const body = who === 'self' ? { who: 'self', adult: ADULT_NOTICE_VERSION, ...base }
      : who === 'child' ? { who: 'child', displayName: childName.trim(), birthYear: Number(birthYear), guardian: GUARDIAN_NOTICE_VERSION, ...base }
        : { who: 'existing', learnerId: who, ...(asAdult ? { adult: ADULT_NOTICE_VERSION } : { guardian: GUARDIAN_NOTICE_VERSION }), ...base }
    const r = await api(`/api/classroom/join/${code}`, { body })
    setBusy(false)
    if (!r.ok) {
      if (r.error === 'assent_required') return setStep('assent')
      setError(r.error)
      return
    }
    setStep('done')
  }

  const header = (
    <div className="flex flex-col items-center gap-3 pb-6 pt-4 text-center">
      <Avatar name={preview.teacher.fullName} url={preview.teacher.photoUrl} size="2xl" />
      <p className="text-sm text-body">{tr('An invite from', 'Lời mời từ')} <span className="font-semibold text-ink">{preview.teacher.fullName}</span></p>
      <h1 className="h-title text-balance">{tr('Practise speaking English with', 'Luyện nói tiếng Anh cùng')} {preview.avatarName}</h1>
      <p className="text-xs text-ink-4">{tr('This invite is for', 'Lời mời dành cho')} <span className="font-semibold">{preview.seatName}</span> · {tr('AI avatar of your teacher', 'Avatar AI của giáo viên')}</p>
    </div>
  )
  // An error after a tap rides the action bar, beside the button that was tapped (on a phone the content above may be
  // scrolled away). ⚠️ `null`, never `undefined`, while there is none — StickyActionBar keeps one shape (page-actions.tsx).
  const errorNote = error ? <p role="alert" className="text-sm text-destructive">{tr(refusalCopy(error).en, refusalCopy(error).vi)}</p> : null

  /**
   * ⛔ ONE STEP'S CONTENT, AND ITS ACTIONS IN ONE PLACE (mobile first, 2026-10-26): every step's primary action is pinned
   * to the bottom edge on a phone, where the thumb is, and stays THE SAME bar from step to step — rendered once below, so
   * Next → Join → Yes → Start practising change its label in place instead of jumping around the screen.
   */
  let content: React.ReactNode
  let primary: PageAction
  let secondary: PageAction | undefined
  let note: React.ReactNode = null

  if (iab) {
    content = (
      <div className="flex flex-col">
        {header}
        <div className="flex flex-col items-center gap-3 border-t border-border pt-6 text-center">
          <p className="text-sm text-body">
            {tr('The microphone does not work inside {app}. Open this invite in your phone’s browser.', 'Micro không hoạt động trong {app}. Hãy mở link mời bằng trình duyệt của điện thoại.').replace('{app}', inAppHostName(iab) ?? tr('this app', 'ứng dụng này'))}
          </p>
          <Button variant="ghost" className="min-h-11" onClick={() => setIab(null)}>{tr('Continue here anyway', 'Vẫn tiếp tục ở đây')}</Button>
        </div>
      </div>
    )
    primary = { label: tr('Open in browser', 'Mở bằng trình duyệt'), icon: <ExternalLink aria-hidden />, onClick: () => escapeInAppBrowser(window.location.href, iab) }
  } else if (!user) {
    content = (
      <div className="flex flex-col">
        {header}
        <p className="text-center text-sm text-body">{tr('Parents: sign in with your own account — you can add your child next.', 'Phụ huynh: đăng nhập bằng tài khoản của bạn — sau đó có thể thêm con.')}</p>
      </div>
    )
    primary = { label: tr('Sign in to join', 'Đăng nhập để tham gia'), onClick: () => openSignIn() }
  } else if (step === 'done') {
    content = (
      <div className="flex flex-col">
        {header}
        <p className="text-center text-lg font-bold text-ink">{tr('You’re in!', 'Đã vào lớp!')}</p>
      </div>
    )
    primary = { label: tr('Start practising', 'Bắt đầu luyện tập'), onClick: () => router.push('/classroom') }
  } else if (step === 'assent') {
    content = (
      <div className="flex flex-col items-center gap-6 py-6 text-center">
        <Avatar name={preview.avatarName} url={preview.teacher.photoUrl} size="2xl" />
        <div className="flex max-w-sm flex-col gap-3">
          {ASSENT_TEXT.map((t) => <p key={t.en} className="text-lg text-ink">{tr(t.en, t.vi)}</p>)}
        </div>
      </div>
    )
    // "Not now" as easy to reach as "Yes": the child's own answer, side by side at the bottom edge.
    primary = { label: tr(ASSENT_YES.en, ASSENT_YES.vi), loading: busy, onClick: () => { void submit(true) } }
    secondary = { label: tr('Not now', 'Để sau'), onClick: () => setStep('consent') }
    note = errorNote
  } else if (step === 'consent') {
    const ready = practice && teacherView && (!asGuardian || guardian) && (!asAdult || adult)
    content = (
      <div className="flex flex-col gap-5">
        {header}
        <Agreement checked={practice} onChange={setPractice} title={tr('Voice practice', 'Luyện nói bằng giọng')} lines={PRACTICE_NOTICE} />
        <Agreement checked={teacherView} onChange={setTeacherView} title={tr('The teacher sees the reports', 'Giáo viên xem nhận xét')} lines={TEACHER_VIEW_NOTICE} />
        {asGuardian && <Agreement checked={guardian} onChange={setGuardian} title={tr('Parent or guardian', 'Cha mẹ hoặc người giám hộ')} lines={[GUARDIAN_ATTESTATION]} />}
        {asAdult && <Agreement checked={adult} onChange={setAdult} title={tr('Practising as yourself', 'Tự luyện tập')} lines={[ADULT_ATTESTATION]} />}
        <p className="text-xs text-ink-4">
          {tr('By joining you agree to eno’s', 'Khi tham gia, bạn đồng ý với')} <Link href="/terms" className="underline" target="_blank">{tr('Terms', 'Điều khoản')}</Link>{' '}
          {tr('and our', 'và')} <Link href="/privacy" className="underline" target="_blank">{tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}</Link>.
        </p>
      </div>
    )
    primary = {
      label: needsAssent ? tr('Next', 'Tiếp') : tr('Join the class', 'Vào lớp'),
      disabled: !ready,
      loading: busy,
      onClick: () => { if (needsAssent) setStep('assent'); else void submit(false) },
    }
    secondary = { label: tr('Back', 'Quay lại'), onClick: () => setStep('who') }
    note = errorNote
  } else {
    const childOk = who !== 'child' || (childName.trim().length > 0 && years.includes(birthYear))
    content = (
      <div className="flex flex-col gap-5">
        {header}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-ink">{tr('Who will practise?', 'Ai sẽ luyện tập?')}</span>
          <ToggleGroup<string> aria-label={tr('Who will practise?', 'Ai sẽ luyện tập?')} value={[who]} onValueChange={(v) => v[0] && setWho(v[0])}>
            <ToggleGroupItem value="self">{tr('Me (18+)', 'Tôi (18+)')}</ToggleGroupItem>
            {children.map((c) => <ToggleGroupItem key={c.id} value={c.id}>{c.displayName}</ToggleGroupItem>)}
            <ToggleGroupItem value="child">{tr('My child', 'Con tôi')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {who === 'child' && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-ink">{tr('Child’s first name or nickname', 'Tên hoặc biệt danh của con')}</span>
              <Input value={childName} maxLength={40} onChange={(e) => setChildName(e.target.value)} />
              <span className="text-xs text-ink-4">{tr('Only this and the year of birth are kept — no surname, no date.', 'Chỉ lưu tên này và năm sinh — không lưu họ, không lưu ngày sinh.')}</span>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-ink">{tr('Year of birth', 'Năm sinh')}</span>
              <Input inputMode="numeric" value={birthYear} maxLength={4} placeholder={String(thisYear - 8)} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </label>
          </div>
        )}
      </div>
    )
    primary = { label: tr('Next', 'Tiếp'), disabled: !childOk, onClick: () => setStep('consent') }
  }

  return (
    <div className="flex flex-col">
      {content}
      <PageActions primary={primary} secondary={secondary} note={note} />
    </div>
  )
}

function Agreement({ checked, onChange, title, lines }: { checked: boolean; onChange: (v: boolean) => void; title: string; lines: readonly { en: string; vi: string }[] }) {
  const { tr } = useLanguage()
  return (
    // The whole row is the tap target (a <label>), the box a 20px mark, and the lines body-size type: a parent reads them
    // on a phone before agreeing, so they are not 12px captions.
    <label className="flex cursor-pointer items-start gap-3 border-t border-border pt-4">
      <Checkbox checked={checked} onChange={onChange} className="mt-0.5 h-5 w-5" />
      <span className="flex flex-col gap-1.5">
        <span className="text-base font-semibold text-ink">{title}</span>
        {lines.map((l) => <span key={l.en} className="text-sm text-body">{tr(l.en, l.vi)}</span>)}
      </span>
    </label>
  )
}
