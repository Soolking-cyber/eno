'use client'

import { useEffect } from 'react'

// "eno.vn" hero wordmark — the landing LCP element.
//
// ⚠️ SERVES /logo-dotvn.svg, NOT /logo.svg, AND THAT IS A VERIFICATION REQUIREMENT RATHER THAN
// a style choice. Google's OAuth brand review rejected this app repeatedly with "the app name …
// does not match the app name on your home page" whichever name was configured, because the page
// carried TWO: the wordmark read "eno" while the title, headings and metadata read "eno.vn"
// (measured 2026-08-02: 8 visible occurrences of "eno.vn", 0 of "eno"). The .vn lockup extends
// the mark in its own geometry — original e/n/o paths, dot at the measured stroke weight, v built
// to the same x-height — so the page states one name. The header serves the SAME lockup as of
// 2026-08-02 (owner). /logo.svg survives only where the short mark is not read as a name: JSON-LD
// publisher/organization logos, the OG-image generator, and the `.skeleton-photo` loading tint
// (globals.css, opacity 0.28, replaced the instant a photo loads). Served as a small EXTERNAL file
// (not a data URI): a data URI put the logo's ~6.6KB inside the HTML, so on Slow-4G
// it couldn't paint until ~28KB of critical HTML (21KB inline CSS + the data URI)
// downloaded — a 2.5s self-inflicted render delay. As an external <img> with a
// high-priority preload, it's an LCP candidate that fetches in parallel and keeps the
// HTML small. width/height set the ratio → no CLS.
//
// The preload is CO-LOCATED here (not in the home page's Server Component) on purpose:
// a Server-Component <link rel=preload> is hoisted to <head> but NOT removed on soft
// navigation, so it leaked onto every non-home route and warned "preloaded but not used".
// Rendering it from this CLIENT component keeps it in the initial SSR <head> (LCP intact),
// and the unmount cleanup guarantees it's gone the instant we navigate away from home —
// this component only ever renders in the home hero.
export function LogoWordmark({ className }: { className?: string }) {
  useEffect(() => () => {
    document.head.querySelectorAll('link[rel="preload"][href="/logo-dotvn.svg"]').forEach((l) => l.remove())
  }, [])

  return (
    <>
      <link rel="preload" href="/logo-dotvn.svg" as="image" fetchPriority="high" />
      <img
        src="/logo-dotvn.svg"
        alt="eno.vn"
        width={1431}
        height={300}
        fetchPriority="high"
        decoding="async"
        className={className}
      />
    </>
  )
}
