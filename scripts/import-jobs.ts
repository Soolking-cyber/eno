/**
 * Linked JOB POSTINGS (English teaching in Vietnam, and jobs for English speakers) → eno REFERENCE
 * LISTINGS. Owner, 2026-09-25: "upload to eno.vn the jobs" — "with links so users apply at source".
 * What a staged job becomes, and what is refused, lives in src/lib/job-listing.ts (unit-tested); this
 * file owns the stage file, the database, storage and the ISR cache.
 *
 * The jobs are fetched and staged OUTSIDE this repo by the lead pipeline, which obeys each board's
 * robots.txt, keeps only boards whose terms allow republishing facts, and draws each cover from the
 * job's own facts (no logo, no photo copied):
 *   cd ~/eno-lead-pipeline && DATABASE_URL=pglite://./data/pglite-real node src/cli/fetchJobs.ts
 *   … node src/cli/exportJobs.ts            → data/jobs-stage/jobs-<stamp>.json + covers/
 *
 * Run (DRY by default — the database session is READ-ONLY and nothing is uploaded):
 *   set -a; . ./.env; set +a; npx tsx scripts/import-jobs.ts --src <jobs-stamp.json> [--limit N]
 *   … --src <file> --apply --journal-dir <durable dir> [--limit N] [--expire]
 *   … --expire --apply --journal-dir <dir>      hide rows whose apply-by date has passed
 *   … --verify                                  read-only invariants; exits non-zero on failure
 *
 * Flags
 *   --src F          the staged file; --apply refuses one staged more than 72 h ago (its own stagedAt)
 *   --apply          WRITE: create the board sellers, upload covers, create/update rows, expire
 *   --journal-dir D  required with --apply: the uploaded-object manifest and created-row journal (not /tmp)
 *   --expire         also hide ACTIVE job rows whose apply-by has passed (a POLICY cutoff — at most 14
 *                    days after posting; the page already closes its Apply button that day, JobApplyGuard)
 *   (always, on --apply) hide rows whose posting the stage lists under `gone`: the pipeline re-fetched it
 *                    and got 404/410, a redirect off the posting, or a passed validThrough — a POSITIVE
 *                    signal. A row merely absent from the stage is never hidden for that.
 *   --limit N        apply at most N new rows
 *   --preview-covers DIR   PREVIEW ONLY: copy covers to public/DIR/ and store local paths instead of
 *                    uploading. Refused unless the database is a loopback scratch DB (not :5433, the
 *                    production tunnel) — it exists so the owner can look at job pages on a local
 *                    preview BEFORE anything reaches production.
 *   --verify         read-only invariant check of what is stored
 *
 * ⛔ HIDING IS THE ROLLBACK, NEVER DELETE — Order is onDelete:Restrict and six relations Cascade.
 * ⛔ A HIDE OR AN UPDATE IS FOLLOWED BY PER-PAGE ISR TOMBSTONES (both languages): the PDP is cached
 *    for 30 days (ISR) and this script has no Next runtime to revalidate it — without the tombstone a closed
 *    job keeps a cached 200 page with a live Apply link (cache-handler.cjs honours next_cache_tag rows;
 *    purge-isr-listings.mjs writes the route-wide ones the same way).
 * ⚠️ AFTER AN --apply: `node scripts/vertex-backfill.mjs` (new rows) and `node scripts/vertex-reconcile.mjs`
 *    (hidden ones), if semantic search is on — script writes skip the app's Vertex sync.
 */
import 'dotenv/config'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { makeImageHost } from '../src/lib/host-product-image'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
import { browseRankScore } from '../src/lib/ranking-formula'
import { journalDirProblem, sellerRefusal } from '../src/lib/honeycomb-listing'
import {
  JOB_BOARDS, JOB_SELLER_IDS, isExpiredJob, jobExternalId, jobStageProblem, mapStagedJob, pdpTombstoneTags,
  type JobDrop, type JobStage, type MappedJob,
} from '../src/lib/job-listing'

const BUCKET = 'listings'
const argv = process.argv
const APPLY = argv.includes('--apply')
const VERIFY = argv.includes('--verify')
const EXPIRE = argv.includes('--expire')
const str = (k: string) => {
  const i = argv.indexOf(k)
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const SRC = str('--src')
const JOURNAL_DIR = str('--journal-dir')
const LIMIT = Number(str('--limit') ?? 0) || 0
const PREVIEW_COVERS = str('--preview-covers')
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || ''

/** The database is a loopback scratch copy — never the production tunnel on :5433. */
function isScratchDb(url: string): boolean {
  try {
    const u = new URL(url)
    return ['127.0.0.1', 'localhost', '::1'].includes(u.hostname) && (u.port || '5432') !== '5433'
  } catch { return false }
}

function makeDb(readOnly: boolean) {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: DB_URL,
      /** A dry run or --verify opens every session read-only, so no code path below can write. */
      ...(readOnly ? { options: '-c default_transaction_read_only=on' } : {}),
    }),
    log: ['warn', 'error'],
  })
}

/** Append + fsync the same handle, BEFORE the write it protects (attach-rever-photos.ts:97-110). */
function recordDurably(file: string, line: string) {
  const fd = openSync(file, 'a')
  try { writeSync(fd, line + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
}

function prepareJournalDir(dir: string): string {
  const tmpRoots = [tmpdir(), '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp']
  const abs = resolve(dir)
  let problem = journalDirProblem(abs, tmpRoots)
  if (!problem) {
    mkdirSync(abs, { recursive: true })
    problem = journalDirProblem(realpathSync(abs), tmpRoots.map((t) => { try { return realpathSync(t) } catch { return t } }))
  }
  if (problem) throw new Error(problem)
  const probe = join(abs, `.jobs-journal-probe-${process.pid}`)
  recordDurably(probe, 'ok')
  unlinkSync(probe)
  return abs
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))

type Db = ReturnType<typeof makeDb>

/**
 * Per-page tombstones for these listing ids, both languages — the next visit re-renders (a hidden row
 * then 404s from the layout). Skipped, and said so, on a database without the ISR tag table (a scratch
 * copy has none: it is not a Prisma model).
 */
async function tombstone(db: Db, ids: string[]): Promise<string> {
  if (!ids.length) return 'none needed'
  const [{ t }] = await db.$queryRaw<{ t: string | null }[]>`select to_regclass('public.next_cache_tag')::text as t`
  if (!t) return `SKIPPED — no next_cache_tag table here (${ids.length} pages would be tombstoned)`
  const tags = ids.flatMap(pdpTombstoneTags)
  await db.$executeRaw`
    insert into next_cache_tag (tag, stamp, expires_at)
    select tag, ${Date.now()}::bigint, now() + interval '40 days' from unnest(${tags}::text[]) as tag
    on conflict (tag) do update set
      stamp = greatest(next_cache_tag.stamp, excluded.stamp),
      expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`
  return `${tags.length} tags (${ids.length} pages × en/vi)`
}

type Mutable = ReturnType<typeof mutableOf>
/** The refreshable columns. Everything else — status, verified, images, postedAt, rankScore — is create-only. */
function mutableOf(j: MappedJob, categoryId: string) {
  return {
    // No `titleVi`: left null on create, and never written on update — a Vietnamese title added later
    // (a moderator, a translation pass) must not be wiped by the next daily run.
    title: j.title, description: j.description, descriptionVi: j.descriptionVi,
    price: j.price, priceUnit: j.priceUnit, currency: '₫', salaryM: j.salaryM,
    negotiable: false,
    listingType: 'job',
    categoryId,
    subcategorySlug: j.subcategorySlug as string | null,
    sellerId: j.sellerId,
    location: j.location, district: null as string | null, city: j.city,
    lat: null as number | null, lng: null as number | null,
    attributes: JSON.stringify(j.attributes) as string | null,
    affiliateUrl: j.affiliateUrl as string | null,
    searchText: j.searchText,
  }
}

async function verify(db: Db): Promise<number> {
  const now = Date.now()
  const sellers = await db.seller.findMany({ where: { id: { in: JOB_SELLER_IDS } }, select: { id: true, name: true, ownerId: true, verified: true, verifiedSeller: true, officialPartner: true } })
  const rows = await db.listing.findMany({
    where: { sellerId: { in: JOB_SELLER_IDS }, status: 'active' },
    select: { id: true, sellerId: true, externalId: true, listingType: true, negotiable: true, affiliateUrl: true, images: true, attributes: true, verified: true, category: { select: { slug: true } } },
  })
  const bad: string[] = []
  for (const s of sellers) {
    const board = Object.values(JOB_BOARDS).find((b) => b.sellerId === s.id)!
    const r = sellerRefusal(s, board.name)
    if (r) bad.push(`seller ${s.id} ${r}`)
  }
  for (const r of rows) {
    const board = Object.values(JOB_BOARDS).find((b) => b.sellerId === r.sellerId)!
    let host = ''
    try { host = new URL(r.affiliateUrl ?? '').hostname } catch { /* counted */ }
    let imgs: unknown = null
    try { imgs = JSON.parse(r.images) } catch { /* counted */ }
    const why = [
      r.listingType !== 'job' && 'listingType',
      r.negotiable && 'negotiable',
      r.category.slug !== 'jobs' && 'category',
      !(board.hosts as readonly string[]).includes(host) && 'affiliateUrl host',
      !Array.isArray(imgs) || !imgs.length || !imgs.every((u) => typeof u === 'string' && (isOverlayImageUrl(u) || (isScratchDb(DB_URL) && u.startsWith('/')))) ? 'images' : false,
      isExpiredJob(r.attributes, now) && 'expired but active (run --expire)',
    ].filter(Boolean)
    if (why.length) bad.push(`${r.externalId} (${r.id}): ${why.join(', ')}`)
  }
  console.log(`job sellers       ${sellers.length}/${JOB_SELLER_IDS.length} exist`)
  console.log(`active job rows   ${rows.length} (${rows.filter((r) => r.verified).length} public)`)
  console.log(bad.length ? `FAILURES          ${bad.length}\n  ${bad.join('\n  ')}` : 'invariants        all hold')
  return bad.length ? 1 : 0
}

async function main() {
  if (!DB_URL) throw new Error('DIRECT_URL / DATABASE_URL is not set')
  if (PREVIEW_COVERS && !isScratchDb(DB_URL)) throw new Error('--preview-covers is for a loopback scratch database only — this is not one (the production tunnel is :5433)')
  if (PREVIEW_COVERS && !/^[a-z0-9-]+$/.test(PREVIEW_COVERS)) throw new Error('--preview-covers takes a bare folder name, e.g. job-preview')
  /** ⛔ Proven writable BEFORE the database or storage is touched (not /tmp). */
  const journal = APPLY && !PREVIEW_COVERS ? (JOURNAL_DIR ? prepareJournalDir(JOURNAL_DIR) : (() => { throw new Error('--apply needs --journal-dir <durable dir>') })()) : null

  const db = makeDb(!APPLY)
  if (VERIFY) { const code = await verify(db); await db.$disconnect(); process.exit(code) }
  if (!SRC && !EXPIRE) throw new Error('--src <jobs-stamp.json> is required (or --expire / --verify alone)')

  const now = Date.now()
  let stage: JobStage | null = null
  if (SRC) {
    stage = JSON.parse(readFileSync(SRC, 'utf8')) as JobStage
    const problem = jobStageProblem(stage, now)
    if (problem && APPLY) throw new Error(`refusing --apply: ${problem}`)
    if (problem) console.log(`⚠️ stage           ${problem} (dry run continues; --apply would refuse)`)
  }

  // ── map + filter ─────────────────────────────────────────────────────────────────────────────
  const drops: Partial<Record<JobDrop | 'noCover' | 'dupInStage', string[]>> = {}
  const drop = (why: keyof typeof drops, label: string) => { (drops[why] ??= []).push(label) }
  const keep: MappedJob[] = []
  const seen = new Set<string>()
  const stageDir = SRC ? resolve(SRC, '..') : ''
  for (const j of stage?.jobs ?? []) {
    const r = mapStagedJob(j, now)
    if (!r.ok) { drop(r.reason, `${j.source} ${j.title?.slice(0, 60)}`); continue }
    const cover = resolve(stageDir, '..', '..', r.job.coverPath)
    const coverAlt = resolve(stageDir, 'covers', basename(r.job.coverPath))
    const coverFile = existsSync(coverAlt) ? coverAlt : existsSync(cover) ? cover : null
    if (!coverFile || statSync(coverFile).size > 5_000_000) { drop('noCover', r.job.externalId); continue }
    if (seen.has(r.job.externalId)) { drop('dupInStage', r.job.externalId); continue }
    seen.add(r.job.externalId)
    keep.push({ ...r.job, coverPath: coverFile })
  }

  const category = await db.category.findFirst({ where: { slug: 'jobs' }, select: { id: true, name: true } })
  if (!category) throw new Error('no `jobs` category — cannot place these rows')
  const sellerIds = [...new Set(keep.map((k) => k.sellerId))]
  const sellers = await db.seller.findMany({ where: { id: { in: JOB_SELLER_IDS } }, select: { id: true, name: true, ownerId: true, verified: true, verifiedSeller: true, officialPartner: true, trustScore: true } })
  const sellerById = new Map(sellers.map((s) => [s.id, s]))
  const refusals = sellers.map((s) => {
    const board = Object.values(JOB_BOARDS).find((b) => b.sellerId === s.id)!
    const r = sellerRefusal(s, board.name)
    return r ? `seller ${s.id} ${r}` : null
  }).filter(Boolean) as string[]

  const stored = keep.length ? await db.listing.findMany({
    where: { sellerId: { in: sellerIds }, externalId: { in: keep.map((k) => k.externalId) } },
    select: {
      id: true, externalId: true, status: true, title: true, description: true, descriptionVi: true,
      price: true, priceUnit: true, currency: true, salaryM: true, negotiable: true, listingType: true, categoryId: true,
      subcategorySlug: true, sellerId: true, location: true, district: true, city: true, lat: true, lng: true,
      attributes: true, affiliateUrl: true, searchText: true,
    },
  }) : []
  const storedBy = new Map(stored.map((s) => [s.externalId, s]))
  const plan = keep.map((k) => {
    const s = storedBy.get(k.externalId)
    const mutable = mutableOf(k, category.id)
    const changed = s ? (Object.keys(mutable) as (keyof Mutable)[]).filter((f) => (s as Record<string, unknown>)[f] !== mutable[f]) : null
    return { k, s, mutable, changed }
  })
  const toCreate = plan.filter((p) => !p.s).slice(0, LIMIT || undefined)
  const toUpdate = plan.filter((p) => p.s && p.changed!.length)

  /** Postings the pipeline re-checked and found removed (stage.gone) → the active rows they map to. */
  const goneKeys = (stage?.gone ?? []).map((g) => jobExternalId(g.source, g.url)).filter((k): k is NonNullable<typeof k> => !!k)
  const goneRows = goneKeys.length ? await db.listing.findMany({
    where: { status: 'active', sellerId: { in: JOB_SELLER_IDS }, OR: goneKeys.map((k) => ({ sellerId: k.sellerId, externalId: k.externalId })) },
    select: { id: true, externalId: true },
  }) : []
  const activeJobs = EXPIRE ? await db.listing.findMany({ where: { sellerId: { in: JOB_SELLER_IDS }, listingType: 'job', status: 'active' }, select: { id: true, externalId: true, attributes: true } }) : []
  const expired = activeJobs.filter((r) => isExpiredJob(r.attributes, now))

  // ── report ───────────────────────────────────────────────────────────────────────────────────
  console.log(`stage             ${SRC ?? '(none)'}${stage ? ` · staged ${stage.stagedAt} · ${stage.jobs.length} jobs` : ''}`)
  console.log(`dropped           ${Object.entries(drops).map(([k, v]) => `${k} ${v!.length}`).join(' · ') || 'none'}`)
  for (const [k, v] of Object.entries(drops)) for (const l of v!) console.log(`  - ${pad(k, 14)} ${l}`)
  console.log(`category          ${category.name} (${category.id})`)
  console.log(`sellers           ${sellerIds.map((id) => `${id}${sellerById.has(id) ? '' : ' (NEW)'}`).join(', ') || '-'}`)
  console.log(`seller refusals   ${refusals.length ? refusals.join(' | ') : 'none'}`)
  console.log(`plan              create ${toCreate.length}${LIMIT ? ` (--limit ${LIMIT})` : ''} · update ${toUpdate.length} · unchanged ${plan.length - plan.filter((p) => !p.s).length - toUpdate.length}`)
  console.log(`expire            ${EXPIRE ? `${expired.length} of ${activeJobs.length} active job rows are past apply-by` : 'OFF (--expire not passed)'}`)
  console.log(`gone (re-checked) ${stage?.gone?.length ?? 0} in the stage → ${goneRows.length} active rows to hide${goneRows.length ? `: ${goneRows.map((r) => r.externalId).join(', ')}` : ''}`)
  for (const p of plan) {
    const k = p.k
    console.log(`  ${pad(p.s ? (p.changed!.length ? 'UPDATE' : 'same') : 'CREATE', 6)} ${pad(k.externalId, 34)} ${pad(k.city, 12)} ${pad(k.price ? `${k.price.toLocaleString('vi-VN')} ${k.priceUnit}` : 'salary: see details', 24)} ${k.applyBy}  ${k.title.slice(0, 70)}`)
  }
  if (keep[0]) {
    const p = plan[0]!
    console.log(`\n── sample row, as stored (create-only fields included) ──`)
    console.log(JSON.stringify({ ...p.mutable, externalId: p.k.externalId, status: 'active', verified: true, images: ['<cover>'], postedAt: p.k.postedAt.toISOString(), attributes: p.k.attributes }, null, 2))
  }

  if (!APPLY) {
    console.log(`\nmode              DRY RUN (database session read-only) — nothing written, nothing uploaded.`)
    await db.$disconnect(); return
  }
  if (refusals.length) throw new Error(`refusing to write: ${refusals.join('; ')}`)

  // ── APPLY ────────────────────────────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const UPLOADED = journal ? join(journal, `jobs-uploaded-objects-${stamp}.txt`) : null
  const CREATED = journal ? join(journal, `jobs-created-rows-${stamp}.jsonl`) : null
  let host: ReturnType<typeof makeImageHost> | null = null
  if (!PREVIEW_COVERS) {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
    const KEY = process.env.SUPABASE_SECRET_KEY
    if (!SUPABASE_URL || !KEY) throw new Error('storage unavailable — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set')
    if (/supabase\.co$/.test(new URL(SUPABASE_URL).hostname)) throw new Error(`refusing to upload to ${SUPABASE_URL} — retired project`)
    const bucket = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } }).storage.from(BUCKET)
    host = makeImageHost({ storage: bucket, storageUrl: SUPABASE_URL, bucket: BUCKET, edge: 1200, quality: 85, mark: 'overlay' })
  }
  console.log(`\nmode              APPLY — ${isScratchDb(DB_URL) ? 'SCRATCH DATABASE (loopback)' : 'WRITES TO PRODUCTION'}${CREATED ? `\njournal           ${CREATED}\nupload manifest   ${UPLOADED}` : ''}`)

  for (const id of sellerIds) {
    if (sellerById.has(id)) continue
    const board = Object.values(JOB_BOARDS).find((b) => b.sellerId === id)!
    /** No owner and no badge: nothing here implies eno vetted the board or its employers. */
    await db.seller.create({ data: { id, name: board.name, verified: false, verifiedSeller: false, officialPartner: false } })
    console.log(`seller created    ${id} (${board.name})`)
  }
  const trustOf = async (id: string) => sellerById.get(id)?.trustScore ?? (await db.seller.findUnique({ where: { id }, select: { trustScore: true } }))?.trustScore ?? 100

  const stat = { created: 0, updated: 0, uploadFailed: 0, raced: 0, errored: 0, hidden: 0 }
  const touched: string[] = []
  for (const p of toUpdate) {
    try {
      const data: Partial<Mutable> = {}
      for (const f of p.changed!) Object.assign(data, { [f]: p.mutable[f] })
      await db.listing.update({ where: { id: p.s!.id }, data })
      touched.push(p.s!.id)
      stat.updated++
    } catch (e) { stat.errored++; console.warn(`  ! ${p.k.externalId}: ${(e as Error).message.slice(0, 160)}`) }
  }
  for (const p of toCreate) {
    try {
      /** ⛔ The cover is uploaded FIRST and recorded before it is judged; no row is born imageless. */
      let image: string | null
      if (PREVIEW_COVERS) {
        const dir = resolve('public', PREVIEW_COVERS)
        mkdirSync(dir, { recursive: true })
        const name = `${p.k.externalId.replace(/[^a-z0-9]+/gi, '-')}.png`
        copyFileSync(p.k.coverPath, join(dir, name))
        image = `/${PREVIEW_COVERS}/${name}`
      } else {
        image = await host!.fromBuffer(readFileSync(p.k.coverPath), `job-${p.k.externalId.replace(/[^a-z0-9]+/gi, '-')}`)
        if (image) recordDurably(UPLOADED!, image)
        if (!image || !isOverlayImageUrl(image)) { stat.uploadFailed++; continue }
      }
      const created = await db.listing.create({
        data: {
          ...p.mutable,
          externalId: p.k.externalId,
          /** ⛔ CREATE-ONLY: `verified` is the PUBLICATION GATE (feed-query.ts); status and images belong to
           *  this create and to moderation — a refresh never resets them. */
          status: 'active', verified: true,
          images: JSON.stringify([image]),
          postedAt: p.k.postedAt,
          rankScore: browseRankScore({ sellerTrustScore: await trustOf(p.k.sellerId), postedAt: p.k.postedAt, featured: false }),
        },
        select: { id: true },
      })
      if (CREATED) recordDurably(CREATED, JSON.stringify({ id: created.id, externalId: p.k.externalId }))
      stat.created++
    } catch (e) {
      /** P2002 = the unique (sellerId, externalId): another run created it between read and write. */
      if ((e as { code?: string }).code === 'P2002') stat.raced++
      else { stat.errored++; console.warn(`  ! ${p.k.externalId}: ${(e as Error).message.slice(0, 160)}`) }
    }
  }
  const retire = [...new Map([...expired, ...goneRows].map((r) => [r.id, r])).values()]
  if (retire.length) {
    /** 'hidden', never 'sold' or DELETE — a closed posting was not filled through eno. One-way: status is create-only. */
    stat.hidden = (await db.listing.updateMany({ where: { id: { in: retire.map((r) => r.id) }, sellerId: { in: JOB_SELLER_IDS }, status: 'active' }, data: { status: 'hidden' } })).count
    if (CREATED) recordDurably(CREATED, JSON.stringify({ hidden: retire.map((r) => r.externalId) }))
    touched.push(...retire.map((r) => r.id))
  }
  const ts = await tombstone(db, touched)

  const active = await db.listing.count({ where: { sellerId: { in: JOB_SELLER_IDS }, status: 'active' } })
  console.log(`\n${JSON.stringify(stat)}   active job rows now ${active}\nISR tombstones    ${ts}`)
  console.log(`\nVERIFY:   npx tsx scripts/import-jobs.ts --verify`)
  console.log(`ROLLBACK (safe, reversible — removes every linked job from every public surface; then run purge-isr-listings.mjs):`)
  console.log(`  UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" IN ('${JOB_SELLER_IDS.join("','")}');`)
  console.log(`  -- never DELETE: Order is onDelete:Restrict and six relations Cascade.${UPLOADED ? ` Uploaded covers: ${UPLOADED}` : ''}`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
