import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('what must stay off the path to every page', () => {
  const src = (f: string) => readFileSync(`src/components/marketplace/${f}`, 'utf8')

  it('the header search does not reach the taxonomy', () => {
    expect(src('search-suggest.tsx')).not.toMatch(/from '\.\/count-chip'/)
    expect(src('count-chip-label.ts')).not.toMatch(/subcategories|taxonomy'/)
  })
})
