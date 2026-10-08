import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Motion polish (Emil audit, tier 4) that has no runtime to test it in jsdom: Leaflet's resize handling and the
 * bottom banners' entry curve. Pinned at the source so a later edit can't quietly undo them.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('motion polish, tier 4', () => {
  it('the map fires ONE moveend per resize burst, not one per ResizeObserver frame (each re-sorted the side list)', () => {
    expect(src('src/components/marketplace/listings-map.tsx')).toMatch(/invalidateSize\(\{ pan: false, debounceMoveend: true \}\)/)
  })

  it('the bottom banners enter on the strong ease-out curve, not the browser default `ease`', () => {
    for (const f of ['lang-suggestion-banner.tsx', 'install-hint.tsx']) {
      expect(src(`src/components/marketplace/${f}`)).toMatch(/animate-in fade-in slide-in-from-bottom-4 duration-300 ease-out-strong/)
    }
    expect(src('src/components/marketplace/query-provider.tsx')).toMatch(/animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out-strong/)
  })

  it('the publish success screen arrives (bubble-in) and its mascot pops on the success curve', () => {
    const s = src('src/components/marketplace/post-wizard-sections.tsx')
    expect(s).toMatch(/className="bubble-in flex flex-col items-center gap-4 py-16 text-center"/)
    expect(s).toMatch(/<Mascot name="success" className="h-52 w-52 animate-in fade-in zoom-in-90 duration-500 ease-bounce" \/>/)
  })
})
