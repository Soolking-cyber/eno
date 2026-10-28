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
import { hiddenSellersOwner, hideSellerNow, syncHiddenSellers } from '@/lib/hidden-sellers'
import { cn } from '@/lib/utils'

/**
 * "Block" — the sibling of <ReportButton> wherever Report stands on someone else's content: the chat header, every
 * storefront and every listing page (App Store Guideline 1.2, plan R3). Renders NOTHING unless the `ugc-safety` review
 * gate is on (src/lib/app-review-gates.ts).
 *
 * It names a THREAD or a SHOP (with the LISTING it was tapped on, for the moderator note), never a person: /api/blocks
 * resolves who is behind it, so the client never needs the other party's profile id. A shop nobody blockable runs — an
 * imported "Linked shop", a partner's, eno's own — is blocked as a shop (Apple's 2026-10-28 rejection was a Linked shop
 * with Report and no Block). What a block does is spelled out in the confirmation — including that moderators are told
 * and that the shop's listings disappear, which is what Apple asks for and what src/lib/user-blocks.ts does.
 * ⛔ THE CONTENT GOES THE MOMENT THE BLOCK ANSWERS: hideSellerNow hides the shop's cards, listing pages and storefront on
 * this page at once (src/lib/hidden-sellers.ts), then a sync brings in what the server knows (a chat block's shop).
 *
 * Styled as Report's quiet sibling: the same flush pill, in the muted ink rather than the red, so the
 * two read as a pair without Block shouting as loudly as a report.
 */
export function BlockUserButton({ conversationId, sellerId, listingId, shopOnly = false, name, className, onBlocked }: {
  conversationId?: string
  sellerId?: string
  /** The listing page this was tapped on (with `sellerId`) — the moderator note names it. */
  listingId?: string
  /**
   * Nobody blockable runs this shop (no owner, or the eno team — src/lib/user-blocks.ts isShopOnlyBlock), so the block
   * hides its listings and tells moderators, and closes no conversation. The page decides it on the server; it only
   * picks the words, which must not promise what a shop block does not do (codex + opus, review).
   */
  shopOnly?: boolean
  /** Who will be blocked, for the confirmation title. */
  name?: string | null
  className?: string
  onBlocked?: () => void
}) {
  const { tr } = useLanguage()
  const { openSignIn, user, sellerId: ownSellerId } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Not on the viewer's OWN shop or listing — the server would only answer cannot_block_self.
  if (!appReviewGate('ugc-safety') || (!conversationId && !sellerId) || (!!sellerId && sellerId === ownSellerId)) return null

  const run = async () => {
    const uid = user?.id ?? null
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(conversationId ? { conversationId } : { sellerId, ...(listingId ? { listingId } : {}) }), blocked: true }),
      })
      if (res.status === 401) { setOpen(false); openSignIn(); return }
      if (!res.ok) {
        const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
        setError(code === 'cannot_block_self'
          ? tr('This is your own account.', 'Đây là tài khoản của bạn.')
          : code === 'cannot_block_staff'
            ? tr('This is the eno team. If something is wrong, use Report instead.', 'Đây là đội ngũ eno. Nếu có vấn đề, hãy dùng Báo cáo.')
            : tr('Could not block right now — please try again.', 'Chưa chặn được — vui lòng thử lại.'))
        return
      }
      setOpen(false)
      // Only for the account that clicked, if the hidden list is still that account's (codex + opus, review): AuthProvider
      // re-claims it on every sign-in, sign-out and switch, so a request that answers afterwards — even from an unmounted
      // button — touches nothing. Hide first, then the sync brings in what the server knows.
      if (uid && hiddenSellersOwner() === uid) {
        if (sellerId) hideSellerNow(sellerId, uid)
        void syncHiddenSellers(uid)
        // On the listing page or storefront the content is now swapped for "You blocked this seller" at the TOP of a page
        // that just lost its body — bring the reader to it, or they are left looking at the footer (preview, 2026-10-29).
        // No selector built from the id (nothing to escape, nothing that can throw after the block has succeeded).
        if (sellerId && [...document.querySelectorAll('[data-sid-notice]')].some((el) => el.getAttribute('data-sid-notice') === sellerId)) {
          window.scrollTo({ top: 0 })
        }
      }
      // ⚠️ Only a block made on a SHOP's page promises its listings go (opus, review): one made in a chat hides the
      // thread's shop only when the viewer was the buyer there, so its words promise the chat, not the listings.
      toast.success(shopOnly
        ? tr('Blocked. This shop\'s listings are hidden, and our moderators have been told. You can unblock it in Settings.', 'Đã chặn. Tin đăng của cửa hàng này đã được ẩn và đội kiểm duyệt đã được thông báo. Bạn có thể bỏ chặn trong Cài đặt.')
        : conversationId
          ? tr('Blocked. Our moderators have been told. You can unblock them in Settings.', 'Đã chặn. Đội kiểm duyệt đã được thông báo. Bạn có thể bỏ chặn trong Cài đặt.')
          : tr('Blocked. Their listings are hidden, and our moderators have been told. You can unblock them in Settings.', 'Đã chặn. Tin đăng của họ đã được ẩn và đội kiểm duyệt đã được thông báo. Bạn có thể bỏ chặn trong Cài đặt.'))
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
            {name ? `${tr('Block', 'Chặn')} ${name}?` : shopOnly ? tr('Block this shop?', 'Chặn cửa hàng này?') : tr('Block this user?', 'Chặn người dùng này?')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {shopOnly
              ? tr(
                  'This shop\'s listings disappear from everything you browse, right away. Our moderators are told so they can look into it. You can unblock it any time in Settings.',
                  'Tin đăng của cửa hàng này sẽ biến mất ngay khỏi mọi nơi bạn xem. Đội kiểm duyệt sẽ được thông báo để xem xét. Bạn có thể bỏ chặn bất cứ lúc nào trong Cài đặt.',
                )
              : conversationId
                ? tr(
                    'They will not be able to message you or send you offers, and you will not be able to message them. Conversations with them leave your inbox. Our moderators are told so they can look into it. You can unblock them any time in Settings.',
                    'Người này sẽ không thể nhắn tin hay gửi trả giá cho bạn, và bạn cũng không thể nhắn tin cho họ. Các cuộc trò chuyện với họ sẽ rời khỏi hộp thư của bạn. Đội kiểm duyệt sẽ được thông báo để xem xét. Bạn có thể bỏ chặn bất cứ lúc nào trong Cài đặt.',
                  )
                : tr(
                    'Their listings disappear from everything you browse, right away. They will not be able to message you or send you offers, and you will not be able to message them; conversations with them leave your inbox. Our moderators are told so they can look into it. You can unblock them any time in Settings.',
                    'Tin đăng của họ sẽ biến mất ngay khỏi mọi nơi bạn xem. Họ sẽ không thể nhắn tin hay gửi trả giá cho bạn, và bạn cũng không thể nhắn tin cho họ; các cuộc trò chuyện với họ sẽ rời khỏi hộp thư của bạn. Đội kiểm duyệt sẽ được thông báo để xem xét. Bạn có thể bỏ chặn bất cứ lúc nào trong Cài đặt.',
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
