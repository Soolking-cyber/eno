// Build an Xcode asset catalog from the generated Solar glyphs.
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
// ⚠️ TWO FAMILIES, ONE CATALOG. `ui/` are the interface glyphs (search, saved, share); the bare
// folders are the 19 CATEGORY TILES (vehicles, electronics, rentals …), which the web draws on
// the home grid and the app draws on its category rail. They are namespaced `cat-` here because
// two of them — `services`, `jobs` — collide with UI glyph names, and a silent collision would
// mean the wrong picture rather than a build error.
const SETS = [
  { dir: 'public/icons/ui', prefix: '' },
  { dir: 'public/icons', prefix: 'cat-' },
]
const OUT = 'apps/ios/Eno/Resources/Icons.xcassets'
if (existsSync(OUT)) rmSync(OUT, { recursive: true })
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2))
let n = 0
for (const { dir: SRC, prefix } of SETS)
for (const weight of ['rest', 'selected']) {
  for (const f of readdirSync(join(SRC, weight)).filter((x) => x.endsWith('.svg'))) {
    const name = prefix + f.replace(/\.svg$/, '')
    const asset = `${name}${weight === 'selected' ? '-fill' : ''}`
    const dir = join(OUT, `${asset}.imageset`)
    mkdirSync(dir, { recursive: true })
    // Solar glyphs are monochrome: template rendering lets SwiftUI tint them with foregroundStyle,
    // exactly as the web tints the sprite with currentColor.
    writeFileSync(join(dir, f), readFileSync(join(SRC, weight, f)))
    writeFileSync(join(dir, 'Contents.json'), JSON.stringify({
      images: [{ filename: f, idiom: 'universal' }],
      info: { author: 'xcode', version: 1 },
      properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
    }, null, 2))
    n++
  }
}
// ── the 3D ART, which is what the web's mobile nav and category rail actually draw ───────────
// ⛔ THE FLAT SOLAR GLYPHS ARE NOT THE WHOLE STORY, and assuming they were is what made the first
// pass of this migration look wrong on the two most visible surfaces. `mobile-nav.tsx` draws
// `/icons/nav/<key>.webp` and the category rail draws `/icons/categories/<slug>.webp` — rendered
// 3D pieces, not line icons. Solar is for the interface glyphs INSIDE the content; the art is the
// furniture. Owner: *"custom glyph icons are not present ... categories rail is not same"*.
//
// ⚠️ WEBP CANNOT GO IN AN ASSET CATALOG, so each piece is converted to PNG here with `sips`
// (macOS ships it; no new dependency). The source is 184×184, which covers a 44pt tile at @3x
// with a pixel to spare, so it is emitted as the @3x slot and Xcode downsamples the rest.
// ⚠️ These are NOT template images: they are full-colour art and must render as-is, so they carry
// no `template-rendering-intent`.
const ART = [
  { dir: 'public/icons/nav', prefix: 'nav-' },
  { dir: 'public/icons/categories', prefix: 'art-' },
]
let a = 0
for (const { dir, prefix } of ART) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.webp'))) {
    const name = prefix + f.replace(/\.webp$/, '')
    const d = join(OUT, `${name}.imageset`)
    mkdirSync(d, { recursive: true })
    const png = `${name}.png`
    execFileSync('sips', ['-s', 'format', 'png', join(dir, f), '--out', join(d, png)], { stdio: 'ignore' })
    writeFileSync(join(d, 'Contents.json'), JSON.stringify({
      images: [{ filename: png, idiom: 'universal', scale: '3x' }, { idiom: 'universal', scale: '1x' }, { idiom: 'universal', scale: '2x' }],
      info: { author: 'xcode', version: 1 },
    }, null, 2))
    a++
  }
}
console.log(`wrote ${n} glyph imagesets + ${a} art imagesets to ${OUT}`)
