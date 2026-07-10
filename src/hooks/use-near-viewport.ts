'use client'

import { useEffect, useRef, useState } from 'react'

// One-shot "is this element within ~a viewport of being seen?" — for deferring below-fold
// data fetches out of the LCP window. Attach `ref` to a sentinel that exists from first
// render (the component must render SOMETHING pre-data, else there is nothing to observe);
// `near` flips true once and stays true (the observer disconnects itself). rootMargin
// pre-triggers a full viewport ahead so the content is usually ready before it scrolls in.
// No-IO environments (old WebViews, jsdom) fail open: fetch immediately.
export function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (near) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) { setNear(true); obs.disconnect() }
      },
      { rootMargin: '100% 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [near])

  return { ref, near }
}
