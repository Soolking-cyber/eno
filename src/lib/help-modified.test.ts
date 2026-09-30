import { describe, expect, it } from 'vitest'
import { helpModifiedAt } from './help-modified'

// The seed's order key for index 3: base 2026-07-21T00:00Z plus three minutes (sync-help-center.ts).
const ORDER_KEY = '2026-07-21T00:03:00.000Z'

describe('helpModifiedAt', () => {
  it('⛔ an official answer never edited has NO modified date — never its curated-order createdAt', () => {
    expect(helpModifiedAt({ official: true, editedAt: null, createdAt: ORDER_KEY })).toBeNull()
    expect(helpModifiedAt({ official: true, createdAt: new Date(ORDER_KEY) })).toBeNull()
  })

  it('an official answer whose copy changed reads editedAt', () => {
    expect(helpModifiedAt({ official: true, editedAt: '2026-09-28T10:00:00.000Z', createdAt: ORDER_KEY })).toBe('2026-09-28T10:00:00.000Z')
  })

  it("a member's post falls back to its real createdAt, and prefers editedAt when it has one", () => {
    expect(helpModifiedAt({ official: false, editedAt: null, createdAt: '2026-09-01T08:00:00.000Z' })).toBe('2026-09-01T08:00:00.000Z')
    const edited = new Date('2026-09-02T08:00:00.000Z')
    expect(helpModifiedAt({ official: false, editedAt: edited, createdAt: new Date('2026-09-01T08:00:00.000Z') })).toBe(edited)
  })
})
