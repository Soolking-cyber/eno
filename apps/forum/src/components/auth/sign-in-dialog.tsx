'use client'

import { useState } from 'react'
import { Loader2, LogIn, Mail, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { useTurnstile } from './turnstile'

export function SignInDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { tr } = useLanguage()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState<'email' | 'google' | null>(null)
  const [sent, setSent] = useState(false)
  const { getToken, Widget } = useTurnstile()

  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname + window.location.search)}`

  const sendMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(value)) return
    setLoading('email')
    const captchaToken = await getToken()
    const { error } = await createSupabaseBrowser().auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: callbackUrl(), captchaToken },
    })
    setLoading(null)
    if (error) {
      toast.error(tr('Could not send the sign-in link.', 'Không thể gửi liên kết đăng nhập.'))
      return
    }
    setSent(true)
  }

  const signInWithGoogle = async () => {
    setLoading('google')
    const { error } = await createSupabaseBrowser().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl() },
    })
    if (error) {
      setLoading(null)
      toast.error(tr('Google sign-in is unavailable.', 'Đăng nhập Google hiện không khả dụng.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setSent(false) }}>
      <DialogContent className="bg-card sm:max-w-md">
        <DialogHeader>
          <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <LogIn className="h-5 w-5" />
          </span>
          <DialogTitle>{tr('One eno account, everywhere.', 'Một tài khoản eno, dùng mọi nơi.')}</DialogTitle>
          <DialogDescription>
            {tr('Use the same account as the eno.vn marketplace. Your trust and community reputation stay connected.', 'Dùng cùng tài khoản với chợ eno.vn. Uy tín và danh tiếng cộng đồng luôn được kết nối.')}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="rounded-xl bg-accent p-4 text-sm text-accent-foreground">
            <p className="font-bold">{tr('Check your inbox', 'Kiểm tra hộp thư')}</p>
            <p className="mt-1 leading-relaxed">{tr(`We sent a secure sign-in link to ${email.trim()}.`, `Chúng tôi đã gửi liên kết đăng nhập an toàn đến ${email.trim()}.`)}</p>
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-4">
            <Field>
              <FieldLabel>{tr('Email address', 'Địa chỉ email')}</FieldLabel>
              <FieldControl render={<Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />} />
            </Field>
            <Button type="submit" variant="cta" className="w-full" disabled={Boolean(loading)}>
              {loading === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {tr('Email me a sign-in link', 'Gửi liên kết đăng nhập')}
            </Button>
            <div className="flex items-center gap-3 text-2xs text-body"><span className="h-px flex-1 bg-border" />{tr('or', 'hoặc')}<span className="h-px flex-1 bg-border" /></div>
            <Button type="button" variant="outline" className="w-full" onClick={signInWithGoogle} disabled={Boolean(loading)}>
              {loading === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-base font-bold">G</span>}
              {tr('Continue with Google', 'Tiếp tục với Google')}
            </Button>
            <Widget />
          </form>
        )}

        <p className="flex gap-2 text-2xs leading-relaxed text-body">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-foreground" />
          {tr('Authentication is handled by the same secure Supabase project as eno.vn.', 'Đăng nhập được xử lý bởi cùng dự án Supabase an toàn như eno.vn.')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
