import { describe, expect, it } from 'vitest'
import { PULL_MAX, PULL_THRESHOLD, pullDistance, pullProgress, pullState } from './pull-to-refresh'

/**
 * THE PULL GESTURE'S ARITHMETIC. The component around it needs a touchscreen; these four functions
 * do not, which is the whole reason they live in their own module — the numbers a hand can feel are
 * the ones most likely to be "improved" by someone who cannot run the gesture.
 */
describe('pullDistance', () => {
  it('never reads an upward or still finger as a pull', () => {
    expect(pullDistance(0)).toBe(0)
    expect(pullDistance(-40)).toBe(0)
  })

  it('resists: the indicator moves half as far as the finger', () => {
    expect(pullDistance(40)).toBe(20)
    expect(pullDistance(100)).toBe(50)
  })

  /** ⛔ THE CAP IS THE POINT: a long drag must not push the mascot down the screen forever. */
  it('caps, however far the drag goes', () => {
    expect(pullDistance(1000)).toBe(PULL_MAX)
    expect(pullDistance(10_000)).toBe(PULL_MAX)
  })
})

describe('pullState', () => {
  it('walks idle → pulling → ready as the distance grows', () => {
    expect(pullState(0, false)).toBe('idle')
    expect(pullState(PULL_THRESHOLD - 1, false)).toBe('pulling')
    expect(pullState(PULL_THRESHOLD, false)).toBe('ready')
  })

  /** Refreshing wins whatever the finger is doing — including after release, when distance is 0. */
  it('reports refreshing over every other state', () => {
    expect(pullState(0, true)).toBe('refreshing')
    expect(pullState(PULL_THRESHOLD + 20, true)).toBe('refreshing')
  })
})

describe('pullProgress', () => {
  it('runs 0 → 1 across the threshold, not across the cap', () => {
    expect(pullProgress(0)).toBe(0)
    expect(pullProgress(PULL_THRESHOLD / 2)).toBeCloseTo(0.5)
    expect(pullProgress(PULL_THRESHOLD)).toBe(1)
  })

  /** ⚠️ The over-pull past the threshold is slack for the hand, not more for the eye. */
  it('saturates, so the last pixels of over-pull change nothing on screen', () => {
    expect(pullProgress(PULL_MAX)).toBe(1)
    expect(pullProgress(9999)).toBe(1)
  })

  it('is never negative', () => {
    expect(pullProgress(-50)).toBe(0)
  })
})
