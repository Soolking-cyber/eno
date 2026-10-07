'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { subtleToast } from '@/lib/subtle-toast'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'
import { identityBlockAction, identityBlockMessage, IDENTITY_VERIFY_PATH } from '@/lib/identity-block-copy'
import { ENFORCEMENT } from '@/lib/enforcement-machine'
import { useUndoWindow } from '@/hooks/use-undo-window'
import { useAuth } from '@/context/auth-context'
import { ACCOUNT_CHANGED, actingAccountHeaders } from '@/lib/api/acting-account'
import type { MarkSoldRequest } from './mark-sold-flow'

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
  onState?: (state: 'sold' | 'active' | 'hidden' | 'gone' | null) => void,
) {
  const { tr } = useLanguage()
  const { user } = useAuth()
  // Who is signed in NOW: a delete refused as account_changed puts its row back only for the account that tapped.
  const userIdRef = useRef(user?.id ?? null)
  useEffect(() => { userIdRef.current = user?.id ?? null }, [user])
  const router = useRouter()
  const undoWindow = useUndoWindow()
  const [gone, setGoneRaw] = useState(false)
  const [optStatus, setOptStatusRaw] = useState<string | null>(null)
  const setGone = (g: boolean) => { setGoneRaw(g); onState?.(g ? 'gone' : null) }
  const setOptStatus = (s: 'sold' | 'active' | 'hidden' | null) => { setOptStatusRaw(s); onState?.(s) }

  // Resolves whether the write landed (the rollback has already run when it did not) — the mark-sold
  // sheet closes on true and says why on false; every other caller ignores it.
  const act = (
    optimistic: () => void,
    rollback: () => void,
    url: string,
    method: 'POST' | 'DELETE',
    body?: unknown,
  ): Promise<boolean> => {
    optimistic()
    return fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      .then(async (res) => {
        if (res.ok) { onChanged(); return true }
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
        } else if (d.error === 'released_charge_listing_cap') {
          // After a scam-hold RELEASE (released-charge-gate.ts): relisting is allowed, but only under the
          // active-listing cap while the confirmed report stands. The number from the constant.
          toast.error(`${tr('Your hold was released, but the confirmed report stays on your record, so you can keep up to', 'Tạm dừng đã được gỡ, nhưng báo cáo đã xác nhận vẫn còn trong hồ sơ của bạn, nên bạn chỉ được giữ tối đa')} ${ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS} ${tr('active listings. Mark one sold or hide one before putting this back on sale.', 'tin đang đăng. Hãy đánh dấu đã bán hoặc ẩn một tin trước khi mở bán lại tin này.')}`)
        }
        return false
      })
      .catch(() => { rollback(); onChanged(); return false })
  }

  // 'hidden' = pulled from the public feed, kept in the dashboard (the dashboard row's Hide, inbox-12).
  const setStatus = (s: 'sold' | 'active' | 'hidden') => act(
    () => setOptStatus(s),
    () => setOptStatus(null),
    `/api/listings/${listing.id}/status`, 'POST', { status: s },
  )

  // The "Who bought it?" sheet's write (B6): the same instant flip to 'sold' and the same rollback as
  // setStatus('sold'), through POST /api/listings/[id]/sold so the buyer rides along. That route runs the
  // same setStatusCore transition as /status (status, soldAt, purge, de-index, webhook) and adds only the
  // attribution columns — the sold semantics do not change.
  const markSold = (sale: MarkSoldRequest) => act(
    () => setOptStatus('sold'),
    () => setOptStatus(null),
    `/api/listings/${listing.id}/sold`, 'POST', sale,
  )

  /**
   * ⛔ THE UNDO WINDOW IS THE HOUSE HOOK'S (src/hooks/use-undo-window.tsx), NOT A TIMER BESIDE A TOAST.
   * This used to commit on its own 5s setTimeout next to a sonner toast of `duration: 5000` — but sonner
   * PAUSES its timer while the toast is touched or hovered and while the tab is hidden, so the DELETE
   * could go out with "Undo" still on screen, and a tap on it only un-hid the row of a listing that was
   * already deleted (a tombstone, src/lib/listing-removed.ts). One clock now owns the window and the
   * toast is its view, taken down the moment the DELETE is sent. Leaving inside the window — pagehide,
   * the tab hidden, the row unmounting — sends it (keepalive lets it survive the page going away), so a
   * listing the seller watched get deleted is never silently resurrected either (audit P2).
   * ⚠️ SO THE HOST MUST STAY MOUNTED WHILE `gone` — render nothing (DashboardListingRow's
   * `if (gone) return null`), never filter the row out. Unmounting is "leaving" to the hook: it would send
   * the DELETE at once and withdraw the Undo, collapsing the window to zero. No host unmounts on `gone` or
   * `onState('gone')` today (codex + opus, 2026-10-06).
   */
  const del = () => {
    // The account that tapped, captured NOW: the DELETE names it when the window closes (acting-account.ts).
    const actingAccount = user?.id ?? null
    setGone(true)
    undoWindow.start(`listing:${listing.id}`, {
      title: tr('Listing deleted', 'Đã xóa tin'),
      undoLabel: tr('Undo', 'Hoàn tác'),
      undo: () => setGone(false),
      commit: () => commitDelete(actingAccount),
    })
  }

  const commitDelete = (actingAccount: string | null) => {
    return fetch(`/api/listings/${listing.id}`, { method: 'DELETE', keepalive: true, headers: actingAccountHeaders(actingAccount) })
      .then(async (res) => {
        if (!res.ok) {
          // ⛔ ANOTHER ACCOUNT HOLDS THIS BROWSER NOW (409 account_changed): the listing is untouched, so its
          // row comes back and the reason is said — only while this screen is still the account that tapped
          // (otherwise even the toast tells the next account what the previous one tried). No refetch
          // (onChanged) either way: it would read THAT account's dashboard into this one.
          const code = await res.json().then((b: { error?: unknown } | null) => b?.error, () => undefined)
          if (code === ACCOUNT_CHANGED) {
            if (userIdRef.current === actingAccount) {
              setGone(false)
              toast.error(tr('This browser is now signed in to a different account, so the listing was not deleted.', 'Trình duyệt này đang đăng nhập bằng một tài khoản khác nên tin chưa bị xóa.'))
            }
            return
          }
          throw new Error('failed')
        }
        // ⚠️ A 200 IS NOT ALWAYS A DELETE. While the account or this listing is under
        // investigation the server HIDES it instead, so the listing stays where the investigation
        // can act on it (core/listings.ts deleteListingCore — a delete no longer erases reports or
        // chats; it is a tombstone, src/lib/listing-removed.ts). The row comes back as hidden, and
        // the seller is told why rather than watching a "deleted" listing reappear.
        const d = (await res.json().catch(() => ({}))) as { hidden?: boolean; reason?: string }
        if (d.hidden) {
          setGone(false)
          // Nothing to press, so the subtle pill (owner, 2026-09-21) — on screen as long as it takes to read.
          subtleToast(d.reason === 'open_report'
            ? tr('Hidden, not deleted: a report about this listing or your shop is still open. You can delete it once the report is resolved.', 'Đã ẩn, chưa xóa: một báo cáo về tin này hoặc gian hàng của bạn vẫn đang được xử lý. Bạn có thể xóa tin sau khi báo cáo được giải quyết.')
            : tr('Hidden, not deleted: your account is under review. You can delete it once the review is finished.', 'Đã ẩn, chưa xóa: tài khoản của bạn đang được xem xét. Bạn có thể xóa tin sau khi việc xem xét kết thúc.'))
        }
        onChanged()
      })
      .catch(() => { setGone(false); toast.error(tr('Could not delete — listing restored.', 'Không xóa được — đã khôi phục tin.')); onChanged() })
  }

  return { gone, status: optStatus ?? listing.status, setStatus, markSold, del }
}
