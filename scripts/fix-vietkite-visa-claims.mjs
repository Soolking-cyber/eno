#!/usr/bin/env node
/**
 * B4 (docs/ios-appstore-release.md §5): REMOVE THE GOVERNMENT-STATUS AND FALSE-SPEED CLAIMS FROM VietKite's
 * LISTINGS. DRY RUN BY DEFAULT, and the dry run opens a READ-ONLY session.
 *
 *   node --env-file=.env scripts/fix-vietkite-visa-claims.mjs                        # DRY RUN: the plan + its fingerprint
 *   node --env-file=.env scripts/fix-vietkite-visa-claims.mjs --apply --plan=<fp>    # write exactly the plan you reviewed
 *   node --env-file=.env scripts/fix-vietkite-visa-claims.mjs --revert <journal>     # revert DRY RUN
 *   node --env-file=.env scripts/fix-vietkite-visa-claims.mjs --revert <journal> --apply
 *
 * Needs DIRECT_URL (or DATABASE_URL), with the DB tunnel up. CF_TOKEN is optional (see PURGE).
 *
 * WHY. App Review and Play's misleading-claims policy (Play rejected the app over e-Visa copy on 2026-09-10)
 * read two claims on these rows: "official assistance" / "chính thức" (VietKite is a travel company, not a
 * government agency), and "VISA 24 GIỜ", the tagline at the end of every row's description, on rows whose own
 * speed tier is slower than one working day (the Standard product among them).
 *
 * ── WHOSE ROWS ───────────────────────────────────────────────────────────────────────────────────────────
 * ⛔ NOT VISA_SHOP_OWNER_EMAIL(S) (src/lib/visa-shop.ts). That variable names the visa DESK account of one
 * deployment (support@eno.forum unless repointed, src/lib/desk-operator.ts), so what it resolves to depends on
 * which env file is loaded; src/lib/edition-scope.ts records what pointing it at VietKite would do to the
 * marketplace. VietKite is its own storefront, and all four facts below must point at the SAME Seller row or
 * the script refuses:
 *   · id     b6b7b817-6af9-4d37-a762-cf54f6ec74e6  (scripts/demand-engine.ts DESK_SELLER_IDS, measured 2026-09-21)
 *   · handle vietkite                              (scripts/register-vietkite-seller.mjs → eno.vn/vietkite)
 *   · owner  info@vietkite.com.vn                  (same script; purge-pre-launch-data.mjs keeps that account)
 *   · Seller.officialPartner = true                (only an official partner may carry e-Visa chips, O-34)
 * If the id ever differs (a restored database), --seller-id=<id> confirms the one that handle + owner resolve to.
 * Rows read: every listing of that seller except tombstones (status 'removed') and takedowns
 * (complianceStatus 'taken_down'): a takedown's text is the record of what was published, so it is not edited.
 *
 * ── WHAT IS READ, WHAT MAY BE WRITTEN ────────────────────────────────────────────────────────────────────
 * Every text column of "Listing" is scanned, read from information_schema so a column added outside Prisma is
 * covered too. searchText is skipped because it is derived. Only the prose columns in REWRITE_COLUMNS are ever
 * rewritten. A match in any other column (attributes holds the chip codes that checkout parses; images, video,
 * verificationNotes…) is REPORTED and left alone.
 *
 * ── THE RULES (each edit is printed with the name below) ─────────────────────────────────────────────────
 * official-assistance  "official assistance|support|help" → "application assistance|support|help";
 *                      "hỗ trợ chính thức" → "hỗ trợ làm hồ sơ". The service is real; the word "official" is not.
 * official             every other "official" / "officially" / "chính thức" is removed (with its space, a
 *                      separator it leaves hanging, "an"→"a", a capital moved onto the next word) EXCEPT where it
 *                      names the GOVERNMENT's own channel. The exception applies only when the word qualifies a
 *                      website/portal/page/source/channel/link and the same line names the government (a .gov.vn
 *                      address, the Immigration Department, the Ministry of Public Security, Cục Quản lý xuất nhập
 *                      cảnh…). That is the app's own disclosure wording ("the official, functional source
 *                      https://evisa.gov.vn", scripts/play-api.mjs) and claims nothing for VietKite.
 * speed-24h            "24 GIỜ" · "24 giờ" · "24 tiếng" · "24h" · "24 hours" · "24-hour" (with a leading "within",
 *                      "in", "trong vòng"…, a range like "12-24h" or "24-72h", and a "VISA" that LEADS the tagline segment, as in
 *                      "VietKite Travel & Visa – VISA 24 GIỜ") is removed on an e-Visa product that is NOT express.
 *     ⛔ THE EXPRESS RULE, decided from the row's own data. A row is an e-Visa product when it sits in the visa slot
 *     (services/visa-legal) and carries a visa chip (src/lib/evisa-listing.ts isEVisaProductListing). It is
 *     EXPRESS when its `attributes.visaSpeed` chip (parseVisaSpeedCode, src/lib/visa/speed.ts) is a tier whose
 *     VISA_SPEED_SPECS turnaround is counted in hours or is one working day: 1H, 2H, 4H and 1D. 2D, 3D and
 *     `normal` (Standard) are not express. The chip is what checkout and the ETA read, so it is the row's own
 *     statement of its speed. A title naming a DIFFERENT tier ("… - Standard" on a 1D chip, "Express" on a 3D
 *     chip) makes the row a CONFLICT, and a visa-slot row without a readable chip cannot be decided either: in
 *     both cases its speed claims are reported and left for a human. A 24-hour mention beside a support word
 *     (support, hotline, hỗ trợ, tư vấn, "/7"…) describes availability, not processing, and is kept (reported).
 *     ⛔ NOTHING IS WRITTEN IN THE CLAIM'S PLACE. A non-express row states its real processing time only where it
 *     already does (e.g. "Standard" or "3 Business Days" in its title), and the dry run prints what it still
 *     states. Putting "5 working days" where "VISA 24 GIỜ" stood would mint a new "visa in N days" outcome
 *     promise, the shape Play rejected (src/lib/visa/speed.ts, the turnaround copy note).
 * REVIEW (report only, never rewritten): licence/authorisation words ("licensed", "giấy phép"… → B3: none until
 * VietKite's licence and agreement are on file), outcome guarantees ("guaranteed", "100%", "đảm bảo"…), and
 * express/urgent wording on a non-express row. The storefront bio is checked the same way and is not touched.
 * NEEDS A HUMAN (that row is not written): the rewrite would leave a claim behind, a dangling word, an empty
 * column, or a title under 3 characters (the publish gate's minimum).
 *
 * ── WHAT --apply WRITES: EXACTLY THE PRINTED PLAN, IN ONE TRANSACTION ─────────────────────────────────────
 * · The rewritten columns, plus searchText rebuilt from the new text with the recipe of
 *   scripts/rebuild-search-text.ts (a search for "official" stops finding the rows), plus updatedAt = now() so
 *   the sitemap's lastmod asks for a recrawl. A sold row without soldAt keeps its updatedAt, because trust.ts
 *   dates that sale by it.
 * · THE PLAN FINGERPRINT. The dry run prints `--plan=<16 hex>`. --apply re-reads the rows under a row lock
 *   (FOR NO KEY UPDATE, which does not block a new conversation or report against the listing), recomputes the
 *   plan and refuses unless the fingerprint is the one you reviewed. Every UPDATE must hit exactly its row (it
 *   compares every column it changes) or the whole transaction rolls back.
 * · THE JOURNAL IS ON DISK FIRST: ~/eno-import-journals/vietkite-claims-<ISO time>.json (--journal-dir to
 *   change it), opened `wx` and fsynced before the first UPDATE, holding each row's id and every changed column's
 *   old and new text. `--revert <journal>` puts `old` back on each row that still holds exactly `new`. A later
 *   edit wins: that row is left alone and reported. The revert is a dry run without --apply.
 *
 * ── PURGE (what translate-titles-google.ts, hide-ad-banned.ts and apply-listing-enrichment.ts do after a
 *    listing write) ────────────────────────────────────────────────────────────────────────────────────────
 * · ISR tombstones in next_cache_tag (cache-handler.cjs): each changed listing page in both languages (the tags
 *   of pdpTombstoneTags, src/lib/job-listing.ts), plus the root tag `_N_T_/layout`, which every page carries
 *   (home and /c/* list cards), whenever a column shown on a card changed. Written INSIDE the transaction and
 *   again AFTER the commit, because a page rendered while the transaction was open would otherwise keep the old
 *   text for its whole ISR window (30 days for a listing). Stamped by the database clock. Effective only where
 *   the app reads tombstones (ENO_ISR_PG=1, see scripts/purge-isr-listings.mjs).
 * · Cloudflare: when a card column changed and CF_TOKEN is set, purge_everything on both zones (the two
 *   eno-deploy.sh purges). Without it the script says so; the edge Worker serves / and /c/* fresh for 300 s and
 *   then revalidates, so they follow within minutes anyway (infra/cloudflare/eno-html-edge-cache.js).
 * · Not done, printed as NEXT: Vertex documents (the AI concierge) keep the old text until
 *   scripts/vertex-backfill.mjs runs; a changed title's translations warm on demand, or ahead of time with
 *   scripts/warm-listing-titles.mjs --seller VietKite.
 * ⚠️ It is VietKite's own copy. Tell them: their next edit can put the words back, and so can a Partner-API sync
 * if they hold a listings:write key (the run warns when they do).
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
// Node ≥ 24 strips the types (package.json engines), so the app's own searchText recipe and speed tiers are
// imported, never re-implemented (the scripts/seed-visa-shop.mjs rule).
import { buildSearchText } from '../src/lib/fold.ts'
import { parseVisaSpeedCode, VISA_SPEED_SPECS } from '../src/lib/visa/speed.ts'
import { invokedDirectly } from '../src/lib/cli-entry.ts'

// ── CONSTANTS ──────────────────────────────────────────────────────────────────────────────────────────────

export const VIETKITE = { id: 'b6b7b817-6af9-4d37-a762-cf54f6ec74e6', handle: 'vietkite', email: 'info@vietkite.com.vn' }
export const JOURNAL_KIND = 'vietkite-claims'
const JOURNAL_VERSION = 1
/** The prose columns this script may rewrite. Everything else is report-only. */
export const REWRITE_COLUMNS = ['title', 'titleVi', 'description', 'descriptionVi', 'location', 'district', 'city', 'condition', 'model']
/** Shown on listing cards (home, /c/*): a change to one of these warrants the root ISR tombstone. */
const CARD_COLUMNS = new Set(['title', 'titleVi', 'location', 'district', 'city', 'condition', 'model'])
/** The columns searchText is folded from (scripts/rebuild-search-text.ts) that this script can change. */
const SEARCH_INPUTS = new Set(['title', 'titleVi', 'description', 'descriptionVi', 'district', 'location', 'model'])
/** src/lib/taxonomy.ts VISA_CATEGORY_SLUG / VISA_SUBCATEGORY_SLUG (taxonomy.ts is not loadable from plain node). */
const VISA_SLOT = { category: 'services', subcategory: 'visa-legal' }
/** The zones eno-deploy.sh and scripts/translate-titles-google.ts purge. */
const CF_ZONES = [['eno.vn', '55e558b62f68a44f8177d7d98cb5369e'], ['eno.forum', 'cc81e3ff1d792c0aa5384e8feab21efa']]
const ROOT_TAG = 'eno:isrtag:_N_T_/layout'
/** src/lib/job-listing.ts pdpTombstoneTags — restated, that module does not load under plain node. */
export const pdpTags = (id) => ['en', 'vi'].map((l) => `eno:isrtag:_N_T_/${l}/listings/${id}`)

// ── MATCHING ───────────────────────────────────────────────────────────────────────────────────────────────

const W = '\\p{L}\\p{M}\\p{N}'
/** Unicode word boundaries: JS `\b` is ASCII-only, so it sees a boundary inside "chính". */
const NB = `(?<![${W}])`
const NA = `(?![${W}])`
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every way one character can be stored: precomposed, decomposed, and half-composed (ư + ◌́). */
function spellings(ch) {
  const d = ch.normalize('NFD')
  const out = new Set([ch.normalize('NFC'), d])
  for (let k = 1; k < d.length; k++) out.add(d.slice(0, k).normalize('NFC') + d.slice(k))
  return [...out]
}

/**
 * A regex source for a Vietnamese phrase that matches it however it was typed. Text from a Vietnamese keyboard
 * may be NFC or NFD, and normalising the whole column to match it would rewrite every other letter in it too.
 */
export function viPhrase(phrase) {
  return [...phrase.normalize('NFC')].map((ch) => {
    if (/\s/u.test(ch)) return '\\s+'
    const s = spellings(ch)
    return s.length === 1 ? esc(s[0]) : `(?:${s.map(esc).join('|')})`
  }).join('')
}
const vi = (...phrases) => phrases.map(viPhrase).join('|')

const RE = {
  officialPhraseEn: new RegExp(`${NB}official\\s+(assistance|support|help)${NA}`, 'giu'),
  officialPhraseVi: new RegExp(`${NB}(?:${viPhrase('hỗ trợ chính thức')})${NA}`, 'giu'),
  // Not "officials" (immigration officials decide; that sentence is a disclosure) and not "non-official".
  officialEn: new RegExp(`(?<![${W}-])official(?:ly)?${NA}`, 'giu'),
  officialVi: new RegExp(`${NB}(?:${viPhrase('chính thức')})${NA}`, 'giu'),
  speed: new RegExp(
    `${NB}(?:(?:within|in|under|after|${vi('trong vòng', 'trong', 'sau', 'chỉ')})\\s+)?(?:\\d+\\s*[-–]\\s*)?24(?:\\s*[-–]\\s*\\d+)?\\s*-?\\s*` +
    `(?:hours?|hrs?|h|${vi('giờ', 'tiếng')})${NA}`, 'giu'),
}

/** The government's own channel: the word qualifies one of these nouns (EN after it, VI before it)… */
const CHANNEL_EN = /^\s+(?:[\p{L}\p{N}.'’-]+\s+){0,3}?(?:web\s?sites?|sites?|portals?|pages?|sources?|channels?|links?)(?![\p{L}])/iu
const CHANNEL_VI = /(?:^|[^\p{L}\p{M}])(?:trang|web(?:site)?|cổng|nguồn|kênh|link|liên\s+kết|địa\s+chỉ)(?:\s+[\p{L}\p{M}.]+){0,4}\s+$/iu
/** "not official", "không chính thức" (unofficial) deny the status rather than claim it. */
const NEGATION_EN = /(?<![\p{L}])(?:not|never|no)\s+$/iu
const NEGATION_VI = new RegExp(`${NB}(?:${vi('không', 'phi', 'chưa')})\\s+$`, 'iu')
/** …and the same line names the government. */
const GOV = /(?:[\w-]+\.)*gov\.vn|(?<![\p{L}])government(?![\p{L}])|immigration\s+department|ministry\s+of\s+public\s+security|chính\s+phủ|xuất\s+nhập\s+cảnh|bộ\s+công\s+an/iu
/** Support words: a 24-hour figure beside one describes availability, not processing speed. */
const AVAILABILITY = new RegExp(
  `${NB}(?:support|hotline|customer|consult\\w*|chat|online|help\\s*desk|a\\s+day|per\\s+day|every\\s+day|` +
  `${vi('hỗ trợ', 'tư vấn', 'trực', 'phục vụ', 'chăm sóc', 'mỗi ngày', 'liên hệ')})${NA}|\\/\\s*(?:7|24)(?![\\d])`, 'iu')

const REVIEW_RULES = [
  { rule: 'licence wording (B3)', re: new RegExp(`${NB}(?:licen[cs]ed|licen[cs]es?|authori[sz]ed|accredited|endorsed|certified|affiliated|approved\\s+by|${vi('cấp phép', 'giấy phép', 'ủy quyền', 'uỷ quyền')})${NA}`, 'giu') },
  { rule: 'outcome guarantee', re: new RegExp(`${NB}(?:guarantee[sd]?|100\\s?%|${vi('đảm bảo', 'bảo đảm', 'cam kết', 'bao đậu')})${NA}`, 'giu') },
  { rule: 'speed wording on a non-express row', onlyWhen: 'strip', re: new RegExp(`${NB}(?:express|urgent|rush|fast[-\\s]?track|same[-\\s]day|instant|${vi('hỏa tốc', 'hoả tốc', 'khẩn', 'gấp', 'lấy ngay', 'trong ngày')})${NA}`, 'giu') },
]

// ── TEXT SURGERY ───────────────────────────────────────────────────────────────────────────────────────────

const SEP_TAIL = /(?:[ \t]+[-–—/]|[ \t]*[|·•,;])[ \t]*$/u
const SEP_HEAD = /^[ \t]*(?:[-–—/][ \t]+|[|·•,;][ \t]*)/u
const BULLET = /^[ \t]*(?:[-–—*•·✓✔✅☑]\uFE0F?|\d+[.)])[ \t]*$/u
const EMPTYISH = /^[\s\p{P}\p{S}\p{M}]*$/u
const AND_HEAD = new RegExp(`^(?:and|or|${vi('và', 'hoặc')})${NA}`, 'iu')
const DANGLING_END = new RegExp(`${NB}(?:the|a|an|is|are|was|were|be|been|not|our|your|their|its|of|and|or|by|for|with|as|to|from|${vi('là', 'của', 'và', 'bởi', 'các', 'những', 'một', 'không')})$`, 'iu')

const upperFirst = (s) => {
  const cp = s.codePointAt(0)
  if (cp == null) return s
  const ch = String.fromCodePoint(cp)
  return ch.toUpperCase() + s.slice(ch.length)
}

/** The replacement in the case the original was written in: ALL CAPS, Title Case, Sentence case, lower. */
export function matchCase(src, repl) {
  const letters = src.replace(/[^\p{L}]/gu, '')
  if (letters && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return repl.toUpperCase()
  const words = src.trim().split(/\s+/u)
  if (words.length > 1 && words.every((w) => /^\p{Lu}/u.test(w))) return repl.split(/(\s+)/u).map(upperFirst).join('')
  return /^\p{Lu}/u.test(src) ? upperFirst(repl) : repl
}

/** [start, end) of the line holding [from, to), a CR before the newline left outside it. */
function lineBounds(text, from, to) {
  const ls = text.lastIndexOf('\n', from - 1) + 1
  let le = text.indexOf('\n', to)
  if (le < 0) le = text.length
  else if (le - 1 >= to && text[le - 1] === '\r') le--
  return [ls, le]
}

function excerpt(text, a, b, pad = 30) {
  const s = Math.max(0, a - pad)
  const e = Math.min(text.length, b + pad)
  return `${s > 0 ? '…' : ''}${text.slice(s, e).replace(/\r?\n/g, '⏎')}${e < text.length ? '…' : ''}`
}

/** Is [start, end) inside a URL-ish token? Rewriting one would break the link. */
function inLink(text, start, end) {
  let a = start
  let b = end
  while (a > 0 && !/\s/u.test(text[a - 1])) a--
  while (b < text.length && !/\s/u.test(text[b])) b++
  return /:\/\/|www\.|\.[a-z]{2,}\//iu.test(text.slice(a, b))
}

function dropLine(text, ls, le) {
  let a = ls
  let b = le
  if (text[b] === '\r') b++
  if (text[b] === '\n') b++
  else if (a > 0) {
    a--
    if (a > 0 && text[a - 1] === '\r') a--
  }
  return { text: text.slice(0, a) + text.slice(b), at: a, dangling: false }
}

/**
 * Remove [from, to) and tidy only what the removal touched: the spaces around it, a separator or a "Label:" it
 * leaves hanging, a doubled separator, ", and", "an" before a consonant, a capital the removed word carried. A
 * line left with nothing but a bullet or punctuation goes. `dangling` says the result ends on a function word.
 */
export function removeSpan(text, from, to) {
  const [ls, le] = lineBounds(text, from, to)
  const removed = text.slice(from, to)
  let before = text.slice(ls, from).replace(/[ \t]+$/u, '')
  let after = text.slice(to, le).replace(/^[ \t]+/u, '')
  const opensSentence = before === '' || BULLET.test(before) || /[.!?:]$/u.test(before)
  if (after === '') {
    // "Processing time: [24 hours]" — the label whose whole value went goes with it.
    const label = /(?:^|[ \t]+[-–—/][ \t]*|[ \t]*[|·•,;][ \t]*)[^:|·•,;\n]{1,40}:$/u.exec(before)
    if (label) before = before.slice(0, label.index)
  }
  if (after === '' || /^[.!?]/u.test(after)) before = before.replace(SEP_TAIL, '')
  if (before === '' || BULLET.test(before)) after = after.replace(SEP_HEAD, '')
  if (SEP_TAIL.test(before) && SEP_HEAD.test(after)) after = after.replace(SEP_HEAD, '')
  if (/,$/u.test(before) && AND_HEAD.test(after)) before = before.slice(0, -1)
  if (opensSentence && /^\p{Lu}/u.test(removed) && /^\p{Ll}/u.test(after)) after = upperFirst(after)
  const an = /(?:^|[^\p{L}])(an)$/iu.exec(before)
  if (an && /^[b-df-hj-np-tv-z]/iu.test(after)) before = `${before.slice(0, -2)}${an[1][0] === 'A' ? 'A' : 'a'}`
  const joiner = before === '' || after === '' || /^[,.;:!?)\]}%]/u.test(after) || /[([{]$/u.test(before) ? '' : ' '
  const line = before + joiner + after
  if (EMPTYISH.test(line) || BULLET.test(line)) return dropLine(text, ls, le)
  const dangling = (after === '' || /^[,.;:!?)]/u.test(after)) && DANGLING_END.test(before)
  return { text: text.slice(0, ls) + line + text.slice(le), at: ls + before.length + joiner.length, dangling }
}

// ── THE DECISIONS ──────────────────────────────────────────────────────────────────────────────────────────

/** The visa slot and the chips (src/lib/evisa-listing.ts isEVisaProductListing, restated for plain node). */
export function evisaChip(row) {
  if (row.categorySlug !== VISA_SLOT.category || row.subcategorySlug !== VISA_SLOT.subcategory) return { slot: false, product: false, speed: null, raw: null, entry: null }
  let a = null
  try { a = JSON.parse(row.attributes ?? 'null') } catch { a = null }
  const ok = a && typeof a === 'object' && !Array.isArray(a)
  const set = (v) => typeof v === 'string' && v.trim() !== ''
  const product = !!ok && (set(a.visaEntryType) || set(a.visaSpeed))
  return { slot: true, product, speed: product ? parseVisaSpeedCode(a.visaSpeed) : null, raw: ok ? a.visaSpeed ?? null : null, entry: ok ? a.visaEntryType ?? null : null }
}

/** EXPRESS: the tier's own turnaround (VISA_SPEED_SPECS) is counted in hours, or is one working day. */
export function isExpressTier(code) {
  const s = VISA_SPEED_SPECS[code]
  return !!s && (s.turnaroundBusinessHours != null || (s.turnaroundBusinessDays ?? Infinity) <= 1)
}

const dayTier = (n) => (n <= 1 ? '1D' : n === 2 ? '2D' : n === 3 ? '3D' : 'normal')
const TIER_RES = [
  [/(?<![\p{L}\p{N}])(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:business|working)\s*days?(?![\p{L}])/giu, (m) => dayTier(Number(m[2] ?? m[1]))],
  [/(?<![\p{L}\p{N}])(\d+)(?:\s*[-–]\s*(\d+))?\s*ngày\s*làm\s*việc/giu, (m) => dayTier(Number(m[2] ?? m[1]))],
  [/(?<![\p{L}\p{N}])([124])\s*(?:hours?|hrs?|h|giờ|tiếng)(?![\p{L}\p{M}])/giu, (m) => `${m[1]}H`],
  [/(?<![\p{L}])(?:standard|normal)(?![\p{L}])|tiêu\s*chuẩn|thông\s*thường/giu, () => 'normal'],
  [/(?<![\p{L}])(?:express|urgent)(?![\p{L}])|hỏa\s*tốc|hoả\s*tốc|khẩn/giu, () => 'EXPRESS'],
]

/** The speed tiers a text names, with the words that named them. "24h" names none (it is the claim). */
export function speedTiers(text) {
  const t = (text ?? '').normalize('NFC')
  const out = []
  for (const [re, tier] of TIER_RES) for (const m of t.matchAll(re)) out.push({ tier: tier(m), phrase: m[0] })
  return out
}

/**
 * What the speed rule does on this row: 'strip' (a non-express e-Visa product), 'express', 'conflict' (the
 * title names another tier), 'no-chip' (visa slot, no readable chip) or 'not-evisa'.
 */
export function speedModeFor(row) {
  const chip = evisaChip(row)
  if (!chip.slot) return { mode: 'not-evisa', chip, said: [] }
  if (!chip.product || !chip.speed) return { mode: 'no-chip', chip, said: [] }
  const said = [...speedTiers(row.title), ...speedTiers(row.titleVi)]
  const conflict = said.some((s) => (s.tier === 'EXPRESS' ? !isExpressTier(chip.speed) : s.tier !== chip.speed))
  return { mode: conflict ? 'conflict' : isExpressTier(chip.speed) ? 'express' : 'strip', chip, said }
}

const KEEP_SPEED = {
  express: 'the row is an express tier',
  conflict: 'the title and the chip disagree on the tier',
  'no-chip': 'no readable visaSpeed chip',
  'not-evisa': 'not an e-Visa product',
}

/**
 * Rewrite one column's text under the rules. Returns the new text, each edit (rule + before/after excerpts),
 * notes (kept matches, REVIEW wording) and whether a removal left a dangling word.
 */
export function rewriteText(text, { speed }) {
  const form = text !== text.normalize('NFC') && text === text.normalize('NFD') ? 'NFD' : 'NFC'
  const edits = []
  const notes = []
  let t = text
  let dangling = false

  const step = (rule, re, decide) => {
    let cursor = 0
    for (let guard = 0; ; guard++) {
      if (guard > 2000) throw new Error(`${rule}: the rewrite did not converge`)
      re.lastIndex = cursor
      const m = re.exec(t)
      if (!m) return
      const start = m.index
      const end = start + m[0].length
      const d = inLink(t, start, end) ? { keep: 'inside a link' } : decide(m, start, end)
      if (d.keep) {
        notes.push({ kind: 'kept', rule, why: d.keep, at: excerpt(t, start, end) })
        cursor = end
        continue
      }
      const from = d.from ?? start
      const old = excerpt(t, from, end)
      let out
      if (d.replace !== undefined) {
        const r = d.replace.normalize(form)
        out = { text: t.slice(0, from) + r + t.slice(end), at: from + r.length, shown: [from, from + r.length] }
      } else {
        out = removeSpan(t, from, end)
        out.shown = [out.at, out.at]
      }
      dangling ||= !!out.dangling
      edits.push({ rule, old, new: excerpt(out.text, out.shown[0], out.shown[1]) })
      t = out.text
      cursor = out.at
    }
  }

  step('official-assistance', RE.officialPhraseEn, (m) => ({ replace: matchCase(m[0], `application ${m[1].toLowerCase()}`) }))
  step('official-assistance', RE.officialPhraseVi, (m) => ({ replace: matchCase(m[0], 'hỗ trợ làm hồ sơ') }))
  step('official', RE.officialEn, (m, start, end) => {
    const [ls, le] = lineBounds(t, start, end)
    if (NEGATION_EN.test(t.slice(ls, start))) return { keep: 'a negation ("not official")' }
    const gov = CHANNEL_EN.test(t.slice(end, le).normalize('NFC')) && GOV.test(t.slice(ls, le).normalize('NFC'))
    return gov ? { keep: "names the government's own channel" } : {}
  })
  step('official', RE.officialVi, (m, start, end) => {
    const [ls, le] = lineBounds(t, start, end)
    if (NEGATION_VI.test(t.slice(ls, start))) return { keep: 'a negation ("không chính thức")' }
    const gov = CHANNEL_VI.test(t.slice(ls, start).normalize('NFC')) && GOV.test(t.slice(ls, le).normalize('NFC'))
    return gov ? { keep: "names the government's own channel" } : {}
  })
  step('speed-24h', RE.speed, (m, start, end) => {
    if (speed !== 'strip') return { keep: KEEP_SPEED[speed] ?? speed }
    const [ls, le] = lineBounds(t, start, end)
    if (AVAILABILITY.test(t.slice(Math.max(ls, start - 40), Math.min(le, end + 40)).normalize('NFC'))) return { keep: 'availability, not processing speed' }
    // "… – VISA [24 GIỜ]": a VISA word that LEADS its segment is part of the tagline and goes with it.
    const lead = /(?:^[ \t]*(?:[-–—*•·✓✔✅☑]\uFE0F?[ \t]+)?|[|·•—–/:][ \t]*|\s-[ \t]*)((?:e-?)?visa\s+)$/iu.exec(t.slice(ls, start))
    const tail = t.slice(end, le)
    if (lead && (/^\s*$/u.test(tail) || SEP_HEAD.test(tail) || /^\s*[.!]/u.test(tail))) return { from: start - lead[1].length }
    return {}
  })

  if (edits.length) {
    if (!/(?:\r?\n){3,}/u.test(text)) t = t.replace(/((?:\r?\n){2})(?:\r?\n)+/gu, '$1')
    if (!/^\s/u.test(text)) t = t.replace(/^\s+/u, '')
    if (!/\s$/u.test(text)) t = t.replace(/\s+$/u, '')
  }
  for (const r of REVIEW_RULES) {
    if (r.onlyWhen && r.onlyWhen !== speed) continue
    for (const m of t.matchAll(r.re)) notes.push({ kind: 'review', rule: r.rule, at: excerpt(t, m.index, m.index + m[0].length) })
  }
  return { text: t, edits, notes, dangling }
}

/**
 * The plan for one row. `row` carries the listing's columns plus categorySlug / categoryName / categoryNameVi;
 * `cols` is every text column to scan.
 */
export function planRow(row, cols) {
  const speed = speedModeFor(row)
  const changes = {}
  const notes = []
  const human = []
  const next = { ...row }
  for (const col of cols) {
    const v = row[col]
    if (typeof v !== 'string' || v === '' || col === 'searchText') continue
    const r = rewriteText(v, { speed: speed.mode })
    if (!REWRITE_COLUMNS.includes(col)) {
      if (r.edits.length) notes.push({ col, kind: 'report-only', rule: [...new Set(r.edits.map((e) => e.rule))].join(', '), at: r.edits[0].old })
      continue
    }
    for (const n of r.notes) notes.push({ col, ...n })
    if (!r.edits.length) continue
    const problems = []
    if (rewriteText(r.text, { speed: speed.mode }).edits.length) problems.push('a claim survives the rewrite')
    if (r.dangling) problems.push('the rewrite leaves a dangling word')
    if (r.text.trim() === '') problems.push('the column would be empty')
    else if (col === 'title' && r.text.trim().length < 3) problems.push('the title would be under 3 characters')
    if (problems.length) human.push(`${col}: ${problems.join('; ')}`)
    changes[col] = { old: v, new: r.text, edits: r.edits }
    next[col] = r.text
  }
  if (Object.keys(changes).some((c) => SEARCH_INPUTS.has(c))) {
    const s = buildSearchText([next.title, next.titleVi, next.description, next.descriptionVi, next.district, next.location,
      row.categoryName, row.categoryNameVi, row.brandSlug, next.model])
    if (s !== row.searchText) changes.searchText = { old: row.searchText ?? null, new: s, edits: [] }
  }
  const stripped = Object.values(changes).some((c) => c.edits.some((e) => e.rule === 'speed-24h'))
  let stillStates = null
  if (stripped) {
    for (const col of ['title', 'titleVi', 'description', 'descriptionVi']) {
      const hit = speedTiers(next[col]).find((s) => s.tier !== 'EXPRESS')
      if (hit) { stillStates = { col, phrase: hit.phrase }; break }
    }
  }
  return {
    id: row.id, status: row.status, speed, changes, notes, human, stripped, stillStates,
    keepsUpdatedAt: row.status === 'sold' && row.soldAt == null,
    cardsChanged: Object.keys(changes).some((c) => CARD_COLUMNS.has(c)),
  }
}

export function planAll(rows, cols) {
  const plans = rows.map((r) => planRow(r, cols))
  const writes = plans.filter((p) => Object.keys(p.changes).length && !p.human.length)
  return { plans, writes, fingerprint: fingerprint(writes) }
}

/** 16 hex of sha256 over exactly what would be written (row ids, columns, old and new text). */
export function fingerprint(writes) {
  const canon = [...writes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => [p.id, Object.keys(p.changes).sort().map((c) => [c, p.changes[c].old, p.changes[c].new])])
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex').slice(0, 16)
}

/** The storefront the four identity facts resolve to, or why it cannot be trusted. */
export function checkSeller(rows, { sellerIdOverride } = {}) {
  const ids = [...new Set(rows.map((r) => r.id))]
  if (!ids.length) return { error: `no storefront has id ${VIETKITE.id}, handle "${VIETKITE.handle}" or owner ${VIETKITE.email}` }
  if (ids.length > 1) return { error: `the id, the handle and the owner point at DIFFERENT storefronts: ${JSON.stringify(rows)}` }
  const s = rows[0]
  const wrong = []
  if ((s.email ?? '').toLowerCase() !== VIETKITE.email) wrong.push(`owner is ${s.email ?? 'nobody'}, not ${VIETKITE.email}`)
  if (s.handle !== VIETKITE.handle) wrong.push(`handle is ${s.handle ?? 'none'}, not ${VIETKITE.handle}`)
  if (s.officialPartner !== true) wrong.push('it is not an official partner')
  if (s.id !== VIETKITE.id && s.id !== sellerIdOverride) wrong.push(`its id is ${s.id}, not ${VIETKITE.id} (re-run with --seller-id=${s.id} if that is right)`)
  return wrong.length ? { error: `refusing the storefront ${s.id} (${s.name}): ${wrong.join('; ')}` } : { seller: s }
}

// ── THE JOURNAL ────────────────────────────────────────────────────────────────────────────────────────────

export function journalFor(seller, writes, fp, createdAt) {
  return {
    kind: JOURNAL_KIND, version: JOURNAL_VERSION, createdAt, script: 'scripts/fix-vietkite-visa-claims.mjs',
    seller: { id: seller.id, name: seller.name, handle: seller.handle }, planFingerprint: fp,
    rows: writes.map((p) => ({ id: p.id, changes: Object.fromEntries(Object.entries(p.changes).map(([c, v]) => [c, { old: v.old, new: v.new }])) })),
  }
}

/** On disk and synced before anything is written; `wx` never overwrites an earlier journal. */
export function writeJournal(path, journal) {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'wx')
  try {
    writeSync(fd, `${JSON.stringify(journal, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** A journal this script wrote, or an error. Refused whole on anything else: a revert writes what it says. */
export function parseJournal(text) {
  let j
  try { j = JSON.parse(text) } catch { throw new Error('the journal is not JSON') }
  if (!j || j.kind !== JOURNAL_KIND || j.version !== JOURNAL_VERSION) throw new Error(`not a ${JOURNAL_KIND} v${JOURNAL_VERSION} journal`)
  if (typeof j.seller?.id !== 'string' || !j.seller.id) throw new Error('the journal names no seller')
  if (!Array.isArray(j.rows) || !j.rows.length) throw new Error('the journal holds no rows')
  const allowed = new Set([...REWRITE_COLUMNS, 'searchText'])
  const seen = new Set()
  for (const [k, r] of j.rows.entries()) {
    if (typeof r?.id !== 'string' || !r.id) throw new Error(`row ${k}: no id`)
    if (seen.has(r.id)) throw new Error(`row ${k}: duplicate id ${r.id}`)
    seen.add(r.id)
    const cols = Object.keys(r.changes ?? {})
    if (!cols.length) throw new Error(`row ${k}: no changes`)
    for (const c of cols) {
      if (!allowed.has(c)) throw new Error(`row ${k}: column ${c} is not one this script writes`)
      const v = r.changes[c]
      const ok = (x) => x === null || typeof x === 'string'
      if (!v || !ok(v.old) || typeof v.new !== 'string' || v.old === v.new) throw new Error(`row ${k}: ${c} is not an {old, new} pair`)
    }
  }
  return j
}

// ── THE DATABASE HALF ──────────────────────────────────────────────────────────────────────────────────────

const q = (col) => `"${col.replace(/"/g, '""')}"`

async function resolveSeller(c, sellerIdOverride) {
  const { rows } = await c.query(
    `SELECT s.id, s.name, s."officialPartner", s.bio, lower(p.email) AS email, h.handle
       FROM "Seller" s
       LEFT JOIN "Profile" p ON p.id = s."ownerId"
       LEFT JOIN "Handle" h ON h."sellerId" = s.id
      WHERE s.id = $1 OR lower(p.email) = $2 OR h.handle = $3`,
    [VIETKITE.id, VIETKITE.email, VIETKITE.handle],
  )
  const r = checkSeller(rows, { sellerIdOverride })
  if (r.error) throw new Error(r.error)
  return r.seller
}

async function textColumns(c) {
  const { rows } = await c.query(
    `SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Listing' AND data_type IN ('text', 'character varying')
      ORDER BY ordinal_position`,
  )
  const cols = rows.map((r) => r.name)
  const missing = REWRITE_COLUMNS.filter((x) => !cols.includes(x))
  if (missing.length) throw new Error(`"Listing" has no text column ${missing.join(', ')} here: the schema moved, read it before running this`)
  return cols.filter((x) => x !== 'searchText')
}

async function readRows(c, sellerId, lock) {
  const { rows } = await c.query(
    `SELECT l.*, cat.slug AS "__categorySlug", cat.name AS "__categoryName", cat."nameVi" AS "__categoryNameVi"
       FROM "Listing" l JOIN "Category" cat ON cat.id = l."categoryId"
      WHERE l."sellerId" = $1 AND l.status <> 'removed' AND l."complianceStatus" IS DISTINCT FROM 'taken_down'
      ORDER BY l.id${lock ? ' FOR NO KEY UPDATE OF l' : ''}`,
    [sellerId],
  )
  return rows.map(({ __categorySlug, __categoryName, __categoryNameVi, ...l }) => ({ ...l, categorySlug: __categorySlug, categoryName: __categoryName, categoryNameVi: __categoryNameVi }))
}

async function writeKey(c, sellerId) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM "ApiKey" WHERE "sellerId" = $1 AND "revokedAt" IS NULL AND scopes LIKE '%listings:write%'`, [sellerId])
  return rows[0].n
}

/**
 * One row, every column compared to what was read (and the seller, the tombstone and the takedown re-checked)
 * so it writes that row or nothing. `set` / `expect` map column → value.
 */
async function updateRow(c, id, sellerId, set, expect) {
  const cols = Object.keys(set)
  const values = [id, sellerId]
  const sets = cols.map((col) => { values.push(set[col]); return `${q(col)} = $${values.length}` })
  const cas = Object.keys(expect).map((col) => { values.push(expect[col]); return `${q(col)} IS NOT DISTINCT FROM $${values.length}` })
  const r = await c.query(
    `UPDATE "Listing" SET ${sets.join(', ')},
            "updatedAt" = CASE WHEN status = 'sold' AND "soldAt" IS NULL THEN "updatedAt" ELSE now() END
      WHERE id = $1 AND "sellerId" = $2 AND status <> 'removed' AND "complianceStatus" IS DISTINCT FROM 'taken_down'
        AND ${cas.join(' AND ')}`,
    values,
  )
  return r.rowCount
}

/** ISR tombstones, the importers' SQL (cache-handler.cjs reads them): DB clock, greatest() never moves one back. */
async function tombstone(c, tags) {
  if (!tags.length) return 'none needed'
  const { rows } = await c.query(`SELECT to_regclass('public.next_cache_tag')::text AS t`)
  if (!rows[0].t) return `SKIPPED: no next_cache_tag table in this database (${tags.length} tags not written)`
  await c.query(
    `INSERT INTO next_cache_tag (tag, stamp, expires_at)
     SELECT t, (extract(epoch from clock_timestamp()) * 1000)::bigint, now() + interval '40 days' FROM unnest($1::text[]) AS t
     ON CONFLICT (tag) DO UPDATE SET
       stamp = greatest(next_cache_tag.stamp, excluded.stamp),
       expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`,
    [tags],
  )
  return `${tags.length} tags written`
}

const tagsFor = (ids, cardsChanged) => [...ids.flatMap(pdpTags), ...(cardsChanged ? [ROOT_TAG] : [])]

async function purgeCloudflare(cardsChanged) {
  if (!cardsChanged) {
    console.log('Cloudflare: not needed. Only listing-page text changed, and /listings/* is not edge-cached.')
    return
  }
  const token = process.env.CF_TOKEN
  if (!token) {
    console.log('Cloudflare: NOT purged (no CF_TOKEN). / and /c/* show the old card text until the edge revalidates (300 s fresh window).')
    console.log('            To make it immediate: purge_everything on eno.vn and eno.forum.')
    return
  }
  for (const [name, zone] of CF_ZONES) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ purge_everything: true }), signal: AbortSignal.timeout(30_000),
      })
      const j = await res.json().catch(() => ({}))
      console.log(`Cloudflare ${name}: ${j.success ? 'purged' : `FAILED (HTTP ${res.status})`}`)
      if (!j.success) process.exitCode = 1
    } catch (e) {
      console.log(`Cloudflare ${name}: FAILED (${e instanceof Error ? e.message : e})`)
      process.exitCode = 1
    }
  }
}

// ── PRINTING ───────────────────────────────────────────────────────────────────────────────────────────────

const show = (s) => (s === null ? 'null' : JSON.stringify(s))

function describeSpeed(sp) {
  const tier = sp.chip.speed ? `${sp.chip.speed} (${VISA_SPEED_SPECS[sp.chip.speed].label})` : `visaSpeed=${show(sp.chip.raw)}`
  const entry = sp.chip.entry ? `${sp.chip.entry} · ` : ''
  switch (sp.mode) {
    case 'strip': return `e-Visa ${entry}${tier}: NOT express, a 24-hour claim is removed`
    case 'express': return `e-Visa ${entry}${tier}: express, a 24-hour claim is kept`
    case 'conflict': return `e-Visa ${entry}${tier}: CONFLICT, the title says ${sp.said.map((s) => show(s.phrase)).join(', ')}; speed claims are left for a human`
    case 'no-chip': return `visa slot, visaSpeed=${show(sp.chip.raw)} is not a tier: speed claims are left for a human`
    default: return 'not an e-Visa product: the speed rule does not apply'
  }
}

export function printPlan({ plans, writes, fingerprint: fp }) {
  for (const p of plans) {
    if (!Object.keys(p.changes).length && !p.notes.length) continue
    console.log(`\n━━ ${p.id}  [${p.status}]  ${describeSpeed(p.speed)}`)
    for (const [col, ch] of Object.entries(p.changes)) {
      console.log(`   ${col}${col === 'searchText' ? ' (derived: rebuilt from the new text)' : ''}`)
      for (const e of ch.edits) console.log(`     · ${e.rule.padEnd(19)} ${show(e.old)}\n       ${''.padEnd(19)} → ${show(e.new)}`)
      console.log(`     OLD ${show(ch.old)}`)
      console.log(`     NEW ${show(ch.new)}`)
    }
    if (Object.keys(p.changes).length) {
      console.log(`   updatedAt: ${p.keepsUpdatedAt ? 'kept (a sold row without soldAt: trust.ts dates the sale by it)' : 'now() (the sitemap lastmod asks for a recrawl)'}`)
    }
    if (p.stripped) {
      console.log(p.stillStates
        ? `   processing time the row still states: ${show(p.stillStates.phrase)} (${p.stillStates.col}); nothing is written in the claim's place`
        : '   processing time the row still states: NONE. Nothing is written in the claim\'s place (see the header).')
    }
    for (const n of p.notes) {
      const label = n.kind === 'kept' ? `kept (${n.why})` : n.kind === 'review' ? 'REVIEW, not rewritten' : 'REPORT ONLY, not a column this script rewrites'
      console.log(`   ${label} · ${n.col} · ${n.rule} ${show(n.at)}`)
    }
    if (p.human.length) console.log(`   ⛔ NEEDS A HUMAN, this row is NOT written: ${p.human.join(' | ')}`)
  }
  const blocked = plans.filter((p) => p.human.length).length
  const modes = {}
  for (const p of plans) modes[p.speed.mode] = (modes[p.speed.mode] ?? 0) + 1
  console.log(`\nspeed rule per row: ${Object.entries(modes).map(([m, n]) => `${m} ${n}`).join(' · ') || 'no rows'}`)
  console.log(`plan: ${writes.length} row(s) to write · ${blocked} need a human (not written) · ${plans.reduce((n, p) => n + p.notes.length, 0)} note(s)`)
  console.log(`plan fingerprint: ${fp}`)
}

// ── THE RUN ────────────────────────────────────────────────────────────────────────────────────────────────

const FLAGS = new Set(['--apply', '--plan', '--revert', '--journal-dir', '--seller-id', '--help'])
const WITH_VALUE = new Set(['--plan', '--revert', '--journal-dir', '--seller-id'])

/** `--flag=value` or `--flag value`. Unknown flags are refused, so a typo cannot quietly change the mode. */
export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const eq = a.indexOf('=')
    const name = eq > 0 ? a.slice(0, eq) : a
    if (!FLAGS.has(name)) throw new Error(`unknown argument ${a}`)
    if (WITH_VALUE.has(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`)
      out[name.slice(2)] = v
    } else {
      if (eq > 0) throw new Error(`${name} takes no value`)
      out[name.slice(2)] = true
    }
  }
  return out
}

export async function forward(c, args) {
  const apply = !!args.apply && !!args.plan
  if (apply) {
    await c.query('BEGIN')
    await c.query(`SET LOCAL lock_timeout = '10s'`)
    await c.query(`SET LOCAL statement_timeout = '120s'`)
  }
  try {
    const seller = await resolveSeller(c, args['seller-id'])
    const cols = await textColumns(c)
    const rows = await readRows(c, seller.id, apply)
    console.log(`${apply ? 'APPLY: WRITES TO THE DATABASE' : 'DRY RUN (read-only session): nothing is written'}`)
    console.log(`seller: ${seller.name} · id ${seller.id} · @${seller.handle} · owner ${seller.email} · official partner`)
    console.log(`rows: ${rows.length} listing(s) (not removed, not taken down) · ${rows.filter((r) => evisaChip(r).product).length} e-Visa product(s)`)
    console.log(`columns scanned: ${cols.join(', ')}`)
    const bio = seller.bio ? rewriteText(seller.bio, { speed: 'not-evisa' }) : null
    if (bio && (bio.edits.length || bio.notes.some((n) => n.kind === 'review'))) {
      console.log(`NOTE (B3, not touched here): the storefront bio reads ${show(seller.bio)}`)
    }
    const keys = await writeKey(c, seller.id)
    if (keys) console.log(`⚠️ ${keys} unrevoked listings:write API key(s): a Partner-API sync from VietKite can put the old text back.`)

    const plan = planAll(rows, cols)
    printPlan(plan)
    if (!plan.writes.length) {
      console.log('\nnothing to write.')
      if (apply) await c.query('ROLLBACK')
      return
    }
    if (!apply) {
      const how = args.apply ? '⛔ --apply needs the fingerprint of the plan you reviewed. To write exactly this plan:' : '\nDRY RUN: nothing written. To write exactly this plan:'
      console.log(`${how}\n  node --env-file=.env scripts/fix-vietkite-visa-claims.mjs --apply --plan=${plan.fingerprint}`)
      if (args.apply) process.exitCode = 1
      return
    }
    if (args.plan !== plan.fingerprint) {
      await c.query('ROLLBACK')
      console.error(`\n⛔ the plan is ${plan.fingerprint}, you reviewed ${args.plan}: the rows changed since. Nothing written. Re-run the dry run and review it again.`)
      process.exitCode = 1
      return
    }

    const createdAt = new Date().toISOString()
    const path = join(args['journal-dir'] ? resolve(args['journal-dir']) : join(homedir(), 'eno-import-journals'), `${JOURNAL_KIND}-${createdAt.replace(/[:.]/g, '-')}.json`)
    writeJournal(path, journalFor(seller, plan.writes, plan.fingerprint, createdAt))
    console.log(`\njournal: ${path} (${plan.writes.length} rows, on disk before the first UPDATE)`)
    console.log(`REVERT:  node --env-file=.env scripts/fix-vietkite-visa-claims.mjs --revert ${path} [--apply]`)

    for (const p of plan.writes) {
      const set = Object.fromEntries(Object.entries(p.changes).map(([col, v]) => [col, v.new]))
      const expect = Object.fromEntries(Object.entries(p.changes).map(([col, v]) => [col, v.old]))
      const n = await updateRow(c, p.id, seller.id, set, expect)
      if (n !== 1) throw new Error(`${p.id}: the UPDATE matched ${n} rows, not 1`)
    }
    const ids = plan.writes.map((p) => p.id)
    const cards = plan.writes.some((p) => p.cardsChanged)
    console.log(`ISR (in the transaction): ${await tombstone(c, tagsFor(ids, cards))}`)
    await c.query('COMMIT')
    console.log(`\nWROTE ${ids.length} row(s), committed.`)
    await afterCommit(c, ids, cards)
    console.log('NEXT: Vertex (AI concierge) documents keep the old text until scripts/vertex-backfill.mjs runs (optional).')
    if (cards) console.log('NEXT: changed titles translate on demand; to pre-warm: node --env-file=.env scripts/warm-listing-titles.mjs --seller VietKite')
    console.log('NEXT: tell VietKite. It is their copy, and their next edit can put the words back.')
  } catch (e) {
    if (apply) await c.query('ROLLBACK').catch(() => {})
    throw e
  }
}

async function afterCommit(c, ids, cards) {
  try {
    console.log(`ISR (after the commit): ${await tombstone(c, tagsFor(ids, cards))}`)
  } catch (e) {
    process.exitCode = 1
    console.error(`⛔ the post-commit ISR tombstone FAILED (${e instanceof Error ? e.message : e}). The rows ARE written.`)
    console.error('   Pages rendered during the transaction may keep the old text: node --env-file=.env scripts/purge-isr-listings.mjs')
  }
  await purgeCloudflare(cards)
}

export async function revert(c, args) {
  const apply = !!args.apply
  const journal = parseJournal(readFileSync(args.revert, 'utf8'))
  if (apply) {
    await c.query('BEGIN')
    await c.query(`SET LOCAL lock_timeout = '10s'`)
    await c.query(`SET LOCAL statement_timeout = '120s'`)
  }
  try {
    const seller = await resolveSeller(c, args['seller-id'] ?? journal.seller.id)
    if (seller.id !== journal.seller.id) throw new Error(`the journal is for storefront ${journal.seller.id}, VietKite resolves to ${seller.id}`)
    const { rows } = await c.query(
      `SELECT * FROM "Listing" WHERE id = ANY($1::text[]) AND "sellerId" = $2${apply ? ' FOR NO KEY UPDATE' : ''}`,
      [journal.rows.map((r) => r.id), seller.id],
    )
    const current = new Map(rows.map((r) => [r.id, r]))
    const restorable = []
    const moved = []
    for (const r of journal.rows) {
      const now = current.get(r.id)
      const same = now && Object.entries(r.changes).every(([col, v]) => now[col] === v.new)
      ;(same ? restorable : moved).push(r)
    }
    console.log(`${apply ? 'REVERT: WRITES TO THE DATABASE' : 'REVERT DRY RUN (read-only session)'} · ${args.revert}`)
    console.log(`journal of ${journal.createdAt}: ${journal.rows.length} row(s) · ${restorable.length} still hold exactly what it wrote → restorable · ${moved.length} changed since (or gone) → left alone`)
    for (const r of restorable) console.log(`  restore ${r.id}: ${Object.keys(r.changes).join(', ')}`)
    for (const r of moved) console.log(`  LEFT ALONE ${r.id}: ${current.has(r.id) ? 'edited since the fix' : 'no longer VietKite\'s listing, or gone'}`)
    if (!apply || !restorable.length) {
      if (apply) await c.query('ROLLBACK')
      console.log(apply ? '\nnothing to restore.' : '\nDRY RUN: nothing written. Add --apply to restore.')
      return
    }
    for (const r of restorable) {
      const set = Object.fromEntries(Object.entries(r.changes).map(([col, v]) => [col, v.old]))
      const expect = Object.fromEntries(Object.entries(r.changes).map(([col, v]) => [col, v.new]))
      const n = await updateRow(c, r.id, seller.id, set, expect)
      if (n !== 1) throw new Error(`${r.id}: the restore matched ${n} rows, not 1`)
    }
    const ids = restorable.map((r) => r.id)
    const cards = restorable.some((r) => Object.keys(r.changes).some((col) => CARD_COLUMNS.has(col)))
    console.log(`ISR (in the transaction): ${await tombstone(c, tagsFor(ids, cards))}`)
    await c.query('COMMIT')
    console.log(`\nRESTORED ${ids.length} row(s), committed.`)
    await afterCommit(c, ids, cards)
  } catch (e) {
    if (apply) await c.query('ROLLBACK').catch(() => {})
    throw e
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
    console.log(src.slice(1, src.findIndex((l) => l.trim() === '*/') + 1).join('\n'))
    return
  }
  if (args.plan && !args.apply) throw new Error('--plan is for --apply')
  if (args.plan && args.revert) throw new Error('--plan is not used with --revert: the journal is the plan')
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error('Set DIRECT_URL (or DATABASE_URL): node --env-file=.env …')
  // A session that may write only when it is going to: an --apply that carries the reviewed fingerprint, or an
  // applied revert. Everything else cannot write even by mistake.
  const writes = !!args.apply && (!!args.plan || !!args.revert)
  const c = new pg.Client({ connectionString: url, ...(writes ? {} : { options: '-c default_transaction_read_only=on' }) })
  await c.connect()
  try {
    if (args.revert) await revert(c, args)
    else await forward(c, args)
  } finally {
    await c.end()
  }
}

if (invokedDirectly(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
}
