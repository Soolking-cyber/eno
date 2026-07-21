/**
 * Reserves the height of the fixed mobile bottom-nav so page content isn't hidden behind
 * it. Collapses (via CSS `html.kb-open .bottom-nav-spacer`) when the keyboard is up — the
 * nav hides then, so its leftover ~4rem would otherwise sit as dead space below the chat
 * composer. CSS-driven (not React) so it collapses in the same frame the keyboard is
 * detected, never lagging behind a coalesced boolean. A plain server element — no hook.
 */
export function BottomNavSpacer() {
  return <div aria-hidden className="bottom-nav-spacer lg:hidden h-[calc(4.5rem+env(safe-area-inset-bottom))] bg-card" />
}
