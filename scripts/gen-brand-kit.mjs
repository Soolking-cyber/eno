// One-off: generate an eno.vn brand logo kit for social profile pictures.
// Renders the square "e" mark and the "eno" wordmark into PNG/JPG/SVG at the
// sizes social platforms want. Run from the project root: `node scripts/gen-brand-kit.mjs`.
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/Users/mk1e3/Desktop/eno-brand-kit'
const BLUE = { r: 10, g: 102, b: 194, alpha: 1 } // #0A66C2
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

const mk = (p) => fs.mkdirSync(path.join(OUT, p), { recursive: true })
;['e-mark/rounded', 'eno-wordmark/on-white', 'eno-wordmark/on-blue', 'eno-wordmark/transparent'].forEach(mk)

// ── source SVGs ──
const markRounded = fs.readFileSync('public/logo-mark.svg', 'utf8')        // blue rounded square + white e
const markSquare  = markRounded.replace('rx="112"', 'rx="0"')              // full-bleed (clean circle/square crop)
const wordBlue    = fs.readFileSync('public/logo.svg', 'utf8')             // blue wordmark, transparent
const wordWhite   = wordBlue.replace(/#0A66C2/g, '#FFFFFF')                // white wordmark for blue bg

const write = (rel, buf) => { fs.writeFileSync(path.join(OUT, rel), buf); console.log('  ' + rel) }
const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } }).png().toBuffer()
const jpg = (svg, size, bg) => sharp(Buffer.from(svg)).resize(size, size).flatten({ background: bg }).jpeg({ quality: 92 }).toBuffer()

// Center a 4:1 wordmark on a square canvas with padding.
async function wordmarkSquare(svg, size, bg) {
  const pad = Math.round(size * 0.10)
  const innerW = size - pad * 2
  const innerH = Math.round(innerW / 4)
  const top = Math.round((size - innerH) / 2)
  const word = await sharp(Buffer.from(svg)).resize(innerW, innerH).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: word, top, left: pad }])
}

console.log('Writing kit to', OUT)

// ── "e" mark — full-bleed square (recommended profile picture) ──
console.log('e-mark (full-bleed square):')
write('e-mark/eno-e-mark.svg', markSquare)
for (const s of [1000, 512, 400, 180]) write(`e-mark/eno-e-mark-${s}.png`, await png(markSquare, s))
write('e-mark/eno-e-mark-1000.jpg', await jpg(markSquare, 1000, BLUE))

// ── "e" mark — rounded (app-icon style, transparent corners) ──
console.log('e-mark/rounded:')
write('e-mark/rounded/eno-e-mark-rounded.svg', markRounded)
for (const s of [1000, 512]) write(`e-mark/rounded/eno-e-mark-rounded-${s}.png`, await png(markRounded, s))

// ── "eno" wordmark — square on white ──
console.log('eno-wordmark/on-white:')
for (const s of [1000, 512]) write(`eno-wordmark/on-white/eno-wordmark-white-${s}.png`, await (await wordmarkSquare(wordBlue, s, WHITE)).png().toBuffer())
write('eno-wordmark/on-white/eno-wordmark-white-1000.jpg', await (await wordmarkSquare(wordBlue, 1000, WHITE)).jpeg({ quality: 92 }).toBuffer())

// ── "eno" wordmark — square on blue ──
console.log('eno-wordmark/on-blue:')
for (const s of [1000, 512]) write(`eno-wordmark/on-blue/eno-wordmark-blue-${s}.png`, await (await wordmarkSquare(wordWhite, s, BLUE)).png().toBuffer())
write('eno-wordmark/on-blue/eno-wordmark-blue-1000.jpg', await (await wordmarkSquare(wordWhite, 1000, BLUE)).jpeg({ quality: 92 }).toBuffer())

// ── "eno" wordmark — transparent horizontal (headers / banners, not profile pics) ──
console.log('eno-wordmark/transparent:')
write('eno-wordmark/transparent/eno-wordmark.svg', wordBlue)
write('eno-wordmark/transparent/eno-wordmark-white.svg', wordWhite)
for (const w of [2400, 1200]) write(`eno-wordmark/transparent/eno-wordmark-${w}.png`, await sharp(Buffer.from(wordBlue)).resize(w, Math.round(w/4)).png().toBuffer())
write('eno-wordmark/transparent/eno-wordmark-white-2400.png', await sharp(Buffer.from(wordWhite)).resize(2400, 600).png().toBuffer())

console.log('Done.')
