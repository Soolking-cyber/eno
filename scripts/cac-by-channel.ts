import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// ─────────────────────────────────────────────────────────────────────────────
// CAC BY CHANNEL — exact first-touch acquisition breakdown from our own data.
// Groups onboarded Profiles by the channel that ORIGINALLY brought them (the
// eno_attr first-touch cookie, persisted at signup). Pair the signup counts with
// each channel's spend to get real CAC. Read-only; safe on production.
//
// Run: set -a; . ./.env; set +a; npx tsx scripts/cac-by-channel.ts
// ─────────────────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

function table(title: string, rows: { label: string; count: number }[], total: number) {
  console.log(`\n${title}`)
  console.log('─'.repeat(48))
  rows.sort((a, b) => b.count - a.count)
  for (const r of rows) {
    const pct = total ? ((r.count / total) * 100).toFixed(1) : '0.0'
    console.log(`  ${(r.label || '(unknown)').padEnd(24)} ${String(r.count).padStart(6)}  ${pct.padStart(5)}%`)
  }
}

async function main() {
  // Onboarded = has an accountType (a completed signup). attrSource null = signed up
  // before attribution shipped, or a session with no cookie (treated as "(unknown)").
  const onboarded = await db.profile.count({ where: { accountType: { not: null } } })

  const bySource = await db.profile.groupBy({ by: ['attrSource'], where: { accountType: { not: null } }, _count: { _all: true } })
  const byMedium = await db.profile.groupBy({ by: ['attrMedium'], where: { accountType: { not: null } }, _count: { _all: true } })

  console.log(`\nOnboarded accounts: ${onboarded}`)
  table('Signups by SOURCE (first-touch)', bySource.map((r) => ({ label: r.attrSource ?? '(unknown)', count: r._count._all })), onboarded)
  table('Signups by MEDIUM (first-touch)', byMedium.map((r) => ({ label: r.attrMedium ?? '(unknown)', count: r._count._all })), onboarded)
  console.log('\nTip: CAC = channel spend ÷ that channel’s signup count. Organic/referral ≈ free.\n')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
