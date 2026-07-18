'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2, Mail } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

// VAPID public key (base64url) → Uint8Array for pushManager.subscribe.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** The daily availability check is always on (no opt-in). This just lets the
 *  seller enable BROWSER PUSH so the nudge reaches them even when eno.vn is
 *  closed (iOS needs the site installed to the home screen). */
export function ReminderSettings() {
  const { tr } = useLanguage()
  const [pushState, setPushState] = useState<'unsupported' | 'default' | 'granted' | 'denied'>('default')
  // Capacitor WebView: serviceWorker/PushManager are absent there, so the web-push row
  // would falsely read "unsupported". Native push exists but is dormant (native-push.tsx,
  // env-gated server side) — hide the row entirely; it returns as a native-push toggle
  // once FCM/APNs activates. State (not inline read) so SSR/first paint match.
  const [native, setNative] = useState(false)
  const [busy, setBusy] = useState(false)
  // Weekly marketing digest opt-in (null = not yet loaded / not signed in → hide the row).
  const [digest, setDigest] = useState<boolean | null>(null)

  useEffect(() => {
    if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) { setNative(true); return }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) {
      setPushState('unsupported')
    } else {
      setPushState(Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'default')
    }
  }, [])

  useEffect(() => {
    fetch('/api/profile/digest-prefs')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.weeklyDigestOptIn === 'boolean') setDigest(d.weeklyDigestOptIn) })
      .catch(() => {})
  }, [])

  const toggleDigest = async () => {
    if (digest === null) return
    const next = !digest
    setDigest(next) // optimistic
    try {
      const res = await fetch('/api/profile/digest-prefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weeklyDigestOptIn: next }),
      })
      if (!res.ok) setDigest(!next) // revert on failure
    } catch { setDigest(!next) }
  }

  const enablePush = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setPushState(perm === 'denied' ? 'denied' : 'default'); return }
      const wanted = urlBase64ToUint8Array(VAPID)
      // Reuse an existing subscription, but if it was made with a DIFFERENT VAPID
      // key (e.g. keys rotated), drop it first — re-subscribing with a mismatched
      // applicationServerKey otherwise throws.
      let sub = await reg.pushManager.getSubscription()
      if (sub) {
        const cur = new Uint8Array(sub.options.applicationServerKey || new ArrayBuffer(0))
        const matches = cur.length === wanted.length && cur.every((b, i) => b === wanted[i])
        if (!matches) { await sub.unsubscribe().catch(() => {}); sub = null }
      }
      sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted as BufferSource })
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
      setPushState('granted')
    } catch { /* user dismissed or platform refused */ } finally { setBusy(false) }
  }

  return (
    <div>
      {/* Daily review is always on — sellers get the quick availability check each
          day. Browser push is the optional extra reach. */}
      <div>
        <p className="text-sm font-bold text-foreground">{tr('Daily availability check', 'Kiểm tra hằng ngày')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {tr('Once a day we’ll ask you to confirm what’s still available — it keeps your offers fresh at the top.', 'Mỗi ngày chúng tôi sẽ nhắc bạn xác nhận món còn hàng — giúp tin luôn mới và lên đầu.')}
          {!native && <> {tr('Turn on browser notifications to be reminded even when eno.vn is closed.', 'Bật thông báo trình duyệt để được nhắc cả khi không mở eno.vn.')}</>}
        </p>
      </div>

      {/* Browser push — hidden in the native app (see the `native` state comment above). */}
      {!native && <div className="mt-4">
        {pushState === 'unsupported' ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><BellOff className="h-4 w-4 shrink-0" />{tr('Browser notifications aren’t available here. On iPhone, add eno.vn to your Home Screen first.', 'Thông báo trình duyệt không khả dụng. Trên iPhone, hãy thêm eno.vn vào Màn hình chính trước.')}</p>
        ) : pushState === 'granted' ? (
          <p className="flex items-center gap-2 text-xs font-semibold text-accent-foreground"><Bell className="h-4 w-4 shrink-0" />{tr('Browser notifications are on for this device.', 'Đã bật thông báo trình duyệt trên thiết bị này.')}</p>
        ) : pushState === 'denied' ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><BellOff className="h-4 w-4 shrink-0" />{tr('Notifications are blocked. Enable them in your browser settings to get reminders here.', 'Thông báo đang bị chặn. Hãy bật trong cài đặt trình duyệt để nhận nhắc nhở.')}</p>
        ) : (
          <Button variant="ghost" size="none" onClick={enablePush} disabled={busy} className="px-4 py-2 font-semibold text-body hover:bg-muted hover:text-body">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} {tr('Get reminders on this device', 'Nhận nhắc nhở trên thiết bị này')}
          </Button>
        )}
      </div>}

      {/* Weekly digest email (all accounts) — the email footer also has a one-click
          unsubscribe, this is the in-app control. Hidden until the pref loads. */}
      {digest !== null && (
        <div className="mt-6 flex items-start justify-between gap-4 border-t border-border pt-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-bold text-foreground"><Mail className="h-4 w-4 shrink-0" />{tr('Weekly digest email', 'Email tổng hợp hằng tuần')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{tr('Once a week: top products and the latest price drops. No spam.', 'Mỗi tuần một lần: sản phẩm nổi bật và các đợt giảm giá mới nhất. Không spam.')}</p>
          </div>
          <Switch
            checked={!!digest}
            onChange={() => toggleDigest()}
            label={tr('Weekly digest email', 'Email tổng hợp hằng tuần')}
            size="md"
            className="mt-0.5"
          />
        </div>
      )}
    </div>
  )
}
