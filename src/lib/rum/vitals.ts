import { onCLS, onINP } from 'web-vitals'

// ── Page-speed totals: CLS and INP from web-vitals, in their own chunk (speed plan item 5) ─────────────────
//
// Loaded by src/lib/rum/early.ts after the page's load (or at 3 s), never with the first JavaScript. Late is fine for
// both: layout shifts come from a buffered observer, and INP's early interactions are kept by the browser's own
// event buffer (≥104 ms only, so an early FAST tap goes uncounted — it could never have been the slowest one).
// ⚠️ Default reporting, NOT reportAllChanges: web-vitals hands over the final value inside its own capture-phase
// visibilitychange listener, and early.ts flushes in the bubble phase after it.

export function watchVitals(set: { cls: (v: number) => void; inp: (v: number) => void }): void {
  onCLS((m) => set.cls(m.value))
  onINP((m) => set.inp(m.value))
}
