'use client'

import { useSyncExternalStore } from 'react'
import { iosHideVisaClient } from '@/lib/ios-hide-visa'

const subscribe = () => () => {}
const serverSnapshot = () => false

/**
 * App Store gate `ios-hide-visa` (D5 = b) for a CLIENT component: true only in the iOS app with the gate on.
 *
 * ⚠️ useSyncExternalStore, NOT a bare `iosHideVisaClient()` in render and NOT a mounted-effect flag. The server
 * snapshot is `false`, so the hydration render matches the server HTML (no mismatch); React then re-renders with the
 * real value. On a client-only mount (a soft navigation, a dialog) there is no hydration and the real value is used
 * on the FIRST render — a `useEffect`-set flag would paint the hidden control for one frame there. The platform never
 * changes while the page lives, so there is nothing to subscribe to.
 * Server-rendered and ISR HTML cannot use this — it needs the CSS hooks (`ios-app-hidden` / `ios-app-only`).
 */
export function useIosHideVisa(): boolean {
  return useSyncExternalStore(subscribe, iosHideVisaClient, serverSnapshot)
}
