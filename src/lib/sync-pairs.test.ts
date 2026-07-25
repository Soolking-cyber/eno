import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Root ↔ forum SYNC-PAIR drift guard (audit highest-value #3): the two apps deploy
// independently but share Supabase rows, so a set of files is deliberately duplicated
// and MUST move in lockstep — this audit alone found two security fixes (OTP cooldown
// race, visa step-gate typo) that had to land in both copies, and one open redirect
// that existed only because a copy drifted. This test fails the ROOT build the moment
// a designated pair diverges.
//
// THE ROOT IS THE SOURCE OF TRUTH, and moving a pair is a GENERATED step, not a manual
// one: edit the file under src/, then run `node scripts/sync-visa-pairs.mjs --write` to
// regenerate the forum copies from the root ones. That script's `--check` mode (its
// default, also `npm run sync:visa`) makes exactly the comparison this test makes, so it
// is also the pre-commit / CI-shaped way to see the drift with a unified diff, and it has
// its own tests: `node --test scripts/sync-visa-pairs.test.mjs`. Hand-editing
// apps/forum/src/lib/visa/* is now a mistake: EXACT pairs are copied byte-for-byte, and a
// NORMALIZED copy is a "GENERATED FROM …" banner followed by the root file VERBATIM with
// only './x' → '@/lib/visa/x' rewritten — the generator removes NOTHING (an earlier
// version stripped the root's leading comment block, which silently deleted code sharing
// a line with it, invisibly to the normalize() below; never reintroduce that) — so a
// hand-edit on the forum side is either silently clobbered on the next --write, or, worse,
// survives as a payload field that is out of lockstep. Why that is dangerous rather than
// untidy: visaPayloadSchema is z.object(), NOT .strict(), so zod SILENTLY STRIPS unknown
// keys, and both apps decrypt and re-encrypt the SAME visa_applications rows — a forum
// copy that has not moved deletes the new field from the ciphertext on the next admin
// edit. Undetectable data loss on encrypted passport PII.
// The generator's pair table is a verbatim copy of the two arrays below; add or retire a
// pair in BOTH places, and never resolve a failure here by deleting a pair.
//
// NOT a shared package on purpose: the deployment boundary stays (each Vercel build
// resolves only its own tree); the guard is the cheap alternative the audit chose.
//
// Documented exclusions (similar-but-different contracts, reviewed 2026-07-19):
//   · itinerary-data — eno.vn adds savedItineraryId; the forum keeps compact formatVnd
//     (eno.vn money goes through vnd.ts per the money canon).
//   · itinerary-docx — eno.vn adds the saved-itinerary export + shared shell builders.
//   · ratelimit — since the Upstash→Postgres migration (2026-07-20) the ATOMIC
//     semantics live in ONE place (the SQL functions rl_check / rl_cooldown_claim /
//     kv_*, scripts/rate-limit-pg.mjs) — which is exactly the drift this pair was
//     guarding against (the OTP cooldown race had to land in both copies). What
//     remains duplicated is only the thin client, and those are structurally
//     different by design: root goes through Prisma raw SQL, the forum through
//     supabase-js RPC. The contract test below keeps their shared surface aligned.

const EXACT_PAIRS: Array<[string, string]> = [
  ['src/lib/visa/mrz.ts', 'apps/forum/src/lib/visa/mrz.ts'],
  ['src/lib/visa/image-quality.ts', 'apps/forum/src/lib/visa/image-quality.ts'],
  ['src/lib/visa/image-normalization.ts', 'apps/forum/src/lib/visa/image-normalization.ts'],
  ['src/lib/visa/checkpoints.ts', 'apps/forum/src/lib/visa/checkpoints.ts'],
  ['src/lib/languages.ts', 'apps/forum/src/lib/languages.ts'],
  // itinerary-resources: pair RETIRED 2026-07-25. The forum's copy was deleted when the trip
  // service moved to eno.vn, so there is nothing left to byte-couple. src/lib/itinerary-resources.ts
  // is now a single-owner file and may be edited directly — no more `sync-visa-pairs --write`.
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

  it('ratelimit clients share the SQL primitives, window table, and strict stance', () => {
    const root = readFileSync('src/lib/ratelimit.ts', 'utf8')
    const forum = readFileSync('apps/forum/src/lib/ratelimit.ts', 'utf8')
    for (const src of [root, forum]) {
      // same fixed-window unit table → identical window math on both apps
      expect(src).toContain('{ s: 1, m: 60, h: 3600, d: 86400 }')
      // both ride the SAME server-side atomic primitives
      expect(src).toContain('rl_check')
      expect(src).toContain('kv_incrby')
      // fail-open default / fail-closed strict — the security stance must never drift
      expect(src).toContain('return { success: !opts?.strict, remaining: 0 }')
    }
  })
})
