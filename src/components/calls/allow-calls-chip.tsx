'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Phone } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { withName } from './call-copy'

/**
 * In-app calls — the answer to a 'call_request' row ("<name> would like to call you"), shown under that row on the
 * RECIPIENT's side only (DESIGN.md v3 §4). One tap stores the consent — for this person, in this thread, with the
 * version of these words (call_consent) — and is withdrawn the same way. Nothing is allowed by default.
 * Rendered under the LATEST request only (the thread page picks it), and not at all while calls are off for this
 * person — one answer per thread, never a stale "Allow" left under an older request (client review).
 */
export function AllowCallsChip({ conversationId, name }: { conversationId: string; name: string | null }) {
  const { tr } = useLanguage()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setAllowed(null)
    void (async () => {
      if (!userId) return
      try {
        const { getCallConsent, getCallsConfig } = await import('@/lib/calls/client/api')
        if (!(await getCallsConfig(userId)).enabled || cancelled) return
        const c = await getCallConsent(conversationId)
        if (!cancelled) setAllowed(c.iAllowThem)
      } catch { /* no chip */ }
    })()
    return () => { cancelled = true }
  }, [conversationId, userId])

  if (allowed === null) return null

  const set = async (allow: boolean) => {
    setBusy(true)
    try {
      const { setCallConsent } = await import('@/lib/calls/client/api')
      await setCallConsent(conversationId, allow)
      setAllowed(allow)
      toast.success(allow
        ? withName(tr('{name} can call you in this chat now.', '{name} giờ có thể gọi cho bạn trong cuộc trò chuyện này.'), '{name} can call you in this chat now.', name ?? tr('They', 'Người này'))
        : tr('Calls from them are off.', 'Đã tắt cuộc gọi từ người này.'))
    } catch {
      toast(tr('Could not save that — please try again.', 'Chưa lưu được — vui lòng thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  return allowed ? (
    <div className="mt-1 flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <Phone className="h-3.5 w-3.5" /> {tr('You allow their calls', 'Bạn cho phép họ gọi')}
      <Button variant="link" size="none" className="text-xs" disabled={busy} onClick={() => void set(false)}>{tr('Turn off', 'Tắt')}</Button>
    </div>
  ) : (
    <div className="mt-1 flex items-center gap-2 px-1">
      <Button size="sm" variant="cta" disabled={busy} onClick={() => void set(true)}>
        <Phone className="h-4 w-4" /> {withName(tr('Allow calls from {name}', 'Cho phép {name} gọi'), 'Allow calls from {name}', name ?? tr('them', 'người này'))}
      </Button>
    </div>
  )
}
