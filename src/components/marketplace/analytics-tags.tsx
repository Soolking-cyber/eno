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

/**
 * GOOGLE TAG MANAGER — eno.forum's container, and the reason the Meta Pixel comes back as a TAG
 * rather than as code.
 *
 * ⛔ NO DEFAULT VALUE, UNLIKE `GA_ID` ABOVE, AND THAT IS THE EDITION GATE. The variable is set only
 * in eno-services-env, so a marketplace build inlines `undefined` and this whole block folds away —
 * eno.vn loads no container, has no dataLayer, and cannot have a tag added to it from a web UI by
 * anyone. That is deliberate: eno.vn is the licensed sàn TMĐT, and a GTM container is a standing
 * permission to inject third-party JavaScript into a page. Do not give it a fallback id "so both
 * sites are consistent".
 *
 * ⚠️ CSP IS THE BRAKE ON GTM, AND IT IS DOING REAL WORK. `googletagmanager.com` was already
 * allowed (GA uses it), so the container loads — but any tag added in the GTM UI whose vendor
 * domain is NOT in the CSP allowlist silently fails to load. That is a feature: it means adding a
 * tag in a web console cannot, by itself, ship a new third party onto this site. Whoever adds one
 * has to come here and widen the policy in next.config.ts, in a reviewed commit.
 */
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID
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
      {/**
        * ⚠️ SAME CONSENT AND SAME FIRST-INTERACTION GATE AS GA — NOT LOADED EAGERLY. PDPL 91/2025
        * classifies cyberspace behavioural data as SENSITIVE personal data needing explicit opt-in
        * (compliance audit 2026-07-06), and /privacy publishes that no third-party tracker runs
        * without the 'all' tier. A container that boots before consent would break that published
        * promise no matter what the tags inside it do, because the container itself is the tracker.
        * `ready` additionally holds it until first interaction, so ~100 KiB of tag-manager JS never
        * competes with hydration or the LCP.
        */}
      {adConsent && GTM_ID && (
        <Script id="gtm-init" strategy="lazyOnload">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
      )}
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
