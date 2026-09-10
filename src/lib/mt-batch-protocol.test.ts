import { describe, expect, it } from 'vitest'
import { buildBatchPrompt, parseBatchReply } from './mt-batch-protocol'

/**
 * ⛔ EVERY CASE HERE IS ABOUT ONE FAILURE: a reply that looks fine and is off by one. These
 * translations are written into Listing.title BY POSITION, so a single dropped line renames every
 * product after it — an air conditioner sold as a book. Each individual title stays well-formed
 * English, so nothing downstream can catch it.
 */
describe('parseBatchReply — refuses anything it cannot align', () => {
  it('maps a clean reply by index', () => {
    const r = parseBatchReply('1. Air conditioner\n2. Refrigerator\n3. Monitor', 3)
    expect(r).toEqual({ ok: true, values: ['Air conditioner', 'Refrigerator', 'Monitor'] })
  })

  it('uses the NUMBER, not the line order', () => {
    // A model that reorders its own output must still land each title on the right product.
    const r = parseBatchReply('2. Refrigerator\n1. Air conditioner\n3. Monitor', 3)
    expect(r).toEqual({ ok: true, values: ['Air conditioner', 'Refrigerator', 'Monitor'] })
  })

  it('refuses a short reply rather than shifting everything after the gap', () => {
    const r = parseBatchReply('1. Air conditioner\n2. Refrigerator', 3)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('2 of 3')
  })

  it('refuses a duplicated index instead of guessing which line is the product', () => {
    const r = parseBatchReply('1. Air conditioner\n2. Refrigerator\n2. Fridge\n3. Monitor', 3)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('twice')
  })

  it('refuses an index outside the batch', () => {
    const r = parseBatchReply('1. A\n2. B\n7. C', 3)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('outside')
  })

  it('ignores preamble and trailing chatter around a complete list', () => {
    // Models add "Here are the translations:" and a sign-off; that must not break a good batch.
    const r = parseBatchReply('Here are the translations:\n\n1. A\n2. B\n\nLet me know if…', 2)
    expect(r).toEqual({ ok: true, values: ['A', 'B'] })
  })

  it('accepts the "1)" numbering some models emit', () => {
    expect(parseBatchReply('1) A\n2) B', 2)).toEqual({ ok: true, values: ['A', 'B'] })
  })

  it('refuses an empty reply', () => {
    expect(parseBatchReply('', 2).ok).toBe(false)
    expect(parseBatchReply('I cannot help with that.', 2).ok).toBe(false)
  })
})

describe('buildBatchPrompt', () => {
  it('numbers every title from 1', () => {
    const p = buildBatchPrompt(['Máy lạnh Daikin', 'Tủ lạnh Toshiba'])
    expect(p).toContain('1. Máy lạnh Daikin')
    expect(p).toContain('2. Tủ lạnh Toshiba')
  })

  /**
   * ⛔ A NEWLINE IN AN INPUT TITLE WOULD SPLIT INTO TWO NUMBERED-LOOKING LINES and shift every
   * index after it — the same corruption, caused by our own input rather than the model.
   */
  it('flattens a title containing newlines onto one line', () => {
    const p = buildBatchPrompt(['Máy lạnh\nDaikin 1.0HP', 'Sách'])
    expect(p).toContain('1. Máy lạnh Daikin 1.0HP')
    expect(p).toContain('2. Sách')
    expect(p.split('\n').filter((l) => /^\d+\./.test(l))).toHaveLength(2)
  })

  it('carries the glossary that m2m100 got wrong', () => {
    const p = buildBatchPrompt(['x'])
    expect(p).toContain('air conditioner')
    expect(p).toContain('refrigerator')
  })
})

describe('parseBatchReply — the reply is written straight into a product title', () => {
  /**
   * ⛔ Dropping unnumbered lines silently TRUNCATED any title the model wrapped, and the batch
   * still passed every check because the index count was right. Losing the capacity off a
   * product title is invisible to everything downstream.
   */
  it('joins a wrapped continuation line onto its own index', () => {
    const r = parseBatchReply('1. Daikin inverter air conditioner\n   1.0HP genuine\n2. Toshiba refrigerator', 2)
    expect(r).toEqual({ ok: true, values: ['Daikin inverter air conditioner 1.0HP genuine', 'Toshiba refrigerator'] })
  })

  it('never lets a continuation invent an index before the first number', () => {
    expect(parseBatchReply('Here you go:\n1. A\n2. B', 2)).toEqual({ ok: true, values: ['A', 'B'] })
  })

  it('strips markdown emphasis the model adds', () => {
    expect(parseBatchReply('1. **Air conditioner**\n2. _Refrigerator_', 2))
      .toEqual({ ok: true, values: ['Air conditioner', 'Refrigerator'] })
  })

  it('strips wrapping quotes, including smart quotes', () => {
    expect(parseBatchReply('1. "Air conditioner"\n2. “Refrigerator”', 2))
      .toEqual({ ok: true, values: ['Air conditioner', 'Refrigerator'] })
  })

  it('still refuses a short reply after all that tidying', () => {
    expect(parseBatchReply('1. A', 2).ok).toBe(false)
  })
})
