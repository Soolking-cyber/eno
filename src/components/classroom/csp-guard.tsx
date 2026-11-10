'use client'

import { useEffect } from 'react'
import { isClassroomPath } from '@/lib/classroom/host'

/**
 * ⛔ THE CLASSROOM NEEDS A DOCUMENT OF ITS OWN (owner's iPhone, 2026-11-10: lessons stuck on "Connecting…", four listening
 * keys each, and no reason ever reached the log). A Content-Security-Policy belongs to the DOCUMENT, and only /classroom
 * pages are served the one that admits Soniox's listening socket and the avatar's hosts (next.config.ts `cspClassroom`).
 * Arrive by a client-side navigation from any other eno.vn page and the document keeps the site's policy: iOS WebKit then
 * refuses `new WebSocket` to Soniox outright (a SecurityError — no request ever leaves the phone), the face cannot load,
 * and the lesson waits on a socket that can never open. So a classroom page shown in a document that was loaded for some
 * other page loads itself again — once — and the server sends the classroom's policy with it.
 */
export function ClassroomCspGuard({ reload = hardReload }: { reload?: () => void }) {
  useEffect(() => {
    const doc = thisDocument()
    if (!loadedForAnotherPage(doc?.url)) return
    // NEVER A LOOP. A reload makes a classroom document, so this runs once — unless the reload lands elsewhere (a sign-in
    // redirect) and the page comes back here by itself. So a document that a reload made, minutes after this guard's own
    // reload, is left as it is. Only THAT one (commit review, codex): any other document — a page opened afresh moments
    // later — still gets its reload. With no storage to read the time from, any reload-made document counts as ours.
    let ours = doc!.type === 'reload'
    try {
      if (ours) ours = Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 15_000
      if (!ours) sessionStorage.setItem(RELOADED_AT, String(Date.now()))
    } catch { /* no storage: as above */ }
    if (!ours) reload()
  }, [reload])
  return null
}

const RELOADED_AT = 'eno-classroom-own-document'
const hardReload = () => window.location.reload()

/** The URL this document was loaded for — not the one it shows now (a client-side navigation changes only that) — and how
 *  it was loaded ('reload' for location.reload()). */
function thisDocument(): { url: string; type: string } | undefined {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    return nav?.name ? { url: nav.name, type: nav.type } : undefined
  } catch {
    return undefined
  }
}

/** Was this document loaded for a page outside the classroom (so its policy is the site's)? Unknown → no. */
export function loadedForAnotherPage(url: string | undefined): boolean {
  if (!url) return false
  try {
    // The proxy's /en|/vi rewrite never shows in the address bar — stripped anyway, as next.config.ts matches both.
    const path = new URL(url).pathname.replace(/^\/(?:en|vi)(?=\/|$)/, '') || '/'
    return !isClassroomPath(path)
  } catch {
    return false
  }
}
