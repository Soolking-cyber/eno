'use client'

import { useState, useSyncExternalStore } from 'react'

const subscribeNothing = () => () => {}

/**
 * True when this component instance was born in the server render or the hydration render, false when it mounted on the client (Back, an in-app link,
 * hydration-failure recovery), and it never changes for that instance.
 *
 * ⛔ `useSyncExternalStore(subscribe, () => false, () => true)` ANSWERS THE SAME QUESTION AND THEN RE-RENDERS. React compares the two snapshots right after the
 * hydration commit and forces a synchronous render when they differ: on the explorer that was every child of the page, inside the longest task of the load
 * (speed audit, 2026-11-03). Here React's call to the server snapshot records that it happened, so the client snapshot agrees with it from then on.
 */
export function useHydrationRender(): boolean {
  const [born] = useState(() => ({ fromServerHtml: false }))
  return useSyncExternalStore(
    subscribeNothing,
    () => born.fromServerHtml,
    () => (born.fromServerHtml = true),
  )
}
