/**
 * ── "THIS LISTING SAYS IT IS SECOND-HAND" ─────────────────────────────────────────────────────────────
 *
 * The one test of whether a shop's own words call an item used. Second-hand focus (owner, 2026-10-03:
 * "remove tiki and cellphones products from the app, we will have tight focus on second hand stores and
 * rentals plus job postings" → "yes correct all that are second hand we need the listings"): the shops
 * that sell new AND used stock (Bạch Long, Điện Thoại Giá Kho, CellphoneS' "cũ" shelf) keep exactly the
 * rows this returns true for. Callers: scripts/retire-new-retail.ts (which rows of a mixed shop are kept,
 * and the condition audit — both read by a human before anything is written), and scripts/import-partners.ts
 * (to COUNT, in its dry run, how many products a refresh-only shop offers that say used — never to create).
 *
 * ⛔ JAVASCRIPT IS THE ONE IMPLEMENTATION — THERE IS NO SQL TWIN TO DRIFT FROM IT. The 2026-10-03 hide
 * ran this list as a Postgres ARE (`\mcũ\M`). In JS `\m` is a literal "m" and `\b` is ASCII-only — "cũ "
 * has no `\b` after the ũ — so a "shared" regex source would have meant two different predicates behind
 * one name (review, 2026-10-03). The retire script therefore selects a mixed shop's candidate rows
 * STRUCTURALLY in SQL and decides "used or not" here, once.
 *
 * ⚠️ WORD EDGES ARE UNICODE LOOKAROUNDS, NOT `\b`: `(?<![\p{L}\p{N}])` / `(?![\p{L}\p{N}])` with the `u`
 * flag, so "Cũ 99%", "- Cũ" and "cũ-Silver" match while "Củ sạc" (a charger: ủ, not ũ) does not.
 * Input is NFC-normalised first — a decomposed "ũ" (u + U+0303) is two code points and would not match.
 */

const B = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'
/** "Pin 100 giờ", "battery 90 hours" — a battery LIFE on a new speaker or headphone, not a health figure. */
const NOT_A_DURATION = '(?!\\s*(?:giờ|tiếng|phút|ngày|h|hrs?|hours?|mins?|minutes?|mah)(?![\\p{L}]))'

/**
 * The used cues, measured on the live titles of the mixed shops (2026-10-03). Each one is a phrase a
 * Vietnamese shop writes on second-hand stock: "cũ" (used), "qua sử dụng" (previously used), "like new",
 * "2nd" / "second hand", "trưng bày" (an ex-display unit — not "kệ trưng bày", a display stand),
 * "refurb", "máy đẹp" (good-condition unit), CPO (certified pre-owned), a battery health figure ("Pin 100",
 * "battery 92" — not "pin 100 giờ", a battery LIFE) and a charge-cycle count ("Sạc 422 lần").
 * ⚠️ NOT "thanh lý": shops clear NEW stock under it as often as used, and no row of the three mixed shops
 * depended on it (measured 2026-10-03). ⚠️ NOR A BARE "99%": "lọc bụi 99%", "màn hình 99% DCI-P3" and
 * "giảm đến 99%" are new goods (commit-gate review, two rounds); a graded used unit says "cũ" as well. A missed cue costs a listing; a false one tells a buyer a new item
 * is second-hand, the worse way to be wrong (commit-gate review).
 * ⚠️ NOT "trầy xước" (scratched), though CellphoneS titles a scuffed unit "… - Trầy xước": every screen
 * protector and case says it too — "Chống Va Đập Và Trầy Xước" (protects against knocks and scratches) —
 * and a new accessory kept as "used" is the wrong way to fail. Measured in the 2026-10-03 dry run.
 */
const USED_TEXT = new RegExp(
  [
    `${B}cũ${E}`,
    'qua sử dụng',
    'like ?new',
    `${B}2nd${E}`,
    'second.?hand',
    // English "used" as a CONDITION, not as a verb: "Case used for iPhone 17", "can be used with" are the
    // machine translation of "dùng cho" on NEW accessories (commit-gate review). Measured 2026-10-03: no row of
    // the mixed shops is decided by this cue alone — their Vietnamese title carries "cũ" too.
    `(?<!(?:be|is|are|was|were|been|being|can|commonly|widely|often|easily|mostly|frequently|rarely|never|not)\\s)${B}used${E}(?!\\s+(?:for|with|to|in|on|by|as|when|after|while|at|from|under|if|together)${E})`,
    // Not a display STAND (kệ/tủ/quầy/bàn/giá trưng bày) — that is new furniture.
    '(?<!(?:kệ|tủ|quầy|bàn|giá|mô hình)\\s)trưng bày',
    'refurb',
    'máy đẹp',
    `${B}cpo${E}`,
    `${B}pin (?:100|[89][0-9])${E}${NOT_A_DURATION}`,
    `${B}battery (?:100|[89][0-9])${E}${NOT_A_DURATION}`,
    'sạc [0-9]+ lần',
    'charge cycles',
  ].join('|'),
  'iu',
)

/**
 * ⚠️ "2nd" IS AN EDITION OR A GENERATION AS OFTEN AS IT IS A CONDITION: "AirPods Pro 2nd Gen", "Atomic
 * Habits 2nd Edition". The phrase is REMOVED before the cues are tested — not "a title containing it is
 * never used" — so "AirPods Pro 2nd Gen - Cũ" is still used, on its "Cũ". (The 2026-10-03 SQL vetoed the
 * whole title instead, and applied the veto to `title` only, which is how two new "2nd Gen" items
 * reached the kept set through their Vietnamese title.)
 */
const NOT_A_CONDITION = /\b2nd\s+(?:edition|gen(?:eration)?|reprint)\b/giu

/**
 * A shop URL slug that marks used stock: `…-cu.html` / a slug ending `-cu`, or `-cu-` followed by one of the
 * suffixes the mixed shops actually write after it (measured 2026-10-03 on CellphoneS, Bạch Long and
 * Điện Thoại Giá Kho: `-cu-dep`, `-cu-tray`, `-cu-xuoc`, `-cu-da-kich-hoat` / `-cu-dkh` (only `da-kich`: `bo-cu-da-nang` is a multi-port charger), `-cu-ch…`,
 * `-cu-doi-bao-hanh`, `-cu-ko…`, `-cu-esim`, `-cu-pin…`, `-cu-9x` (a grade, 90–99), `-cu-8gb`, `-cu-<numeric id>`).
 * Not `-cu-doi-…` alone ("củ đôi", a dual charger) nor a bare small number (`-cu-2-cong`, a two-port brick), and `like-new`.
 * ⛔ AN ALLOW-LIST AFTER "-cu-", NOT A DENY-LIST (commit-gate review): an unaccented "cu" is also củ, cụ, cư,
 * cứ… — across every import shop the commonest "-cu-" slugs are `chung-cu-…` (chung cư, an apartment), and
 * `cong-cu` (a tool), `cu-nguon` (a power brick) follow. A slug this does not recognise is simply not a cue.
 * ⛔ AND THESE, measured on live rows, stay excluded however the slug continues:
 *   · `cu-sac` — "củ sạc", a CHARGER. Bạch Long's "Combo củ sạc, cáp sạc Apple 96W" carries no other cue
 *     and was kept and labelled used on this clause alone (review, 2026-10-03).
 *   · `cu-cs` — Panasonic air-conditioner model codes, "CU/CS-RU12CKH-8D" (18 CellphoneS rows).
 *   · `dung-cu` — "dụng cụ", a TOOL or kit: "Bộ dụng cụ nướng bánh Philips" (a baking set) surfaced in the
 *     first dry run's audit as "says used" on this clause alone; likewise `cong-cu`, `chung-cu`, `dan-cu`.
 * The URL may be AccessTrade-wrapped (`go.isclix.com/…?url=https%3A%2F%2F…`); the slug survives the
 * encoding because `-` and `.` are never escaped.
 */
const USED_URL = /(?<!(?:dung|cong|chung|dan|nguyen))-cu(?:-(?:dep|tray|xuoc|da-kich|dkh|ch|chinh|doi-bao-hanh|ko|esim|pin|9\d|\d+(?:gb|tb)|\d{5,})(?=-|\.html|$)|\.html|$)|like-?new/i

const norm = (t: string | null | undefined) => (t ?? '').normalize('NFC')

/** True when this one piece of text carries a used cue. */
export function textSaysUsed(text: string | null | undefined): boolean {
  const t = norm(text).replace(NOT_A_CONDITION, ' ')
  return t.length > 0 && USED_TEXT.test(t)
}

/** True when the shop's product URL marks the item as used. */
export function urlSaysUsed(url: string | null | undefined): boolean {
  const u = norm(url)
  if (!u) return false
  let decoded = u
  try { decoded = decodeURIComponent(u) } catch { /* keep the raw form */ }
  return USED_URL.test(decoded.toLowerCase())
}

/** The shop says this item is second-hand — in its title, its Vietnamese title, or its product URL. */
export function isUsedTitle(title: string | null | undefined, titleVi?: string | null, url?: string | null): boolean {
  return textSaysUsed(title) || textSaysUsed(titleVi) || urlSaysUsed(url)
}
