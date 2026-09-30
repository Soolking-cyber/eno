'use client'

import { useSyncExternalStore } from 'react'

/**
 * Is the viewport a PHONE — below Tailwind's `sm` (640px)? The explorer's filter panels ask this to
 * choose their container: an anchored popover from `sm` up, a bottom sheet (ui/drawer) below it —
 * the canon's "mobile filters → ui/drawer" (docs/design-language.md §5, E-FILTER-SHEET 2026-09-29).
 *
 * ⚠️ `639.98px`, NOT `639px`: `sm:` is `min-width: 40rem`, and a fractional viewport (a zoomed
 * desktop, a DPR-scaled Android) can sit between 639 and 640 — `max-width: 639px` would then call it
 * neither a phone nor `sm`. The .98 is Bootstrap's long-standing answer to the same gap.
 * ⚠️ "NOT A PHONE" ON THE SERVER AND ON THE HYDRATING RENDER (the server snapshot), so markup that
 * renders on the server is the desktop one and cannot mismatch. The panels that read this mount
 * after hydration anyway (the facet bar is `ssr: false`), and the real value arrives with the first
 * client commit — the same contract as `useMdUp` in ladder-compact-row.tsx.
 * ⚠️ `addListener` fallback: Safari ≤13 has no `addEventListener` on MediaQueryList (ui/tooltip.tsx
 * records the white screen that throw would cause).
 */
const PHONE = '(max-width: 639.98px)'

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(PHONE)
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }
  mql.addListener(onChange)
  return () => mql.removeListener(onChange)
}
const getSnapshot = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE).matches : false)
const getServerSnapshot = () => false

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
