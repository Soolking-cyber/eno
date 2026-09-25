/**
 * One-off (2026-09-25): remove the "enquiries and viewings are handled there, not by eno" sentence from
 * listings the property importers wrote before the templates dropped it. DRY RUN by default.
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/strip-import-viewing-disclaimer.ts            # dry run
 *   set -a; . ./.env; set +a; npx tsx scripts/strip-import-viewing-disclaimer.ts --apply --journal-dir <dir>
 *
 * Writes only description/descriptionVi, only where the text changes, in batches of 200; the old values
 * are appended to <dir>/strip-viewing-disclaimer-<ts>.jsonl (fsynced) BEFORE each batch commits. Rollback:
 * put each journal line's `old` back by id. Re-running finds nothing to do.
 */
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stripViewingDisclaimer } from '../src/lib/import-viewing-disclaimer'

const apply = process.argv.includes('--apply')
const dirArg = process.argv[process.argv.indexOf('--journal-dir') + 1]
async function main() {
  if (apply && (!process.argv.includes('--journal-dir') || !dirArg || dirArg.startsWith('--'))) throw new Error('--apply needs --journal-dir <durable dir>')
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  const db = new PrismaClient({
    adapter: new PrismaPg(apply ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }),
    transactionOptions: { timeout: 120_000, maxWait: 30_000 },
  })
  try {
    const rows = await db.listing.findMany({
      where: { OR: [{ description: { contains: 'enquiries and viewings are handled' } }, { descriptionVi: { contains: 'mọi liên hệ và xem nhà do' } }] },
      select: { id: true, sellerId: true, description: true, descriptionVi: true },
    })
    const plan = rows.map((r) => ({ r, d: stripViewingDisclaimer(r.description), v: stripViewingDisclaimer(r.descriptionVi) }))
      .filter((p) => p.d !== p.r.description || p.v !== p.r.descriptionVi)
    const bySeller: Record<string, number> = {}
    for (const p of plan) bySeller[p.r.sellerId] = (bySeller[p.r.sellerId] ?? 0) + 1
    console.log(`${apply ? 'APPLY' : 'DRY RUN (read-only session)'} · ${plan.length} rows would change`, bySeller)
    if (plan[0]) console.log('sample:', JSON.stringify({ before: plan[0].r.description?.slice(0, 160), after: plan[0].d?.slice(0, 160) }))
    if (!apply || !plan.length) return
    const dir = resolve(dirArg); mkdirSync(dir, { recursive: true })
    const journal = join(dir, `strip-viewing-disclaimer-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
    let done = 0
    for (let i = 0; i < plan.length; i += 200) {
      const batch = plan.slice(i, i + 200)
      const fd = openSync(journal, 'a')
      writeSync(fd, batch.map((p) => JSON.stringify({ id: p.r.id, old: { description: p.r.description, descriptionVi: p.r.descriptionVi } })).join('\n') + '\n')
      fsyncSync(fd); closeSync(fd)
      await db.$transaction(batch.map((p) => db.listing.update({ where: { id: p.r.id }, data: { description: p.d ?? p.r.description, descriptionVi: p.v } })))
      done += batch.length
      if ((i / 200) % 20 === 0) console.log(`  … ${done}/${plan.length}`)
    }
    console.log(`APPLIED ${done} rows · journal ${journal}`)
  } finally {
    await db.$disconnect()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
