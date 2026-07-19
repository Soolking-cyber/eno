'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { experimental_createQueryPersister } from '@tanstack/react-query-persist-client'
import { useState } from 'react'

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
      {children}
    </QueryClientProvider>
  )
}
