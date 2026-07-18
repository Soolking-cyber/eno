'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { Mail, Check } from 'lucide-react'

// Public, token-scoped email-preference page (no login). The visible footer link in the
// digest lands here; a click POSTs to /api/unsubscribe so a link scanner's GET never
// unsubscribes anyone. Also offers a one-tap re-subscribe.
export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-muted" />}>
      <UnsubscribeInner />
    </Suspense>
  )
}

function UnsubscribeInner() {
  const { tr } = useLanguage()
  const token = useSearchParams().get('token') ?? ''
  const [state, setState] = useState<'idle' | 'saving' | 'unsubscribed' | 'resubscribed' | 'error'>('idle')

  const set = async (optIn: boolean) => {
    if (!token) { setState('error'); return }
    setState('saving')
    try {
      const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn }),
      })
      setState(res.ok ? (optIn ? 'resubscribed' : 'unsubscribed') : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-tint">
          {state === 'unsubscribed' ? <Check className="h-6 w-6 text-accent-foreground" /> : <Mail className="h-6 w-6 text-accent-foreground" />}
        </div>

        {state === 'unsubscribed' ? (
          <>
            <h1 className="mt-4 text-xl font-bold text-foreground">{tr("You're unsubscribed", 'Bạn đã hủy đăng ký')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{tr("You won't get the weekly eno.vn digest anymore. Changed your mind?", 'Bạn sẽ không nhận bản tin hằng tuần của eno.vn nữa. Đổi ý?')}</p>
            <Button
              variant="outline"
              size="none"
              onClick={() => set(true)}
              className="mt-5 border-border px-5 py-2.5 font-bold text-accent-foreground hover:bg-tint hover:text-accent-foreground cursor-pointer"
            >
              {tr('Re-subscribe', 'Đăng ký lại')}
            </Button>
          </>
        ) : state === 'resubscribed' ? (
          <>
            <h1 className="mt-4 text-xl font-bold text-foreground">{tr("You're back in", 'Bạn đã đăng ký lại')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{tr("You'll receive the weekly eno.vn digest again.", 'Bạn sẽ tiếp tục nhận bản tin hằng tuần của eno.vn.')}</p>
          </>
        ) : state === 'error' ? (
          <>
            <h1 className="mt-4 text-xl font-bold text-foreground">{tr("That link didn't work", 'Liên kết không hợp lệ')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{tr('The unsubscribe link is invalid or expired. You can manage email preferences from your account settings.', 'Liên kết hủy đăng ký không hợp lệ hoặc đã hết hạn. Bạn có thể quản lý email trong cài đặt tài khoản.')}</p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-xl font-bold text-foreground">{tr('Unsubscribe from the weekly digest?', 'Hủy đăng ký bản tin hằng tuần?')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{tr('Stop receiving the weekly "top products & moving sales" email from eno.vn.', 'Ngừng nhận email hằng tuần "sản phẩm nổi bật & moving sale" từ eno.vn.')}</p>
            <Button
              variant="cta"
              size="none"
              onClick={() => set(false)}
              disabled={state === 'saving' || !token}
              className="mt-5 w-full py-2.5 cursor-pointer"
            >
              {state === 'saving' ? tr('Saving…', 'Đang lưu…') : tr('Unsubscribe', 'Hủy đăng ký')}
            </Button>
          </>
        )}

        <div className="mt-6">
          <Link href="/" className="text-xs font-medium text-muted-foreground hover:text-foreground">{tr('← Back to eno.vn', '← Quay lại eno.vn')}</Link>
        </div>
      </div>
    </div>
  )
}
