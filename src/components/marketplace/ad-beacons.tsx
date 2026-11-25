'use client'

import { useEffect } from 'react'

/**
 * ── Counts paid ads seen and clicked (owner 2026-11-23, src/lib/ads; to industry standard since 2026-11-25). A card the
 * feed served as an ad carries `data-ad-id` (listing-card.tsx, ad-creative-card.tsx); this finds such cards wherever they
 * are drawn and tells /api/ads/[id]/event:
 *   t=i  a VIEWABLE impression (IAB/MRC display): at least half the card on screen for one continuous second;
 *   t=c  a click — `click` or `auxclick` (a middle click opening it in a new tab).
 * Once per ad per kind per PAGE (the URL: a client navigation is a new page, the root layout is not), with `s`, a random
 * id this tab keeps in sessionStorage for its session: the server counts each (session, ad, kind) once per 30 minutes
 * (src/lib/ads/stats.ts) — per session, not per IP, since one carrier NAT is thousands of phones. No storage, no id: the
 * server falls back to the address. Starts when the browser is idle, renders nothing, sends no cookie of its own and
 * nothing but the ad id, the kind and that id.
 */
const SEEN_MS = 1000
const SESSION_KEY = 'eno.adsid'

/** This tab's session id for ad counting (sessionStorage): random, never linked to the account. Null when storage is off. */
function sessionId(): string | null {
  try {
    const have = sessionStorage.getItem(SESSION_KEY)
    if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    sessionStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    return null
  }
}

export function AdBeacons() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof navigator === 'undefined' || !navigator.sendBeacon) return
    const sent = new Set<string>()
    const observed = new WeakSet<Element>()
    const timers = new Map<Element, number>()
    const page = () => `${location.pathname}${location.search}`
    const sid = sessionId()
    const send = (id: string, t: 'i' | 'c') => {
      const key = `${t}|${id}|${page()}`
      if (sent.has(key)) return
      sent.add(key)
      try { navigator.sendBeacon(`/api/ads/${encodeURIComponent(id)}/event`, JSON.stringify(sid ? { t, s: sid } : { t })) } catch { /* best effort */ }
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.adId
        if (!id) continue
        // ≥ half on screen (an entry can report intersecting below the threshold on its first callback).
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!timers.has(e.target)) timers.set(e.target, window.setTimeout(() => { timers.delete(e.target); send(id, 'i') }, SEEN_MS))
        } else {
          const t = timers.get(e.target)
          if (t !== undefined) { clearTimeout(t); timers.delete(e.target) }
        }
      }
    }, { threshold: 0.5 })
    const scan = () => {
      document.querySelectorAll<HTMLElement>('[data-ad-id]').forEach((el) => {
        if (observed.has(el)) return
        observed.add(el)
        io.observe(el)
      })
    }
    let pending = 0
    const mo = new MutationObserver(() => {
      if (pending) return
      pending = window.setTimeout(() => { pending = 0; scan() }, 400)
    })
    const onClick = (ev: MouseEvent) => {
      // auxclick: only the middle button (a new tab); a right click opens a menu, not the ad.
      if (ev.type === 'auxclick' && ev.button !== 1) return
      const card = (ev.target as Element | null)?.closest?.('[data-ad-id]') as HTMLElement | null
      if (card?.dataset.adId) send(card.dataset.adId, 'c')
    }
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 3000 }) : window.setTimeout(cb, 1500))
    let started = false
    idle(() => {
      started = true
      scan()
      mo.observe(document.body, { childList: true, subtree: true })
    })
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onClick, true)
    return () => {
      if (started) mo.disconnect()
      io.disconnect()
      if (pending) clearTimeout(pending)
      timers.forEach((t) => clearTimeout(t))
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', onClick, true)
    }
  }, [])
  return null
}
