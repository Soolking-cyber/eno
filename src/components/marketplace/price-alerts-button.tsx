'use client'

// ── PRICE-DROP ALERTS FOR SAVED LISTINGS (owner, 2026-11-17 — Reverb study: "explicit opt-in") ───────────────────────────
//   · A HEADER ACTION, NEVER A ROW: one trigger in /saved's PageHeader `actions` slot opens the switch and its notice in a
//     popover (a bottom sheet on a phone). Consent is flipping that switch with the notice in view; withdrawal is the same two taps.
//   · ⛔ NEVER OPTIMISTIC: the switch draws the server's last answer and is disabled while a toggle is on its way. An ON sends the
//     version THIS bundle's notice is (PRICE_ALERT_NOTICE_VERSION) — an older page is refused (409) instead of recording consent to
//     words nobody saw. Anything else unclear → a re-read of the truth (a save cut off by the wait can still commit).
//   · Shown to a signed-in account with saves (or with the switch ON, so it can always be switched off). Guests: nothing — their
//     hearts are on the device and get no alerts. The rules and the record: src/lib/price-alerts.ts.
import { actingAccountHeaders } from '@/lib/api/acting-account'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Bell, BellOff } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SwitchRow } from '@/components/ui/switch'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { PRICE_ALERT_NOTICE_VERSION } from '@/lib/price-drop-rules'

const ENDPOINT = '/api/saved-listings/price-alerts'
/** A stalled save must not hold the switch disabled (job-messages-panel's bound). */
const wait = () => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined)
const onOf = (d: unknown): boolean | null => (d && typeof (d as { on?: unknown }).on === 'boolean' ? (d as { on: boolean }).on : null)

export function PriceAlertsButton({ hasSaves }: { hasSaves: boolean }) {
  const { tr } = useLanguage()
  const uid = useAuth().user?.id ?? null
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const read = useCallback(async (): Promise<boolean | null> => {
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store', signal: wait() })
      return res.ok ? onOf(await res.json()) : null
    } catch { return null }
  }, [])

  useEffect(() => {
    setOn(null)
    if (!uid) return
    let off = false
    void read().then((v) => { if (!off) setOn(v) })
    return () => { off = true }
  }, [uid, read])

  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...actingAccountHeaders(uid) },
        body: JSON.stringify(next ? { on: true, notice: PRICE_ALERT_NOTICE_VERSION } : { on: false }),
        signal: wait(),
      })
      const data = await res.json().catch(() => null)
      const saved = res.ok ? onOf(data) : null
      if (saved !== null) return setOn(saved)
      // Refused before anything was written: the switch keeps the last answer.
      if (res.status === 409 && (data as { error?: string } | null)?.error === 'account_changed') return void toast.error(tr('This tab is signed in to another account now. Reload the page.', 'Thẻ này đang đăng nhập tài khoản khác. Hãy tải lại trang.'))
      if (res.status === 409) return void toast.error(tr('This page is out of date: the notice changed while it was open. Reload the page to read it, then switch this on.', 'Trang này đã cũ: thông báo đã thay đổi khi trang đang mở. Hãy tải lại trang để đọc, rồi bật lại mục này.'))
      if (res.status === 429) return void toast.error(tr('Too many changes in a short time — try again in a little while.', 'Bạn đã thay đổi quá nhiều lần trong thời gian ngắn — hãy thử lại sau ít phút.'))
      throw new Error(String(res.status))
    } catch {
      toast.error(tr("Couldn't save that — try again", 'Chưa lưu được — thử lại'))
      const fresh = await read()
      if (fresh !== null) setOn(fresh)
    } finally {
      setBusy(false)
    }
  }

  if (!uid || on === null || !(hasSaves || on)) return null
  const label = tr('Price-drop alerts', 'Báo giảm giá')
  return (
    <Popover mobileSheet>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm">
            {on ? <Bell className="h-4 w-4 fill-brand text-brand" /> : <BellOff className="h-4 w-4" />}
            {label}
          </Button>
        }
      />
      <PopoverContent side="bottom" align="end" sideOffset={8} aria-label={label} sheetTitle={label} className="w-80 p-3">
        <SwitchRow
          id="price-alerts-switch"
          checked={on}
          disabled={busy}
          onChange={(n) => { void toggle(n) }}
          stateLabels={{ on: tr('Switched on', 'Đang bật'), off: tr('Switched off', 'Đang tắt') }}
          label={tr('Tell me when a saved listing drops in price', 'Báo cho tôi khi tin đã lưu giảm giá')}
          description={
            <>
              {tr('We use the listings you save to tell you when one drops in price: in your notifications, and by push if notifications are on.', 'Chúng tôi dùng các tin bạn đã lưu để báo cho bạn khi một tin giảm giá: trong mục thông báo, và bằng thông báo đẩy nếu bạn đã bật thông báo.')}{' '}
              {tr('It stays off until you switch it on, and you can switch it off here at any time.', 'Mục này tắt cho đến khi bạn bật, và bạn có thể tắt tại đây bất cứ lúc nào.')}{' '}
              <Link href="/privacy" className="underline">{tr('Privacy Policy', 'Chính sách bảo vệ dữ liệu cá nhân')}</Link>
            </>
          }
        />
      </PopoverContent>
    </Popover>
  )
}
