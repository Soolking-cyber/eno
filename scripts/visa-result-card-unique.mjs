// ONE RESULT CARD PER DOCUMENT — the resume-delivery race decider. IDEMPOTENT.
//
// The admin result route (2026-07-23) resumes a failed delivery: on retry, a committed
// document with no chat card gets its card posted for the EXISTING upload instead of the
// desk re-uploading. Two concurrent retries can both read "no card yet" and both insert —
// only the database can decide that race, so it does: the loser's INSERT violates this
// index, insertMessage throws, sendVisaResultCard catches → null → that request answers 503
// WITHOUT sending the thank-you email. Exactly-once email delivery hangs off this line
// (both external reviewers demanded it, dual plan review 2026-07-23).
//
// SHAPE:
//   · A PARTIAL unique EXPRESSION index: metaJson is a TEXT column holding JSON (a plain
//     column on purpose — see the Message model comment), so the key is the extracted
//     documentId, and the WHERE keeps the index to visa_result rows only (a few per year,
//     not the whole messages table).
//   · Every visa_result row is written through insertMessage's validated card path, so the
//     jsonb cast in the expression is safe on live data; the pre-check below proves it
//     before the index is attempted rather than assuming.
//
//   set -a; . ./.env; set +a; node scripts/visa-result-card-unique.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

try {
  // Pre-flight: every visa_result metaJson must parse and carry a documentId, and no
  // documentId may already be duplicated — an index CREATE would fail mid-DDL otherwise.
  const bad = await client.query(`
    select id from "Message" where kind = 'visa_result'
      and ("metaJson" is null or ("metaJson")::jsonb ->> 'documentId' is null)
  `)
  if (bad.rows.length) {
    console.error(`refusing: ${bad.rows.length} visa_result row(s) without a parseable documentId:`, bad.rows.map((r) => r.id))
    process.exit(1)
  }
  const dupes = await client.query(`
    select ("metaJson")::jsonb ->> 'documentId' as doc, count(*) as n
    from "Message" where kind = 'visa_result' group by 1 having count(*) > 1
  `)
  if (dupes.rows.length) {
    console.error('refusing: duplicate result cards already exist:', dupes.rows)
    process.exit(1)
  }

  await client.query(`
    create unique index if not exists message_one_result_card_per_document
      on "Message" ((("metaJson")::jsonb ->> 'documentId'))
      where kind = 'visa_result'
  `)
  const check = await client.query(`select indexdef from pg_indexes where indexname = 'message_one_result_card_per_document'`)
  console.log('index:', check.rows[0]?.indexdef ?? 'MISSING')
} finally {
  await client.end()
}
