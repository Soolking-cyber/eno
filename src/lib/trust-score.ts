// Trust score → color hierarchy. The trust score is the SINGLE public trust signal
// — stars and badges are gone. The CANONICAL ladder (matches the tier design decision
// and the /trust explainer): red = restricted, NEUTRAL slate = building (where every
// new account starts — never a warning color), brand BLUE = Trusted, GOLD =
// Exceptional, violet = Elite (top). Colors are THEME-AWARE CSS variables
// (src/app/globals.css) tuned to pass WCAG AA (≥4.5:1) on both light and dark cards
// AND on the chips' 10% currentColor tint — a single fixed hex can't do all three.

export type TrustBand = 'restricted' | 'standard' | 'trusted' | 'exceptional' | 'elite'

// Tier ladder (thresholds match trust.ts tierFor — 60/85/110 — plus the 160 flourish):
//   <60 red · 60–84 slate · 85–109 blue (Trusted) · 110–159 gold (Exceptional) · 160+ violet (Elite).
export function trustBand(score: number): TrustBand {
  if (score >= 160) return 'elite'
  if (score >= 110) return 'exceptional'
  if (score >= 85) return 'trusted'
  if (score >= 60) return 'standard'
  return 'restricted'
}

// The EARNED tiers (Trusted/Exceptional/Elite) also carry a vivid, glossy gradient
// fill class (globals.css .trust-fill-*) for badge/chip surfaces — text-on-fill AA is
// baked into the class. Building/restricted stay quiet (no fill).
export function trustFillClass(band: TrustBand): string | null {
  switch (band) {
    case 'elite': return 'trust-fill-elite'
    case 'exceptional': return 'trust-fill-exceptional'
    case 'trusted': return 'trust-fill-trusted'
    default: return null
  }
}

// `color` is a CSS variable reference (resolves per theme); use it in `style`
// (color / fill / stroke) — never as a raw SVG attribute (var() won't resolve there).
export function trustScoreColor(score: number): { color: string; label: string; labelVi: string; band: TrustBand } {
  switch (trustBand(score)) {
    case 'elite': return { color: 'var(--trust-elite)', label: 'Elite', labelVi: 'Hàng đầu', band: 'elite' } // violet — the king tier
    case 'exceptional': return { color: 'var(--trust-exceptional)', label: 'Exceptional', labelVi: 'Xuất sắc', band: 'exceptional' } // gold
    case 'trusted': return { color: 'var(--trust-trusted)', label: 'Trusted', labelVi: 'Đáng tin cậy', band: 'trusted' } // brand blue
    case 'standard': return { color: 'var(--trust-standard)', label: 'Building', labelVi: 'Đang tích lũy', band: 'standard' } // neutral slate (matches /trust wording)
    default: return { color: 'var(--trust-restricted)', label: 'Caution', labelVi: 'Cần thận trọng', band: 'restricted' } // red
  }
}
