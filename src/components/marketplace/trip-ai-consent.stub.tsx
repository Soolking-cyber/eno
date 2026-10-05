'use client'

/**
 * MARKETPLACE-EDITION STUB for trip-ai-consent.tsx (next.config.ts aliases it on an eno.vn build). eno.vn offers no trip
 * service and may not name one, so there are no words to show: the copy hook returns nothing — which the Google AI notice
 * answers with "no", sending nothing — and the Settings row renders nothing. TypeScript never sees this file; its export
 * surface is pinned to the real module's by src/components/marketplace/edition-stubs.test.ts.
 */

import type { AiConsentCopy } from '@/lib/ai-consent'

export function useTripAiConsentCopy(): AiConsentCopy | undefined {
  return undefined
}

export function TripAiSetting() {
  return null
}
