import { useSyncExternalStore } from 'react'

/**
 * ⛔ THE HEADER STAYS PUT WHILE THE HOME PAGE'S PHONE LANES ARE ON THE PAGE (owner-approved 2026-11-15 (build 8), cook r08
 * home: "the raised search pill as the one primary action, staying put on the home page"). It reverses, below `sm` and on
 * that one view only, the header's "Facebook-style on ALL sizes" hide-on-scroll (header.tsx, owner 2026-07-16): the search
 * never slides away there, and the category pills pin under it (category-rail.tsx `pills`) — header and pills one top block.
 * ⚠️ THE PIN OUTLIVED ITS FIRST REASON. Build 8 pinned the bar because its home pill was the page's one primary action; round
 * 13 (owner, 2026-11-17: "mobile top search bar is not in harmony with logo on left lets make sure it looks part of app")
 * replaced that pill with the one quiet search tile every route wears. Nobody asked for the pin to go, so the behaviour
 * stands as approved: what it keeps on screen now is the search and the pinned category pills under it.
 * ⚠️ ASKED OF THE EXPLORER, NOT GUESSED FROM THE URL. Only the explorer knows whether the home feed is undirected (the lanes
 * are drawn — listings-explorer.tsx `showHomeLanes`): a search or a filter on `/` keeps the path, and there the header keeps
 * its slide (the goods search's sticky strip leaves with it). The explorer sets this in a layout effect, so it is in place
 * before the first scroll can hide anything; it is false on the server and in the hydration render, where the header is
 * shown anyway (useHideOnScroll starts every visit shown).
 * One value, one writer (the explorer), and the header reads it. Every other bar that follows the header's slide
 * (explorer-toolbar.tsx, section-header.tsx) still runs its own useHideOnScroll, unchanged: the feed's sort strip still
 * leaves on a scroll down and comes back under the pinned header on a scroll up.
 */
let pinned = false
const listeners = new Set<() => void>()

export function setHeaderPinned(next: boolean) {
  if (next === pinned) return
  pinned = next
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** True while the undirected home feed's phone lanes are drawn: the header does not slide away below `sm`. */
export function useHeaderPinned(): boolean {
  return useSyncExternalStore(subscribe, () => pinned, () => false)
}
