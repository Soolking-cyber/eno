'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Ban } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
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
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { appReviewGate } from '@/lib/app-review-gates'
import { cn } from '@/lib/utils'

/**
 * "Block" — the sibling of <ReportButton> in the chat header and on a storefront (App Store Guideline
 * 1.2, plan R3). Renders NOTHING unless the `ugc-safety` review gate is on (src/lib/app-review-gates.ts).
 *
 * It names a THREAD or a SHOP, never a person: /api/blocks resolves who is behind it, so the client
 * never needs the other party's profile id. What a block does is spelled out in the confirmation —
 * including that moderators are told, which is what Apple asks for and what src/lib/user-blocks.ts does.
 *
 * Styled as Report's quiet sibling: the same flush pill, in the muted ink rather than the red, so the
 * two read as a pair without Block shouting as loudly as a report.
 */
export function BlockUserButton({ conversationId, sellerId, name, className, onBlocked }: {
  conversationId?: string
  sellerId?: string
  /** Who will be blocked, for the confirmation title. */
  name?: string | null
  className?: string
  onBlocked?: () => void
}) {
  const { tr } = useLanguage()
  const { openSignIn } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!appReviewGate('ugc-safety') || (!conversationId && !sellerId)) return null

  const run = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(conversationId ? { conversationId } : { sellerId }), blocked: true }),
      })
      if (res.status === 401) { setOpen(false); openSignIn(); return }
      if (!res.ok) {
        const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
        setError(code === 'cannot_block_self'
          ? tr('This is your own account.', 'Đây là tài khoản của bạn.')
          : code === 'cannot_block_staff'
            ? tr('This is the eno team. If something is wrong, use Report instead.', 'Đây là đội ngũ eno. Nếu có vấn đề, hãy dùng Báo cáo.')
            : code === 'not_found'
              ? tr('There is no one to block here — this shop is not run by a member.', 'Không có ai để chặn ở đây — cửa hàng này không do thành viên quản lý.')
            : tr('Could not block right now — please try again.', 'Chưa chặn được — vui lòng thử lại.'))
        return
      }
      setOpen(false)
      toast.success(tr('Blocked. You can unblock them in Settings.', 'Đã chặn. Bạn có thể bỏ chặn trong Cài đặt.'))
      onBlocked?.()
    } catch {
      setError(tr('Could not block right now — please try again.', 'Chưa chặn được — vui lòng thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError('') }}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="bare"
            size="none"
            className={cn(
              'relative tap-44 gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              className,
            )}
          />
        }
      >
        <Ban className="h-3.5 w-3.5" /> {tr('Block', 'Chặn')}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Ban />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {name ? `${tr('Block', 'Chặn')} ${name}?` : tr('Block this user?', 'Chặn người dùng này?')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tr(
              'They will not be able to message you or send you offers, and you will not be able to message them. Conversations with them leave your inbox. Our moderators are told so they can look into it. You can unblock them any time in Settings.',
              'Người này sẽ không thể nhắn tin hay gửi trả giá cho bạn, và bạn cũng không thể nhắn tin cho họ. Các cuộc trò chuyện với họ sẽ rời khỏi hộp thư của bạn. Đội kiểm duyệt sẽ được thông báo để xem xét. Bạn có thể bỏ chặn bất cứ lúc nào trong Cài đặt.',
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{tr('Cancel', 'Hủy')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={run}>
            {tr('Block', 'Chặn')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
