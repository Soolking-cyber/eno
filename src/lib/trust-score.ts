// Trust score → color hierarchy. The trust score (0–130, computed in lib/trust.ts)
// is the SINGLE public trust signal — stars and badges are gone. Color makes the
// hierarchy instantly readable: red = caution, slate = building, green = good,
// gold = exceptional. Hexes are chosen to stay legible on both light and dark cards.

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

export function trustScoreColor(score: number): { hex: string; label: string; labelVi: string; band: TrustBand } {
  switch (trustBand(score)) {
    case 'elite': return { hex: '#7c3aed', label: 'Elite', labelVi: 'Hàng đầu', band: 'elite' } // violet — the king tier
    case 'exceptional': return { hex: '#d97706', label: 'Exceptional', labelVi: 'Xuất sắc', band: 'exceptional' } // gold
    case 'trusted': return { hex: '#16a34a', label: 'Trusted', labelVi: 'Đáng tin cậy', band: 'trusted' } // green
    case 'standard': return { hex: '#64748b', label: 'Standard', labelVi: 'Bình thường', band: 'standard' } // slate
    default: return { hex: '#dc2626', label: 'Caution', labelVi: 'Cần thận trọng', band: 'restricted' } // red
  }
}
