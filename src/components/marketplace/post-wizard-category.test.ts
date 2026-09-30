import { describe, expect, it } from 'vitest'
import { categoryHasBrand } from '@/lib/taxonomy'
import { categoryChangeLosesAnswers, categoryChangeReset, type CategoryAnswers } from './post-wizard-category'

const BLANK: CategoryAnswers = { categorySlug: '', subcategorySlug: '', condition: '', attrs: {}, ranges: {}, brand: '', model: '' }

describe('post wizard — a category change', () => {
  it('clears brand and model even when BOTH categories have a brand (Electronics → Vehicles)', () => {
    expect(categoryHasBrand('electronics')).toBe(true)
    expect(categoryHasBrand('vehicles')).toBe(true)
    const reset = categoryChangeReset('vehicles')
    expect(reset.brand).toBe('')
    expect(reset.model).toBe('')
    expect(reset).toMatchObject({ categorySlug: 'vehicles', subcategorySlug: '', condition: '', attrs: {}, ranges: {} })
  })

  it('offers Undo when only a brand/model would be lost, whatever the target category', () => {
    expect(categoryChangeLosesAnswers({ ...BLANK, categorySlug: 'electronics', brand: 'Apple', model: 'iPhone' })).toBe(true)
    expect(categoryChangeLosesAnswers({ ...BLANK, categorySlug: 'electronics', model: 'iPhone' })).toBe(true)
  })

  it('offers no Undo for a first pick or a switch that loses nothing', () => {
    expect(categoryChangeLosesAnswers({ ...BLANK, brand: 'Apple' })).toBe(false)
    expect(categoryChangeLosesAnswers({ ...BLANK, categorySlug: 'electronics', brand: '  ' })).toBe(false)
  })
})
