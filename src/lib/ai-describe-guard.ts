/**
 * The gates every LLM-written product description passes before it can touch a live listing.
 *
 * ⛔ WHY THIS IS A MODULE AND NOT A FEW `if`s IN A SCRIPT. The closed-list spec machinery only ever
 * guarded the `attributes` column. A spec invented inside a SENTENCE — "16GB RAM and a 512GB SSD" —
 * is invisible to `isLegalSpec`, to repair-bad-specs.ts and to every facet test, and it does not
 * stay on the page: `description` is what JSON-LD publishes (listings/[id]/page.tsx), what the
 * Facebook catalog CSV carries, and what the Google Merchant XML carries — both fetched UNATTENDED
 * by Meta and Google. There is no human between the model and a licensed company's Merchant Center.
 * That is the 134-iPhone incident with the safety net removed, so the net goes here, unit-tested.
 */
import { extractSpecsFromTitles } from './electronics-specs'

/**
 * What the deterministic extractor makes of a title's capacities, used only to tell RAM from
 * storage when both would match the same "<n>GB" token. Both subcategories are tried because the
 * caller's subcategory is not in scope here and the labelled rules are the same for each.
 */
const TITLE_SPECS = (title: string, titleVi: string | null): Record<string, string> => ({
  ...extractSpecsFromTitles('laptops-pcs', [title, titleVi]),
  ...extractSpecsFromTitles('phones-tablets', [title, titleVi]),
})

/**
 * ⛔ THE VIETNAMESE-DETECTION CLASS FROM scripts/translate-imported-listings.ts, COPIED ON PURPOSE.
 * That script re-translates any row whose `description` matches this, so an English description
 * containing ANY of these characters gets machine-translated over itself and mangled. `đ` is in the
 * set — which means writing a price ("18.290.000 đ") or a place name ("Đà Nẵng") in the English
 * slot is enough to destroy it. Verified 2026-08-25.
 * ⚠️ Kept as a literal rather than imported so this gate cannot be silently loosened by an edit to
 * a maintenance script; the test asserts the two stay in sync.
 */
export const VI_CHARS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i

/**
 * Claims a marketplace that never takes the payment cannot make.
 * ⛔ The product page already prints, in both languages, "eno.vn never takes payment for these
 * items, and cannot refund or return one" (safety-strip.tsx), and the PDP deliberately omits
 * `hasMerchantReturnPolicy` / `shippingDetails` from its JSON-LD because "publishing 'returns not
 * permitted' for a product we do not sell is a claim we have no standing to make". A generated
 * "12-month warranty, free delivery, 7-day returns" contradicts the same screen it sits on, and
 * under the sàn TMĐT regime eno is the publisher of that sentence.
 */
/**
 * ⛔ NEVER WRAP A VIETNAMESE PHRASE IN `\b`. JavaScript word boundaries are ASCII-only, so `\bđổi`
 * needs a word character immediately before "đ" and can never match after a space — measured:
 * "Sản phẩm được đổi trả trong 7 ngày" sailed through a `/\b(...|đổi trả)\b/` guard while the
 * English "returns" was caught. This trap has now appeared five times in this codebase, and here it
 * would have published a returns promise, in the language most buyers read, to Google Merchant.
 * ⚠️ THE UNACCENTED FORM COUNTS TOO. Vietnamese is routinely typed without diacritics, and the
 * English slot is required to be diacritic-free — so "doi tra" and "bao hanh" must be listed
 * explicitly; folding the text first would break the English patterns that rely on `\b`.
 */
const BANNED_CLAIMS: { re: RegExp; why: string }[] = [
  { re: /\b(warrant\w+|guarantee\w*|guaranteed)\b/i, why: 'warranty claim' },
  { re: /(bảo đảm|bao dam|cam kết|cam ket)/i, why: 'warranty claim' },
  { re: /(bảo hành|bao hanh)/i, why: 'warranty claim' },
  /**
   * ⛔ SHIPPING NEEDS FULFILMENT CONTEXT, NOT THE BARE VERB. A flat
   * `\b(deliver|delivers|delivery)\b` flagged 754 good descriptions, because English uses the word
   * for everything: "delivers cable-free typing", "quick power delivery", "delivers durable daily
   * protection". None of those promise to send anyone anything. Requiring the word to sit next to a
   * fulfilment noun keeps the real claim ("delivery is available nationwide", "ships to buyers")
   * and drops the idiom.
   * ⚠️ This was caught by reading the verify pass's failures instead of trusting its count — the
   * blind revert it proposed would have deleted three quarters of the run.
   */
  { re: /\b(free|fast|nationwide|worldwide|express|same[- ]day|next[- ]day)\s+(shipping|delivery)\b/i, why: 'shipping claim' },
  // ⚠️ One optional adverb between the verb and its target — "ships QUICKLY to buyers" is the
  // same promise as "ships to buyers", and the first version of this rule missed it.
  { re: /\b(ship|ships|shipped|shipping|deliver|delivers|delivered|dispatch\w*)\s+(\w+\s+)?(to|from|within|nationwide|worldwide|anywhere|across|in\s+\d)\b/i, why: 'shipping claim' },
  { re: /\b(shipping|delivery)\s+(is|are|available|time|fee|cost|option)/i, why: 'shipping claim' },
  { re: /\bwe\s+(ship|deliver)\b/i, why: 'shipping claim' },
  { re: /(giao hàng|giao hang|vận chuyển|van chuyen|ship hàng|ship hang)/i, why: 'shipping claim' },
  { re: /\b(returns?|refund\w*)\b/i, why: 'returns claim' },
  { re: /(đổi trả|doi tra|hoàn tiền|hoan tien)/i, why: 'returns claim' },
  { re: /\b(in stock|out of stock|available now|ready to ship)\b/i, why: 'stock claim' },
  { re: /(còn hàng|con hang|hết hàng|het hang|sẵn hàng|san hang)/i, why: 'stock claim' },
  // ⚠️ A price baked into prose goes stale the next time the daily refresh moves it, and creates
  // the structured-data-vs-visible-price mismatch the PDP warns about.
  /**
   * ⛔ NO LEADING `\b` ON A SYMBOL BRANCH, AND NO `\b` AROUND A VIETNAMESE WORD. Both mistakes were
   * in the first two versions of this rule: `/\b(…|\$\s?\d)/` put the boundary in front of `$`,
   * where a space-then-`$` is not a boundary at all, so "priced at $999" was uncaught; and
   * `\btỷ\b` can never match because `ỷ` is not an ASCII word character. The đồng sign `₫` was
   * missing outright, as was "VND 18.290.000" with the code BEFORE the number.
   * ⚠️ A price in prose is not just a compliance risk — it goes stale the next time the daily
   * refresh moves the number, and then the page contradicts itself.
   */
  { re: /[$€£₫]\s*\d/, why: 'price' },
  /**
   * ⛔ `(?!\p{L})` WITH THE `u` FLAG, NOT `(?![a-z])`. The đồng symbol is the letter "đ", which
   * starts a great many ordinary Vietnamese words — so `\d\s*đ(?![a-z])` matched the "32 đ" in
   * "32 đến 75 inch" (32 TO 75 inches) and the "1 đ" in "4 trong 1 đã qua sử dụng" (used).
   * It flagged 345 perfectly good Vietnamese descriptions as containing a price. An ASCII-only
   * lookahead cannot see that "ế" and "ã" are letters; a Unicode one can.
   * ⚠️ Measured before reverting anything — the verify pass reported 13% failures and reading them
   * is what exposed this. A blind revert would have destroyed them.
   */
  { re: /\d[\d.,]*\s*[$€£₫](?!\p{L})/u, why: 'price' },
  { re: /\d[\d.,]*\s*đ(?!\p{L})/u, why: 'price' },
  { re: /\d[\d.,]*\s*(usd|vnd|vnđ|dong|đồng|eur|euros?|dollars?|million|billion)(?!\p{L})/iu, why: 'price' },
  { re: /(usd|vnd|vnđ|eur|price of|priced at|costs?|costing)\s*[$€£₫]?\s*\d/i, why: 'price' },
  { re: /\d[\d.,]*\s*(triệu|trieu|tỷ|ty|nghìn|nghin)(?!\p{L})/iu, why: 'price' },
  { re: /\b(discount|sale price|was \d|save\s?\d+\s?%)/i, why: 'discount claim' },
  { re: /(giảm giá|giam gia|khuyến mãi|khuyen mai)/i, why: 'discount claim' },
  { re: /\b(cheapest|best price|lowest price)\b/i, why: 'superlative price claim' },
  { re: /(rẻ nhất|re nhat|giá tốt nhất|gia tot nhat)/i, why: 'superlative price claim' },
  /**
   * ⛔ THE WIDEST NET HERE, AND IT IS NOT PARANOIA — IT IS MEASURED. On 25 rows whose titles contain
   * no such word, the model wrote "genuine", "authentic" or "official" into 9 of 25 English
   * descriptions and "chính hãng" into 9 of 25 Vietnamese ones. "Chính hãng" is a specific CHANNEL
   * claim in Vietnam (authorised distributor, official warranty); a licensed sàn TMĐT asserting it
   * in its own voice about stock it never touched is false advertising under Luật Quảng cáo, and
   * it republishes unattended into the Google Merchant and Meta feeds.
   * ⚠️ NO "BUT THE TITLE SAYS IT" CARVE-OUT. 24 rows carry a warranty term in the merchant's own
   * title; repeating the merchant's marketing in our description makes it OUR speech. The row is
   * rejected instead — an undescribed product is a smaller problem than a claim we cannot stand behind.
   */
  { re: /\b(genuine|authentic|authoriz\w+|authoris\w+|official(?:ly)?)\b/i, why: 'authenticity guarantee' },
  { re: /(chính hãng|chinh hang|chuẩn hãng|chuan hang|hàng thật|hang that|uy tín|uy tin|đáng tin cậy|dang tin cay)/i, why: 'authenticity guarantee' },
  { re: /https?:\/\/|www\./i, why: 'url' },
  // Phone numbers: the app's own create path rejects them; a script write bypasses that check.
  // A Vietnamese mobile number in any of the spacings people actually write: 0912345678,
  // 0912 345 678, 0912.345.678, +84 912 345 678.
  { re: /(?:\+?84|0)[\s.-]?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\d)/, why: 'phone number' },
]

export type GuardInput = {
  subcategorySlug: string | null
  title: string
  titleVi: string | null
  /** Attributes already validated against the closed list. */
  attributes: Record<string, string>
  descEn: string
  descVi: string
}

export type GuardResult = { ok: true } | { ok: false; reasons: string[] }

const MIN = 40
const MAX = 900

export function guardDescription(input: GuardInput): GuardResult {
  const reasons: string[] = []
  const { descEn, descVi } = input

  for (const [label, text] of [['en', descEn], ['vi', descVi]] as const) {
    if (!text || text.trim().length < MIN) { reasons.push(`${label}: shorter than ${MIN} chars`); continue }
    if (text.length > MAX) reasons.push(`${label}: longer than ${MAX} chars`)
    for (const c of BANNED_CLAIMS) if (c.re.test(text)) reasons.push(`${label}: ${c.why}`)
  }

  // ⛔ The English slot must be free of Vietnamese characters or translate-imported-listings.ts
  // will overwrite it. This is the only gate that applies to one language and not the other.
  if (VI_CHARS.test(descEn)) reasons.push('en: contains Vietnamese characters (would be re-translated over)')

  /**
   * ⛔ EVERY SPEC ASSERTED IN PROSE MUST BE CORROBORATED. Runs the SAME closed-list extractor over
   * the generated sentences: anything it finds there has to match either a validated attribute or
   * what the merchant's own title says. A model that writes "512GB" about a 128GB phone is caught
   * here and nowhere else.
   */
  const fromTitle = extractSpecsFromTitles(input.subcategorySlug, [input.title, input.titleVi])
  for (const [label, text] of [['en', descEn], ['vi', descVi]] as const) {
    const claimed = extractSpecsFromTitles(input.subcategorySlug, [text])
    for (const [k, v] of Object.entries(claimed)) {
      if (input.attributes[k] === v || fromTitle[k] === v) continue
      reasons.push(`${label}: uncorroborated spec claim ${k}=${v}`)
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true }
}

/**
 * Keep only spec values that are legal for this subcategory AND do not contradict what the
 * deterministic extractor already found.
 *
 * ⛔ THE DETERMINISTIC VALUE WINS EVERY DISAGREEMENT. It reads the merchant's own title through a
 * closed list and is structurally incapable of inventing a capacity; the model is not. Measured on
 * 60 rows where the regex was certain, the model agreed 60/60 on storage, 60/60 on RAM and 19/19 on
 * connectivity — so disagreements are rare enough that preferring the safer source costs almost
 * nothing, and the one time it matters it is the difference between a spec and a fabrication.
 */
export function reconcileSpecs(
  deterministic: Record<string, string>,
  ai: Record<string, string> | undefined,
  isLegal: (key: string, value: string) => boolean,
  /** Second, orthogonal gate: is the value readable in the merchant's own title? */
  isGrounded: (key: string, value: string) => boolean,
  /** Write values the model knows but the title does not state. OFF by default — see below. */
  allowUngrounded = false,
): { merged: Record<string, string>; added: string[]; conflicts: string[]; ungrounded: string[] } {
  const merged = { ...deterministic }
  const added: string[] = []
  const conflicts: string[] = []
  const ungrounded: string[] = []
  for (const [k, raw] of Object.entries(ai ?? {})) {
    const v = String(raw ?? '').trim()
    if (!v) continue
    if (!isLegal(k, v)) { conflicts.push(`${k}=${v} illegal`); continue }
    if (k in deterministic) {
      if (deterministic[k] !== v) conflicts.push(`${k}: kept ${deterministic[k]}, model said ${v}`)
      continue
    }
    /**
     * ⛔ AN UNGROUNDED VALUE IS RECORDED, NOT WRITTEN. It is usually not a hallucination — the model
     * genuinely knows that a Dell Vostro 3530 is a 15.6-inch machine — but nothing we hold can
     * confirm it, and `attributes` is published to Google Merchant and Meta unattended. "Probably
     * right" is the wrong standard for a claim nobody reads before it ships.
     */
    if (!isGrounded(k, v)) { ungrounded.push(`${k}=${v}`); if (!allowUngrounded) continue }
    merged[k] = v
    added.push(k)
  }
  return { merged, added, conflicts, ungrounded }
}

/**
 * Is a spec value actually VISIBLE in the merchant's own text?
 *
 * ⛔ WHY THE CLOSED LIST IS NOT ENOUGH, WHICH IS THE SHARPEST THING ANY REVIEWER SAID ABOUT THIS
 * WORK. `isLegalSpec` returns true for all 279 (key, value) pairs in the schema: it is a
 * WELL-FORMEDNESS test, not a truth test. It caught the 134-iPhone incident only because `ram=128`
 * is malformed FOR A PHONE. It cannot catch `storage: "512"` on a 128GB iPhone — legal,
 * well-formed, false, and indistinguishable from a correct write. Against a regex reading the
 * merchant's own title that gap did not matter, because a regex cannot invent a number. Against a
 * generative model it is the whole risk.
 *
 * So this is the orthogonal gate the enum cannot satisfy: the value has to be READABLE in the
 * title. It demotes the model from recall to reading, which is the job it can be held to.
 *
 * ⚠️ MEASURED, AND THE ANSWER WAS NOT ONE-SIDED. On 40 laptop rows whose titles contain no
 * extractable spec at all, the model emitted 39 values: 32 were present in the title and 7 were
 * not. Reading those 7, they were not hallucinations — "Dell Vostro 3530" IS a 15.6-inch machine
 * and "HP 250 G9" IS 15.6 inches; the model knows the product line. They are simply unverifiable
 * from anything we hold. That is why an ungrounded value is REPORTED rather than written: it is
 * probably right, and "probably right" is not what belongs in a Google Merchant feed that nobody
 * reads before it publishes.
 */
export function isGroundedInTitle(key: string, value: string, title: string, titleVi: string | null): boolean {
  const hay = ` ${title} ${titleVi ?? ''} `.toLowerCase()
  const v = value.toLowerCase()

  /**
   * ⛔ RAM AND STORAGE SHARE A UNIT, SO A BARE "16GB" GROUNDS NEITHER ON ITS OWN. A title reading
   * "16GB RAM" would otherwise ground `storage: "16"` too — the number and the unit are both there
   * — and publish a fabricated capacity. The deterministic extractor already resolves which slot a
   * labelled capacity belongs to (that is most of what it does), so ask it: if it assigned this
   * number to the OTHER slot, this one is not grounded by it.
   */
  if (key === 'ram' || key === 'storage') {
    const other = key === 'ram' ? 'storage' : 'ram'
    const parsed = TITLE_SPECS(title, titleVi)
    if (parsed[other] === value && parsed[key] !== value) return false
  }

  /**
   * ⛔ A NUMBER MUST APPEAR WITH ITS UNIT, ANCHORED. The first version asked `hay.includes("8")`,
   * and "8" sits inside "128GB" — so `ram: "8"` on an "iPhone 16 Pro 128GB" read as grounded and
   * the gate collapsed for every small number. Three reviewers found it independently in the same
   * round. `\b15\s*inch` also refuses "Vostro 3515" and `\b64\s*gb` refuses "Ryzen 7640HS",
   * because there is no word boundary in the middle of a longer number.
   */
  const UNIT_OF: Record<string, string> = {
    ram: 'gb|tb', storage: 'gb|tb', caseSize: 'mm', screenSize: 'inches|inch|in|"|”',
    laptopSize: 'inches|inch|in|"|”', refreshRate: 'hz', wattage: 'w', capacity: 'mah',
  }
  const unit = UNIT_OF[key]
  if (unit) {
    const n = Number(value)
    if (!Number.isFinite(n)) return false
    /**
     * ⚠️ `(?![a-z0-9])` NOT `\b` AS THE CLOSING ANCHOR. Two of these units are `"` and `”`, which
     * are NOT word characters — so a trailing `\b` after them can never match, and every
     * `15.6"` / `27"` title silently failed grounding and had its spec stripped. Sixth appearance
     * of the ASCII-boundary trap in this codebase, this time in the fix for the previous one.
     */
    /**
     * ⚠️ `[\s-]*` NOT `\s*`. Merchants write "13-inch", "15.6-inch", "27-inch" and "1-TB" with a
     * hyphen at least as often as with a space, and `\s` does not match `-` — so every hyphenated
     * title failed grounding, had its spec stripped, and then had its DESCRIPTION rejected for
     * asserting the very spec the title states.
     */
    if (new RegExp(`\\b${n}[\\s-]*(?:${unit})(?![a-z0-9])`, 'i').test(hay)) return true
    // A capacity stored in GB may be written as TB ("1024" <- "1tb", "2048" <- "2tb").
    if ((key === 'ram' || key === 'storage') && n >= 1024 && n % 1024 === 0
        && new RegExp(`\\b${n / 1024}[\\s-]*tb(?![a-z0-9])`, 'i').test(hay)) return true
    // Screen sizes are written with a decimal the canonical value drops: 15 <- "15.6 inch".
    if ((key === 'laptopSize' || key === 'screenSize')
        && new RegExp(`\\b${n}[.,]\\d[\\s-]*(?:${unit})(?![a-z0-9])`, 'i').test(hay)) return true
    return false
  }

  /**
   * Non-numeric keys: the value, or an alias the merchant genuinely writes.
   * ⚠️ These are ALIASES, not inferences — "U5" on the box is Intel's own shorthand for Core
   * Ultra 5. Nothing here admits a value the text does not name.
   */
  if (new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay)) return true
  const ALIASES: Record<string, RegExp> = {
    ultra5: /\bu5\b|ultra\s?5/i, ultra7: /\bu7\b|ultra\s?7/i, ultra9: /\bu9\b|ultra\s?9/i,
    i3: /\bi3\b/i, i5: /\bi5\b/i, i7: /\bi7\b/i, i9: /\bi9\b/i,
    ryzen3: /ryzen\s?3/i, ryzen5: /ryzen\s?5/i, ryzen7: /ryzen\s?7/i, ryzen9: /ryzen\s?9/i,
    lte: /\blte\b|\b4g\b|esim|cellular/i, gps: /\bgps\b/i, '5g': /\b5g\b/i,
    fhd: /full\s?hd|\bfhd\b|1080p/i, '2k': /\b2k\b|qhd|1440p/i, '4k': /\b4k\b|uhd|2160p/i, '8k': /\b8k\b/i,
    tws: /true\s?wireless|\btws\b/i, ssd: /\bssd\b/i, hdd: /\bhdd\b/i, microsd: /micro\s?sd|thẻ nhớ/i,
  }
  return ALIASES[v]?.test(hay) ?? false
}
