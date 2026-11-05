#!/usr/bin/env node
/**
 * Carries the guides a person approved in eno Reach (its Content page, on the box) into this checkout: src/content/guides/<slug>.json, a line in src/lib/guides/registry.ts, the generated
 * index. It only reads the box and only writes these files. Nothing is live until someone commits them and eno-deploy.sh ships that commit, and Reach then marks each one "On eno.vn" by
 * itself when its address answers.
 *
 * ⛔ What a person approved is what gets carried: a guide whose text no longer matches the digest stored with the approval stops the whole run, and so does a guide already in the registry that
 * Reach no longer has as approved or published, because someone took it back and removing it is a person's call. Any problem, including eno.vn's own checks failing over the written files, leaves
 * every file as it was.
 *
 * No release dates in the future: a guide carried today is dated today. A date ahead would let one go live on its day after a person had rejected it. Reach drafts one a weeknight and a person
 * reads each, and --max (default 3) keeps a batch small if several were approved at once; the rest wait for the next run.
 *
 * ⚠️ It checks Reach when it runs, and eno-deploy.sh does not. Run it right before the deploy: a guide rejected after being carried still ships unless this runs again and stops on it.
 *
 * Usage: node scripts/carry-guides.mjs [--dry-run] [--max N] [--from-file rows.json]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const REGISTRY = join(ROOT, 'src/lib/guides/registry.ts')
const CONTENT = join(ROOT, 'src/content/guides')
const GENERATED = join(ROOT, 'src/lib/guides/content.generated.ts')
const OPEN = '  // <generated-guides>'
const CLOSE = '  // </generated-guides>'
const FIELDS = ['slug', 'lang', 'published', 'updated', 'released', 'reviewed', 'reviewedDigest', 'pair']
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const BEING_WRITTEN = ['idea', 'writing', 'draft', 'failed']

/** The same value as src/lib/teach-guides/digest.ts (carry.test.ts) and Reach's digestOf (its test/content.test.ts). */
export const digestOf = (doc) => createHash('sha256').update(JSON.stringify(doc)).digest('hex').slice(0, 16)

const blockOf = (source) => {
  const start = source.indexOf(OPEN)
  const end = source.indexOf(CLOSE)
  if (start < 0 || end < start) throw new Error('registry.ts has lost its generated-guides markers')
  return { start: start + OPEN.length, end }
}

/** The registry's entries, as written by renderRegistry. A line this script did not write stops it rather than be lost. */
export function readRegistry(source) {
  const { start, end } = blockOf(source)
  return source.slice(start, end).split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    // The whole line, or a field in another form would vanish the next time the block is written.
    if (!/^\{ \w+: '[^']*'(?:, \w+: '[^']*')* \},$/.test(line)) throw new Error(`registry.ts has a line this script cannot read: ${line}`)
    const entry = Object.fromEntries([...line.matchAll(/(\w+): '([^']*)'/g)].map((m) => [m[1], m[2]]))
    if (!entry.slug || Object.keys(entry).some((k) => !FIELDS.includes(k))) throw new Error(`registry.ts has a line this script cannot read: ${line}`)
    return entry
  })
}

export function renderRegistry(source, entries) {
  const { start, end } = blockOf(source)
  const lines = entries.map((e) => `  { ${FIELDS.filter((k) => e[k]).map((k) => `${k}: '${e[k]}'`).join(', ')} },\n`).join('')
  return `${source.slice(0, start)}\n${lines}${source.slice(end)}`
}

/** What to do, decided from what Reach says and what the registry holds. Writes nothing. Rows come oldest approval first. */
export function planCarry(rows, entries, { today, max = 3 }) {
  const problems = []
  const rewriting = []
  const bySlug = new Map(rows.map((r) => [r.slug, r]))
  for (const e of entries) {
    const r = bySlug.get(e.slug)
    if (!r) problems.push(`${e.slug} is in the registry but not in Reach.`)
    else if (r.status === 'approved' || r.status === 'published') continue
    // A live guide being rewritten: Reach kept the text that is live, and the registry holds that text, so it stays until a new version is approved. Any other text was carried and then sent back.
    else if (BEING_WRITTEN.includes(r.status) && r.liveDigest && e.reviewedDigest === r.liveDigest) rewriting.push(e.slug)
    else problems.push(`${e.slug} is in the registry, but Reach has it as "${r.status}": a person took it back. Decide whether to remove it.`)
  }
  const todo = []
  for (const r of rows) {
    const held = entries.find((e) => e.slug === r.slug)
    // A rewrite approved while the first text was live: Reach sees the address answer and says published, but the new words are still to come over.
    if (r.status !== 'approved' && !(r.status === 'published' && held)) continue
    if (held && held.lang !== r.lang) { problems.push(`${r.slug} is ${held.lang} in the registry and ${r.lang} in Reach: its address would change. Decide which is right.`); continue }
    if (!SLUG.test(r.slug)) { problems.push(`${r.slug} is not an address eno.vn can pin to its language.`); continue }
    if (r.lang !== 'en' && r.lang !== 'vi') { problems.push(`${r.slug} has no language eno.vn serves: ${r.lang}.`); continue }
    if (r.doc?.slug !== r.slug) { problems.push(`${r.slug}: its text says it is "${r.doc?.slug}".`); continue }
    if (!r.digest || digestOf(r.doc) !== r.digest) { problems.push(`${r.slug}: its text is not what the person approved. Approve it again in Reach.`); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.approvedOn || '') || r.approvedOn > today) { problems.push(`${r.slug}: no usable approval date (${r.approvedOn}).`); continue }
    if (held?.reviewedDigest === r.digest) continue // already carried
    todo.push({ row: r, held })
  }
  const carry = todo.slice(0, max)
  const merged = [...entries]
  for (const { row, held } of carry) {
    // As the teach library records a re-approval: the day it first went live stays its publish date, and the new day is its update.
    const firstLive = held && (held.released ?? (held.reviewed > held.published ? held.reviewed : held.published))
    const line = held ? { ...held, released: firstLive, updated: row.approvedOn, reviewed: row.approvedOn, reviewedDigest: row.digest } : { slug: row.slug, lang: row.lang, published: today, reviewed: row.approvedOn, reviewedDigest: row.digest }
    if (held) merged[merged.indexOf(held)] = line
    else merged.push(line)
  }
  return { problems, rewriting, carry: carry.map((c) => c.row), waiting: todo.slice(max).map((c) => c.row.slug), entries: merged }
}

export const guideAddress = (r) => `https://eno.vn/${r.lang === 'vi' ? 'huong-dan' : 'guides'}/${r.slug}`

/** Writes the plan and runs `check` over the real files. If anything fails every file goes back as it was: left behind, the next run would read them as already carried and report nothing. */
export function applyCarry(plan, { registry, contentDir, generated, check }) {
  const source = readFileSync(registry, 'utf8')
  const files = [registry, generated, ...plan.carry.map((r) => join(contentDir, `${r.slug}.json`))]
  const before = new Map(files.map((f) => [f, existsSync(f) ? readFileSync(f, 'utf8') : null]))
  try {
    for (const r of plan.carry) writeFileSync(join(contentDir, `${r.slug}.json`), `${JSON.stringify(r.doc, null, 2)}\n`)
    writeFileSync(registry, renderRegistry(source, plan.entries))
    check()
  } catch (e) {
    for (const [f, was] of before) {
      if (was === null) rmSync(f, { force: true })
      else writeFileSync(f, was)
    }
    throw e
  }
}

/** Read-only on the box: the session itself refuses writes. */
function readFromBox() {
  const key = process.env.ENO_SSH_KEY || join(homedir(), '.ssh/CS-Linux-20260920135129228.pem')
  const sql = `select coalesce(json_agg(json_build_object('slug', slug, 'lang', lang, 'status', status, 'digest', digest, 'liveDigest', live->>'digest',
      'approvedOn', to_char(approved_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD'), 'doc', case when status in ('approved', 'published') then doc end) order by approved_at nulls last, slug), '[]')
    from articles where library = 'guides'`
  const out = execFileSync('ssh', ['-o', 'IdentitiesOnly=yes', '-i', key, '-p', '24700', '-o', 'ConnectTimeout=20', 'root@162.4.176.233',
    "runuser -u reach -- env PGOPTIONS='-c default_transaction_read_only=on' psql -h /var/run/postgresql -p 5440 -d reach -At -v ON_ERROR_STOP=1 -f -"], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(out)
}

function main() {
  const args = process.argv.slice(2)
  const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1] }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
  const max = Number(value('--max') ?? 3)
  if (!Number.isInteger(max) || max < 1) throw new Error('--max must be a whole number, 1 or more')
  const file = value('--from-file')
  const rows = file ? JSON.parse(readFileSync(file, 'utf8')) : readFromBox()
  const source = readFileSync(REGISTRY, 'utf8')
  const plan = planCarry(rows, readRegistry(source), { today, max })
  if (plan.problems.length) {
    console.error(`Nothing written:\n- ${plan.problems.join('\n- ')}`)
    process.exit(1)
  }
  if (plan.rewriting.length) console.log(`being rewritten, and their current text stays live: ${plan.rewriting.join(', ')}`)
  if (!plan.carry.length) {
    console.log('No approved guide waiting to be carried.')
    return
  }
  for (const r of plan.carry) console.log(`${args.includes('--dry-run') ? 'would carry' : 'carrying'} ${guideAddress(r)}`)
  if (plan.waiting.length) console.log(`waiting for the next run: ${plan.waiting.join(', ')}`)
  if (args.includes('--dry-run')) return
  try {
    applyCarry(plan, {
      registry: REGISTRY, contentDir: CONTENT, generated: GENERATED,
      check: () => {
        execFileSync(process.execPath, [join(ROOT, 'scripts/gen-guides.mjs')], { stdio: 'inherit' })
        // eno.vn's own rules over the real files: its schema, its word rule and the digest, and the two public lists a guide's own words land in. A failure here would fail CI, so it stops here instead.
        execFileSync('npx', ['vitest', 'run', 'src/lib/guides', 'src/components/marketplace/library-guide.test.tsx', 'src/app/llms.txt', 'src/app/sitemaps'], { cwd: ROOT, stdio: 'inherit' })
      },
    })
  } catch (e) {
    console.error(`Stopped, and nothing is kept: ${e.message}\nThe files were put back; git status should show none of these guides.`)
    process.exit(1)
  }
  console.log('Carried. Commit these files; the guides go live when that commit is deployed.')
}

// Compared as real paths: through a symlink the two differ, and the script would exit 0 having done nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main()
