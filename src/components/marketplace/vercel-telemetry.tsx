'use client'

import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { hasAdConsent } from '@/lib/consent'

// Vercel Analytics + Speed Insights are cookieless/anonymous by design, but the
// beacons are still processed by Vercel Inc. — under the PDP Law's sensitive
// classification of behavioral data they get the same 'all'-tier opt-in as GA
// (2026-07-06 compliance verification). Reactive: mounts the instant consent is
// granted, so the session is still measured from that point.
export function VercelTelemetry() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    setOk(hasAdConsent())
    const on = () => setOk(hasAdConsent())
    window.addEventListener('eno:consent', on)
    return () => window.removeEventListener('eno:consent', on)
  }, [])
  if (!ok) return null
  return (
    <>
      <SpeedInsights />
      <Analytics />
    </>
  )
}
