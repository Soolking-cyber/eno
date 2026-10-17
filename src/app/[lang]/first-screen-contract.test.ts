import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THE PHONE'S FIRST SCREEN AND ITS CHROME (owner, 2026-10-18: "look super professional … like top marketplace";
 * header "slimmer + calm"; interruptions "one per visit, no floaters"). Most of what moved is server markup or a class
 * on a page that needs a database to render, so — like lang-pilot.test.tsx's link sites — it is pinned as a source
 * contract: each rule names the line that carries it.
 */
const src = (f: string) => readFileSync(f, 'utf8')
/** The source without comments, so a rule cannot be satisfied (or broken) by prose. */
const code = (f: string) => src(f).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the header is 56px and every offset under it moved with it', () => {
  it('h-14 bar; nothing stacks under it at the old 4rem / 3.75rem', () => {
    expect(code('src/components/marketplace/header.tsx')).toMatch(/relative mx-auto flex h-14 w-full max-w-7xl/)
    for (const f of [
      'src/components/marketplace/header.tsx',
      'src/components/marketplace/explorer-toolbar.tsx',
      'src/components/marketplace/section-header.tsx',
      'src/components/marketplace/listings-explorer.tsx',
    ]) {
      const c = code(f)
      expect(c, f).not.toMatch(/\+4rem\)|calc\(4rem|3\.75rem/)
    }
    expect(code('src/components/marketplace/explorer-toolbar.tsx')).toMatch(/var\(--safe-area-inset-top,0px\)\)\+3\.5rem\)\]/)
    expect(code('src/components/marketplace/section-header.tsx')).toMatch(/var\(--safe-area-inset-top,0px\)\)\+3\.5rem\)\]/)
    expect(code('src/components/marketplace/listings-explorer.tsx')).toMatch(/calc\(3\.5rem \+ max\(env\(safe-area-inset-top\)/)
    expect(code('src/components/marketplace/listings-explorer.tsx')).toMatch(/scroll-mt-\[calc\(3\.5rem\+env\(safe-area-inset-top\)\)\]/)
  })

  it('the search panel\'s recent-location and category chips are the browse chip (ui/chip `md`, 44px hit area)', () => {
    const s = code('src/components/marketplace/header.tsx')
    expect(s.match(/className=\{cn\(chipVariants\(\{ size: 'md', tone: 'neutral' \}\), 'relative tap-44 whitespace-normal'\)\}/g)).toHaveLength(2)
  })

  it('the search glow is gone — its class, its rule and its keyframes, with no ring left in its place', () => {
    expect(code('src/components/marketplace/header.tsx')).not.toMatch(/search-beam/)
    const css = src('src/app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/search-beam/)
  })
})

describe('the first screen', () => {
  it('home: the `/vi` pilot switcher left the top — it renders after the feed, inside <main>', () => {
    const s = code('src/app/[lang]/(home)/layout.tsx')
    expect(s).toMatch(/\{\s*children\s*\}\s*\{PILOTED && <div[^>]*><LangPilotSwitch path="\/" params=\{params\} \/><\/div>\}\s*<\/main>/)
    expect(s.indexOf('<LangPilotSwitch')).toBeGreaterThan(s.indexOf('{children}'))
  })

  it('/c: pt-4 like home and the PDP; a one-line H1 on a phone; the pilot switcher after the page', () => {
    const s = code('src/app/[lang]/c/[category]/(index)/layout.tsx')
    expect(s).toMatch(/<main id="main"[^>]*className="[^"]*\bpt-4 pb-12"/)
    expect(s).not.toMatch(/\bpt-6\b/)
    expect(s).toMatch(/<h1 className="h-display text-foreground max-sm:truncate max-sm:py-0\.5 max-sm:\[--text-display:var\(--text-title\)\]">/)
    expect(s.indexOf('<LangPilotSwitch')).toBeGreaterThan(s.indexOf('{children}'))
    expect(s.indexOf('<LangPilotSwitch')).toBeLessThan(s.indexOf('</main>'))
  })

  it('/c rentals: the availability promise is one line on a phone, with its link to the check', () => {
    const s = code('src/app/[lang]/c/[category]/(index)/category-lede-block.tsx')
    expect(s).toMatch(/<RentalCheckHint className="[^"]*max-sm:\[&>span\]:truncate[^"]*" \/>/)
    expect(s).toMatch(/<Link href=\{RENTAL_CHECK_PATH\} prefetch=\{false\} className="[^"]*\bsm:hidden"/)
    // ⛔ Its visible box is the target (`-my-1 py-1`), never a 44px extender: "Show more" sits 10px above and the
    // later extender won a 14px overlap (gate, 2026-10-18 — measured with elementFromPoint at 390 and 360).
    const link = s.match(/<Link href=\{RENTAL_CHECK_PATH\} prefetch=\{false\} className="([^"]*)"/)![1].split(/\s+/)
    expect(link).toEqual(expect.arrayContaining(['-my-1', 'py-1']))
    expect(link).not.toContain('tap-44')
  })

  it('/c: the strip\'s Filters is the browse chip, and so is every "Other categories" chip', () => {
    const s = code('src/app/[lang]/c/[category]/(index)/page.tsx')
    expect(s).toMatch(/stripEnd=\{<CategoryFiltersLink slug=\{cat\.slug\} query=\{homesQuery\} className=\{cn\(PILL_BOX, PILL_REST/)
    expect(s.match(/className=\{OTHER_CATEGORY_CHIP\}/g)).toHaveLength(2)
  })

  it('the PDP: the phone gallery sits flush under the header (`-mt-4` takes back <main>\'s pt-4)', () => {
    const s = code('src/app/[lang]/listings/[id]/(pdp)/page.tsx')
    expect(s).toMatch(/<main id="main"[^>]*className="[^"]*\bpt-4\b/)
    expect(s).toMatch(/<div className="relative order-2 -mx-3 -mt-4 sm:-mx-6 md:hidden">\s*<ListingGallery variant="mobile"/)
  })
})
