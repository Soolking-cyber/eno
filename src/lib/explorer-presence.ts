'use client'
import { useEffect } from 'react'

/**
 * Is a <ListingsExplorer> mounted on this page right now?
 *
 * ⛔ ASKED AT ACTION TIME, NEVER INFERRED FROM THE PATHNAME. The header used to decide
 * `pathname === '/' || pathname.startsWith('/c/')` and then hand search, the map, a brand pick, an
 * area pick and image search to the explorer as window events. The /c/<category> landing pages
 * never mounted the explorer (they are SEO pages with their own grid), so on every one of them those
 * events had no listener: Enter was swallowed and nothing happened — measured live on /c/rentals.
 * The explorer now says it is here; anything that wants to talk to it asks.
 *
 * A counter, not a boolean: a stale unmount of one instance (a fast route change, React strict-mode
 * double effects) must not report "absent" while another instance is still mounted.
 */
let mounted = 0

export function explorerMounted(): boolean {
  return mounted > 0
}

/** Call once from <ListingsExplorer>; registers for as long as it is mounted. */
export function useRegisterExplorer(): void {
  useEffect(() => {
    mounted++
    return () => {
      mounted = Math.max(0, mounted - 1)
    }
  }, [])
}

/**
 * Where an explorer-bound action goes when no explorer is mounted: the home explorer — keeping the
 * CATEGORY of a /c/<category> landing page, so searching from "Rentals" searches rentals rather
 * than widening to the whole site. `extra` is merged in (q, view, match…). The district segment of
 * /c/<category>/<district> is not carried: its slug is a landing-page key, not the explorer's
 * `district` filter value.
 */
export function explorerFallbackUrl(pathname: string | null | undefined, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  const category = categoryFromPath(pathname)
  if (category) p.set('category', category)
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  const qs = p.toString()
  return qs ? `/?${qs}` : '/'
}

/** The category of a /c/<category>[/<district>] landing page, or null anywhere else. */
export function categoryFromPath(pathname: string | null | undefined): string | null {
  const raw = pathname?.match(/^\/c\/([^/?#]+)/)?.[1]
  if (!raw) return null
  try { return decodeURIComponent(raw) } catch { return null }
}
