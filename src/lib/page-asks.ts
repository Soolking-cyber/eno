// ── One ask per page view (UX3 J7f, 2026-10-05) ───────────────────────────────────────────────────
//
// The timed "Join eno" prompt (signup-prompt.tsx) and the "Get the eno app" card (install-hint.tsx) both
// arrive on their own timers, so nothing stopped them landing on the same screen — the report counted up
// to four interruptions in a phone visitor's first four minutes (consent bar, join prompt, install card,
// the second join prompt). NN/g lists stacking popups among the most-hated patterns.
//
// THE RULE: an ask may appear only when the OTHER ask is not on screen AND did not appear in this page
// view. A page view is a pathname; every route change starts a new one, and an ask still on screen when
// the route changes counts as appearing in the new view too (the install card persists across client
// navigations until it is dismissed). The ask that loses simply waits for a later page view — nothing
// is dropped and no schedule changes.
//
// ⚠️ MODULE STATE, ONE PAGE LIFE: both asks are mounted once under the root layout (providers.tsx), so a
// plain module is the shared memory. A reload starts it fresh, which is a new page view anyway.
//
// ⛔ A THIRD ASK SINCE UX2 W2 B2-NOTIFY (2026-10-05): 'push', the "turn on notifications" card
// (push-opt-in-card.tsx — the post-success screen and the inbox). The rule is the same rule, read for
// any number of asks: an ask may appear only when no OTHER ask is on screen and none appeared in this
// page view. With 'push' never shown, join and install behave exactly as before (page-asks.test.ts).
// The card is mounted by its pages, not by providers.tsx, so its own unmount reports it hidden.

export type PageAsk = 'join' | 'install' | 'push'
const ASKS: readonly PageAsk[] = ['join', 'install', 'push']

let view = 0
let lastPath: string | null = null
const visible = new Set<PageAsk>()
const appearedIn = new Map<PageAsk, number>()

/** The route this page view is on. A different path than last time is a new page view. */
export function notePageView(path: string | null | undefined): void {
  const p = path ?? ''
  if (p === lastPath) return
  lastPath = p
  view += 1
  // Still on screen across the navigation → it is on screen in this view as well.
  for (const a of visible) appearedIn.set(a, view)
}

/** May `ask` appear now, on `path`? False while another ask is on screen or already appeared in this view. */
export function mayAsk(ask: PageAsk, path: string | null | undefined): boolean {
  notePageView(path)
  return ASKS.every((o) => o === ask || (!visible.has(o) && appearedIn.get(o) !== view))
}

/** `ask` just appeared. */
export function askShown(ask: PageAsk, path: string | null | undefined): void {
  notePageView(path)
  visible.add(ask)
  appearedIn.set(ask, view)
}

/** `ask` left the screen (dismissed, answered, or its host unmounted). */
export function askHidden(ask: PageAsk): void {
  visible.delete(ask)
}

/** Tests only. */
export function __resetPageAsksForTests(): void {
  view = 0
  lastPath = null
  visible.clear()
  appearedIn.clear()
}
