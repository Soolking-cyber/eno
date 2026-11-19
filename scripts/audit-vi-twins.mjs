#!/usr/bin/env node
/**
 * ⛔ THE `/vi` TWIN AUDIT (phase 1 of the Vietnamese URLs, owner 2026-11-19). Run it against a local preview before the
 * deploy and against eno.vn after it; any failure exits 1.
 *
 * WHAT IT READS: the pairs the sitemap submits — each `<url>` of /sitemaps/pages.xml whose `xhtml:link` alternates name a
 * `vi-VN` twin (src/lib/sitemap.ts `langUrlEntries`). So it audits exactly what eno.vn asks Google to index, and needs no
 * copy of the family patterns (src/lib/lang-pinned.ts `VI_TWIN_FAMILIES`). It groups them by family (category, category ×
 * district, help, schools, awards; anything else is "other" and is audited too) and takes N per family, spread evenly
 * over the sorted list, the hub page first.
 *
 * WHAT IT CHECKS, per pair:
 *   sitemap   the plain and the `/vi` entry are both there, with the same en / vi-VN / x-default links.
 *   vi        `/vi/<path>`, fetched with an English browser and no cookie: 200 (a redirect fails), `<html lang="vi">`,
 *             canonical = itself, hreflang en = plain, vi-VN = itself, x-default = plain.
 *   en        the plain URL with an English browser: 200, `<html lang="en">`, canonical = itself, the same three links.
 *   vi-cookie the plain URL with the `lang=vi` cookie: `<html lang="vi">` and canonical = the `/vi` URL (the head follows
 *             the language the page rendered — owner's scoping, 2026-11-19). On a PILOT path (`PILOT_PATHS`) the plain
 *             URL is English for everyone (rule V-a, kept by that scoping), so there it must be `en` and self-canonical.
 *   text      the Vietnamese share of the `/vi` page's `<main>` text (else `<body>`), in the server HTML — text the
 *             browser translates later is not there, which is the point (critic #2, 2026-11-19). CRUDE, BY DESIGN: a word
 *             with a Vietnamese diacritic counts Vietnamese, an English function word ("the", "with", "your" …) counts
 *             English, every other word (numbers, brands, model names, diacritic-free syllables) counts neither. The
 *             share is vi / (vi + en) and must be ≥ --min-vi (0.8); fewer than --min-words (20) marked words fails too
 *             (an empty page proves nothing).
 *
 * The expected URLs are the sitemap's own (its origin is NEXT_PUBLIC_APP_URL, as the heads' metadataBase is); pages are
 * fetched from the base URL at the same paths, so a local preview is audited against the canonical eno.vn addresses.
 *
 * Read-only: GETs only, from this machine.
 *
 * Usage: node scripts/audit-vi-twins.mjs [base=https://eno.vn] [--n=5] [--sitemap=<url>] [--min-vi=0.8] [--min-words=20]
 *        [--paths=/c/rentals,/help]   audit these plain paths instead of the sitemap's pairs (expected origin: --origin,
 *                                     else the base URL)
 */
import { pathToFileURL } from 'node:url'

const UA = 'eno-vi-twin-audit/1'
/** src/lib/lang-pinned.ts `VI_PREFIX_PATHS` — the pilot (rule V-a). src/lib/audit-vi-twins.test.ts holds the two equal. */
export const PILOT_PATHS = ['/', '/c/furniture-appliances']
const EN_BROWSER = 'en-US,en;q=0.9'

/** Vietnamese letters with a diacritic (and đ), lower and upper case, NFC. */
const VI_LETTER = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/iu
/**
 * English function words. ⚠️ Words that are also common diacritic-free Vietnamese syllables are left out — an, to, no, in,
 * can, con, ban, me, hay, the — so "Bình An" or "xe to" never reads as English.
 */
const EN_WORDS = new Set(
  ('and for with of on your you is are this that from by at or our we it be will more all has have not new used near per '
    + 'month see find get how what when where who why which about into than then there their they was were been its any each '
    + 'only also just over after before under out here other some such these those would should could my his her').split(' '),
)

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** The attributes of one start tag, names lowercased (React writes `hrefLang`). */
function attrs(tag) {
  const out = {}
  for (const m of tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '')
  return out
}

/** `<html lang>`, every canonical href, and the hreflang → href alternates of one HTML document. */
export function readHead(html) {
  const lang = attrs(/<html\b[^>]*>/i.exec(html)?.[0] ?? '').lang ?? null
  const canonicals = []
  const alternates = {}
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0])
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/)
    if (rel.includes('canonical') && a.href) canonicals.push(a.href)
    if (rel.includes('alternate') && a.hreflang && a.href) alternates[a.hreflang] = a.href
  }
  return { lang, canonicals, alternates }
}

/** The visible text of `<main>` (else `<body>`, else the document), scripts, styles and SVG removed. */
export function mainText(html) {
  const open = html.search(/<main\b/i)
  const close = html.toLowerCase().lastIndexOf('</main>')
  let region = open >= 0 && close > open ? html.slice(open, close) : null
  let source = 'main'
  if (region === null) {
    const b = /<body\b[\s\S]*<\/body>/i.exec(html)
    region = b ? b[0] : html
    source = b ? 'body' : 'document'
  }
  const text = region
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return { text: decodeEntities(text).normalize('NFC'), source }
}

/** The crude Vietnamese share (see the header): words with a Vietnamese diacritic vs English function words. */
export function vietnameseShare(text) {
  let vi = 0
  let en = 0
  for (const w of text.normalize('NFC').match(/\p{L}+/gu) ?? []) {
    if (VI_LETTER.test(w)) vi++
    else if (EN_WORDS.has(w.toLowerCase())) en++
  }
  return { vi, en, share: vi + en ? vi / (vi + en) : 0 }
}

/** A sitemap's `<url>` entries: loc and its xhtml alternates. */
export function readSitemap(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const loc = decodeEntities(/<loc>([\s\S]*?)<\/loc>/.exec(m[1])?.[1]?.trim() ?? '')
    const links = {}
    for (const l of m[1].matchAll(/<xhtml:link\b[^>]*>/g)) {
      const a = attrs(l[0])
      if (a.hreflang && a.href) links[a.hreflang] = a.href
    }
    return { loc, links }
  })
}

/** Which family a plain path is in, for sampling and the table. Shape only — the sitemap decided it is a twin. */
export function familyOf(path) {
  if (/^\/c\/[^/]+$/.test(path)) return 'category'
  if (/^\/c\/[^/]+\/[^/]+$/.test(path)) return 'category×district'
  if (/^\/help(\/[^/]+)?$/.test(path)) return 'help'
  if (/^\/schools\/awards\/\d{4}$/.test(path)) return 'awards'
  if (/^\/schools(\/[^/]+)?$/.test(path)) return 'schools'
  return 'other'
}

/** The sitemap's pairs, each with the sitemap check's verdict. */
export function pairsFromSitemap(entries) {
  const byLoc = new Map(entries.map((e) => [e.loc, e]))
  const pairs = []
  for (const e of entries) {
    const vi = e.links['vi-VN']
    if (!vi || e.loc !== vi) continue // take each pair once, from its /vi entry
    const plain = e.links.en
    const twin = plain ? byLoc.get(plain) : undefined
    const problems = []
    if (!plain) problems.push('no en link')
    else if (!twin) problems.push('plain entry missing')
    else if (JSON.stringify(sorted(twin.links)) !== JSON.stringify(sorted(e.links))) problems.push('plain and /vi links differ')
    if (e.links['x-default'] !== plain) problems.push('x-default ≠ plain')
    pairs.push({ plain, vi, sitemap: problems })
  }
  // A plain entry that names a twin the sitemap does not list.
  for (const e of entries) {
    const vi = e.links['vi-VN']
    if (vi && e.loc !== vi && !byLoc.has(vi)) pairs.push({ plain: e.loc, vi, sitemap: ['/vi entry missing'] })
  }
  return pairs
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

/** N items spread evenly over the list, the first always included. */
export function spread(list, n) {
  if (list.length <= n) return list
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1 || 1))])
}

async function get(url, headers) {
  const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(30_000) })
  return { status: res.status, location: res.headers.get('location'), html: res.status === 200 ? await res.text() : '' }
}

/** One pair, every check; `fail` lists what went wrong. */
async function auditPair(base, pair, opts) {
  const plainPath = new URL(pair.plain).pathname
  const viPath = new URL(pair.vi).pathname
  const fail = [...pair.sitemap.map((p) => `sitemap: ${p}`)]
  const triple = { en: pair.plain, 'vi-VN': pair.vi, 'x-default': pair.plain }
  const head = (label, page, wantLang, wantCanonical, needLinks) => {
    if (page.status !== 200) return void fail.push(`${label}: HTTP ${page.status}${page.location ? ` → ${page.location}` : ''}`)
    const h = readHead(page.html)
    if (!(h.lang ?? '').toLowerCase().startsWith(wantLang)) fail.push(`${label}: <html lang="${h.lang}">`)
    if (h.canonicals.length !== 1) fail.push(`${label}: ${h.canonicals.length} canonicals`)
    else if (h.canonicals[0] !== wantCanonical) fail.push(`${label}: canonical ${h.canonicals[0]}`)
    if (needLinks) for (const [k, v] of Object.entries(triple)) if (h.alternates[k] !== v) fail.push(`${label}: hreflang ${k} = ${h.alternates[k] ?? 'none'}`)
    return h
  }
  const [vi, en, viCookie] = await Promise.all([
    get(`${base}${viPath}`, { 'accept-language': EN_BROWSER }),
    get(`${base}${plainPath}`, { 'accept-language': EN_BROWSER }),
    get(`${base}${plainPath}`, { 'accept-language': EN_BROWSER, cookie: 'lang=vi' }),
  ])
  head('vi', vi, 'vi', pair.vi, true)
  head('en', en, 'en', pair.plain, true)
  if (PILOT_PATHS.includes(plainPath)) head('vi-cookie', viCookie, 'en', pair.plain, true)
  else head('vi-cookie', viCookie, 'vi', pair.vi, true)
  let share = null
  if (vi.status === 200) {
    const { text, source } = mainText(vi.html)
    share = { ...vietnameseShare(text), source }
    if (share.vi + share.en < opts.minWords) fail.push(`text: ${share.vi + share.en} marked words in <${source}> (< ${opts.minWords})`)
    else if (share.share < opts.minVi) fail.push(`text: ${(share.share * 100).toFixed(0)}% Vietnamese (< ${opts.minVi * 100}%)`)
  }
  return { family: familyOf(plainPath), path: plainPath, vi, en, share, fail }
}

async function pool(items, size, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

function parseArgs(argv) {
  const opts = { base: 'https://eno.vn', n: 5, sitemap: null, minVi: 0.8, minWords: 20, paths: null, origin: null }
  for (const a of argv) {
    const [k, v] = a.startsWith('--') ? [a.slice(2, a.includes('=') ? a.indexOf('=') : undefined), a.includes('=') ? a.slice(a.indexOf('=') + 1) : ''] : [null, a]
    if (k === null) opts.base = v
    else if (k === 'n') opts.n = Number(v)
    else if (k === 'sitemap') opts.sitemap = v
    else if (k === 'min-vi') opts.minVi = Number(v)
    else if (k === 'min-words') opts.minWords = Number(v)
    else if (k === 'paths') opts.paths = v.split(',').map((p) => p.trim()).filter(Boolean)
    else if (k === 'origin') opts.origin = v.replace(/\/+$/, '')
    else throw new Error(`unknown option --${k}`)
  }
  opts.base = opts.base.replace(/\/+$/, '')
  if (!(opts.n >= 1) || !(opts.minVi > 0 && opts.minVi <= 1) || !(opts.minWords >= 0)) throw new Error('bad --n, --min-vi or --min-words')
  return opts
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`${e.message}\nUsage: node scripts/audit-vi-twins.mjs [base] [--n=5] [--sitemap=<url>] [--min-vi=0.8] [--min-words=20] [--paths=/a,/b] [--origin=<url>]`)
    process.exit(2)
  }
  let pairs
  if (opts.paths) {
    const origin = opts.origin ?? opts.base
    pairs = opts.paths.map((p) => ({ plain: p === '/' ? origin : `${origin}${p}`, vi: `${origin}${p === '/' ? '/vi' : `/vi${p}`}`, sitemap: [] }))
  } else {
    const url = opts.sitemap ?? `${opts.base}/sitemaps/pages.xml`
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) })
    if (res.status !== 200) {
      console.error(`${url}: HTTP ${res.status}`)
      process.exit(1)
    }
    pairs = pairsFromSitemap(readSitemap(await res.text()))
    if (!pairs.length) {
      console.error(`${url} submits no /vi pair — nothing to audit (is this build before phase 1?)`)
      process.exit(1)
    }
  }
  const byFamily = new Map()
  for (const p of pairs.sort((a, b) => a.plain.localeCompare(b.plain))) {
    const f = familyOf(new URL(p.plain).pathname)
    byFamily.set(f, [...(byFamily.get(f) ?? []), p])
  }
  const sample = [...byFamily.values()].flatMap((list) => spread(list, opts.n))
  const rows = await pool(sample, 4, (p) => auditPair(opts.base, p, opts).catch((e) => ({ family: familyOf(new URL(p.plain).pathname), path: new URL(p.plain).pathname, vi: { status: 'ERR' }, en: { status: 'ERR' }, share: null, fail: [`fetch: ${e.message}`] })))

  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  const table = [['family', 'path', 'vi', 'en', 'vi text', 'result']]
  for (const r of rows) {
    table.push([r.family, cut(r.path, 52), String(r.vi.status), String(r.en.status), r.share ? `${(r.share.share * 100).toFixed(0)}% (${r.share.vi}/${r.share.vi + r.share.en})` : '-', r.fail.length ? 'FAIL' : 'ok'])
  }
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)))
  for (const [i, row] of table.entries()) {
    console.log(row.map((c, j) => c.padEnd(widths[j])).join('  ').trimEnd())
    if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  }
  const failed = rows.filter((r) => r.fail.length)
  console.log(`\n${opts.base}: ${pairs.length} pairs in ${byFamily.size} families (${[...byFamily].map(([f, l]) => `${f} ${l.length}`).join(', ')}); audited ${rows.length}, ${failed.length} failed.`)
  for (const r of failed) console.log(`\n✗ ${r.path}\n  ${r.fail.join('\n  ')}`)
  process.exit(failed.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
