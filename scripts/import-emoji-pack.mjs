/**
 * IMPORT THE ANIMATED EMOJI PACK into public/emoji, named to match src/lib/reactions.ts.
 *
 * ⚠️ RUN ONCE, BY HAND, WHEN THE PACK CHANGES — this is not part of the build. The source lives on
 * the owner's Desktop, not in the repo, so a build-time step would fail on every machine that is
 * not theirs (and in Cloud Build, which has no Desktop at all). The OUTPUT is committed; the input
 * is not.
 *
 * ⛔ IT REFUSES TO WRITE A FILE THE CATALOGUE DOES NOT NAME, and reports any catalogue entry with
 * no artwork. Those two checks are the whole point: a slug that exists in one place and not the
 * other produces an emoji that renders as a dead <img> or an animation nothing can reach, and
 * neither is visible to tsc. Better to fail here, loudly, than to ship a hole in the picker.
 *
 *   node scripts/import-emoji-pack.mjs "/path/to/lottie animated emoji pack"
 */
import { readdirSync, mkdirSync, statSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

// ⚠️ NO DEFAULT PATH. It used to fall back to a hardcoded ~/Desktop location, which baked one
// machine's account name into a committed file and silently ran against the wrong folder for
// anyone else. Reviewer-caught. Pass the pack explicitly.
const SRC = process.argv[2]
if (!SRC) {
  console.error('usage: node scripts/import-emoji-pack.mjs "/path/to/lottie animated emoji pack"')
  process.exit(1)
}
const OUT = join(process.cwd(), 'public', 'emoji')

/**
 * ⛔ AUTHORING METADATA, SAFE TO DROP ONLY BECAUSE THIS PACK HAS NO EXPRESSIONS. `ix`/`mn` are the
 * property indices and match-names a Lottie expression uses to address another property — strip
 * them from a file that HAS expressions and it breaks. Measured across all 47: zero expression
 * strings, zero effects. `nm`/`cl`/`ln`/`cix`/`np` are layer names and CSS-ish class hints that
 * nothing here reads.
 * ⚠️ `sr` IS NOT ON THIS LIST AND MUST NOT JOIN IT. It is time-stretch, and it is non-default in
 * three files — clap 0.87, fire 0.55, turtle 1.2/1.4 (verified). Dropping it plays fire at ~1.8×.
 * The same goes for `bm`, `ddd`, `hd`, and every timing field.
 */
const STRIP_KEYS = new Set(['nm', 'mn', 'cl', 'ln', 'ix', 'cix', 'np'])

/**
 * ⛔ COORDINATE ROUNDING WAS TRIED, MEASURED, AND REFUSED — DO NOT ADD IT BACK WITHOUT REDOING THE
 * RENDER DIFF. Three model families recommended rounding path data to 1 decimal as the headline
 * saving (~27%). It does save that. It also changes what the renderer draws. Measured by rendering
 * every one of the 47 files at 4 points in its timeline, at 24px and 96px, and diffing every number
 * lottie-web emitted into the SVG:
 *
 *     strip only   243KB br   47/47 byte-identical      ← shipped
 *     3 decimals   241KB br   26/47, worst 1.0 unit
 *     2 decimals   211KB br    0/47, worst 6.3 units
 *     1 decimal    178KB br    0/47, worst 41 units
 *
 * 3dp is the tell: it saves 2KB and still breaks identity, so the curve is not a gentle trade —
 * the data is genuinely load-bearing at every digit. And the whole argument is worth ~6KB PER
 * SESSION, because a user downloads the five emoji they see, never the pack. Six kilobytes on a
 * lazily-loaded decoration does not buy a pixel of risk on artwork the owner picked.
 *
 * ⚠️ THE FIRST ATTEMPT ALSO ROUNDED THE TIME DOMAIN and that was far worse than sub-pixel: `t`,
 * `ip`, `op`, `st` are in FRAMES, so a 0.05 nudge re-times a layer. It displaced `fire` by 244
 * units and `clap` by 58 — precisely the two files with a non-default `sr` (0.55, 0.87) to
 * multiply the error. If anyone does revisit rounding, exclude the time domain first and verify
 * with the render diff, not by eye.
 */
/**
 * ⛔ `i` AND `o` MEAN TWO DIFFERENT THINGS AND ONLY ONE OF THEM MAY BE ROUNDED. On a keyframe they
 * are the bezier EASING handles, an object of `{x,y}` in the 0..1 domain where 1dp quantises the
 * curve into visible stepping. On a shape path they are the in/out TANGENT arrays, in canvas units,
 * where 1dp is invisible. Same key, same file, opposite treatment — so the discriminator is the
 * value's shape, not its name. Getting this backwards is the one way this whole pass silently
 * ruins every animation while every file still parses.
 */
/**
 * ⛔ THE TIME DOMAIN IS NEVER ROUNDED, AND FINDING THAT OUT COST A FULL VERIFICATION PASS.
 * `t` (keyframe time), `ip`/`op` (layer in/out point), `st` (start time) and `sr` (time stretch)
 * are measured in FRAMES, not canvas units, so a 0.05-frame nudge is not a sub-pixel nudge — it
 * re-times the layer. Measured against a frame-by-frame render diff of all 47 files: rounding
 * these moved geometry by up to 244 units on `fire` and 58 on `clap`, which are precisely the two
 * files carrying a non-default `sr` (0.55 and 0.87) that multiplies any timing error. Excluding
 * them takes the worst drift in the pack to zero at a cost of ~1% of the saving.
 */
function optimize(node) {
  if (Array.isArray(node)) return node.map(optimize)
  if (node && typeof node === 'object') {
    const out = {}
    for (const [key, value] of Object.entries(node)) {
      if (STRIP_KEYS.has(key)) continue
      out[key] = optimize(value)
    }
    return out
  }
  return node
}

/** "Grin Sweat" → "grin-sweat", "100 Emoji" → "100-emoji". Must agree with reactions.ts. */
const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// The catalogue is TypeScript, so read the slugs out of the source text rather than importing it —
// the same idiom the icon and edition-stub tests use, and for the same reason: no build step.
const catalogue = readFileSync(join(process.cwd(), 'src/lib/reactions.ts'), 'utf8')
const wanted = new Set([...catalogue.matchAll(/lottie:\s*'([^']+)'/g)].map((m) => m[1]))
if (wanted.size === 0) {
  console.error('reactions.ts yielded ZERO slugs — the parser is broken, refusing to run.')
  process.exit(1)
}

let files
try {
  files = readdirSync(SRC).filter((f) => f.endsWith('.lottie'))
} catch {
  console.error(`Cannot read the pack at ${SRC}\nPass the folder as the first argument.`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

const copied = new Set()
const unexpected = []
let bytes = 0

for (const file of files) {
  const slug = slugify(basename(file, '.lottie'))
  if (!wanted.has(slug)) {
    unexpected.push(`${file} → ${slug}`)
    continue
  }
  /**
   * ⛔ EXTRACTED TO PLAIN JSON, NOT COPIED AS .lottie — this is the whole load-time decision.
   * A .lottie file is a ZIP, and nothing in a browser can open one without either a WASM
   * dotLottie runtime (~150KB of wasm before a single emoji renders) or a JS unzip library on the
   * critical path. Measured: each archive holds exactly one animation under animations/*.json, so
   * unzipping ONCE here — on the machine that has the pack — turns a runtime cost into a build
   * artifact and lets the player be the light, wasm-free lottie renderer.
   * ⚠️ Uses the system `unzip`, which is fine precisely because this script is hand-run on macOS
   * and never executes in CI or Cloud Build.
   */
  const staging = mkdtempSync(join(tmpdir(), 'emoji-'))
  execFileSync('unzip', ['-o', '-q', join(SRC, file), '-d', staging])
  const animDir = join(staging, 'animations')
  const anims = readdirSync(animDir).filter((f) => f.endsWith('.json'))
  if (anims.length !== 1) {
    console.error(`⛔ ${file}: expected exactly one animation, found ${anims.length}. Skipped.`)
    rmSync(staging, { recursive: true, force: true })
    continue
  }
  // Re-serialise without whitespace. The pack ships pretty-printed JSON; re-emitting it compact is
  // a free ~20% before the CDN's gzip even runs.
  const animation = JSON.parse(readFileSync(join(animDir, anims[0]), 'utf8'))
  const dest = join(OUT, `${slug}.json`)
  writeFileSync(dest, JSON.stringify(optimize(animation)))
  rmSync(staging, { recursive: true, force: true })

  bytes += statSync(dest).size
  copied.add(slug)
}

const missing = [...wanted].filter((s) => !copied.has(s))

console.log(`emoji pack → public/emoji: ${copied.size} animation(s), ${(bytes / 1024).toFixed(0)}KB total`)
if (unexpected.length) {
  console.log(`\n${unexpected.length} pack file(s) the catalogue does not name (not copied):`)
  for (const u of unexpected) console.log(`  · ${u}`)
}
if (missing.length) {
  console.error(`\n⛔ ${missing.length} catalogue entr(ies) have NO artwork in the pack:`)
  for (const m of missing) console.error(`  · ${m}`)
  console.error('\nEither add the file or remove the entry — a named-but-absent slug renders nothing.')
  process.exit(1)
}
