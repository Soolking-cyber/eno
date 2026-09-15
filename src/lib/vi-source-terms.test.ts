import { describe, expect, it } from 'vitest'
import { applyViSourceTerms, hasKnownMistranslation, repairKnownMistranslation } from './vi-source-terms'

describe('applyViSourceTerms', () => {
  it('sends "nước hoa hồng" as toner, in any case', () => {
    expect(applyViSourceTerms('Nước hoa hồng giúp làm sáng da Lá House')).toBe('toner giúp làm sáng da Lá House')
    expect(applyViSourceTerms('Nước Hoa Hồng Ý Dĩ HATOMUGI 500ml')).toBe('toner Ý Dĩ HATOMUGI 500ml')
  })

  it('matches the DECOMPOSED spelling a scrape can deliver', () => {
    const nfd = 'Nước hoa hồng Sắc Ngọc Khang'.normalize('NFD')
    expect(nfd).not.toBe('Nước hoa hồng Sắc Ngọc Khang') // the input really is decomposed
    expect(applyViSourceTerms(nfd)).toBe('toner Sắc Ngọc Khang')
  })

  it('leaves genuine rose water alone', () => {
    expect(applyViSourceTerms('Nước hoa hồng nguyên chất 100ml')).toBe('Nước hoa hồng nguyên chất 100ml')
    expect(applyViSourceTerms('Nước hoa hồng chưng cất Bulgaria')).toBe('Nước hoa hồng chưng cất Bulgaria')
    // a word between the phrase and the qualifier (external review)
    expect(applyViSourceTerms('Nước hoa hồng hữu cơ nguyên chất 100ml')).toBe('Nước hoa hồng hữu cơ nguyên chất 100ml')
    // perfume, not toner (external review)
    expect(applyViSourceTerms('Nước hoa hồng nữ Lancôme 50ml')).toBe('Nước hoa hồng nữ Lancôme 50ml')
    expect(applyViSourceTerms('Nước hoa hồng Rose EDP 100ml')).toBe('Nước hoa hồng Rose EDP 100ml')
  })

  it('does not touch titles without the term', () => {
    expect(applyViSourceTerms('Miếng dán camera iPhone 18 Pro')).toBe('Miếng dán camera iPhone 18 Pro')
  })

  it('is stable across repeated calls', () => {
    const a = applyViSourceTerms('Nước hoa hồng A')
    const b = applyViSourceTerms('Nước hoa hồng A')
    expect(a).toBe(b)
  })
})

describe('hasKnownMistranslation', () => {
  it('finds the two Lá House titles Google rendered as rose water', () => {
    expect(hasKnownMistranslation(
      'Nước hoa hồng giúp làm sáng da Lá House Lá Care All Natural Toner 200ml',
      'Rose water helps brighten skin. Lá House Lá Care All Natural Toner 200ml',
    )).toBe(true)
  })
  it('does not flag a correct toner translation', () => {
    expect(hasKnownMistranslation('Nước Hoa Hồng Sắc Ngọc Khang MNH01 145ml', 'Sac Ngoc Khang Toner MNH01 145ml')).toBe(false)
  })
  it('does not flag genuine rose water', () => {
    expect(hasKnownMistranslation('Nước hoa hồng nguyên chất 100ml', 'Pure Rose Water 100ml')).toBe(false)
  })
})

describe('repairKnownMistranslation', () => {
  const vi = 'Nước hoa hồng giúp làm sáng da Lá House Lá Care All Natural Toner 200ml100ml - 200ml'
  it('swaps only the wrong phrase, keeping capitalisation and every other word', () => {
    expect(repairKnownMistranslation(vi, 'Rose water helps brighten skin. Lá House Lá Care All Natural Toner 200ml (100ml) - 200ml'))
      .toBe('Toner helps brighten skin. Lá House Lá Care All Natural Toner 200ml (100ml) - 200ml')
  })
  it('lower-cases mid-sentence', () => {
    expect(repairKnownMistranslation(vi, 'A brightening rose water by Lá House')).toBe('A brightening toner by Lá House')
  })
  it('changes nothing when the Vietnamese does not contain the term', () => {
    expect(repairKnownMistranslation('Nước hoa hồng nguyên chất 100ml', 'Pure Rose Water 100ml')).toBe('Pure Rose Water 100ml')
  })
})
