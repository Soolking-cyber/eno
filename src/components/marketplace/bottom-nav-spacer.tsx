/**
 * Reserves the FOOTPRINT of the fixed mobile bottom-nav so page content isn't hidden behind
 * it. Since 2026-11-14 the nav is docked again (owner-approved): 56px + the home-indicator band, so 4.5rem + the
 * inset is the bar plus 16px of air (it floated as a 56px pill 12px up from 2026-09-26, which set the number); the
 * same 4.5rem every other bottom-anchored surface clears (mobile-nav.tsx has the list). Collapses (via CSS `html.kb-open .bottom-nav-spacer`) when the keyboard is up — the
 * nav hides then, so its leftover 4.5rem would otherwise sit as dead space below the chat
 * composer. CSS-driven (not React) so it collapses in the same frame the keyboard is
 * detected, never lagging behind a coalesced boolean. A plain server element — no hook.
 */
export function BottomNavSpacer() {
  return <div aria-hidden className="bottom-nav-spacer pc:hidden h-[calc(4.5rem+env(safe-area-inset-bottom))] bg-card" />
}
