import { describe, expect, it } from 'vitest'
import { modelFor } from './feed-model'

/**
 * ⛔ THE FIRST BLOCK IS THE REGRESSION, AND ITS TITLES ARE THE REAL ONES. All six are exact titles
 * from live listings that were filed under "Apple Watch Ultra 4" — a product that does not exist.
 * Every assertion here was checked RED against the old `Ultra\s?\d?` pattern.
 */
describe('modelFor — a millimetre size is not a model number', () => {
  it.each([
    'Apple Watch Ultra 49mm (4G) - Titanium Bezel, Medium Size Fabric Band - Used, Excellent Condition',
    'Apple Watch Ultra 49mm (4G) Titanium Bezel - Rubber Band - Used, Scratched',
    'Apple Watch Ultra 49mm (4G) - Titanium Bezel, Large Fabric Band - Used, Scratched',
  ])('reads %s as the first-generation Ultra', (title) => {
    expect(modelFor(title)).toBe('Apple Watch Ultra')
  })

  /**
   * ⚠️ THE TITLE THAT PROVES THE CAUSE. This one says "(GPS)", not "(4G)", and it was ALSO filed as
   * Ultra 4 — so the stray digit never came from the connectivity suffix. It came from "49mm".
   * Diagnosing this from the "(4G)" titles alone would have produced a fix for the wrong thing.
   */
  it('is not about the 4G suffix — a GPS model with the same case size behaves identically', () => {
    expect(modelFor('Apple Watch Ultra 49mm (GPS) Titanium Bezel - Rubber Band - Used, Scratched'))
      .toBe('Apple Watch Ultra')
  })

  it('still reads a REAL generation when the digit is a word of its own', () => {
    expect(modelFor('Apple Watch Ultra 2 2024 49mm 4G Black Titanium Bezel Alpine Band Size L'))
      .toBe('Apple Watch Ultra 2')
    expect(modelFor('Đồng hồ Apple Watch Ultra 3 49mm')).toBe('Apple Watch Ultra 3')
  })

  /** ⛔ A YEAR IS THE SAME DEFECT AS A CASE SIZE, found by dry-running the fix over the catalogue:
   *  `SE\s?\d?` lifted the `2` out of "Apple Watch SE **2022**" on 4 live listings. The guard's
   *  `(?!\d)` catches it for the same reason it catches 49mm — a real generation is a lone digit. */
  it('does not read a model YEAR as a generation', () => {
    expect(modelFor('Apple Watch SE 2022 40mm (GPS) - Aluminum bezel')).toBe('Apple Watch SE')
    expect(modelFor('AppleCare+ cho Apple Watch SE 2022')).toBe('Apple Watch SE')
    // ...while a real generation followed by a year keeps the generation.
    expect(modelFor('Apple Watch SE 2 2024 40mm (GPS) Aluminum Case')).toBe('Apple Watch SE 2')
    expect(modelFor('Apple Watch Ultra 2 2024 49mm 4G Black')).toBe('Apple Watch Ultra 2')
  })

  it('applies the same rule to Watch SE and Series, whose sizes collide the same way', () => {
    expect(modelFor('Apple Watch SE 44mm GPS Midnight Aluminium')).toBe('Apple Watch SE')
    expect(modelFor('Apple Watch SE 2 40mm')).toBe('Apple Watch SE 2')
    expect(modelFor('Apple Watch Series 10 46mm Jet Black')).toBe('Apple Watch Series 10')
  })

  /**
   * ⛔ EXACT VALUES, NOT `not.toBe(...)`. This assertion used to read
   * `not.toBe('Galaxy Watch 47')` and PASSED while the function answered "Galaxy Watch 4" — an
   * equally invented product. A negative assertion tests one wrong answer out of infinitely many;
   * a reviewer found the phantom hiding behind it.
   * ⛔ AND THE PHANTOM WAS THE POINT: `(?!\s?mm)` after a GREEDY quantifier backtracks. "47mm"
   * fails the lookahead on `47`, the engine retries with `4`, and `4` is not followed by "mm".
   * `(?!\d)(?!\s?mm)` is what actually closes it.
   */
  it('does not read a case size as a model number, and does not backtrack into one', () => {
    expect(modelFor('Samsung Galaxy Watch 47mm Silver')).toBeNull()
    expect(modelFor('Apple Watch Series 44mm GPS')).toBeNull()
    expect(modelFor('Apple Watch Series 42mm')).toBeNull()
  })

  /** The compact spelling the old pattern accepted — `SE\b` would have rejected it. */
  it('still matches the compact SE2 spelling', () => {
    expect(modelFor('Apple Watch SE2 40mm')).toBe('Apple Watch Se2')
  })

  /** ⛔ AND THAT LAST CASE FOUND A SECOND BUG: with the Series branch correctly declining, the
   *  alternation fell through to `SE`, which matched the "Se" of "Series" and answered
   *  "Apple Watch SE" — a different product. Hence `SE\b`. */
  it('never reads the "Se" of "Series" as the SE model', () => {
    expect(modelFor('Apple Watch Series 44mm GPS')).not.toBe('Apple Watch SE')
    expect(modelFor('Apple Watch Series 44mm GPS')).toBeNull()  // ...and exactly what it IS
  })
})

describe('modelFor — the models it must keep finding', () => {
  it.each([
    ['iPhone 16 Pro Max 256GB', 'iPhone 16 Pro Max'],
    ['Điện thoại iphone 15 pro', 'iPhone 15 Pro'],
    ['Samsung Galaxy S24 Ultra 512GB', 'Galaxy S24 Ultra'],
    ['Galaxy Z Fold8 Ultra', 'Galaxy Z Fold8 Ultra'],
    ['Galaxy Tab S11 Ultra', 'Galaxy Tab S11 Ultra'],
    ['Redmi Note 13 Pro', 'Redmi Note 13'],
    ['Xiaomi 14T', 'Xiaomi 14T'],
    ['Redmi 12C 128GB', 'Redmi 12C'],
    ['Galaxy Z Flip6', 'Galaxy Z Flip6'],
  ])('%s → %s', (title, model) => {
    expect(modelFor(title)).toBe(model)
  })

  /** ⚠️ The canonical-casing contract: the filter matches on the STRING, so two spellings of one
   *  model are two filter entries each listing half the stock. */
  it('canonicalises the head so two spellings cannot split the facet', () => {
    expect(modelFor('Macbook Pro M3 14 inch')).toBe('MacBook Pro M3')
    expect(modelFor('MACBOOK AIR M2')).toBe('MacBook Air M2')
    expect(modelFor('macbook air')).toBe(modelFor('MacBook Air'))
  })

  it('leaves a title with no model null rather than inventing one', () => {
    expect(modelFor('Nồi chiên không dầu Lock&Lock 5.5L')).toBeNull()
    expect(modelFor('Cáp sạc Type-C 60W')).toBeNull()
  })
})
