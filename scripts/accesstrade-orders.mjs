// DID A PURCHASE THROUGH OUR AFFILIATE LINKS ACTUALLY GET COUNTED?
//
//   node --env-file=.env scripts/accesstrade-orders.mjs              # last 7 days
//   node --env-file=.env scripts/accesstrade-orders.mjs --days 60    # walked in 30-day windows (the API refuses 31+)
//   node --env-file=.env scripts/accesstrade-orders.mjs --merchant supersports_shopify
//
// ⛔ THIS EXISTS BECAUSE "THE LINKS ARE CORRECT" IS NOT "WE GET PAID", AND ONLY ONE OF THOSE CAN BE
// MEASURED FROM HERE. The importer mints per-product links and the click chain resolves (verified
// 2026-09-17), but a click is attributed by a cookie on the MERCHANT's domain and the conversion is
// reported by the MERCHANT's checkout — neither of which is visible from our side. The network's own
// order feed is the only place the two ends meet, so this reads that.
//
// ⚠️ THE ENDPOINTS, MEASURED (the documented report paths 404 on this key):
//   · /v1/order-list  — affiliate ORDERS. `since`/`until`, and the range MUST be under 31 days:
//     a wider window answers `{"message":"sales date range must be less than 31 days.","status":"fail"}`,
//     so this walks the period in 30-day chunks rather than silently reporting nothing.
//   · /v1/transactions — the ledger, including bonuses and adjustments (`is_brand_bonus`).
// ⚠️ AN EMPTY RESULT IS NOT A FAILURE AND MUST NOT READ LIKE ONE: on 2026-09-17, with the catalogue
// an hour old, the honest answer was zero orders and one brand bonus. It only becomes a finding once
// a purchase has definitely been made through a link.
import { setTimeout as sleep } from 'node:timers/promises'

const args = process.argv.slice(2)
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const DAYS = Number(arg('days') ?? 7)
const MERCHANT = arg('merchant')
const KEY = process.env.ACCESSTRADE_KEY
if (!KEY) { console.error('ACCESSTRADE_KEY missing — run with node --env-file=.env'); process.exit(1) }
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 365) { console.error('--days must be 1..365'); process.exit(1) }

const day = 86400000
const fmt = (d) => d.toISOString().slice(0, 10)
const api = async (path) => {
  const res = await fetch(`https://api.accesstrade.vn/v1/${path}`, {
    headers: { Authorization: `Token ${KEY}` }, signal: AbortSignal.timeout(45_000),
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { error: `HTTP ${res.status}: ${text.slice(0, 120)}` } }
}

const now = Date.now()
/**
 * ⚠️ 30-DAY WINDOWS, NOT 31 (a reviewer's catch). The endpoint wants a range "less than 31 days", and
 * the first cut stepped exactly 31 — so `--days 31` sent one window the API refuses, and `--days 60`
 * silently lost a month.
 */
// ⚠️ AND THE WINDOWS MUST NOT SHARE A DAY (a reviewer's catch): dates are sent as whole days, so
// [D, D+30] followed by [D+30, D+60] counted every order on the boundary day twice. Each window now
// spans 30 calendar days inclusive (start … start+29) and the next one begins the day after.
const WINDOW_DAYS = 30
const windows = []
for (let start = now - (DAYS - 1) * day; start <= now; start += WINDOW_DAYS * day) {
  windows.push([new Date(start), new Date(Math.min(start + (WINDOW_DAYS - 1) * day, now))])
}

/**
 * ⛔ A FAILED REQUEST IS NOT ZERO ORDERS, AND THE FIRST CUT PRINTED IT AS ONE (a reviewer's catch).
 * It logged a window's error and carried on, then — with every window failed — printed the reassuring
 * "no orders, expected until someone buys". This script exists to answer "was the purchase counted?",
 * so an unreadable window makes the whole answer INCOMPLETE, labelled as such, with a non-zero exit.
 * ⚠️ AND IT PAGES: one `limit=100` request per window counted only the first page, and a merchant
 * filter applied afterwards could report zero while matches sat on page two.
 */
const PAGE = 100
const MAX_PAGES = 50
let orders = []
let failedWindows = 0
for (const [since, until] of windows) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await api(`order-list?since=${fmt(since)}&until=${fmt(until)}&limit=${PAGE}&page=${page}`)
    if (r.error || r.status === 'fail' || !Array.isArray(r.data)) {
      console.error(`  ⚠️ ${fmt(since)}..${fmt(until)} page ${page}: ${r.error || r.message || 'no data array'}`)
      failedWindows++
      break
    }
    orders = orders.concat(r.data)
    if (r.data.length < PAGE) break
    if (page === MAX_PAGES) { console.error(`  ⚠️ ${fmt(since)}..${fmt(until)}: stopped at ${MAX_PAGES} pages`); failedWindows++ }
    await sleep(300)
  }
  await sleep(300)
}
if (MERCHANT) orders = orders.filter((o) => (o.merchant || o.campaign || '') === MERCHANT)

const incomplete = failedWindows > 0
console.log(`ORDERS — last ${DAYS} day(s)${MERCHANT ? ` · ${MERCHANT}` : ''}: ${orders.length}${incomplete ? `  ⛔ INCOMPLETE (${failedWindows} window(s) unreadable)` : ''}`)
for (const o of orders.slice(0, 40)) {
  const when = (o.confirmed_time || o.transaction_time || o.update_time || '').slice(0, 16)
  const value = Number(o.transaction_value ?? o.order_value ?? 0).toLocaleString('vi-VN')
  const comm = Number(o.commission ?? 0).toLocaleString('vi-VN')
  console.log(`  ${when}  ${String(o.merchant || o.campaign || '?').padEnd(22)} ${value.padStart(12)} đ  →  ${comm.padStart(9)} đ  ${o.is_confirmed ? 'confirmed' : 'pending'}`)
}
if (!orders.length && !incomplete) {
  console.log('  (no orders in this window — expected until someone buys through a link; a test')
  console.log("   purchase is the only way to prove the merchant's checkout reports the conversion)")
}

const tx = await api('transactions?since=2025-01-01&until=' + fmt(new Date(now)) + '&limit=50')
if (tx.error || !Array.isArray(tx.data)) {
  console.error(`\nLEDGER — ⛔ unreadable: ${tx.error || tx.message || 'no data array'}`)
  process.exit(1)
}
console.log(`\nLEDGER — ${tx.data.length} transaction(s) on the account${tx.total > tx.data.length ? ` (first ${tx.data.length} of ${tx.total})` : ''}:`)
for (const t of tx.data.slice(0, 20)) {
  console.log(`  ${(t.transaction_time || '').slice(0, 16)}  ${String(t.merchant || t.product_category || '?').padEnd(22)}` +
    ` ${Number(t.commission ?? 0).toLocaleString('vi-VN').padStart(9)} đ  ${t.is_brand_bonus ? '(bonus)' : ''}`)
}
if (incomplete) process.exit(1)
