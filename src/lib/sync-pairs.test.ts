import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Root ↔ forum SYNC-PAIR drift guard (audit highest-value #3): the two apps deploy
// independently but share Supabase rows, so a set of files is deliberately duplicated
// and MUST move in lockstep — this audit alone found two security fixes (OTP cooldown
// race, visa step-gate typo) that had to land in both copies, and one open redirect
// that existed only because a copy drifted. This test fails the ROOT build the moment
// a designated pair diverges.
//
// NOT a shared package on purpose: the deployment boundary stays (each Vercel build
// resolves only its own tree); the guard is the cheap alternative the audit chose.
//
// Documented exclusions (similar-but-different contracts, reviewed 2026-07-19):
//   · itinerary-data — eno.vn adds savedItineraryId; the forum keeps compact formatVnd
//     (eno.vn money goes through vnd.ts per the money canon).
//   · itinerary-docx — eno.vn adds the saved-itinerary export + shared shell builders.

const EXACT_PAIRS: Array<[string, string]> = [
  ['src/lib/ratelimit.ts', 'apps/forum/src/lib/ratelimit.ts'],
  ['src/lib/visa/mrz.ts', 'apps/forum/src/lib/visa/mrz.ts'],
  ['src/lib/visa/image-quality.ts', 'apps/forum/src/lib/visa/image-quality.ts'],
  ['src/lib/visa/image-normalization.ts', 'apps/forum/src/lib/visa/image-normalization.ts'],
  ['src/lib/visa/checkpoints.ts', 'apps/forum/src/lib/visa/checkpoints.ts'],
  ['src/lib/languages.ts', 'apps/forum/src/lib/languages.ts'],
  ['src/lib/itinerary-resources.ts', 'apps/forum/src/components/itinerary/itinerary-resources.ts'],
]

// Pairs whose ONLY sanctioned differences are comments and import specifiers
// (root uses relative-or-aliased forms for vitest resolvability; the forum aliases).
const NORMALIZED_PAIRS: Array<[string, string]> = [
  ['src/lib/visa/schema.ts', 'apps/forum/src/lib/visa/schema.ts'],
  ['src/lib/visa/crypto.ts', 'apps/forum/src/lib/visa/crypto.ts'],
]

function normalize(source: string): string {
  return source
    .split('\n')
    // strip whole-line comments (the interop/port annotations differ by design)
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\*/.test(line) && !/^\s*\/\*/.test(line))
    // unify import specifiers: './x' and '@/lib/visa/x' refer to the same module here
    .map((line) => line.replace(/from '(?:\.\/|@\/lib\/visa\/)([a-z-]+)'/g, "from '<visa>/$1'"))
    .filter((line) => line.trim() !== '')
    .join('\n')
}

describe('root/forum sync pairs', () => {
  for (const [a, b] of EXACT_PAIRS) {
    it(`${a} is byte-identical to its forum copy`, () => {
      expect(readFileSync(a, 'utf8')).toBe(readFileSync(b, 'utf8'))
    })
  }
  for (const [a, b] of NORMALIZED_PAIRS) {
    it(`${a} matches its forum copy modulo comments/import specifiers`, () => {
      expect(normalize(readFileSync(a, 'utf8'))).toBe(normalize(readFileSync(b, 'utf8')))
    })
  }
})
