'use client'

import { useSyncExternalStore } from 'react'
import { useAuth } from '@/context/auth-context'
import { aiConsentAskFirst, readAiConsent, subscribeAiConsent, type AiConsent, type AiFamily } from '@/lib/ai-consent'

/**
 * One Google AI family's answer, for DISPLAY (a hint line, a Settings switch) — App Store gate `app-ai-notice`,
 * src/lib/ai-consent.ts. Hydration-safe: the server and the first client render both say "not asking", then the real
 * state arrives, and any later change (the notice, Settings, another tab) re-renders.
 * ⚠️ NOT FOR DECIDING A REQUEST — a click handler reads `aiConsentNeeded()` / `askAiConsent()` at the moment it sends.
 */
export function useAiConsent(family: AiFamily): { askFirst: boolean; consent: AiConsent } {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const snap = useSyncExternalStore(
    subscribeAiConsent,
    () => (aiConsentAskFirst() ? `1${readAiConsent(family, userId) ?? ''}` : '0'),
    () => '0',
  )
  return { askFirst: snap[0] === '1', consent: (snap.slice(1) || null) as AiConsent }
}
