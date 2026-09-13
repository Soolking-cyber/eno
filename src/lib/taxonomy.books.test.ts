import { describe, expect, it } from 'vitest'
import { CATEGORY_BY_SLUG, facetsFor, migrateLegacyCategoryParams, subcategoriesFor } from './taxonomy'

// The Books aisle (2026-09-13): books left `hobbies-sports` for a category of their own.

describe('books-stationery', () => {
  it('exists with the book subcategories plus stationery', () => {
    expect(CATEGORY_BY_SLUG['books-stationery']).toBeDefined()
    expect(subcategoriesFor('books-stationery').map((s) => s.slug)).toEqual([
      'literature', 'self-help-business', 'childrens-books', 'textbooks-exam',
      'languages-dictionaries', 'comics-manga', 'books-other', 'stationery-office',
    ])
  })

  it('asks a book for its language and a pen for nothing of the sort', () => {
    expect(facetsFor('books-stationery', 'literature').map((f) => f.key)).toContain('bookLanguage')
    expect(facetsFor('books-stationery', 'stationery-office').map((f) => f.key)).not.toContain('bookLanguage')
  })

  it('hobbies-sports no longer carries books or their language facet', () => {
    expect(subcategoriesFor('hobbies-sports').map((s) => s.slug)).not.toContain('books')
    expect(facetsFor('hobbies-sports').map((f) => f.key)).not.toContain('bookLanguage')
  })
})

describe('migrateLegacyCategoryParams', () => {
  it('rewrites the old hobbies books link, keeps the search, drops the chip that has no control on the aisle', () => {
    const out = migrateLegacyCategoryParams(new URLSearchParams('category=hobbies-sports&subcategory=books&attr_bookLanguage=english&q=harry'))
    expect(out.get('category')).toBe('books-stationery')
    expect(out.has('subcategory')).toBe(false)
    expect(out.has('attr_bookLanguage')).toBe(false)
    expect(out.get('q')).toBe('harry')
  })

  it('leaves any other link untouched, as the same object', () => {
    const params = new URLSearchParams('category=hobbies-sports&subcategory=fitness')
    expect(migrateLegacyCategoryParams(params)).toBe(params)
  })
})
