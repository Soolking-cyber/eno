import { describe, it, expect } from 'vitest'
import { stripMarkdown, plainSnippet } from './strip-md'

// "AI Polish" writes into the post wizard's plain-text TEXTAREA. A model that returns
// "**Like new** condition" hands the seller literal asterisks to edit around — which is
// what the owner reported on 2026-07-22. The prompt now forbids markdown; this is the
// deterministic half, because a prompt is not a guarantee.

describe('stripMarkdown', () => {
  it('removes bold, italics and bold-italics', () => {
    expect(stripMarkdown('**Like new** condition')).toBe('Like new condition')
    expect(stripMarkdown('A *great* find')).toBe('A great find')
    expect(stripMarkdown('***Rare*** colourway')).toBe('Rare colourway')
    expect(stripMarkdown('__Boxed__ and sealed')).toBe('Boxed and sealed')
  })

  it('keeps bullets, and normalises "*" bullets to the "- " the renderer knows', () => {
    expect(stripMarkdown('* Bluetooth 5.0\n* 40h battery')).toBe('- Bluetooth 5.0\n- 40h battery')
    expect(stripMarkdown('- Already correct')).toBe('- Already correct')
    expect(stripMarkdown('• Unicode bullet')).toBe('- Unicode bullet')
  })

  it('drops heading hashes but keeps the words', () => {
    expect(stripMarkdown('### Features')).toBe('Features')
  })

  it('strips code markers and link syntax', () => {
    expect(stripMarkdown('Use `npm` here')).toBe('Use npm here')
    expect(stripMarkdown('See [our shop](https://eno.vn/x)')).toBe('See our shop')
  })

  // ⚠️ THE REGRESSION GUARD. Listing copy is full of dimensions. A naive "any pair of
  // asterisks" rule turns "10*20*30cm" into "102030cm" and silently corrupts the seller's
  // own text — worse than the formatting bug it set out to fix.
  it('leaves dimensions and lone asterisks alone', () => {
    expect(stripMarkdown('Size 10*20*30cm')).toBe('Size 10*20*30cm')
    expect(stripMarkdown('Rated 5* by buyers')).toBe('Rated 5* by buyers')
  })

  it('handles a realistic polished description end to end', () => {
    const out = stripMarkdown('## Great laptop\n\n**Excellent** condition MacBook.\n\n* 16GB RAM\n* 512GB SSD\n\nSize: 30*21cm')
    expect(out).toBe('Great laptop\n\nExcellent condition MacBook.\n\n- 16GB RAM\n- 512GB SSD\n\nSize: 30*21cm')
    expect(out).not.toContain('**')
    expect(out).not.toContain('#')
  })
})

describe('plainSnippet', () => {
  it('flattens the Gemini layout into one line of prose for meta tags and feeds', () => {
    const rich = 'Màn hình ViewSonic 27 inch.\n\n**Thông số chính**\n- Tần số quét: 180Hz\n- Tấm nền: IPS'
    expect(plainSnippet(rich)).toBe('Màn hình ViewSonic 27 inch. Thông số chính: Tần số quét: 180Hz. Tấm nền: IPS')
  })

  it('joins after existing punctuation without doubling it, and leaves codes alone', () => {
    expect(plainSnippet('Màu: đen,\nSize M (EU 40)\nMã A_B_C 5*')).toBe('Màu: đen, Size M (EU 40) Mã A_B_C 5*')
  })

  it('does not double a colon a heading already has', () => {
    expect(plainSnippet('**Key specs:**\n- Size: 27 inch')).toBe('Key specs: Size: 27 inch')
  })

  it('leaves plain text as it was, minus line breaks', () => {
    expect(plainSnippet('Bàn phím Bluetooth\nBảo hành 12 tháng')).toBe('Bàn phím Bluetooth. Bảo hành 12 tháng')
  })
})
