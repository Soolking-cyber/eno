'use client'

import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { experimental_createQueryPersister } from '@tanstack/react-query-persist-client'
import { useEffect, useState } from 'react'
import { WifiOff, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Alert } from '@/components/ui/alert'
import { IconButton } from '@/components/ui/icon-button'

// NATIVE-ONLY offline cache (Phase 2, owner 2026-07-20): in the Capacitor app,
// queries persist per-entry into native Preferences, so a cold launch paints the
// LAST SESSION's data instantly while fresh data revalidates in the background
// (restored entries carry their real dataUpdatedAt → already stale → refetch on
// mount; the SWR contract is unchanged). The WEB keeps the plain in-memory client:
// it has its own bespoke localStorage caches where they matter, and SSR hydration
// must keep matching the server payload exactly.
const isNative = () =>
  typeof window !== 'undefined' &&
  !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

function makeNativePersister() {
  return experimental_createQueryPersister({
    storage: {
      // Lazy plugin access per call — keeps @capacitor/preferences off every web
      // execution path and tolerates the plugin being unavailable (older binary).
      getItem: async (key: string) => {
        try {
          const { Preferences } = await import('@capacitor/preferences')
          return (await Preferences.get({ key })).value
        } catch { return null }
      },
      setItem: async (key: string, value: string) => {
        try {
          const { Preferences } = await import('@capacitor/preferences')
          await Preferences.set({ key, value })
        } catch { /* best-effort */ }
      },
      removeItem: async (key: string) => {
        try {
          const { Preferences } = await import('@capacitor/preferences')
          await Preferences.remove({ key })
        } catch { /* best-effort */ }
      },
    },
    maxAge: 24 * 60 * 60 * 1000, // a day-old feed still beats a blank screen
    prefix: 'eno-rq',
  })
}

/**
 * Connectivity → TanStack's onlineManager, and a banner the user can actually see.
 *
 * Nothing in the app watched the connection before this: the service worker is push-only and
 * Capacitor's error page only appears when a MAIN-FRAME load fails, so a drop *mid-session*
 * (the common case on VN mobile) showed nothing at all — taps just silently did nothing while
 * queries retried into the void.
 *
 * Deliberately NOT gated on the native shell. The WebView and the mobile web app are the same
 * app under the Capacitor strategy, a browser tab can lose its connection just as easily, and a
 * native-only banner could never be observed by the e2e gate.
 */
function OfflineBanner() {
  const { tr } = useLanguage()
  // Starts false on BOTH server and client so the first client render matches the SSR payload —
  // reading navigator.onLine during render would be a hydration mismatch. The effect below
  // corrects it immediately after mount, including the already-offline-on-load case.
  const [offline, setOffline] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const sync = () => {
      const isOffline = !navigator.onLine
      setOffline(isOffline)
      // Re-arm on each new drop: a banner dismissed an hour ago must not stay suppressed for
      // the rest of the session, or the next outage is silent again.
      if (isOffline) setDismissed(false)
    }
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    // Keep react-query's own notion of connectivity in step, so it pauses instead of burning
    // retries while there is demonstrably no network. v5 already installs an equivalent
    // listener by default; stating it here makes the contract explicit and survives the
    // default being swapped. setEventListener returns void — it owns the teardown of the
    // previous listener itself, so there is nothing for us to unsubscribe.
    onlineManager.setEventListener((setOnline) => {
      const push = () => setOnline(navigator.onLine)
      window.addEventListener('online', push)
      window.addEventListener('offline', push)
      return () => {
        window.removeEventListener('online', push)
        window.removeEventListener('offline', push)
      }
    })
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  // Overlay, not in-flow: an in-flow banner above the header would fight the CSS that couples
  // #prelaunch-banner to #app-header and double-count the notch inset on native. z-50 is the
  // documented overlay tier — above the header (z-40), below dialogs (z-[200]), so a dialog
  // still wins if one is open.
  //
  // The live region is mounted ALWAYS and only its CONTENT is conditional. A live region that
  // appears together with its text is announced by almost no screen reader — the region has to
  // be in the DOM first for the insertion to be observed. `pointer-events-none` is what makes
  // an always-present full-width fixed overlay safe: while empty it must not swallow taps meant
  // for the header underneath it, so the banner itself re-enables them.
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-[env(safe-area-inset-top)]"
    >
      {offline && !dismissed && (
        <Alert
          data-testid="offline-banner"
          tone="warning"
          size="xs"
          icon={<WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />}
          action={
            <IconButton
              size="sm"
              aria-label={tr('Dismiss', 'Đóng')}
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </IconButton>
          }
          className="pointer-events-auto mt-2 w-full max-w-md rounded-xl pr-11 shadow-overlay"
        >
          {tr(
            'You’re offline. We’ll reconnect automatically.',
            'Bạn đang ngoại tuyến. Chúng tôi sẽ kết nối lại tự động.',
          )}
        </Alert>
      )}
    </div>
  )
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000, // cache results for 30s
            refetchOnWindowFocus: false, // avoid background query spam on tab focus
            retry: 1,
            // Per-query persistence (native only): restore-on-subscribe +
            // write-back-on-success, no whole-cache dehydration step.
            ...(isNative() ? { persister: makeNativePersister().persisterFn } : {}),
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
      {children}
    </QueryClientProvider>
  )
}
