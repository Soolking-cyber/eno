// Visa service-fee payment schema — IDEMPOTENT, safe to re-run.
// The visa_* tables are raw Supabase tables (no Prisma model), so payment columns
// ship the same way: additive DDL over DIRECT_URL. Nothing here drops or rewrites
// existing data.
//
//   · visa_payments — one row per checkout attempt (audit + webhook idempotency;
//     provider_ref is UNIQUE so a replayed webhook/confirm can never double-record).
//   · visa_applications.paid_at / payment_provider / payment_ref — denormalized
//     "this case is paid" stamp the admin queue and status views read.
//
// Run:  set -a; . ./.env; set +a; node scripts/visa-payment-setup.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

const stmts = [
  `create table if not exists public.visa_payments (
     id uuid primary key default gen_random_uuid(),
     application_id uuid not null references public.visa_applications(id) on delete cascade,
     user_id uuid not null,
     provider text not null,
     provider_ref text not null,
     amount_cents integer not null,
     currency text not null default 'USD',
     status text not null default 'created',
     consent_snapshot_hash text,
     consent_at timestamptz,
     created_at timestamptz not null default now(),
     paid_at timestamptz
   );`,
  // Consent-at-checkout stamps (idempotent for tables created before these existed):
  // the applicant's declaration/authorization is recorded on the PAYMENT row, never
  // inside the encrypted payload (whose shape is a cross-app contract with the forum).
  // The VERSION identifiers are stored too, so the handoff stamps exactly what the
  // applicant accepted — not whatever constant is current at payment time (review #8).
  `alter table public.visa_payments add column if not exists consent_snapshot_hash text;`,
  `alter table public.visa_payments add column if not exists consent_at timestamptz;`,
  `alter table public.visa_payments add column if not exists consent_declaration_version text;`,
  `alter table public.visa_payments add column if not exists consent_authorization_version text;`,
  `create unique index if not exists visa_payments_provider_ref_key on public.visa_payments (provider, provider_ref);`,
  `create index if not exists visa_payments_application_idx on public.visa_payments (application_id);`,
  `alter table public.visa_applications add column if not exists paid_at timestamptz;`,
  `alter table public.visa_applications add column if not exists payment_provider text;`,
  `alter table public.visa_applications add column if not exists payment_ref text;`,
]

for (const sql of stmts) {
  await client.query(sql)
  console.log('✓', sql.replace(/\s+/g, ' ').slice(0, 78))
}

const { rows } = await client.query(
  `select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'visa_applications' and column_name = 'paid_at'`,
)
console.log(rows.length ? '✓ visa payment schema is in place.' : '✗ paid_at column missing — rerun')
await client.end()
