'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Mail, Phone, Loader2 } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

export function SignInDialog({ open, onOpenChange }: Props) {
  const { tr } = useLanguage()
  const t = (vi: string, en: string) => tr(en, vi)

  const [tab, setTab] = useState<'email' | 'phone'>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'input' | 'code' | 'sent'>('input')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createSupabaseBrowser()
  const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined

  const oauth = async (provider: 'google' | 'facebook') => {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
    if (error) setError(error.message)
  }

  const sendEmail = async () => {
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } })
    setLoading(false)
    if (error) setError(error.message)
    else setStage('sent')
  }

  const sendPhone = async () => {
    setLoading(true); setError('')
    const d = phone.replace(/\D/g, '')
    const intl = d.startsWith('0') ? `+84${d.slice(1)}` : d.startsWith('84') ? `+${d}` : `+${d}`
    const { error } = await supabase.auth.signInWithOtp({ phone: intl })
    setLoading(false)
    if (error) setError(error.message)
    else { setPhone(intl); setStage('code') }
  }

  const verifyPhone = async () => {
    setLoading(true); setError('')
    const { error } = await supabase.auth.verifyOtp({ phone, token: code.trim(), type: 'sms' })
    setLoading(false)
    if (error) setError(error.message)
    // success → onAuthStateChange closes the dialog
  }

  const reset = () => { setStage('input'); setCode(''); setError('') }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="bg-white rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-bold text-[#1a202c]">
            {t('Đăng nhập ENO', 'Sign in to ENO')}
          </DialogTitle>
        </DialogHeader>

        {stage === 'sent' ? (
          <div className="mt-4 text-center">
            <Mail className="mx-auto h-10 w-10 text-[#0a66c2]" />
            <p className="mt-3 text-sm font-semibold text-[#1a202c]">{t('Kiểm tra email của bạn', 'Check your email')}</p>
            <p className="mt-1 text-sm text-[#64748b]">{t('Chúng tôi đã gửi liên kết đăng nhập tới', 'We sent a magic link to')} <strong>{email}</strong>.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {/* OAuth */}
            <button onClick={() => oauth('google')} className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-white py-2.5 text-sm font-bold text-[#1a202c] hover:bg-slate-50 transition-colors cursor-pointer">
              <GoogleIcon /> {t('Tiếp tục với Google', 'Continue with Google')}
            </button>
            <button onClick={() => oauth('facebook')} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1877f2] py-2.5 text-sm font-bold text-white hover:bg-[#0f63d6] transition-colors cursor-pointer">
              <FacebookIcon /> {t('Tiếp tục với Facebook', 'Continue with Facebook')}
            </button>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-[#94a3b8]">{t('hoặc', 'or')}</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            {/* Email / Phone tabs */}
            <div className="flex rounded-full bg-[#f1f5f9] p-1 text-sm font-semibold">
              {(['email', 'phone'] as const).map((m) => (
                <button key={m} onClick={() => { setTab(m); reset() }} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 transition-colors cursor-pointer', tab === m ? 'bg-white text-[#0a66c2] shadow-sm' : 'text-[#64748b]')}>
                  {m === 'email' ? <Mail className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                  {m === 'email' ? tr('Email') : t('Điện thoại', 'Phone')}
                </button>
              ))}
            </div>

            {tab === 'email' && (
              <div className="space-y-2">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20" />
                <button onClick={sendEmail} disabled={loading || !email.includes('@')} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] disabled:opacity-40 transition-colors cursor-pointer">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Gửi liên kết đăng nhập', 'Send magic link')}
                </button>
              </div>
            )}

            {tab === 'phone' && stage === 'input' && (
              <div className="space-y-2">
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0901 234 567" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20" />
                <button onClick={sendPhone} disabled={loading || phone.replace(/\D/g, '').length < 9} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] disabled:opacity-40 transition-colors cursor-pointer">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Gửi mã SMS', 'Send SMS code')}
                </button>
              </div>
            )}

            {tab === 'phone' && stage === 'code' && (
              <div className="space-y-2">
                <p className="text-xs text-[#64748b]">{t('Nhập mã gửi tới', 'Enter the code sent to')} {phone}</p>
                <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20" />
                <button onClick={verifyPhone} disabled={loading || code.length < 4} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] disabled:opacity-40 transition-colors cursor-pointer">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />} {t('Xác nhận', 'Verify')}
                </button>
              </div>
            )}

            {error && <p role="alert" className="text-center text-xs font-semibold text-red-600">{error}</p>}
            <p className="pt-1 text-center text-[11px] text-[#94a3b8]">{t('Tiếp tục nghĩa là bạn đồng ý với Điều khoản của ENO.', 'By continuing you agree to ENO’s Terms.')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z"/></svg>
  )
}
function FacebookIcon() {
  return <svg className="h-4 w-4 fill-white" viewBox="0 0 24 24"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6 4.39 10.97 10.13 11.85v-8.38H7.08v-3.47h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.26h3.32l-.53 3.47h-2.79v8.38C19.61 23.04 24 18.07 24 12.07Z"/></svg>
}
