// Apply the Profile → auth.users foreign key + RLS that Prisma can't manage
// (Prisma doesn't know the Supabase `auth` schema). IDEMPOTENT — safe to re-run,
// and MUST be re-applied after any `prisma migrate reset` (db push leaves it intact).
//
// Run:  set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/profile-auth-fk.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

const stmts = [
  // FK with cascade: deleting the auth user removes their Profile.
  `do $$ begin
     if not exists (select 1 from pg_constraint where conname = 'profile_auth_fk') then
       alter table public."Profile"
         add constraint profile_auth_fk foreign key (id) references auth.users(id) on delete cascade;
     end if;
   end $$;`,
  // RLS: a user can READ only their own profile. No INSERT/UPDATE/DELETE path from the API roles —
  // every write goes through the server (Prisma as a BYPASSRLS role, or the admin client).
  // ⛔ NO UPDATE POLICY (security review 2026-10-22). `profile_update_own` used to let the row's owner
  // UPDATE it through PostgREST at sb.eno.vn/rest/v1 with no column limit, and Profile carries columns
  // the server trusts: enforcementState/enforcementUntil (the posting, messaging and relist gates read
  // them), trustScore/trustTier, falseReportStrikes/reportCooldownUntil, email (isStaffProfile) and
  // the tos* acceptance record. No browser code writes Profile, so nothing legitimate used the policy.
  // Re-creating it — or granting UPDATE to anon/authenticated — reopens that hole; rls-guard.sql step 4
  // now fails on either.
  `alter table public."Profile" enable row level security;`,
  `drop policy if exists profile_select_own on public."Profile";`,
  `create policy profile_select_own on public."Profile"
     for select using ((select auth.uid()) = id);`,
  `drop policy if exists profile_update_own on public."Profile";`,
  // Role-checked: a bare REVOKE … FROM anon aborts on a non-Supabase target (CI, a bare restore).
  `do $$ begin
     if to_regrole('anon') is not null then
       revoke insert, update, delete, truncate on public."Profile" from anon;
     end if;
     if to_regrole('authenticated') is not null then
       revoke insert, update, delete, truncate on public."Profile" from authenticated;
     end if;
   end $$;`,
]

for (const sql of stmts) {
  await client.query(sql)
  console.log('✓', sql.split('\n')[0].slice(0, 70))
}

// Sanity: confirm the FK exists.
const { rows } = await client.query(
  `select conname from pg_constraint where conname = 'profile_auth_fk'`,
)
console.log(rows.length ? '\n✓ Profile → auth.users FK is in place.' : '\n✗ FK MISSING')
await client.end()
