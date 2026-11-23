#!/usr/bin/env node
/**
 * Carries the tools a person approved in eno Reach (its Tools tab, on the box) into this checkout: src/content/tools/<slug>.json, a line in
 * src/lib/tools/registry.ts, the generated index. Modelled on scripts/carry-guides.mjs, and like it, nothing is live until someone commits
 * these files and eno-deploy.sh ships that commit. It never reads or writes a guide.
 *
 * Only `--from-file <rows.json>`: the rows Reach's scripts/box/tools-rows.sql prints (read-only), each { slug, status, digest, approvedOn, spec }.
 *
 * ⛔ What a person approved is what gets carried. Each approved spec is validated again by eno.vn's own validator (src/lib/tools/spec.ts, with
 * eno.vn's edition rule) and its canonical digest (src/lib/tools/canonical.ts) must be the digest stored with the approval. A tool already in the
 * registry that Reach no longer has as approved or published stops the run too: someone took it back, and removing it is a person's call. Any
 * problem, including eno.vn's checks failing over the written files, writes nothing or puts every file back as it was.
 *
 * Dated the day it is carried (`published`), never ahead, as the guides are: a date ahead would let a tool go live after a person took it back.
 *
 * Usage: node scripts/carry-tools.mjs --from-file rows.json [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const REGISTRY = join(ROOT, 'src/lib/tools/registry.ts')
const CONTENT = join(ROOT, 'src/content/tools')
const GENERATED = join(ROOT, 'src/lib/tools/content.generated.ts')
const OPEN = '  // <generated-tools>'
const CLOSE = '  // </generated-tools>'
const FIELDS = ['slug', 'published', 'reviewed', 'reviewedDigest']
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

const blockOf = (source) => {
  const start = source.indexOf(OPEN)
  const end = source.indexOf(CLOSE)
  if (start < 0 || end < start) throw new Error('registry.ts has lost its generated-tools markers')
  return { start: start + OPEN.length, end }
}

/** The registry's entries, as renderRegistry writes them. A line this script did not write stops it rather than be lost. */
export function readRegistry(source) {
  const { start, end } = blockOf(source)
  return source.slice(start, end).split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
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

/**
 * What to do, from what Reach says and what the registry holds. Writes nothing. `validate(spec)` is eno.vn's validator (problems, [] when
 * fine) and `digest(spec)` its canonical digest; `files` the slugs that already have a spec in src/content/tools.
 */
export function planToolCarry(rows, entries, { today, validate, digest, files = new Set() }) {
  const problems = []
  if (!Array.isArray(rows)) return { problems: ['the rows file is not a list'], carry: [], entries }
  const bySlug = new Map(rows.map((r) => [r?.slug, r]))
  for (const e of entries) {
    const r = bySlug.get(e.slug)
    if (!r) problems.push(`${e.slug} is in the registry but not in Reach.`)
    else if (r.status !== 'approved' && r.status !== 'published') problems.push(`${e.slug} is in the registry, but Reach has it as "${r.status}": a person took it back. Decide whether to remove it.`)
  }
  const carry = []
  const merged = [...entries]
  for (const r of rows) {
    if (r?.status !== 'approved') continue
    const held = entries.find((e) => e.slug === r.slug)
    if (typeof r.slug !== 'string' || !SLUG.test(r.slug) || r.slug.length > 60) { problems.push(`${r.slug} is not an address a tool can have.`); continue }
    if (r.spec?.slug !== r.slug) { problems.push(`${r.slug}: its spec says it is "${r.spec?.slug}".`); continue }
    const found = validate(r.spec)
    if (found.length) { problems.push(`${r.slug}: eno.vn refuses its spec: ${found.slice(0, 3).join('; ')}`); continue }
    let d
    try { d = digest(r.spec) } catch (e) { problems.push(`${r.slug}: its spec is not JSON: ${e.message}`); continue }
    if (!r.digest || d !== r.digest) { problems.push(`${r.slug}: its spec is not what the person approved. Approve it again in Reach.`); continue }
    if (!DAY.test(r.approvedOn || '') || r.approvedOn > today) { problems.push(`${r.slug}: no usable approval date (${r.approvedOn}).`); continue }
    if (held?.reviewedDigest === r.digest) continue // already carried
    if (!held && files.has(r.slug)) {
      problems.push(`${r.slug}: src/content/tools/${r.slug}.json already exists and no registry line owns it. If an earlier carry was killed before it could put its files back, that file is its leftover: delete it and run this again.`)
      continue
    }
    // A new version of a carried tool keeps the day it first went live.
    const line = held ? { ...held, reviewed: r.approvedOn, reviewedDigest: r.digest } : { slug: r.slug, published: today, reviewed: r.approvedOn, reviewedDigest: r.digest }
    if (held) merged[merged.indexOf(held)] = line
    else merged.push(line)
    carry.push(r)
  }
  return { problems, carry, entries: merged }
}

/** Writes the plan and runs `check` over the real files. If anything fails every file goes back as it was. */
export function applyToolCarry(plan, { registry, contentDir, generated, check }) {
  const source = readFileSync(registry, 'utf8')
  const files = [registry, generated, ...plan.carry.map((r) => join(contentDir, `${r.slug}.json`))]
  const before = new Map(files.map((f) => [f, existsSync(f) ? readFileSync(f, 'utf8') : null]))
  try {
    mkdirSync(contentDir, { recursive: true })
    for (const r of plan.carry) writeFileSync(join(contentDir, `${r.slug}.json`), `${JSON.stringify(r.spec, null, 2)}\n`)
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

/** eno.vn's validator and digest, read from its TypeScript as it is (node strips the types; the hook resolves its extensionless imports). */
async function enoRules() {
  const { registerHooks } = await import('node:module')
  registerHooks({
    resolve(specifier, context, next) {
      if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) && context.parentURL) {
        const url = new URL(`${specifier}.ts`, context.parentURL)
        if (existsSync(fileURLToPath(url))) return next(url.href, context)
      }
      return next(specifier, context)
    },
  })
  const at = (p) => pathToFileURL(join(ROOT, p)).href
  const spec = await import(at('src/lib/tools/spec.ts'))
  const { toolDigest } = await import(at('src/lib/tools/canonical.ts'))
  const { GUIDE_BANNED } = await import(at('src/lib/guides/edition.ts'))
  // The same ctx as src/lib/tools/content.ts TOOL_CTX (carry-tools.test.ts holds the two equal).
  const ctx = toolCtx(spec, GUIDE_BANNED)
  return { validate: (s) => spec.validateToolSpec(s, ctx), digest: toolDigest }
}

export const toolCtx = (spec, editionBanned) => ({ relatedPaths: Object.keys(spec.TOOL_LINKS), banned: [editionBanned, spec.TOOL_INTERNALS_BANNED] })

async function main() {
  const args = process.argv.slice(2)
  const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1] }
  const file = value('--from-file')
  if (!file) throw new Error('Usage: node scripts/carry-tools.mjs --from-file rows.json [--dry-run] (rows from Reach: scripts/box/tools-rows.sql)')
  const dryRun = args.includes('--dry-run')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  const source = readFileSync(REGISTRY, 'utf8')
  const files = new Set(existsSync(CONTENT) ? readdirSync(CONTENT).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [])
  const plan = planToolCarry(rows, readRegistry(source), { today, files, ...(await enoRules()) })
  if (plan.problems.length) {
    console.error(`Nothing written:\n- ${plan.problems.join('\n- ')}`)
    process.exit(1)
  }
  if (!plan.carry.length) {
    console.log('No approved tool waiting to be carried.')
    return
  }
  for (const r of plan.carry) console.log(`${dryRun ? 'would carry' : 'carrying'} https://eno.vn/tools/${r.slug}`)
  if (dryRun) return
  try {
    applyToolCarry(plan, {
      registry: REGISTRY, contentDir: CONTENT, generated: GENERATED,
      check: () => {
        execFileSync(process.execPath, [join(ROOT, 'scripts/gen-tools.mjs')], { stdio: 'inherit' })
        // eno.vn's own rules over the real files: the build-time gate (content.ts), the pages, and the two public lists a tool lands in.
        execFileSync('npx', ['vitest', 'run', 'src/lib/tools', 'src/app/[lang]/tools', 'src/app/llms.txt', 'src/app/sitemaps', 'src/components/marketplace/library-guide.test.tsx'], { cwd: ROOT, stdio: 'inherit' })
      },
    })
  } catch (e) {
    console.error(`Stopped, and nothing is kept: ${e.message}\nThe files were put back; git status should show none of these tools.`)
    process.exit(1)
  }
  console.log('Carried. Commit these files; the tools go live when that commit is deployed. Then mark each one published in Reach.')
}

// Compared as real paths: through a symlink the two differ, and the script would exit 0 having done nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) await main()
