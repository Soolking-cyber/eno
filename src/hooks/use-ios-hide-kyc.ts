'use client'

import { useSyncExternalStore } from 'react'
import { iosHideKycClient } from '@/lib/ios-hide-kyc'

const subscribe = () => () => {}
const serverSnapshot = () => false

/**
 * App Store gate `ios-hide-kyc` for a CLIENT component: true only in the iOS app with the gate on. The same contract as
 * useIosHideVisa (src/hooks/use-ios-hide-visa.ts): `false` on the server and through hydration, then the real value —
 * and the real value on the FIRST render of a client-only mount.
 */
export function useIosHideKyc(): boolean {
  return useSyncExternalStore(subscribe, iosHideKycClient, serverSnapshot)
}
