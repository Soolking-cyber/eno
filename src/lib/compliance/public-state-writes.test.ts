import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * ⛔ EVERY WRITE THAT CAN PUT A LISTING IN FRONT OF THE PUBLIC IS ON THIS LIST, OR THIS TEST FAILS.
 *
 * A listing is public iff `verified = true AND status = 'active'`, and there is no central read-side
 * predicate — the feed, search, the sitemap, the product feeds and the PDP each filter for themselves.
 * So the seller identity gate (src/lib/compliance/seller-publish-gate.ts) sits on the WRITES, and it
 * is only as complete as the list of writes it was wired into. That list was built by hand in a
 * 2026-09-23 audit; this test is what keeps it true afterwards. A new file that writes
 * `verified: true` or `status: 'active'` into a Listing fails here until someone decides — and
 * records below — whether it must ask the gate (refuse or hold) or is outside it by design.
 *
 * The counts are EXACT, in both directions: one more write in an audited file is a new path to
 * audit, and one fewer means the list describes code that no longer exists.
 *
 * ── WHAT IT SEES ─────────────────────────────────────────────────────────────────────────────────
 *   · Prisma writes — `<x>.listing.create|createMany|update|updateMany|upsert(…)` and the
 *     `…AndReturn` forms of createMany/updateMany — whose ARGUMENTS contain `verified: true` or
 *     `status: 'active'`, with the read-shaped sub-objects (`where`,
 *     `select`, `include`, `orderBy`, `cursor`) blanked first. The argument list is brace-matched,
 *     so multi-line object literals and ternaries (`data: held ? {…} : { verified: true }`) count.
 *   · Raw SQL `UPDATE "Listing" … SET …` whose SET clause (up to WHERE/FROM/RETURNING) contains
 *     `verified = true` or `status = 'active'` — the SET only, so `WHERE status = 'active'` is a read.
 *   · Every raw `INSERT INTO "Listing" (` — its columns cannot be audited by a regex, so each insert
 *     is listed by name.
 *   · `data.status = 'active'` / `data.verified = true` — the build-the-payload-then-write shape.
 *   · The same shape by LITERAL: an object carrying both `verified: true` and `status: 'active'` (or
 *     an expression that can yield 'active') anywhere in a file that writes Listing rows — how the
 *     importers build `payload` and then `db.listing.update({ data: payload })`.
 *   · NESTED writes through a Seller: `seller.create|update|updateMany|upsert({ … listings: { … } })`
 *     with a public literal inside `listings`.
 *   · Raw SQL with a schema prefix (`public."Listing"`) as well as without.
 * And, in its own list (AUDITED_CLAIMS), every write that hands an existing STOREFRONT to an account
 * (`ownerId` set by seller.update/updateMany/upsert, or raw `UPDATE "Seller" SET "ownerId"`): a claim
 * re-parents every live listing on it, and the gate's first wiring found two of the three.
 *
 * ── WHAT IT CANNOT SEE (stated so nobody mistakes it for a proof) ────────────────────────────────
 *   · A value that is not a literal: `data: { status }` (setStatusCore's shorthand), a status read
 *     from input, a payload that sets only ONE of the two columns outside the call (`const p =
 *     { verified: true }` → `update({ data: p })`), or a payload spread in from another module.
 *     setStatusCore is gated in code.
 *   · A payload literal in a file with no RECOGNISED listing write (the write lives in a helper in
 *     another file); a nested write through any model other than Seller.
 *   · A claim whose `ownerId` is not in the call (`data: payload`), or one made by `create` with a
 *     nested `connect` — only the direct write of `ownerId` onto an existing Seller is seen.
 *   · Brace matching skips string contents but not `${…}` inside template literals, and the
 *     enclosing-object search walks raw braces — a `'{'` string beside a payload can mis-scope it.
 *   · A write through a raw client this scan does not recognise (a Prisma `$executeRawUnsafe` string
 *     assembled at runtime, a stored procedure, a trigger).
 *   · Files outside src/ and scripts/, and test files (fixtures are not a publish path).
 * It is a tripwire for the ordinary way a publish path gets added, not a proof that none exists.
 */

const ROOT = process.cwd()

/**
 * The audited writes. Every entry says which way it went: GATED (refuse / hold through the seller
 * identity gate), or OUTSIDE by design and why. Paths are repo-relative with forward slashes.
 */
const AUDITED: Record<string, { count: number; why: string }> = {
  // ── Gated ──
  'src/lib/core/listings.ts': { count: 2, why: 'createListingCore insert (assertSellerMayPublish, guests refused) + confirmCore revive (identityGateForRevive → refuse)' },
  'src/lib/core/bulk.ts': { count: 1, why: 'bulkImportCore insert — whole batch refused before the loop (sellerPublishDecision)' },
  'src/app/api/admin/listings/route.ts': { count: 4, why: 'admin activate/verify — partitionByIdentityGate, refused owners are HELD (identityHold)' },
  'src/app/api/admin/moderate/route.ts': { count: 1, why: 'moderation approve — partitionByIdentityGate, refused owner HELD' },
  'src/lib/enforcement.ts': { count: 2, why: 'restoreListings (lift/expiry) + applyEnforcement downgrade restore — refused owners HELD' },
  'src/lib/compliance/identity-holds.ts': { count: 1, why: 'releaseIdentityHolds — the gate’s own release, only after the owner is verified' },
  'scripts/publish-held.ts': { count: 2, why: 'bulk publish of held rows — refused owners PARKED unless --gate=off; + the post-park re-check release for owners verified mid-run' },
  'scripts/release-identity-holds.ts': { count: 1, why: 'manual release of identity holds after the gate is switched OFF; refuses while enforced' },
  // ── Outside the gate by design ──
  'src/app/api/cron/partner-stock/route.ts': { count: 1, why: 'restock of OWNERLESS partner storefronts only — no person to verify' },
  'src/lib/affiliate-price-refresh.ts': { count: 1, why: 'restore of OWNERLESS affiliate storefronts only — no person to verify' },
  'scripts/import-rever-rentals.ts': { count: 2, why: 'reference-listing importer onto a platform-owned (ownerless) seller' },
  'scripts/import-batdongsan-rentals.ts': { count: 2, why: 'reference-listing importer onto a platform-owned (ownerless) seller' },
  'scripts/import-nhatot-com.ts': { count: 4, why: 'reference-listing importer onto an ownerless platform seller — create-only status/verified (2) + the dry-run sample literal + the printed retire UNDO SQL; refuses an owned or badged seller' },
  'scripts/import-muaban-net.ts': { count: 3, why: 'reference-listing importer onto an ownerless platform seller — the upsert’s create-only status/verified (2) + the dry-run sample literal; refuses an owned or badged seller' },
  'scripts/muaban-net-map.ts': { count: 1, why: 'reference-listing importer onto an ownerless platform seller — retireRollbackSql, the printed undo of a retire pass, scoped to that seller’s rows still hidden' },
  'scripts/import-honeycomb-com-vn.ts': { count: 3, why: 'reference-listing importer onto an ownerless platform seller — create-only status/verified (2) + the dry-run sample literal; refuses an owned or badged seller' },
  'scripts/import-jobs.ts': { count: 3, why: 'reference-listing importer (linked job postings) onto ownerless per-board platform sellers — the create-only status/verified (2) + the dry-run sample literal; refuses an owned or badged seller (sellerRefusal)' },
  'scripts/hide-imageless-imports.ts': { count: 2, why: 'operator repair script over the platform import sellers' },
  'scripts/seed-visa-shop.mjs': { count: 4, why: 'services-edition desk seed (platform seller)' },
  'scripts/seed-trip-desk.mjs': { count: 2, why: 'services-edition trip desk seed (platform seller)' },
  'scripts/ci-fixtures.ts': { count: 4, why: 'CI fixture data on a disposable database (2 inline + 2 payload literals)' },
  'scripts/import-partners.ts': { count: 1, why: 'partner-catalogue importer — payload literal; refuses a storefront with an ownerId' },
  'scripts/import-supersports.ts': { count: 1, why: 'affiliate importer — payload literal; refuses a storefront with an ownerId' },
  'scripts/import-accesstrade.ts': { count: 1, why: 'affiliate importer — payload literal; refuses a storefront with an ownerId' },
  'scripts/seed-vinwonders.ts': { count: 1, why: 'partner storefront seed — payload literal; the seller stays ownerless (refuses an owned one)' },
  'scripts/e2e-seed.mjs': { count: 1, why: 'e2e fixture on a disposable target' },
  'scripts/test-account-delete.mjs': { count: 1, why: 'throwaway listing for the account-deletion test' },
}

/** Every write that hands an existing storefront to an account. All real ones go through the gate. */
const AUDITED_CLAIMS: Record<string, { count: number; why: string }> = {
  'src/lib/compliance/seller-publish-gate.ts': { count: 2, why: 'claimGuestStorefront — the ONE claim path (login auto-claim, post-time claim, business onboarding all call it); parks live listings in the claim transaction when the gate refuses the account' },
  'scripts/ci-fixtures.ts': { count: 2, why: 'CI fixture seller on a disposable database (the update and create halves of one upsert)' },
}

// ── The scanner ──────────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'generated' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

/** Blank comments (keeping offsets and newlines) so a file that TALKS about a write is not one. */
function stripComments(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      let j = i + 1
      while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++ }
      out += src.slice(i, j + 1)
      i = j
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i)
      const end = j < 0 ? src.length : j
      out += ' '.repeat(end - i)
      i = end - 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2)
      const end = j < 0 ? src.length : j + 2
      out += src.slice(i, end).replace(/[^\n]/g, ' ')
      i = end - 1
      continue
    }
    out += c
  }
  return out
}

/** Index of the bracket closing the one at `open`, skipping string contents; -1 if unbalanced. */
function matchBalanced(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack: string[] = []
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      i++
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ }
      continue
    }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1
      if (!stack.length) return i
    }
  }
  return -1
}

const PUBLIC_LITERAL = /\bverified\s*:\s*true\b|\bstatus\s*:\s*['"]active['"]/g
const READ_KEYS = /\b(where|select|include|orderBy|cursor)\s*:\s*\{/
/** `"Listing"`, `Listing`, `public."Listing"`, `"public"."Listing"` — a schema prefix is optional. */
const LISTING_TABLE = String.raw`(?:"?public"?\.)?"?Listing"?`
// ⚠️ THE `…AndReturn` FORMS ARE WRITES TOO. The admin batch parks with updateManyAndReturn (it needs
// the ids it actually changed), and without them in this list the scan would silently drop that
// write from its count — and miss any future publish written the same way.
const LISTING_WRITE_CALL = /\b\w+\.listing\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(/g

/** Blank every read-shaped sub-object (`where: {…}`, `select: {…}`, …) in place, offsets kept. */
function blankReads(text: string): string {
  let out = text
  let from = 0
  for (;;) {
    const re = new RegExp(READ_KEYS.source, 'g')
    re.lastIndex = from
    const r = re.exec(out)
    if (!r) break
    const o = r.index + r[0].length - 1
    const c = matchBalanced(out, o)
    if (c < 0) { from = o + 1; continue }
    out = out.slice(0, r.index) + ' '.repeat(c + 1 - r.index) + out.slice(c + 1)
    from = r.index
  }
  return out
}

/** Every `<x>.<model>.<method>(…)` call as [open, close, method], argument list brace-matched. */
function calls(src: string, re: RegExp): Array<{ open: number; close: number; method: string }> {
  const out: Array<{ open: number; close: number; method: string }> = []
  for (const m of src.matchAll(re)) {
    const open = m.index! + m[0].length - 1
    const close = matchBalanced(src, open)
    if (close >= 0) out.push({ open, close, method: m[1] })
  }
  return out
}

/** Index of the innermost `{` enclosing `at`, or -1. Comments are already blanked. */
function enclosingBrace(src: string, at: number): number {
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const c = src[i]
    if (c === '}') depth++
    else if (c === '{') { if (depth === 0) return i; depth-- }
  }
  return -1
}

export function publicStateWrites(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length

  // (1) Prisma listing writes with a public literal in their (non-read) arguments.
  const listingCalls = calls(src, LISTING_WRITE_CALL)
  for (const { open, close, method } of listingCalls) {
    const args = blankReads(src.slice(open, close + 1))
    for (const h of args.matchAll(PUBLIC_LITERAL)) hits.push(`${lineOf(open)}: listing.${method} ${h[0]}`)
  }
  // (2) NESTED writes through a Seller: `seller.update({ data: { listings: { updateMany: { data: { verified: true } } } } })`.
  for (const { open, close, method } of calls(src, /\b\w+\.seller\.(create|update|updateMany|upsert)\s*\(/g)) {
    const args = blankReads(src.slice(open, close + 1))
    for (const l of args.matchAll(/\blistings\s*:\s*\{/g)) {
      const o = l.index! + l[0].length - 1
      const c = matchBalanced(args, o)
      if (c < 0) continue
      for (const h of args.slice(o, c + 1).matchAll(PUBLIC_LITERAL)) hits.push(`${lineOf(open)}: seller.${method} → listings ${h[0]}`)
    }
  }
  // (3) Raw SQL — the SET clause only, so `WHERE status = 'active'` is a read.
  for (const m of src.matchAll(new RegExp(String.raw`UPDATE\s+${LISTING_TABLE}\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|\x60|;|$)`, 'gi'))) {
    for (const h of m[1].matchAll(/\bverified"?\s*=\s*true\b|\bstatus"?\s*=\s*'active'/gi)) hits.push(`${lineOf(m.index!)}: UPDATE "Listing" SET ${h[0]}`)
  }
  for (const m of src.matchAll(new RegExp(String.raw`INSERT\s+INTO\s+${LISTING_TABLE}\s*\(`, 'gi'))) hits.push(`${lineOf(m.index!)}: INSERT INTO "Listing"`)
  // (4) Build-the-payload-then-write, by assignment.
  for (const m of src.matchAll(/\bdata\.(?:verified\s*=\s*true\b|status\s*=\s*['"]active['"])/g)) hits.push(`${lineOf(m.index!)}: ${m[0]}`)
  // (5) Build-the-payload-then-write, by LITERAL: an object carrying BOTH `verified: true` AND
  //     `status: 'active'` outside any write call, in a file that writes Listing rows at all. This is
  //     how the importers do it (`const payload = { …, verified: true, status: 'active' }` →
  //     `db.listing.update({ data: payload })`). Read sub-objects are blanked first, and so are the
  //     arguments of the listing writes (1) already counted, so nothing is counted twice.
  const writesListings = listingCalls.length > 0 || new RegExp(String.raw`(?:UPDATE|INSERT\s+INTO)\s+${LISTING_TABLE}\b`, 'i').test(src)
  if (writesListings) {
    let rest = blankReads(src)
    for (const { open, close } of listingCalls) rest = rest.slice(0, open) + ' '.repeat(close + 1 - open) + rest.slice(close + 1)
    const seen = new Set<number>()
    for (const v of rest.matchAll(/\bverified\s*:\s*true\b/g)) {
      const o = enclosingBrace(rest, v.index!)
      if (o < 0 || seen.has(o)) continue
      const c = matchBalanced(rest, o)
      if (c < 0) continue
      // `status: 'active'`, or an expression that can yield it (`status: inStock ? 'active' : 'sold'`).
      if (/\bstatus\s*:[^,}\n]*['"]active['"]/.test(rest.slice(o, c + 1))) { seen.add(o); hits.push(`${lineOf(o)}: payload literal { verified: true, status: 'active' }`) }
    }
  }
  return hits
}

/**
 * Writes that hand a STOREFRONT to an account — `ownerId` set on an existing Seller. A claim
 * re-parents every live listing on it, so it is a transition into public state for that account
 * (owner decision 3, path h), and the first wiring of the identity gate missed one of three.
 * Seller creates are not claims (a new storefront has no listings) and are not counted.
 */
export function storefrontClaimWrites(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (const { open, close, method } of calls(src, /\b\w+\.seller\.(update|updateMany|upsert)\s*\(/g)) {
    const args = blankReads(src.slice(open, close + 1))
    // `ownerId: x` (never `ownerId: null` — that is a release) or the `{ …, ownerId }` shorthand.
    for (const h of args.matchAll(/\bownerId\s*:\s*(?!null\b)[\w.$!]|[{,]\s*ownerId\s*(?=[,}])/g)) hits.push(`${lineOf(open)}: seller.${method} ${h[0].replace(/\s+/g, ' ').trim()}`)
  }
  for (const m of src.matchAll(/UPDATE\s+(?:"?public"?\.)?"?Seller"?\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|\x60|;|$)/gi)) {
    if (/"?ownerId"?\s*=\s*(?!NULL\b)/i.test(m[1])) hits.push(`${lineOf(m.index!)}: UPDATE "Seller" SET "ownerId"`)
  }
  return hits
}

/**
 * Writes that PUBLISH AN EXISTING ROW (`verified: true` in an update) without also clearing
 * `identityHold` in the same object — or a raw `UPDATE "Listing" SET verified = true` without
 * `"identityHold" = false`.
 *
 * ⛔ WHY THIS IS THE WHOLE INVARIANT, NOT A STYLE RULE: every write that PARKS a row (sets
 * identityHold=true) also sets or guards `verified = false`, so a parked row is never public. The one
 * way a row could end up LIVE AND HELD is a later `verified: true` that leaves the column alone — and
 * a live row carrying identityHold=true is one a takedown that forgets the column would leave for
 * releaseIdentityHolds() to republish. Status-only writes (relist, confirm, sync revive, admin
 * activate) are deliberately NOT required to clear it: they never touch `verified`, so they can only
 * make an already-verified row public, which this invariant keeps hold-free — and clearing the
 * column on them would DISCARD a parked approval on a row that is still verified=false.
 *
 * Creates are not checked (a new row's identityHold defaults to false), nor is an upsert's `create`.
 */
export function publishesKeepingHold(source: string): string[] {
  const src = stripComments(source)
  const hits: string[] = []
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (const { open, close, method } of calls(src, /\b\w+\.listing\.(update|updateMany|updateManyAndReturn|upsert)\s*\(/g)) {
    let args = blankReads(src.slice(open, close + 1))
    // An upsert's `create` inserts a fresh row — outside this rule, as every create is.
    for (const c of args.matchAll(/\bcreate\s*:\s*\{/g)) {
      const o = c.index! + c[0].length - 1
      const e = matchBalanced(args, o)
      if (e > 0) args = args.slice(0, c.index!) + ' '.repeat(e + 1 - c.index!) + args.slice(e + 1)
    }
    for (const v of args.matchAll(/\bverified\s*:\s*true\b/g)) {
      const o = enclosingBrace(args, v.index!)
      const c = o < 0 ? -1 : matchBalanced(args, o)
      const obj = c < 0 ? args : args.slice(o, c + 1)
      if (!/\bidentityHold\s*:\s*false\b/.test(obj)) hits.push(`${lineOf(open)}: listing.${method} verified: true without identityHold: false`)
    }
  }
  for (const m of src.matchAll(new RegExp(String.raw`UPDATE\s+${LISTING_TABLE}\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|\x60|;|$)`, 'gi'))) {
    if (/\bverified"?\s*=\s*true\b/i.test(m[1]) && !/"?identityHold"?\s*=\s*false\b/i.test(m[1])) hits.push(`${lineOf(m.index!)}: UPDATE "Listing" SET verified = true without "identityHold" = false`)
  }
  return hits
}

function scanRepo(): Map<string, string[]> {
  const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]
  const found = new Map<string, string[]>()
  for (const f of files) {
    const hits = publicStateWrites(readFileSync(f, 'utf8'))
    if (hits.length) found.set(relative(ROOT, f).split(sep).join('/'), hits)
  }
  return found
}

describe('writes that put a Listing into public state', () => {
  it('⛔ EVERY ONE IS AUDITED — a new publish path must be wired to the identity gate or listed as outside it', () => {
    const found = scanRepo()
    const unaudited = [...found.entries()].filter(([f]) => !AUDITED[f]).map(([f, h]) => `${f}\n    ${h.join('\n    ')}`)
    expect(unaudited, `New write(s) into public listing state. Route them through src/lib/compliance/seller-publish-gate.ts (seller acts REFUSE, admin/system acts HOLD), then add the file to AUDITED with the reason:\n  ${unaudited.join('\n  ')}`).toEqual([])
  })

  it('the audited counts are exact — one more write is a new path, one fewer is a stale entry', () => {
    const found = scanRepo()
    const drift = Object.entries(AUDITED)
      .map(([f, a]) => ({ f, expected: a.count, actual: found.get(f)?.length ?? 0, hits: found.get(f) ?? [] }))
      .filter((d) => d.expected !== d.actual)
      .map((d) => `${d.f}: expected ${d.expected}, found ${d.actual}\n    ${d.hits.join('\n    ')}`)
    expect(drift, `Audited write counts drifted:\n  ${drift.join('\n  ')}`).toEqual([])
  })
})

describe('a publish of an existing row clears identityHold in the same write', () => {
  it('⛔ no update sets `verified: true` and leaves identityHold alone — a live row must never carry a hold', () => {
    const bad: string[] = []
    for (const f of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]) {
      const hits = publishesKeepingHold(readFileSync(f, 'utf8'))
      if (hits.length) bad.push(`${relative(ROOT, f).split(sep).join('/')}\n    ${hits.join('\n    ')}`)
    }
    expect(bad, `A write publishes an existing listing without clearing identityHold. Add \`identityHold: false\` (raw SQL: \`"identityHold" = false\`) to the same data object:\n  ${bad.join('\n  ')}`).toEqual([])
  })
})

describe('writes that hand a storefront to an account (claims)', () => {
  function scanClaims(): Map<string, string[]> {
    const found = new Map<string, string[]>()
    for (const f of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]) {
      const hits = storefrontClaimWrites(readFileSync(f, 'utf8'))
      if (hits.length) found.set(relative(ROOT, f).split(sep).join('/'), hits)
    }
    return found
  }
  it('⛔ EVERY CLAIM GOES THROUGH claimGuestStorefront — or is listed here with the reason', () => {
    const found = scanClaims()
    const bad = [
      ...[...found.entries()].filter(([f]) => !AUDITED_CLAIMS[f]).map(([f, h]) => `${f} (unaudited)\n    ${h.join('\n    ')}`),
      ...Object.entries(AUDITED_CLAIMS).filter(([f, a]) => (found.get(f)?.length ?? 0) !== a.count)
        .map(([f, a]) => `${f}: expected ${a.count}, found ${found.get(f)?.length ?? 0}\n    ${(found.get(f) ?? []).join('\n    ')}`),
    ]
    expect(bad, `Storefront claim writes drifted. A claim re-parents live listings: call claimGuestStorefront (src/lib/compliance/seller-publish-gate.ts) instead, or list the file with the reason:\n  ${bad.join('\n  ')}`).toEqual([])
  })
})

describe('the scanner itself — so a refactor of it cannot quietly make it blind', () => {
  it('sees a multi-line Prisma data literal', () => {
    expect(publicStateWrites(`await db.listing.update({\n  where: { id },\n  data: {\n    title,\n    verified: true,\n  },\n})`)).toHaveLength(1)
  })
  it('sees the …AndReturn write forms', () => {
    expect(publicStateWrites(`db.listing.updateManyAndReturn({ where: { id: { in: ids } }, data: { verified: true }, select: { id: true } })`)).toHaveLength(1)
    expect(publicStateWrites(`tx.listing.createManyAndReturn({ data: [{ title, status: 'active' }] })`)).toHaveLength(1)
    // The returned projection is a read, not a publish.
    expect(publicStateWrites(`db.listing.updateManyAndReturn({ where: { id }, data: { identityHold: true }, select: { verified: true } })`)).toEqual([])
  })
  it('sees a ternary payload and a transaction client', () => {
    expect(publicStateWrites(`tx.listing.update({ where: { id }, data: held ? { identityHold: true } : { verified: true } })`)).toHaveLength(1)
  })
  it('ignores filters and projections — a READ is not a publish', () => {
    expect(publicStateWrites(`db.listing.updateMany({ where: { verified: true, status: 'active' }, data: { verified: false } })`)).toEqual([])
    expect(publicStateWrites(`db.listing.findMany({ where: { verified: true, status: 'active' } })`)).toEqual([])
    expect(publicStateWrites(`db.listing.update({ where: { id }, data: { title }, select: { verified: true } })`)).toEqual([])
  })
  it('reads raw SQL SET clauses but not WHERE clauses', () => {
    expect(publicStateWrites('UPDATE "Listing" SET verified = true WHERE id = ANY($1)')).toHaveLength(1)
    expect(publicStateWrites(`UPDATE "Listing" SET status = 'sold' WHERE status = 'active'`)).toEqual([])
    expect(publicStateWrites(`c.query(\`UPDATE "Listing" SET status = 'active', "updatedAt" = now() WHERE id = $1\`)`)).toHaveLength(1)
  })
  it('does not count a write that only appears in a comment', () => {
    expect(publicStateWrites(`// db.listing.update({ data: { verified: true } })\n/* UPDATE "Listing" SET verified = true */`)).toEqual([])
  })
  it('sees a payload literal built beside the write, including a ternary status', () => {
    expect(publicStateWrites(`const payload = { title, verified: true, status: 'active' }\nawait db.listing.update({ where: { id }, data: payload })`)).toHaveLength(1)
    expect(publicStateWrites(`const f = { verified: true, status: inStock ? 'active' : 'sold' }\nawait db.listing.upsert({ where: { id }, update: f, create: f })`)).toHaveLength(1)
    // …but not a read predicate, and not in a file that never writes a listing.
    expect(publicStateWrites(`const rows = await db.listing.findMany({ where: { verified: true, status: 'active' } })\nawait db.listing.update({ where: { id }, data: { title } })`)).toEqual([])
    expect(publicStateWrites(`const PUBLIC = { verified: true, status: 'active' }`)).toEqual([])
  })
  it('sees a nested write through a Seller and a schema-qualified UPDATE', () => {
    expect(publicStateWrites(`db.seller.update({ where: { id }, data: { listings: { updateMany: { where: {}, data: { verified: true } } } } })`)).toHaveLength(1)
    expect(publicStateWrites('UPDATE public."Listing" SET verified = true WHERE id = $1')).toHaveLength(1)
    expect(publicStateWrites('UPDATE "public"."Listing" SET status = \'active\' WHERE id = $1')).toHaveLength(1)
  })
  it('sees a storefront claim, in literal, shorthand and raw-SQL form — but not a release or a filter', () => {
    expect(storefrontClaimWrites(`db.seller.updateMany({ where: { id, ownerId: null }, data: { ownerId: profile.id, claimedAt } })`)).toHaveLength(1)
    expect(storefrontClaimWrites(`db.seller.upsert({ where: { id }, update: { name, ownerId }, create: { id, name } })`)).toHaveLength(1)
    expect(storefrontClaimWrites('UPDATE "Seller" SET "ownerId" = $1 WHERE id = $2')).toHaveLength(1)
    expect(storefrontClaimWrites(`db.seller.updateMany({ where: { ownerId: me }, data: { ownerId: null } })`)).toEqual([])
    expect(storefrontClaimWrites(`db.seller.updateMany({ where: { ownerId: me }, data: { trustScore: 1 } })`)).toEqual([])
  })
  it('flags a publish of an existing row that keeps identityHold — and nothing else', () => {
    expect(publishesKeepingHold(`db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: true } })`)).toHaveLength(1)
    expect(publishesKeepingHold(`tx.listing.update({ where: { id }, data: held ? { verified: false, identityHold: true } : { verified: true } })`)).toHaveLength(1)
    expect(publishesKeepingHold('UPDATE "Listing" SET verified = true WHERE id = ANY($1)')).toHaveLength(1)
    expect(publishesKeepingHold(`db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: true, identityHold: false } })`)).toEqual([])
    expect(publishesKeepingHold(`tx.listing.update({ where: { id }, data: held ? { verified: false, identityHold: true } : { verified: true, identityHold: false } })`)).toEqual([])
    expect(publishesKeepingHold('UPDATE "Listing" SET verified = true, "identityHold" = false WHERE "identityHold"')).toEqual([])
    // Reads, creates and status-only writes are outside it.
    expect(publishesKeepingHold(`db.listing.updateMany({ where: { verified: true }, data: { status: 'active' } })`)).toEqual([])
    expect(publishesKeepingHold(`db.listing.create({ data: { verified: true } })`)).toEqual([])
    expect(publishesKeepingHold(`db.listing.upsert({ where: { id }, create: { verified: true }, update: { title } })`)).toEqual([])
  })
  it('flags every raw INSERT and the build-then-write assignment', () => {
    expect(publicStateWrites('INSERT INTO "Listing" (id, title) VALUES ($1, $2)')).toHaveLength(1)
    expect(publicStateWrites(`if (x) { data.status = 'active' }`)).toHaveLength(1)
  })
})
