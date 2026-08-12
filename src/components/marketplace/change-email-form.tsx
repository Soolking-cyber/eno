'use client'

import { useState } from 'react'
import { Loader2 } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'

// Change-email under account Settings. supabase.auth.updateUser({ email }) sends a
// confirmation to the new address (the branded "Change Email" template); the email
// only switches once the user clicks that link. Flat layout — the section heading
// labels it, so no box / no repeated title (monolith single-canvas design).
export function ChangeEmailForm({ currentEmail }: { currentEmail: string | null }) {
  const { tr } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  // `emailErr` is about the VALUE in the box ("not an email", "that's the one you already have") — it is
  // bound to #change-email-input via <Field>, so the control announces as invalid and reads the reason.
  // `err` is what Supabase said about the whole attempt: not a property of the input, so it is announced
  // with role="alert" instead of being described.
  const [err, setErr] = useState('')
  const [emailErr, setEmailErr] = useState('')

  const submit = async () => {
    const next = email.trim().toLowerCase()
    setErr(''); setEmailErr('')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) { setEmailErr(tr('Enter a valid email.', 'Nhập email hợp lệ.')); return }
    if (next === (currentEmail || '').toLowerCase()) { setEmailErr(tr('That is already your email.', 'Đây đã là email của bạn.')); return }
    setBusy(true)
    try {
      // Loaded on demand: supabase-js is ~248 KB and this form is a rarely-used
      // corner of Settings, so it must not sit in the route's first-load bundle.
      const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
      const supabase = createSupabaseBrowser()
      const { error } = await supabase.auth.updateUser(
        { email: next },
        { emailRedirectTo: `${window.location.origin}/dashboard?tab=account` },
      )
      if (error) setErr(error.message || tr('Could not start the change. Try again.', 'Không thể bắt đầu. Thử lại.'))
      else setSent(true)
    } catch {
      setErr(tr('Could not start the change. Try again.', 'Không thể bắt đầu. Thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="truncate text-sm font-semibold text-foreground">{currentEmail || tr('No email on file', 'Chưa có email')}</p>

      {sent ? (
        <p className="text-xs font-semibold text-success">{tr('Check your new inbox and click the link to confirm the change.', 'Kiểm tra hộp thư mới và nhấn liên kết để xác nhận thay đổi.')}</p>
      ) : !editing ? (
        <Button
          variant="link"
          size="none"
          onClick={() => { setEmail(''); setErr(''); setEmailErr(''); setEditing(true) }}
          className="text-xs font-bold text-accent-foreground"
        >
          {tr('Change email', 'Đổi email')}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="max-w-md space-y-1.5">
            {/* ⚠️ type="email" means the browser's NATIVE constraint validation is live on this control,
                and Base UI gates <Field.Error> on that native validity state — which our React-state
                validation never populates. Our <FieldError> pins match={true} precisely so the CALLER
                owns when it exists; that is why the `{emailErr && …}` guard below is required and why
                the two validity sources cannot fight. */}
            <Field invalid={!!emailErr} className="gap-1.5">
              <FieldLabel render={<Label />}>{tr('New email address', 'Địa chỉ email mới')}</FieldLabel>
              <FieldControl id="change-email-input"
                render={
                  <Input
                    id="change-email-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={tr('New email address', 'Địa chỉ email mới')}
                  />
                }
              />
              <FieldDescription className="text-muted-foreground">{tr("We'll email a confirmation link to the new address — your email changes once you click it.", 'Chúng tôi sẽ gửi liên kết xác nhận tới địa chỉ mới — email đổi sau khi bạn nhấn vào.')}</FieldDescription>
              {emailErr && <FieldError className="font-semibold">{emailErr}</FieldError>}
            </Field>
            {/* Supabase's own message is about the ATTEMPT, not the value — announce it, don't describe it. */}
            {err && <p role="alert" className="text-xs font-semibold text-destructive">{err}</p>}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="cta"
              size="none"
              onClick={submit}
              disabled={busy || !email.trim()}
              className="gap-1.5 px-5 py-2"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Send confirmation', 'Gửi xác nhận')}
            </Button>
            <Button
              variant="ghost"
              size="none"
              onClick={() => { setEditing(false); setErr(''); setEmailErr('') }}
              className="px-3 py-2 font-bold text-body hover:bg-transparent hover:text-foreground"
            >
              {tr('Cancel', 'Hủy')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
