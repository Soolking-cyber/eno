'use client'

import { useEffect } from 'react'

// "eno" hero wordmark — the landing LCP element. Served as a small EXTERNAL file
// (not a data URI): a data URI put the logo's ~6.6KB inside the HTML, so on Slow-4G
// it couldn't paint until ~28KB of critical HTML (21KB inline CSS + the data URI)
// downloaded — a 2.5s self-inflicted render delay. As an external <img> with a
// high-priority preload, it's an LCP candidate that fetches in parallel and keeps the
// HTML small. width/height set the 4:1 ratio → no CLS.
//
// The preload is CO-LOCATED here (not in the home page's Server Component) on purpose:
// a Server-Component <link rel=preload> is hoisted to <head> but NOT removed on soft
// navigation, so it leaked onto every non-home route and warned "preloaded but not used".
// Rendering it from this CLIENT component keeps it in the initial SSR <head> (LCP intact),
// and the unmount cleanup guarantees it's gone the instant we navigate away from home —
// this component only ever renders in the home hero.
export function LogoWordmark({ className }: { className?: string }) {
  useEffect(() => () => {
    document.head.querySelectorAll('link[rel="preload"][href="/logo.svg"]').forEach((l) => l.remove())
  }, [])

  return (
    <>
      <link rel="preload" href="/logo.svg" as="image" fetchPriority="high" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="eno.vn Logo"
        width={320}
        height={80}
        fetchPriority="high"
        decoding="async"
        className={className}
      />
    </>
  )
}
