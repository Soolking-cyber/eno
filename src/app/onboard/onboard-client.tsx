'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { User, Store, Loader2, Check } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Mascot } from '@/components/marketplace/mascot'
import { safeNextPath } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { RadioGroup, Radio } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field, FieldControl, FieldError, FieldLabel } from '@/components/ui/field'

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
  const { user, loading, accountType, identityLoaded, markOnboarded } = useAuth()

  const [choice, setChoice] = useState<Choice | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Two error channels, deliberately. `error` is FORM-level ("something went wrong") — it belongs to
  // no input, so it is ANNOUNCED via role="alert". `fieldErr` holds the server's per-field rejections
  // (business_name_required → #biz, phone_taken → #ph); those are wired into the control's
  // aria-invalid + aria-describedby by <Field>, which is how a screen reader learns WHICH field is
  // wrong and WHY. A per-field message only routes to a field that is actually RENDERED — see submit().
  const [error, setError] = useState('')
  const [fieldErr, setFieldErr] = useState<{ biz?: string; ph?: string }>({})

  // Prefill the name from the OAuth profile + phone from a verified OTP login.
  useEffect(() => {
    const m = (user?.user_metadata ?? {}) as { full_name?: string; name?: string }
    if (m.full_name || m.name) setName((p) => p || m.full_name || m.name || '')
    if (user?.phone) setPhone((p) => p || user.phone || '')
  }, [user])

  // Resolve ?next to a same-origin path only (open-redirect guard, shared with
  // /signin + the auth callback). Computed lazily so it reads the real
  // window.location.origin on the client rather than an SSR placeholder.
  const rawNext = params.get('next')
  const computeNext = () => safeNextPath(rawNext, window.location.origin)

  // Not signed in → nothing to onboard. Already chose → skip straight through.
  //
  // ⚠️ WAITS FOR `identityLoaded`, NOT JUST `loading`. `loading` is the SESSION's flag; it goes
  // false as soon as Supabase resolves, while `/api/me` — the only thing that knows accountType —
  // is still in flight. In that window `accountType` is null for an ONBOARDED user, so bouncing on
  // `loading` alone both failed to redirect them and (below) rendered the chooser at them.
  useEffect(() => {
    if (loading || !identityLoaded) return
    if (!user) { router.replace('/'); return }
    if (accountType) router.replace(computeNext())
  }, [loading, identityLoaded, user, accountType, rawNext, router])

  const nameOk = name.trim().length >= 2
  const phoneOk = phone.replace(/\D/g, '').length >= 9
  const businessOk = choice !== 'business' || (businessName.trim().length >= 2 && phoneOk)
  const canSubmit = !!choice && nameOk && businessOk && !submitting

  const submit = async () => {
    if (!canSubmit || !choice) return
    setSubmitting(true); setError(''); setFieldErr({})
    try {
      const res = await fetch('/api/profile/account-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountType: choice,
          displayName: name.trim(),
          businessName: choice === 'business' ? businessName.trim() : undefined,
          phone: phone.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSubmitting(false)
        // The per-field inputs only exist in the BUSINESS branch — an individual still POSTs the phone
        // prefilled from their OTP login, so `phone_taken` can come back with no #ph on screen. Routing
        // it to a field that isn't rendered would swallow the message entirely; fall back to form-level.
        const hasFields = choice === 'business'
        if (hasFields && data?.error === 'phone_taken') {
          setFieldErr({ ph: t('This phone number is already used by another account. Try a different one.', 'Số điện thoại này đã được tài khoản khác sử dụng. Hãy dùng số khác.') })
        } else if (hasFields && data?.error === 'business_name_required') {
          setFieldErr({ biz: t('Please enter your business name.', 'Vui lòng nhập tên doanh nghiệp.') })
        } else if (data?.error === 'phone_taken') {
          setError(t('This phone number is already used by another account. Try a different one.', 'Số điện thoại này đã được tài khoản khác sử dụng. Hãy dùng số khác.'))
        } else {
          setError(t('Something went wrong. Please try again.', 'Đã xảy ra lỗi. Vui lòng thử lại.'))
        }
        return
      }
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
  //
  // ⚠️ `!identityLoaded` IS THE HALF THAT WAS MISSING, and its absence is what the owner saw on
  // 2026-07-27: signed in, `accountType: 'business'`, a live storefront — and the "How will you use
  // eno.vn?" chooser on screen. The comment above already promised this behaviour; the condition
  // could not deliver it, because between the session resolving and /api/me answering,
  // `accountType` is null and every term here was false. Worse than cosmetic: choosing in that
  // window POSTs a fresh account type over an existing one, so a business could be silently
  // downgraded to an individual. Fail CLOSED — show the loader until identity is actually known.
  if (loading || !identityLoaded || !user || accountType) {
    return (
      <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent-foreground" />
      </main>
    )
  }

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-center">
          <Mascot name="profile" className="h-44 w-44" />
        </div>
        <div>
          <h1 className="text-center text-xl font-bold text-foreground">{t('Welcome to eno.vn', 'Chào mừng đến eno.vn')}</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">{t('How will you use eno.vn? You can ask us to change this later.', 'Bạn sẽ dùng eno.vn như thế nào? Bạn có thể thay đổi sau.')}</p>

          {/* Account type is a single-select RADIO GROUP, not a pile of toggles. Selecting is NOT
              destructive here — a choice only reveals the matching profile fields below, nothing is
              wiped — so ui/radio-group is the honest model: real role="radiogroup" + role="radio" +
              aria-checked + roving arrow keys, replacing two unrelated aria-pressed <Button>s that
              announced no group and no selected state. The big-card look is unchanged (same classes).
              ⚠️ flex/gap, NOT space-y: Base UI's Radio.Root emits a hidden <input> sibling, and
              space-y-* (`> :not(:last-child)`) would hand that invisible last child the margin
              exemption and shift the cards. */}
          <RadioGroup
            value={choice ?? undefined}
            onValueChange={(v) => setChoice(v as Choice)}
            aria-label={t('Account type', 'Loại tài khoản')}
            className="mt-6 flex flex-col gap-3"
          >
            {options.map(({ key, Icon, title, desc }) => {
              const active = choice === key
              return (
                <Radio
                  key={key}
                  value={key}
                  className={cn(
                    'flex w-full items-start justify-start gap-3 whitespace-normal rounded-2xl p-4 text-left transition-colors',
                    active ? 'bg-accent ring-2 ring-brand/30' : 'hover:bg-muted',
                  )}
                >
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', active ? 'bg-primary text-white' : 'text-muted-foreground')}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-bold text-foreground">{title}{active && <Check className="h-4 w-4 text-accent-foreground" />}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{desc}</span>
                  </span>
                </Radio>
              )
            })}
          </RadioGroup>

          {/* Profile fields revealed once a type is chosen. The two branches are MUTUALLY EXCLUSIVE and
              must stay that way: both render an input with id="nm", so if they ever rendered together
              the document would carry a duplicate id and every label/aria-describedby pointing at "nm"
              would resolve to the wrong node. The ids are passed EXPLICITLY (Field would otherwise mint
              its own) because they are the ones the server's per-field errors are routed to. */}
          {choice === 'individual' && (
            <Field className="mt-5 gap-1">
              <FieldLabel render={<Label />} className="text-xs font-semibold text-body">{t('Your name', 'Tên của bạn')}</FieldLabel>
              <FieldControl id="nm" render={<Input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Minh', 'vd. Minh')} maxLength={80} className="transition-colors" />} />
            </Field>
          )}
          {choice === 'business' && (
            <div className="mt-5 space-y-3">
              <Field invalid={!!fieldErr.biz} className="gap-1">
                <FieldLabel render={<Label />} className="text-xs font-semibold text-body">{t('Business name', 'Tên doanh nghiệp')}</FieldLabel>
                <FieldControl id="biz" render={<Input id="biz" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder={t('e.g. Saigon Moto Rentals', 'vd. Saigon Moto Rentals')} maxLength={120} className="transition-colors" />} />
                {fieldErr.biz && <FieldError className="font-semibold">{fieldErr.biz}</FieldError>}
              </Field>
              <Field className="gap-1">
                <FieldLabel render={<Label />} className="text-xs font-semibold text-body">{t('Your name (contact person)', 'Tên người liên hệ')}</FieldLabel>
                <FieldControl id="nm" render={<Input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Minh', 'vd. Minh')} maxLength={80} className="transition-colors" />} />
              </Field>
              <Field invalid={!!fieldErr.ph} className="gap-1">
                <FieldLabel render={<Label />} className="text-xs font-semibold text-body">{t('Phone / Zalo', 'Số điện thoại / Zalo')}</FieldLabel>
                <FieldControl id="ph" render={<Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="0901 234 567" maxLength={20} className="transition-colors" />} />
                {fieldErr.ph && <FieldError className="font-semibold">{fieldErr.ph}</FieldError>}
              </Field>
            </div>
          )}

          <Button variant="cta" size="none"
            onClick={submit}
            disabled={!canSubmit}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-40 transition-colors cursor-pointer"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {t('Continue', 'Tiếp tục')}
          </Button>
          {/* ⚠️ THIS LINE IS THE ASSENT ITSELF, NOT DECORATION — DO NOT REMOVE IT.
              Submitting this form writes `tosAcceptedAt` and `tosVersion` to the profile, and those
              two columns exist to be EVIDENCE of what a person agreed to and when (E-Transactions
              Law). Until 2026-08-01 the route recorded that agreement while this screen mentioned
              the Terms nowhere at all — the record asserted an assent the user was never asked for
              and never saw. An external review caught it; every gate had passed.
              So the rule is simple: as long as the route stamps acceptance here, this screen must
              say what is being accepted and link to it. If the assent ever moves to an explicit
              checkbox, move the stamp with it. */}
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {t('By continuing you agree to our ', 'Bằng việc tiếp tục, bạn đồng ý với ')}
            <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
              {t('Terms of Service', 'Điều khoản dịch vụ')}
            </Link>
            {t(' and ', ' và ')}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
              {t('Privacy Policy', 'Chính sách bảo mật')}
            </Link>
            .
          </p>
          {error && <p role="alert" className="mt-2 text-center text-xs font-semibold text-destructive">{error}</p>}
        </div>
      </div>
    </main>
  )
}
