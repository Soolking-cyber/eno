'use client'

// "ZALO FOR URGENT COVER" — THE TEACHER'S OWN PAGE (owner, 2026-10-28: "ask for zalo number from teachers who opted in to
// cover explain in urgent cover schools can request their number and it can be show without them texting back"). The
// switch, the number, the notice, and every school that saw it. Rules and record: src/lib/teachers/zalo.ts; the route:
// /api/teachers/me/cover-zalo. The cover step's summary and the desk's one-time message link here.
// ⛔ OFF BY DEFAULT, AND ON ONLY BY THE TEACHER'S OWN TAP WITH A NUMBER THEY CONFIRM — the prefill is a suggestion in
// the field, never a saved consent. A switch-on carries the notice version this page SHOWS and the stamps it loaded.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { SwitchRow } from '@/components/ui/switch'
import { Loader2 } from '@/components/ui/icons'
import { COVER_ZALO_NOTICE_VERSION, formatVnMobile, normalizeVnMobile } from '@/lib/teachers/zalo-rules'
import { fillTemplate } from '@/lib/i18n/placeholders'

const ENDPOINT = '/api/teachers/me/cover-zalo'
/** Bounded like every other wait here (review round 8): a stalled request must never hold the page — or the switch-off. */
const timeout = () => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined)

/** The endpoint's answer (zalo.ts CoverZaloState). */
export type CoverZaloView = {
  hasProfile: boolean
  coverOn: boolean
  on: boolean
  zalo: string | null
  stale: boolean
  base: { profile: string | null; at: string | null; withdrawnAt: string | null }
  phoneSuggestion: string | null
  noticeVersion: string
  seenBy: { name: string; at: string }[]
  seenByTotal: number
}

/** The answer, field by field — or null for anything that is not one. */
export function coverZaloViewOf(d: unknown): CoverZaloView | null {
  if (!d || typeof d !== 'object') return null
  const x = d as Record<string, unknown>
  if (typeof x.hasProfile !== 'boolean' || typeof x.coverOn !== 'boolean' || typeof x.on !== 'boolean' || typeof x.stale !== 'boolean') return null
  const base = x.base as Record<string, unknown> | null
  if (!base || typeof base !== 'object') return null
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    hasProfile: x.hasProfile, coverOn: x.coverOn, on: x.on, zalo: str(x.zalo), stale: x.stale,
    base: { profile: str(base.profile), at: str(base.at), withdrawnAt: str(base.withdrawnAt) },
    phoneSuggestion: str(x.phoneSuggestion), noticeVersion: str(x.noticeVersion) ?? '',
    seenBy: Array.isArray(x.seenBy) ? x.seenBy.filter((s): s is { name: string; at: string } => !!s && typeof s.name === 'string' && typeof s.at === 'string') : [],
    seenByTotal: typeof x.seenByTotal === 'number' ? x.seenByTotal : 0,
  }
}

/**
 * THE NOTICE — ⛔ ITS MEANING IS COVER_ZALO_NOTICE_VERSION (zalo-rules.ts). What it must say, all of it true of the code:
 * why (urgent cover), who sees it (a business account that asks on the profile — not every school is verified), when
 * (only while cover lessons and this are on), that it is usually the phone number, the cap (one new number a day for an
 * unverified business), the record and the bell (zalo.ts: TeacherZaloReveal + 'teacher_zalo_seen'), the deletion on
 * switch-off or cover-off, and what it cannot undo (a school that already saw it). /privacy says the same.
 */
export function CoverZaloNotice() {
  const { tr } = useLanguage()
  return (
    <span data-testid="cover-zalo-notice">
      {tr('When a class needs urgent cover, it is hard for a school to reach the right teacher in time — so eno lets schools reach you directly. While cover lessons and this switch are on, an account registered as a school or business on eno can see this Zalo number on your profile and contact you straight away, without waiting for your reply in eno chat — anyone can register such an account, and only some have their business verified. It is usually your phone number: a school that sees it has your number. An account whose business is not verified can see one new teacher’s number a day (accounts on one internet connection, two a day between them); a verified business up to 20 a day. We record which school saw it and when, and tell you each time. Switch this off, or switch cover lessons off, at any time — the number is then deleted from eno (a school that already saw it keeps what it saw). See our', 'Khi một lớp cần người dạy thay gấp, các trường rất khó liên hệ đúng giáo viên kịp thời — vì vậy eno cho phép các trường liên hệ trực tiếp với bạn. Khi bạn bật dạy thay và bật mục này, tài khoản đăng ký là trường học hoặc doanh nghiệp trên eno có thể xem số Zalo này trên hồ sơ của bạn và liên hệ ngay, không cần chờ bạn trả lời trong tin nhắn eno — ai cũng có thể đăng ký loại tài khoản này, và chỉ một số đã xác minh doanh nghiệp. Đây thường là số điện thoại của bạn: trường đã xem sẽ có số của bạn. Tài khoản chưa xác minh doanh nghiệp chỉ xem được số của một giáo viên mới mỗi ngày (các tài khoản trên cùng một kết nối internet: tổng cộng hai số mỗi ngày); doanh nghiệp đã xác minh xem được tối đa 20 số mỗi ngày. Chúng tôi ghi lại trường nào đã xem và khi nào, và báo cho bạn mỗi lần. Bạn có thể tắt mục này, hoặc tắt dạy thay, bất cứ lúc nào — khi đó số sẽ bị xóa khỏi eno (trường đã xem vẫn giữ những gì họ đã xem). Xem')}{' '}
      <Link href="/privacy" className="underline">{tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}</Link>.
    </span>
  )
}

type Line = '' | 'notice' | 'changed' | 'invalid' | 'cover_off' | 'rate_limited' | 'failed'

const SEEN_BY_MORE_EN = 'The latest {shown} of {total}. The full list is in your data export (Settings → Export my data).'

const NO_PROFILE: CoverZaloView = {
  hasProfile: false, coverOn: false, on: false, zalo: null, stale: false, base: { profile: null, at: null, withdrawnAt: null },
  phoneSuggestion: null, noticeVersion: COVER_ZALO_NOTICE_VERSION, seenBy: [], seenByTotal: 0,
}

function Loading() {
  return <div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
}

/** Keyed by the ACCOUNT (job-messages-panel.tsx's rule): nothing of one account is ever shown to, or saved for, the next. */
export function CoverZaloPanel() {
  const { user } = useAuth()
  return <CoverZaloFor key={user?.id ?? 'guest'} />
}

function CoverZaloFor() {
  const { tr, lang } = useLanguage()
  const { user, loading: authLoading, openSignIn } = useAuth()
  const uid = user?.id ?? null
  const [view, setView] = useState<CoverZaloView | null | undefined>(undefined)
  const [reloads, setReloads] = useState(0)
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [line, setLine] = useState<Line>('')

  const read = useCallback(async (): Promise<CoverZaloView | null> => {
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store', signal: timeout() })
      // No teacher profile is an ANSWER, not a failure: the page offers to create one (review, 2026-10-28).
      if (res.status === 404) return NO_PROFILE
      return res.ok ? coverZaloViewOf(await res.json().catch(() => null)) : null
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!uid) return
    let live = true
    void read().then((v) => {
      if (!live) return
      setView(v)
      // The field starts with the saved number, else the profile's phone — a SUGGESTION, saved only by the teacher's tap.
      if (v) setNumber(formatVnMobile(v.zalo ?? v.phoneSuggestion ?? ''))
    })
    return () => { live = false }
  }, [uid, read, reloads])

  const save = async (on: boolean) => {
    if (busyRef.current || !uid || !view) return
    if (on && !normalizeVnMobile(number)) { setLine('invalid'); return }
    busyRef.current = true
    setBusy(true)
    setLine('')
    try {
      const body = on ? { on: true, zalo: number, zaloNotice: COVER_ZALO_NOTICE_VERSION, base: view.base } : { on: false }
      const res = await fetch(ENDPOINT, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: timeout() })
      const d: unknown = await res.json().catch(() => null)
      const saved = res.ok ? coverZaloViewOf(d) : null
      if (saved) { setView(saved); if (saved.zalo) setNumber(formatVnMobile(saved.zalo)); return }
      const code = d && typeof d === 'object' ? (d as { error?: unknown }).error : null
      if (res.status === 409 && code === 'zalo_notice_changed') { setLine('notice'); return }
      // Another window saved first: show what is saved NOW — the switch and the number (review round 2: a field still
      // holding this window's edit read as "what is saved", and a retry would have overwritten the other window's number).
      if (res.status === 409 && code === 'zalo_changed') {
        setLine('changed')
        const fresh = await read()
        if (fresh) { setView(fresh); setNumber(formatVnMobile(fresh.zalo ?? fresh.phoneSuggestion ?? '')) }
        return
      }
      if (res.status === 400 && code === 'zalo_invalid') { setLine('invalid'); return }
      if (res.status === 400 && code === 'cover_off') { setLine('cover_off'); return }
      if (res.status === 429) { setLine('rate_limited'); return }
      // Not saved — or not KNOWN to be: read the truth, show it (the field too), and call it saved only when the saved
      // state is what this tap asked for — the switch, AND the number and a current grant for a switch-on (review round
      // 3: an edited number that failed must never read as saved while schools still see the old one).
      const fresh = await read()
      if (fresh) { setView(fresh); setNumber(formatVnMobile(fresh.zalo ?? fresh.phoneSuggestion ?? '')) }
      const asked = on ? normalizeVnMobile(number) : null
      setLine(fresh && fresh.on === on && (!on || (fresh.zalo === asked && !fresh.stale)) ? '' : 'failed')
    } catch {
      setLine('failed')
      const fresh = await read()
      if (fresh) { setView(fresh); setNumber(formatVnMobile(fresh.zalo ?? fresh.phoneSuggestion ?? '')) }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const title = tr('Zalo for urgent cover', 'Zalo cho dạy thay khẩn')
  if (authLoading) return <Loading />
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="h-title text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-body">{tr('Sign in to choose whether schools can reach you on Zalo for urgent cover.', 'Đăng nhập để chọn có cho phép các trường liên hệ với bạn qua Zalo khi cần dạy thay gấp hay không.')}</p>
        <Button variant="cta" className="mt-4" onClick={() => openSignIn({ note: tr('Sign in to set up Zalo for urgent cover.', 'Đăng nhập để thiết lập Zalo cho dạy thay khẩn.') })}>{tr('Sign in', 'Đăng nhập')}</Button>
      </div>
    )
  }
  if (view === undefined) return <Loading />
  if (view === null || !view.hasProfile) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="h-title text-foreground">{title}</h1>
        {view === null
          ? <>
            <p className="mt-2 text-sm text-body">{tr('We could not load your choice. Check your connection and try again.', 'Chúng tôi không tải được lựa chọn của bạn. Hãy kiểm tra kết nối và thử lại.')}</p>
            <Button variant="secondary" className="mt-4" onClick={() => { setView(undefined); setReloads((n) => n + 1) }}>{tr('Try again', 'Thử lại')}</Button>
          </>
          : <>
            <p className="mt-2 text-sm text-body">{tr('Zalo for urgent cover is part of a teacher profile with cover lessons on. Create one — it is free.', 'Zalo cho dạy thay khẩn là một phần của hồ sơ giáo viên có bật dạy thay. Hãy tạo hồ sơ — miễn phí.')}</p>
            <Button variant="cta" className="mt-4" asChild><Link href="/teachers/join?goal=cover">{tr('Create my teacher profile', 'Tạo hồ sơ giáo viên')}</Link></Button>
          </>}
      </div>
    )
  }

  const typed = normalizeVnMobile(number)
  const changedNumber = view.on && typed !== null && typed !== view.zalo
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })

  return (
    <div className="space-y-5">
      <PageHeader title={title} meta={tr('Let schools that need a cover teacher urgently reach you straight away.', 'Cho phép các trường cần người dạy thay gấp liên hệ ngay với bạn.')} />

      {!view.coverOn && !view.on && (
        <Alert tone="info" appearance="flat" size="md" role="status">
          {tr('Switch cover lessons on in your teacher profile first — Zalo for urgent cover works only with them.', 'Hãy bật dạy thay trong hồ sơ giáo viên trước — Zalo cho dạy thay khẩn chỉ hoạt động khi đã bật dạy thay.')}{' '}
          <Link href="/teachers/edit" className="font-semibold underline">{tr('Edit my teacher profile', 'Sửa hồ sơ giáo viên')}</Link>
        </Alert>
      )}
      {/* On, but cover is not public right now (switched on under an older cover notice): DORMANT — schools cannot see it
          (review round 4: the switch alone drew "on" while no school could use it). */}
      {view.on && !view.coverOn && (
        <Alert tone="warning" appearance="flat" size="md" role="status">
          {tr('Cover lessons are not on right now, so schools cannot see your Zalo. Switch cover lessons on again in your teacher profile — or switch this off to delete the number.', 'Dạy thay hiện không bật, nên các trường không xem được số Zalo của bạn. Hãy bật lại dạy thay trong hồ sơ giáo viên — hoặc tắt mục này để xóa số.')}{' '}
          <Link href="/teachers/edit" className="font-semibold underline">{tr('Edit my teacher profile', 'Sửa hồ sơ giáo viên')}</Link>
        </Alert>
      )}
      {view.on && view.stale && (
        <Alert tone="warning" appearance="flat" size="md" role="status">
          {tr('The notice below has changed since you switched this on. Schools cannot see your Zalo until you switch it on again.', 'Thông báo bên dưới đã thay đổi kể từ khi bạn bật mục này. Các trường không xem được số Zalo của bạn cho đến khi bạn bật lại.')}
        </Alert>
      )}

      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-foreground">{tr('Your Zalo number', 'Số Zalo của bạn')}</span>
          <Input
            inputMode="tel"
            autoComplete="tel"
            value={number}
            onChange={(e) => { setNumber(e.target.value); if (line === 'invalid') setLine('') }}
            disabled={busy || (!view.coverOn && !view.on)}
            aria-invalid={line === 'invalid' ? true : undefined}
            aria-describedby="cover-zalo-number-hint"
            placeholder="0901 234 567"
          />
          <span id="cover-zalo-number-hint" className="block text-xs text-muted-foreground">
            {tr('A Vietnamese mobile number with Zalo. Check that it opens your Zalo.', 'Số di động Việt Nam có dùng Zalo. Hãy kiểm tra số này mở đúng Zalo của bạn.')}
          </span>
        </label>
        <SwitchRow
          id="cover-zalo-switch"
          checked={view.on && !view.stale}
          onChange={(next) => { void save(next) }}
          disabled={busy || (!view.coverOn && !view.on)}
          label={tr('Let schools see my Zalo for urgent cover', 'Cho phép các trường xem số Zalo của tôi khi cần dạy thay gấp')}
          description={<CoverZaloNotice />}
        />
        {/* ⛔ A WAY TO DELETE IT, ALWAYS (review, 2026-10-28): a grant under an older notice draws the switch OFF — tapping it
            would grant it again — and with cover consent stale too a re-grant is refused; this deletes it in every state. */}
        {view.on && view.stale && (
          <Button variant="link" size="none" type="button" className="text-sm font-semibold" disabled={busy} onClick={() => { void save(false) }}>
            {tr('Switch off and delete my Zalo number', 'Tắt và xóa số Zalo của tôi')}
          </Button>
        )}
        {changedNumber && !view.stale && (
          <Button variant="secondary" disabled={busy} onClick={() => { void save(true) }}>{tr('Save the new number', 'Lưu số mới')}</Button>
        )}
        {line === 'invalid' && <p role="alert" className="text-sm text-destructive">{tr('Enter a Vietnamese mobile number, for example 0901 234 567.', 'Hãy nhập số di động Việt Nam, ví dụ 0901 234 567.')}</p>}
        {line === 'cover_off' && <p role="alert" className="text-sm text-destructive">{tr('Cover lessons are off — switch them on in your teacher profile first.', 'Dạy thay đang tắt — hãy bật trong hồ sơ giáo viên trước.')}</p>}
        {line === 'changed' && <p role="alert" className="text-sm text-destructive">{tr('This was changed in another window. Here is what is saved now — try again if you still want to change it.', 'Mục này đã được thay đổi ở cửa sổ khác. Đây là nội dung đang được lưu — hãy thử lại nếu bạn vẫn muốn thay đổi.')}</p>}
        {line === 'notice' && (
          <p role="alert" className="text-sm text-destructive">
            {tr('This page is out of date: the notice changed while it was open. Reload the page to read it, then switch this on.', 'Trang này đã cũ: thông báo đã thay đổi khi trang đang mở. Hãy tải lại trang để đọc, rồi bật lại mục này.')}{' '}
            <Button variant="link" size="none" type="button" className="text-sm font-semibold" onClick={() => window.location.reload()}>{tr('Reload', 'Tải lại')}</Button>
          </p>
        )}
        {line === 'rate_limited' && <p role="alert" className="text-sm text-destructive">{tr('Too many changes in a short time — try again in a little while.', 'Bạn đã thay đổi quá nhiều lần trong thời gian ngắn — hãy thử lại sau ít phút.')}</p>}
        {line === 'failed' && <p role="alert" className="text-sm text-destructive">{tr('We could not save your choice. Check your connection and try again.', 'Chúng tôi không lưu được lựa chọn của bạn. Hãy kiểm tra kết nối và thử lại.')}</p>}
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">{tr('Schools that saw your Zalo', 'Các trường đã xem số Zalo của bạn')}</h2>
        {view.seenBy.length === 0
          ? <p className="text-sm text-muted-foreground">{tr('No school has seen it yet.', 'Chưa có trường nào xem.')}</p>
          : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {view.seenBy.map((s, i) => (
                <li key={`${s.at}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-foreground">{s.name}</span>
                  <span className="shrink-0 text-muted-foreground">{dateOf(s.at)}</span>
                </li>
              ))}
            </ul>
          )}
        {view.seenByTotal > view.seenBy.length && (
          <p className="text-xs text-muted-foreground">
            {fillTemplate(
              tr(SEEN_BY_MORE_EN, '{shown} trường gần nhất trong tổng số {total}. Danh sách đầy đủ có trong dữ liệu bạn xuất (Cài đặt → Xuất dữ liệu của tôi).'),
              SEEN_BY_MORE_EN,
              { shown: String(view.seenBy.length), total: String(view.seenByTotal) },
            )}
          </p>
        )}
      </section>

      <p className="text-sm">
        <Link href="/teachers/edit" className="font-semibold text-accent-foreground hover:underline">{tr('Edit my teacher profile', 'Sửa hồ sơ giáo viên')}</Link>
      </p>
    </div>
  )
}
