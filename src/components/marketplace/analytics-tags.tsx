/* eslint-disable react/jsx-no-literals -- inline <Script> bodies are JS code, not user-facing copy */
'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { hasAdConsent } from '@/lib/consent'

// Google Analytics (GA4) only. The Meta Pixel was removed (heaviest 3rd-party,
// ~233 KiB; only useful for paid Meta-ad retargeting — re-add if you run Meta ads).
//
// CONSENT: GA is a third-party tracker, and the PDP Law 91/2025 classifies
// cyberspace behavioral data as SENSITIVE personal data needing explicit opt-in
// (compliance audit 2026-07-06) — so BOTH tags load only with the 'all' consent
// tier, reactively the instant the user grants it. No consent → zero third-party JS.
//
// GA is additionally NOT injected until the user FIRST INTERACTS (pointer/key/
// touch/scroll), with an idle fallback — so ~155 KiB of vendor JS never competes
// with hydration/LCP/TBT, and Lighthouse (which never interacts) sees a clean
// critical path. gtag self-queues so a PageView is never dropped. Helpers in
// lib/analytics.ts guard window.gtag.
//   NEXT_PUBLIC_GA_ID e.g. G-XXXXXXXXXX (env overrides the public default below)
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-CKTZK62B0X'
// Meta tracking is SERVER-SIDE ONLY (Conversions API via after() — lib/meta-capi.ts), per
// the standing "browser pixel OFF" decision. The pixel bootstrap was removed 2026-07-10:
// the env id was baked into the prod bundle so it WAS loading for consenting users —
// double-fire risk vs CAPI, ~233KiB of vendor JS, and its facebook.com/tr form-POST
// fallback tripped the CSP form-action on every page. Restore from git if Meta ads ever
// need on-site retargeting signals.

export function AnalyticsTags() {
  const [ready, setReady] = useState(false)
  // Ad-network consent — reactive: flips on the instant the user clicks "Allow".
  const [adConsent, setAdConsent] = useState(false)
  useEffect(() => {
    setAdConsent(hasAdConsent())
    const on = () => setAdConsent(hasAdConsent())
    window.addEventListener('eno:consent', on)
    return () => window.removeEventListener('eno:consent', on)
  }, [])

  useEffect(() => {
    if (!GA_ID) return
    let done = false
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    let idleId: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      events.forEach((e) => window.removeEventListener(e, go))
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
      if (idleId != null && cic) cic(idleId)
      if (timer) clearTimeout(timer)
    }
    function go() { if (done) return; done = true; cleanup(); setReady(true) }

    events.forEach((e) => window.addEventListener(e, go, { once: true, passive: true }))
    // Idle fallback so users who never interact are still counted — long enough to
    // stay out of the LCP/TBT measurement window.
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    if (ric) idleId = ric(() => go(), { timeout: 6000 })
    else timer = setTimeout(go, 6000)
    return cleanup
  }, [])

  if (!ready) return null

  return (
    <>
      {adConsent && GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="lazyOnload" />
          <Script id="ga-init" strategy="lazyOnload">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </>
      )}
    </>
  )
}
