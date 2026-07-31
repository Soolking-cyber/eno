#!/usr/bin/env node
/**
 * Edition lint — keeps eno.vn (the licensed sàn TMĐT marketplace) from leaking the visa, itinerary
 * and PayPal surfaces that only eno.forum may serve. See the edition split in CLAUDE.md and the
 * mechanism in src/lib/edition.ts.
 *
 * ⚠️ REPORT-ONLY FOR NOW. It prints and exits 0. This is Phase 0: the first job of this script is to
 * MEASURE the scope of Phase 3 rather than have someone remember it. It becomes a build gate (exit 1,
 * wired into `npm run lint` and the head of `npm run build`, exactly like design-lint.mjs) at the end
 * of Phase 3, once every listed site is fixed — turning it on before then would just block every
 * build with work that has not been done yet.
 *
 * RULE A — unguarded listing/seller reads.
 *   Visa services are ORDINARY `Listing` rows and the trip desk shares the same `Seller`, so any
 *   query that returns listings will surface them on the licensed marketplace unless it excludes the
 *   desk. This is the leak that has nothing to do with the /visa pages, and it is the one most
 *   likely to be reintroduced: someone adds a rail next month with a perfectly ordinary
 *   `db.listing.findMany({ where: { status: 'active' } })` and the e-Visa SKUs are back in the feed.
 *   A path denylist cannot catch that. Requiring the shared predicate can.
 *
 * RULE B — services files must carry the `.svc.` extension.
 *   Next resolves special files as `${name}.${ext}`, and next.config.ts sets `pageExtensions` per
 *   edition, so a `page.svc.tsx` matches nothing on a marketplace build: never compiled, never
 *   prerendered into the image, never in the manifest, no client chunk. That is what makes the split
 *   default-deny — route 31 is excluded by where it lives and what it is called, not by a list
 *   anyone has to maintain. This rule is what stops the convention rotting.
 *
 * Escape hatch, same shape as design-lint: add an entry to ALLOW with a reason. An exemption then
 * shows up in a diff as a decision somebody made, rather than as an omission nobody noticed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SRC = join(ROOT, 'src')

/**
 * Reads that legitimately do NOT need the marketplace scope, each with the reason it is safe.
 * Keep this list short and specific; a growing allowlist means the rule is wrong or the code is.
 */
const ALLOW = new Map([
  ['src/lib/edition-scope.ts', 'defines the predicate itself'],
  ['src/lib/visa-shop.ts', 'resolves the desk — services-side by definition'],
  ['src/lib/trips/dm-thread.ts', 'resolves the trip desk — services-side by definition'],
])

/** Directories whose reads are services-only or operator-only and are never public marketplace feeds. */
const ALLOW_DIRS = [
  'src/app/api/visa/',
  'src/app/api/itineraries/',
  'src/app/api/trips/',
  'src/app/api/admin/',
  'src/app/admin/',
  'src/lib/visa/',
  'src/lib/trips/',
]

/**
 * The Prisma reads that can return listings to a user or a crawler.
 *
 * ⚠️ `tx.` AND `client.` ARE IN HERE because a read inside `db.$transaction(async (tx) => …)` is
 * every bit as public as one on `db`, and the first version of this pattern only matched `db.` —
 * caught by review. KNOWN GAP, stated rather than hidden: raw SQL (`$queryRaw`) and a client aliased
 * to some other local name still evade this. Rule A is a net, not a proof; the proof is the image
 * grep in the Docker build.
 */
const READ_RE = /\b(?:db|tx|client)\.(listing|seller)\.(findMany|findFirst|findUnique|count|groupBy|aggregate)\s*\(/g

/**
 * ⚠️ SEARCHED IN THE DECOMMENTED SOURCE, NOT THE RAW FILE. Searching `raw` meant a file could
 * silence this rule with a COMMENT that happened to mention the helper — including a comment saying
 * "this deliberately does not use marketplaceListingScope". Found by review; it made the rule
 * trivially and accidentally defeatable.
 */
const SCOPE_HINTS = ['marketplaceListingScope', 'scopedListingWhere', 'deskSellerIds']

/** The one-off escape hatch, which IS meant to be a comment — same shape as design-lint's. */
const INLINE_ALLOW = 'edition-lint-allow'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** Strip comments so a rule name mentioned in prose does not count as a guard (or a violation). */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = walk(SRC)
const unguarded = []
const badExt = []

for (const full of files) {
  const rel = relative(ROOT, full).split('\\').join('/')
  const raw = readFileSync(full, 'utf8')
  const src = decomment(raw)

  // RULE B — every Next special file in a services tree carries `.svc.`
  //
  // ⚠️ IT CHECKS KNOWN TREES, NOT A (services) ROUTE GROUP, because the group turned out to be the
  // wrong home. /dashboard/visa and /dashboard/trips inherit src/app/dashboard/layout.tsx, and Next
  // resolves layouts by FILESYSTEM nesting — relocating them under src/app/(services)/ would have
  // silently stripped the dashboard chrome from both. The `.svc.` extension is what actually gates
  // the route (next.config.ts sets pageExtensions per edition); the directory was only ever
  // organisational. So the files stay where they are and this rule guards the naming instead.
  if (SERVICES_TREES.some((t) => rel.startsWith(t))) {
    const base = rel.split('/').pop()
    if (/^(page|layout|route|loading|error|template|default|not-found)\.(ts|tsx)$/.test(base)) {
      badExt.push(rel)
    }
  }

  if (ALLOW.has(rel) || ALLOW_DIRS.some((d) => rel.startsWith(d))) continue

  /**
   * RULE A — listing/seller reads that outnumber the guards in the same file.
   *
   * File-level rather than line-local on purpose: predicates are composed far from the call
   * (feed-query.ts assembles its `where` across ~200 lines), so a line-local check would be all
   * false negatives. But "does the file mention the helper anywhere" was too weak — review pointed
   * out that ONE guarded query then excuses every other query in the file. Counting closes the
   * common case: five reads and one guard is now four reported, not zero.
   *
   * Still not a proof — two reads and two guard mentions passes even if they are not paired. The
   * inline `edition-lint-allow` comment is the escape hatch for a read that genuinely needs none.
   */
  READ_RE.lastIndex = 0
  const reads = [...src.matchAll(READ_RE)]
  const guards = SCOPE_HINTS.reduce((n, h) => n + src.split(h).length - 1, 0)
  const exempt = raw.split('\n').filter((l) => l.includes(INLINE_ALLOW)).length
  if (reads.length > guards + exempt) {
    const line = src.slice(0, reads[0].index).split('\n').length
    const extra = reads.length - guards - exempt
    unguarded.push(`${rel}:${line}${reads.length > 1 ? `  (${extra} of ${reads.length} reads unguarded)` : ''}`)
  }
}

// ⚠️ A closed pipe is not a lint failure. Once this runs inside `npm run lint`, anyone doing
// `npm run lint | head` closes stdout mid-write and an unhandled EPIPE exits non-zero — a red build
// caused by the reader, not by the code. Found exactly that way while writing this script.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0) })
const say = (s) => process.stdout.write(`${s}\n`)

if (!unguarded.length && !badExt.length) {
  say('edition-lint: clean')
} else {
  say('')
  say('edition-lint (REPORT ONLY — exits 0 until Phase 3 closes these)')
  if (unguarded.length) {
    say('')
    say(`  Rule A — ${unguarded.length} file(s) with listing/seller reads lacking the marketplace scope:`)
    say('  eno.vn must exclude the visa/trip desk from every one of these, or the e-Visa SKUs')
    say('  appear in its feed, its search, its sitemap and its Google/Meta product feeds.')
    say('')
    say('  Fix:  where: await scopedListingWhere({ ...your predicate })')
    say('  ⚠️ NOT by spreading marketplaceListingScope() beside your own sellerId — object spread')
    say('     overwrites on key collision and the exclusion is silently lost. That is why')
    say('     scopedListingWhere composes through AND. See src/lib/edition-scope.ts.')
    say('')
    for (const f of unguarded) say(`    ${f}`)
  }
  if (badExt.length) {
    say('')
    say(`  Rule B — ${badExt.length} services file(s) missing the .svc. extension:`)
    say('  A marketplace build compiles these, so the route ships in the licensed image.')
    say('')
    for (const f of badExt) say(`    ${f}`)
  }
  say('')
}
