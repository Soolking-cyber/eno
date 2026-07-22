// ONE RESULT DOCUMENT PER CASE — the hard cap, enforced by Postgres. IDEMPOTENT.
//
// The owner: "should be hard cap on reuploads only 1 time result can be uploaded by admin".
// The finished visa PDF is the applicant's identity document; the desk uploads it once and
// the applicant downloads it forever. A second upload is refused, and this script is what
// makes that refusal TRUE RATHER THAN LIKELY.
//
// ⚠️ WHY A CONSTRAINT AND NOT JUST THE ROUTE'S CHECK. The route reads
// visa_documents for an existing `result` row and refuses before it stores anything —
// that is what the desk actually experiences, and it is where the friendly error comes
// from. But a read-then-write is not atomic: two clicks a second apart (a double tap, a
// retried request, two operators) both read "no result yet" and both insert. Only the
// database can decide that race, so it does: the SECOND insert loses on this index and the
// route turns that into the same refusal, after deleting the object it had already
// uploaded. **The race is closed HERE, at `visa_documents_one_result_key`, and nowhere
// else.** The route's pre-check is the courtesy; this index is the guarantee.
//
// SHAPE:
//   · A PARTIAL unique index on (application_id) WHERE kind = 'result'. Partial because the
//     cap is about the RESULT only: a case has two identity images and may have several
//     supporting files, and a plain unique index on (application_id, kind) would happen to
//     cap those too — a different rule, silently introduced, in the same line of DDL.
//   · An INDEX rather than a table constraint: Postgres has no partial UNIQUE constraint,
//     only a partial unique index. It enforces exactly the same thing.
//   · No ON CONFLICT anywhere in the app. The insert is a plain insert; the app treats
//     SQLSTATE 23505 on this index as "already uploaded". Silently upserting would be the
//     one behaviour the owner explicitly ruled out.
//
// ⚠️ RECOVERY FROM A GENUINE MISTAKE, stated because the cap makes it unfixable through the
// product: if the desk uploads the wrong PDF, an admin deletes that row (and its object)
// DIRECTLY — `delete from visa_documents where id = '…' and kind = 'result'`, then remove
// the storage object — and the upload control comes back by itself, because both the
// route's pre-check and this index are simply "does a result row exist". There is no
// bypass, no force flag and no admin "replace" button, and none may be added: a control
// that can overwrite an issued visa is the thing the cap exists to prevent. The PDF
// validation in src/lib/visa/result.ts is what keeps that path rare.
//
// Additive · no foreign key · no Prisma model (visa_documents is a raw Supabase table) →
// safe OUTSIDE the profile_auth_fk push flow, same class as scripts/visa-reference-column.mjs.
//
// Run:  cd /Users/mk1e3/eno.vn && DIRECT_URL="$DIRECT_URL" node scripts/visa-result-unique.mjs
import pg from 'pg'

const INDEX = 'visa_documents_one_result_key'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })

try {
  await client.connect()

  // ── PRE-FLIGHT ────────────────────────────────────────────────────────────────────
  // CREATE UNIQUE INDEX fails outright if the data already violates it, with a message
  // that names one arbitrary duplicate key. That is the correct behaviour and this script
  // must NOT "fix" it — deciding which of two result PDFs is the applicant's real visa is
  // a human call, and deleting the wrong one destroys a document we cannot regenerate.
  // So: look first, and if there are duplicates, report every affected case and stop.
  const { rows: dupes } = await client.query(`
    select application_id, count(*)::int as n
      from public.visa_documents
     where kind = 'result'
     group by application_id
    having count(*) > 1
     order by count(*) desc, application_id
  `)
  if (dupes.length) {
    console.error(`✗ ${dupes.length} case(s) already hold more than one result document — refusing to guess which to keep:`)
    // Case ids and counts only. Nothing here reads a storage path, a filename or a payload.
    for (const row of dupes) console.error(`    ${row.application_id} → ${row.n} result rows`)
    console.error('  Resolve by hand (keep the visa that was actually issued, delete the others + their storage objects), then re-run.')
    process.exit(1)
  }

  await client.query(`
    -- The cap. NOT concurrent: visa_documents is small and this takes a brief lock rather
    -- than the two-phase CONCURRENTLY dance, which cannot run inside a transaction and can
    -- leave an INVALID index behind on failure.
    CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX}
      ON public.visa_documents (application_id)
      WHERE kind = 'result';

    COMMENT ON INDEX public.${INDEX} IS
      'One finished visa PDF per case, forever (owner 2026-07-23). The app refuses a second upload before storing; this index decides the double-click race. Recovery from a wrong upload = delete the row + its storage object by hand.';

    NOTIFY pgrst, 'reload schema';
  `)

  // ── VERIFY WHAT IS ACTUALLY THERE ────────────────────────────────────────────────
  // IF NOT EXISTS is a silent no-op over a pre-existing index of the WRONG shape (the
  // lesson recorded in scripts/visa-reference-column.mjs), and an index that is unique but
  // NOT partial, or partial on the wrong predicate, would look identical from the outside
  // while enforcing a different rule. Assert the definition, not the presence.
  const { rows: idx } = await client.query(`
    select i.indisunique, i.indisvalid, i.indnatts, pg_get_indexdef(i.indexrelid) as def
      from pg_class c
      join pg_index i on i.indrelid = c.oid
      join pg_class ic on ic.oid = i.indexrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relname = 'visa_documents' and ic.relname = '${INDEX}'
  `)
  const problems = []
  if (!idx.length) problems.push(`${INDEX} MISSING`)
  else {
    const [row] = idx
    if (!row.indisunique) problems.push(`${INDEX} is NOT UNIQUE`)
    if (!row.indisvalid) problems.push(`${INDEX} is INVALID`)
    if (row.indnatts !== 1) problems.push(`${INDEX} covers ${row.indnatts} columns, expected 1`)
    if (!/\(application_id\)/.test(row.def)) problems.push(`${INDEX} is not keyed on application_id: ${row.def}`)
    // The predicate is the difference between "one result per case" and "one document per
    // case" — a missing WHERE would break every ordinary passport/portrait upload.
    if (!/WHERE\s+\(?kind\s*=\s*'result'/i.test(row.def)) problems.push(`${INDEX} is missing the kind='result' predicate: ${row.def}`)
  }

  const { rows: [audit] } = await client.query(`
    select count(*) filter (where kind = 'result')::int as results,
           count(distinct application_id) filter (where kind = 'result')::int as cases_with_result
      from public.visa_documents
  `)
  if (audit.results !== audit.cases_with_result) {
    problems.push(`${audit.results} result rows across ${audit.cases_with_result} cases — the cap is not holding`)
  }

  if (problems.length) { console.error(`✗ ${problems.join(' · ')}`); process.exit(1) }
  console.log(`✓ ${INDEX} in place — ${audit.results} case(s) hold a result PDF, one each (partial unique on application_id where kind='result')`)
} catch (e) {
  console.error('FAILED:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
