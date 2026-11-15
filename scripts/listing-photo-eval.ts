/**
 * THE LISTING PHOTO CHECK'S EVAL GATE — run it, and pass it, before the check is wired anywhere (plan §1, 2026-11-15).
 *
 *   npx tsx scripts/listing-photo-eval.ts [--dir <q11>] [--concurrency 4] [--out reads.json]
 *
 * Reads <dir>/labels.json (per listing, per photo index: F = flyer or ad graphic, C = the seller's contact printed; any
 * photo not listed is clean) and <dir>/img/NNN_<listingId>_<photoIndex>.jpg; <dir>/rows.json gives each listing's category
 * (the flyer rule is off for jobs). Default dir: ~/eno-ui-climb-work.noindex/cook/q11.
 * Each photo is read by EACH model on its own — no hedge — with the app's own prompt, prep and decision
 * (src/lib/listing-photo-check.ts), then the two reads together, as the pass decides them.
 * Pass bar, per model AND for the two together: no clean photo refused, at most 2 F photos missed, every C photo read as
 * contact. ⛔ It refuses to score (exit 1) when no photo loads or a labelled photo has no image: either would pass a bar it
 * never measured.
 * Then record the result in listing-photo-check.ts's header.
 *
 * ⛔ CREDENTIALS COME FROM process.env ONLY — this script loads no .env file; the operator runs it with the env loaded.
 * ⚠️ It costs money: two model calls per photo (~350 for the 173). It writes nothing but --out.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { GoogleGenAI } from '@google/genai'
import { invokedDirectly } from '../src/lib/cli-entry'
import { decideReads, flyerRuleFor, photoForCheck, photoRule, readPhoto, PHOTO_MODELS, type PhotoRead } from '../src/lib/listing-photo-check'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const F_MISSES_ALLOWED = 2

export type Photo = { file: string; listingId: string; index: number; label: string; flyerRule: boolean }
/** What one model (or the two together) made of a photo. */
type Called = 'ok' | 'flyer' | 'contact' | 'unconfirmed' | 'error'

/** Same env, same order as src/lib/gemini.ts getGemini() (API key first, then a Vertex service account). */
function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (apiKey) return new GoogleGenAI({ apiKey })
  const project = process.env.GEMINI_PROJECT || process.env.GOOGLE_VERTEX_PROJECT
  const raw = process.env.GEMINI_CREDENTIALS?.trim() || process.env.GOOGLE_VERTEX_CREDENTIALS?.trim()
  if (!project || !raw) {
    console.error('need GEMINI_API_KEY, or GEMINI_PROJECT/GOOGLE_VERTEX_PROJECT + GEMINI_CREDENTIALS/GOOGLE_VERTEX_CREDENTIALS in the environment')
    process.exit(1)
  }
  // ⚠️ `global` is mandatory: the 3.x flash line and 4 Hydrogen 404 on regional endpoints (gemini-model.ts).
  return new GoogleGenAI({ vertexai: true, project, location: process.env.GEMINI_LOCATION || 'global', googleAuthOptions: { credentials: JSON.parse(raw) } })
}

/** The labelled set. Throws when it is empty or a labelled photo is missing from img/ (fewer positives = an easier bar). */
export function loadPhotos(dir: string): Photo[] {
  const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')) as Record<string, Record<string, string> | string>
  const rowsPath = join(dir, 'rows.json')
  const category = new Map<string, string>(existsSync(rowsPath) ? (JSON.parse(readFileSync(rowsPath, 'utf8')) as [string, string][]).map(([c, id]) => [id, c]) : [])
  const photos = readdirSync(join(dir, 'img')).sort().flatMap((file): Photo[] => {
    // Listing ids are cuids or UUIDs: no underscore in either.
    const m = /^\d+_([a-z0-9-]+)_(\d+)\.jpe?g$/i.exec(file)
    if (!m) { console.warn(`⚠️ skipped, not NNN_<listingId>_<index>.jpg: ${file}`); return [] }
    const byIndex = labels[m[1]]
    const label = typeof byIndex === 'object' ? (byIndex[m[2]] ?? '') : ''
    return [{ file, listingId: m[1], index: Number(m[2]), label, flyerRule: flyerRuleFor(category.get(m[1]) ?? '') }]
  })
  if (!photos.length) throw new Error(`no photos loaded from ${join(dir, 'img')}`)
  // A label with no image behind it would quietly shrink the positives.
  const missing = Object.entries(labels).flatMap(([id, byIndex]) => (typeof byIndex !== 'object' ? [] : Object.keys(byIndex)
    .filter((i) => !photos.some((p) => p.listingId === id && p.index === Number(i))).map((i) => `${id} #${i}`)))
  if (missing.length) throw new Error(`labelled photo(s) not in img/: ${missing.join(', ')}`)
  return photos
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

function score(name: string, photos: Photo[], called: Called[], facts: Array<string | undefined>): boolean {
  const f = photos.flatMap((p, i) => (p.label.includes('F') ? [i] : []))
  const c = photos.flatMap((p, i) => (p.label.includes('C') ? [i] : []))
  const clean = photos.flatMap((p, i) => (p.label ? [] : [i]))
  const refused = (i: number) => called[i] === 'flyer' || called[i] === 'contact'
  const fHit = f.filter(refused).length
  const cHit = c.filter((i) => called[i] === 'contact').length
  const fp = clean.filter(refused).length
  const pass = fp === 0 && fHit >= f.length - F_MISSES_ALLOWED && cHit === c.length
  console.log(`\n${name}: F ${fHit}/${f.length} refused · C ${cHit}/${c.length} contact · clean ${fp}/${clean.length} refused → ${pass ? 'PASS' : 'FAIL'}`)
  const kinds: Called[] = ['ok', 'flyer', 'contact', 'unconfirmed', 'error']
  console.log(`  label\\called ${kinds.map((k) => k.padStart(12)).join('')}`)
  for (const [row, idx] of [['F', f.filter((i) => !c.includes(i))], ['FC', f.filter((i) => c.includes(i))], ['C', c.filter((i) => !f.includes(i))], ['clean', clean]] as const) {
    console.log(`  ${row.padEnd(13)}${kinds.map((k) => String(idx.filter((i) => called[i] === k).length).padStart(12)).join('')}`)
  }
  photos.forEach((p, i) => {
    const tag = p.label
      ? ((p.label.includes('C') ? called[i] === 'contact' : refused(i)) ? null : 'miss')
      : (refused(i) ? 'false+' : called[i] === 'ok' ? null : called[i])
    if (tag) console.log(`  ${tag.padEnd(11)} ${p.file} label=${p.label || 'clean'} called=${called[i]} ${facts[i] ?? ''}`)
  })
  return pass
}

const isRead = (r: PhotoRead | string): r is PhotoRead => typeof r !== 'string'

/** Each model on its own, then both agreeing (the pass's own decision): true only when ALL of them pass the bar. */
export function gate(photos: Photo[], reads: Array<Array<PhotoRead | string>>): boolean {
  let all = true
  PHOTO_MODELS.forEach((model, m) => {
    const called = reads.map((rs, i): Called => (isRead(rs[m]) ? photoRule(rs[m].facts, photos[i]) : 'error'))
    all = score(model, photos, called, reads.map((rs) => (isRead(rs[m]) ? JSON.stringify(rs[m].facts) : rs[m]))) && all
  })
  // The pass's own decision: a refusal stands only on two reads that agree — and it is part of the bar.
  const both = reads.map((rs, i): Called => {
    const ok = rs.filter(isRead)
    if (!ok.length) return 'error'
    const d = decideReads(ok, photos[i])
    return d.rule === 'ok' ? 'ok' : d.confirmed ? d.rule : 'unconfirmed'
  })
  return score('both models agreeing', photos, both, reads.map((rs) => rs.map((r) => (isRead(r) ? `${r.model}=${JSON.stringify(r.facts)}` : r)).join(' '))) && all
}

async function main() {
  const dir = arg('dir') ?? join(homedir(), 'eno-ui-climb-work.noindex', 'cook', 'q11')
  const photos = loadPhotos(dir)
  const labelled = photos.filter((p) => p.label).length
  console.log(`${photos.length} photos in ${dir} (${labelled} labelled, ${photos.length - labelled} clean); models ${PHOTO_MODELS.join(', ')}`)
  const ai = client()
  const free = async () => true
  const reads = await pool(photos, Number(arg('concurrency') ?? 4), async (p) => {
    const jpeg = await photoForCheck(sharp, readFileSync(join(dir, 'img', p.file)))
    return Promise.all(PHOTO_MODELS.map((m) => readPhoto(ai, jpeg, m, free).catch((e: unknown): string => String((e as Error)?.message ?? e))))
  })
  const all = gate(photos, reads)
  const out = arg('out')
  if (out) writeFileSync(out, JSON.stringify(photos.map((p, i) => ({ ...p, reads: reads[i] })), null, 1))
  console.log(`\n${all ? '✅ both models, and the two agreeing, pass the bar' : '❌ below the bar — do not wire the check'}`)
  process.exitCode = all ? 0 : 1
}

if (invokedDirectly(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1) })
