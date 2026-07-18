'use client'

import { useCallback, useEffect, useRef } from 'react'

// The ONE stale-async guard (audit Phase 2): ~8 components hand-rolled overlapping
// fetch lifecycles — a slow earlier response landing after a fast later one would
// clobber fresh state (the classic out-of-order race), and unmounted components kept
// applying results. The codebase already invented the cure as help-popover's
// `sendEpoch`; this hook is that idiom, shared: every `begin()` invalidates all
// earlier requests (and aborts their fetch), `isCurrent()` gates the state writes.
//
//   const latest = useLatestRequest()
//   const load = async () => {
//     const req = latest.begin()
//     const res = await fetch('/api/...', { signal: req.signal })
//     if (!req.isCurrent()) return          // a newer request superseded this one
//     setState(await res.json())
//   }
//
// Unmount aborts the in-flight request. AbortError rejections from superseded fetches
// are the caller's to swallow (catch → if (!req.isCurrent()) return).

export type LatestRequest = {
  /** AbortSignal for the fetch of THIS request. */
  signal: AbortSignal
  /** True while no newer begin() has happened (and we're still mounted). */
  isCurrent: () => boolean
}

export function useLatestRequest(): { begin: () => LatestRequest } {
  const epochRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    // Unmount: invalidate everything and cancel the in-flight fetch.
    epochRef.current++
    abortRef.current?.abort()
  }, [])

  const begin = useCallback((): LatestRequest => {
    const epoch = ++epochRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    return {
      signal: controller.signal,
      isCurrent: () => epoch === epochRef.current,
    }
  }, [])

  return { begin }
}
