// The Import from Facebook worker, in a container on the box (README.md). It asks eno for a job, reads one seller's pages at a fixed pace, and reports.
// ⛔ A LOGIN OR CHECKPOINT PAGE STOPS IT until a person logs in again (login.mjs). It never answers Facebook, retries around a wall, or changes how it looks.
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findSeller, listSellerItems, readItem, setPageCounter, Walled } from './reader.mjs'

const HOME = join(homedir(), 'eno-fb-import')
const PROFILE = join(HOME, 'profile')
const STATE = join(HOME, 'state')
const STOP = join(STATE, 'STOP')
const API = process.env.ENO_API || 'https://eno.vn'
const TOKEN = readFileSync(join(HOME, 'secrets/worker.token'), 'utf8').trim()
/** A limit on how much one account reads, not a disguise. */
const PAGES_PER_DAY = Number(process.env.FB_PAGES_PER_DAY || 300)
const POLL_MS = 60_000
const GAP_MS = 3_000
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(STATE, { recursive: true })

const today = () => new Date().toISOString().slice(0, 10)
const budgetFile = () => join(STATE, `pages-${today()}.json`)
const pagesToday = () => { try { return JSON.parse(readFileSync(budgetFile(), 'utf8')).n } catch { return 0 } }
setPageCounter(() => writeFileSync(budgetFile(), JSON.stringify({ n: pagesToday() + 1 })))

async function call(path, body) {
  const res = await fetch(`${API}/api/fb-import/worker/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(60_000) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
class LeaseLost extends Error {}
async function report(body) {
  const r = await call('report', body)
  if (r.status === 409) throw new LeaseLost()
  if (r.status !== 200) throw new Error(`report answered ${r.status}`)
}

/**
 * ⛔ SOFT BLOCKS KEEP THEIR ADDRESS, so they look like empty answers: no result for a name Facebook itself gave us, no seller panel, item pages with nothing on them. One can be that seller's own page, so that job
 * alone ends as unavailable, and a person hears. Three running is the account: stop, rather than keep reading at something about to lock.
 */
let softBlocks = 0
async function softBlock(where, base) {
  if (++softBlocks >= 3) throw new Walled(where)
  console.error('soft block', where)
  await report({ kind: 'unavailable', ...base })
}

async function runJob(context, job) {
  const page = context.pages()[0] ?? (await context.newPage())
  const base = { jobId: job.jobId, leaseId: job.leaseId }
  const found = await findSeller(page, { name: job.name, pictureShas: job.pictureShas }, async (u) => Buffer.from(await (await context.request.get(u)).body()))
  console.log(new Date().toISOString(), 'find', { found: !!found.sellerId, opened: found.opened })
  if (found.results === 0) return softBlock('empty_search', base)
  if (!found.sellerId) return report({ kind: 'not_found', ...base })
  const list = await listSellerItems(page, found.sellerId, { max: job.maxItems })
  console.log(new Date().toISOString(), 'list', { panel: list.panel, items: list.ids.length })
  if (!list.panel) return softBlock('no_seller_panel', base)
  let unreadable = 0
  let batch = []
  for (const id of list.ids) {
    await wait(GAP_MS)
    // One page that won't load costs that item, not the seller's whole import. A wall still stops everything.
    const it = await readItem(page, id).catch((e) => { if (e instanceof Walled) throw e; console.error('item failed', e.name); return null })
    if (!it?.title) { unreadable++; continue }
    // ⛔ THE SECOND LINE: only this seller's own, live, unsold listings ever leave this computer.
    if (it.sellerId !== found.sellerId || !it.title || it.isSold || it.isHidden || it.isLive === false) continue
    const condition = it.attributes?.find((a) => /condition/i.test(String(a.name)))
    batch.push({ fbItemId: id, title: it.title.slice(0, 300), description: it.description?.slice(0, 10_000) ?? null, priceAmount: it.price?.amount != null ? String(it.price.amount).slice(0, 32) : null, currency: it.price?.currency?.slice(0, 8) ?? null, location: it.location?.slice(0, 300) ?? null, condition: condition?.label ? String(condition.label).slice(0, 60) : null, photos: (it.photos ?? []).filter((u) => /^https:\/\/[^/]*\.fbcdn\.net\//.test(u)).slice(0, 20) })
    if (batch.length >= 10) { await report({ kind: 'items', ...base, items: batch }); batch = [] }
  }
  if (batch.length) await report({ kind: 'items', ...base, items: batch })
  if (list.ids.length >= 3 && unreadable === list.ids.length) return softBlock('unreadable_items', base)
  softBlocks = 0
  await report({ kind: 'finished', ...base })
}

// A container restart can leave Chrome's lock behind on this folder, and only this one worker uses it.
for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) rmSync(join(PROFILE, f), { force: true })
const context = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'Asia/Ho_Chi_Minh' })
// Chrome gone means every job would fail on its first page and use up a seller's imports: exit, and the container restarts it.
context.on('close', () => { console.error('browser closed: exiting'); process.exit(1) })
for (;;) {
  // ⛔ No name checked by login.mjs, no reading: this could be any account, the leads one included.
  if (existsSync(STOP) || !existsSync(join(STATE, 'reader-name'))) { await wait(5 * POLL_MS); continue }
  // A whole job fits in what's left of today, or it waits for tomorrow in eno's queue.
  if (pagesToday() + 130 > PAGES_PER_DAY) { await wait(5 * POLL_MS); continue }
  let job = null
  try {
    const claim = await call('claim')
    // ⛔ A refusal must not read as "no work": a wrong token or a block would otherwise look like a quiet queue for ever.
    if (claim.status !== 200) console.error('claim refused', claim.status)
    job = claim.json?.job ?? null
  } catch (e) { console.error('claim failed', e.name) }
  if (!job) { await wait(POLL_MS); continue }
  console.log(new Date().toISOString(), 'job', job.jobId)
  try {
    await runJob(context, job)
  } catch (e) {
    if (e instanceof LeaseLost) { console.error('lease lost: dropping the job'); continue }
    if (e instanceof Walled) {
      // The person who answers Facebook is the owner, by hand. Nothing here tries.
      writeFileSync(STOP, `${new Date().toISOString()} ${e.where}\n`)
      console.error('WALL', e.where, ': stopped until a person runs login.mjs')
      await report({ kind: 'unavailable', jobId: job.jobId, leaseId: job.leaseId }).catch(() => {})
      continue
    }
    console.error('job failed', e.name)
    await report({ kind: 'error', jobId: job.jobId, leaseId: job.leaseId }).catch(() => {})
  }
}
