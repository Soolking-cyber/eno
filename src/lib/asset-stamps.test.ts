import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/**
 * ⛔ THE GUARD FOR THE HAND-MAINTAINED `?v=` STAMPS. THIS TEST IS THE ONLY THING ENFORCING THEM.
 *
 * `next.config.ts` serves `/logo-mark.svg`, `/logo-dotvn.svg`, `/watermark.svg`,
 * `/vietkite-logo.png`, `/mascots/*` and `/banners/*` with `max-age=31536000, immutable` — a
 * one-year browser TTL. That is only safe because every reference carries a content stamp in its
 * query, so changed bytes are a changed cache key. The stamps for logo-mark and the mascots are
 * NOT generated: they are literals a human types, duplicated across five files.
 *
 * The failure mode is silent and lasts a YEAR, and no other gate can see it. Redraw
 * `public/logo-mark.svg`, bump three of the five call sites, and `tsc`, `design-lint`,
 * `edition-lint` and all ~4050 other tests stay green while the fourth call site pins the old mark
 * in every returning visitor's browser until 2027. **A Cloudflare purge cannot reach a browser
 * cache**, so there is no recovery short of changing the URL again.
 *
 * ⚠️ THE HASHES ARE RECOMPUTED FROM THE FILES ON DISK, NOT ASSERTED AGAINST A CONSTANT. A test
 * that hardcoded the expected hash would need the same manual bump it exists to police, and would
 * therefore fail in exactly the same way.
 */

const stamp = (buf: Buffer) => createHash('sha256').update(buf).digest('hex').slice(0, 8)

/** Every `<path>?v=<stamp>` occurrence in the app's own source and its served static JS. */
function stampsFor(assetPath: string): Array<{ file: string; stamp: string }> {
  // `git grep -n` keeps this to tracked files and skips node_modules/.next without a walker.
  let out = ''
  try {
    out = execFileSync('git', ['grep', '-n', '--fixed-strings', `${assetPath}?v=`, '--', 'src', 'public'], {
      encoding: 'utf8',
    })
  } catch {
    out = '' // git grep exits 1 when there are no matches
  }
  const hits: Array<{ file: string; stamp: string }> = []
  for (const line of out.split('\n').filter(Boolean)) {
    const file = line.slice(0, line.indexOf(':'))
    for (const m of line.matchAll(new RegExp(`${assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=([0-9a-f]{8})`, 'g'))) {
      hits.push({ file, stamp: m[1] })
    }
  }
  return hits
}

describe('content stamps on immutable static assets', () => {
  it('/logo-mark.svg — every reference carries the CURRENT hash of the file', () => {
    const expected = stamp(readFileSync('public/logo-mark.svg'))
    const hits = stampsFor('/logo-mark.svg')

    // If this drops to zero, someone removed the stamps and re-armed the year-long trap.
    expect(hits.length).toBeGreaterThanOrEqual(5)

    const wrong = hits.filter(h => h.stamp !== expected)
    expect(
      wrong,
      `public/logo-mark.svg now hashes to ${expected}. Bump the stamp in: ${wrong.map(w => w.file).join(', ')}`,
    ).toEqual([])
  })

  it('/mascots/*.svg — MASCOTS_V matches the concatenated hash of all nine files', () => {
    // ⚠️ MUST match the recipe written into mascot.tsx's comment EXACTLY:
    //   cat public/mascots/*.svg | shasum -a 256 | cut -c1-8
    // The shell glob expands in sorted order, so sort here too — a different order is a different
    // hash and this test would then demand a stamp the documented command never produces.
    const files = readdirSync('public/mascots').filter(f => f.endsWith('.svg')).sort()
    expect(files.length).toBeGreaterThan(0)
    const expected = stamp(Buffer.concat(files.map(f => readFileSync(`public/mascots/${f}`))))

    const src = readFileSync('src/components/marketplace/mascot.tsx', 'utf8')
    const declared = /const MASCOTS_V = '([0-9a-f]{8})'/.exec(src)?.[1]
    expect(declared, 'MASCOTS_V literal not found in mascot.tsx').toBeTruthy()
    expect(
      declared,
      `public/mascots/*.svg now hash to ${expected}; bump MASCOTS_V in src/components/marketplace/mascot.tsx`,
    ).toBe(expected)
  })

  it('the service worker stamps its notification icon like the in-app call sites do', () => {
    // sw.js is plain JS in public/ — it is served to browsers but no bundler touches it, so it is
    // the reference most likely to be forgotten. It was, once: the four TSX call sites were
    // stamped and this one was not, which would have pinned the old mark in every push
    // notification for up to Cloudflare's 4h browser floor after a redraw.
    const sw = readFileSync('public/sw.js', 'utf8')
    expect(sw).toMatch(/icon: '\/logo-mark\.svg\?v=[0-9a-f]{8}'/)
    expect(sw).toMatch(/badge: '\/logo-mark\.svg\?v=[0-9a-f]{8}'/)
  })
})
