// Visa-in-DM foundation columns — the one-tap e-Visa flow renders INSIDE a direct
// message thread, so the timeline needs two things the messaging schema never had:
//
//   1. "Message"."metaJson"            — the structured card payload (JSON string)
//      behind kind 'visa_step' / 'visa_checkout'. NULL for 'text' and 'offer'.
//      ⚠️ Holds NO passport data by construction: ids, step numbers, a money amount
//      and payload FIELD NAMES only (validated on write in src/lib/messages.ts).
//      The applicant's answers stay in the ENCRYPTED visa_applications payload.
//   2. "Conversation"."visaApplicationId" — binds ONE thread to ONE case, so a card
//      can only ever speak for the application its thread is bound to (that binding
//      is the anti-spoofing anchor: src/lib/messages.ts refuses any card whose
//      metaJson.applicationId doesn't equal this column).
//
// Deliberately a plain UUID SCALAR with NO foreign key: visa_applications lives
// outside the Prisma datamodel (Supabase-side, reached over PostgREST with the
// service role), so there is nothing for Prisma to reference. Additive + nullable +
// FK-free is also what makes this safe to apply OUTSIDE the profile_auth_fk push
// flow — same class as the sold-attribution scalars (scripts/sold-attribution-cols.mjs).
//
// `kind` needs no DDL at all: it is already a plain TEXT column with a 'text'
// default, not a DB enum, so the two new kinds are a code-only change.
//
// Mirrored in prisma/schema.prisma (Conversation.visaApplicationId, Message.metaJson).
// IDEMPOTENT — re-apply after any DB reset.
//
// ⛔ DEPLOY ORDER IS LOAD-BEARING — RUN THIS AGAINST PROD *BEFORE* THE CODE SHIPS.
// src/lib/messages.ts now names "metaJson" in the INSERT…RETURNING of EVERY message
// (text and offer included). Deploying that code against a database without the
// column takes ALL messaging down, not just visa. Same ordering rule as every other
// column script here — DDL first, then the deploy.
//
// Run:  cd /Users/mk1e3/eno.vn && DIRECT_URL="$DIRECT_URL" node scripts/visa-dm-cols.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })

const SQL = `
-- Structured card payload for kind='visa_step' | 'visa_checkout'. TEXT (not JSONB):
-- Prisma maps \`String?\` to text, and a jsonb here would read as schema drift on the
-- next \`prisma db push\`. The app parses/validates it — Postgres never queries into it.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "metaJson" TEXT;
-- The visa case this thread is bound to (public.visa_applications.id). Scalar, no FK:
-- that table is not in the Prisma datamodel, and a dangling id must degrade to "no
-- visa thread", never block a conversation write.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "visaApplicationId" UUID;
`

// UNIQUE, not a plain index: at most ONE thread per case. Postgres treats NULLs as
// distinct in a unique index, so every ordinary (non-visa) conversation still fits —
// this constrains only bound threads. It also makes the payment-confirm callback's
// application→thread lookup unambiguous instead of "some conversation, probably".
// ⚠️ Name matches Prisma's default for a field-level `@unique`, which IS declared on
// the model — otherwise `prisma db push` would drop it on the next run.
const INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_visaApplicationId_key"
  ON "Conversation" ("visaApplicationId");
`

try {
  await client.connect()
  await client.query(SQL)
  await client.query(INDEX_SQL)
  // Verify TYPE + NULLABILITY, not just presence: ADD COLUMN IF NOT EXISTS is a
  // silent no-op over a pre-existing column of the WRONG type, which would then read
  // as drift on the next `prisma db push` (the soldAt timestamptz lesson).
  const expected = {
    'Message.metaJson': { data_type: 'text', is_nullable: 'YES' },
    'Conversation.visaApplicationId': { data_type: 'uuid', is_nullable: 'YES' },
  }
  const { rows } = await client.query(`
    select table_name, column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'Message' and column_name = 'metaJson')
        or (table_name = 'Conversation' and column_name = 'visaApplicationId')
      )
    order by table_name, column_name;
  `)
  const problems = []
  for (const [key, want] of Object.entries(expected)) {
    const [table, column] = key.split('.')
    const row = rows.find((r) => r.table_name === table && r.column_name === column)
    if (!row) { problems.push(`${key} MISSING`); continue }
    if (row.data_type !== want.data_type) problems.push(`${key} is ${row.data_type}, expected ${want.data_type}`)
    if (row.is_nullable !== want.is_nullable) problems.push(`${key} is_nullable=${row.is_nullable}, expected ${want.is_nullable}`)
  }
  // Same trap as the columns: CREATE INDEX IF NOT EXISTS is a no-op over a
  // SAME-NAMED index of a different definition. Assert what it actually IS —
  // unique, valid, and keyed on exactly this one column.
  const { rows: idx } = await client.query(`
    select i.indisunique, i.indisvalid, i.indnatts,
           pg_get_indexdef(i.indexrelid) as def
    from pg_class c
    join pg_index i on i.indrelid = c.oid
    join pg_class ic on ic.oid = i.indexrelid
    where c.relnamespace = 'public'::regnamespace
      and c.relname = 'Conversation' and ic.relname = 'Conversation_visaApplicationId_key';
  `)
  if (!idx.length) problems.push('Conversation_visaApplicationId_key index MISSING')
  else {
    const [row] = idx
    if (!row.indisunique) problems.push('Conversation_visaApplicationId_key is NOT UNIQUE')
    if (!row.indisvalid) problems.push('Conversation_visaApplicationId_key is INVALID')
    if (row.indnatts !== 1 || !/\("visaApplicationId"\)\s*$/.test(row.def)) {
      problems.push(`Conversation_visaApplicationId_key has unexpected definition: ${row.def}`)
    }
  }
  if (problems.length) { console.error(`✗ ${problems.join(' · ')}`); process.exit(1) }
  console.log(`✓ visa-dm columns applied: ${rows.map((r) => `${r.table_name}.${r.column_name} (${r.data_type}, nullable=${r.is_nullable})`).join('; ')} + unique index`)
} catch (e) {
  console.error('FAILED:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
