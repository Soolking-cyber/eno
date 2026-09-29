import { describe, expect, it } from 'vitest'
import { searchUnits, textClauses, textPredicate, tokenClause, unitClause, wordStart, WORD_BOUNDARY } from './search-match'
import { SYNONYM_GROUPS, unitsFor } from './search-synonyms'

/**
 * ⛔ S-RECALL, measured on production 2026-09-29: recall was a raw substring AND, so 2-3 character
 * Vietnamese syllables matched inside unrelated words — "xe máy" 1,111 rows led by a sports bra and a
 * MacBook ("máy tính"), "tu lanh" 2,052 led by a jacket, "can ho" 28,268 led by an eSIM.
 */
describe('the text predicate', () => {
  it('a short token matches at a word start only — the concierge boundary set', () => {
    // The plain substring LEADS (every word start implies it), so a row without the term costs one
    // LIKE, not eight — a rare search walks the whole sorted index ("mũ bảo hiểm": 4.2 s → 0.18 s a page).
    expect(wordStart('xe')).toEqual({
      AND: [
        { searchText: { contains: 'xe' } },
        { OR: [{ searchText: { startsWith: 'xe' } }, ...WORD_BOUNDARY.map((b) => ({ searchText: { contains: `${b}xe` } }))] },
      ],
    })
    expect(tokenClause('tv')).toEqual(wordStart('tv'))
    expect(tokenClause('pen')).toEqual(wordStart('pen'))
  })

  it('a token of 4+ characters keeps substring matching, so "phone" still finds "iphone" (and iphone keeps its total)', () => {
    expect(tokenClause('iphone')).toEqual({ searchText: { contains: 'iphone' } })
    expect(textPredicate('iphone')).toEqual({ AND: [{ searchText: { contains: 'iphone' } }] })
    const phone = searchUnits('phone')[0]
    // "phone" is a synonym unit; its own term stays a substring, so "iphone"/"smartphone" still match.
    expect(unitClause(phone)).toMatchObject({ OR: expect.arrayContaining([{ searchText: { contains: 'phone' } }]) })
  })

  it('"xe máy" is ONE unit: the phrase at a word start, or any two-wheeler word', () => {
    const units = searchUnits('xe may')
    expect(units).toHaveLength(1)
    expect(units[0].terms[0]).toBe('xe may')
    expect(units[0].terms).toEqual(expect.arrayContaining(['motorbike', 'motorcycle', 'xe tay ga']))
    // ⛔ Not "scooter": it also names kick scooters (Sports, Toys), which led "xe máy" when it was a synonym.
    expect(units[0].terms).not.toContain('scooter')
    const clause = unitClause(units[0]) as { OR: unknown[] }
    expect(clause.OR[0]).toEqual(wordStart('xe may'))
    // Every synonym the reader did not type matches at a word start — a long single word too…
    expect(clause.OR).toContainEqual(wordStart('motorbike'))
    expect(clause.OR).not.toContainEqual({ searchText: { contains: 'motorbike' } })
    // …and a synonym phrase ("xe tay ga").
    expect(clause.OR).toContainEqual(wordStart('xe tay ga'))
  })

  it('⛔ a synonym never widens by substring: "smartphone" cannot reach "headphone", "tv" cannot reach "sensitivity"', () => {
    const smartphone = unitClause(searchUnits('smartphone')[0]) as { OR: unknown[] }
    // What was typed keeps the long-token substring rule…
    expect(smartphone.OR[0]).toEqual({ searchText: { contains: 'smartphone' } })
    // …the synonym "phone" does not ("headphone", "microphone" hold it mid-word).
    expect(smartphone.OR).toContainEqual(wordStart('phone'))
    expect(smartphone.OR).not.toContainEqual({ searchText: { contains: 'phone' } })
    const tv = unitClause(searchUnits('tv')[0]) as { OR: unknown[] }
    expect(tv.OR).toEqual([wordStart('tv'), wordStart('television'), wordStart('tivi')])
    const dienThoai = unitClause(searchUnits('dien thoai')[0]) as { OR: unknown[] }
    expect(dienThoai.OR).not.toContainEqual({ searchText: { contains: 'phone' } })
  })

  it('narrows with AND across units, or widens with OR for a loose caller (match=any)', () => {
    expect(textPredicate('honda red')).toEqual({ AND: [{ searchText: { contains: 'honda' } }, wordStart('red')] })
    expect(textPredicate('blue pen', { loose: true })).toEqual({ OR: [{ searchText: { contains: 'blue' } }, wordStart('pen')] })
  })

  it('keeps the first six units, skips 1-character tokens, and falls back to the whole string', () => {
    expect(searchUnits('a b iphone 7')).toEqual([{ terms: ['iphone'], synonym: false }])
    expect(searchUnits('aa bb cc dd ee ff gg hh')).toHaveLength(6)
    expect(textPredicate('7')).toEqual({ searchText: { contains: '7' } })
    expect(textPredicate('')).toBeNull()
    expect(textClauses('')).toEqual([])
  })
})

describe('synonym units (src/data/search-synonyms.json)', () => {
  it('matches the longest run first, left to right', () => {
    expect(unitsFor(['may', 'tinh', 'xach', 'tay']).map((u) => u.terms[0])).toEqual(['may tinh xach tay'])
    expect(unitsFor(['tu', 'lanh', 'samsung']).map((u) => u.terms[0])).toEqual(['tu lanh', 'samsung'])
    expect(unitsFor(['washing', 'machine'])[0].terms).toEqual(['washing machine', 'may giat'])
  })

  it('never widens a word that is not in a group', () => {
    expect(unitsFor(['flat'])).toEqual([{ terms: ['flat'], synonym: false }])
    expect(unitsFor(['notebook'])).toEqual([{ terms: ['notebook'], synonym: false }])
  })

  it('carries no visa or itinerary vocabulary (the edition boundary)', () => {
    const all = SYNONYM_GROUPS.flat().join(' | ')
    expect(all).not.toMatch(/visa|thi thuc|itinerar|lich trinh|tour/)
  })
})
