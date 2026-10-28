import { useSyncExternalStore } from 'react'
import { HIDDEN_SELLERS_EVENT, hiddenSellersParam } from '@/lib/hidden-sellers'

/**
 * The `xs` value (src/lib/hidden-sellers.ts) as React state — ⛔ PART OF THE EXPLORER'S FEED KEY (codex + opus, review): a
 * block, an unblock, a sign-out or another account changes the key, so the feed starts again at page 1 under the new
 * exclusion set like any filter change, instead of keeping rows fetched without it and offsetting later pages against a
 * different set. '' on the server and during hydration (getServerSnapshot), then the stored list — so a blocker's reload
 * re-asks once; everyone else's key never moves.
 * ⚠️ CLIENT-ONLY, AND THAT IS WHY IT IS NOT IN hidden-sellers.ts: server code imports that module.
 */
export function useHiddenSellersParam(): string {
  return useSyncExternalStore(subscribe, hiddenSellersParam, () => '')
}

function subscribe(on: () => void): () => void {
  window.addEventListener(HIDDEN_SELLERS_EVENT, on)
  return () => window.removeEventListener(HIDDEN_SELLERS_EVENT, on)
}
