'use client'

import { useEffect } from 'react'
import { captureFirstTouch } from '@/lib/attribution'

// Captures first-touch acquisition attribution on the visitor's first landing.
// Runs in a mount effect (after paint): a few synchronous cookie reads/writes, no
// network, no third-party JS — so it never competes with hydration/LCP. Renders
// nothing. Pairs with <AnalyticsTags/> in the root layout.
export function AttributionCapture() {
  useEffect(() => { captureFirstTouch() }, [])
  return null
}
