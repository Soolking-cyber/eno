/**
 * Every partner listing's ORIGINAL PAGE → the staff-only "PartnerPurchaseLink" table, so eno's admins (and the storefront's
 * own eno-held login) can open it from the listing and the chat (owner, 2026-11-24: "why all partner shop products dont have
 * direct links to original website for respective admins" → "build it" + "from now on all partner shops should have links
 * for admins"). What is served, to whom, and the host check: src/lib/partner-source-link.ts.
 *
 *   DRY (default — reads the research and the DB read-only, writes nothing):
 *     set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/backfill-partner-source-links.ts [handle …]
 *   WRITE (journal first):
 *     … scripts/backfill-partner-source-links.ts [handle …] --journal-dir <durable dir> --apply
 *   UNDO (only rows still holding what this run wrote):
 *     … scripts/backfill-partner-source-links.ts --undo <journal file> --apply
 *
 * ⛔ RE-RUN IT AFTER EVERY PARTNER IMPORT — it only adds or refreshes links of THIS partner's own pages, so it is safe to repeat.
 *
 * Where each page comes from (the import research the importers read; paths are their defaults):
 *   · housing (Alpha, Housing Saigon, CVR, JHouse): <research>/data.json records[].link, keyed housingExternalId(p, id);
 *   · cars (KarPlus, Carbi, An Khánh, Quê Hương, An Bình): ~/eno-car-partners-2026-11-17/<research>/data.json
 *     cars[src].pageUrl for each car(src, slug) in src/lib/car-partners.ts;
 *   · Saigon Cribs: ~/eno-saigoncribs-2026-11-18/data.json [{ id, url }], keyed saigoncribsExternalId(id);
 *   · The Extra Mile: theextramile.co/motorbikes/<slug>/ — only when raw/bike-urls.txt lists that exact address;
 *   · HAGA Smartech: ~/eno-haga-partner-2026-11-25/data.json records[].url for a used device; its repair list
 *     (/dich-vu-sua-chua/) for a grouped repair listing;
 *   · FPT Telecom: no research to read — every listing is one of its plans, so each takes its `home`, FPT's home-internet
 *     page (src/lib/fpt-internet-partner.ts FPT.site);
 *   · everything else (one-page partners, a listing the partner posted itself, a page the research lacks): the partner's
 *     `home` page in PARTNER_SOURCES.
 * A row already holding a link that is NOT this partner's own page is never touched (reported as `foreign`).
 */
import 'dotenv/config'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { CAR_PARTNERS } from '../src/lib/car-partners'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { HOUSING_PARTNERS, housingExternalId } from '../src/lib/housing-partners'
import { HAGA, HAGA_EXTERNAL_PREFIX, SERVICE_GROUPS } from '../src/lib/haga-partner'
import { EXTRA_MILE_BIKES } from '../src/lib/moto-partners'
import { PARTNER_SOURCES, partnerSourceUrlOk } from '../src/lib/partner-source-link'
import { saigoncribsExternalId } from '../src/lib/saigoncribs-listing'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] ?? null : null }
const VALUED = new Set(['--journal-dir', '--undo'])
const handles = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1] ?? ''))
for (const h of handles) if (!(h in PARTNER_SOURCES)) throw new Error(`unknown partner "${h}" — one of: ${Object.keys(PARTNER_SOURCES).join(', ')}`)
const wanted = handles.length ? handles : Object.keys(PARTNER_SOURCES)

const H = homedir()
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

/** externalId → the listing's own page, per partner, from the import research. A missing research file is an error. */
function researchPages(): Map<string, Map<string, string>> {
  const pages = new Map<string, Map<string, string>>()
  const put = (h: string, ext: string, url: unknown) => {
    if (typeof url !== 'string' || !url) return
    if (!pages.has(h)) pages.set(h, new Map())
    pages.get(h)!.set(ext, url.trim())
  }
  const HOUSING_ROOT: Record<string, string> = {
    alphahousing: join(H, 'eno-housing-partners-2026-11-22'), housingsaigon: join(H, 'eno-housing-partners-2026-11-22'), cvr: join(H, 'eno-cvr-partner-2026-11-23'),
    jhouse: join(H, 'eno-jhouse-partner-2026-11-25'),
  }
  for (const p of HOUSING_PARTNERS) {
    if (!wanted.includes(p.handle)) continue
    const root = HOUSING_ROOT[p.handle]
    if (!root) throw new Error(`no research folder known for housing partner ${p.handle} — add it to HOUSING_ROOT here`)
    const d = readJson(join(root, p.research, 'data.json')) as { records?: { id: number | string; link?: string }[] }
    for (const r of d.records ?? []) put(p.handle, housingExternalId(p, r.id), r.link)
  }
  for (const p of CAR_PARTNERS) {
    if (!wanted.includes(p.handle)) continue
    const d = readJson(join(H, 'eno-car-partners-2026-11-17', p.research, 'data.json')) as { cars?: { pageUrl?: string }[] }
    for (const c of p.cars) put(p.handle, `${p.handle}:${c.slug}`, d.cars?.[c.src]?.pageUrl)
  }
  if (wanted.includes('saigoncribs')) {
    const d = readJson(join(H, 'eno-saigoncribs-2026-11-18', 'data.json')) as { id: number; url?: string }[]
    for (const r of d) put('saigoncribs', saigoncribsExternalId(r.id), r.url)
  }
  if (wanted.includes('hagasmartech')) {
    // HAGA Smartech (scripts/import-haga.ts): a used device's own page; a grouped repair listing → HAGA's repair list, where its prices were read.
    const d = readJson(join(H, 'eno-haga-partner-2026-11-25', 'data.json')) as { records?: { slug: string; url: string; kind: string }[] }
    for (const r of d.records ?? []) if (r.kind === 'used') put('hagasmartech', `${HAGA_EXTERNAL_PREFIX}${r.slug.replace(/\.html$/, '')}`, r.url)
    for (const g of SERVICE_GROUPS) put('hagasmartech', `${HAGA_EXTERNAL_PREFIX}service-${g.key}`, `${HAGA.site}/dich-vu-sua-chua/`)
  }
  if (wanted.includes('theextramile')) {
    const listed = new Set(readFileSync(join(H, 'eno-moto-partners-2026-11-22', 'extramile', 'raw', 'bike-urls.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))
    for (const b of EXTRA_MILE_BIKES) {
      const url = `https://theextramile.co/motorbikes/${b.slug}/`
      if (listed.has(url)) put('theextramile', `theextramile:${b.slug}`, url)
    }
  }
  return pages
}

function journalFile(): string {
  const dir = opt('--journal-dir')
  const problem = journalDirProblem(dir, ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()])
  if (problem) throw new Error(problem)
  mkdirSync(dir!, { recursive: true })
  const real = realpathSync(dir!)
  const again = journalDirProblem(real, ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()])
  if (again) throw new Error(again)
  return join(real, `partner-source-links-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
}

/** One journal line, on disk (fsync) before the next row is written: the journal holds exactly the rows this run changed. */
function appendDurably(fd: number, line: string) {
  writeSync(fd, `${line}\n`)
  fsyncSync(fd)
}

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ~/eno.vn/.env; set +a` first')
  const db = new PrismaClient({ adapter: new PrismaPg(APPLY ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }), log: ['warn', 'error'] })
  try {
    const undo = opt('--undo')
    if (undo) {
      const rows = readFileSync(resolve(undo), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { listingId: string; before: string | null; after: string })
      let restored = 0
      for (const r of rows) {
        if (!APPLY) continue
        restored += r.before === null
          ? await db.$executeRaw`DELETE FROM "PartnerPurchaseLink" WHERE "listingId" = ${r.listingId} AND url = ${r.after}`
          : await db.$executeRaw`UPDATE "PartnerPurchaseLink" SET url = ${r.before}, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "listingId" = ${r.listingId} AND url = ${r.after}`
      }
      console.log(APPLY ? `undo: ${restored} of ${rows.length} rows restored (a row changed since is left alone)` : `undo DRY: ${rows.length} rows in the journal; add --apply`)
      return
    }

    const pages = researchPages()
    const plan: { listingId: string; before: string | null; after: string }[] = []
    for (const h of wanted) {
      const src = PARTNER_SOURCES[h]
      const handle = await db.handle.findUnique({ where: { handle: h }, select: { seller: { select: { id: true, officialPartner: true } } } })
      const seller = handle?.seller
      if (!seller) { console.log(`${h.padEnd(20)} no storefront with this handle — skipped`); continue }
      if (!seller.officialPartner) { console.log(`${h.padEnd(20)} storefront is not an official partner — skipped (the link would never be served)`); continue }
      const listings = await db.listing.findMany({ where: { sellerId: seller.id }, select: { id: true, externalId: true, purchaseLink: { select: { url: true } } } })
      const t = { listings: listings.length, ownPage: 0, home: 0, same: 0, write: 0, foreign: 0, bad: 0 }
      for (const l of listings) {
        const own = l.externalId ? pages.get(h)?.get(l.externalId) : undefined
        const url = own && partnerSourceUrlOk(h, own) ? own : src.home
        if (own && url !== own) t.bad++
        if (url === own) t.ownPage++; else t.home++
        const before = l.purchaseLink?.url ?? null
        if (before === url) { t.same++; continue }
        if (before !== null && !partnerSourceUrlOk(h, before)) { t.foreign++; continue }
        // A deep link already on the partner's own site is never downgraded to the home page (commit gate, opus): only a page
        // the research names replaces it.
        if (before !== null && url !== own) { t.same++; continue }
        plan.push({ listingId: l.id, before, after: url }); t.write++
      }
      console.log(`${h.padEnd(20)} ${String(t.listings).padStart(5)} listings · own page ${t.ownPage} · home page ${t.home} · already ${t.same} · to write ${t.write}${t.foreign ? ` · ⚠️ foreign link kept ${t.foreign}` : ''}${t.bad ? ` · ⚠️ research page off-host ${t.bad}` : ''}`)
    }
    if (!APPLY) { console.log(`\nDRY: ${plan.length} links would be written. Add --journal-dir <durable dir> --apply.`); return }
    if (!plan.length) { console.log('nothing to write'); return }
    const file = journalFile()
    // ⛔ CONDITIONAL ON WHAT THE PLAN READ (commit gate, opus): a row that changed since — a link another path wrote, or
    // a foreign one — is left alone, and ONLY a row this run actually changed is journaled (right after its write, as the
    // importers do), so undo never touches a row it did not write.
    let written = 0
    const fd = openSync(file, 'wx', 0o600)
    try {
      for (const p of plan) {
        const n = p.before === null
          ? await db.$executeRaw`INSERT INTO "PartnerPurchaseLink" ("listingId", url, "updatedAt") VALUES (${p.listingId}, ${p.after}, (now() AT TIME ZONE 'UTC')) ON CONFLICT ("listingId") DO NOTHING`
          : await db.$executeRaw`UPDATE "PartnerPurchaseLink" SET url = ${p.after}, "updatedAt" = (now() AT TIME ZONE 'UTC') WHERE "listingId" = ${p.listingId} AND url = ${p.before}`
        if (n === 1) { appendDurably(fd, JSON.stringify(p)); written++ }
      }
    } finally { closeSync(fd) }
    console.log(`written ${written} of ${plan.length} (a row that changed since the read is left alone) · journal ${file}${existsSync(file) ? '' : ' (MISSING)'}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
