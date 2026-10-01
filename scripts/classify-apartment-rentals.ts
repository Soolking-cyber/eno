/**
 * Classify the imported apartment rentals — type (studio/duplex/penthouse/serviced/officetel),
 * furnishing, amenities (balcony/pool/gym/pets) — from what each SOURCE states. Owner, 2026-09-30.
 *
 *   1. Rever page facts (optional; ONE request per active Rever apartment, ≥1.5 s apart — do not run
 *      while another Rever crawl is in flight):
 *        set -a; . ./.env; set +a; npx tsx scripts/classify-apartment-rentals.ts --rever-facts <out.jsonl>
 *      Nhà Tốt API facts (the furnishing value only; ≥1.2 s apart):
 *        … scripts/classify-apartment-rentals.ts --nhatot-facts <out.jsonl>
 *   2. DRY (database session read-only at the server; prints coverage and samples, writes nothing):
 *        … scripts/classify-apartment-rentals.ts [--facts <rever-facts.jsonl>]
 *   3. WRITE (add-only; journal first):
 *        … scripts/classify-apartment-rentals.ts [--facts <file>] --journal-dir <durable dir> --apply
 *
 * The rules live in src/lib/apartment-classify.ts (unit-tested); this file only gathers evidence and
 * writes. ⛔ ADD-ONLY: a key already present in `attributes` is never changed, and amenity tokens are
 * merged into whatever `facetTokens` already holds. ⛔ Only `active` apartment-rental rows of the four
 * checkable import sellers, pinned by id. ⛔ Each row's BEFORE values are journalled (fsync) before its
 * write, and the write is conditional on them still being current, so a concurrent change is skipped,
 * not clobbered. Rollback = re-apply the journal's `before` values (see the printed note).
 *
 * ⚠️ RE-RUN THIS AFTER ANY RE-IMPORT. The importers rewrite `attributes` on update (bedrooms/bathrooms),
 * which drops `aptType` and `furnishing` (Opus, 2026-09-30); `facetTokens` they never touch. This script
 * is idempotent and add-only, so running it again restores exactly what the sources state.
 */
import 'dotenv/config'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import {
  aptTypeFromTypeLine, factsFromSlug, furnishingFromLine, mergeFacts, nhatotFurnishing, reverAmenities, reverFurnishing, type AptFacts,
} from '../src/lib/apartment-classify'
import { buildFacetTokens, parseFacetTokens } from '../src/lib/facet-tokens'
import { journalDirProblem } from '../src/lib/honeycomb-listing'

const SELLERS: Record<string, string> = {
  'nhatot-import-seller-0001': 'Nhatot.com',
  'muaban-net-import-seller-0001': 'Muaban.net',
  'cmub0wead0000zrq418bqq27m': 'Rever.vn',
  'honeycomb-import-seller-0001': 'Honeycomb House',
  // Back since 2026-10-01 (fresh-only re-import). Its URL ends in the agent's own title as a slug, which
  // factsFromSlug reads like Rever's; it has no structured furnishing field and no page we can fetch.
  'bds-vn-import-seller-0001': 'Batdongsan.com.vn',
}
const APT_TYPES = new Set(['studio', 'duplex', 'penthouse', 'serviced', 'officetel'])
const FURNISHINGS = new Set(['premium', 'fully', 'partly'])
const AMENITIES = new Set(['balcony', 'pool', 'gym', 'pets'])
const REVER = 'cmub0wead0000zrq418bqq27m'
const NHATOT = 'nhatot-import-seller-0001'
const UA = 'Mozilla/5.0 (compatible; eno-property-import/1.0; +https://eno.vn)'

const argv = process.argv.slice(2)
const str = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] ?? null : null }
const APPLY = argv.includes('--apply')
const JOURNAL_DIR = str('--journal-dir')
const REVER_FACTS_OUT = str('--rever-facts')
const NHATOT_FACTS_OUT = str('--nhatot-facts')
const FACTS_IN = argv.flatMap((a, i) => (a === '--facts' && argv[i + 1] ? [argv[i + 1]] : []))

function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}
function ensureJournalDir(dir: string): string {
  const abs = resolve(dir)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  const problem = journalDirProblem(abs, roots)
  if (problem) throw new Error(problem)
  mkdirSync(abs, { recursive: true })
  const probe = join(abs, `.classify-journal-probe-${process.pid}`)
  recordDurably(probe, 'ok'); unlinkSync(probe)
  return abs
}

const line = (desc: string, key: string) => desc.match(new RegExp(`^${key}: ([^\\n]+)$`, 'm'))?.[1]?.trim() ?? null

/**
 * The source's own STRUCTURED fields, as composed into the description (Type / Furnishing lines).
 * ⚠️ PRECEDENCE (codex, commit gate): structured source field > page facts > URL slug. A slug is the
 * agency's free title, read by keyword; a structured field or a page field is the source's own answer.
 */
function structuredFacts(desc: string, url: string | null): AptFacts {
  const t = aptTypeFromTypeLine(line(desc, 'Type'))
  // Honeycomb lumps "Penthouse / duplex": the agency's own title (the slug) decides, else nothing.
  const slugType = factsFromSlug(url).aptType
  const aptType = t === 'penthouse-or-duplex'
    ? (slugType === 'penthouse' || slugType === 'duplex' ? slugType : undefined)
    : t
  return { aptType, furnishing: furnishingFromLine(line(desc, 'Furnishing')) }
}

/** Rever page: the meta-description furnishing bullet and the agent-ticked amenities list. */
/** ⛔ Only ever request Rever itself (codex, commit gate): the URL comes from the database, and a
 *  malformed or repointed row must not turn this crawl into a fetch of an arbitrary host. */
const isReverUrl = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'rever.vn' || x.hostname === 'www.rever.vn') } catch { return false } }

async function reverPageFacts(url: string): Promise<AptFacts | null> {
  if (!isReverUrl(url)) return null
  try {
    // ⛔ NO REDIRECTS FOLLOWED: a let listing can redirect to a SEARCH page whose meta text would tag this
    // flat (Opus), and following one would reach a host the guard never saw (codex). Only the listing's
    // own page, answering 200 directly with its own title, counts.
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    if (res.status === 429) throw new Error('HTTP 429 — rate limited; stopping')
    if (res.status !== 200) return null
    const html = await res.text()
    if (!/<h1[\s>]/.test(html)) return null
    const meta = html.match(/<meta name="description" content="([^"]*)"/)?.[1]?.replace(/&#10;/g, ' ') ?? ''
    const list = html.match(/class="detail-more utilities-list">([\s\S]*?)<\/ul>/)?.[1] ?? ''
    const items = [...list.matchAll(/<li>\s*([^<]+?)\s*<\/li>/g)].map((m) => m[1])
    const f: AptFacts = {}
    const furnishing = reverFurnishing(meta)
    if (furnishing) f.furnishing = furnishing
    const amenities = reverAmenities(items)
    if (amenities.length) f.amenities = amenities
    return f
  } catch (e) {
    if (e instanceof Error && e.message.includes('429')) throw e
    return null
  }
}

/**
 * Nhà Tốt's public ad endpoint. ⛔ The response carries the poster's name, phone and free text; only the
 * furnishing VALUE is read out of it and nothing else is kept or logged.
 */
async function nhatotApiFacts(listId: number): Promise<AptFacts | null> {
  try {
    const res = await fetch(`https://gateway.chotot.com/v1/public/ad-listing/${listId}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) })
    if (res.status === 429) throw new Error('HTTP 429 — rate limited; stopping')
    if (res.status !== 200) return null
    const body = (await res.json()) as { ad?: { list_id?: number }; parameters?: { id?: string; value?: string }[] }
    if (body.ad?.list_id !== listId) return null
    const p = (id: string) => body.parameters?.find((x) => x.id === id)?.value
    const furnishing = nhatotFurnishing(p('furnishing_rent') ?? p('furnishing_sell'))
    return furnishing ? { furnishing } : {}
  } catch (e) {
    if (e instanceof Error && e.message.includes('429')) throw e
    return null
  }
}

async function main() {
  if (APPLY && !JOURNAL_DIR) throw new Error('--apply needs --journal-dir <durable dir>')
  if (APPLY && (REVER_FACTS_OUT || NHATOT_FACTS_OUT)) throw new Error('a facts pass is a read-only crawl; run it on its own')
  const journalDir = APPLY ? ensureJournalDir(JOURNAL_DIR!) : null
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }),
    }),
    log: ['warn', 'error'],
  })
  try {
    const sellers = await db.seller.findMany({ where: { id: { in: Object.keys(SELLERS) } }, select: { id: true, name: true, ownerId: true } })
    for (const s of sellers) if (s.name !== SELLERS[s.id] || s.ownerId) throw new Error(`seller ${s.id} is no longer the ownerless ${SELLERS[s.id]} — refusing`)

    const rows = await db.listing.findMany({
      where: { sellerId: { in: Object.keys(SELLERS) }, subcategorySlug: 'apartment-rental', status: 'active' },
      select: { id: true, sellerId: true, affiliateUrl: true, externalId: true, description: true, attributes: true, facetTokens: true },
      orderBy: { createdAt: 'asc' },
    })

    if (REVER_FACTS_OUT) {
      const rever = rows.filter((r) => r.sellerId === REVER && r.affiliateUrl)
      console.log(`rever facts       ${rever.length} pages, ≥1500 ms apart → ${REVER_FACTS_OUT}`)
      let got = 0
      for (const [i, r] of rever.entries()) {
        const f = await reverPageFacts(r.affiliateUrl!)
        if (f) { got++; recordDurably(REVER_FACTS_OUT, JSON.stringify({ id: r.id, url: r.affiliateUrl, fetchedAt: new Date().toISOString(), ...f })) }
        if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${rever.length}  read ${got}`)
        await new Promise((ok) => setTimeout(ok, 1500))
      }
      console.log(`read              ${got} of ${rever.length}`)
      return
    }

    if (NHATOT_FACTS_OUT) {
      const nt = rows.filter((r) => r.sellerId === NHATOT && /^nhatot:\d+$/.test(r.externalId ?? ''))
      console.log(`nhatot facts      ${nt.length} ads, ≥1200 ms apart → ${NHATOT_FACTS_OUT}`)
      let got = 0
      for (const [i, r] of nt.entries()) {
        const f = await nhatotApiFacts(Number(r.externalId!.slice('nhatot:'.length)))
        if (f) { got++; recordDurably(NHATOT_FACTS_OUT, JSON.stringify({ id: r.id, url: r.affiliateUrl, fetchedAt: new Date().toISOString(), ...f })) }
        if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${nt.length}  read ${got}`)
        await new Promise((ok) => setTimeout(ok, 1200))
      }
      console.log(`read              ${got} of ${nt.length}`)
      return
    }

    // ⛔ A facts line counts only while it is fresh AND still describes the row's current URL (codex):
    // an append-only file reused days later, or a row repointed since, must not write old evidence.
    const urlOf = new Map(rows.map((r) => [r.id, r.affiliateUrl]))
    const pageFacts = new Map<string, AptFacts>()
    let refusedFacts = 0
    for (const f of FACTS_IN) for (const l of readFileSync(f, 'utf8').split('\n')) {
      if (!l.trim()) continue
      const { id, url, fetchedAt, ...raw } = JSON.parse(l) as { id: string; url?: string; fetchedAt?: string } & Record<string, unknown>
      const ageH = (Date.now() - Date.parse(fetchedAt ?? '')) / 3_600_000
      if (!(ageH >= 0 && ageH <= 72) || !url || url !== urlOf.get(id)) { refusedFacts++; continue }
      // ⛔ VALUES ARE RE-VALIDATED, NOT CAST (codex): a hand-edited or corrupt line must not put an
      // unknown value into a public filter. Only the taxonomy's own option values pass.
      const facts: AptFacts = {}
      if (typeof raw.aptType === 'string' && APT_TYPES.has(raw.aptType)) facts.aptType = raw.aptType as AptFacts['aptType']
      if (typeof raw.furnishing === 'string' && FURNISHINGS.has(raw.furnishing)) facts.furnishing = raw.furnishing as AptFacts['furnishing']
      if (Array.isArray(raw.amenities)) {
        const am = raw.amenities.filter((a): a is string => typeof a === 'string' && AMENITIES.has(a))
        if (am.length) facts.amenities = am as AptFacts['amenities']
      }
      pageFacts.set(id, facts)
    }
    if (refusedFacts) console.log(`facts refused     ${refusedFacts} (older than 72 h, or the row's URL changed)`)

    type Change = { id: string; src: string; sellerId: string; url: string | null; before: { attributes: string | null; facetTokens: string | null }; after: { attributes: string | null; facetTokens: string | null }; added: string[] }
    const changes: Change[] = []
    const cov: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      const src = SELLERS[r.sellerId]
      const facts = mergeFacts(structuredFacts(r.description, r.affiliateUrl), pageFacts.get(r.id) ?? {}, factsFromSlug(r.affiliateUrl))
      const attrs: Record<string, unknown> = r.attributes ? JSON.parse(r.attributes) : {}
      const added: string[] = []
      if (facts.aptType && attrs.aptType === undefined) { attrs.aptType = facts.aptType; added.push(`aptType=${facts.aptType}`) }
      if (facts.furnishing && attrs.furnishing === undefined) { attrs.furnishing = facts.furnishing; added.push(`furnishing=${facts.furnishing}`) }
      const pairs = parseFacetTokens(r.facetTokens)
      const multi: Record<string, string[]> = {}
      for (const p of pairs) (multi[p.key] ??= []).push(p.value)
      for (const a of facts.amenities ?? []) {
        if (!(multi.amenities ?? []).includes(a)) { (multi.amenities ??= []).push(a); added.push(`amenities=${a}`) }
      }
      const c = (cov[src] ??= { rows: 0 })
      c.rows++
      for (const a of added) c[a] = (c[a] ?? 0) + 1
      if (!added.length) continue
      changes.push({
        id: r.id, src, added, sellerId: r.sellerId, url: r.affiliateUrl,
        before: { attributes: r.attributes, facetTokens: r.facetTokens },
        after: { attributes: JSON.stringify(attrs), facetTokens: buildFacetTokens(multi) },
      })
    }

    console.log(`active apartments ${rows.length}   page facts ${pageFacts.size}   rows gaining a value ${changes.length}`)
    for (const [src, c] of Object.entries(cov)) {
      const { rows: n, ...rest } = c
      console.log(`\n${src} (${n} rows)`)
      for (const [k, v] of Object.entries(rest).sort()) console.log(`  ${k.padEnd(22)} ${String(v).padStart(5)}  (${Math.round((v / n) * 100)}%)`)
    }
    console.log('\nsamples')
    for (const ch of changes.filter((_, i) => i % Math.max(1, Math.floor(changes.length / 12)) === 0).slice(0, 12)) {
      console.log(`  ${ch.src.padEnd(15)} ${ch.id}  +${ch.added.join(' +')}`)
    }
    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --journal-dir <durable dir> --apply.'); return }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const JOURNAL = join(journalDir!, `classify-apartments-${stamp}.jsonl`)
    console.log(`\njournal           ${JOURNAL}  (rollback: set attributes/facetTokens back to each line's "before", where they still equal "after")`)
    let written = 0, skipped = 0
    for (const ch of changes) {
      recordDurably(JOURNAL, JSON.stringify(ch))
      const res = await db.listing.updateMany({
        // The whole identity the evidence was read against, not just the two columns (codex): a row
        // repointed, re-sellered or re-filed since the read is skipped, not classified from old evidence.
        where: { id: ch.id, status: 'active', sellerId: ch.sellerId, subcategorySlug: 'apartment-rental', affiliateUrl: ch.url, attributes: ch.before.attributes, facetTokens: ch.before.facetTokens },
        data: { attributes: ch.after.attributes, facetTokens: ch.after.facetTokens },
      })
      if (res.count === 1) written++; else skipped++
    }
    console.log(`written           ${written}   skipped (changed since read) ${skipped}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
