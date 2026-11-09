import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { PARTNER_AVATAR_MIN_VISIBLE_PCT, PARTNER_AVATAR_SIZE, renderPartnerAvatar } from './partner-avatar'

/** A transparent canvas with one opaque block of `fill` in the middle — a logo's shape without anyone's logo. */
const logo = (width: number, height: number, fill: string) =>
  sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: Math.round(width * 0.8), height: Math.round(height * 0.8), channels: 4, background: fill } }, gravity: 'centre' }])
    .png().toBuffer()

describe('renderPartnerAvatar', () => {
  it('draws a square WebP of the avatar size, flattened onto white', async () => {
    const a = await renderPartnerAvatar(await logo(400, 400, '#ed1c25'))
    const meta = await sharp(a.out).metadata()
    expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(['webp', PARTNER_AVATAR_SIZE, PARTNER_AVATAR_SIZE, false])
    expect(a.inner).toBe(PARTNER_AVATAR_SIZE)
    const { data } = await sharp(a.out).raw().toBuffer({ resolveWithObject: true })
    expect([...data.subarray(0, 3)].every((v) => v > 245)).toBe(true) // a corner is white, not black or transparent
  })

  it('fits a wide wordmark inside the circle: its box’s half-diagonal is no more than the radius', async () => {
    const a = await renderPartnerAvatar(await logo(740, 416, '#ed1c25'))
    const aspect = 740 / 416
    expect(a.inner).toBeLessThan(PARTNER_AVATAR_SIZE)
    // The fitted mark is inner × inner/aspect; its diagonal is the circle's diameter, to the pixel.
    expect(Math.hypot(a.inner, a.inner / aspect)).toBeLessThanOrEqual(PARTNER_AVATAR_SIZE)
    expect(Math.hypot(a.inner + 1, (a.inner + 1) / aspect)).toBeGreaterThan(PARTNER_AVATAR_SIZE)
    expect(a.visiblePct).toBeGreaterThan(PARTNER_AVATAR_MIN_VISIBLE_PCT)
  })

  it('measures a white-on-transparent mark as invisible, so a caller refuses it', async () => {
    const a = await renderPartnerAvatar(await logo(740, 416, '#ffffff'))
    expect(a.visiblePct).toBeLessThan(PARTNER_AVATAR_MIN_VISIBLE_PCT)
  })
})
