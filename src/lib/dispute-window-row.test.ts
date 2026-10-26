import { describe, expect, it } from 'vitest'
import { windowExtendedBody, windowExtendedUntil } from './dispute-window-row'

describe('the window-extended dispute row', () => {
  it('round-trips the instant the admin route stores, and reads rows stored before the helper existed', () => {
    const until = new Date('2026-10-25T08:13:27.123Z')
    expect(windowExtendedUntil(windowExtendedBody(until))?.toISOString()).toBe(until.toISOString())
    expect(windowExtendedUntil('Evidence window extended until 2026-10-25T08:13:27.123Z')?.getTime()).toBe(until.getTime())
  })
  it('leaves every other row alone', () => {
    expect(windowExtendedUntil('Evidence window extended until soon')).toBeNull()
    expect(windowExtendedUntil('The seller replied')).toBeNull()
    expect(windowExtendedUntil(null)).toBeNull()
  })
})
