import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Typo correction for a ZERO-result search (S-RECALL, 2026-09-29: "iphnoe" found 0 while "iphone"
 * found 3,439). The vocabulary is the real bundle — product lines, taxonomy, synonyms — plus a mocked
 * live-brand read.
 */
const brands = vi.fn(async () => [{ normalized: 'louisvuitton' }, { normalized: 'samyang' }])
vi.mock('./db', () => ({ db: { brand: { findMany: () => brands() } } }))

const { correctQuery, correctTokens, osaDistance, staticVocab, __resetVocabCache } = await import('./spell-correct')

beforeEach(() => {
  __resetVocabCache()
  brands.mockClear()
})

describe('osaDistance', () => {
  it('counts a swap of two adjacent letters as one edit', () => {
    expect(osaDistance('iphnoe', 'iphone', 2)).toBe(1)
    expect(osaDistance('samsnug', 'samsung', 2)).toBe(1)
    expect(osaDistance('honda', 'honda', 1)).toBe(0)
    expect(osaDistance('hnoda', 'honda', 1)).toBe(1)
  })

  it('stops as soon as the distance exceeds the budget', () => {
    expect(osaDistance('qwzx', 'quat', 1)).toBe(2)
    expect(osaDistance('a', 'abcdef', 2)).toBe(3)
  })
})

describe('correctQuery', () => {
  it('iphnoe → iphone, samsnug → samsung', async () => {
    expect(await correctQuery('iphnoe')).toBe('iphone')
    expect(await correctQuery('Samsnug')).toBe('samsung')
  })

  it('leaves a known word, a word with no near neighbour, and a model code alone', async () => {
    expect(await correctQuery('honda')).toBeNull()
    expect(await correctQuery('qwzx')).toBeNull()
    expect(await correctQuery('s24')).toBeNull()
  })

  it('corrects only the unknown word of a phrase', async () => {
    expect(await correctQuery('iphnoe 15 pro')).toBe('iphone 15 pro')
  })

  it('knows the live brand names (priority 1) and reads them once per window', async () => {
    expect(await correctQuery('louisvuiton')).toBe('louisvuitton')
    await correctQuery('iphnoe')
    expect(brands).toHaveBeenCalledTimes(1)
  })

  it('a failed brand read degrades to the bundled words and is not cached', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    brands.mockImplementationOnce(async () => { throw new Error('down') })
    expect(await correctQuery('iphnoe')).toBe('iphone')
    await correctQuery('samsnug')
    expect(brands).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })
})

describe('correctTokens — the tie rules', () => {
  it('needs the same first letter and a length-scaled budget (1 up to 5 letters, 2 from 6)', () => {
    const v = new Map([['honda', 3], ['iphone', 3]])
    expect(correctTokens(['gonda'], v)).toBeNull() // first letter differs
    expect(correctTokens(['hnda'], v)).toEqual(['honda']) // 4 letters, one edit
    expect(correctTokens(['hdna'], v)).toBeNull() // 4 letters, two edits
    expect(correctTokens(['ipohen'], v)).toEqual(['iphone']) // 6 letters, two edits
  })

  it('prefers the smaller distance, then the higher priority, then the shorter word, then a–z', () => {
    expect(correctTokens(['sonyy'], new Map([['sony', 1], ['sonys', 3]]))).toEqual(['sonys']) // priority
    expect(correctTokens(['dogss'], new Map([['dogsx', 1], ['dogs', 1]]))).toEqual(['dogs']) // shorter
    expect(correctTokens(['catz'], new Map([['cats', 1], ['cato', 1]]))).toEqual(['cato']) // a–z
    expect(correctTokens(['abcdef'], new Map([['abcdxy', 3], ['abcdex', 1]]))).toEqual(['abcdex']) // distance first
  })

  it('the bundled vocabulary holds product lines and brands (priority 3) and taxonomy words', () => {
    const v = staticVocab()
    expect(v.get('iphone')).toBe(3)
    expect(v.get('samsung')).toBe(3)
    expect(v.has('motorbike')).toBe(true)
  })
})
