'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'
import { identityBlockAction, identityBlockMessage, IDENTITY_VERIFY_PATH } from '@/lib/identity-block-copy'

// Shared optimistic lifecycle actions for a seller's own listing — used by the
// dashboard row cards AND the desktop data-table so both surfaces behave
// identically: status flips instantly (local override), the request fires in
// the background, rollback + revalidate on failure. Delete is the Gmail way —
// hide instantly, commit after the undo-toast expires.
export function useListingActions(
  listing: SerializedListing,
  onChanged: () => void,
  // Optional mirror for hosts that render OTHER cells from the same listing
  // (the data-table): reports every optimistic transition ('sold'/'active'
  // flip, 'gone' during the undo-delete window, null on rollback/undo) so
  // status badges and row selectability stay in lockstep with the actions.
  onState?: (state: 'sold' | 'active' | 'gone' | null) => void,
) {
  const { tr } = useLanguage()
  const router = useRouter()
  const [gone, setGoneRaw] = useState(false)
  const [optStatus, setOptStatusRaw] = useState<string | null>(null)
  const setGone = (g: boolean) => { setGoneRaw(g); onState?.(g ? 'gone' : null) }
  const setOptStatus = (s: 'sold' | 'active' | null) => { setOptStatusRaw(s); onState?.(s) }

  const act = (
    optimistic: () => void,
    rollback: () => void,
    url: string,
    method: 'POST' | 'DELETE',
    body?: unknown,
  ) => {
    optimistic()
    fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      .then(async (res) => {
        if (res.ok) { onChanged(); return }
        // ⚠️ AN IDENTITY REFUSAL MUST BE SAID, NOT JUST UNDONE. Every non-2xx rolls back silently, so
        // a relist the seller identity gate refused looked like a tap that did nothing — the listing
        // flicked to Active and back with no reason given. That refusal now names the next step and
        // offers it. Other failures keep their existing silent rollback, deliberately: with the gate
        // off this hook must behave exactly as it did before the gate existed.
        const d = await res.json().catch(() => ({})) as { error?: unknown }
        rollback(); onChanged()
        const identityMsg = identityBlockMessage(d.error, tr)
        if (identityMsg) {
          const next = identityBlockAction(d.error)
          toast.error(identityMsg, next === 'verify' ? { action: { label: tr('Verify', 'Xác minh'), onClick: () => router.push(IDENTITY_VERIFY_PATH) } } : undefined)
        } else if (d.error === 'account_held' || d.error === 'account_suspended') {
          // The same kind of refusal, from the account's HOLD (core/listings.ts, the hold leak): a
          // held or suspended seller cannot put a listing back on sale. Said, not silently undone.
          toast.error(d.error === 'account_suspended'
            ? tr('Your account is suspended, so listings can’t be put back on sale. Details are in your notifications.', 'Tài khoản của bạn đang tạm ngưng nên chưa thể mở bán lại tin đăng. Xem chi tiết trong thông báo của bạn.')
            : tr('Your listings are paused while your account is on hold, so they can’t be put back on sale yet. Details are in your notifications.', 'Tin đăng của bạn đang tạm dừng trong thời gian tài khoản bị tạm giữ nên chưa thể mở bán lại. Xem chi tiết trong thông báo của bạn.'))
        }
      })
      .catch(() => { rollback(); onChanged() })
  }

  const setStatus = (s: 'sold' | 'active') => act(
    () => setOptStatus(s),
    () => setOptStatus(null),
    `/api/listings/${listing.id}/status`, 'POST', { status: s },
  )

  const del = () => {
    setGone(true)
    let undone = false
    let committed = false
    // Commit path shared by the undo-window timer AND pagehide (audit P2): closing the
    // tab / killing the app / hard-navigating inside the 5s window used to drop the
    // timer, silently resurrecting a listing the seller watched get "deleted".
    // keepalive lets the DELETE survive page teardown.
    const commitNow = () => {
      if (undone || committed) return
      committed = true
      window.removeEventListener('pagehide', commitNow)
      fetch(`/api/listings/${listing.id}`, { method: 'DELETE', keepalive: true })
        .then(async (res) => {
          if (!res.ok) throw new Error('failed')
          // ⚠️ A 200 IS NOT ALWAYS A DELETE. While the account or this listing is under
          // investigation the server HIDES it instead — deleting would erase other people's reports
          // and chats (core/listings.ts deleteListingCore). The row comes back as hidden, and the
          // seller is told why rather than watching a "deleted" listing reappear.
          const d = (await res.json().catch(() => ({}))) as { hidden?: boolean; reason?: string }
          if (d.hidden) {
            setGone(false)
            toast(d.reason === 'open_report'
              ? tr('Hidden, not deleted: a report about this listing or your shop is still open. You can delete it once the report is resolved.', 'Đã ẩn, chưa xóa: một báo cáo về tin này hoặc gian hàng của bạn vẫn đang được xử lý. Bạn có thể xóa tin sau khi báo cáo được giải quyết.')
              : tr('Hidden, not deleted: your account is under review. You can delete it once the review is finished.', 'Đã ẩn, chưa xóa: tài khoản của bạn đang được xem xét. Bạn có thể xóa tin sau khi việc xem xét kết thúc.'))
          }
          onChanged()
        })
        .catch(() => { setGone(false); toast.error(tr('Could not delete — listing restored.', 'Không xóa được — đã khôi phục tin.')); onChanged() })
    }
    const commit = setTimeout(commitNow, 5000)
    window.addEventListener('pagehide', commitNow)
    toast(tr('Listing deleted', 'Đã xóa tin'), {
      duration: 5000,
      action: {
        label: tr('Undo', 'Hoàn tác'),
        onClick: () => { undone = true; clearTimeout(commit); window.removeEventListener('pagehide', commitNow); setGone(false) },
      },
    })
  }

  return { gone, status: optStatus ?? listing.status, setStatus, del }
}
