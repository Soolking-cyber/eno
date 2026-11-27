import { describe, expect, it } from 'vitest'
import { MODEL_COLOURS, modelColours } from './model-colours'

describe('model colours', () => {
  it('every model has the same number of names in both languages, plain spaces, no duplicates', () => {
    for (const [slug, c] of Object.entries(MODEL_COLOURS)) {
      expect(c.en.length, slug).toBeGreaterThan(1)
      expect(c.vi.length, slug).toBe(c.en.length)
      for (const name of [...c.en, ...c.vi]) expect(name, slug).toMatch(/^\S(?:.*\S)?$/u)
      for (const name of [...c.en, ...c.vi]) expect(name, slug).not.toMatch(/\u00a0/) // Apple's vi pages use non-breaking spaces
      expect(new Set(c.en).size, slug).toBe(c.en.length)
      expect(new Set(c.vi).size, slug).toBe(c.vi.length)
    }
  })

  it('a model it does not know gets nothing', () => {
    expect(modelColours('apple-ipad-air')).toBeNull()
    expect(modelColours('apple-iphone-13-pro-max')?.en).toContain('Sierra Blue')
  })
})
