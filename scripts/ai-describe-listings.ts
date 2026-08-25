/**
 * Write a real product description for imported listings, and have the model CONFIRM the spec
 * chips at the same time (owner, 2026-08-25: "do descriptions with gemini 3.7 flash and it will
 * pick the chips too once again to confirm").
 *
 *   npx tsx scripts/ai-describe-listings.ts --sub laptops-pcs --limit 25   # DRY RUN
 *   npx tsx scripts/ai-describe-listings.ts --apply
 *   npx tsx scripts/ai-describe-listings.ts --apply --redo                 # re-describe done rows
 *   npx tsx scripts/ai-describe-listings.ts --verify                        # re-gate what is LIVE
 *   npx tsx scripts/ai-describe-listings.ts --verify --apply                # …and revert failures
 *
 * ⛔ WHY IT IS NEEDED: 9,693 of 9,726 descriptions are BYTE-IDENTICAL to the title. The merchant
 * datafeed's `desc` field is the title repeated, so every product page, every JSON-LD block and
 * both ad catalogues carry a description that says nothing.
 *
 * ⛔ EVERY FIELD PASSES src/lib/ai-describe-guard.ts BEFORE IT IS WRITTEN. `description` is not an
 * ordinary column: it is published as JSON-LD, in the Facebook catalog CSV and in the Google
 * Merchant XML, both fetched UNATTENDED. There is no human between this model and a licensed
 * company's Merchant Center, so the guard is the only thing standing there.
 *
 * ⚠️ THE MODEL CANNOT OVERRULE THE REGEX ON A SPEC. Measured on 60 rows where the deterministic
 * extractor was certain, the model agreed 60/60 on storage, 60/60 on RAM and 19/19 on
 * connectivity — so it earns the right to FILL a gap (a laptop CPU that lives only in the SKU),
 * never to change an answer the merchant's own title already gave.
 */
import 'dotenv/config'
import { appendFileSync, writeFileSync } from 'node:fs'
import { GoogleGenAI, Type } from '@google/genai'
import { db } from '../src/lib/db'
import { buildSearchText } from '../src/lib/fold'
import { GEMINI_MODEL } from '../src/lib/gemini-model'
import { extractSpecsFromTitles, isLegalSpec, specsFor, type SpecKey } from '../src/lib/electronics-specs'
import { guardDescription, isGroundedInTitle, reconcileSpecs } from '../src/lib/ai-describe-guard'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const REDO = process.argv.includes('--redo')
/**
 * ⛔ `--verify` RE-RUNS THE GATES OVER WHAT IS ALREADY LIVE, calling no model at all.
 *
 * It exists because the guard keeps getting stricter as reviewers find holes in it — a returns
 * promise written as "đổi trả" slipped through an ASCII word boundary, "Delivery is available
 * nationwide" was not a "free shipping" claim, "99 USD" was not a price. Every one of those was
 * fixed AFTER rows had already been written by a run holding the older module in memory.
 * Re-describing 9,726 products to apply a regex fix would be absurd; re-reading them is seconds.
 * With `--apply` a row that now fails has its description reverted to the title — visibly
 * undescribed, and re-selected by the next ordinary run.
 */
const VERIFY = process.argv.includes('--verify')
const SELLER = arg('seller') ?? 'CellphoneS'
const SUB = arg('sub')
const LIMIT = Number(arg('limit') ?? 0)
const BATCH = Number(arg('batch') ?? 25)
const CONCURRENCY = Number(arg('concurrency') ?? 5)
/**
 * ⛔ OFF BY DEFAULT. With this flag the model may add a spec it knows but the title does not state
 * — "Dell Vostro 3530" is genuinely a 15.6-inch machine. Measured on 40 evidence-free laptop rows:
 * 39 values emitted, 32 readable in the title, 7 not, and reading those 7 they were all correct.
 * They are still refused by default, because `attributes` feeds Google Merchant and Meta with no
 * human in between, and an unverifiable claim is the one thing that must not go there silently.
 */
const ALLOW_UNGROUNDED = process.argv.includes('--allow-ungrounded-specs')

type Row = {
  id: string; externalId: string | null; title: string; titleVi: string | null; description: string; descriptionVi: string | null
  subcategorySlug: string | null; brandSlug: string | null; model: string | null
  district: string | null; location: string | null; attributes: string | null
  category: { name: string; nameVi: string }
}

const parseAttrs = (s: string | null): Record<string, string> => {
  if (!s) return {}
  try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} } catch { return {} }
}

/**
 * ⛔ CONSTRUCTED HERE, NOT IMPORTED FROM src/lib/gemini.ts. That module is `server-only`, which
 * cannot resolve outside Next's bundler — no top-level install, and outside the `react-server`
 * condition its entry point throws by design. No script in this repo imports a server-only module;
 * they duplicate the client and import the PURE parts. The model id is the one thing that must not
 * drift, so it comes from gemini-model.ts, which the app re-exports.
 * ⚠️ `location: 'global'` is mandatory — the 3.x flash line 404s on regional endpoints.
 */
function makeClient(): GoogleGenAI {
  const project = process.env.GEMINI_PROJECT || process.env.GOOGLE_VERTEX_PROJECT
  const raw = process.env.GOOGLE_VERTEX_CREDENTIALS
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (apiKey) return new GoogleGenAI({ apiKey })
  if (!project || !raw) { console.error('need GEMINI_API_KEY, or GOOGLE_VERTEX_PROJECT + GOOGLE_VERTEX_CREDENTIALS'); process.exit(1) }
  return new GoogleGenAI({
    vertexai: true, project, location: process.env.GEMINI_LOCATION || 'global',
    googleAuthOptions: { credentials: JSON.parse(raw) },
  })
}

/**
 * ⚠️ THE THINGS THE MODEL MUST NEVER WRITE ARE SPELLED OUT, AND ALSO ENFORCED IN CODE. A prompt is
 * guidance; ai-describe-guard.ts is the gate. Both exist because a prompt-only rule is one bad
 * sampling away from a claim in a Google Merchant feed.
 */
function buildPrompt(sub: string, rows: Row[]): string {
  const specs = specsFor(sub)
  const allowed = specs.length
    ? specs.map((s) => `  ${s.key}: ${s.values.map((v) => v.value).join(' | ')}`).join('\n')
    : '  (none for this subcategory)'
  const items = rows.map((r) => ({
    /**
     * ⛔ THE ECHO KEY IS THE PRODUCT'S OWN ID, NOT ITS POSITION. A model that returns a permuted
     * list still produces a perfect 0..n-1 index set, so an index check passes while every
     * description lands on the wrong product — the right-spec-wrong-row shape of the 134-iPhone
     * incident. An externalId cannot be silently reordered into something plausible.
     */
    id: r.externalId,
    title: r.title,
    titleVi: r.titleVi ?? undefined,
    brand: r.brandSlug ?? undefined,
    knownSpecs: parseAttrs(r.attributes),
  }))
  return `You are writing catalogue copy for a Vietnamese marketplace. For each product below, write a short description in English and in Vietnamese, and list the specs you can identify.

PRODUCTS (JSON):
${JSON.stringify(items, null, 1)}

ALLOWED SPEC VALUES for subcategory "${sub}" — use these exact strings and nothing else:
${allowed}

RULES — every one of these is checked in code, and a product that breaks one is discarded:
1. 2 to 3 sentences, 40 to 700 characters. The FIRST sentence must stand alone: it is what search
   engines and ad catalogues show, truncated at 160 characters.
2. Describe only what the product IS and who it suits. Neutral, factual, no marketing superlatives.
3. NEVER state a specification that is not in the product's title or in its knownSpecs. If the
   title does not say how much storage it has, do not mention storage at all.
4. NEVER mention: price, discount, sale, "cheapest"/"best price", warranty, shipping, delivery,
   returns, refunds, stock availability, any URL, any phone number.
   This marketplace does not sell or ship these items and cannot promise any of it.
5. NEVER state or imply that the item is genuine, authentic, official, authorised, or from an
   official channel. Do not write "genuine", "authentic", "official", "chinh hang", "uy tin".
   This applies EVEN IF the product title says it — repeating the shop's marketing in our own
   description makes it our claim, and we did not source the item.
6. The ENGLISH text must contain NO Vietnamese characters at all — no accents, and never the
   character "d with a stroke". Write "Da Nang", not the accented form. An English description
   containing one is automatically re-translated and destroyed.
7. Plain prose only. No bullet points, no markdown, no HTML, no emoji.
8. specs: include a key ONLY if you are confident from the title, the model name or the SKU.
   Omit the key entirely when unsure. Never guess a capacity.
10. Return one object per product, echoing its "id" EXACTLY as given. Return every product.`
}

type AiItem = { id?: string; descEn?: string; descVi?: string; specs?: Record<string, string> }

async function describeBatch(ai: GoogleGenAI, sub: string, rows: Row[]): Promise<AiItem[] | null> {
  const specs = specsFor(sub)
  const res = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: buildPrompt(sub, rows),
    config: {
      responseMimeType: 'application/json',
      // ⚠️ THINKING OFF. Left at its default this model spends ~1,000 extra tokens per call that
      // bill at the OUTPUT rate — the single knob that could multiply this job's cost several
      // times over. Measured: with thinkingBudget 0 the answers were unchanged on 60 rows.
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0.3,
      maxOutputTokens: 30000,
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            descEn: { type: Type.STRING },
            descVi: { type: Type.STRING },
            specs: { type: Type.OBJECT, properties: Object.fromEntries(specs.map((s) => [s.key, { type: Type.STRING }])) },
          },
          required: ['id', 'descEn', 'descVi'],
        },
      },
    },
  })
  let out: AiItem[]
  try { out = JSON.parse(res.text ?? '[]') } catch { return null }
  /**
   * ⛔ THE BATCH IS DROPPED WHOLE UNLESS THE ECHOED INDICES ARE EXACTLY 0..n-1. Writing by array
   * position instead of by the echoed `i` is how a description lands on the wrong product — the
   * same shape of mistake as the 134 iPhones indexed with 128GB of RAM. One missing or duplicated
   * index means we cannot know which answer belongs to which row, so none of them are used.
   */
  const sent = new Set(rows.map((r) => r.externalId))
  const got = new Set(out.map((o) => o.id))
  if (out.length !== rows.length || got.size !== rows.length) return null
  for (const id of got) if (!sent.has(id as string)) return null
  return out
}

/** Re-gate every LIVE description. No model calls; `--apply` reverts what now fails. */
async function verify(rows: Row[]) {
  /**
   * ⚠️ ONLY ROWS THIS SCRIPT ACTUALLY WROTE. A row whose `descriptionVi` is null was never touched
   * here — 33 listings arrived that way from the importer — and the Vietnamese length gate would
   * fail every one of them, reverting a perfectly good English description that no model produced.
   */
  const described = rows.filter((r) => r.description.trim() !== r.title.trim() && (r.descriptionVi ?? '').trim().length > 0)
  console.log(`${described.length} listings carry a written description — re-gating\n`)
  const failures: { row: Row; reasons: string[] }[] = []
  for (const row of described) {
    const v = guardDescription({
      subcategorySlug: row.subcategorySlug, title: row.title, titleVi: row.titleVi,
      attributes: parseAttrs(row.attributes),
      descEn: row.description.trim(), descVi: (row.descriptionVi ?? '').trim(),
    })
    if (!v.ok) failures.push({ row, reasons: v.reasons })
  }
  const tally = new Map<string, number>()
  for (const f of failures) for (const r of f.reasons) {
    const k = r.replace(/=.*/, ''); tally.set(k, (tally.get(k) ?? 0) + 1)
  }
  console.log(`${failures.length} now FAIL the current gates (${described.length ? Math.round(failures.length / described.length * 100) : 0}%)`)
  if (tally.size) console.table([...tally].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n))
  for (const f of failures.slice(0, 5)) console.log(`  ${f.reasons[0]} :: ${f.row.description.slice(0, 90)}`)
  if (!APPLY) { console.log('\nVERIFY DRY RUN — nothing reverted. Re-run with --apply to revert failures.'); return }
  /**
   * ⛔ THE REVERT TOUCHES THE PROSE AND ITS SEARCH BLOB — AND DELIBERATELY NOT `attributes`.
   * Resetting `description` alone would leave the rejected sentence folded into `searchText`,
   * which rebuild-search-text.ts skips without --force, so nothing would ever clean it.
   * ⚠️ BUT ATTRIBUTES ARE LEFT ALONE, after a reviewer pointed out the first version rebuilt them
   * from the title. Every attribute here already passed BOTH gates at write time — the closed list
   * and source grounding — so they are not what failed; the prose is. Rebuilding them from the
   * extractor would silently delete any legitimate feed- or human-supplied value the regex cannot
   * reproduce, which is a data loss this function has no reason to risk.
   * ⚠️ Errors are COUNTED, not swallowed. The first version discarded them and printed
   * "REVERTED: N" regardless — the reassuring-line failure this file keeps having to fix.
   */
  let reverted = 0, failed = 0
  for (let i = 0; i < failures.length; i += 100) {
    await Promise.all(failures.slice(i, i + 100).map(async (f) => {
      const r = f.row
      try {
        await db.listing.update({
          where: { id: r.id },
          data: {
            description: r.title,
            descriptionVi: r.titleVi ?? r.title,
            searchText: buildSearchText([
              r.title, r.titleVi, r.title, r.titleVi ?? r.title,
              r.district, r.location, r.category.name, r.category.nameVi, r.brandSlug, r.model,
            ]),
          },
        })
        reverted++
      } catch (e) { failed++; console.error(`  ${r.id}: ${String(e).slice(0, 80)}`) }
    }))
  }
  console.log(`\nREVERTED: ${reverted} rows${failed ? `  ⛔ ${failed} FAILED to revert` : ''}`)
}

async function main() {
  const rows = (await db.listing.findMany({
    where: {
      seller: { name: SELLER, ownerId: null },
      externalId: { not: null },
      /**
       * ⛔ A NULL SUBCATEGORY DISABLES EVERY SPEC GATE. `isLegalSpec(k, v, null)` falls back to the
       * GLOBAL value list and `specsFor(null)` is empty, so a row with no subcategory would be
       * offered no schema and validated against nothing. Those rows wait for the breadcrumb crawl.
       */
      subcategorySlug: { not: null },
      ...(SUB ? { subcategorySlug: SUB } : {}),
    },
    select: {
      id: true, externalId: true, title: true, titleVi: true, description: true, descriptionVi: true,
      subcategorySlug: true, brandSlug: true, model: true, district: true, location: true,
      attributes: true, category: { select: { name: true, nameVi: true } },
    },
    orderBy: { id: 'asc' },
  })) as Row[]

  /**
   * ⚠️ RESUME COMES FROM THE DATA, NOT A PROGRESS FILE. A row whose description still equals its
   * title has never been described; one that differs has. So an interrupted run simply picks up
   * where it stopped, and a second full run is a no-op — no checkpoint to corrupt, nothing to keep
   * in sync with the database.
   */
  if (VERIFY) { await verify(rows); await db.$disconnect(); return }

  const todo = (REDO ? rows : rows.filter((r) => r.description.trim() === r.title.trim()))
    .slice(0, LIMIT || undefined)
  console.log(`${rows.length} listings under "${SELLER}"${SUB ? ` / ${SUB}` : ''} — ${todo.length} to describe${REDO ? ' (--redo)' : ''}\n`)
  if (!todo.length) { await db.$disconnect(); return }

  // Group by subcategory: the allowed-value block is per-subcategory, and mixing them in one call
  // would send every list every time and invite cross-subcategory spec values.
  const bySub = new Map<string, Row[]>()
  for (const r of todo) {
    const k = r.subcategorySlug ?? '(none)'
    bySub.set(k, [...(bySub.get(k) ?? []), r])
  }

  const ai = makeClient()
  const stats = { described: 0, rejected: 0, batchesDropped: 0, specsAdded: 0, conflicts: 0, ungrounded: 0 }
  const rejectReasons = new Map<string, number>()
  const updates: { id: string; description: string; descriptionVi: string; attributes: string | null; searchText: string }[] = []

  const jobs: (() => Promise<void>)[] = []
  for (const [sub, list] of bySub) {
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH)
      jobs.push(async () => {
        let out: AiItem[] | null = null
        for (let attempt = 0; attempt < 3 && !out; attempt++) {
          try { out = await describeBatch(ai, sub === '(none)' ? '' : sub, batch) }
          catch (e) {
            // ⚠️ Backoff, because a 429 that is retried immediately is just a second 429.
            if (attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
            else console.error(`  batch failed: ${String(e).slice(0, 100)}`)
          }
        }
        if (!out) { stats.batchesDropped++; return }

        const written: typeof updates = []
        const byId = new Map(batch.map((r) => [r.externalId, r]))
        for (const item of out) {
          const row = byId.get(item.id ?? '')
          if (!row) continue
          const deterministic = parseAttrs(row.attributes)
          const { merged, added, conflicts, ungrounded } = reconcileSpecs(
            deterministic, item.specs,
            (k, v) => isLegalSpec(k as SpecKey, v, row.subcategorySlug),
            (k, v) => isGroundedInTitle(k, v, row.title, row.titleVi),
            ALLOW_UNGROUNDED)

          const verdict = guardDescription({
            subcategorySlug: row.subcategorySlug,
            title: row.title, titleVi: row.titleVi,
            attributes: merged,
            descEn: (item.descEn ?? '').trim(),
            descVi: (item.descVi ?? '').trim(),
          })
          if (!verdict.ok) {
            stats.rejected++
            for (const r of verdict.reasons) rejectReasons.set(r.replace(/=.*/, ''), (rejectReasons.get(r.replace(/=.*/, '')) ?? 0) + 1)
            continue
          }
          stats.described++
          stats.specsAdded += added.length
          stats.conflicts += conflicts.length
          stats.ungrounded += ungrounded.length
          const descEn = item.descEn!.trim()
          const descVi = item.descVi!.trim()
          written.push({
            id: row.id, description: descEn, descriptionVi: descVi,
            attributes: Object.keys(merged).length ? JSON.stringify(merged) : null,
            // The canonical 10-part recipe, identical to scripts/rebuild-search-text.ts. Both
            // description columns are in the blob, so new prose REQUIRES a rebuild.
            searchText: buildSearchText([
              row.title, row.titleVi, descEn, descVi,
              row.district, row.location, row.category.name, row.category.nameVi, row.brandSlug, row.model,
            ]),
          })
        }
        updates.push(...written)
        if (!APPLY || !written.length) return
        for (const u of written) {
          const row = byId.get(batch.find((b) => b.id === u.id)?.externalId ?? '')
          if (row) appendFileSync(snap!, `${JSON.stringify({ id: row.id, description: row.description, descriptionVi: row.descriptionVi, attributes: row.attributes })}\n`)
        }
        await Promise.all(written.map((u) => db.listing.update({
          where: { id: u.id },
          data: { description: u.description, descriptionVi: u.descriptionVi, attributes: u.attributes, searchText: u.searchText },
        }).catch((e) => { console.error(`  ${u.id}: ${String(e).slice(0, 80)}`) })))
      })
    }
  }

  /**
   * ⚠️ SNAPSHOT AND WRITE PER BATCH, NOT AT THE END. Buffering 8,782 updates in memory and writing
   * them in one pass means an interruption at 95% loses every call already paid for — and this run
   * takes half an hour. Writing as each batch clears also makes the resume predicate true for the
   * rows already done, so a restart genuinely picks up where it stopped.
   */
  const snap = APPLY ? `data/describe-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl` : null
  if (snap) { writeFileSync(snap, ''); console.log(`snapshot: ${snap}`) }

  console.log(`${jobs.length} batches of up to ${BATCH}, concurrency ${CONCURRENCY}\n`)
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + CONCURRENCY).map((j) => j()))
    const done = Math.min(i + CONCURRENCY, jobs.length)
    if (done % 20 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length} batches · ${stats.described} described · ${stats.rejected} rejected`)
  }

  console.log(`\ndescribed=${stats.described}  rejected=${stats.rejected}  batchesDropped=${stats.batchesDropped}`)
  console.log(`specs added by the model=${stats.specsAdded}  disagreements (regex kept)=${stats.conflicts}`)
  console.log(`ungrounded specs ${ALLOW_UNGROUNDED ? 'WRITTEN (--allow-ungrounded-specs)' : 'refused'}=${stats.ungrounded}`)
  if (rejectReasons.size) console.table([...rejectReasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n))

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Sample:')
    for (const u of updates.slice(0, 3)) {
      const row = todo.find((r) => r.id === u.id)!
      console.log(`\n  ${row.title.slice(0, 62)}`)
      console.log(`  EN: ${u.description}`)
      console.log(`  VI: ${u.descriptionVi}`)
      console.log(`  attrs: ${u.attributes ?? '{}'}`)
    }
    await db.$disconnect(); return
  }

  console.log(`\nAPPLIED: ${updates.length} rows (written per batch)`)
  console.log('⚠️ /listings/[id] caches for 30 DAYS — run the affiliate-prices cron on both editions to flush.')
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
