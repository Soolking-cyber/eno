# prisma/ — schema changes

Loads when working under `prisma/`; moved out of the root CLAUDE.md on 2026-10-18 (the prohibition stays there too).

⛔ **`prisma db push`, `prisma migrate dev`/`reset` and `npm run db:setup` DESTROY DATA. DO NOT RUN THEM.**
`db push` reconciles the DB *to* the schema, so it emits a `DROP` for every table and index Prisma does not
manage. `scripts/db-guard.mjs` refuses the npm forms (`db:push`, `db:setup`, `db:migrate`, `db:reset`) and its
header keeps the 2026-08-03 measurement (67 tables against 52 models, 18 `DROP TABLE`s); a bare `npx prisma …`
runs unchecked. Which tables Prisma does not manage today: the database's own list
(`select tablename from pg_tables where schemaname = 'public'`) minus the models and `@@map`s in `schema.prisma`.
A grep of `scripts/` is not enough: the visa applicant tables and `forum_translations` come from
`apps/forum/supabase/migrations/`, the rate limiter, OTP chain and `next_cache` from `scripts/rate-limit-pg.mjs`,
and some DDL scripts write `create table` in lowercase. Any hand-kept list goes stale with the next feature.
⚠️ `npm run db:ddl` rebuilds only the CORE set (its script list is in package.json). Most feature tables come from
their own `scripts/*-ddl.*` that it does NOT run — 25 on 2026-10-22, e.g. the in-app call tables (`calls-ddl.mjs`),
teachers, job DMs, social, geo, `apple-siwa`, `rum`, `secondhand-pool`. A reset destroys their DATA, which only the
off-box backups bring back — those scripts can at most recreate EMPTY tables, and not every one is idempotent.

## The safe flow — generate SQL, read it, apply only what is additive

1. Drop BOTH cross-schema FKs (`profile_auth_fk`, `visa_applications_user_id_fkey`) — Prisma
   cannot introspect past either, and there are TWO, not one.
2. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
3. **Read the output.** Filter to `ADD COLUMN` / `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT`.
   ⚠️ A Prisma `ALTER TABLE` is MULTI-CLAUSE: matching how a statement *starts* proves nothing
   about its tail. One carried `ALTER COLUMN "unsubscribeToken" DROP DEFAULT` behind the
   `ADD COLUMN`s. Assert on the whole statement, and reject **any** `DROP`, not a list of kinds.
   ⚠️ A `CREATE INDEX` on an EXISTING table does NOT go in the transaction: plain, it blocks
   every write to that table while it builds. Run it as `CREATE INDEX CONCURRENTLY`, alone —
   e.g. `scripts/listing-index-diet-ddl.mjs` owns every partial `Listing` index (`WHERE verified AND status =
   'active'`, speed plan item 9) — Prisma cannot declare one, so `migrate diff` lists them as DROPs: refuse them.
   ⛔ `prisma db push` / `migrate dev` would DROP them outright (on top of the tables Prisma does not manage);
   after any reset, `npm run db:ddl` rebuilds them (`search-index.mjs` for pg_trgm, then
   `listing-index-diet-ddl.mjs --phase=create`).
4. Apply with `psql -v ON_ERROR_STOP=1` inside `BEGIN/COMMIT`, restore both FKs, then
   `node scripts/compliance-ddl.mjs` and the other DDL scripts (`npm run db:ddl` runs the core set),
   then `prisma generate`.
5. **Migrate the DB BEFORE deploying.** Prisma selects every scalar column, so a new revision
   against an old schema throws `42703 undefined_column` on any unscoped query
   (`src/lib/admin.ts:44` is one). New columns are additive, so the old revision is unaffected —
   DB first is always the safe order.
