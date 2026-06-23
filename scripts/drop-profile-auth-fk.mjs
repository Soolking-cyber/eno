// Drop the Profile → auth.users FK so `prisma db push` can run (Prisma can't
// manage the cross-schema constraint, and trips on P4002 while introspecting).
// Re-add it afterwards with scripts/profile-auth-fk.mjs. IDEMPOTENT.
//
// Run:  set -a; . ./.env; set +a; node scripts/drop-profile-auth-fk.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query('alter table public."Profile" drop constraint if exists profile_auth_fk;')
console.log('✓ dropped profile_auth_fk (if it existed) — prisma db push can run now')
await client.end()
