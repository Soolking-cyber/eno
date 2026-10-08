import { describe, expect, it } from 'vitest'
import { escapeCsv } from './feed-csv'

describe('escapeCsv', () => {
  it('passes a plain field through, trimmed', () => {
    expect(escapeCsv('  2BR apartment  ')).toBe('2BR apartment')
  })

  it('quotes a field carrying a comma, a semicolon or a quote, doubling the quotes', () => {
    expect(escapeCsv('15,000,000 đ')).toBe('"15,000,000 đ"')
    expect(escapeCsv('a;b')).toBe('"a;b"')
    expect(escapeCsv('the "Sunrise" tower')).toBe('"the ""Sunrise"" tower"')
  })

  it('turns every newline form into a space, so a row never splits', () => {
    expect(escapeCsv('one\r\ntwo\nthree\rfour')).toBe('one two three four')
  })

  it('⛔ neutralises a leading formula character', () => {
    for (const lead of ['=', '+', '-', '@']) expect(escapeCsv(`${lead}HYPERLINK("x")`)).toMatch(/^"'/)
    expect(escapeCsv('=1+1')).toBe("'=1+1")
  })

  it('keeps a comma-separated URL list in ONE cell', () => {
    expect(escapeCsv('https://a/1.webp,https://a/2.webp')).toBe('"https://a/1.webp,https://a/2.webp"')
  })
})
