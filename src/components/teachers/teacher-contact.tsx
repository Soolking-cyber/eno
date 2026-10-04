'use client'

// "Message teacher" (owner, 2026-09-30): only a signed-in BUSINESS account may start the chat; the
// server enforces the same rule (POST /api/conversations → 403 business_only). The teacher's phone,
// email and CV are never here — they arrive in the thread only after the teacher taps "Share".
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { stashCompose } from '@/lib/quick-contact'
import { scrollBehavior } from '@/lib/reduced-motion'
import { cn } from '@/lib/utils'

/** The contact block's anchor, and the event the first-screen button fires at it (TeacherContactJump). */
export const TEACHER_CONTACT_ID = 'teacher-contact'
export const TEACHER_CONTACT_EVENT = 'eno:teacher-contact'

export function TeacherContact({ listingId, name, image }: { listingId: string; name: string; image: string | null }) {
  const { user, loading, accountType, identityLoaded, openSignIn } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [needsBusiness, setNeedsBusiness] = useState(false)

  // A tap before the account type has loaded is QUEUED, not dropped (Opus, commit gate 09-30).
  const queued = useRef(false)
  useEffect(() => {
    if (queued.current && identityLoaded) { queued.current = false; start(true) }
  })
  // `force`: the queued replay — `busy` in this closure is the queue's own spinner, not a second tap.
  const start = (force = false) => {
    if (busy && !force) return
    // Every early return below also drops the queue's spinner — a stuck "Opening chat…" is worse
    // than none (agy + Opus, commit gate 09-30).
    if (force) setBusy(false)
    if (loading) return
    if (!user) {
      openSignIn({ listingTitle: name, listingImage: image, note: tr('Sign in with your school or company account to message teachers.', 'Đăng nhập bằng tài khoản trường hoặc công ty để nhắn tin cho giáo viên.') })
      return
    }
    // accountType arrives with the profile, after `user` — never judge it before it has loaded.
    if (!identityLoaded) {
      queued.current = true; setBusy(true)
      // Backstop: if the account never loads, release the button rather than spin forever.
      setTimeout(() => { if (queued.current) { queued.current = false; setBusy(false) } }, 8000)
      return
    }
    if (accountType !== 'business') { setNeedsBusiness(true); return }
    setBusy(true)
    stashCompose({
      listingId,
      body: tr('Hello, we are hiring a teacher and your profile looks like a good fit — are you open to talking?', 'Xin chào, chúng tôi đang tuyển giáo viên và hồ sơ của bạn rất phù hợp — bạn có muốn trao đổi thêm không?'),
      listingTitle: name,
      listingImage: image,
      currency: '₫',
    })
    router.push('/messages/pending')
    // Backstop: never leave a permanently spinning button if the navigation stalls.
    setTimeout(() => setBusy(false), 8000)
  }

  // The first-screen "Message" button (TeacherContactJump) runs THIS start — one action, one set of rules
  // (sign-in, the business-only check, the queue) — never a second copy of them. A ref, so the listener
  // reads the current render's closure without re-subscribing on every render.
  // Kept current in an effect, never written during render (React refs rule); the listener below reads it.
  const startRef = useRef(start)
  useEffect(() => { startRef.current = start })
  useEffect(() => {
    const onJump = (e: Event) => {
      if ((e as CustomEvent<{ listingId?: string }>).detail?.listingId === listingId) startRef.current()
    }
    window.addEventListener(TEACHER_CONTACT_EVENT, onJump)
    return () => window.removeEventListener(TEACHER_CONTACT_EVENT, onJump)
  }, [listingId])

  return (
    // `scroll-mt-24`: the jump lands it clear of the sticky header (lg:top-24 is the aside's own offset).
    <div id={TEACHER_CONTACT_ID} className="scroll-mt-24 space-y-2">
      <Button variant="cta" className="w-full" onClick={() => start()} disabled={busy}>
        {busy ? tr('Opening chat…', 'Đang mở trò chuyện…') : tr('Message teacher', 'Nhắn tin cho giáo viên')}
      </Button>
      {needsBusiness && (
        <p className="text-sm text-body">
          {tr('Only school and company accounts can message teachers. ', 'Chỉ tài khoản trường học hoặc công ty mới nhắn tin được cho giáo viên. ')}
          <Link href="/onboard" className="font-semibold text-brand underline">{tr('Set up a business account', 'Tạo tài khoản doanh nghiệp')}</Link>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {tr('The teacher’s phone, email and CV are shared with you only if they choose to, in your chat.', 'Số điện thoại, email và CV của giáo viên chỉ được chia sẻ nếu họ đồng ý, trong cuộc trò chuyện.')}
      </p>
    </div>
  )
}

/**
 * "Message" BESIDE THE NAME, IN THE FIRST SCREEN (rentals-12). On a phone the profile stacks and the
 * contact block falls below the bio, the teaching rows, the experience and the qualifications — a school
 * had to scroll the whole profile to find the one button. This one SCROLLS TO that block and fires ITS
 * action (TEACHER_CONTACT_EVENT), so the outcome lands where the reader now is: the sign-in sheet for a
 * guest, the "only school and company accounts" note for a personal account (the business-only rule
 * stays — owner, 2026-09-30), the chat for a business.
 * ⚠️ NO STICKY BAR (owner, §6) — an in-flow button only. Below lg only: on desktop the contact block is the
 * sticky right-hand column, already beside the name.
 */
export function TeacherContactJump({ listingId, className }: { listingId: string; className?: string }) {
  const { tr } = useLanguage()
  return (
    <Button
      variant="cta"
      className={cn('relative tap-44', className)}
      onClick={() => {
        document.getElementById(TEACHER_CONTACT_ID)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
        window.dispatchEvent(new CustomEvent(TEACHER_CONTACT_EVENT, { detail: { listingId } }))
      }}
    >
      {tr('Message', 'Nhắn tin')}
    </Button>
  )
}
