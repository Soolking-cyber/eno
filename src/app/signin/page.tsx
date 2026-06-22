'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShieldCheck, MessageSquare, BadgeCheck } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInForm } from '@/components/marketplace/sign-in-form'
import { safeNextPath } from '@/lib/url'

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
    <div className="grid min-h-screen w-full bg-[#fafafa] md:grid-cols-2">
      {/* Brand panel (desktop) */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0a66c2] to-[#004182] p-12 text-white md:flex">
        <Link href="/" className="text-2xl font-black tracking-tight">eno.vn</Link>
        <div>
          <h1 className="text-4xl font-black leading-tight">{tr('e-commerce with no drama', 'Mua bán không drama.')}</h1>
          <p className="mt-3 max-w-sm text-[15px] text-blue-100">
            {tr("The verified marketplace for Vietnam's international community.", 'Chợ trực tuyến đã xác minh cho cộng đồng quốc tế tại Việt Nam.')}
          </p>
          <ul className="mt-8 space-y-3 text-sm text-blue-50">
            <li className="flex items-center gap-2.5"><BadgeCheck className="h-5 w-5 shrink-0" /> {tr('Every listing verified before it goes live', 'Mọi tin được xác minh trước khi đăng')}</li>
            <li className="flex items-center gap-2.5"><MessageSquare className="h-5 w-5 shrink-0" /> {tr('Message sellers safely, in-app', 'Nhắn tin an toàn với người bán')}</li>
            <li className="flex items-center gap-2.5"><ShieldCheck className="h-5 w-5 shrink-0" /> {tr('No fakes, no bait prices, no wasted trips', 'Không hàng giả, không giá ảo')}</li>
          </ul>
        </div>
        <p className="text-xs text-blue-200">© 2026 eno.vn · Made in Saigon</p>
      </div>

      {/* Form */}
      <div className="flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 inline-block text-2xl font-black text-[#0a66c2] md:hidden">eno.vn</Link>
          <h2 className="text-2xl font-bold text-[#1a202c]">{tr('Welcome to eno.vn', 'Chào mừng đến eno.vn')}</h2>
          <p className="mt-1 text-sm text-[#64748b]">{tr('Sign in or create your account in seconds.', 'Đăng nhập hoặc tạo tài khoản trong vài giây.')}</p>
          <SignInForm className="mt-6" />
          <Link href="/" className="mt-6 block text-center text-sm font-semibold text-[#64748b] hover:text-[#0a66c2]">
            ← {tr('Back to eno.vn', 'Về trang chủ')}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fafafa]" />}>
      <SignInPageInner />
    </Suspense>
  )
}
