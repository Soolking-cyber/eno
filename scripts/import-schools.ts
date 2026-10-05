/**
 * The /schools directory: English centres, international and bilingual schools, recruiters and
 * universities in Ho Chi Minh City (2026-10-04).
 *
 *   npx tsx scripts/import-schools.ts                          # DRY RUN — validates and reports, writes nothing
 *   npx tsx scripts/import-schools.ts --apply                  # performs the writes in ONE transaction, journals them
 *   npx tsx scripts/import-schools.ts --apply --prune-aliases  # also removes a school's aliases the file no longer lists
 *
 * Data: data/schools/hcmc.json — compiled from the school's own site wherever it has one, otherwise from
 * the job boards, directories and news pages cited per entry in `sourceUrls` (every fact has its source
 * there). A correction is: edit the file, re-run.
 * ⛔ --apply REFUSES TO RUN IF ANY ENTRY IS REFUSED: a malformed entry must stop the import, not quietly
 * drop out of it while the run reports success.
 *
 * ⛔ IDEMPOTENT ON `slug`. A re-run refreshes the directory facts (name, kind, website, districts,
 * curricula, summary, sources) and never creates a second row. `status` is CREATE-ONLY: a moderator's
 * hide survives a refresh.
 * ⛔ NOTHING IS EVER DELETED. A school missing from the file is REPORTED; hiding it is the admin
 * Directory tab. A truncated data file must not wipe the reviews hanging off a school.
 * ⛔ AN ALIAS NEVER MOVES. Aliases are how job ads find their school (exact normalised match,
 * src/lib/schools/logic.ts normEmployer); one already owned by another school is a conflict — the dry run
 * reports it and --apply refuses the whole file — because silently re-pointing it would move that school's
 * open jobs onto this one.
 * Validation (what makes an entry acceptable) is src/lib/schools/import-entries.ts.
 */
import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { db } from '../src/lib/db'
import { readEntries } from '../src/lib/schools/import-entries'

const APPLY = process.argv.includes('--apply')
const PRUNE_ALIASES = process.argv.includes('--prune-aliases')
const FILE = join(process.cwd(), 'data/schools/hcmc.json')

async function main() {
  const { rows, refused: bad } = readEntries(JSON.parse(readFileSync(FILE, 'utf8')))
  for (const b of bad) console.log(`✗ refused #${b.at} ${b.name}: ${b.why.join('; ')}`)
  const refused = bad.length

  if (refused && APPLY) {
    console.error(`✗ ${refused} entr${refused === 1 ? 'y was' : 'ies were'} refused — fix the file; nothing was written.`)
    process.exitCode = 1
    return
  }

  const existing = await db.school.findMany({ select: { id: true, slug: true, name: true, kind: true, website: true, districts: true, curricula: true, summary: true, summaryVi: true, sourceUrls: true } })
  const bySlug = new Map(existing.map((s) => [s.slug, s]))
  const allAliases = await db.schoolAlias.findMany({ select: { alias: true, schoolId: true } })
  const owned = new Map(allAliases.map((a) => [a.alias, a.schoolId]))

  // Which database, without credentials — a scratch-DB preview import must never read as a production one.
  // DATABASE_URL — the variable src/lib/db.ts actually connects with, so the journal names the right database.
  const dbHost = (() => { try { const u = new URL(process.env.DATABASE_URL || ''); return `${u.hostname}:${u.port || 5432}${u.pathname}` } catch { return 'unknown' } })()
  const journal = { at: new Date().toISOString(), db: dbHost, apply: APPLY, created: [] as string[], updated: [] as { slug: string; fields: string[] }[], aliasesAdded: 0, aliasesPruned: [] as string[], aliasesNotInFile: [] as string[], aliasConflicts: [] as string[], missingFromFile: [] as string[], fromSuggestions: [] as string[] }
  // ⛔ ONE TRANSACTION: a uniqueness error or a dropped connection half-way leaves NOTHING applied, never a
  // prefix of the file. (A dry run reads only; the same plan code runs against a read-only callback.)
  const plan = async (tx: Pick<typeof db, 'school' | 'schoolAlias'> | null) => {
    // Pass 1 — an alias of a school that the file no longer lists for it: reported, or with --prune-aliases
    // removed FIRST, so the same file can hand it to another school in pass 2 (it never vanishes in between).
    for (const r of rows) {
      const prev = bySlug.get(r.slug)
      if (!prev) continue
      for (const a of allAliases.filter((x) => x.schoolId === prev.id && !r.aliases.includes(x.alias))) {
        if (PRUNE_ALIASES) { journal.aliasesPruned.push(`${a.alias} (${r.slug})`); owned.delete(a.alias); if (tx) await tx.schoolAlias.delete({ where: { alias: a.alias } }) }
        else journal.aliasesNotInFile.push(`${a.alias} (${r.slug})`)
      }
    }
    // Pass 2 — the schools and their new aliases.
    for (const r of rows) {
      const prev = bySlug.get(r.slug)
      // Only what the file SAYS: an absent field never blanks an existing school (codex, diff review).
      const said = <T,>(k: string, v: T | undefined) => (v === undefined ? {} : { [k]: v })
      const data = { name: r.name, kind: r.kind, ...said('website', r.website), ...said('districts', r.districts), ...said('curricula', r.curricula), ...said('summary', r.summary), ...said('sourceUrls', r.sourceUrls), ...said('summaryVi', r.summaryVi) } as {
        name: string; kind: string; website?: string | null; districts?: string[]; curricula?: string[]; summary?: string; sourceUrls?: string[]; summaryVi?: string | null
      }
      let id = prev?.id
      if (!prev) {
        journal.created.push(r.slug)
        if (tx) id = (await tx.school.create({ data: { slug: r.slug, ...data }, select: { id: true } })).id
      } else {
        const fields = (Object.keys(data) as (keyof typeof data)[]).filter((k) => JSON.stringify(prev[k as keyof typeof prev]) !== JSON.stringify(data[k]))
        if (fields.length) {
          journal.updated.push({ slug: r.slug, fields })
          if (tx) await tx.school.update({ where: { id: prev.id }, data })
        }
      }
      for (const a of r.aliases) {
        const holder = owned.get(a)
        if (holder && holder !== id) { journal.aliasConflicts.push(`${a} (wanted by ${r.slug})`); continue }
        if (holder) continue
        journal.aliasesAdded++
        if (tx && id) { await tx.schoolAlias.create({ data: { alias: a, schoolId: id } }); owned.set(a, id) }
      }
    }
    // ⛔ A conflict means the file and the database disagree about which school an alias names: on --apply
    // that rolls the whole transaction back (codex, diff review) instead of reporting success.
    if (tx && journal.aliasConflicts.length) throw new Error(`alias conflicts — nothing applied: ${journal.aliasConflicts.join(', ')} (move them with --prune-aliases, or fix the file)`)
  }
  // ~170 schools and ~900 alias rows go one round trip at a time; through the SSH tunnel to prod that can pass two
  // minutes, and a timeout would roll back a correct import. Nothing else writes these tables.
  if (APPLY) await db.$transaction(async (tx) => plan(tx), { timeout: 600_000, maxWait: 10_000 })
  else await plan(null)
  const inFile = new Set(rows.map((r) => r.slug))
  journal.missingFromFile = existing.filter((s) => !inFile.has(s.slug)).map((s) => s.slug)
  // A school a moderator added from a teacher's suggestion (/admin/schools → Suggested schools) is not in the file
  // by construction: said apart, so a real gap is not lost among them. Pass 1 never prunes their aliases (it only
  // reads schools the file lists).
  // After an --apply has committed, so a missing table (a database the suggestions DDL has not reached) must not throw
  // the journal away (diff review): "table does not exist" reads as no suggestions.
  const suggestions = await db.schoolSuggestion.findMany({ where: { status: 'added' }, select: { school: { select: { slug: true } } } })
    .catch((e: unknown) => { if ((e as { code?: string })?.code === 'P2021') return []; throw e })
  const suggested = new Set(suggestions.flatMap((x) => (x.school ? [x.school.slug] : [])))
  journal.fromSuggestions = journal.missingFromFile.filter((s) => suggested.has(s))
  journal.missingFromFile = journal.missingFromFile.filter((s) => !suggested.has(s))

  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${rows.length} valid, ${refused} refused · ${journal.created.length} new, ${journal.updated.length} updated, ${journal.aliasesAdded} aliases added`)
  if (journal.aliasConflicts.length) console.log(`⛔ alias conflicts — --apply refuses the whole file until they are fixed: ${journal.aliasConflicts.join(', ')}`)
  if (journal.aliasesNotInFile.length) console.log(`⚠️ aliases no longer in the file (kept; --prune-aliases removes them): ${journal.aliasesNotInFile.join(', ')}`)
  if (journal.aliasesPruned.length) console.log(`${APPLY ? 'pruned' : 'WOULD prune (dry run — nothing deleted)'} aliases: ${journal.aliasesPruned.join(', ')}`)
  if (journal.missingFromFile.length) console.log(`⚠️ in the database but not the file (NOT touched; hide in /admin/schools if gone): ${journal.missingFromFile.join(', ')}`)
  if (journal.fromSuggestions.length) console.log(`ℹ️ added from teachers' suggestions, not in the file yet (copy them in under the same slug to keep it whole): ${journal.fromSuggestions.join(', ')}`)
  if (APPLY) {
    // After the commit: the writes happened, so a journal that cannot be saved is PRINTED instead of lost.
    try {
      const dir = join(homedir(), 'eno-import-journals', 'schools')
      mkdirSync(dir, { recursive: true })
      const f = join(dir, `${journal.at.replace(/[:.]/g, '-')}-${dbHost.replace(/[^a-z0-9]+/gi, '_')}.json`)
      writeFileSync(f, JSON.stringify(journal, null, 2))
      console.log(`journal: ${f}`)
    } catch (e) {
      console.error('⚠️ journal could not be saved — here it is:', e)
      console.log(JSON.stringify(journal, null, 2))
    }
  }
}

if (process.argv[1]?.endsWith('import-schools.ts')) {
  main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
}
