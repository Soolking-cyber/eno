// Additive schema migration for the business-verification feature (owner 2026-07-23).
// Applied as targeted raw SQL rather than `prisma db push`, because this repo's
// cross-schema auth.users FKs (profile_auth_fk, visa_applications_user_id_fkey) make a
// full `prisma db push` fail P4002 — the same reason the visa tables are raw-SQL. Purely
// ADDITIVE: four nullable columns on "Seller" + a new "SellerVerification" table. Types
// match Prisma 7's PostgreSQL mapping exactly (verified by a clean `next build`).
// IDEMPOTENT — safe to re-run.
//
// Run:  set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/business-verification-migration.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

try {
  await client.query(`
    alter table "Seller"
      add column if not exists "verifiedIdentityHash" text,
      add column if not exists "verifiedAt" timestamp(3),
      add column if not exists "verifiedUntil" timestamp(3),
      add column if not exists "verifiedBy" text;
  `)
  console.log('✓ Seller verification columns')

  await client.query(`
    create table if not exists "SellerVerification" (
      "id" text primary key,
      "sellerId" text not null,
      "version" integer not null default 1,
      "status" text not null default 'draft',
      "identityHash" text,
      "documents" jsonb not null default '[]',
      "bankNameSeen" text,
      "consentAt" timestamp(3),
      "consentVersion" text,
      "submittedAt" timestamp(3),
      "reviewedAt" timestamp(3),
      "reviewedBy" text,
      "note" text,
      "retentionUntil" timestamp(3),
      "createdAt" timestamp(3) not null default current_timestamp,
      "updatedAt" timestamp(3) not null default current_timestamp,
      constraint "SellerVerification_sellerId_fkey"
        foreign key ("sellerId") references "Seller"("id") on delete cascade on update cascade
    );
  `)
  console.log('✓ SellerVerification table')

  await client.query(`create unique index if not exists "SellerVerification_sellerId_version_key" on "SellerVerification" ("sellerId", "version");`)
  await client.query(`create index if not exists "SellerVerification_status_idx" on "SellerVerification" ("status");`)
  await client.query(`create index if not exists "SellerVerification_sellerId_idx" on "SellerVerification" ("sellerId");`)
  console.log('✓ SellerVerification indexes')

  // ⚠️ ONE verified badge per tax code, enforced by the DATABASE (external review): the
  // approval-time check + stamp are two operations, so only a partial unique index makes
  // "at most one Seller with a live verification stamp per MST" race-proof. approveVerification
  // runs the stamp in a transaction and treats the P2002 here as duplicate_tax.
  await client.query(`create unique index if not exists "Seller_taxCode_verified_key" on "Seller" ("taxCode") where "verifiedIdentityHash" is not null;`)
  console.log('✓ Seller one-badge-per-tax-code partial unique index')

  const cols = await client.query(
    `select column_name from information_schema.columns where table_name = 'Seller' and column_name like 'verified%' order by column_name`,
  )
  console.log('Seller verified* columns now:', cols.rows.map((r) => r.column_name).join(', '))
} finally {
  await client.end()
}
