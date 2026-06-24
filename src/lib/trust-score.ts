// Trust score → color hierarchy. The trust score is the SINGLE public trust signal
// — stars and badges are gone. Colors follow human intuition so the hierarchy reads
// instantly: red = bad, yellow = warning, green = good, blue = great (brand),
// purple = royal (top). Colors are THEME-AWARE CSS variables
// (src/app/globals.css) tuned to pass WCAG AA (≥4.5:1) on both light and dark cards
// — a single fixed hex can't be AA on white AND on the dark surface.

export type TrustBand = 'restricted' | 'standard' | 'trusted' | 'exceptional' | 'elite'

// Tier ladder (thresholds tuned so the climb is meaningful but reachable):
//   <60 red · 60–84 slate · 85–109 green · 110–159 gold · 160+ violet (the top).
export function trustBand(score: number): TrustBand {
  if (score >= 160) return 'elite'
  if (score >= 110) return 'exceptional'
  if (score >= 85) return 'trusted'
  if (score >= 60) return 'standard'
  return 'restricted'
}

// `color` is a CSS variable reference (resolves per theme); use it in `style`
// (color / fill / stroke) — never as a raw SVG attribute (var() won't resolve there).
export function trustScoreColor(score: number): { color: string; label: string; labelVi: string; band: TrustBand } {
  switch (trustBand(score)) {
    case 'elite': return { color: 'var(--trust-elite)', label: 'Elite', labelVi: 'Hàng đầu', band: 'elite' } // violet — the king tier
    case 'exceptional': return { color: 'var(--trust-exceptional)', label: 'Exceptional', labelVi: 'Xuất sắc', band: 'exceptional' } // gold
    case 'trusted': return { color: 'var(--trust-trusted)', label: 'Trusted', labelVi: 'Đáng tin cậy', band: 'trusted' } // green
    case 'standard': return { color: 'var(--trust-standard)', label: 'Standard', labelVi: 'Bình thường', band: 'standard' } // slate
    default: return { color: 'var(--trust-restricted)', label: 'Caution', labelVi: 'Cần thận trọng', band: 'restricted' } // red
  }
}
