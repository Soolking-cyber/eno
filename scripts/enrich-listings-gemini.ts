/**
 * The Gemini product pass: placement + one clean description layout per imported listing.
 *
 *   npx tsx scripts/enrich-listings-gemini.ts --in scope.jsonl --out <dir>
 *   npx tsx scripts/enrich-listings-gemini.ts --in scope.jsonl --out <dir> --batch 20 --workers 3
 *
 * Owner, 2026-09-13: "give the box agy gemini flash 3.8 flash let it sort all product descriptions properly
 * and revisit taxonomy across the app". The owner chose to run the model HERE (their agy subscription stays
 * on this Mac) and apply on the box: scripts/export-enrich-scope.ts → this → scripts/apply-listing-enrichment.ts.
 *
 * ⛔ FILE IN, FILES OUT, NO DATABASE — the same split as retranslate-titles-gemini.ts, for the same reason: a
 * pass measured in days must not hold an SSH tunnel open.
 * ⛔ THE MODEL DECIDES NOTHING ON ITS OWN. The output holds the raw answers; decideEnrichment() is applied where
 * they are used (the apply step re-gates every row against the live database).
 * ⚠️ APPEND-ONLY PART FILES, NOT ONE JSON DOCUMENT. At ~5 KB a row the full catalogue is ~400 MB — one
 * JSON.stringify of that approaches V8's string limit and a re-read would fail (opus). Each batch is appended to
 * `part-NNNN.jsonl` (2,000 rows a part) and fsynced; resume and apply read line by line; the sync to the box
 * copies only parts that changed.
 * ⚠️ ONE SCOPE PER DIRECTORY. `scope.sha` pins the export the directory belongs to; a different export refuses to
 * start rather than mixing another run's rows into the apply (codex, astra).
 * ⚠️ RESUMABLE: keyed by id + snapshot + prompt version, so a changed row or a new prompt is asked again.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEnrichPrompt, decideEnrichment, ENRICH_VERSION, inputFromSnapshot, parseEnrichReply } from '../src/lib/listing-enrich'
import { readParts, readScope, type DoneRow, type ScopeRow } from './enrich-files'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const int = (name: string, dflt: number, min: number, max: number) => {
  const n = Number(arg(name) ?? dflt)
  if (!Number.isInteger(n) || n < min || n > max) { console.error(`--${name} must be an integer ${min}..${max}`); process.exit(1) }
  return n
}
const IN = arg('in')
const OUT = arg('out')
const BATCH = int('batch', 20, 1, 40)
const WORKERS = int('workers', 2, 1, 4)
const PART_ROWS = 2000
if (!IN || !OUT) { console.error('--in <scope.jsonl> --out <dir> required'); process.exit(1) }

const EMPTY_CWD = mkdtempSync(join(tmpdir(), 'eno-enrich-'))
process.on('exit', () => { try { rmSync(EMPTY_CWD, { recursive: true, force: true }) } catch { /* best effort */ } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const keyOf = (r: ScopeRow) => createHash('sha256').update(JSON.stringify([r.id, r.snap, ENRICH_VERSION])).digest('hex').slice(0, 24)

/** One `agy` call — argv array (merchant text is never shell-interpolated), --sandbox, empty cwd. See retranslate-titles-gemini.ts. */
function askGemini(prompt: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn('agy', ['-p', prompt, '--model', 'Gemini 3.8 Flash (High)', '--sandbox', '--print-timeout', `${Math.round(timeoutMs / 1000)}s`],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: EMPTY_CWD })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(null) }, timeoutMs + 30_000)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', () => { clearTimeout(timer); resolve(null) })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || !out.trim()) { if (err) console.error(`  agy: ${err.trim().slice(0, 160)}`); resolve(null); return }
      resolve(out)
    })
  })
}

/** One batch; a reply that does not map every item is HALVED and re-asked, never salvaged by position. */
async function runBatch(rows: ScopeRow[]): Promise<DoneRow[]> {
  if (!rows.length) return []
  const reply = await askGemini(buildEnrichPrompt(rows), 480_000)
  if (reply) {
    const parsed = parseEnrichReply(reply, rows.length)
    if (parsed.ok) {
      return rows.map((r, i) => ({ id: r.id, key: keyOf(r), version: ENRICH_VERSION, from: { category: r.category, subcategory: r.subcategory }, snap: r.snap, answer: parsed.answers[i] }))
    }
    console.warn(`    batch of ${rows.length} unusable (${parsed.reason})`)
  }
  if (rows.length === 1) { console.warn(`    giving up on ${rows[0].id}`); return [] }
  await sleep(2000)
  const mid = Math.floor(rows.length / 2)
  return [...await runBatch(rows.slice(0, mid)), ...await runBatch(rows.slice(mid))]
}

async function main() {
  const { rows, bad } = await readScope(IN!)
  if (bad) console.warn(`${bad} malformed scope lines skipped`)
  mkdirSync(OUT!, { recursive: true })
  // The scope is the rows and their snapshots — NOT the prompt version, so bumping the prompt re-asks rows in the same
  // directory instead of refusing to start (astra).
  const hash = createHash('sha256')
  for (const r of rows) hash.update(JSON.stringify([r.id, r.snap]) + '\n') // incremental: no 300 MB joined string (codex)
  const scopeSha = hash.digest('hex')
  const shaFile = join(OUT!, 'scope.sha')
  if (existsSync(shaFile) && readFileSync(shaFile, 'utf8').trim() !== scopeSha) {
    console.error(`${OUT} belongs to a different export (scope.sha differs). Use a new --out directory.`)
    process.exit(1)
  }
  writeFileSync(shaFile, scopeSha + '\n')

  const have = new Set<string>()
  for await (const d of readParts(OUT!)) have.add(d.key)
  const todo = rows.filter((r) => !have.has(keyOf(r)))
  console.log(`${rows.length} rows in, ${have.size} answered, ${todo.length} to do — batch ${BATCH}, ${WORKERS} workers\n`)

  // Append target: a new part whenever the current one holds PART_ROWS lines.
  const existing = readdirSync(OUT!).filter((f) => /^part-\d{4}\.jsonl$/.test(f)).sort()
  let partNo = existing.length ? Number(existing[existing.length - 1].slice(5, 9)) : 1
  let inPart = 0
  if (existing.length) {
    const last = join(OUT!, existing[existing.length - 1])
    const text = readFileSync(last, 'utf8')
    inPart = text.split('\n').filter(Boolean).length
    // ⚠️ A kill mid-append leaves a line with no newline; appending straight after it would glue the next answer onto
    // the fragment and lose both (astra). Terminate it — readParts skips the torn fragment on its own line.
    if (text.length && !text.endsWith('\n')) { const fd = openSync(last, 'a'); writeSync(fd, '\n'); fsyncSync(fd); closeSync(fd) }
  }
  const append = (got: DoneRow[]) => {
    for (const d of got) {
      if (inPart >= PART_ROWS) { partNo++; inPart = 0 }
      const fd = openSync(join(OUT!, `part-${String(partNo).padStart(4, '0')}.jsonl`), 'a')
      writeSync(fd, JSON.stringify(d) + '\n')
      fsyncSync(fd)
      closeSync(fd)
      inPart++
    }
  }

  const batches: ScopeRow[][] = []
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
  let next = 0
  let finished = 0
  const t0 = Date.now()
  async function worker() {
    while (next < batches.length) {
      const slice = batches[next++]
      const got = await runBatch(slice)
      append(got) // synchronous: two workers' appends never interleave inside a line
      finished += slice.length
      const mins = (Date.now() - t0) / 60000
      console.log(`  ${finished}/${todo.length}  ${mins.toFixed(1)}min  ~${((todo.length - finished) * (mins / Math.max(finished, 1)) / 60).toFixed(1)}h left`)
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker))

  // Summary under the CURRENT gate (the apply re-gates against the live rows anyway).
  let total = 0
  let texts = 0
  let refiled = 0
  const refusals: Record<string, number> = {}
  for await (const d of readParts(OUT!)) {
    if (d.version !== ENRICH_VERSION) continue
    total++
    const dec = decideEnrichment(inputFromSnapshot(d.id, d.snap, d.from), d.answer)
    if (dec.descriptionVi !== null) texts++
    if (dec.category !== d.from.category || dec.subcategory !== d.from.subcategory) refiled++
    for (const r of dec.refused) { const k = r.split(':').slice(0, 2).join(':'); refusals[k] = (refusals[k] ?? 0) + 1 }
  }
  // ⚠️ SAY WHAT IS MISSING. A row whose singleton request failed has no answer; the run is resumable, and the apply is
  // per-listing, so a partial run is safe to apply — but it must not be mistaken for a complete one (codex).
  const answered = new Set<string>()
  for await (const d of readParts(OUT!)) answered.add(d.key)
  const missing = rows.filter((r) => !answered.has(keyOf(r))).length
  console.log(`\n${missing ? `INCOMPLETE — ${missing} rows still unanswered; re-run to retry them` : 'DONE'}: ${total} answers in ${OUT}; ${texts} with a new description; ${refiled} re-filed`)
  if (missing) process.exitCode = 2
  console.log('refusals:', JSON.stringify(Object.entries(refusals).sort((a, b) => b[1] - a[1]).slice(0, 20)))
}

main().catch((e) => { console.error(e); process.exit(1) })
