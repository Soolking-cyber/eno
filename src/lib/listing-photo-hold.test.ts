import { describe, expect, it } from 'vitest'
import { NOT_PHOTO_HELD, PHOTO_HELD_NOTE, notPhotoHeldSql, strippedPhotosOf } from './listing-photo-hold'

describe('the photo hold mark and its guards (listing-photo-hold.ts)', () => {
  it('NOT_PHOTO_HELD is NULL-safe: a row with no note passes, the mark does not', () => {
    expect(NOT_PHOTO_HELD).toEqual({ OR: [{ verificationNotes: null }, { verificationNotes: { not: PHOTO_HELD_NOTE } }] })
  })

  it('notPhotoHeldSql is IS DISTINCT FROM (NULL passes) and takes a table alias, nothing else', () => {
    expect(notPhotoHeldSql()).toBe(`"verificationNotes" IS DISTINCT FROM 'photo:held'`)
    expect(notPhotoHeldSql('l.')).toBe(`l."verificationNotes" IS DISTINCT FROM 'photo:held'`)
    expect(() => notPhotoHeldSql('l')).toThrow()
    expect(() => notPhotoHeldSql("x'; drop table --.")).toThrow()
  })

  it('strippedPhotosOf reads a strip audit and drops what is not one', () => {
    const d = { before: ['a', 'b', 7], removed: [{ i: 1, url: 'b', key: 'b.webp', rule: 'flyer' }, { i: 'x', url: 'c' }] }
    expect(strippedPhotosOf(d)).toEqual({ before: ['a', 'b'], removed: [{ i: 1, url: 'b', key: 'b.webp', rule: 'flyer' }] })
    expect(strippedPhotosOf(null)).toBeNull()
    expect(strippedPhotosOf({ before: [] })).toBeNull()
  })
})
