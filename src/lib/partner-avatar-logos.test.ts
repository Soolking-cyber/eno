import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE PARTNER AVATARS SERVED FROM public/ ARE SIZED FOR WHERE THEY ARE DRAWN (speed plan R64, audit media-08).
 * `Seller.avatarUrl` points at these files (scripts/register-partner-seller.mjs, register-vietkite-seller.mjs) and
 * ui/avatar renders the URL as-is: 48 px on a listing page, 64 px on the storefront, 80 px only in the owner's own
 * dashboard. 192 px covers 64 px at DPR 3; the 500 px originals cost 11.5 KB (GoPlus) and 63 KB (VietKite) more on
 * every first view. Not 144 px: that is soft on the 64 px storefront avatar at DPR 3.
 * ⚠️ SAME PATH, NO ?v= STAMP: the 4-hour browser TTL and the deploy's eno-public purge carry a replacement.
 */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(join(process.cwd(), 'public', file))
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(buf.subarray(12, 16).toString('latin1')).toBe('IHDR')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('partner avatar logos', () => {
  it.each(['goplus-logo.png', 'vietkite-logo.png'])('%s is a square between 192 and 240 px', (file) => {
    const { width, height } = pngSize(file)
    expect(width).toBe(height)
    expect(width).toBeGreaterThanOrEqual(192)
    expect(width).toBeLessThanOrEqual(240)
  })
})
