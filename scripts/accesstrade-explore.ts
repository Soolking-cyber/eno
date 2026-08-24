/**
 * READ-ONLY reconnaissance of our AccessTrade publisher account. Writes nothing, anywhere.
 *
 *   ACCESSTRADE_KEY=... npx tsx scripts/accesstrade-explore.ts
 *   ACCESSTRADE_KEY=... npx tsx scripts/accesstrade-explore.ts --campaign shopee --sample 5
 *
 * ⛔ THE KEY IS A SCRIPT SECRET, NOT AN APP SECRET, AND IT MUST STAY THAT WAY. Importing products
 * is a periodic batch job that writes Listing rows — the running site never calls AccessTrade, so
 * the key belongs in a local .env (already gitignored) and NOT in eno-vn.env / eno-forum.env on the
 * box. Every value added to those is baked into a container image and widens what a compromised
 * container can reach. ⚠️ AND THIS REPO IS PUBLIC — never inline the key, never log it.
 *
 * What this answers, in order:
 *   1. which campaigns are we actually APPROVED for (approval=successful)
 *   2. what does each one PAY (commission_policies → sales_ratio / sales_price)
 *   3. does it have a usable product feed (datafeeds → count + a sample row)
 *
 * Only after that is it possible to say which campaigns are worth importing, rather than guessing
 * from brand recognition.
 */
import 'dotenv/config'

const KEY = process.env.ACCESSTRADE_KEY
if (!KEY) {
  console.error('ACCESSTRADE_KEY is not set. Put it in .env (gitignored) — never on the command line,')
  console.error('where it lands in your shell history, and never in the box env files.')
  process.exit(1)
}

const API = 'https://api.accesstrade.vn/v1'
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const SAMPLE = Number(arg('sample') ?? 3)
const ONLY = arg('campaign')

/** ⚠️ `Token <key>` — Token, a SPACE, then the key. Not Bearer, not the bare key. */
async function at<T = unknown>(path: string, params: Record<string, string | number> = {}): Promise<T | null> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  const url = `${API}/${path}${qs ? `?${qs}` : ''}`
  try {
    const res = await fetch(url, { headers: { Authorization: `Token ${KEY}` }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) {
      // The body carries the real reason (bad key, campaign not approved, rate limit); the status alone does not.
      console.log(`    HTTP ${res.status} on ${path} — ${(await res.text()).slice(0, 140)}`)
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    console.log(`    ${path} failed: ${(e as Error).message.slice(0, 90)}`)
    return null
  }
}

type Campaign = { id: string; name: string; merchant: string; status: number; approval: string; category?: string; cookie_duration?: number; url?: string }

/** Commission as a single comparable number, plus how it is expressed. */
function readCommission(policy: Record<string, unknown> | null): string {
  if (!policy) return 'n/a'
  const d = (policy as { data?: { default?: { sales_ratio?: number; sales_price?: number }[] } }).data
  const def = d?.default?.[0]
  if (!def) return 'no default policy'
  if (def.sales_ratio) return `${def.sales_ratio}% of order value`
  if (def.sales_price) return `${Number(def.sales_price).toLocaleString('vi-VN')} đ fixed`
  return 'declared but empty'
}

async function main() {
  console.log('AccessTrade — approved campaigns, what they pay, and whether they have a feed\n')
  /**
   * ⛔ limit=50, NOT 100 — AND THIS IS NOT A STYLE CHOICE. Measured 2026-08-24: `campaigns` returns
   * HTTP 200 with `"data": []` for limit>=100. No error, no message, no `total` field to contradict
   * it. The first run of this script reported "approved campaigns: 0" and I nearly told the owner
   * their account had none. The datafeeds endpoint documents max=200; campaigns documents no cap at
   * all and silently truncates to nothing above ~50.
   * ⚠️ AND `campaigns` HAS NO `total` FIELD, unlike datafeeds — count the rows, never trust a total.
   */
  const camps = await at<{ data: Campaign[] }>('campaigns', { approval: 'successful', limit: 50 })
  if (!camps) { console.error('\nCould not list campaigns — check the key.'); process.exit(1) }

  const running = (camps.data || []).filter((c) => !ONLY || `${c.merchant} ${c.name}`.toLowerCase().includes(ONLY.toLowerCase()))
  console.log(`approved campaigns: ${(camps.data || []).length}${ONLY ? ` (showing ${running.length} matching "${ONLY}")` : ''}\n`)

  for (const c of running) {
    console.log(`── ${c.merchant || c.name}  [id ${c.id}]  status=${c.status === 1 ? 'running' : c.status} cat=${c.category || '-'} cookie=${c.cookie_duration ?? '-'}s`)
    const policy = await at<Record<string, unknown>>('commission_policies', { camp_id: c.id })
    console.log(`   pays: ${readCommission(policy)}`)
    // A campaign with no datafeed cannot be imported as listings, however well it pays.
    const feed = await at<{ total: number; data: Record<string, unknown>[] }>('datafeeds', { campaign: c.merchant || '', limit: SAMPLE })
    if (feed && Array.isArray(feed.data)) {
      console.log(`   feed: ${feed.total ?? '?'} products`)
      for (const p of feed.data.slice(0, SAMPLE)) {
        const price = Number(p.price || 0).toLocaleString('vi-VN')
        console.log(`     · ${String(p.name || '').slice(0, 58)} — ${price} đ  [${String(p.cate || '-').slice(0, 22)}]  aff_link=${p.aff_link ? 'yes' : 'NO'}  img=${p.image ? 'yes' : 'NO'}`)
      }
    } else {
      console.log('   feed: none (cannot be imported as listings)')
    }
    console.log()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
