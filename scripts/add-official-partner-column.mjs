/**
 * ADD `Seller.officialPartner` — ONE ADDITIVE COLUMN, IN A TRANSACTION.
 *
 *   node --env-file=.env scripts/add-official-partner-column.mjs           # dry run
 *   node --env-file=.env scripts/add-official-partner-column.mjs --apply
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN `prisma db push` OR `npm run db:setup`: both reconcile the DATABASE
 * to the schema, and this database holds 67 tables against 52 Prisma models — so both generate ~18
 * `DROP TABLE`s for everything Prisma does not manage, including `visa_applications` (live applicant
 * PII), the Postgres rate limiter and the rotating Zalo OAuth chain. They are banned here. See
 * CLAUDE.md → "SCHEMA CHANGES".
 *
 * ⚠️ WHY NOT THE DOCUMENTED `prisma migrate diff` FLOW EITHER: that flow starts by DROPPING two
 * cross-schema foreign keys (`profile_auth_fk`, `visa_applications_user_id_fkey`) purely so Prisma
 * can introspect — a real production mutation performed to answer a question. The question was
 * answered read-only instead, by diffing `information_schema.columns` against the model
 * (2026-08-10): all 31 live "Seller" columns match the Prisma scalars exactly, nothing exists live
 * that Prisma does not know about, and the ONLY delta is this column. With the diff empty in both
 * directions, the generated script could not have contained anything but the statement below, so
 * the FK drop would have bought nothing. If you add a column here later, re-run that comparison
 * rather than assuming this still holds.
 *
 * SAFE AGAINST A RUNNING DEPLOY: adding a nullable-with-default column is additive, so the revision
 * currently serving traffic — which never selects it — is unaffected. Migrate BEFORE deploying the
 * code that reads it; the reverse order throws `42703 undefined_column` on Prisma's scalar selects.
 *
 * REVERSAL: `ALTER TABLE "Seller" DROP COLUMN "officialPartner";` — safe only once no deployed
 * revision selects it, i.e. after rolling the code back first.
 */
import { Client } from 'pg'

const APPLY = process.argv.includes('--apply')
const DB = process.env.DIRECT_URL
if (!DB) {
  console.error('Missing DIRECT_URL — run with node --env-file=.env')
  process.exit(1)
}

const SQL = `alter table "Seller" add column if not exists "officialPartner" boolean not null default false`

const c = new Client({ connectionString: DB })
await c.connect()
try {
  const before = await c.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'Seller' and column_name = 'officialPartner'`,
  )
  // ⚠️ NO `process.exit()` BELOW — it skips `finally`, so an early out would leave the pg client
  // open. Short-lived enough not to matter here; written clean because the habit does.
  if (before.rows.length) {
    console.log('Column already present — nothing to do.')
  } else {
    console.log(`${APPLY ? 'APPLYING' : 'DRY RUN — would apply'}:\n  ${SQL};`)

    if (!APPLY) {
      console.log('\nRe-run with --apply to write.')
    } else {
      await c.query('BEGIN')
      await c.query(SQL)
      // Verify INSIDE the transaction: a COMMIT that silently did nothing is the failure mode a
      // migration script exists to rule out, and after COMMIT it is too late to roll back.
      const after = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'Seller' and column_name = 'officialPartner'`,
      )
      if (!after.rows.length) throw new Error('column absent after ADD COLUMN — rolling back')
      await c.query('COMMIT')

      const r = after.rows[0]
      console.log(`\nDone: officialPartner ${r.data_type} ${r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} default ${r.column_default}`)
      console.log('Next: npx prisma generate, then deploy the code that reads it.')
    }
  }
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('FAILED, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
