'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Loader2, Check } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

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

/** Daily availability reminder controls: an opt-in switch (in-app bell) plus
 *  optional browser push so the nudge reaches the seller even when eno.vn is
 *  closed. Progressive: works everywhere for the in-app reminder; push is a
 *  bonus where supported (iOS needs the site installed to the home screen). */
export function ReminderSettings() {
  const { tr } = useLanguage()
  const [optIn, setOptIn] = useState(true)
  const [pushState, setPushState] = useState<'unsupported' | 'default' | 'granted' | 'denied'>('default')
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  useEffect(() => {
    fetch('/api/profile/reminder-prefs').then((r) => r.json()).then((d) => { if (typeof d.dailyReminderOptIn === 'boolean') setOptIn(d.dailyReminderOptIn) }).catch(() => {})
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) {
      setPushState('unsupported')
    } else {
      setPushState(Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'default')
    }
  }, [])

  // Optimistic + latest-wins: the flip is instant on every tap (no in-flight
  // block). We tag each request with a sequence number and only the most recent
  // one is allowed to reconcile/revert, so rapid taps never deadlock or fight.
  const seq = useRef(0)
  const setPref = (val: boolean) => {
    setOptIn(val); setSavedTick(false)
    const mine = ++seq.current
    fetch('/api/profile/reminder-prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyReminderOptIn: val }) })
      .then((res) => { if (!res.ok) throw new Error('failed'); if (mine === seq.current) setSavedTick(true) })
      .catch(() => { if (mine === seq.current) setOptIn(!val) /* revert only the latest */ })
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
      if (!optIn) setPref(true) // enabling push implies you want the reminder
    } catch { /* user dismissed or platform refused */ } finally { setBusy(false) }
  }

  return (
    <div>
      {/* In-app reminder switch */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{tr('Daily availability reminder', 'Nhắc nhở hằng ngày')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{tr('A daily nudge to confirm which listings are still available — keeps your offers fresh at the top.', 'Nhắc bạn xác nhận tin nào còn hàng mỗi ngày — giữ tin luôn mới và lên đầu.')}</p>
        </div>
        <button
          onClick={() => setPref(!optIn)}
          role="switch"
          aria-checked={optIn}
          className={cn('inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors cursor-pointer', optIn ? 'bg-[#0a66c2]' : 'bg-input')}
        >
          <span className={cn('h-5 w-5 rounded-full bg-white shadow transition-transform', optIn ? 'translate-x-5' : 'translate-x-0')} />
        </button>
      </div>

      {savedTick && <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent-foreground"><Check className="h-3 w-3" />{tr('Saved', 'Đã lưu')}</p>}

      {/* Browser push */}
      <div className="mt-4 pt-2">
        {pushState === 'unsupported' ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><BellOff className="h-4 w-4 shrink-0" />{tr('Browser notifications aren’t available here. On iPhone, add eno.vn to your Home Screen first.', 'Thông báo trình duyệt không khả dụng. Trên iPhone, hãy thêm eno.vn vào Màn hình chính trước.')}</p>
        ) : pushState === 'granted' ? (
          <p className="flex items-center gap-2 text-xs font-semibold text-accent-foreground"><Bell className="h-4 w-4 shrink-0" />{tr('Browser notifications are on for this device.', 'Đã bật thông báo trình duyệt trên thiết bị này.')}</p>
        ) : pushState === 'denied' ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><BellOff className="h-4 w-4 shrink-0" />{tr('Notifications are blocked. Enable them in your browser settings to get reminders here.', 'Thông báo đang bị chặn. Hãy bật trong cài đặt trình duyệt để nhận nhắc nhở.')}</p>
        ) : (
          <button onClick={enablePush} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-tint px-4 py-2 text-sm font-semibold text-body transition-colors hover:bg-muted disabled:opacity-40 cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} {tr('Get reminders on this device', 'Nhận nhắc nhở trên thiết bị này')}
          </button>
        )}
      </div>
    </div>
  )
}
