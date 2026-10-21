'use client'

import { useEffect, useRef, useState, type ComponentType } from 'react'
import { useAuth } from '@/context/auth-context'
import { shutdownEngineNow } from '@/lib/calls/client/presence'

/**
 * In-app calls — the always-mounted host (src/app/[lang]/providers.tsx). It is deliberately TINY, because it ships
 * to every signed-in page view while only the beta cohort can call: it asks GET /api/calls/config once, and only when
 * calls are on for this person does it load the call runtime (the ring listener, the engine, the call screens) as a
 * separate chunk. A signed-out visitor, or anyone outside the cohort, downloads none of it.
 *
 * ⚠️ A RUNTIME THAT FAILS TO LOAD IS RETRIED ONCE, THEN LEFT. A tab opened before a deploy can 404 the chunk; the
 * person then simply is not rung in that tab (their other devices still are, and the web push still shows), which is
 * the honest failure — a reload fixes it. React.lazy is not used because a rejected lazy import stays rejected.
 */
type RuntimeModule = { CallRuntime: ComponentType<{ userId: string }> }

export function CallHost() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [runtime, setRuntime] = useState<RuntimeModule | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    let loading = false
    let retry: number | undefined
    const load = async (attempt = 0) => {
      if (loading || loaded.current || cancelled) return
      loading = true
      try {
        const { getCallsConfig } = await import('@/lib/calls/client/api')
        const { webrtcAvailable } = await import('@/lib/calls/client/media')
        if (!webrtcAvailable()) return
        const config = await getCallsConfig(userId)
        if (cancelled) return
        if (config.failed) {
          // No answer (flaky 3G, a timeout) is not "calls are off" (client review): ask again, a little later each time.
          retry = window.setTimeout(() => void load(attempt + 1), Math.min(300_000, 15_000 * 2 ** attempt))
          return
        }
        if (!config.enabled) return
        await mountRuntime()
      } finally {
        loading = false
      }
    }
    const mountRuntime = async () => {
      for (let attempt = 0; attempt < 2 && !cancelled; attempt++) {
        try {
          const mod = (await import('./call-runtime')) as RuntimeModule
          if (!cancelled) { loaded.current = true; setRuntime(mod) }
          return
        } catch {
          await new Promise((r) => setTimeout(r, 3_000))
        }
      }
    }
    // A tab left open while calls were switched on for this person — or after a failed check — looks again whenever it
    // comes back to the front (client review: the one check at load was the only one).
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    // After the page settles: calls must never compete with the first paint.
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    // Not in every browser (Safari), whatever lib.dom says.
    const viaIdle = typeof w.requestIdleCallback === 'function'
    const handle = viaIdle ? w.requestIdleCallback!.call(window, () => void load(), { timeout: 4_000 }) : window.setTimeout(() => void load(), 1_500)
    return () => {
      cancelled = true
      window.clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
      // Cancelled for real (client review): a callback left pending would ask for the OLD account after a switch.
      if (viaIdle) w.cancelIdleCallback?.call(window, handle)
      else window.clearTimeout(handle)
      // ⛔ ANOTHER ACCOUNT, OR NONE (client review): the old account's call or ring ends here — a live microphone with
      // no screen left to hang it up — and the runtime is reloaded only if calls are on for the NEW account.
      if (loaded.current) {
        loaded.current = false
        setRuntime(null)
      }
      // Whether or not the runtime finished loading — and SYNCHRONOUSLY, before the next account's effects run, so it can
      // never land on the next account's call instead (presence.ts; client review).
      shutdownEngineNow()
    }
  }, [userId])

  if (!userId || !runtime) return null
  const { CallRuntime } = runtime
  return <CallRuntime userId={userId} />
}
