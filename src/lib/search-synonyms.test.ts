import { describe, expect, it } from 'vitest'
import { conditionWordMask, splitConditionWords, unitsFor } from './search-synonyms'
import { searchUnits } from './search-match'
import { fold } from './fold'

/**
 * field-03 (UX program 2): "second hand furniture" — our own SEO hub's slug — found 2 unrelated rows,
 * because `second` and `hand` had to appear in the text. Condition words leave the text and filter
 * nothing (feed-query.ts); alone they are the goods browse. ⛔ Only the ACCENTED "cũ": fold() makes "củ"
 * (Củ Chi) the same.
 */
describe('splitConditionWords', () => {
  it.each([
    ['second hand furniture', 'furniture'],
    ['Second-Hand furniture', 'furniture'],
    ['secondhand sofa', 'sofa'],
    ['used chairs for sale near me', 'chairs for sale near me'],
    ['pre-owned macbook', 'macbook'],
    ['pre owned macbook', 'macbook'],
    ['preowned macbook', 'macbook'],
    ['iphone 13 pro max cũ', 'iphone 13 pro max'],
    ['ps5 pro cũ', 'ps5 pro'],
    ['tủ lạnh đã qua sử dụng', 'tủ lạnh'],
    ['đồ cũ giá rẻ', 'giá rẻ'],
    ['IPHONE CŨ', 'IPHONE'],
    ['xe máy (cũ)', 'xe máy'],
  ])('%s → "%s", used', (q, rest) => {
    expect(splitConditionWords(q)).toEqual({ rest, used: true })
  })

  it.each([['second hand'], ['đồ cũ'], ['used'], ['cũ'], ['đã qua sử dụng']])('"%s" alone leaves nothing — the used-goods browse', (q) => {
    expect(splitConditionWords(q)).toEqual({ rest: '', used: true })
  })

  it.each([
    ['nhà củ chi'], // Củ Chi, an HCMC district
    ['đất củ chi'],
    ['nha cu chi'], // unaccented: a bare `cu` is an ordinary word
    ['iphone 13 cu'],
    ['thanh lý tủ lạnh'], // the moving-sale shelf stays a matched word
    ['second floor apartment'], // "second" alone is not a condition word
    ['hand cream'],
    ['furniture'],
  ])('"%s" is left exactly as typed', (q) => {
    expect(splitConditionWords(q)).toEqual({ rest: q, used: false })
  })

  it('conditionWordMask marks the same words in place, for a caller that keeps the word order', () => {
    expect(conditionWordMask(['second', 'hand', 'sofaa'])).toEqual([true, true, false])
    expect(conditionWordMask(['tủ', 'lạnh', 'đã', 'qua', 'sử', 'dụng'])).toEqual([false, false, true, true, true, true])
    expect(conditionWordMask(['iphone', '(cũ)'])).toEqual([false, true])
    expect(conditionWordMask(['nhà', 'củ', 'chi'])).toEqual([false, false, false])
    expect(conditionWordMask(['iphone', 'cu'])).toEqual([false, false])
    expect(conditionWordMask(['second', 'floor'])).toEqual([false, false])
  })

  it('reads a decomposed (NFD) "cũ" as the same word', () => {
    expect(splitConditionWords('iphone cũ')).toEqual({ rest: 'iphone', used: true })
  })

  it('what is left searches exactly like the plain word: "second hand furniture" ≡ "furniture"', () => {
    const rest = splitConditionWords('second hand furniture').rest
    expect(searchUnits(fold(rest))).toEqual(searchUnits(fold('furniture')))
    // and "nhà củ chi" keeps its three units (the district words are the feed's district reader's)
    expect(unitsFor(fold(splitConditionWords('nhà củ chi').rest).split(' ')).map((u) => u.terms[0])).toEqual(['nha', 'cu', 'chi'])
  })
})
