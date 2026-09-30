import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RENTAL_CHECK_MAX_ITEMS } from '@/lib/rental-check/shared'

/**
 * ⛔ THE HINT'S NUMBER IS A LITERAL, AND THIS PINS IT TO THE CONSTANT (SEO wave B, D1; plan v4, fix 7).
 * `RentalCheckHint` keeps a literal `tr(en, vi)` pair because the UI-string harvester reads literal
 * pairs only. D1 puts that hint on ~24 more pages whose descriptions interpolate
 * RENTAL_CHECK_MAX_ITEMS — so changing the constant must fail here until the pair says the same.
 */
describe('RentalCheckHint', () => {
  it('names the same limit as RENTAL_CHECK_MAX_ITEMS, in both languages', () => {
    const src = readFileSync('src/components/marketplace/rental-check-toggle.tsx', 'utf8')
    const body = src.slice(src.indexOf('export function RentalCheckHint'))
    const m = body.match(/tr\(\s*'([^']*)',\s*'([^']*)',?\s*\)/)
    expect(m).not.toBeNull()
    const [, en, vi] = m!
    expect(en).toMatch(new RegExp(`^Pick up to ${RENTAL_CHECK_MAX_ITEMS} rentals\\b`))
    expect(vi).toMatch(new RegExp(`^Chọn tối đa ${RENTAL_CHECK_MAX_ITEMS} căn\\b`))
  })
})
