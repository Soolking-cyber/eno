import { describe, expect, it } from 'vitest'
import { TR_OVERRIDES } from './glossary'
import { templateIntact } from './placeholders'
import { UI_STRINGS } from '@/generated/ui-strings'
import { UI_STRINGS_SERVICES } from '@/generated/ui-strings.services'

/**
 * Curated TEMPLATE overrides (the ones machine translation reduced to a bare number — "{n} contacted" → "{n}"
 * in Khmer) must themselves be fillable: the same {placeholders} as the English, and words besides them.
 * A curated entry that broke either would be worse than the machine output it replaced.
 */
describe('curated template overrides', () => {
  it('keep exactly the English placeholders and carry words besides them — and key a string the UI really has', () => {
    const shipped = new Set<string>([...UI_STRINGS, ...UI_STRINGS_SERVICES])
    let checked = 0
    for (const [en, byLang] of Object.entries(TR_OVERRIDES)) {
      if (!/\{[A-Za-z_]\w*\}/.test(en)) continue
      // An override is looked up by the exact English; a key nothing renders is silently dead.
      expect(shipped.has(en), `no UI string "${en}"`).toBe(true)
      for (const [lang, value] of Object.entries(byLang)) {
        checked++
        expect(templateIntact(value!, en), `${lang}: ${en}`).toBe(true)
        expect(value!.replace(/\{[^{}]*\}/g, '').replace(/[\s\p{P}\p{S}\d]/gu, '').length, `${lang}: ${en}`).toBeGreaterThan(0)
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
