// Add Seller."bannerUrl" — ADDITIVE ONLY.
//
// ⛔ NEVER `prisma db push` OR `npm run db:setup` ON THIS DATABASE. Measured: db push emits
// 18 DROP TABLE statements here, including visa_applications (live applicant PII), because the
// database carries 67 tables against 52 Prisma models. The safe shape is this: one idempotent
// ADD COLUMN IF NOT EXISTS, printed before it runs, verified against information_schema after.
//
//   node scripts/banner-field-ddl.mjs            # prints the plan
//   node scripts/banner-field-ddl.mjs --apply
import 'dotenv/config'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const STATEMENTS = ['ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "bannerUrl" TEXT']

// A belt-and-braces refusal: nothing destructive can ride along in this file unnoticed.
for (const sql of STATEMENTS) {
  if (/\b(DROP|TRUNCATE|DELETE)\b/i.test(sql)) { console.error(`refusing: ${sql}`); process.exit(1) }
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('DIRECT_URL / DATABASE_URL required'); process.exit(1) }
const client = new pg.Client({ connectionString: url })
await client.connect()
const { rows: [who] } = await client.query('select current_database() db, inet_server_addr()::text host')
console.log(`target: ${who.db} @ ${who.host ?? 'local socket'}`)
for (const sql of STATEMENTS) {
  console.log(`  ${APPLY ? 'RUN ' : 'PLAN'} ${sql}`)
  if (APPLY) await client.query(sql)
}
const { rows } = await client.query(
  `select column_name, data_type, is_nullable from information_schema.columns
    where table_name = 'Seller' and column_name = 'bannerUrl'`,
)
console.log(rows.length ? `  present: ${rows[0].column_name} ${rows[0].data_type} nullable=${rows[0].is_nullable}` : '  NOT PRESENT')
await client.end()
if (!APPLY) console.log('\nDry run. Re-run with --apply.')
