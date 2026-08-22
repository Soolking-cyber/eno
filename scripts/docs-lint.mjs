#!/usr/bin/env node
/**
 * FAILS WHEN A DOC MAKES AN INFRASTRUCTURE CLAIM THE REPOSITORY CONTRADICTS.
 *
 * ⚠️ WHY THIS EXISTS. Audited 2026-08-05: `docs/ARCHITECTURE.md` — the file whose own first line
 * says "Start here" — described hosting on **Vercel** (38 mentions, including a `vercel.json` cron
 * config) and rate limiting on **Upstash Redis** (15 mentions). Neither had existed since July
 * 2026: there is no `vercel.json` in the repo and `upstash` appears zero times in `package.json`.
 * Worse, `docs/README.md` taught `prisma db push` as the canonical schema-change flow, which on
 * this database emits 18 `DROP TABLE` statements including live applicant PII.
 *
 * Nobody was careless. The docs are GENERATED (see README → Conventions), and the generator simply
 * had not been re-run since the platform moved — so its output quietly outlived its subject. That
 * is a mechanical failure, and this is a mechanical check for it. A human found this class once, by
 * accident, while looking for something else; that is not a strategy.
 *
 * ⚠️ IT CHECKS CLAIMS, NOT MENTIONS. "Upstash was retired on 2026-07-20" is a true and useful
 * sentence, and a linter that banned the word would push people into deleting the history that
 * explains the current design. So each rule pairs a CLAIM PATTERN with a REALITY PROBE — a file
 * that must exist, or a dependency that must be installed — and only fires when the doc asserts
 * something the repository can be asked about directly.
 *
 * Adding a rule: prefer a probe over a wordlist. If you cannot express "the repo would prove this
 * wrong", the claim probably belongs in a review rather than in a linter.
 *
 * Escape hatch: put `<!-- docs-lint-allow: why -->` above the passage. It covers the whole
 * following BLOCK — every line until the next blank line — not just the next line, because markdown
 * prose is written as multi-line paragraphs, blockquotes and bullets, and a per-line marker would
 * mean sprinkling five comments through one warning. Fenced code blocks are skipped entirely.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => { try { return readFileSync(join(ROOT, p), 'utf8') } catch { return '' } }
const pkg = read('package.json')

/** A dependency is "installed" if package.json names it at all (either dep block). */
const hasDep = (name) => new RegExp(`"${name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}[^"]*"\\s*:`).test(pkg)

const RULES = [
  {
    id: 'vercel-json',
    // The config FILE, claimed as live configuration.
    claim: /\bvercel\.json\b/i,
    ok: () => existsSync(join(ROOT, 'vercel.json')),
    why: 'names vercel.json as live configuration, but no vercel.json exists. This project deploys to the VN box via infra/vn-node/eno-deploy.sh (Cloud Build removed 2026-08-22).',
  },
  {
    id: 'vercel-hosting',
    /**
     * ⚠️ ANY MENTION, NOT JUST AN OBVIOUS HOSTING CLAIM — and the first version got this wrong.
     * It matched only phrases like "deployed on Vercel" plus a short list of product names, went
     * green, and left behind a SECTION HEADING reading "Deploy (git push `main` → Vercel)", an env
     * note saying "Vercel env values must be uploaded manually", and a claim that "the Vercel build
     * also enforces types". A reviewer caught it. A narrow linter that passes is worse than no
     * linter, because it certifies the thing it failed to read.
     *
     * Vercel is simply not part of this system any more, so the burden is on the mention: say it is
     * historical in the same sentence, or mark the block. Same shape as the Upstash rule.
     */
    claim: /\bvercel\b(?![^.\n]*\b(?:retired|removed|replaced|legacy|former|historical|was|were|used to)\b)/i,
    ok: () => existsSync(join(ROOT, 'vercel.json')) || /"vercel"\s*:/.test(pkg),
    why: 'mentions Vercel as current. The app ran on Cloud Run from 2026-07 and moved to the VN origin box on 2026-08-21. If describing history, say so in the same sentence or use a docs-lint-allow marker.',
  },
  {
    id: 'upstash-ratelimit',
    claim: /\bUpstash\b(?![^.\n]*\b(?:retired|removed|replaced|legacy|former|historical|was)\b)/i,
    ok: () => hasDep('@upstash/redis') || hasDep('@upstash/ratelimit'),
    // The lookahead accepts any explicit past-tense marker on the same sentence — "retired",
    // "removed", "replaced", "legacy", "former", "historical", "was". The point is to allow true
    // history while catching a sentence that still presents Upstash as the CURRENT limiter.
    why: 'refers to Upstash without marking it past, but no @upstash/* dependency is installed. The limiter is Postgres — src/lib/ratelimit.ts. If you are describing history, say so in the same sentence (retired/removed/was) or use a docs-lint-allow marker.',
  },
  {
    id: 'db-push-canonical',
    // The dangerous one: docs PRESCRIBING the destructive command.
    claim: /(?:schema changes?|canonical flow|sync schema)[^.\n]*\b(?:prisma\s+db\s+push|npm run db:setup)\b|\buse\s+`?prisma db push`?/i,
    ok: () => false, // never acceptable — the guard refuses these commands outright
    why: 'prescribes `prisma db push` / `npm run db:setup`. On this database that emits 18 DROP TABLE statements (incl. visa_applications, live applicant PII). The safe flow is `prisma migrate diff` → read → apply additive only; the non-destructive half is `npm run db:ddl`.',
  },
]

const ALLOW = /<!--\s*docs-lint-allow/i

function* docs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      // `history/` is archaeology by definition — it is SUPPOSED to describe how things used to be.
      if (name === 'history' || name === 'cockpit-archive' || name === 'node_modules') continue
      yield* docs(p)
    } else if (name.endsWith('.md')) yield p
  }
}

const failures = []
// `docs()` already yields docs/README.md; listing it again only produced duplicate work.
for (const file of docs(join(ROOT, 'docs'))) {
  const rel = file.replace(`${ROOT}/`, '')
  const lines = readFileSync(file, 'utf8').split('\n')
  let inFence = false
  let allowUntilBlank = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    if (ALLOW.test(line)) { allowUntilBlank = true; continue }
    // A blank line ends the exempt block, so a marker cannot silently cover the rest of the file.
    if (!line.trim()) { allowUntilBlank = false; continue }
    if (allowUntilBlank) continue
    for (const rule of RULES) {
      if (!rule.claim.test(line)) continue
      if (rule.ok()) continue
      failures.push(`  ${rel}:${i + 1}  [${rule.id}] ${rule.why}\n      ${line.trim().slice(0, 120)}`)
    }
  }
}

const seen = new Set()
const unique = failures.filter((f) => { const k = f.split('\n')[0]; if (seen.has(k)) return false; seen.add(k); return true })

if (unique.length) {
  console.error(`\ndocs-lint FAILED — ${unique.length} documentation claim(s) the repository contradicts:\n`)
  console.error(unique.join('\n'))
  console.error(`
  Fix the doc, or — if you are deliberately describing HISTORY — mark it:
      <!-- docs-lint-allow: describing the pre-2026-07 Vercel deployment -->
  Finished-project write-ups belong in docs/history/, which is not scanned.
`)
  process.exit(1)
}
console.log('docs-lint: clean')
