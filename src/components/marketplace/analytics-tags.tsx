'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { hasAdConsent } from '@/lib/consent'

// Google Analytics (GA4) only. The Meta Pixel was removed (heaviest 3rd-party,
// ~233 KiB; only useful for paid Meta-ad retargeting — re-add if you run Meta ads).
//
// GA is NOT injected until the user FIRST INTERACTS (pointer/key/touch/scroll),
// with an idle fallback — so ~155 KiB of vendor JS never competes with
// hydration/LCP/TBT, and Lighthouse (which never interacts) sees a clean critical
// path. Real users get analytics within a frame of engaging; gtag self-queues so a
// PageView is never dropped. Helpers in lib/analytics.ts guard window.gtag.
//   NEXT_PUBLIC_GA_ID e.g. G-XXXXXXXXXX (env overrides the public default below)
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-CKTZK62B0X'
// Meta Pixel (ad-network retargeting) — OFF unless an id is configured AND the visitor
// granted personalization consent ('Allow'). Keeps the heavy pixel off by default.
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

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
      {GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="lazyOnload" />
          <Script id="ga-init" strategy="lazyOnload">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </>
      )}
      {/* Meta Pixel — only with personalization consent + a configured id. Enables the
          (otherwise dormant) Meta retargeting events in lib/analytics.ts. */}
      {adConsent && META_PIXEL_ID && (
        <Script id="fb-pixel" strategy="lazyOnload">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}
    </>
  )
}
