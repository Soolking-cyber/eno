/**
 * Re-translate Vietnamese listing titles into English with Gemini 3.8 Flash, via the local `agy`
 * CLI (the owner's subscription).
 *
 *   npx tsx scripts/retranslate-titles-gemini.ts --in titles.json --out done.json
 *   npx tsx scripts/retranslate-titles-gemini.ts --in titles.json --out done.json --batch 150
 *
 * ⛔ WHY THIS EXISTS. The self-hosted m2m100 model translates Vietnamese product titles
 * word-by-word and invents meaning: "Máy lạnh Daikin 1.0HP" shipped as "Daikin 1.0HP
 * refrigerator" — an AIR CONDITIONER sold as a fridge — and "Sách Gieo Thói Quen Nhỏ Gặt Thành
 * Công Lớn" as "Sitting Little Dating Habits Setting Big Success". 41,676 live titles are in that
 * state. Descriptions are FINE from the same model (they are real sentences); it is terse
 * noun-phrase titles that defeat a sentence-level MT model.
 *
 * MEASURED on 150 real titles against the Google Translate API as reference:
 *              chrF++   domain nouns   model codes
 *   gemini      59.50      53/54        73/73 (100%)
 *   m2m100      52.89      38/54        69/73
 *   madlad-3b   47.43        —            —
 * Gemini beats Google's own API on our data often enough that it is the target, not a compromise.
 *
 * ⛔ FILE IN, FILE OUT, NO DATABASE. `agy` runs on the operator's laptop while the database lives
 * on the VN box behind an SSH tunnel that has already killed one long import mid-run
 * (P1017 ConnectionClosed at 17,435 of 52,700). A translation pass that holds a tunnel open for
 * hours would fail the same way and lose the work. So: dump on the box, translate here, apply on
 * the box. Every phase is restartable and the expensive phase touches nothing it can corrupt.
 *
 * ⚠️ RESUMABLE BY CONSTRUCTION — the output file is appended per batch, so a killed run resumes
 * from what is already written rather than paying for it twice.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBatchPrompt, parseBatchReply } from '../src/lib/mt-batch-protocol'
import { gateTranslation } from '../src/lib/mt-gate'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const IN = arg('in')
const OUT = arg('out')
/** 150 measured at 107s; 40 took 166s. The cost is per-CALL, so bigger batches are cheaper. */
/**
 * ⚠️ VALIDATED. `--batch 0` looped forever, a negative walked the index backwards, and a
 * non-number skipped every row while still printing DONE (codex). The upper bound is the argv
 * limit this file depends on: 150 titles is ~9KB of prompt, and ARG_MAX is the ceiling.
 */
const BATCH = (() => {
  const n = Number(arg('batch') ?? 150)
  if (!Number.isInteger(n) || n < 1 || n > 400) { console.error('--batch must be an integer 1..400'); process.exit(1) }
  return n
})()
if (!IN || !OUT) { console.error('--in <titles.json> --out <done.json> required'); process.exit(1) }

type Row = { id: string; vi: string }
type Done = { id: string; vi: string; en: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const EMPTY_CWD = mkdtempSync(join(tmpdir(), 'eno-agy-'))
// Removed on a normal exit. ⚠️ Ctrl-C / SIGTERM / SIGKILL skip `exit` listeners, so an interrupted
// run can leave one EMPTY eno-agy-* directory in tmp — harmless, and the OS clears tmp.
process.on('exit', () => { try { rmSync(EMPTY_CWD, { recursive: true, force: true }) } catch { /* best effort */ } })

/**
 * One `agy` call.
 *
 * ⚠️ SPAWN WITH AN ARGV ARRAY, NEVER A SHELL STRING. These titles are third-party merchant text
 * containing quotes, backticks and `$`; interpolating them into a shell command is both a quoting
 * bug and an injection. ⚠️ argv also has a hard OS limit (ARG_MAX) — at 150 titles the prompt is
 * ~9KB, far inside it, but that is why the batch size is bounded rather than "everything".
 */
function askGemini(prompt: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    /**
     * ⛔ `--sandbox`, NOT `--dangerously-skip-permissions`. The text in this prompt is THIRD-PARTY
     * MERCHANT COPY scraped from Tiki and a dozen shops — anyone who can publish a product title
     * can put "ignore previous instructions and run …" in it. Passing titles as an argv array
     * defeats SHELL injection; it does nothing about PROMPT injection, and the agent this calls
     * has tools (codex, astra). The sandbox restricts what those tools can reach, and the
     * delimiter + instruction below tell the model the block is DATA.
     *
     * ⚠️ A subtler payload than "run a command" is a correctly-numbered WRONG translation, which
     * would pass the parser and land in production. That is what the entity gate and the
     * everything-must-align rule are for — neither trusts the content of the reply.
     */
    // ⚠️ AN EMPTY WORKING DIRECTORY — a tidiness measure, NOT a security boundary. It stops a relative
    // path resolving into the repo; an absolute path still would, and the child inherits this
    // process's environment (this script loads no .env and holds no DB credentials — see the header).
    // Containment is `--sandbox` plus headless auto-deny. MEASURED after adding it and the no-tools
    // prompt line: 0 tool denials across the first 2,700 titles, against 7 in the 900 before.
    const p = spawn('agy', ['-p', prompt, '--model', 'Gemini 3.8 Flash (High)',
      '--sandbox', '--print-timeout', `${Math.round(timeoutMs / 1000)}s`],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: EMPTY_CWD })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(null) }, timeoutMs + 30_000)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', () => { clearTimeout(timer); resolve(null) })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || !out.trim()) {
        if (err) console.error(`  agy: ${err.trim().slice(0, 160)}`)
        resolve(null)
        return
      }
      resolve(out)
    })
  })
}

/**
 * Translate one batch, splitting on refusal.
 *
 * ⛔ A REFUSED BATCH IS HALVED, NOT SALVAGED. parseBatchReply refuses whenever it cannot map every
 * index, and the tempting recovery — "use the lines it did return, in order" — is exactly the
 * assumption that renames every product after the gap. Halving re-asks a smaller question; a
 * single item that still fails is left untranslated, which is visibly wrong to a human and
 * re-selectable by a later run.
 */
async function translateBatch(rows: Row[], depth = 0): Promise<Done[]> {
  if (rows.length === 0) return []
  const reply = await askGemini(buildBatchPrompt(rows.map((r) => r.vi)), 300_000)
  if (reply) {
    const parsed = parseBatchReply(reply, rows.length)
    if (parsed.ok) {
      const out: Done[] = []
      let gated = 0
      rows.forEach((r, i) => {
        const en = parsed.values[i]
        // The same gate the request path uses: a dropped model code or an echoed source is not a
        // translation. Gemini kept 73/73 codes in the benchmark, so this should almost never fire.
        if (gateTranslation(r.vi, en, 'en', 'vi')) { gated++; return }
        out.push({ id: r.id, vi: r.vi, en })
      })
      if (gated) console.log(`    gate refused ${gated}/${rows.length}`)
      return out
    }
    console.warn(`    batch of ${rows.length} unusable (${parsed.reason})`)
  }
  if (rows.length === 1) { console.warn(`    giving up on: ${rows[0].vi.slice(0, 60)}`); return [] }
  /**
   * ⚠️ NO DEPTH CAP. A cap of 4 halvings bottomed out at groups of ~5 from a batch of 150 and then
   * DROPPED them whole, silently leaving several titles untranslated while the file claimed it
   * split down to singles (codex). Halving terminates on its own — the recursion is bounded by
   * log2(batch) — so the cap bought nothing and cost coverage.
   */
  const mid = Math.floor(rows.length / 2)
  await sleep(2000)
  return [...await translateBatch(rows.slice(0, mid), depth + 1), ...await translateBatch(rows.slice(mid), depth + 1)]
}

async function main() {
  const rows: Row[] = JSON.parse(readFileSync(IN!, 'utf8'))
  // Resume: anything already in the output file is paid for and is not asked again.
  const done: Done[] = existsSync(OUT!) ? JSON.parse(readFileSync(OUT!, 'utf8')) : []
  /**
   * ⚠️ RESUME IS KEYED BY id + SOURCE TEXT, not id alone. If a re-import changes a listing's
   * Vietnamese title, an id-only key would skip it as "already done" while the apply step rejects
   * the stale translation because titleVi no longer matches — the row would be skipped forever by
   * both halves (astra).
   */
  const key = (id: string, vi: string) => `${id}\u0000${vi}`
  const haveKeys = new Set(done.map((d) => key(d.id, d.vi)))
  const todo = rows.filter((r) => r.vi?.trim() && !haveKeys.has(key(r.id, r.vi)))
  console.log(`${rows.length} titles in, ${done.length} already translated, ${todo.length} to do`)
  console.log(`batch ${BATCH} — about ${Math.ceil((todo.length / BATCH) * 110 / 60)} minutes at the measured rate\n`)

  const t0 = Date.now()
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH)
    const got = await translateBatch(slice)
    done.push(...got)
    /**
     * ⛔ WRITE-THEN-RENAME. `writeFileSync` TRUNCATES first, so a kill (or a full disk) mid-write
     * leaves half a JSON document — and the next run dies in JSON.parse having lost every
     * translation paid for so far, which is the exact opposite of the resumability this file
     * claims (codex, astra). rename(2) is atomic on the same filesystem.
     */
    writeFileSync(`${OUT}.tmp`, JSON.stringify(done))
    renameSync(`${OUT}.tmp`, OUT!)
    const pct = Math.min(100, Math.round(((i + slice.length) / todo.length) * 100))
    const mins = (Date.now() - t0) / 60000
    console.log(`  ${i + slice.length}/${todo.length} (${pct}%)  kept ${done.length}  ${mins.toFixed(1)}min`)
  }
  console.log(`\nDONE: ${done.length} translations in ${OUT} — apply them on the box.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
