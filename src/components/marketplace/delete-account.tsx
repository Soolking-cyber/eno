'use client'

import { useState } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field, FieldControl, FieldError, FieldLabel } from '@/components/ui/field'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// Danger zone — self-service account deletion (PDPL right, /privacy documents the
// schedule). The typed "DELETE" confirmation is required server-side too; this UI
// just keeps honest users from tapping through. Irreversible.
export function DeleteAccount() {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  // Two channels again. The server's 400 is a verdict on the TYPED WORD → it belongs to
  // #delete-account-confirm. Everything else (409 under_review, 429, network) is a verdict on the
  // ATTEMPT → form-level. Only ONE of them is a live announcement (role="alert" on the form-level p):
  // the field error is announced by the control itself via aria-invalid + aria-describedby, so adding
  // role="alert" there too would make an alertdialog speak the same sentence twice.
  const [error, setError] = useState('')
  const [confirmErr, setConfirmErr] = useState('')

  const run = async () => {
    setBusy(true); setError(''); setConfirmErr('')
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The server rejects anything but the exact word (the button is also gated on it, so this is
        // the race/tamper path) — that is a per-field failure, and its EN-only server string is
        // replaced by our bilingual copy.
        if (res.status === 400 && d.error === 'Confirmation required') {
          setConfirmErr(tr('Type DELETE to confirm.', 'Nhập DELETE để xác nhận.'))
        } else {
          setError(d.message || d.error || tr('Something went wrong — try again.', 'Có lỗi xảy ra — thử lại nhé.'))
        }
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
      {/* Data access right (PDPL) — download everything we hold about you. */}
      <div className="mb-4">
        <p className="text-sm leading-relaxed text-body">
          {tr('Download a copy of all your eno.vn data.', 'Tải xuống bản sao toàn bộ dữ liệu eno.vn của bạn.')}
        </p>
        {/* font-bold rides on the BUTTON, not the child: asChild goes through Base UI's
            render prop, which CONCATENATES classNames — only the Button's own className
            passes through cn()/twMerge. On the child, font-bold would lose to the base
            font-medium on stylesheet order alone. */}
        <Button asChild variant="ghost" size="none" className="font-bold">
          <a
            href="/api/account/export"
            className="mt-2 inline-block rounded-xl px-4 py-2 text-sm text-accent-foreground transition-colors hover:bg-muted hover:text-accent-foreground cursor-pointer"
          >
            {tr('Export my data', 'Xuất dữ liệu của tôi')}
          </a>
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-body">
        {tr('Permanently delete your account, listings and conversations. This cannot be undone.', 'Xóa vĩnh viễn tài khoản, tin đăng và tin nhắn của bạn. Không thể hoàn tác.')}
      </p>
      <AlertDialog
        open={open}
        onOpenChange={(next) => { setOpen(next); if (!next) { setConfirm(''); setError(''); setConfirmErr('') } }}
      >
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="none"
              className="mt-3 px-4 py-2 font-bold text-destructive hover:bg-destructive/10 hover:text-destructive"
            />
          }
        >
          {tr('Delete my account', 'Xóa tài khoản của tôi')}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>{tr('Delete my account', 'Xóa tài khoản của tôi')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr('Your listings, storefront, chats (both sides of your threads), saved items and profile will be permanently removed, and you will be signed out everywhere. Reviews you wrote stay, anonymized. Records the law requires us to keep (e.g. resolved reports) are retained for the statutory period.', 'Tin đăng, gian hàng, cuộc trò chuyện (cả hai phía trong các cuộc hội thoại của bạn), tin đã lưu và hồ sơ sẽ bị xóa vĩnh viễn, và bạn sẽ bị đăng xuất trên mọi thiết bị. Đánh giá bạn đã viết sẽ được ẩn danh. Hồ sơ pháp luật yêu cầu lưu (ví dụ báo cáo đã xử lý) được giữ theo thời hạn luật định.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Field invalid={!!confirmErr} className="gap-1.5">
              <FieldLabel render={<Label />}>
                {tr('Type DELETE to confirm', 'Nhập DELETE để xác nhận')}
              </FieldLabel>
              <FieldControl id="delete-account-confirm"
                render={
                  <Input
                    id="delete-account-confirm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="DELETE"
                    autoComplete="off"
                    className="focus:ring-destructive/30"
                  />
                }
              />
              {confirmErr && <FieldError className="font-semibold">{confirmErr}</FieldError>}
            </Field>
            {/* The only live announcement in this dialog. The field error above is NOT role="alert" —
                it reaches the user through the control it describes, so the dialog speaks once. */}
            {error && <p role="alert" className="text-xs font-semibold text-destructive">{error}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancel', 'Hủy')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirm !== 'DELETE' || busy}
              onClick={run}
              className="font-bold"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {tr('Permanently delete', 'Xóa vĩnh viễn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
