#!/usr/bin/env node
/**
 * REFUSES THE SCHEMA COMMANDS THAT DESTROY THIS DATABASE.
 *
 * ⚠️ WHY A GUARD AND NOT JUST A DOC. `CLAUDE.md` has said "DO NOT RUN THEM" since 2026-08-03, and
 * `docs/` went on teaching `prisma db push` as the canonical schema-change flow in nineteen places
 * — including `README.md`, the first file anyone opens. A rule that lives only in prose protects
 * only the people who already know it. This protects the person who read the docs and did what
 * they said.
 *
 * ⚠️ WHAT ACTUALLY HAPPENS. Measured 2026-08-03: the database holds 67 tables against 52 Prisma
 * models. `db push` reconciles the DATABASE to the SCHEMA, so it generates 18 `DROP TABLE`
 * statements for everything Prisma does not manage:
 *   visa_applications (LIVE APPLICANT PII) · visa_events · visa_documents · visa_payments
 *   next_cache (~8k rows) · rl_window / rl_cooldown (the Postgres rate limiter)
 *   zalo_oauth_token (the rotating OTP chain) · ListingImageHash · PlaceGeocode
 *   forum_translations
 * None of that is recoverable from the schema, and the flow was safe when it was written — it
 * became lethal as tables were added outside Prisma, silently, with no error to notice.
 *
 * ⚠️ THE SAFE FLOW IS NOT "THE SAME THING, CAREFULLY". It generates the SQL, has a human read it,
 * and applies only the additive statements. It is spelled out below and in CLAUDE.md.
 *
 * ⚠️ THE DDL HALF OF `db:setup` WAS NEVER THE PROBLEM AND IS STILL AVAILABLE as `npm run db:ddl`.
 * `db:setup` was `prisma db push && <five DDL scripts>`; only the prefix was destructive. Those
 * scripts re-apply the realtime triggers, unique indexes, rate-limiter functions and compliance
 * objects that Prisma does not manage, and they are exactly what an operator needs after a restore.
 * Splitting them means the safe half no longer has to be reached through the unsafe one.
 */

const cmd = process.argv[2] ?? 'this command'

// A deliberately unpleasant name. Anyone typing it has read why.
const OVERRIDE = 'ENO_I_HAVE_READ_THE_DROP_LIST'

if (process.env[OVERRIDE] === 'yes-drop-18-tables') {
  console.error(
    `\n⚠️  ${OVERRIDE} is set — running ${cmd} anyway.\n` +
      '   You are asserting you have read the generated SQL and accept the DROP statements in it.\n',
  )
  process.exit(0) // the npm script chains the real command after this guard
}

console.error(`
────────────────────────────────────────────────────────────────────────────────
  REFUSED: ${cmd}

  \`prisma db push\` reconciles the DATABASE to the SCHEMA. This database holds 67
  tables against 52 Prisma models, so it emits 18 DROP TABLE statements — including
  visa_applications (live applicant PII), the Postgres rate limiter (rl_window,
  rl_cooldown), the rotating OTP chain (zalo_oauth_token), and next_cache.

  Measured 2026-08-03. This flow was safe when it was written and became lethal as
  tables were added outside Prisma. There is no warning from Prisma itself.

  THE SAFE FLOW — generate the SQL, read it, apply only what is additive:

    1. Drop BOTH cross-schema FKs (profile_auth_fk, visa_applications_user_id_fkey).
       Prisma cannot introspect past either, and there are TWO, not one.
    2. npx prisma migrate diff --from-config-datasource \\
         --to-schema prisma/schema.prisma --script
    3. READ the output. Keep ADD COLUMN / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT.
       ⚠️ A Prisma ALTER TABLE is MULTI-CLAUSE — how a statement STARTS proves nothing
       about its tail. Reject any statement containing DROP, not a list of kinds.
    4. Apply with psql -v ON_ERROR_STOP=1 inside BEGIN/COMMIT, restore both FKs, then
       run \`npm run db:ddl\`, then \`npx prisma generate\`.
    5. Migrate the DB BEFORE deploying. Prisma selects every scalar column, so a new
       revision against an old schema throws 42703 on any unscoped query.

  Full detail: CLAUDE.md → "SCHEMA CHANGES".

  If you only wanted to re-apply the non-Prisma DDL (realtime triggers, unique
  indexes, rate-limiter functions, compliance objects) — that half was never
  destructive and is now its own command:

    npm run db:ddl

  To override anyway, having read the generated SQL:
    macOS / Linux   ${OVERRIDE}=yes-drop-18-tables npm run ${cmd}
    PowerShell      $env:${OVERRIDE}='yes-drop-18-tables'; npm run ${cmd}
    cmd.exe         set ${OVERRIDE}=yes-drop-18-tables && npm run ${cmd}
────────────────────────────────────────────────────────────────────────────────
`)
process.exit(1)
