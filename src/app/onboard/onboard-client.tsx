'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { User, Store, Loader2, Check } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { LogoWordmark } from '@/components/marketplace/logo-wordmark'
import { safeNextPath } from '@/lib/url'
import { cn } from '@/lib/utils'

type Choice = 'individual' | 'business'

/** One-time post-sign-in step: are you an individual or a business? The choice
 *  shapes the rest of the experience (businesses get the CRM dashboard, bulk
 *  upload and analytics; individuals get a simple account). Simple surface, two
 *  big tap targets — the scientifically-low-friction pattern for a forced choice. */
export function OnboardClient() {
  const { tr } = useLanguage()
  const t = (en: string, vi: string) => tr(en, vi)
  const router = useRouter()
  const params = useSearchParams()
  const { user, loading, accountType, markOnboarded } = useAuth()

  const [choice, setChoice] = useState<Choice | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Resolve ?next to a same-origin path only (open-redirect guard, shared with
  // /signin + the auth callback). Computed lazily so it reads the real
  // window.location.origin on the client rather than an SSR placeholder.
  const rawNext = params.get('next')
  const computeNext = () => safeNextPath(rawNext, window.location.origin)

  // Not signed in → nothing to onboard. Already chose → skip straight through.
  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/'); return }
    if (accountType) router.replace(computeNext())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, accountType, rawNext, router])

  const businessOk = choice !== 'business' || businessName.trim().length >= 2
  const canSubmit = !!choice && businessOk && !submitting

  const submit = async () => {
    if (!canSubmit || !choice) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/profile/account-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType: choice, businessName: choice === 'business' ? businessName.trim() : undefined }),
      })
      if (!res.ok) throw new Error('failed')
      markOnboarded(choice) // updates context so the global gate won't bounce us back
      router.replace(computeNext())
    } catch {
      setSubmitting(false)
      setError(t('Something went wrong. Please try again.', 'Đã xảy ra lỗi. Vui lòng thử lại.'))
    }
  }

  const options: { key: Choice; Icon: typeof User; title: string; desc: string }[] = [
    { key: 'individual', Icon: User, title: t('I’m an individual', 'Tôi là cá nhân'), desc: t('Buy and sell your own items — quick and simple.', 'Mua và bán đồ của bạn — nhanh và đơn giản.') },
    { key: 'business', Icon: Store, title: t('I’m a business', 'Tôi là doanh nghiệp'), desc: t('A storefront, bulk listing, messages and analytics in one place.', 'Gian hàng, đăng tin hàng loạt, tin nhắn và phân tích — tất cả một nơi.') },
  ]

  // Until we know the user is signed in AND still needs to choose, show a neutral
  // loader — never flash the choice card to an already-onboarded user mid-bounce.
  if (loading || !user || accountType) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafafa]">
        <Loader2 className="h-6 w-6 animate-spin text-[#0a66c2]" />
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#fafafa] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <LogoWordmark className="h-9 w-auto" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-center text-xl font-bold text-[#1a202c]">{t('Welcome to eno.vn', 'Chào mừng đến eno.vn')}</h1>
          <p className="mt-1 text-center text-sm text-[#64748b]">{t('How will you use eno.vn? You can ask us to change this later.', 'Bạn sẽ dùng eno.vn như thế nào? Bạn có thể thay đổi sau.')}</p>

          <div className="mt-6 space-y-3">
            {options.map(({ key, Icon, title, desc }) => {
              const active = choice === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChoice(key)}
                  aria-pressed={active}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors cursor-pointer',
                    active ? 'border-[#0a66c2] bg-[#e8f1fb] ring-2 ring-[#0a66c2]/20' : 'border-slate-300 bg-white hover:bg-slate-50',
                  )}
                >
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', active ? 'bg-[#0a66c2] text-white' : 'bg-slate-100 text-[#64748b]')}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-bold text-[#1a202c]">{title}{active && <Check className="h-4 w-4 text-[#0a66c2]" />}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-[#64748b]">{desc}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {choice === 'business' && (
            <div className="mt-4">
              <label htmlFor="biz" className="mb-1 block text-xs font-semibold text-[#475569]">{t('Business name', 'Tên doanh nghiệp')}</label>
              <input
                id="biz"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder={t('e.g. Saigon Moto Rentals', 'vd. Saigon Moto Rentals')}
                maxLength={120}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
              />
            </div>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] disabled:opacity-40 transition-colors cursor-pointer"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {t('Continue', 'Tiếp tục')}
          </button>
          {error && <p role="alert" className="mt-2 text-center text-xs font-semibold text-red-600">{error}</p>}
        </div>
      </div>
    </main>
  )
}
