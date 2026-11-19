import { onINP } from 'web-vitals'
// ⚠️ Only CLS uses the attribution build: INP keeps the plain one, so the totals it feeds measure exactly what they did
// (the attribution build does extra work per interaction, inside the very interactions INP times — commit gate).
import { onCLS } from 'web-vitals/attribution'
import type { RumClsWhat, RumClsWhere } from './shared'

// ── Page-speed totals: CLS and INP from web-vitals, in their own chunk (speed plan item 5) ─────────────────
//
// Loaded by src/lib/rum/early.ts after the page's load (or at 3 s), never with the first JavaScript. Late is fine for
// both: layout shifts come from a buffered observer, and INP's early interactions are kept by the browser's own
// event buffer (≥104 ms only, so an early FAST tap goes uncounted — it could never have been the slowest one).
// ⚠️ Default reporting, NOT reportAllChanges: web-vitals hands over the final value inside its own capture-phase
// visibilitychange listener, and early.ts flushes in the bubble phase after it.
// The ATTRIBUTION build (2026-11-19, owner "shift fix yes"): for CLS, which element moved most — reduced HERE to two closed
// labels (shared.ts RUM_CLS_WHERE / RUM_CLS_WHAT) and the shift's page time; the element itself, its selector and its text
// never leave this function.

/** A <header>/<footer> is the page's banner/contentinfo only outside article, aside, main, nav and section (ARIA in HTML). */
const SECTIONING = 'article, aside, main, nav, section, [role="article"], [role="complementary"], [role="main"], [role="navigation"], [role="region"]'
const pageLandmark = (el: Element, tag: 'header' | 'footer', role: string): boolean => {
  if (el.closest(`[role="${role}"]`)) return true
  const own = el.closest(tag)
  return !!own && !own.parentElement?.closest(SECTIONING)
}

/** Where the largest shift's element sat: its landmark, checked from the most specific. */
export function clsWhere(node: Node | null | undefined): RumClsWhere {
  const el = node instanceof Element ? node : node?.parentElement ?? null
  if (!el) return 'other'
  if (el.closest('dialog, [role="dialog"], [role="alertdialog"]')) return 'dialog'
  if (pageLandmark(el, 'header', 'banner')) return 'header'
  if (el.closest('nav, [role="navigation"]')) return 'nav'
  if (pageLandmark(el, 'footer', 'contentinfo')) return 'footer'
  if (el.closest('aside, [role="complementary"]')) return 'aside'
  if (el.closest('main, [role="main"]')) return 'main'
  return 'other'
}

/** What the largest shift's element was. */
export function clsWhat(node: Node | null | undefined): RumClsWhat {
  if (!(node instanceof Element)) return node ? 'text' : 'block'
  const tag = node.tagName
  if (tag === 'IMG' || tag === 'PICTURE' || tag === 'svg' || tag === 'CANVAS') return 'img'
  if (tag === 'VIDEO') return 'video'
  if (tag === 'IFRAME') return 'iframe'
  return node.childElementCount === 0 && (node.textContent ?? '').trim() ? 'text' : 'block'
}

export type ClsSource = { where: RumClsWhere; what: RumClsWhat; at: number | null }

export function watchVitals(set: { cls: (v: number, source?: ClsSource) => void; inp: (v: number) => void }): void {
  onCLS((m) => {
    const a = m.attribution
    const node = a?.largestShiftSource?.node
    set.cls(m.value, { where: clsWhere(node), what: clsWhat(node), at: typeof a?.largestShiftTime === 'number' ? a.largestShiftTime : null })
  })
  onINP((m) => set.inp(m.value))
}
