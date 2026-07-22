// Visa case REFERENCE — the human-facing case number (EV-1042). IDEMPOTENT, safe to
// re-run.
//
// DEPLOY ORDER DOES NOT MATTER HERE, unlike scripts/visa-dm-cols.mjs. The column is purely
// additive and no existing query names it, so running this before the code is harmless;
// running it after is too, because every reader falls back to the old uuid slice for a row
// that has no reference (src/lib/visa/bundle.ts, `visaPackReference`). Prefer BEFORE
// anyway: the fallback is a safety net, not the product.
//
// WHY: the desk, the applicant and the agent all needed one string to say out loud, and
// the first 8 hex of the case uuid ("3f2a91bc") is none of legible, dictatable or ordered.
// `visa_applications.reference` replaces it. The format, the base and the trade-off a
// sequential number carries are all documented in src/lib/visa/reference.ts — read that
// file first; this one only teaches Postgres to issue the same string.
//
// SHAPE, and why each choice:
//   · A SEQUENCE, not `max(reference)+1` and not a uuid. A sequence is the only way to
//     hand out a number that is unique under concurrency without taking a lock, and it is
//     the only one that is MONOTONIC, which is the whole ask ("sequantial also").
//   · TEXT, not the raw integer. The reference is printed on the applicant's email and on
//     the pack an agent files from; storing the rendered string means a later edit to the
//     prefix or the base can never rewrite a number a customer already holds. The two
//     literals below therefore mirror src/lib/visa/reference.ts, and
//     src/lib/visa/reference.test.ts FAILS if they drift.
//   · A COLUMN DEFAULT, so the database assigns it. Both insert paths (the DM flow and
//     the REST route) then get a reference for free — no app change, no race, and no case
//     can be created without one.
//   · UNIQUE + NOT NULL, applied after the backfill. "A case with no reference must not
//     exist" is a constraint here, not a convention.
//   · Additive · nullable-until-backfilled · NO foreign key → safe OUTSIDE the
//     profile_auth_fk push flow, same class as scripts/visa-dm-cols.mjs. visa_applications
//     is a raw Supabase table with no Prisma model, so `prisma db push` never sees it.
//
// Run:  cd /Users/mk1e3/eno.vn && DIRECT_URL="$DIRECT_URL" node scripts/visa-reference-column.mjs
import pg from 'pg'

// ⚠️ THESE TWO LITERALS ARE MIRRORED IN src/lib/visa/reference.ts
// (VISA_REFERENCE_PREFIX / VISA_REFERENCE_BASE) and a unit test compares them by reading
// this file. Change one without the other and references issued by Postgres stop matching
// references rendered by the app — do not "fix" the test by editing only this line.
const REFERENCE_PREFIX = 'EV'
const REFERENCE_BASE = 1000

const SEQUENCE = 'visa_application_reference_seq'
const INDEX = 'visa_applications_reference_key'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

/** The expression the column defaults to: 'EV-' || (1000 + nextval(seq)). */
const DEFAULT_EXPR = `'${REFERENCE_PREFIX}-'::text || (${REFERENCE_BASE} + nextval('public.${SEQUENCE}'::regclass))::text`

const SQL = `
-- One counter for the whole product. START WITH 1 (not with the base): the base is added
-- when the value is RENDERED, so the sequence stays a plain count and the app's
-- formatVisaReference(seq) is the exact inverse of what is stored.
CREATE SEQUENCE IF NOT EXISTS public.${SEQUENCE}
  AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE NO CYCLE;

-- Nullable on the way in; the backfill below and SET NOT NULL at the end close that.
ALTER TABLE public.visa_applications ADD COLUMN IF NOT EXISTS reference text;

-- Tie the sequence's lifetime to the column, so dropping the column (or the table) does
-- not leave an orphaned counter behind that a later re-add would silently restart from.
ALTER SEQUENCE public.${SEQUENCE} OWNED BY public.visa_applications.reference;

-- The default is set BEFORE the backfill on purpose: any case created while this script
-- runs already gets a reference, so the "no case without one" invariant has no window.
ALTER TABLE public.visa_applications ALTER COLUMN reference SET DEFAULT ${DEFAULT_EXPR};

-- ── BACKFILL ────────────────────────────────────────────────────────────────────────
-- Existing cases get their numbers in the order they were opened, so the sequence tells
-- the truth about history as well as about the future.
--
-- The lock protects the block reservation: between taking a range of counter values and
-- writing them, a concurrent INSERT must not be able to draw one out of the middle. In
-- THIS script it is belt-and-braces — the ADD COLUMN above already holds ACCESS EXCLUSIVE
-- for the whole transaction — but it keeps the block correct if it is ever lifted out and
-- run on its own, and it says out loud what the transaction is already doing.
--
-- ⚠️ SO: this script BLOCKS WRITES to visa_applications while it runs. On a small
-- operational table that is milliseconds, once — but run it deliberately, not mid-incident.
DO $do$
DECLARE
  pending bigint;
  block_start bigint;
BEGIN
  LOCK TABLE public.visa_applications IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO pending FROM public.visa_applications WHERE reference IS NULL;
  IF pending = 0 THEN RETURN; END IF;

  block_start := nextval('public.${SEQUENCE}');
  PERFORM setval('public.${SEQUENCE}', block_start + pending - 1, true);

  WITH ordered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) - 1 AS nth
    FROM public.visa_applications
    WHERE reference IS NULL
  )
  UPDATE public.visa_applications AS a
     SET reference = '${REFERENCE_PREFIX}-' || (${REFERENCE_BASE} + block_start + o.nth)
    FROM ordered AS o
   WHERE a.id = o.id;

  RAISE NOTICE 'backfilled % case(s) from ${REFERENCE_PREFIX}-%', pending, ${REFERENCE_BASE} + block_start;
END
$do$;

-- Uniqueness is a property of the sequence already; the index makes it a GUARANTEE (and
-- makes "the desk pasted a reference, find the case" an index lookup rather than a scan).
CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON public.visa_applications (reference);

-- The invariant, enforced. No rewrite: a plain scan under PG12+, on a small table.
ALTER TABLE public.visa_applications ALTER COLUMN reference SET NOT NULL;

-- PostgREST caches the schema; a new column is invisible to supabase-js until it reloads.
-- Supabase installs an event trigger that does this, so this is belt-and-braces — but a
-- column the API cannot see would look exactly like a column that was never added.
NOTIFY pgrst, 'reload schema';
`

const client = new pg.Client({ connectionString: url })
// The backfill RAISEs a NOTICE with how many cases it numbered; node-pg swallows those
// unless someone listens, and "it did nothing" and "there was nothing to do" must not
// look identical on the operator's terminal.
client.on('notice', (notice) => { if (notice.message) console.log(`  · ${notice.message}`) })

try {
  await client.connect()
  // One call = one implicit transaction under the simple query protocol: either every
  // statement lands or none does, so a failure can never leave the column added but
  // unbacked by its constraint.
  await client.query(SQL)

  // ── VERIFY WHAT IS ACTUALLY THERE ───────────────────────────────────────────────
  // ADD COLUMN / CREATE INDEX "IF NOT EXISTS" are silent no-ops over a pre-existing
  // object of the WRONG shape (the soldAt-timestamptz lesson in visa-dm-cols.mjs), so
  // presence is not the assertion — type, nullability, the default expression and the
  // index definition are.
  const problems = []

  const { rows: cols } = await client.query(`
    select data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'visa_applications' and column_name = 'reference'
  `)
  if (!cols.length) problems.push('visa_applications.reference MISSING')
  else {
    const [col] = cols
    if (col.data_type !== 'text') problems.push(`reference is ${col.data_type}, expected text`)
    if (col.is_nullable !== 'NO') problems.push('reference is NULLABLE — the backfill or SET NOT NULL did not take')
    const def = col.column_default || ''
    if (!def.includes(`nextval('${SEQUENCE}'`) && !def.includes(`nextval('public.${SEQUENCE}'`)) {
      problems.push(`reference default does not draw from ${SEQUENCE}: ${def}`)
    }
    if (!def.includes(`'${REFERENCE_PREFIX}-'`)) problems.push(`reference default is missing the '${REFERENCE_PREFIX}-' prefix: ${def}`)
    if (!def.includes(String(REFERENCE_BASE))) problems.push(`reference default is missing the ${REFERENCE_BASE} base: ${def}`)
  }

  const { rows: idx } = await client.query(`
    select i.indisunique, i.indisvalid, i.indnatts, pg_get_indexdef(i.indexrelid) as def
    from pg_class c
    join pg_index i on i.indrelid = c.oid
    join pg_class ic on ic.oid = i.indexrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relname = 'visa_applications' and ic.relname = '${INDEX}'
  `)
  if (!idx.length) problems.push(`${INDEX} index MISSING`)
  else {
    const [row] = idx
    if (!row.indisunique) problems.push(`${INDEX} is NOT UNIQUE`)
    if (!row.indisvalid) problems.push(`${INDEX} is INVALID`)
    if (row.indnatts !== 1 || !/\(reference\)\s*$/.test(row.def)) {
      problems.push(`${INDEX} has an unexpected definition: ${row.def}`)
    }
  }

  // The data itself: every row numbered, every value in the format the app parses, and no
  // duplicates. Counts and the reference range only — nothing here reads applicant data.
  const { rows: [audit] } = await client.query(`
    select count(*)::int as total,
           count(*) filter (where reference is null)::int as unnumbered,
           count(*) filter (where reference !~ '^${REFERENCE_PREFIX}-[1-9][0-9]*$')::int as malformed,
           count(distinct reference)::int as distinct_refs,
           -- NUMERIC extremes, not lexicographic: 'EV-9999' sorts above 'EV-10000' as text.
           min(((regexp_match(reference, '^${REFERENCE_PREFIX}-([1-9][0-9]*)$'))[1])::bigint) as lowest,
           max(((regexp_match(reference, '^${REFERENCE_PREFIX}-([1-9][0-9]*)$'))[1])::bigint) as highest
    from public.visa_applications
  `)
  if (audit.unnumbered > 0) problems.push(`${audit.unnumbered} case(s) still have no reference`)
  if (audit.malformed > 0) problems.push(`${audit.malformed} reference(s) do not match ${REFERENCE_PREFIX}-<digits>`)
  if (audit.total !== audit.distinct_refs) problems.push(`${audit.total} cases but only ${audit.distinct_refs} distinct references`)

  // ⚠️ THE COUNTER MUST BE AHEAD OF THE DATA. A sequence that was dropped and recreated
  // (or reset) while the numbered rows survived hands the NEXT insert a reference that is
  // already taken — which surfaces as a unique-violation on a real applicant's very first
  // save, long after this script has been forgotten. Cheap to check, invisible otherwise.
  if (audit.highest !== null && audit.highest !== undefined) {
    const { rows: [seq] } = await client.query(`select last_value, is_called from public.${SEQUENCE}`)
    const issued = seq.is_called ? BigInt(seq.last_value) : BigInt(seq.last_value) - 1n
    const highestSeq = BigInt(audit.highest) - BigInt(REFERENCE_BASE)
    if (issued < highestSeq) {
      problems.push(`${SEQUENCE} is at ${issued} but ${REFERENCE_PREFIX}-${audit.highest} is already issued — the next insert would collide`)
    }
  }

  if (problems.length) { console.error(`✗ ${problems.join(' · ')}`); process.exit(1) }
  const range = audit.total ? `, ${REFERENCE_PREFIX}-${audit.lowest} … ${REFERENCE_PREFIX}-${audit.highest}` : ''
  console.log(`✓ visa_applications.reference in place — ${audit.total} case(s) numbered${range} (unique, not null, default from ${SEQUENCE})`)
} catch (e) {
  console.error('FAILED:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
