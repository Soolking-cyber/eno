/**
 * Every string in this file was taken from the LIVE catalogue on 2026-09-21, not invented. The
 * Apple Watch block in particular is the exact set of distinct `model` values the brand carries,
 * and it is the reason the year handling exists at all.
 */
import { describe, it, expect } from 'vitest'
import { splitModel, byNewest, modelKey, type ModelParts } from './model-lineage'

const APPLE_WATCH_LINES = ['Apple Watch Series', 'Apple Watch SE', 'Apple Watch Ultra']
const APPLE_LINES = ['iPhone', 'iPad Pro', 'iPad Air', 'iPad', 'MacBook Air', 'MacBook Pro',
  'AirPods Pro', 'AirPods Max', 'AirPods', ...APPLE_WATCH_LINES]
const SAMSUNG_LINES = ['Galaxy Z Fold', 'Galaxy Z Flip', 'Galaxy S', 'Galaxy Watch', 'Galaxy Tab A', 'Galaxy Tab S']

describe('splitModel — line, generation, variant', () => {
  it('splits a three-level Apple model', () => {
    expect(splitModel('iPhone 17 Pro Max', APPLE_LINES)).toMatchObject({
      line: 'iPhone', gen: 17, variant: 'Pro Max', genIsYear: false,
    })
  })

  it('leaves a generation-less model at line level rather than inventing one', () => {
    // "MacBook Air" is a whole line; a picker column of one fake generation would be noise.
    expect(splitModel('MacBook Air', APPLE_LINES)).toMatchObject({ line: 'MacBook Air', gen: null, variant: null })
  })

  it('prefers the LONGEST known line, so Galaxy Z Fold is not swallowed by Galaxy', () => {
    expect(splitModel('Galaxy Z Fold7', SAMSUNG_LINES)).toMatchObject({ line: 'Galaxy Z Fold', gen: 7 })
    expect(splitModel('Galaxy S26 Ultra', SAMSUNG_LINES)).toMatchObject({ line: 'Galaxy S', gen: 26, variant: 'Ultra' })
  })

  it('reads a spec number as a spec, never as a generation', () => {
    // ⚠️ The 14 is inches. Read as a generation it would sort a 2024 machine above a MacBook Pro 16.
    expect(splitModel('MacBook Pro 14 inch M3', APPLE_LINES)).toMatchObject({ line: 'MacBook Pro', gen: null })
  })

  it('does not split a number in the middle of a token', () => {
    // "9315" must not become 931; "13.3" must not become 13.
    expect(splitModel('XPS 13 9315', ['XPS'])).toMatchObject({ line: 'XPS', gen: 13, variant: '9315' })
    expect(splitModel('Precision 7560', ['Precision'])).toMatchObject({ line: 'Precision', gen: 7560 })
  })

  it('works with no table at all, because an unknown string must degrade not vanish', () => {
    // A model imported after the last deploy still lands somewhere usable.
    expect(splitModel('Redmi Note 17')).toMatchObject({ line: 'Redmi Note', gen: 17 })
  })
})

describe('splitModel — years', () => {
  it('flags a calendar year instead of treating it as a sequence number', () => {
    // ⛔ THE BUG THIS FILE EXISTS FOR. Untagged, 2022 > 3, so a 2022 watch headed the column.
    expect(splitModel('Apple Watch SE 2022', APPLE_WATCH_LINES)).toMatchObject({
      line: 'Apple Watch SE', gen: 2022, genIsYear: true,
    })
    expect(splitModel('Apple Watch SE 3', APPLE_WATCH_LINES)).toMatchObject({ gen: 3, genIsYear: false })
  })

  it('does not mistake a four-digit SKU for a year', () => {
    expect(splitModel('Precision 7560', ['Precision']).genIsYear).toBe(false)
  })
})

describe('byNewest', () => {
  const sort = (raws: string[], lines: string[]) => raws.map((r) => splitModel(r, lines)).sort(byNewest).map((p) => p.raw)

  it('orders newest generation first', () => {
    expect(sort(['iPhone 11', 'iPhone 17', 'iPhone 15'], APPLE_LINES)).toEqual(['iPhone 17', 'iPhone 15', 'iPhone 11'])
  })

  it('keeps an unresolved YEAR below every sequence number', () => {
    // ⚠️ Not a guess at where 2022 belongs — an admission that it is not comparable. Interleaving
    // it is precisely how "SE 2022" ended up above "SE 3".
    expect(sort(['Apple Watch SE 2022', 'Apple Watch SE 3', 'Apple Watch SE 2'], APPLE_WATCH_LINES))
      .toEqual(['Apple Watch SE 3', 'Apple Watch SE 2', 'Apple Watch SE 2022'])
  })

  it('puts a generation-less entry LAST, because unnumbered means first-of-line', () => {
    // ⚠️ Bare "Apple Watch Ultra" IS the first Ultra. Sorting it above "Ultra 2" would head the
    // column with the oldest product — which the earlier version of byNewest did.
    expect(sort(['Apple Watch Ultra 2', 'Apple Watch Ultra'], APPLE_WATCH_LINES))
      .toEqual(['Apple Watch Ultra 2', 'Apple Watch Ultra'])
  })

  it('sorts a letter generation below every numbered one', () => {
    // "iPhone Xr" has no parseable number and is older than all of them.
    expect(sort(['iPhone Xr', 'iPhone 17', 'iPhone 11'], ['iPhone']))
      .toEqual(['iPhone 17', 'iPhone 11', 'iPhone Xr'])
  })
})

describe('modelKey — deterministic merge candidates', () => {
  it('folds the spellings one catalogue really accumulates', () => {
    // All four are live distinct `model` values on the same brand today.
    expect(modelKey('Apple Watch Se2')).toBe(modelKey('Apple Watch SE 2'))
    expect(modelKey('Apple Watch S8')).toBe(modelKey('Apple Watch Series 8'))
  })

  it('does NOT fold genuinely different products', () => {
    // ⛔ The failure mode that matters: over-merging silently deletes a product from the picker.
    expect(modelKey('iPhone 17 Pro')).not.toBe(modelKey('iPhone 17 Pro Max'))
    expect(modelKey('AirPods Pro 2')).not.toBe(modelKey('AirPods Pro 3'))
    expect(modelKey('Apple Watch Ultra 2')).not.toBe(modelKey('Apple Watch Series 2'))
  })

  it('leaves a year form unmerged, because only jev can confirm that pair', () => {
    // modelKey proposes; it must not decide that 2022 is the 2nd generation.
    expect(modelKey('Apple Watch SE 2022')).not.toBe(modelKey('Apple Watch SE 2'))
  })
})

describe('the whole Apple Watch line as it exists today', () => {
  it('separates SE, Series and Ultra rather than collapsing them into one generation bucket', () => {
    // A reviewer predicted SE 2 / Ultra 2 / Series 2 would land in one bucket. They do not —
    // but ONLY because the line table distinguishes them, which is what earns its existence.
    const got = ['Apple Watch SE 2', 'Apple Watch Ultra 2', 'Apple Watch Series 2']
      .map((m) => splitModel(m, APPLE_WATCH_LINES))
    expect(new Set(got.map((p: ModelParts) => p.line)).size).toBe(3)
    expect(got.every((p) => p.gen === 2)).toBe(true)
  })

  it('collapses to ONE bucket without the table — the reviewer was right about that much', () => {
    const got = ['Apple Watch SE 2', 'Apple Watch Ultra 2', 'Apple Watch Series 2']
      .map((m) => splitModel(m, ['Apple Watch']))
    expect(new Set(got.map((p: ModelParts) => p.line)).size).toBe(1)
  })
})
