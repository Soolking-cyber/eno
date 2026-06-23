// Trust score → color hierarchy. The trust score (0–130, computed in lib/trust.ts)
// is the SINGLE public trust signal — stars and badges are gone. Color makes the
// hierarchy instantly readable: red = caution, slate = building, green = good,
// gold = exceptional. Hexes are chosen to stay legible on both light and dark cards.

export type TrustBand = 'restricted' | 'standard' | 'trusted' | 'exceptional'

export function trustBand(score: number): TrustBand {
  if (score >= 110) return 'exceptional'
  if (score >= 85) return 'trusted'
  if (score >= 60) return 'standard'
  return 'restricted'
}

export function trustScoreColor(score: number): { hex: string; label: string; labelVi: string; band: TrustBand } {
  switch (trustBand(score)) {
    case 'exceptional': return { hex: '#d97706', label: 'Exceptional', labelVi: 'Xuất sắc', band: 'exceptional' } // gold
    case 'trusted': return { hex: '#16a34a', label: 'Trusted', labelVi: 'Đáng tin cậy', band: 'trusted' } // green
    case 'standard': return { hex: '#64748b', label: 'Standard', labelVi: 'Bình thường', band: 'standard' } // slate
    default: return { hex: '#dc2626', label: 'Caution', labelVi: 'Cần thận trọng', band: 'restricted' } // red
  }
}
