// One-time: provision a Profile for every existing Supabase auth user (so users
// who signed up before the Profile table existed don't 404). Idempotent.
//
// Uses raw pg (repo script convention) — the old `@prisma/client` import was dead in
// this repo (Prisma 7 generator emits only src/generated/prisma; audit 2026-07-18, P0).
//
// Run:  set -a; . ./.env; set +a; node scripts/backfill-profiles.mjs

import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})
const db = new pg.Client({ connectionString: url })
await db.connect()

function normalizePhone(raw) {
  const d = (raw || '').replace(/\D/g, '')
  if (d.startsWith('84')) return `+${d}`
  if (d.startsWith('0')) return `+84${d.slice(1)}`
  return d ? `+${d}` : ''
}

let page = 1
let total = 0
for (;;) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) { console.error(error.message); break }
  const users = data.users
  if (users.length === 0) break

  for (const u of users) {
    const email = u.email ?? null
    const phone = u.phone && u.phone_confirmed_at ? normalizePhone(u.phone) : null
    const displayName = u.user_metadata?.full_name || u.user_metadata?.name || (email ? email.split('@')[0] : null)
    const avatarUrl = u.user_metadata?.avatar_url ?? null
    // Prisma-upsert parity: email always updated; phone only when we have one;
    // displayName/avatarUrl set on CREATE only. "updatedAt" is NOT NULL with no DB
    // default (Prisma's @updatedAt is client-side) — raw SQL must supply it.
    await db.query(
      `insert into "Profile" (id, email, phone, "displayName", "avatarUrl", "updatedAt")
       values ($1, $2, $3, $4, $5, now())
       on conflict (id) do update
         set email = excluded.email,
             phone = coalesce(excluded.phone, "Profile".phone),
             "updatedAt" = now()`,
      [u.id, email, phone || null, displayName, avatarUrl],
    )
    total++
  }
  process.stdout.write(`\r  provisioned ${total} profiles`)
  if (users.length < 200) break
  page++
}
const { rows } = await db.query('select count(*)::int as n from "Profile"')
console.log(`\nDone. ${rows[0].n} profiles total.`)
await db.end()
