#!/usr/bin/env node
/**
 * Build the link-preview card from the brand banner.
 *
 *   node scripts/gen-share-card.mjs                          # assets/brand-banner.jpg -> public/og/share-card.jpg
 *   node scripts/gen-share-card.mjs <banner> --out <path>
 *
 * ⚠️ THE SOURCE LIVES IN THE REPO (`assets/brand-banner.jpg`) ON PURPOSE. The card was first built
 * from a file on one laptop's Desktop, which makes a committed artifact nobody else can rebuild —
 * the next person to touch the brand would have had to recreate the letterbox by eye.
 *
 * ⚠️ THE OUTPUT SHAPE IS FIXED AT 1200x630 AND THE INPUT WILL NOT MATCH IT. Facebook, Twitter/X,
 * Slack, Zalo and iMessage all render `summary_large_image` at 1.91:1. The brand banner is 2.40:1,
 * so a scraper left to its own devices crops ~200px off EACH SIDE — into the `eno` wordmark on the
 * left and the photo column on the right. This fits the whole banner to the width instead and
 * pads the remainder, which is why the card loses nothing.
 *
 * ⛔ THE PADDING IS A BLURRED COPY, NOT A FLAT COLOUR, BECAUSE THE BACKGROUND IS A GRADIENT.
 * Measured on the 2026-08-26 banner: rgb(0,71,179) at the top edge against rgb(11,98,203) at the
 * bottom. Flat brand-blue bars band visibly against that; a cover-scaled blur continues it. Same
 * treatment the listing gallery uses for off-ratio photos, so the two read as one house style.
 *
 * ⚠️ PROVENANCE IS CHECKABLE, BECAUSE THIS IS DETERMINISTIC. A reviewer cannot read two binaries
 * in a diff and tell whether the committed card came from the committed banner — so verify it by
 * re-running: three separate runs produce byte-identical output, and
 *   node scripts/gen-share-card.mjs --out /tmp/card.jpg && shasum -a256 /tmp/card.jpg public/og/share-card.jpg
 * must print the same digest twice. As of assets/brand-banner.jpg at 1942x809 that is
 * 29b1698151655ca7… — if it differs, the card was hand-edited or the banner moved on.
 *
 * ⚠️ JPEG, NOT WEBP/AVIF. Several scrapers still refuse anything but JPEG/PNG, and a card that
 * fails to decode falls back to no image at all — which is worse than the photo this replaced.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const W = 1200
const H = 630

/**
 * ⛔ SPLICE `--out <path>` OUT BEFORE LOOKING FOR THE SOURCE. Taking "the first argument that is
 * not a flag" reads the OUT PATH as the input: `gen-share-card.mjs --out public/og/share-card.jpg`
 * — the natural regenerate-in-place call — then re-encodes the finished card over ITSELF, prints
 * "0px blurred bars" and exits 0. Generation loss with a success message. I ran exactly that while
 * testing and read the output as the guard working.
 */
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
let out = 'public/og/share-card.jpg'
if (outIdx >= 0) {
  out = args[outIdx + 1]
  if (!out || out.startsWith('--')) {
    console.error('--out needs a path')
    process.exit(1)
  }
  args.splice(outIdx, 2)
}
const src = args.find((a) => !a.startsWith('--')) ?? 'assets/brand-banner.jpg'

if (!existsSync(src)) {
  console.error(`${src} does not exist`)
  process.exit(1)
}

// ⚠️ Dynamic import: sharp is a native module and must never be pulled in at module scope in
// anything the app can reach. This is a script, but the habit is the rule (see CLAUDE.md).
const sharp = (await import('sharp')).default

const meta = await sharp(src).metadata()
if (!meta.width || !meta.height) {
  console.error('could not read the source dimensions')
  process.exit(1)
}

const fitted = Math.round(W * (meta.height / meta.width))
if (fitted > H) {
  // A TALLER-than-1.91:1 source would need side bars instead, and a portrait banner is a sign
  // someone handed this the wrong asset. Fail rather than silently producing a letterboxed strip.
  console.error(`${src} is ${meta.width}x${meta.height} (${(meta.width / meta.height).toFixed(2)}:1) — taller than the 1200x630 card. Expected a wide banner.`)
  process.exit(1)
}

/**
 * ⛔ `.png()` ON BOTH INTERMEDIATES — A BARE `.toBuffer()` RE-ENCODES THEM AS JPEG. sharp keeps the
 * INPUT's format when none is given, so each stage came back jpeg q80 **4:2:0** (measured), and the
 * wordmark was chroma-subsampled twice before the final `chromaSubsampling: '4:4:4'` ever ran —
 * paid for in bytes, never delivered. The q80 pass over the blurred gradient also risks baking 8x8
 * quantisation banding into the exact bars the blur exists to keep smooth. PNG is lossless, so the
 * only encode that touches the pixels is the last one.
 */
const background = await sharp(src).resize(W, H, { fit: 'cover' }).blur(24).modulate({ brightness: 0.96 }).png().toBuffer()
const foreground = await sharp(src).resize(W, fitted, { fit: 'inside' }).png().toBuffer()

const card = await sharp(background)
  .composite([{ input: foreground, left: 0, top: Math.round((H - fitted) / 2) }])
  .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
  .toBuffer()

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, card)
console.log(`${src}  ${meta.width}x${meta.height}`)
console.log(`  -> ${out}  ${W}x${H}, banner fitted at ${W}x${fitted}, ${Math.round((H - fitted) / 2)}px blurred bars, ${(card.length / 1024).toFixed(0)} KB`)
