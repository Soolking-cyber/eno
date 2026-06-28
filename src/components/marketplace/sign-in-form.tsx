'use client'

import { useEffect, useRef, useState } from 'react'
import { Mail, Phone, Loader2, ExternalLink } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { useLanguage } from '@/context/language-context'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { googleOauthBlocked, openInSystemBrowser } from '@/lib/in-app-browser'

const RESEND_SECONDS = 60

/** All sign-in logic + UI, with NO outer chrome — rendered by both the modal
 *  (SignInDialog) and the dedicated /signin page so they share identical
 *  handlers (Google OAuth, email magic-link, phone OTP). */
export function SignInForm({ className }: { className?: string }) {
  const { tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)

  const [tab, setTab] = useState<'email' | 'phone'>('phone')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'input' | 'code' | 'sent'>('input')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const lastSubmitted = useRef('')
  // Google blocks OAuth inside in-app browsers / iOS PWAs (403 disallowed_useragent).
  // Detect that client-side and hand off to the real browser instead of dead-ending.
  const [oauthBlocked, setOauthBlocked] = useState(false)
  const [iosHint, setIosHint] = useState(false)
  useEffect(() => { setOauthBlocked(googleOauthBlocked()) }, [])

  const supabase = createSupabaseBrowser()
  // Return the user to the page they triggered sign-in from (continuum of their
  // action) — not always home. Phone OTP stays in place (no redirect; the modal
  // just closes); OAuth + magic-link round-trip through /auth/callback, which
  // honors this ?next (and threads it through onboarding).
  const redirectTo = (() => {
    if (typeof window === 'undefined') return undefined
    const { origin, pathname, search } = window.location
    let next = pathname + search
    if (pathname === '/signin') next = new URLSearchParams(search).get('next') || '/' // use the intended dest, not /signin
    if (pathname.startsWith('/auth') || pathname.startsWith('/onboard')) next = '/'
    return `${origin}/auth/callback?next=${encodeURIComponent(next)}`
  })()

  // Resend countdown tick.
  useEffect(() => {
    if (countdown <= 0) return
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [countdown])

  // Re-open the sign-in page in the device's real browser (escaping the in-app
  // webview), preserving where the user wanted to go.
  const openGoogleInBrowser = () => {
    if (typeof window === 'undefined') return
    const { origin, pathname, search } = window.location
    let next = pathname + search
    if (pathname === '/signin') next = new URLSearchParams(search).get('next') || '/'
    if (pathname.startsWith('/auth') || pathname.startsWith('/onboard')) next = '/'
    const handed = openInSystemBrowser(`${origin}/signin?next=${encodeURIComponent(next)}`)
    if (!handed) setIosHint(true) // iOS can't auto-escape a webview → show the manual hint
  }

  const oauth = async (provider: 'google') => {
    // In an in-app browser / iOS PWA, OAuth is rejected (disallowed_useragent) — break
    // out to the real browser instead of letting Google show its block page.
    if (oauthBlocked) { openGoogleInBrowser(); return }
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
    if (error) setError(error.message)
  }

  const sendEmail = async () => {
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } })
    setLoading(false)
    if (error) setError(error.message)
    else { setStage('sent'); setCountdown(RESEND_SECONDS) }
  }

  const sendPhone = async () => {
    setLoading(true); setError('')
    const d = phone.replace(/\D/g, '')
    const intl = d.startsWith('0') ? `+84${d.slice(1)}` : d.startsWith('84') ? `+${d}` : `+${d}`
    const { error } = await supabase.auth.signInWithOtp({ phone: intl })
    setLoading(false)
    if (error) { setError(error.message); return }
    setPhone(intl); setCode(''); lastSubmitted.current = ''
    setStage('code'); setCountdown(RESEND_SECONDS)
  }

  const verifyPhone = async (c = code) => {
    setLoading(true); setError('')
    const { error } = await supabase.auth.verifyOtp({ phone, token: c.trim(), type: 'sms' })
    setLoading(false)
    if (error) { setError(error.message); lastSubmitted.current = '' }
    // success → auth-context onAuthStateChange closes the modal / the page redirects
  }

  // Auto-submit once 6 digits are in (guarded so a failed code can be retried,
  // and the same code never double-submits).
  const onCodeComplete = (val: string) => {
    if (loading || val === lastSubmitted.current) return
    lastSubmitted.current = val
    verifyPhone(val)
  }

  // WebOTP: on Android Chrome, read the incoming SMS one-time code and auto-fill +
  // submit it — zero typing. Progressive enhancement only: unsupported browsers
  // (iOS/desktop) are unaffected and still get keyboard autofill via the input's
  // autocomplete="one-time-code". The request is aborted when leaving the code
  // stage so it never lingers.
  useEffect(() => {
    if (stage !== 'code') return
    if (typeof window === 'undefined' || !('OTPCredential' in window)) return
    const ac = new AbortController()
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions)
      .then((cred) => {
        const otp = (cred as { code?: string } | null)?.code
        if (otp) { setCode(otp); onCodeComplete(otp) }
      })
      .catch(() => { /* aborted, no SMS, or denied — manual entry still works */ })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const reset = () => { setStage('input'); setCode(''); setError(''); lastSubmitted.current = '' }

  if (stage === 'sent') {
    return (
      <div className={cn('text-center', className)}>
        <Mail className="mx-auto h-10 w-10 text-accent-foreground" />
        <p className="mt-3 text-sm font-semibold text-foreground">{t('Kiểm tra email của bạn', 'Check your email')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('Chúng tôi đã gửi liên kết đăng nhập tới', 'We sent a magic link to')} <strong>{email}</strong>.</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('Không thấy email? Kiểm tra spam, hoặc', "Didn't get it? Check spam, or")}{' '}
          <button onClick={sendEmail} disabled={countdown > 0 || loading} className="font-semibold text-accent-foreground hover:underline disabled:text-ink-4 disabled:no-underline cursor-pointer disabled:cursor-default">
            {countdown > 0 ? `${t('gửi lại sau', 'resend in')} 0:${String(countdown).padStart(2, '0')}` : t('gửi lại', 'resend')}
          </button>
        </p>
        {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
        <button onClick={reset} className="mt-3 text-sm font-semibold text-accent-foreground hover:underline cursor-pointer">
          {t('Dùng cách khác', 'Use another method')}
        </button>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* OAuth — in an in-app browser / iOS PWA, Google rejects OAuth, so this hands
          off to the real browser (Android: automatic; iOS: shows the manual hint). */}
      <button onClick={() => oauth('google')} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-foreground hover:bg-muted transition-colors cursor-pointer">
        <GoogleIcon /> {oauthBlocked ? t('Mở Google trong trình duyệt', 'Open Google in your browser') : t('Tiếp tục với Google', 'Continue with Google')}
        {oauthBlocked && <ExternalLink className="h-3.5 w-3.5 text-ink-4" />}
      </button>
      {oauthBlocked && (
        <p className="rounded-xl bg-tint px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {iosHint
            ? t('Chạm ••• ở trên rồi chọn “Mở trong Safari”, sau đó đăng nhập với Google. Hoặc dùng SĐT/email bên dưới — vẫn hoạt động ngay tại đây.', 'Tap ••• at the top, choose “Open in Safari/Browser”, then sign in with Google. Or just use Phone/Email below — they work right here.')
            : t('Google chỉ hoạt động trong trình duyệt thật. Dùng SĐT hoặc email bên dưới — vẫn hoạt động ngay tại đây.', 'Google sign-in needs your real browser. Phone or email below work right here.')}
        </p>
      )}

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-ink-4">{t('hoặc', 'or')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Email / Phone tabs */}
      <div className="flex rounded-full bg-tint p-1 text-sm font-semibold">
        {(['phone', 'email'] as const).map((m) => (
          <button key={m} onClick={() => { setTab(m); reset() }} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 transition-colors cursor-pointer', tab === m ? 'bg-card text-accent-foreground shadow-sm' : 'text-muted-foreground')}>
            {m === 'email' ? <Mail className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
            {m === 'email' ? tr('Email') : t('Điện thoại', 'Phone')}
          </button>
        ))}
      </div>

      {tab === 'email' && (
        <div className="space-y-2">
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className="w-full rounded-xl bg-tint px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" />
          <Button variant="cta" size="none" onClick={sendEmail} disabled={loading || !email.includes('@')} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-40 transition-colors cursor-pointer">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Gửi liên kết đăng nhập', 'Send magic link')}
          </Button>
        </div>
      )}

      {tab === 'phone' && stage === 'input' && (
        <div className="space-y-2">
          <input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && phone.replace(/\D/g, '').length >= 9) sendPhone() }} placeholder="0901 234 567" className="w-full rounded-xl bg-tint px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" />
          <Button variant="cta" size="none" onClick={sendPhone} disabled={loading || phone.replace(/\D/g, '').length < 9} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-40 transition-colors cursor-pointer">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Gửi mã SMS', 'Send SMS code')}
          </Button>
        </div>
      )}

      {tab === 'phone' && stage === 'code' && (
        <div className="space-y-3">
          <p className="text-center text-xs text-muted-foreground">{t('Nhập mã 6 số gửi tới', 'Enter the 6-digit code sent to')} <strong className="text-foreground">{phone}</strong></p>
          <InputOTP maxLength={6} value={code} onChange={setCode} onComplete={onCodeComplete} autoFocus autoComplete="one-time-code" inputMode="numeric" containerClassName="justify-center" disabled={loading}>
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} className="h-12 w-12 text-lg font-semibold data-[active=true]:border-brand data-[active=true]:ring-brand/30" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <Button variant="cta" size="none" onClick={() => verifyPhone()} disabled={loading || code.length < 6} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-40 transition-colors cursor-pointer">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Xác nhận', 'Verify')}
          </Button>
          <div className="flex items-center justify-between px-1 text-xs">
            <button onClick={reset} className="font-semibold text-muted-foreground hover:text-accent-foreground cursor-pointer">{t('Đổi số', 'Change number')}</button>
            <button onClick={sendPhone} disabled={countdown > 0 || loading} className="font-semibold text-accent-foreground hover:underline disabled:text-ink-4 disabled:no-underline cursor-pointer disabled:cursor-default">
              {countdown > 0 ? `${t('Gửi lại sau', 'Resend in')} 0:${String(countdown).padStart(2, '0')}` : t('Gửi lại mã', 'Resend code')}
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-center text-xs font-semibold text-red-600">{error}</p>}
      <p className="pt-1 text-center text-[11px] text-ink-4">
        {t('Tiếp tục nghĩa là bạn đồng ý với', 'By continuing you agree to our')}{' '}
        <a href="/terms" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 hover:text-accent-foreground">{t('Điều khoản', 'Terms')}</a>
        {' '}{t('và', 'and')}{' '}
        <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 hover:text-accent-foreground">{t('Chính sách bảo mật', 'Privacy Policy')}</a>.
      </p>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z"/></svg>
  )
}
