'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { stripViPrefix } from '@/lib/lang-pinned'

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
/** Who re-renders when the answer changes — the skip link's "Skip to listings" (D-KEYBOARD). */
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

export function explorerMounted(): boolean {
  return mounted > 0
}

/** Call once from <ListingsExplorer>; registers for as long as it is mounted. */
export function useRegisterExplorer(): void {
  useEffect(() => {
    mounted++
    emit()
    return () => {
      mounted = Math.max(0, mounted - 1)
      emit()
    }
  }, [])
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * The same answer as `explorerMounted()`, as state a component can RENDER from. False on the server
 * and while hydrating (the explorer registers in an effect, so nothing is mounted before the first
 * client commit either way) — markup that depends on it cannot mismatch.
 */
export function useExplorerMounted(): boolean {
  return useSyncExternalStore(subscribe, explorerMounted, () => false)
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
  // `/vi/c/<x>` of a piloted category is category `x` (SEO wave B, V3a; the identity while the pilot is off).
  const raw = stripViPrefix(pathname)?.match(/^\/c\/([^/?#]+)/)?.[1]
  if (!raw) return null
  try { return decodeURIComponent(raw) } catch { return null }
}
