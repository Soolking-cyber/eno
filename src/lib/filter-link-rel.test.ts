import { describe, expect, it } from 'vitest'
import { filterLinkRel } from './filter-link-rel'

describe('filterLinkRel', () => {
  it('a filtered view (any query) is nofollow; a plain path is followed', () => {
    expect(filterLinkRel('/?category=electronics&brand=apple')).toBe('nofollow')
    expect(filterLinkRel('/vi?category=rentals')).toBe('nofollow')
    expect(filterLinkRel('/sdc_store?category=vehicles')).toBe('nofollow')
    expect(filterLinkRel('/c/rentals')).toBeUndefined()
    expect(filterLinkRel('/')).toBeUndefined()
  })
})
