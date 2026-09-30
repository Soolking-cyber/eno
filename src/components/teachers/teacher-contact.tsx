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

  return (
    <div className="space-y-2">
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
