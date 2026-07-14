// Ephemeral test users for the AUTHED e2e suite (seller + admin), and their cleanup.
//
// Why this exists: the authed projects need real Supabase auth users that also have
// the app-side rows (Profile, and a Seller storefront for the seller role) — otherwise
// the dashboard 404s. Creating them by hand is the step that used to be re-derived
// from scratch every time.
//
// Run (from the repo root):
//   set -a; . ./.env; set +a; npx tsx .claude/skills/authed-e2e/seed-users.ts
//   set -a; . ./.env; set +a; npx tsx .claude/skills/authed-e2e/seed-users.ts --cleanup
//
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, DIRECT_URL.
// Idempotent: re-running reuses the existing auth users and upserts their rows.
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '../../../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const SELLER_EMAIL = process.env.E2E_SELLER_EMAIL || 'e2e-seller@eno.vn'
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e-admin@eno.vn'
const cleanup = process.argv.includes('--cleanup')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !secret) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (source .env)')

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } })
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

// Supabase has no get-user-by-email, so page through the admin list.
async function findUser(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
  return null
}

async function ensureUser(email: string): Promise<string> {
  const existing = await findUser(email)
  if (existing) return existing
  // email_confirm: true — no inbox round-trip; auth.setup.ts then signs in via
  // generateLink → verifyOtp (Turnstile guards sends/password grants, never verify).
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`)
  return data.user.id
}

async function seed() {
  const sellerId = await ensureUser(SELLER_EMAIL)
  const adminId = await ensureUser(ADMIN_EMAIL)

  // Profile.updatedAt has no DB default and unsubscribeToken/Seller.id are Prisma-side
  // cuid() defaults — going through the client (not raw SQL) fills all of them.
  await db.profile.upsert({
    where: { id: sellerId },
    update: { accountType: 'business', businessName: 'E2E Test Shop' },
    create: { id: sellerId, email: SELLER_EMAIL, accountType: 'business', businessName: 'E2E Test Shop', displayName: 'E2E Seller' },
  })
  await db.profile.upsert({
    where: { id: adminId },
    update: { accountType: 'individual' },
    create: { id: adminId, email: ADMIN_EMAIL, accountType: 'individual', displayName: 'E2E Admin' },
  })

  const seller = await db.seller.findUnique({ where: { ownerId: sellerId } })
  if (!seller) {
    await db.seller.create({
      data: { ownerId: sellerId, name: 'E2E Test Shop', location: 'District 1', trustScore: 100, trustTier: 'standard' },
    })
  }

  console.log(`seller: ${SELLER_EMAIL}  (${sellerId})`)
  console.log(`admin:  ${ADMIN_EMAIL}  (${adminId})`)
  console.log('\nExport these before running the suite:')
  console.log(`  export E2E_SELLER_EMAIL=${SELLER_EMAIL} E2E_ADMIN_EMAIL=${ADMIN_EMAIL} ADMIN_EMAILS=${ADMIN_EMAIL}`)
}

async function purge() {
  for (const email of [SELLER_EMAIL, ADMIN_EMAIL]) {
    const id = await findUser(email)
    if (!id) { console.log(`${email}: no auth user`); continue }
    // Seller first — its ownerId FK is ON DELETE SET NULL, which would strand the row.
    await db.seller.deleteMany({ where: { ownerId: id } })
    await db.profile.deleteMany({ where: { id } })
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) throw new Error(`deleteUser(${email}) failed: ${error.message}`)
    console.log(`${email}: removed`)
  }
}

await (cleanup ? purge() : seed())
await db.$disconnect()
