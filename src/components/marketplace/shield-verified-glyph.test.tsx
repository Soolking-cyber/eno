// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SHIELD_VERIFIED } from '@/generated/ui-art-shields'
import { ICON_SPRITE_CORE } from '@/components/ui/icons'
import { ShieldVerifiedGlyph } from './shield-verified-glyph'

/** The badges' shield as one sprite `<use>` (2026-11-17 page weight) must draw exactly what the inlined paths drew. */
describe('ShieldVerifiedGlyph', () => {
  it('⛔ the sprite symbol it references is the same paths and fill rules as SHIELD_VERIFIED.rest', () => {
    const sprite = readFileSync(join(process.cwd(), 'public', ICON_SPRITE_CORE.split('?')[0]), 'utf8')
    const m = /<symbol([^>]*)id="ShieldCheck-r"([^>]*)>([\s\S]*?)<\/symbol>/.exec(sprite)
    expect(m).toBeTruthy()
    // Same box as the inlined art drew in: anything else would scale or clip the shield inside an 11px chip.
    expect(`${m![1]} ${m![2]}`).toContain('viewBox="0 0 24 24"')
    // Each path paints itself with currentColor (the host svg says fill="none", which a path without its own fill would inherit).
    const paths = [...m![3].matchAll(/<path([^>]*)\/>/g)].map((x) => ({
      d: /\sd="([^"]+)"/.exec(x[1])?.[1],
      evenOdd: /fill-rule="evenodd"/.test(x[1]) && /clip-rule="evenodd"/.test(x[1]),
      fill: /fill="([^"]+)"/.exec(x[1])?.[1],
    }))
    expect(paths).toEqual(SHIELD_VERIFIED.rest.map((p) => ({ d: p.d, evenOdd: !!p.evenOdd, fill: 'currentColor' })))
  })

  it('is one <use> into the core sprite, colour from the host, hidden from assistive tech', () => {
    const html = renderToStaticMarkup(<ShieldVerifiedGlyph size={11} className="shrink-0" style={{ color: 'red' }} />)
    expect(html).toContain(`href="${ICON_SPRITE_CORE}#ShieldCheck-r"`)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('width="11"')
    expect(html).not.toContain('<path')
    expect(html.length).toBeLessThan(300)
  })
})
