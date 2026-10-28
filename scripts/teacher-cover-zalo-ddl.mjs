#!/usr/bin/env node
// ── Hà Nội's districts (owner, 2026-10-28): the teacher area caps 40 → 60 on an EXISTING database ──
//
//   set -a; . ./.env; set +a; node scripts/teacher-cover-zalo-ddl.mjs
//
// ⛔ RUN ON PRODUCTION BEFORE THE DEPLOY. The app caps a teacher's teach areas and cover areas at 60 since Hà Nội's 12
// districts joined the place list (places.ts MAX_TEACH_AREAS, cover.ts COVER_LIMITS.areas — COVER_AREAS is 48), and
// normalisation now keeps up to 60. A database still holding the 40 CHECKs refuses such a save (23514 → a 500). The new
// bound only LOOSENS: every stored row already passes it, so the current revision is unaffected — database first is
// always the safe order.
// scripts/teachers-ddl.mjs makes both constraints with 60 on a NEW database, but its `if not exists` matches the NAME only,
// so it never touches the two already there. This script does, and ⛔ ONLY WHEN THE WHOLE RULE IS THE ONE IT EXPECTS
// (review, 2026-10-28): each existing constraint's definition must equal — as Postgres itself prints it — teachers-ddl.mjs's
// body with 40 (then it is dropped and made again with 60) or with 60 (then nothing is done). Anything else — a rate
// bound or language limit changed by hand, a cap of another number — is REFUSED and nothing is changed. The two expected
// definitions are printed by THIS database, from a scratch temp table with the same columns (dropped at commit), so no
// rendering rule of pg_get_constraintdef is guessed here. Both are re-read after the change and must equal the 60 form.
// ⚠️ ADD CONSTRAINT validates every row under an ACCESS EXCLUSIVE lock on TeacherProfile (a few hundred rows:
// milliseconds), so everything runs in one short transaction under a 5 s lock_timeout — re-run it in a quieter moment if
// it gives up. src/lib/teachers/cover-zalo-ddl.test.ts compares the bodies with teachers-ddl.mjs and runs `run()` itself
// in PGlite.
//
// Idempotent; safe to re-run any time.
import { pathToFileURL } from 'node:url'

/** [constraint, the CHECK body — teachers-ddl.mjs's, word for word, with the area cap as {CAP}] */
export const WIDEN = [
  [
    'TeacherProfile_cover_bounds',
    `coalesce(cardinality("coverSlots"), 0) <= 21 and coalesce(cardinality("coverAreas"), 0) <= {CAP}
        and ("coverRateVnd" is null or "coverRateVnd" between 0 and 100000000)
        and (not "coverOpen" or (
          coalesce("coverRateVnd", 0) between 50000 and 2000000
          and "coverConsentVersion" is not null
          and coalesce(cardinality("coverSlots"), 0) >= 1 and coalesce(cardinality("coverAreas"), 0) >= 1
          and "coverConsentAt" is not null))`,
  ],
  [
    'TeacherProfile_teach_bounds',
    `coalesce(cardinality("teachAreas"), 0) <= {CAP} and coalesce(cardinality("teachLanguages"), 0) <= 8`,
  ],
]
export const OLD_CAP = 40
export const NEW_CAP = 60

const DEF_SQL = `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conname = $1 AND c.conrelid = $2::regclass`
const body = (check, cap) => check.replace('{CAP}', String(cap))

/**
 * The whole change, in one transaction on `client` (pg.Client, or anything with the same `query(sql, params)`).
 * Returns what it did per constraint ('widened' | 'already'); throws — after ROLLBACK — on anything unexpected.
 */
export async function run(client, log = console.log) {
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    const table = await client.query(`SELECT to_regclass('public."TeacherProfile"') AS t`)
    if (!table.rows[0]?.t) throw new Error('TeacherProfile does not exist — this is not the eno database; rolled back.')
    // A scratch copy of the columns (no constraints, no rows), gone at commit: Postgres prints the expected forms itself.
    await client.query(`CREATE TEMP TABLE "_cover_zalo_shape" (LIKE public."TeacherProfile") ON COMMIT DROP`)
    const forms = new Map()
    /** The definition Postgres prints for `name` with `cap` — made once on the scratch table, then remembered. */
    const printed = async (name, cap) => {
      const scratch = `${name}_${cap}`
      if (!forms.has(scratch)) {
        await client.query(`ALTER TABLE "_cover_zalo_shape" ADD CONSTRAINT "${scratch}" CHECK (${body(WIDEN.find(([n]) => n === name)[1], cap)})`)
        forms.set(scratch, (await client.query(DEF_SQL, [scratch, '"_cover_zalo_shape"'])).rows[0]?.def)
      }
      return forms.get(scratch)
    }
    const did = {}
    for (const [name, check] of WIDEN) {
      const current = (await client.query(DEF_SQL, [name, 'public."TeacherProfile"'])).rows[0]?.def ?? null
      const wanted = await printed(name, NEW_CAP)
      if (current === wanted) { did[name] = 'already'; log(`= ${name} already caps at ${NEW_CAP}`); continue }
      const old = await printed(name, OLD_CAP)
      if (current !== old) {
        throw new Error(`${name} is not the rule this script replaces — found ${current === null ? 'no constraint' : `"${current}"`}, expected the ${OLD_CAP} or ${NEW_CAP} form. Nothing changed; stop and look; rolled back.`)
      }
      await client.query(`ALTER TABLE public."TeacherProfile" DROP CONSTRAINT "${name}"`)
      await client.query(`ALTER TABLE public."TeacherProfile" ADD CONSTRAINT "${name}" CHECK (${body(check, NEW_CAP)})`)
      did[name] = 'widened'
      log(`✓ ${name}: ${OLD_CAP} → ${NEW_CAP}`)
    }
    for (const [name] of WIDEN) {
      const now = (await client.query(DEF_SQL, [name, 'public."TeacherProfile"'])).rows[0]?.def
      if (now !== await printed(name, NEW_CAP)) throw new Error(`${name} does not read back as the ${NEW_CAP} form — rolled back.`)
    }
    await client.query('COMMIT')
    log('✓ committed')
    return did
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  }
}

// Run only when executed (`node scripts/teacher-cover-zalo-ddl.mjs`), never when the test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) {
    console.error('DIRECT_URL or DATABASE_URL required')
    process.exit(1)
  }
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await run(client)
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
