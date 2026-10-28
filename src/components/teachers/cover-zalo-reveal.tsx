'use client'

// "URGENT COVER? SHOW ZALO" (owner, 2026-10-28 — src/lib/teachers/zalo.ts): on a cover teacher's profile, a school (a
// business account) may see the Zalo number the teacher chose to show for urgent cover, without waiting for a reply —
// one new number a day, twenty once its business is verified. The block asks where the account stands first (never the
// number) and draws nothing unless the teacher offers it to this viewer right now; the server decides every tap again.
// ⛔ NEVER AN <a href="https://zalo.me/…">: a link click sends its URL — the teacher's number — to Google Analytics as an
// outbound click (enhanced measurement). "Open Zalo" is a button that opens it from a handler.
// ⛔ The number lives in this component's state only: never in the page HTML, a cache or storage.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { IosVerifyElsewhereNote } from '@/components/marketplace/ios-browser-only-note'
import { useIosHideKyc } from '@/hooks/use-ios-hide-kyc'
import { teacherDmStep } from '@/lib/teachers/dm-limit-copy'
import { formatVnMobile } from '@/lib/teachers/zalo-rules'

/** GET /api/teachers/zalo — the standing (never the number). */
type Standing = {
  available: boolean
  revealed: boolean
  tier: 'school' | 'verified' | 'none'
  limit: number
  remaining: number
  resetAt?: string
  reason: 'business_only' | 'suspended' | 'revoked' | 'limit' | 'pool' | 'teacher_cap' | null
  next: string | null
}

const timeout = () => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined)

/**
 * Keyed by the ACCOUNT AND THE TEACHER (review, 2026-10-28): a number shown for one teacher must never stay on screen when
 * the page moves to another teacher's profile without unmounting, and an answer still on its way for the last one lands
 * in a component that is gone.
 */
export function CoverZaloReveal({ listingId }: { listingId: string }) {
  const { user } = useAuth()
  return <CoverZaloRevealFor key={`${user?.id ?? 'guest'}:${listingId}`} listingId={listingId} />
}

function CoverZaloRevealFor({ listingId }: { listingId: string }) {
  const { user, identityLoaded, accountType } = useAuth()
  const { tr } = useLanguage()
  const hideKyc = useIosHideKyc()
  // Each kept WITH the account it was asked for (teacher-contact.tsx's rule): another account on this page never sees
  // the last one's standing — or the number it revealed.
  const [standingFor, setStandingFor] = useState<{ uid: string; s: Standing } | null>(null)
  const [shownFor, setShownFor] = useState<{ uid: string; zalo: string; href: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const standing = user && standingFor?.uid === user.id ? standingFor.s : null
  const shown = user && shownFor?.uid === user.id ? shownFor : null
  const business = accountType === 'business'

  // Asked again: once after a failed ask (a blip must not hide the block for the whole visit), and at the day's reset
  // while a cap holds the button (review round 5: a school at its cap at 23:59 sees it come back after midnight).
  const [asks, setAsks] = useState(0)
  const retry = useRef<number | undefined>(undefined)
  // Failed asks in a row: each is retried once, 5 s later (review round 8: the reset's own ask failing must not leave
  // yesterday's cap on screen) — never in a loop.
  const failedAsks = useRef(0)
  useEffect(() => {
    if (!user || !identityLoaded || accountType !== 'business') return
    let off = false
    const uid = user.id
    fetch(`/api/teachers/zalo?listingId=${encodeURIComponent(listingId)}`, { cache: 'no-store', signal: timeout() })
      .then((r) => (r.ok ? (r.json() as Promise<Standing>) : null))
      .then((s) => {
        if (off) return
        if (s) { failedAsks.current = 0; setStandingFor({ uid, s }); return }
        if (failedAsks.current++ === 0) retry.current = window.setTimeout(() => setAsks((n) => n + 1), 5000)
      })
      .catch(() => { if (!off && failedAsks.current++ === 0) retry.current = window.setTimeout(() => setAsks((n) => n + 1), 5000) })
    return () => { off = true; window.clearTimeout(retry.current) }
  }, [user, identityLoaded, accountType, listingId, asks])
  const capped = !!standing?.reason && standing.reason !== 'business_only'
  const resetAt = standing?.resetAt
  useEffect(() => {
    if (!capped || !resetAt) return
    // The bound on the time LEFT, the 2 s grace after it (review round 7: a cap read in the first seconds of a day is a
    // full day from the reset, and grace-first it fell past the bound — no timer at all).
    const left = Date.parse(resetAt) - Date.now()
    if (!(left > 0) || left > 86_400_000) return
    const t = window.setTimeout(() => setAsks((n) => n + 1), left + 2000)
    return () => window.clearTimeout(t)
  }, [capped, resetAt])

  if (!user || !business || !standing?.available) return null

  const reveal = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    const uid = user.id
    try {
      const r = await fetch('/api/teachers/zalo', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }), signal: timeout(),
      })
      const j = (await r.json().catch(() => null)) as { zalo?: string; href?: string; standing?: Standing; error?: string } | null
      if (r.ok && j?.zalo && j.href) { setShownFor({ uid, zalo: j.zalo, href: j.href }); if (j.standing) setStandingFor({ uid, s: j.standing }) }
      else if (r.status === 404) setStandingFor({ uid, s: { ...standing, available: false } })
      else if (j?.standing) setStandingFor({ uid, s: j.standing })
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const reason = !shown && !standing.revealed ? standing.reason : null
  const refusal = reason === 'limit'
    ? (standing.tier === 'verified'
      ? tr('You have seen today’s Zalo numbers. More tomorrow — or message the teacher.', 'Bạn đã xem hết số Zalo của hôm nay. Ngày mai bạn có thể xem tiếp — hoặc nhắn tin cho giáo viên.')
      : tr('You have seen today’s Zalo number. Verify your business to see up to 20 a day — or message the teacher.', 'Bạn đã xem số Zalo của hôm nay. Xác minh doanh nghiệp để xem đến 20 số mỗi ngày — hoặc nhắn tin cho giáo viên.'))
    : reason === 'pool'
      ? tr('Today’s free Zalo views on this connection are used. Verify your business to see more — or message the teacher.', 'Lượt xem Zalo miễn phí hôm nay trên kết nối này đã hết. Xác minh doanh nghiệp để xem thêm — hoặc nhắn tin cho giáo viên.')
      : reason === 'teacher_cap'
        ? tr('This teacher’s Zalo was shown to several schools today. Message them — or verify your business to see it.', 'Số Zalo của giáo viên này đã được hiển thị cho nhiều trường hôm nay. Hãy nhắn tin — hoặc xác minh doanh nghiệp để xem.')
        : null
  // A suspended or revoked account is never drawn this block (zalo.ts: no oracle — "not available"), so no copy for it.
  const step = reason ? teacherDmStep(standing.next ?? undefined, accountType, tr) : null
  const left = standing.tier === 'school' && !standing.revealed && !shown && !reason

  return (
    <div role="group" aria-label={tr('Zalo for urgent cover', 'Zalo cho dạy thay khẩn')} className="space-y-2 rounded-xl border border-border p-3">
      {shown ? (
        <div className="space-y-2">
          <p className="text-sm text-body">{tr('Zalo for urgent cover', 'Zalo cho dạy thay khẩn')}</p>
          <p className="text-lg font-bold tabular-nums text-foreground">{formatVnMobile(shown.zalo)}</p>
          <Button variant="secondary" className="w-full" onClick={() => window.open(shown.href, '_blank', 'noopener,noreferrer')}>
            {tr('Open Zalo', 'Mở Zalo')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="w-full" onClick={reveal} disabled={busy || !!reason}>
          {busy ? tr('Showing…', 'Đang hiển thị…') : standing.revealed ? tr('Show Zalo again', 'Hiện lại số Zalo') : tr('Urgent cover? Show Zalo', 'Cần dạy thay gấp? Hiện số Zalo')}
        </Button>
      )}
      {refusal && (
        <div role="status" className="space-y-1 text-sm text-body">
          <p>{refusal}</p>
          {step && (step.kyc && hideKyc
            ? <IosVerifyElsewhereNote kind={step.kyc} />
            : <Link href={step.href} className="font-semibold text-brand underline">{step.label}</Link>)}
        </div>
      )}
      {failed && <p role="alert" className="text-sm text-destructive">{tr('That did not work. Try again.', 'Không thực hiện được. Hãy thử lại.')}</p>}
      <p className="text-xs text-muted-foreground">
        {left
          ? tr('For urgent cover only. The teacher chose to show this number, and is told your school’s name. One new number a day until your business is verified.', 'Chỉ dành cho dạy thay khẩn. Giáo viên đã chọn hiển thị số này và sẽ được báo tên trường của bạn. Mỗi ngày một số mới cho đến khi doanh nghiệp của bạn được xác minh.')
          : tr('For urgent cover only. The teacher chose to show this number, and is told your school’s name.', 'Chỉ dành cho dạy thay khẩn. Giáo viên đã chọn hiển thị số này và sẽ được báo tên trường của bạn.')}
      </p>
    </div>
  )
}
