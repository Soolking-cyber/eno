// Add Listing."descriptionVi" — ADDITIVE ONLY. ⛔ never `prisma db push` here (18 DROP TABLEs).
import 'dotenv/config'
import pg from 'pg'
const APPLY = process.argv.includes('--apply')
const SQL = 'ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "descriptionVi" TEXT'
if (/\b(DROP|TRUNCATE|DELETE)\b/i.test(SQL)) { console.error('refusing'); process.exit(1) }
const c = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
await c.connect()
const { rows: [w] } = await c.query('select current_database() db')
console.log(`target: ${w.db}\n  ${APPLY ? 'RUN ' : 'PLAN'} ${SQL}`)
if (APPLY) await c.query(SQL)
const { rows } = await c.query(`select column_name from information_schema.columns where table_name='Listing' and column_name='descriptionVi'`)
console.log(rows.length ? '  present: Listing.descriptionVi' : '  NOT PRESENT')
await c.end()
