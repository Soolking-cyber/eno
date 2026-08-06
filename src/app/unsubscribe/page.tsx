'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { Mail, Check, ArrowLeft } from 'lucide-react'

// Public, token-scoped email-preference page (no login). The visible footer link in the
// digest lands here; a click POSTs to /api/unsubscribe so a link scanner's GET never
// unsubscribes anyone. Also offers a one-tap re-subscribe.
export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
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
    // Flat canon: one canvas, no floating card — the composition centers itself and the
    // tint circle anchors the state; separation below comes from a hairline, not a box.
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md text-center">
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
              className="mt-6 border-border px-5 py-2.5 font-bold text-accent-foreground hover:bg-tint hover:text-accent-foreground cursor-pointer"
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
              className="mt-6 w-full py-2.5 cursor-pointer"
            >
              {state === 'saving' ? tr('Saving…', 'Đang lưu…') : tr('Unsubscribe', 'Hủy đăng ký')}
            </Button>
          </>
        )}

        {/* Same quiet exit as /signin: hairline seam + arrow icon + the shared string. */}
        <div className="mt-8 border-t border-border/60 pt-4">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-accent-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {tr('Back to eno.vn', 'Về trang chủ')}
          </Link>
        </div>
      </div>
    </div>
  )
}
