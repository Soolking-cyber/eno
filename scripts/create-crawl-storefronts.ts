/**
 * Create the two EMPTY, ownerless storefronts of the AccessTrade crawl campaigns — Hoàng Hà Mobile and ShopDunk (owner
 * 2026-11-14: "All of them", chat only) — so their eno-held logins can be made and their pairs pinned BEFORE anything is
 * imported (plan v3: login first, pin, deploy, attach, import).
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/create-crawl-storefronts.ts            # DRY RUN
 *   …                         npx tsx scripts/create-crawl-storefronts.ts --apply    # prints the two ids
 *
 * ⛔ CREATE ONLY: a storefront of the same name that already exists is reported and left alone (never a second one, never
 * adopted). No listing, no owner, officialPartner false, verified false — the claim script's --attach sets the owner and
 * the partner flag once the pin is live. The ids are journaled to ~/eno-journals/accesstrade before anything else uses them.
 * ⛔ Nothing can be written INTO these storefronts until they are pinned eno-run pairs: the campaigns are `chatOnly`
 * (src/lib/retired-imports.ts) and the importer and the nightly job refuse them otherwise.
 */
import { closeSync, openSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { mkdirDurably, writeFileDurably } from '../src/lib/durable-file'

const SHOPS = [
  {
    campaign: 'hoanghamobile', name: 'Hoàng Hà Mobile', location: 'Hà Nội',
    bio: 'Second-hand phones, tablets and laptops from Hoàng Hà Mobile. Message us to buy: eno\'s team orders it for you and arranges delivery.',
  },
  {
    campaign: 'shopdunk_web', name: 'ShopDunk', location: 'Hà Nội',
    bio: 'Second-hand Apple devices from ShopDunk. Message us to buy: eno\'s team orders it for you and arranges delivery.',
  },
] as const

const APPLY = process.argv.includes('--apply')
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }) }) })

const JOURNAL_DIRS = [join(homedir(), 'eno-import-journals', 'accesstrade'), join(homedir(), 'eno-journals', 'accesstrade')]
const RUN_AT = new Date().toISOString()
const JOURNAL = `crawl-storefronts-${RUN_AT.replace(/[:.]/g, '-')}.json`

/** One run at a time (commit gate, codex): two runs could both pass the name check and make two storefronts. */
function takeLock() {
  const lock = join(JOURNAL_DIRS[1], 'create-crawl-storefronts.lock')
  mkdirDurably(JOURNAL_DIRS[1])
  try { closeSync(openSync(lock, 'wx', 0o600)) } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') { console.error(`${lock} exists — another run is going, or one died: check, then remove it`); process.exit(1) }
    throw e
  }
  process.on('exit', () => { try { unlinkSync(lock) } catch { /* gone */ } })
}

async function main() {
  if (APPLY) takeLock()
  const made: { campaign: string; name: string; sellerId: string | null }[] = []
  // ⛔ JOURNALED AFTER EACH CREATE, not once at the end (commit gate, codex): a failure on the second storefront must not
  // leave the first one created with no record of it.
  const journal = () => { for (const dir of JOURNAL_DIRS) writeFileDurably(dir, JOURNAL, JSON.stringify({ kind: 'crawl-storefronts', createdAt: RUN_AT, made }, null, 1)) }
  for (const s of SHOPS) {
    const same = await db.seller.findMany({ where: { name: s.name }, select: { id: true, ownerId: true } })
    if (same.length) {
      console.log(`${s.name}: ${same.length} storefront(s) of that name already exist (${same.map((x) => `${x.id}${x.ownerId ? ' owned' : ''}`).join(', ')}) — left alone; nothing created`)
      continue
    }
    console.log(`${s.name}: ${APPLY ? 'creating' : 'would create'} an empty ownerless storefront (${s.location})`)
    if (!APPLY) continue
    // The INTENT is on disk before the write (commit gate, codex): a crash between the create and the journal still leaves
    // "creating <name>" recorded, and a re-run reports the storefront by name instead of making a second one.
    made.push({ campaign: s.campaign, name: s.name, sellerId: null })
    journal()
    const row = await db.seller.create({
      data: { name: s.name, bio: s.bio, location: s.location, officialPartner: false, verified: false },
      select: { id: true },
    })
    made[made.length - 1].sellerId = row.id
    journal()
    console.log(`  → ${row.id}`)
  }
  if (made.length) {
    console.log(`\njournal: ~/eno-journals/accesstrade/${JOURNAL}`)
    console.log('NEXT: node --env-file=.env scripts/claim-partner-storefront.mjs <hoangha|shopdunk> --login-only --seller-id <id> (dry run, then --apply --email-forwards)')
  }
  if (!APPLY) console.log('\nDRY RUN — nothing written. Re-run with --apply.')
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
