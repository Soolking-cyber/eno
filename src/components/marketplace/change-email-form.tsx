'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { createSupabaseBrowser } from '@/lib/supabase/browser'

const FIELD = 'w-full max-w-md rounded-xl px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors hover:bg-muted focus:bg-muted placeholder:text-ink-4'

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
  const [err, setErr] = useState('')

  const submit = async () => {
    const next = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) { setErr(tr('Enter a valid email.', 'Nhập email hợp lệ.')); return }
    if (next === (currentEmail || '').toLowerCase()) { setErr(tr('That is already your email.', 'Đây đã là email của bạn.')); return }
    setErr('')
    setBusy(true)
    try {
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
        <p className="text-xs font-semibold text-emerald-600">{tr('Check your new inbox and click the link to confirm the change.', 'Kiểm tra hộp thư mới và nhấn liên kết để xác nhận thay đổi.')}</p>
      ) : !editing ? (
        <button onClick={() => { setEmail(''); setErr(''); setEditing(true) }} className="text-xs font-bold text-accent-foreground hover:underline cursor-pointer">
          {tr('Change email', 'Đổi email')}
        </button>
      ) : (
        <div className="space-y-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={tr('New email address', 'Địa chỉ email mới')}
            className={FIELD}
          />
          <p className="max-w-md text-xs text-body">{tr("We'll email a confirmation link to the new address — your email changes once you click it.", 'Chúng tôi sẽ gửi liên kết xác nhận tới địa chỉ mới — email đổi sau khi bạn nhấn vào.')}</p>
          {err && <p className="text-xs font-semibold text-destructive">{err}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={submit}
              disabled={busy || !email.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a66c2] px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#004182] disabled:opacity-40 cursor-pointer"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Send confirmation', 'Gửi xác nhận')}
            </button>
            <button onClick={() => { setEditing(false); setErr('') }} className="text-sm font-bold text-body hover:text-foreground cursor-pointer">
              {tr('Cancel', 'Hủy')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
