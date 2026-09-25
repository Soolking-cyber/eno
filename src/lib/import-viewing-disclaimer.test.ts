import { describe, expect, it } from 'vitest'
import { stripViewingDisclaimer, VIEWING_DISCLAIMERS } from './import-viewing-disclaimer'

describe('stripViewingDisclaimer', () => {
  it('keeps the source line and drops only the sentence, in both languages and for Rever', () => {
    expect(stripViewingDisclaimer(`Listed on Nhatot.com.${VIEWING_DISCLAIMERS[0]}\n\nType: House`)).toBe('Listed on Nhatot.com.\n\nType: House')
    expect(stripViewingDisclaimer(`Listed on Rever.vn.${VIEWING_DISCLAIMERS[1]}\n\nType: Villa`)).toBe('Listed on Rever.vn.\n\nType: Villa')
    expect(stripViewingDisclaimer(`Tin đăng trên Nhatot.com.${VIEWING_DISCLAIMERS[2]}\n\nLoại hình: Nhà`)).toBe('Tin đăng trên Nhatot.com.\n\nLoại hình: Nhà')
    expect(stripViewingDisclaimer(`Tin đăng trên Rever.vn.${VIEWING_DISCLAIMERS[3]}\n\nLoại: Căn hộ`)).toBe('Tin đăng trên Rever.vn.\n\nLoại: Căn hộ')
  })
  it('leaves other text untouched and is idempotent', () => {
    const t = 'A seller wrote: enquiries welcome, viewings on weekends.'
    expect(stripViewingDisclaimer(t)).toBe(t)
    const once = stripViewingDisclaimer(`Listed on X.${VIEWING_DISCLAIMERS[0]}`)
    expect(stripViewingDisclaimer(once)).toBe(once)
    expect(stripViewingDisclaimer(null)).toBeNull()
  })
})
