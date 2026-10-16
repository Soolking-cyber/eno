#!/usr/bin/env node
// ── The page-speed totals, as percentiles (speed plan item 5, 2026-10-16) ──────────────────────────────────
//
//   DATABASE_URL=… node scripts/rum-report.mjs [--days 7] [--edition marketplace|services] [--min 5]
//   (Node ≥24 — package.json engines — so the .ts import below is type-stripped; run it where the repo runs: the laptop
//   through the DB tunnel, like the other read scripts.)
//
// READ-ONLY: one SELECT on rum_daily (scripts/rum-ddl.mjs; what each family holds: src/lib/rum/ops.ts).
// p50/p75/p90 are interpolated inside the bucket that holds them — linearly between its lower edge and the next one;
// the last bucket is open, so a percentile there prints as "≥edge". A −1 left by a forged "move" is read as 0.
// ⛔ A GROUP BELOW --min (default 5) PRINTS ONLY "<5": the report never shows a cell small enough to be one visit.
// Each metric is shown twice — by page kind (all browsers) and by browser class (all pages) — because 11 kinds × 24
// classes would split a small site's traffic into cells too thin to read.
import pg from 'pg'
import { RUM_EDGES } from '../src/lib/rum/shared.ts'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const DAYS = Math.max(1, Number(arg('days', '7')) || 7)
const EDITION = arg('edition', null)
const MIN = Math.max(1, Number(arg('min', '5')) || 5)

const SCALE = { ttfb: 'ttfb', fcp: 'ms', lcp: 'ms', hyd: 'ms', hydx: 'ms', nav: 'ms', inp: 'inp', cls: 'cls', edge: 'ttfb', origin: 'origin', app: 'origin', lcpk: 'ms', dev: 'ms' }
const LABEL = {
  ttfb: 'first byte (ms)', fcp: 'first content (ms)', lcp: 'largest content (ms)', hyd: 'links work — "usable" (ms)',
  hydx: 'hidden before its links worked: time on page (ms)', cls: 'layout shift', inp: 'slowest tap/key response (ms)',
  nav: 'soft navigation to the next page\'s first frame (ms)', edge: 'first byte by data centre | what answered (ms)',
  origin: 'edge → origin wait, Worker view (ms)', app: 'app time at the box by page | Next cache (ms)',
  lcpk: 'largest content by page | element kind (ms)', dev: 'by device memory tier (GB) (ms)',
}

/** p in 0..1 from {bucket → n}; null when empty. */
export function percentile(scale, counts, p) {
  const edges = RUM_EDGES[scale]
  const total = [...counts.values()].reduce((a, n) => a + n, 0)
  if (!total) return null
  const target = p * total
  let cum = 0
  for (let i = 0; i < edges.length; i++) {
    const n = counts.get(edges[i]) || 0
    if (n && cum + n >= target) {
      const next = edges[i + 1]
      if (next === undefined) return { open: true, v: edges[i] }
      return { open: false, v: edges[i] + ((target - cum) / n) * (next - edges[i]) }
    }
    cum += n
  }
  return { open: true, v: edges[edges.length - 1] }
}

const fmt = (scale, r) => {
  if (!r) return '—'
  const v = scale === 'cls' ? (r.v / 1000).toFixed(3) : String(Math.round(r.v))
  return r.open ? `≥${v}` : v
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL
  if (!url) { console.error('DATABASE_URL (or DIRECT_URL) required'); process.exit(1) }
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  let rows
  try {
    ;({ rows } = await client.query(
      `select family, dims, bucket, sum(n)::bigint as n from rum_daily
        where day >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - $1::int and ($2::text is null or edition = $2)
        group by 1, 2, 3`,
      [DAYS - 1, EDITION],
    ))
  } finally {
    await client.end()
  }
  console.log(`page-speed totals · last ${DAYS} day(s) (VN) · ${EDITION ?? 'both editions'} · groups under ${MIN} hidden\n`)

  // family → view → group → bucket → n
  const views = new Map()
  const put = (family, view, group, bucket, n) => {
    const f = views.get(family) ?? new Map(); views.set(family, f)
    const v = f.get(view) ?? new Map(); f.set(view, v)
    const g = v.get(group) ?? new Map(); v.set(group, g)
    g.set(bucket, (g.get(bucket) || 0) + n)
  }
  for (const r of rows) {
    const n = Math.max(0, Number(r.n))
    if (!n) continue
    const parts = r.dims.split('|')
    if (['ttfb', 'fcp', 'lcp', 'hyd', 'hydx', 'cls', 'inp', 'nav'].includes(r.family)) {
      put(r.family, 'by page', parts[0], r.bucket, n)
      put(r.family, 'by browser class', parts[1] ?? 'unknown', r.bucket, n)
    } else {
      put(r.family, '', r.dims, r.bucket, n)
    }
  }
  for (const family of Object.keys(LABEL)) {
    const f = views.get(family)
    if (!f) continue
    const scale = SCALE[family]
    console.log(`── ${family} — ${LABEL[family]}`)
    for (const [view, groups] of f) {
      if (view) console.log(`   ${view}`)
      const list = [...groups].map(([g, c]) => [g, c, [...c.values()].reduce((a, n) => a + n, 0)]).sort((a, b) => b[2] - a[2])
      for (const [g, c, total] of list) {
        if (total < MIN) { console.log(`     ${g.padEnd(34)} <${MIN}`); continue }
        console.log(`     ${g.padEnd(34)} n=${String(total).padStart(6)}  p50 ${fmt(scale, percentile(scale, c, 0.5)).padStart(7)}  p75 ${fmt(scale, percentile(scale, c, 0.75)).padStart(7)}  p90 ${fmt(scale, percentile(scale, c, 0.9)).padStart(7)}`)
      }
    }
    console.log('')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
