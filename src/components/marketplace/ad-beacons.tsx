'use client'

import { useEffect } from 'react'

/**
 * ── Counts paid ads seen and tapped (owner 2026-11-23, src/lib/ads). A card the feed served as an ad carries
 * `data-ad-id` (listing-card.tsx); this finds such cards wherever they are drawn and tells /api/ads/[id]/event:
 *   t=i  the card was at least half on screen for a second;  t=c  it was tapped.
 * Once per ad per kind per PAGE (the URL: a client navigation is a new page, the root layout is not), and the server
 * adds its own per-visitor limit and counts only while the ad runs. Starts when the browser is idle, renders nothing,
 * sends no cookie of its own and nothing but the ad id and the kind.
 */
const SEEN_MS = 1000

export function AdBeacons() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof navigator === 'undefined' || !navigator.sendBeacon) return
    const sent = new Set<string>()
    const observed = new WeakSet<Element>()
    const timers = new Map<Element, number>()
    const page = () => `${location.pathname}${location.search}`
    const send = (id: string, t: 'i' | 'c') => {
      const key = `${t}|${id}|${page()}`
      if (sent.has(key)) return
      sent.add(key)
      try { navigator.sendBeacon(`/api/ads/${encodeURIComponent(id)}/event`, JSON.stringify({ t })) } catch { /* best effort */ }
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
    return () => {
      if (started) mo.disconnect()
      io.disconnect()
      if (pending) clearTimeout(pending)
      timers.forEach((t) => clearTimeout(t))
      document.removeEventListener('click', onClick, true)
    }
  }, [])
  return null
}
