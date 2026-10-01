/* eslint-disable react/jsx-no-literals -- inline <Script> bodies are JS code, not user-facing copy */
'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { hasAnalyticsConsent, syncConsentStorage } from '@/lib/consent'
import { applyConsentMode, enforceConsentCleanup } from '@/lib/consent-runtime'
import { CONSENT_V2_KEY } from '@/lib/consent-value'
import { GA_ID } from '@/lib/analytics'
import { IS_SERVICES } from '@/lib/edition'

// Google Analytics (GA4) only. The Meta Pixel was removed (heaviest 3rd-party,
// ~233 KiB; only useful for paid Meta-ad retargeting — re-add if you run Meta ads).
//
// CONSENT (v2): GA loads ONLY with the Analytics purpose (`a`), reactively the instant it is
// granted — never inside the native apps. It boots with Google Consent Mode set to all-denied and
// is immediately updated from the visitor's answer: analytics_storage follows `a`, the three ad
// signals follow Advertising (`d`). That is the BASIC implementation on purpose: the "advanced" one
// loads the tag before consent and sends cookieless pings, which is still processing IP and device
// data without consent. No `a` → zero Google Analytics JS.
// ⚠️ This component is also where consent is ENFORCED on every page: it syncs the stored answer and
// runs the cleanup (src/lib/consent-runtime.ts) on mount, on every `eno:consent`, and when a choice
// made in ANOTHER TAB reaches this one (see the effect below).
//
// GA is additionally NOT injected until the user FIRST INTERACTS (pointer/key/
// touch/scroll), with an idle fallback — so ~155 KiB of vendor JS never competes
// with hydration/LCP/TBT, and Lighthouse (which never interacts) sees a clean
// critical path. gtag self-queues so a PageView is never dropped. Helpers in
// lib/analytics.ts guard window.gtag.
//   NEXT_PUBLIC_GA_ID e.g. G-XXXXXXXXXX (env overrides the public default in lib/analytics.ts)

/**
 * The all-denied Consent Mode default, then the visitor's current answer (`window.__enoCm`, set by
 * applyConsentMode) if it is already known. Inlined into BOTH bootstraps so whichever runs first
 * starts denied; later changes arrive as `consent update` pushes (consent-runtime.ts).
 */
const CONSENT_DEFAULT = `{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500}`

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
  // Analytics consent — reactive: flips the instant the visitor grants or withdraws it.
  const [analytics, setAnalytics] = useState(false)
  useEffect(() => {
    // ⛔ ON EVERY LOAD, not only on a change — see the header of src/lib/consent-runtime.ts.
    syncConsentStorage()
    const refresh = () => {
      enforceConsentCleanup()
      applyConsentMode()
      setAnalytics(hasAnalyticsConsent())
    }
    refresh()
    /**
     * ⛔ A WITHDRAWAL IN ANOTHER TAB MUST REACH THIS ONE TOO. `eno:consent` is a same-tab event, so a
     * visitor who declined in tab B left tab A's already-loaded gtag.js running: its enhanced-measurement
     * hits (history-change page views, scrolls) never pass through ga() in src/lib/analytics.ts, GA's
     * kill switch was never set here, and it rewrote the `_ga` cookie tab B had just deleted — while
     * /privacy says turning a use off "takes effect immediately on this device".
     *   · `storage` fires in every OTHER tab of this origin the moment setConsent() writes its
     *     localStorage copy (key null = storage cleared) — the immediate path.
     *   · focus / visibilitychange re-read the cookie when this tab is looked at again — the path for a
     *     browser with localStorage blocked, and for a choice made on another host of the edition
     *     (a storefront shares the cookie but not this origin's localStorage).
     * refresh() is idempotent and cheap, so a spurious call costs nothing.
     */
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === CONSENT_V2_KEY) refresh() }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('eno:consent', refresh)
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('eno:consent', refresh)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
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

  return (
    <>
      {/**
        * ⛔ ON eno.forum THE CONTAINER LOADS FOR EVERY VISITOR — no consent gate, no interaction
        * gate. Owner, 2026-08-18: "for eno.forum we dont need compliance outside vietnam", after
        * GTM's installer reported "Your Google tag wasn't detected". It could not detect it: that
        * crawler arrives with no consent and never interacts, which is precisely the state the gate
        * existed to block. Nothing was broken — the detector asks whether the tag fires
        * unconditionally, and until now the honest answer was no.
        *
        * ⛔ IT RENDERS ABOVE THE `ready` GATE ON PURPOSE. This component used to `return null` until
        * first interaction, so a container placed in the block below would still have been
        * invisible to any crawler however much consent logic was removed. Moving it out is what
        * actually changes the answer; deleting the consent check alone would not have.
        *
        * ⚠️ I FLAGGED, AND THE OWNER DECIDED, THAT "OUTSIDE VIETNAM" IS NOT "NO CONSENT LAW". A
        * Vietnam e-visa service draws EU and UK visitors, where GDPR/ePrivacy require opt-in for
        * non-essential trackers regardless of where the operator sits — so this trades a Vietnamese
        * rule for a stricter foreign one rather than escaping regulation. Recorded because the next
        * reader will otherwise assume nobody considered it.
        *
        * ⚠️ THE PUBLISHED PROMISE MOVED IN THE SAME COMMIT. /privacy said "Decline and no
        * third-party tracking runs, server-side included" — false on eno.forum from now on, so that
        * page says something different there. Code and policy drifting apart is worse than either
        * choice on its own.
        *
        * ⚠️ WHAT DID NOT CHANGE: GA needs the Analytics purpose and the server-side Meta CAPI the
        * Advertising purpose on BOTH editions, and eno.vn has no container at all (no GTM_ID in its
        * env). Only this container is unconditional, so the tags inside it are governed in the GTM
        * console.
        *
        * ⚠️ CONSENT v2 GIVES THE CONTAINER A CONSENT STATE: the snippet now pushes the all-denied
        * Consent Mode default BEFORE gtm.js, then the visitor's answer as an update. Google tags in the
        * container honour that on their own; a CUSTOM HTML tag (the paused Meta Pixel is one) does NOT
        * — before it is ever unpaused it must be set to require ad_storage in the GTM console, and
        * `fb()` in src/lib/analytics.ts refuses to fire without the Advertising purpose either way.
        */}
      {IS_SERVICES && GTM_ID && (
        <Script id="gtm-init" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];function g(){w[l].push(arguments)}g('consent','default',${CONSENT_DEFAULT});if(w.__enoCm)g('consent','update',w.__enoCm);w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
      )}
      {ready && analytics && GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="lazyOnload" />
          <Script id="ga-init" strategy="lazyOnload">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('consent','default',${CONSENT_DEFAULT});if(window.__enoCm)gtag('consent','update',window.__enoCm);gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </>
      )}
    </>
  )
}
