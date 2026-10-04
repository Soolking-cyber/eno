#!/usr/bin/env node
/**
 * Turn the reviewed logo captures (scripts/harvest-school-logos.mjs) into the tiles /schools shows.
 *
 *   node scripts/build-school-logos.mjs [--from ~/eno-school-logos] [--sheet <out.png>]
 *
 * Each logo is trimmed to its ink and centred on a 2:1 tile filled with the colour it was captured on
 * (white when it had none), then written twice as WebP: <slug>.webp at 240×120 for the list rows and
 * <slug>-2x.webp at 480×240 for the school page (no `@` in a name: src/lib/image-loader.ts serves only plain
 * spellings from public/). The tile carries its own background so a white wordmark captured on a navy header stays
 * legible on a white card, and so every tile has the same shape and can be drawn with object-cover.
 *
 * src/generated/school-logos.ts maps slug → a content stamp of both files. The stamp rides in `?v=`
 * (next.config.ts STAMPABLE_STATIC), which is what earns the year-long immutable browser cache and what
 * busts it when a logo is re-captured. A school without a usable logo is absent; the page draws its
 * monogram. Files for schools no longer produced are deleted, so the folder is exactly the manifest.
 *
 * ⛔ A PURE FUNCTION OF THE HARVEST AND THE OVERRIDES, ALL OR NOTHING. Every school with a website must
 * have a capture made under the override data/schools/logo-overrides.json says NOW (or `use: "none"` with
 * its reason), and a light logo with no background of its own must have a `bg`. Anything else stops the
 * build before it writes a single file, as does a capture taken from a website the school no longer has.
 * Then every tile is rebuilt, with crop and bg applied from the file as it is now, and
 * data/schools/logo-sources.json records what each tile was made from (website, url, selector, use, crop, bg); src/lib/schools/logos.test.ts holds it to the overrides, so an override edited
 * without a rebuild fails CI. The raw captures live outside the repo (default ~/eno-school-logos) and are
 * reproducible: the harvester makes them again. Taking a logo down: `use: "none"` with a why, rebuild, deploy,
 * then Cloudflare `purge_everything` — the tiles carry a one-year immutable cache, so the edge keeps a copy.
 *
 * --sheet writes a labelled contact sheet of every tile for a person to check before committing.
 */
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const FROM = arg('from', join(homedir(), 'eno-school-logos')).replace(/^~/, homedir())
const SHEET = arg('sheet', '')?.replace(/^~/, homedir())
const OUT = 'public/schools/logos'
const MANIFEST = 'src/generated/school-logos.ts'
const W = 240
const H = 120

const schools = JSON.parse(readFileSync('data/schools/hcmc.json', 'utf8')).schools
const overrides = JSON.parse(readFileSync('data/schools/logo-overrides.json', 'utf8'))
if (!existsSync(join(FROM, 'results.json'))) {
  console.error(`No harvest at ${FROM} — run scripts/harvest-school-logos.mjs first (or pass --from). Nothing was changed.`)
  process.exit(1)
}
const results = new Map(JSON.parse(readFileSync(join(FROM, 'results.json'), 'utf8')).map((r) => [r.slug, r]))

// What decides WHICH file is captured (the harvester records exactly this), and everything that decides the pixels.
const capturedBy = (o) => ({ url: o.url ?? null, selector: o.selector ?? null, use: o.use ?? null })
const decision = (o, website) => ({ website, ...capturedBy(o), crop: o.crop ?? null, bg: o.bg ?? null })
const SOURCES = 'data/schools/logo-sources.json'
const rawOf = (r, slug) => r?.logoFile ?? (r?.logo?.found ? `${slug}.png` : null)

// 1 — every school that should have a logo has a capture made under its current override, or nothing is written.
const want = schools.filter((s) => s.website && overrides[s.slug]?.use !== 'none')
const problems = []
for (const s of want) {
  const r = results.get(s.slug)
  const file = rawOf(r, s.slug)
  if (!r) problems.push(`${s.slug}: not in the harvest`)
  else if (r.website !== s.website) problems.push(`${s.slug}: captured from ${r.website}, the school's website is now ${s.website}`)
  else if (JSON.stringify(r.override ?? capturedBy({})) !== JSON.stringify(capturedBy(overrides[s.slug] ?? {}))) problems.push(`${s.slug}: captured under a different override`)
  else if (!file || !existsSync(join(FROM, 'raw', file))) problems.push(`${s.slug}: no capture${r.error ? ` (${String(r.error).slice(0, 80)})` : ''}`)
}
if (problems.length) {
  console.error(`Refusing. Re-harvest with --only ${problems.map((p) => p.split(':')[0]).join(',')} — or give a school use "none" with a why:\n  ${problems.join('\n  ')}\nNothing was changed.`)
  process.exit(1)
}

/** What the logo sits on: the colour around its edge (`solid`), nothing (`transparent`), or a picture (`mixed`). */
async function backgroundOf(img) {
  const { data, info } = await img.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const ring = []
  const at = (x, y) => { const i = (y * w + x) * 4; ring.push([data[i], data[i + 1], data[i + 2], data[i + 3]]) }
  for (let x = 0; x < w; x++) { at(x, 0); at(x, h - 1) }
  for (let y = 1; y < h - 1; y++) { at(0, y); at(w - 1, y) }
  const opaque = ring.filter((p) => p[3] >= 32)
  // The ink's lightness, to catch a white logo made for a dark header that has no background of its own.
  let lum = 0, inked = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
    inked++
  }
  const inkLuminance = inked ? lum / inked : 0
  if (opaque.length < ring.length / 2) return { kind: 'transparent', inkLuminance }
  const median = [0, 1, 2].map((c) => opaque.map((p) => p[c]).sort((a, b) => a - b)[opaque.length >> 1])
  const near = opaque.filter((p) => Math.abs(p[0] - median[0]) + Math.abs(p[1] - median[1]) + Math.abs(p[2] - median[2]) < 30).length
  return { kind: near / ring.length > 0.8 ? 'solid' : 'mixed', rgb: median, inkLuminance }
}

const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

async function tile(source, o) {
  let img = sharp(source, { pages: 1 }).ensureAlpha()
  if (o.crop) {
    const m = await img.metadata()
    img = sharp(await img.extract({
      left: Math.round(o.crop.left * m.width), top: Math.round(o.crop.top * m.height),
      width: Math.round(o.crop.width * m.width), height: Math.round(o.crop.height * m.height),
    }).png().toBuffer())
  }
  const bg = await backgroundOf(img)
  const fill = o.bg ? rgbOf(o.bg) : bg.kind === 'transparent' ? [255, 255, 255] : bg.rgb
  const rgb = (c) => ({ r: c[0], g: c[1], b: c[2] })
  // Flatten onto the tile colour FIRST, then trim against it: a logo drawn inside its own white disc on a
  // transparent file (TDTU) otherwise keeps the invisible disc as margin and comes out small. A picture
  // behind the logo (`mixed`) has no single colour to trim against.
  const flat = sharp(await img.flatten({ background: rgb(fill) }).png().toBuffer())
  const ink = bg.kind === 'mixed' ? await flat.png().toBuffer()
    : await flat.trim({ background: rgb(bg.kind === 'solid' ? bg.rgb : fill), threshold: 24 }).png().toBuffer()
      .catch(async () => flat.png().toBuffer()) // trim throws on a blank image
  const out = {}
  for (const scale of [1, 2]) {
    const w = W * scale, h = H * scale
    const box = { width: Math.round(w * 0.86), height: Math.round(h * 0.68) }
    const logo = await sharp(ink).resize({ ...box, fit: 'inside', kernel: 'lanczos3' }).toBuffer()
    out[scale] = await sharp({ create: { width: w, height: h, channels: 3, background: { r: fill[0], g: fill[1], b: fill[2] } } })
      .composite([{ input: logo, gravity: 'centre' }])
      .webp({ quality: scale === 1 ? 86 : 80, effort: 6, smartSubsample: true })
      .toBuffer()
  }
  return { out, bg, fill: hex(fill) }
}

// 2 — every tile, in memory. A light logo with nothing behind it would be a blank white tile: refused.
const stampOf = (a, b) => createHash('sha256').update(a).update(b).digest('hex').slice(0, 8)
const built = []
const light = []
const warnings = []
for (const s of want) {
  const o = overrides[s.slug] ?? {}
  const { out, bg, fill } = await tile(join(FROM, 'raw', rawOf(results.get(s.slug), s.slug)), o)
  if (bg.kind === 'transparent' && bg.inkLuminance > 0.85 && !o.bg) light.push(s.slug)
  if (bg.kind === 'mixed') warnings.push(`${s.slug}: captured over a picture (${fill}) — check the tile`)
  built.push({ slug: s.slug, out, decision: decision(o, s.website) })
}
if (light.length) {
  console.error(`Refusing. A light logo with no background of its own — set "bg" in logo-overrides.json for: ${light.join(', ')}. Nothing was changed.`)
  process.exit(1)
}

// 3 — write: the tiles, out with any file no school owns, then the record and the manifest. Every check that
// can refuse has already run, so a refusal changes nothing. A write that dies part-way (a full disk, a killed
// process) leaves a folder, manifest, stamps and record that disagree, which src/lib/schools/logos.test.ts
// fails on; `git checkout -- public/schools/logos src/generated/school-logos.ts data/schools/logo-sources.json`
// restores the committed set.
mkdirSync(OUT, { recursive: true })
const stamps = {}
let bytes = 0
for (const b of built) {
  writeFileSync(join(OUT, `${b.slug}.webp`), b.out[1])
  writeFileSync(join(OUT, `${b.slug}-2x.webp`), b.out[2])
  stamps[b.slug] = stampOf(b.out[1], b.out[2])
  bytes += b.out[1].length + b.out[2].length
}
for (const f of readdirSync(OUT)) {
  if (!stamps[f.replace(/(-2x)?\.webp$/, '')]) unlinkSync(join(OUT, f))
}
writeFileSync(SOURCES, JSON.stringify(Object.fromEntries(built.map((b) => [b.slug, b.decision]).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n')
writeFileSync(MANIFEST,
  `// AUTO-GENERATED by scripts/build-school-logos.mjs — do not edit by hand.\n` +
  `// slug → content stamp of public/schools/logos/<slug>.webp + <slug>-2x.webp. The stamp rides in \`?v=\`,\n` +
  `// which earns the year-long immutable cache (next.config.ts STAMPABLE_STATIC). Absent = no logo.\n` +
  `export const SCHOOL_LOGO_STAMPS: Readonly<Record<string, string>> = {\n` +
  Object.entries(stamps).map(([k, v]) => `  '${k}': '${v}',\n`).join('') +
  `}\n`)

if (SHEET) {
  const slugs = Object.keys(stamps)
  const cols = 8, cw = W + 16, ch = H + 34
  const rows = Math.ceil(slugs.length / cols)
  const parts = []
  slugs.forEach((slug, i) => {
    const x = (i % cols) * cw + 8, y = Math.floor(i / cols) * ch + 8
    parts.push({ input: join(OUT, `${slug}.webp`), left: x, top: y })
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20"><text x="0" y="14" font-family="Helvetica" font-size="12" fill="#333">${i + 1}. ${slug.slice(0, 34)}</text></svg>`
    parts.push({ input: Buffer.from(label), left: x, top: y + H + 4 })
  })
  await sharp({ create: { width: cols * cw + 8, height: rows * ch + 8, channels: 3, background: '#e8e6e1' } }).composite(parts).png().toFile(SHEET)
}

console.log(`${Object.keys(stamps).length}/${schools.length} logos · ${(bytes / 1024).toFixed(0)} KB → ${OUT} + ${MANIFEST}`)
for (const w of warnings) console.log(`  ⚠️ ${w}`)
