// One-time: provision a Profile for every existing Supabase auth user (so users
// who signed up before the Profile table existed don't 404). Idempotent.
//
// Run:  set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/backfill-profiles.mjs

import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})
const db = new PrismaClient()

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
    await db.profile.upsert({
      where: { id: u.id },
      create: { id: u.id, email, phone, displayName, avatarUrl },
      update: { email, ...(phone ? { phone } : {}) },
    })
    total++
  }
  process.stdout.write(`\r  provisioned ${total} profiles`)
  if (users.length < 200) break
  page++
}
console.log(`\nDone. ${await db.profile.count()} profiles total.`)
await db.$disconnect()
