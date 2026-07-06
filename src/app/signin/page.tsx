'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShieldCheck, MessageSquare, BadgeCheck } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInForm } from '@/components/marketplace/sign-in-form'
import { Mascot } from '@/components/marketplace/mascot'
import { safeNextPath } from '@/lib/url'
import { COMPANY } from '@/lib/site-legal'

// Dedicated split-layout sign-in page (commerce-login pattern, eno.vn blue). Reuses
// the exact same <SignInForm> as the inline modal. Honors ?next= for post-login
// redirect and bounces already-signed-in users away.
function SignInPageInner() {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const raw = params.get('next') || '/'

  useEffect(() => {
    if (!user) return
    // Sanitize ?next= to a same-origin path (shared open-redirect guard).
    router.replace(safeNextPath(raw, window.location.origin))
  }, [user, raw, router])

  return (
    <div className="grid min-h-screen w-full bg-background md:grid-cols-2">
      {/* Brand panel (desktop) — muted deep navy-blue (calmer than the vivid accent) */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-deep to-brand-deeper p-12 text-white md:flex">
        {/* Mascot with a key (access) — anchored in the empty lower-right */}
        <Mascot name="key" white className="pointer-events-none absolute bottom-8 right-8 h-72 w-72 opacity-[0.13] lg:h-96 lg:w-96" />
        <Link href="/" className="relative text-2xl font-black tracking-tight">eno.vn</Link>
        <div className="relative">
          <h1 className="text-4xl font-black leading-tight">{tr('e-commerce with no drama', 'Mua bán không drama.')}</h1>
          <p className="mt-3 max-w-sm text-[15px] text-blue-100">
            {tr("Vietnam's trusted marketplace for the international community.", 'Chợ uy tín cho cộng đồng quốc tế tại Việt Nam.')}
          </p>
          <ul className="mt-8 space-y-3 text-sm text-blue-50">
            <li className="flex items-center gap-2.5"><BadgeCheck className="h-5 w-5 shrink-0" /> {tr('Sellers earn a trust badge — reputation you can see', 'Người bán xây dựng uy tín — huy hiệu minh bạch')}</li>
            <li className="flex items-center gap-2.5"><MessageSquare className="h-5 w-5 shrink-0" /> {tr('Message safely in-app — your number stays private', 'Nhắn tin an toàn — số của bạn được giữ kín')}</li>
            <li className="flex items-center gap-2.5"><ShieldCheck className="h-5 w-5 shrink-0" /> {tr('Spot something off? Report it in one tap', 'Thấy bất thường? Báo cáo chỉ một chạm')}</li>
          </ul>
        </div>
        <p className="relative text-xs text-blue-200">© {new Date().getFullYear()} eno.vn · {tr('Made in Saigon', 'Làm tại Sài Gòn')}</p>
      </div>

      {/* Form column — header/copy centered so every stage (tabs, code entry, the
          "check your email" success) reads as ONE centered composition; the form's
          inputs stay full-width inside the column. A hairline seam in dark mode
          keeps the navy brand panel and the near-black canvas from colliding. */}
      <div className="flex flex-col items-center justify-center px-6 py-12 md:dark:border-l md:dark:border-border/60">
        <div className="w-full max-w-sm text-center">
          <Link href="/" className="mb-8 inline-block text-2xl font-black text-accent-foreground md:hidden">eno.vn</Link>
          <h2 className="text-2xl font-bold text-foreground">{tr('Welcome to eno.vn', 'Chào mừng đến eno.vn')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tr('Sign in or create your account in seconds.', 'Đăng nhập hoặc tạo tài khoản trong vài giây.')}</p>
          <SignInForm className="mt-8 text-left" />
          <Link href="/" className="mt-8 inline-block text-sm font-semibold text-muted-foreground hover:text-accent-foreground">
            ← {tr('Back to eno.vn', 'Về trang chủ')}
          </Link>
          {/* Operator identity — the split layout has no Footer, and Đ.36 wants the
              operator identifiable on every public page. Compact single block. */}
          <p className="mt-6 text-[10px] leading-relaxed text-ink-4">
            {COMPANY.name} · {COMPANY.address} · {tr('Business reg. no.', 'GCN ĐKDN số')}: {COMPANY.erc} · {COMPANY.email}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SignInPageInner />
    </Suspense>
  )
}
