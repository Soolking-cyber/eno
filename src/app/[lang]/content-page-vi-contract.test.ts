import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VI_OVERRIDES } from '../../generated/vi-overrides'

/**
 * ⛔ A CONTENT-PAGE HEADING IS VIETNAMESE IN THE VIETNAMESE SERVER HTML — OR IT IS ON THE LIST BELOW.
 *
 * ContentPage/ContentSection take their headings as STRING PROPS and render them as `<Tr text={title}>`.
 * scripts/gen-ui-strings.mjs harvests only literals (`<Tr text="…">`, `tr('…')`), so a heading passed as
 * `title="What the colors mean"` never reached the curated dictionary: the `vi` render shipped it in
 * English and the client machine-translated it after hydration (L-CONTENT-VI, measured 2026-09-29: /trust
 * 0 of 6 headings Vietnamese, /safety 1 of 5, /about 3 of 6).
 *
 * The fix is AUTHORED Vietnamese at the call site (`titleVi` / `labelVi`, rendered through <Bilingual>) —
 * NOT a wider harvester: about/page.tsx's rule 1 explains why a literal in that file must never reach the
 * catalogue eno.vn ships (the services-edition vocabulary would travel with it).
 *
 * This is a RATCHET. A literal heading or rail label passes when it carries its own Vietnamese, when the
 * curated dictionary already has it (an identical literal elsewhere put it there), or when it is on
 * KNOWN_ENGLISH_ONLY with a reason. That list may only shrink: a new English-only heading fails here.
 */
const FOLLOW_ON = 'follow-on: same fix, Vietnamese not yet written/approved (copy review) — add titleVi/labelVi and delete this line'
const SERVICES_ONLY = 'services edition only (IS_SERVICES branch): about/page.tsx rule 1 — its wording stays exactly as is'
const KNOWN_ENGLISH_ONLY = new Map<string, string>([
  // /about — the IS_SERVICES branch (the marketplace branch carries titleVi/labelVi).
  ['Who provides the services listed here', SERVICES_ONLY],
  ['eno.vn — for once you are here', SERVICES_ONLY],
  ['What eno.forum is', SERVICES_ONLY],
  ['Who provides the services', SERVICES_ONLY],
  ['The eno.vn marketplace', SERVICES_ONLY],
  ['How the two sites relate', SERVICES_ONLY],
  ['Who runs this site', SERVICES_ONLY],
  // /itinerary (eno.forum only).
  ['Plan a Vietnam trip, day by day', SERVICES_ONLY],
  ['Every stop on a map', SERVICES_ONLY],
  ['Want us to arrange it?', SERVICES_ONLY],
  // /regulations — the h1 is already both languages, by design (the page renders Vietnamese first).
  ['Quy chế hoạt động (Operating Regulations)', 'already bilingual: the document is published in Vietnamese and English together'],
  // /account-deletion
  ['Delete your account', FOLLOW_ON],
  ['Where to write', FOLLOW_ON],
  // /contact
  ['Who operates this site', FOLLOW_ON],
  ['Reporting a problem', FOLLOW_ON],
  ['Privacy and your data', FOLLOW_ON],
  // /guide
  ['How eno.vn works', FOLLOW_ON],
  ['For buyers', FOLLOW_ON],
  ['For sellers', FOLLOW_ON],
  ['Features & how they work', FOLLOW_ON],
  ['Features', FOLLOW_ON],
  // /partners
  ['Official partners', FOLLOW_ON],
  ['What the badge means', FOLLOW_ON],
  ['How a partner is chosen', FOLLOW_ON],
  ['What eno checks before the badge exists', FOLLOW_ON],
  ['What eno checks', FOLLOW_ON],
  ['Keeping the badge', FOLLOW_ON],
  ["eno's position, stated plainly", FOLLOW_ON],
  ["eno's position", FOLLOW_ON],
  // /prohibited
  ['Prohibited items & services', FOLLOW_ON],
  ['Enforcement', FOLLOW_ON],
  ['Illegal — never allowed', FOLLOW_ON],
  ['Regulated — cannot be sold P2P', FOLLOW_ON],
  ['Platform policy bans', FOLLOW_ON],
  ['Banned services', FOLLOW_ON],
])

const ROOT = 'src/app/[lang]'

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) yield p
  }
}

// Comments may quote a heading to explain it; only code counts.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1')

type Finding = { file: string; text: string }

function scan(): { checked: number; missing: Finding[] } {
  const missing: Finding[] = []
  let checked = 0
  for (const file of files(ROOT)) {
    const raw = readFileSync(file, 'utf8')
    if (!/<Content(Page|Section)\b/.test(raw)) continue
    const src = stripComments(raw)
    // Headings: a literal `title="…"` on a ContentPage/ContentSection element, and whether that same
    // element carries a `titleVi`.
    for (const m of src.matchAll(/<Content(?:Page|Section)\b([^>]*)>/g)) {
      const attrs = m[1]
      const t = attrs.match(/\btitle="([^"]+)"/)
      if (!t) continue
      checked++
      if (/\btitleVi=/.test(attrs) || VI_OVERRIDES[t[1]] != null) continue
      missing.push({ file, text: t[1] })
    }
    // Rail entries: `{ id: '…', label: '…' }`, and whether the entry carries a `labelVi`.
    for (const m of src.matchAll(/\{\s*id:\s*'[^']+',\s*label:\s*(['"])(.*?)\1\s*(,\s*labelVi:[^}]+)?\}/g)) {
      checked++
      if (m[3] || VI_OVERRIDES[m[2]] != null) continue
      missing.push({ file, text: m[2] })
    }
  }
  return { checked, missing }
}

describe('content-page headings carry Vietnamese', () => {
  const { checked, missing } = scan()

  it('finds the headings (the scan is not vacuous)', () => {
    expect(checked).toBeGreaterThan(40)
  })

  it('every literal heading and rail label has Vietnamese, or a reason it does not', () => {
    const unexplained = missing.filter((f) => !KNOWN_ENGLISH_ONLY.has(f.text)).map((f) => `${f.file}: ${f.text}`)
    expect(unexplained).toEqual([])
  })

  it('KNOWN_ENGLISH_ONLY only shrinks — every entry is still a real English-only heading', () => {
    const stillMissing = new Set(missing.map((f) => f.text))
    const stale = [...KNOWN_ENGLISH_ONLY.keys()].filter((text) => !stillMissing.has(text))
    expect(stale).toEqual([])
  })
})
