// Reads one seller's Marketplace pages with a real, logged-in browser. No stealth, no proxies, no captcha or checkpoint handling: a wall stops the run.
import { createHash } from 'node:crypto'

export class Walled extends Error { constructor(where) { super('walled'); this.where = where } }

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let onPage = () => {}
/** Counts every page opened, for the worker's daily limit. */
export const setPageCounter = (fn) => { onPage = fn }
export const sha = (buf) => createHash('sha256').update(buf).digest('hex')

export async function open(page, url, settleMs = 3500) {
  onPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await wait(settleMs)
  const path = new URL(page.url()).pathname
  if (/^\/(login|checkpoint|two_step|two_factor|recover)/.test(path)) throw new Walled(path.split('/')[1])
  // Logged out on an ordinary address looks like an empty search: every seller would read as not found.
  const cookies = await page.context?.().cookies('https://www.facebook.com')
  if (cookies && !cookies.some((c) => c.name === 'c_user')) throw new Walled('logged_out')
}

/** Every profile link on a people-search page, with its thumbnail. */
export async function searchPeople(page, name) {
  await open(page, `https://www.facebook.com/search/people/?q=${encodeURIComponent(name)}`, 5000)
  return page.evaluate(() => {
    const out = new Map()
    for (const a of document.querySelectorAll('[role=main] a[href]')) {
      const m = a.href.match(/facebook\.com\/(profile\.php\?id=\d+|[A-Za-z0-9.]+)\/?(?:[?&#]|$)/)
      // Whole words: photo.tran and gamingvn are people.
      if (!m || /^(search|groups|pages|events|marketplace|watch|photo|reel|help|privacy|policies|friends|gaming|stories)$/.test(m[1])) continue
      const img = a.querySelector('image, img')
      const thumb = img ? img.getAttribute('xlink:href') || img.getAttribute('href') || img.getAttribute('src') : null
      const prev = out.get(m[1])
      if (!prev || (!prev.thumb && thumb)) out.set(m[1], { path: m[1], thumb })
    }
    return [...out.values()]
  })
}

/** A profile's numeric id and the file of its own picture. */
export async function readProfile(page, path) {
  await open(page, `https://www.facebook.com/${path}`, 4000)
  const html = await page.content()
  const id = (html.match(/"userID":"(\d{5,25})"/) || html.match(/"profile_owner":\{"id":"(\d{5,25})"/) || [])[1] || null
  // ⛔ ONLY THE PROFILE'S OWN PICTURE: the first large one in the page's main part. Every page also shows the reader's own avatar in its banner, and other people's beside posts and comments: counted, a
  // stranger's page that shows the seller would match them, and a reader with the same photo would match everyone.
  const avatars = await page.evaluate(() => {
    const main = document.querySelector('[role=main]')
    if (!main) return []
    const large = [...main.querySelectorAll('image, img')].map((i) => ({ url: i.getAttribute('xlink:href') || i.getAttribute('href') || i.getAttribute('src') || '', width: i.getBoundingClientRect().width })).filter((a) => a.url.includes('t39.30808-1') && a.width >= 60)
    return large.slice(0, 1).map((a) => a.url)
  })
  return { id, avatars }
}

/**
 * Every item id on a seller's Marketplace page.
 * ⛔ ONLY INSIDE THE [role=dialog]. The page behind the seller's panel is the ordinary Marketplace feed: counted together, 30 "items" of a seller turned out to be
 * other people's (measured 2026-11-04: 3 of 3 from another seller; in the panel, 11 of 11 his own). readItem's seller id is the second line.
 * ⚠️ THE PANEL VIRTUALISES ITS LIST (measured counts 12, 20, 28, 32, 28, 28): rows leave as you scroll, so ids accumulate.
 */
export async function listSellerItems(page, sellerId, { max = 200, patience = 3 } = {}) {
  await open(page, `https://www.facebook.com/marketplace/profile/${sellerId}/`, 4500)
  // ⛔ EVERY DIALOG, NOT "THE" PANEL (measured 2026-11-06, the box's reader on the owner's profile with one listing: a 295-character Marketplace notice
  // with no item links came first and the panel second, so reading the first dialog gave 0). Guessing which dialog is the panel (the last with links, the
  // most links, pinned once) failed a new order or a slow load every review round (commit gate, codex + opus), so no guess: item links from every dialog,
  // every dialog scrolled, never the feed behind them (strangers'). Ownership is settled where it can be: each item page must name this seller before it
  // leaves the box (worker.mjs, "THE SECOND LINE"), so a link from another dialog costs one page read, never a stranger's listing in someone's import.
  // Any dialog at all is a panel, so a seller with nothing for sale is not a soft block.
  const step = (scroll) => page.evaluate((scroll) => {
    const dialogs = [...document.querySelectorAll('[role=dialog]')]
    if (!dialogs.length) return null
    if (scroll) {
      for (const d of dialogs) {
        const t = [d, ...d.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 10).sort((x, y) => y.scrollHeight - x.scrollHeight)[0]
        if (t) t.scrollTop = t.scrollHeight
      }
    }
    return [...new Set(dialogs.flatMap((d) => [...d.querySelectorAll('a[href*="/marketplace/item/"]')].map((a) => (a.href.match(/item\/(\d+)/) || [])[1]).filter(Boolean)))]
  }, scroll)
  const first = await step(false)
  if (first === null) return { ids: [], panel: false }
  const seen = new Set(first)
  let still = 0
  while (seen.size < max && still < patience) {
    const before = seen.size
    // What a scroll shows is kept too: a virtualised list can replace those cards again before the next look (commit gate, codex).
    for (const id of (await step(true)) || []) seen.add(id)
    await wait(2200)
    for (const id of (await step(false)) || []) seen.add(id)
    still = seen.size > before ? 0 : still + 1
  }
  return { ids: [...seen].slice(0, max), panel: true }
}

/**
 * Finds the person's own profile from what Facebook Login told us: name search, then the BYTES of any avatar against Login's copies of their picture at every size. A same-named stranger matched none (measured 2026-11-05).
 * ⛔ NO FACE MATCHING: it compares the picture file, so strangers in the results are never analysed as people, and nothing about them is kept.
 * ⛔ A MATCH IS NOT PROOF: a copy of a profile photo set on another account has the same bytes at every size (measured 2026-11-05). So it names the seller's profile, never proves it, and every result is checked:
 * two profiles with this name and picture mean a copycat, and which is real can't be told from here, so nothing is imported. A copycat that hides from this search isn't caught.
 */
export async function findSeller(page, { name, pictureShas }, fetchBytes, { maxCandidates = 12 } = {}) {
  const wanted = new Set(pictureShas)
  const people = await searchPeople(page, name)
  const report = { results: people.length, opened: 0, avatarsCompared: 0, matches: 0 }
  const matched = new Set()
  for (const person of people.slice(0, maxCandidates)) {
    report.opened++
    const { id, avatars } = await readProfile(page, person.path)
    for (const url of avatars.slice(0, 10)) {
      report.avatarsCompared++
      const bytes = await fetchBytes(url).catch(() => null)
      // A match whose id couldn't be read still counts as a second profile: it must not let a copycat through.
      if (bytes && wanted.has(sha(bytes))) { matched.add(id ?? `unread:${person.path}`); break }
    }
  }
  report.matches = matched.size
  const only = matched.size === 1 ? [...matched][0] : null
  return { sellerId: only && !only.startsWith('unread:') ? only : null, ...report }
}

/** Walks the server-rendered JSON on an item page for the object describing THIS item (the page also carries similar items). */
export function parseItem(html, itemId) {
  const blobs = [...html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((t) => t.includes(itemId) && /marketplace_listing_title|redacted_description|listing_photos/.test(t))
  const found = {}
  const visit = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 60) return
    if (Array.isArray(o)) { for (const x of o) visit(x, depth + 1); return }
    const mine = o.id === itemId || o.listing_id === itemId
    if (typeof o.marketplace_listing_title === 'string' && mine) found.title = o.marketplace_listing_title
    if (mine && o.listing_price && typeof o.listing_price === 'object') found.price = { amount: o.listing_price.amount ?? null, currency: o.listing_price.currency ?? null, formatted: o.listing_price.formatted_amount ?? null }
    if (mine && typeof o.is_sold === 'boolean') found.isSold = o.is_sold
    if (mine && typeof o.is_pending === 'boolean') found.isPending = o.is_pending
    if (mine && typeof o.is_live === 'boolean') found.isLive = o.is_live
    if (mine && typeof o.is_hidden === 'boolean') found.isHidden = o.is_hidden
    if (mine && o.marketplace_listing_seller?.id) found.sellerId = String(o.marketplace_listing_seller.id)
    if (mine && o.redacted_description?.text != null) found.description = o.redacted_description.text
    if (mine && o.location_text?.text) found.location = o.location_text.text
    if (mine && Array.isArray(o.listing_photos)) found.photos = o.listing_photos.map((p) => p?.image?.uri).filter(Boolean)
    if (mine && Array.isArray(o.attribute_data)) found.attributes = o.attribute_data.map((a) => ({ name: a?.attribute_name ?? null, value: a?.value ?? null, label: a?.label ?? null }))
    if (mine && o.condition) found.condition = o.condition
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') visit(v, depth + 1) }
  }
  for (const b of blobs) { try { visit(JSON.parse(b)) } catch { /* not this blob */ } }
  return found
}

export async function readItem(page, itemId) {
  await open(page, `https://www.facebook.com/marketplace/item/${itemId}/`, 2500)
  return parseItem(await page.content(), itemId)
}
