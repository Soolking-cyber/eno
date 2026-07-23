'use client'

import { useEffect, useState } from 'react'

/**
 * False during SSR and the hydration pass, true from the first post-mount render.
 * Gate CLIENT-CLOCK-dependent UI on this (e.g. the "Active today" presence bucket)
 * so its element can never structurally mismatch the server HTML — on a stale ISR
 * page the baked markup and a fresh client compute legitimately disagree, and
 * suppressHydrationWarning only covers text, not an element appearing/disappearing.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}
