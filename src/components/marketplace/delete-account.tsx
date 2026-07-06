'use client'

import { useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'

// Danger zone — self-service account deletion (PDPL right, /privacy documents the
// schedule). The typed "DELETE" confirmation is required server-side too; this UI
// just keeps honest users from tapping through. Irreversible.
export function DeleteAccount() {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.message || d.error || tr('Something went wrong — try again.', 'Có lỗi xảy ra — thử lại nhé.'))
        setBusy(false)
        return
      }
      // Server already removed the auth user; this clears local session state.
      try { await createSupabaseBrowser().auth.signOut() } catch {}
      window.location.href = '/'
    } catch {
      setError(tr('Something went wrong — try again.', 'Có lỗi xảy ra — thử lại nhé.'))
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-sm leading-relaxed text-body">
        {tr('Permanently delete your account, listings and conversations. This cannot be undone.', 'Xóa vĩnh viễn tài khoản, tin đăng và tin nhắn của bạn. Không thể hoàn tác.')}
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-xl px-4 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950 cursor-pointer"
        >
          {tr('Delete my account', 'Xóa tài khoản của tôi')}
        </button>
      ) : (
        <div className="mt-3 max-w-md space-y-3">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-body">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>
              {tr('Your listings, storefront, chats (both sides of your threads), saved items and profile will be permanently removed, and you will be signed out everywhere. Reviews you wrote stay, anonymized. Records the law requires us to keep (e.g. resolved reports) are retained for the statutory period.', 'Tin đăng, gian hàng, cuộc trò chuyện (cả hai phía trong các cuộc hội thoại của bạn), tin đã lưu và hồ sơ sẽ bị xóa vĩnh viễn, và bạn sẽ bị đăng xuất trên mọi thiết bị. Đánh giá bạn đã viết sẽ được ẩn danh. Hồ sơ pháp luật yêu cầu lưu (ví dụ báo cáo đã xử lý) được giữ theo thời hạn luật định.')}
            </span>
          </p>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              {tr('Type DELETE to confirm', 'Nhập DELETE để xác nhận')}
            </label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className="mt-1 w-full rounded-xl bg-tint px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>
          {error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={confirm !== 'DELETE' || busy}
              onClick={run}
              className={cn(
                'flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition-all active:scale-[0.98] cursor-pointer',
                (confirm !== 'DELETE' || busy) && 'opacity-40 cursor-default',
              )}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {tr('Permanently delete', 'Xóa vĩnh viễn')}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirm(''); setError('') }}
              className="rounded-xl px-4 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted cursor-pointer"
            >
              {tr('Cancel', 'Hủy')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
