import { describe, expect, it } from 'vitest'
import { SITE_NAME } from '@/lib/edition'
import { SITE_TITLE } from '@/lib/site-title'
import { POSTING_IS_FREE } from '@/lib/site-identity'

describe('SITE_TITLE', () => {
  // ⛔ Owner 2026-11-26, "title under 60": measured as eno.vn shows it. The test env's edition is eno.forum, three characters longer.
  it('stays under 60 characters on eno.vn', () => {
    const onVn = SITE_TITLE.replace(SITE_NAME, 'eno.vn')
    expect(onVn.endsWith(' | eno.vn')).toBe(true)
    expect(onVn.length).toBeLessThan(60)
    // The branch measured is the live one: the flag is a constant, and "Free" opens the title only while it is on.
    expect(onVn.startsWith('Free ')).toBe(POSTING_IS_FREE)
  })
})
