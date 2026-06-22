// One-time, idempotent backfill: existing accounts predate the individual/business
// onboarding choice. Default them to 'individual' so the onboarding gate only
// fires for genuinely NEW sign-ups (whose accountType is still null after this).
// Existing users can switch to a business account later from the dashboard.
//
// Run:  set -a; . ./.env; set +a; export DATABASE_URL="$DIRECT_URL"; node scripts/backfill-account-type.mjs
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const r = await db.profile.updateMany({
  where: { accountType: null },
  data: { accountType: 'individual' },
})
console.log(`Backfilled ${r.count} profile(s) → accountType='individual'`)
await db.$disconnect()
