/**
 * DEMAND ENGINE — turn "looking for" posts into a reviewed queue of listing matches.
 *
 *   npx tsx scripts/demand-engine.ts --demo             # built-in HCMC sample posts
 *   npx tsx scripts/demand-engine.ts --in data/posts.jsonl --out data/demand-queue.json
 *
 * ⛔ IT DRAFTS, IT DOES NOT POST. The output is a queue for a human to send. Automated
 * promotional replies to strangers' posts are spam under Meta's Community Standards no matter how
 * good the match is, and the accounts at risk are the ones carrying the catalog and the CAPI
 * dataset. A person between the match and the send is what makes this usable at all.
 *
 * The pipeline, and why each stage is the tool it is:
 *
 *   1. TRIAGE     jev — is this demand, and for what? A decisions model is right here: calibrated,
 *                 reads Vietnamese, ~$0.00002/call so screening thousands costs pennies. Measured
 *                 on real posts: 0.98 "cần mua laptop", 0.04 "Bán gấp xe Vision" (a SELLER).
 *   2. PARSE      plain code — budget and district come out by regex. jev answers questions, it
 *                 does not extract free text; asking it for these is the wrong tool.
 *   3. RETRIEVE   Postgres — category + price band + folded text search. jev cannot see 79,629
 *                 listings; it scores what retrieval hands it.
 *   4. RE-RANK    jev — does THIS listing satisfy THIS request? Measured: 0.91 for the right
 *                 laptop, 0.12 for one that was the right product but over budget. A keyword
 *                 matcher calls that 0.12 case a hit and gets the account reported.
 *   5. DRAFT      template — a short Vietnamese reply naming the listing, for a human to send.
 */
import { config } from 'dotenv'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Prisma, type PrismaClient } from '../src/generated/prisma/client'
import { fold } from '../src/lib/fold'
// ⛔ MONEY GOES THROUGH src/lib/vnd.ts — a repo non-negotiable, and the reply is the one place it
// shows. Hand-rolling `(price/1e6).toFixed(1)` wrote "10.5 triệu" into a VIETNAMESE sentence,
// where a dot is the THOUSANDS separator, so it reads as ten-thousand-five-hundred; it also
// turned 500,000 into "0.5 triệu" and a free item into "0k".
import { formatMoneyFull } from '../src/lib/vnd'
// ⛔ REDACTION RUNS HERE TOO. `stripPreamble` lived only in the intake, so a JSONL assembled any
// other way — by hand, by another scraper, by a colleague — sent names and phone numbers straight
// to a foreign API. The boundary has to sit at the point of SENDING, not at one of the inputs.
import { stripPreamble } from './fb-intake'

// ⚠️ `dotenv/config` reads ONLY `.env`. DATABASE_URL lives there, TYPESAFE_API_KEY lives in
// `.env.local` (gitignored), so both files have to be named or the first jev call throws.
config({ path: '.env', quiet: true })
config({ path: '.env.local', quiet: true })

/**
 * ⛔ `db` IS IMPORTED LAZILY AND THAT IS LOAD-ORDER, NOT STYLE. `import` is HOISTED above the
 * `config()` calls above, so a static `import { db }` constructs the Prisma client before
 * DATABASE_URL exists — it then falls back to the libpq default and reports
 * `Database \`mk1e3\` does not exist`, which reads as a missing database rather than a missing
 * variable. Resolving it inside main() is what makes the env load happen first.
 */
let db: PrismaClient

const API = 'https://api.typesafe.ai/v1/systemone'
const MODEL = process.env.TYPESAFE_DECISIONS_MODEL?.replace(/^~?typesafe\//, '') || 'jev-latest'
const KEY = process.env.TYPESAFE_API_KEY

/**
 * Routable categories, measured against the live catalogue — these are the `Category.slug` values
 * that actually carry verified active rows, not the taxonomy's full list. Counts 2026-09-21.
 */
const KINDS: Record<string, string> = {
  electronics: 'phone, laptop, computer, camera, audio, TV, electronic appliance',       // 65,085
  'furniture-appliances': 'furniture, white goods, kitchen, home appliance',              //  6,406
  sports: 'sportswear, sports shoes, fitness or sports equipment',                        //  5,591
  'fashion-beauty': 'clothing, shoes, bag, watch, cosmetics, jewellery',                  //  1,192
  'books-stationery': 'book, stationery, office supply',                                  //    425
  services: 'a service, repair, installation, tutoring or professional help',             //    385
  'baby-kids': 'baby gear, toy, kids clothing',                                           //    380
  vehicles: 'motorbike, car, bicycle, vehicle part',                                      //    100
  'hobbies-sports': 'hobby gear, musical instrument, collectible',                        //     30
  'food-drink': 'food or drink',                                                          //     17
  'tickets-travel': 'ticket, tour or travel service',                                     //     17
  pets: 'pet or pet supply',                                                              //      1
  /**
   * ⚠️ NOT A CATEGORY — the catalogue has NO property rows. Rooms and apartments are the single
   * commonest "looking for" post in HCMC groups, so triage must be able to name them; routing
   * them into retrieval would just return the nearest furniture. They are counted and dropped.
   */
  property: 'a room, apartment or house to rent or buy',
  none: 'not a demand post, or nothing identifiable',
}
const NO_INVENTORY = new Set(['property', 'none'])

/**
 * The shared desks that carry visa and itinerary products. eno.vn is licensing as a Vietnamese
 * company that may not offer either, so nothing they own may be drafted into a reply.
 */
const DESK_SELLERS = ['Eno', 'VietKite', 'GMBR']
/**
 * ⚠️ BY ID AS WELL AS NAME. A reviewer's fair catch: matching on `s.name` alone means renaming a
 * desk seller silently removes the exclusion — and a legal boundary must not rest on a display
 * string. Measured 2026-09-21; ids are stable, names are not.
 */
const DESK_SELLER_IDS = [
  'cmqumj6s3000004kzfx64tlh1', // Eno
  'b6b7b817-6af9-4d37-a762-cf54f6ec74e6', // VietKite
  '4ba44111-e822-4a1d-b55a-79ad04ec413c', // GMBR
]

type Answers = Record<string, { noul?: number; choice?: string; score?: number }>

/**
 * ⚠️ NEITHER A HANG NOR A THROW MAY REACH THE LOOP. A bare `fetch` with no timeout and no catch
 * meant one ECONNRESET on post 300 threw away every post before it — the queue is only written at
 * the end — and one stalled connection hung the run with no error at all.
 */
async function ask(state: unknown, questions: unknown, tries = 3): Promise<Answers | null> {
  if (!KEY) throw new Error('TYPESAFE_API_KEY missing — it lives in .env.local')
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, state, questions }),
        signal: AbortSignal.timeout(20_000),
      })
      if (res.ok) return (await res.json()).answers as Answers
      if (res.status !== 429 && res.status < 500) {
        console.error(`  jev ${res.status}: ${(await res.text()).slice(0, 140)}`)
        return null
      }
    } catch (e) {
      if (i === tries - 1) { console.error(`  jev unreachable: ${(e as Error).message.slice(0, 90)}`); return null }
    }
    await new Promise((r) => setTimeout(r, 400 * 2 ** i))
  }
  return null
}

// ── 2. PARSE ────────────────────────────────────────────────────────────────
/**
 * ⚠️ VIETNAMESE PRICES ARE WRITTEN A DOZEN WAYS and the unit is usually implied: `10 triệu`,
 * `10tr`, `10 củ`, `10 chai`, `5-7 triệu`, `dưới 5tr`, `500k`. A budget misread by a factor of a
 * thousand makes every downstream match nonsense, so each form is matched explicitly rather than
 * by one loose number grab.
 */
export function parseBudgetVnd(text: string): { min: number | null; max: number | null } {
  const t = fold(text).replace(/,/g, '.')
  const nums: number[] = []

  /**
   * ⛔ A WRITTEN RANGE IS MATCHED FIRST AND WHOLE. "5-7 triệu" carries the unit only on the
   * second number, so the per-number pass below saw one figure, called it a ceiling, and threw
   * the 5 away — measured: max 7,000,000 with no floor.
   */
  /**
   * ⚠️ NOT AFTER A DISTRICT. "quận 3 - 5 triệu" and "Q7 - 10tr" are a DISTRICT and a price, and the
   * range reading turned the district number into a floor of 3,000,000. The lookbehind is spelled
   * out rather than clever because getting it wrong silently raises every candidate's price.
   */
  const range = t.match(/(?<!qu?[aậ]?n?\s?)(?<!\bq)(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:trieu|tr\b)/)
  if (range && !/\b(qu[aâ]n|q)\s*\d+\s*[-–—]/.test(t)) {
    return { min: parseFloat(range[1]) * 1e6, max: parseFloat(range[2]) * 1e6 }
  }

  /**
   * ⛔ `cu` AND `chai` ARE GONE AND THAT IS A MEASURED DECISION, not caution. They are slang for
   * "million", but folded they also spell the two commonest words in a Vietnamese classified:
   * "cũ" (used) and "chai" (bottle). Measured on real phrasings:
   *   "Tìm mua iPhone 13 cũ khoảng 15tr"  ->  floor of 13,000,000 from "13 cũ"
   *   "Bán xe Vision 2020 cũ"             ->  a budget of 2,020,000,000 đ
   * Missing a genuine "10 củ" costs one match; inventing a two-billion-đồng ceiling poisons every
   * candidate the post retrieves.
   */
  /**
   * ⚠️ "12tr5" IS 12.5 MILLION, and it is how people actually type. The trailing digit is the
   * hundred-thousands place, so "1tr2" is 1,200,000 — matched here before the plain form, because
   * `tr\b` alone fails on "12tr5" entirely and the post came back with no budget at all.
   */
  // ⚠️ NO SPACE ALLOWED between "tr" and the decimal digit. With `\s*` there, "dưới 10tr 2 cái"
  // (two items) read as 10.2 million and "15tr 2 sim" as 15.2 — the next word's leading digit was
  // swallowed as a decimal.
  for (const m of t.matchAll(/(\d+)tr(\d)\b/g)) nums.push((parseFloat(m[1]) + parseFloat(m[2]) / 10) * 1e6)
  // ⚠️ NO `(?!\s*\d)` HERE ANY MORE. It existed to stop this form stealing "12tr5", but once the
  // decimal form above required NO space the guard only did harm: "dưới 10tr 2 cái" matched
  // neither pattern and the post came back with no budget at all.
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(?:trieu|tr\b)/g)) nums.push(parseFloat(m[1]) * 1e6)

  /**
   * ⚠️ `k` ONLY COUNTS AT 50 AND ABOVE. "4K", "2K" and "8K" are resolutions, and "TV 4K dưới 10tr"
   * parsed to a floor of 4,000 đ — which then set `price >= min*0.6`, i.e. 2,400 đ, and returned
   * nothing. Nobody shops this marketplace with a ceiling under 50,000 đ, so the threshold costs
   * no real post and removes the whole spec-collision class.
   */
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(?:nghin|k\b)/g)) {
    const v = parseFloat(m[1]) * 1e3
    if (v >= 50_000) nums.push(v)
  }

  if (!nums.length) return { min: null, max: null }
  if (nums.length >= 2) return { min: Math.min(...nums), max: Math.max(...nums) }
  /**
   * ⚠️ "trên 5tr" MEANS A FLOOR, NOT A CEILING. Read as a ceiling it inverts the whole filter.
   */
  if (/\btren\b/.test(t)) return { min: nums[0], max: null }
  /**
   * A lone figure under "tầm/khoảng" is a target, not a ceiling — allow 20% headroom.
   * ⚠️ WORD-BOUNDED. Unbounded, `tam` matched inside "trung tâm" and "quan tâm" and quietly added
   * 20% to the ceiling of any post that used either.
   */
  // ⚠️ "trung tâm" (centre) and "quan tâm" (interested) both fold to a standalone "tam", so a word
  // boundary alone is not enough — a post saying "ở trung tâm quận 1" still got 20% added.
  /**
   * ⚠️ AN EXPLICIT "dưới" (under) BEATS EVERY SOFT WORD. "Cần mua tủ lạnh dưới 3 triệu, gần Q7"
   * inflated to a 3.6M ceiling because `gan` matched — the "gần" was about the DISTRICT, not the
   * price, and the buyer had already said the word for "under".
   */
  const soft = !/\bduoi\b|\bunder\b|\bmax\b/.test(t)
    && (/(?<!trung )(?<!quan )\btam\b|\b(khoang|co the)\b|~/.test(t)
      // "gần" is usually about place, so it only softens when no place word follows it.
      || /\bgan\b(?!\s*(qu?[aậ]n|q\d|nha|day|do))/.test(t))
  return { min: null, max: soft ? Math.round(nums[0] * 1.2) : nums[0] }
}

/** HCMC districts, in the folded spellings people actually type. */
const DISTRICTS = ['quan 1', 'quan 2', 'quan 3', 'quan 4', 'quan 5', 'quan 6', 'quan 7', 'quan 8',
  'quan 9', 'quan 10', 'quan 11', 'quan 12', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9',
  'q10', 'q11', 'q12', 'binh thanh', 'phu nhuan', 'go vap', 'tan binh', 'tan phu', 'thu duc',
  'binh tan', 'nha be', 'hoc mon', 'cu chi', 'binh chanh']
export function parseDistrict(text: string): string | null {
  const t = fold(text)
  // ⚠️ Longest first, or "quan 10" is shadowed by "quan 1" and every post lands in District 1.
  for (const d of [...DISTRICTS].sort((a, b) => b.length - a.length)) if (t.includes(d)) return d
  return null
}

/** Content words for retrieval, minus the phrasing every demand post contains. Folded. */
/**
 * ⚠️ ENGLISH TOO, AND IT IS NOT OPTIONAL. The list was Vietnamese-only while the file's own
 * worked example is `expatsinhcmc`, an ENGLISH-speaking group: "Looking for anyone who sells a
 * second hand laptop" yielded [looking, anyone, who, sells, second, hand] and the cap of 6 dropped
 * "laptop" — the one word retrieval needed. Same shape as the feed exclusion rules that were
 * written in Vietnamese and stopped matching when the catalogue turned English.
 */
const STOP = new Set(('can mua tim ban ai co khong em anh chi oi cho hoi giup voi nhe khu vuc '
  + 'tam khoang duoi trieu de la va cua gap nao gia cu moi nhu con nguoi duoc nay be minh '
  + 'lien he inbox sdt zalo uy tin che chi uu tien tren '
  // The accented spellings, so the pre-fold test above can tell "bán" (sell) from "bàn" (table).
  + 'cần mua tìm bán ai có không em anh chị ơi cho hỏi giúp với nhé khu vực '
  + 'tầm khoảng dưới triệu để là và của gấp nào giá cũ mới như con người được này bé mình '
  + 'liên hệ trên ưu tiên uy tín '
  + 'looking for anyone who what where when which someone need needed want wanted buy buying '
  + 'sell sells selling second hand used new the and any some good best cheap please thanks '
  + 'recommend recommendation know knows have has can could would there here about with from '
  + 'near around under below above district city saigon hcmc thanks advance').split(' '))
export function keywords(text: string): string[] {
  /**
   * ⛔ STOPWORDS ARE MATCHED ON THE ACCENTED WORD, AND FOLDING FIRST DELETED PRODUCTS. Vietnamese
   * accents are the whole distinction: "bàn" (a TABLE) folds to the same "ban" as "bán" (to sell),
   * and both were in the stop list, so "Cần mua bàn học" lost the one noun that mattered. The
   * folded form is still what retrieval searches with — only the stop test uses the original.
   * ⚠️ AND THE LENGTH FLOOR IS 2, NOT 3. Vietnamese nouns are routinely two letters — "tủ"
   * (cabinet), "xe" (vehicle), "ghế" is three but "bàn" is three folded and two in spirit — and a
   * `> 2` floor silently dropped them.
   */
  const raw = text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  for (const w of raw) {
    const lower = w.toLowerCase()
    if (STOP.has(lower)) continue
    const f = fold(w)
    if (f.length < 2 || seen.has(f) || /^\d/.test(f)) continue
    /**
     * ⚠️ THE FOLDED LIST APPLIES ONLY TO A WORD THE WRITER LEFT UNACCENTED. Checking it on every
     * word undid the fix above: "bàn" passed the accented test and was then dropped anyway,
     * because folded it is "ban" — the same string as "bán" (sell). When someone types the accent
     * they have already disambiguated, so their spelling is trusted; when they type "ban" bare,
     * which is common online, the folded list still catches the sell/need phrasing.
     */
    if (f === lower && STOP.has(f)) continue
    seen.add(f)
    out.push(f)
    if (out.length === 6) break
  }
  return out
}

// ── 3. RETRIEVE ─────────────────────────────────────────────────────────────
/**
 * Subcategories that actually carry rows, per category, measured 2026-09-21. jev picks one to
 * BOOST retrieval with.
 *
 * ⚠️ A BOOST, NEVER A FILTER, and the number says why: 46,264 of 65,085 electronics rows have a
 * NULL `subcategorySlug` — 71% of the catalogue. Filtering on it would silently discard most of
 * the inventory and look like "no stock". ⚠️ The placements that DO exist are also dirty: a
 * "Divoom Cyberbag Laptop Backpack" sits in `laptops-pcs`. So the boost raises the hit rate from
 * roughly 1-in-10 to 6-in-8, and stage 4 removes the rest — neither layer is load-bearing alone.
 */
const SUBS: Record<string, Record<string, string>> = {
  electronics: {
    'phones-tablets': 'a phone or tablet', 'laptops-pcs': 'a laptop, desktop PC or all-in-one',
    audio: 'headphones, speakers or audio gear', cameras: 'a camera or lens',
    'tv-monitors': 'a TV or monitor', smartwatch: 'a smartwatch or fitness band',
    'keyboards-mice': 'a keyboard or mouse', storage: 'a hard drive, SSD or memory card',
    'pc-components': 'an internal PC part — RAM, CPU, GPU, motherboard', gaming: 'a games console or gaming gear',
    printers: 'a printer or scanner', networking: 'a router, modem or network gear',
    'security-cameras': 'a security or IP camera', 'power-banks': 'a power bank',
    'cables-chargers': 'a cable or charger', 'phone-cases': 'a phone case',
    'screen-protectors': 'a screen protector', 'bags-sleeves': 'a laptop bag or sleeve',
    accessories: 'some other small accessory or stand',
  },
  'furniture-appliances': {
    'white-goods': 'a fridge, washing machine, air conditioner or other large appliance',
    'tables-desks': 'a table or desk', storage: 'a wardrobe, cabinet or shelving',
    'sofa-seating': 'a sofa or chair', kitchenware: 'kitchenware or a small kitchen appliance',
    'beds-mattresses': 'a bed or mattress', 'lighting-decor': 'lighting or decor',
    'household-supplies': 'household supplies',
  },
  sports: {
    sportswear: 'sports clothing', 'sports-shoes': 'sports or running shoes',
    'gym-yoga': 'gym or yoga equipment', swimming: 'swimming gear',
    'racket-ball': 'racket or ball sports equipment', 'outdoor-cycling': 'cycling or outdoor gear',
    'sports-accessories': 'a sports accessory', 'sports-nutrition': 'sports nutrition',
  },
  'fashion-beauty': {
    beauty: 'cosmetics or skincare', bags: 'a handbag or backpack', shoes: 'shoes',
    womens: "women's clothing", mens: "men's clothing", 'watches-jewelry': 'a watch or jewellery',
  },
  'baby-kids': {
    'kids-clothing': "children's clothing", 'kids-shoes': "children's shoes",
    'baby-gear': 'baby gear', toys: 'toys', 'strollers-seats': 'a stroller or car seat',
  },
  'books-stationery': {
    'languages-dictionaries': 'a language book or dictionary', literature: 'literature or fiction',
    'childrens-books': "a children's book", 'stationery-office': 'stationery or office supplies',
    'self-help-business': 'a self-help or business book', 'books-other': 'some other book',
  },
}

type Cand = { id: string; title: string; price: number; district: string | null; subcategorySlug: string | null }

/**
 * ⛔ ORDERED BY TRIGRAM SIMILARITY, NOT `rankScore`. The first build ordered by rankScore and
 * every single match scored 0.01-0.05 at stage 4 — with an OR-keyword filter, rankScore fills the
 * 20 slots with the most POPULAR rows that touched any keyword, so "cần mua laptop" returned
 * iPhone cases and a robot toy. The inventory was there the whole time (1,423 laptops under 12tr);
 * the ordering was the bug. `similarity()` uses the existing GIN trgm index on `searchText`.
 */
async function retrieve(kind: string, sub: string | null, kw: string[], budget: { min: number | null; max: number | null }) {
  const q = kw.join(' ')
  const conds = [
    Prisma.sql`l.verified AND l.status = 'active'`,
    /**
     * ⛔ EXCLUDE THE VISA/TRIP DESK — the legal boundary, since eno.vn is licensing as a VN company
     * that may not offer visa or itinerary services.
     *
     * ✅ MEASURED 2026-09-21, because BOTH commit reviewers called this line a licensing breach:
     * the desk's rows are `listingType = 'service'` (16 of them, all in category `services`), so
     * `= 'sell'` already excludes every one. The claim was that visa rows are ordinary `sell`
     * listings on a shared Seller — half right: shared Seller yes, `sell` no. `tickets-travel`
     * was flagged with it and is also clean: it holds VinWonders and Vinpearl park tickets, real
     * marketplace products. Re-measure this if the desk's listingType ever changes, because the
     * whole boundary rests on it:
     *   SELECT "listingType", count(*) FROM "Listing" WHERE verified AND status='active' GROUP BY 1;
     *
     * ⚠️ AND THE SELLER EXCLUSION BELOW IS THE BELT TO THIS BRACES. A reviewer's fair point: the
     * boundary above rests on a DATA fact, not on code, so the day the desk publishes one `sell`
     * row it would be drafted into a reply naming eno.vn. The desks are named sellers (Eno,
     * VietKite, GMBR — measured: they own every `service` row), so excluding them holds whatever
     * listingType they use.
     */
    Prisma.sql`l."listingType" = 'sell'`,
    Prisma.sql`s.name NOT IN (${Prisma.join(DESK_SELLERS)})`,
    Prisma.sql`l."sellerId" NOT IN (${Prisma.join(DESK_SELLER_IDS)})`,
    /**
     * ⛔ HO CHI MINH CITY ONLY — a correctness fix, not a preference. The intake reads HCMC groups,
     * and `draft()` tells the buyer the item is in "TP.HCM" whenever the district is null, which is
     * 79,292 of 79,629 rows. Without this filter the 263 Hà Nội listings would be offered to a
     * Saigon buyer with a false location in the message, under eno.vn's name. Filtering here makes
     * the sentence true rather than patching the sentence.
     */
    Prisma.sql`l.city ILIKE '%Minh%'`,
    Prisma.sql`c.slug = ${kind}`,
  ]
  if (budget.max) conds.push(Prisma.sql`l.price <= ${Math.round(budget.max)}`)
  if (budget.min) conds.push(Prisma.sql`l.price >= ${Math.round(budget.min * 0.6)}`)
  /**
   * ⚠️ OR ACROSS KEYWORDS, NOT AND. A demand post carries words the listing never repeats ("cũ",
   * "để học lập trình"); requiring all of them returns nothing. This clause is only the recall
   * floor and the index path — `similarity` does the ordering and jev does the precision.
   */
  if (kw.length) conds.push(Prisma.sql`(${Prisma.join(kw.map((w) => Prisma.sql`l."searchText" LIKE ${'%' + w + '%'}`), ' OR ')})`)

  const rows = async (extra: Prisma.Sql, take: number) => db.$queryRaw<Cand[]>`
    SELECT l.id, l.title, l.price, l.district, l."subcategorySlug"
    FROM "Listing" l JOIN "Category" c ON c.id = l."categoryId" JOIN "Seller" s ON s.id = l."sellerId"
    WHERE ${Prisma.join([...conds, extra], ' AND ')}
    ORDER BY similarity(l."searchText", ${q}) DESC
    LIMIT ${take}`

  // Tier A: inside the subcategory jev picked. Tier B: the rest of the category, to backfill —
  // it is where the 71% of rows with no placement live, so skipping it would hide most of the shop.
  const a = sub ? await rows(Prisma.sql`l."subcategorySlug" = ${sub}`, 10) : []
  const seen = new Set(a.map((r) => r.id))
  const b = await rows(a.length ? Prisma.sql`l.id NOT IN (${Prisma.join(a.map((r) => r.id))})` : Prisma.sql`TRUE`, 16 - a.length)
  /**
   * ⚠️ DEDUPE BY TITLE, NOT BY ID. An importer catalogue carries the same product many times over
   * (four identical "Under Armour Charged Assert 10 Running Shoes" rows filled the first queue),
   * and each duplicate costs a jev call AND a slot a genuinely different option could have taken.
   * Keeping the cheapest is what a buyer would pick anyway.
   */
  const byTitle = new Map<string, Cand>()
  for (const r of [...a, ...b.filter((r) => !seen.has(r.id))]) {
    const k = fold(r.title)
    const prev = byTitle.get(k)
    if (!prev || r.price < prev.price) byTitle.set(k, r)
  }
  return [...byTitle.values()]
}

// ── 5. DRAFT ────────────────────────────────────────────────────────────────
/**
 * ⚠️ THE CURRENCY ARG IS `'₫'`, NOT `'VND'`. `formatMoneyFull` only appends the " đ" suffix for
 * the symbol; passing the ISO code produces "VND6.200.000", which is the form vnd.ts reserves for
 * payment-provider line items. A Vietnamese reply wants the marketplace's own "6.200.000 đ".
 */
function draft(c: Cand): string {
  // Safe because `retrieve` filters to HCMC — see the city clause there before changing this.
  return `Chào bạn, trên eno.vn đang có "${c.title}" — ${formatMoneyFull(c.price, '₫', 'vi')}, ${c.district || 'TP.HCM'}. Bạn xem thử có phù hợp không nhé: https://eno.vn/listings/${c.id}`
}

const DEMO = [
  'Em cần mua laptop cũ tầm 10 triệu để học lập trình, khu vực Q7 ạ',
  'Chị em ơi cho hỏi chỗ nào sửa máy lạnh uy tín ở Bình Thạnh không?',
  'Bán gấp xe Vision 2020 còn mới 90%, ai cần inbox',
  'Tìm mua iPhone 13 Pro Max cũ khoảng 15tr, ưu tiên Gò Vấp',
  'Cần mua tủ lạnh nhỏ cho phòng trọ dưới 3 triệu, quận 10',
  'Tìm phòng trọ quận 3 dưới 5 triệu, có máy lạnh',
  'Ai có bán giày chạy bộ nam size 42 khoảng 1tr không ạ',
]

const DEMAND_FLOOR = 0.6 // below this the post is not a request
const MATCH_FLOOR = 0.5  // below this the listing does not answer the request
/**
 * ⛔ THE SPAM SCORE IS A GATE, NOT A DECORATION. Both commit reviewers caught this independently:
 * jev was asked "would replying here be useful rather than spam", the answer was stored in the
 * queue — and then only `satisfies` was filtered on, so a listing jev rated "do not reply" was
 * drafted anyway. In a file whose entire justification is that a human reviews before sending,
 * computing the restraint signal and ignoring it is the worst possible bug.
 */
const REPLY_FLOOR = 0.5

async function main() {
  const a = process.argv
  const inPath = a.includes('--in') ? a[a.indexOf('--in') + 1] : null
  const outPath = a.includes('--out') ? a[a.indexOf('--out') + 1] : 'data/demand-queue.json'

  db = (await import('../src/lib/db')).db

  const posts: string[] = inPath
    ? readFileSync(inPath, 'utf8').trim().split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l).text as string } catch { return l } })
        .map(stripPreamble)
    : DEMO
  console.log(`${posts.length} post(s) in\n`)

  const queue: unknown[] = []
  const tally = { skipped: 0, noInventory: 0, noCandidates: 0 }

  for (const post of posts) {
   try {
    // 1. TRIAGE
    const tri = await ask(`Facebook group post, Ho Chi Minh City: "${post}"`, {
      is_demand: { type: 'noul', instructions: 'Is the author LOOKING TO BUY, rent or hire? Answer no if they are SELLING something or just commenting.' },
      kind: { type: 'choice', instructions: 'What are they looking for?', criteria: KINDS },
    })
    if (!tri) continue
    const demand = tri.is_demand?.noul ?? 0
    const kind = tri.kind?.choice ?? 'none'

    if (demand < DEMAND_FLOOR || kind === 'none') {
      tally.skipped++
      console.log(`SKIP  ${demand.toFixed(2)} ${kind.padEnd(20)} ${post.slice(0, 56)}`)
      continue
    }
    if (NO_INVENTORY.has(kind)) {
      // ⚠️ Counted, not silently dropped — a large property bucket is the signal that the
      // catalogue is missing a category the market keeps asking for, which is worth more than
      // any individual match.
      tally.noInventory++
      console.log(`NOSTK ${demand.toFixed(2)} ${kind.padEnd(20)} ${post.slice(0, 56)}`)
      continue
    }

    // 2. PARSE   3. RETRIEVE
    const budget = parseBudgetVnd(post)
    const district = parseDistrict(post)
    const kw = keywords(post)
    // The second jev call: narrow to a subcategory so retrieval does not have to rank the whole
    // category. `any` is a real answer — most rows have no placement, and a forced guess is worse
    // than none (see SUBS).
    const subs = SUBS[kind]
    let sub: string | null = null
    if (subs) {
      const pick = await ask(`Ho Chi Minh City buyer's request: "${post}"`, {
        sub: { type: 'choice', instructions: 'Which best describes the item they want? Answer `any` if unsure or if it spans several.', criteria: { ...subs, any: 'unclear, or none of these fit' } },
      })
      const chosen = pick?.sub?.choice
      if (chosen && chosen !== 'any' && subs[chosen]) sub = chosen
    }
    const cands = await retrieve(kind, sub, kw, budget)
    console.log(`POST  ${demand.toFixed(2)} ${kind}/${sub ?? 'any'} <=${budget.max ? (budget.max / 1e6).toFixed(1) + 'tr' : '--'} ${(district ?? '--').padEnd(11)} kw=[${kw.join(' ')}] -> ${cands.length}`)
    console.log(`      ${post.slice(0, 76)}`)
    if (!cands.length) { tally.noCandidates++; console.log('      no candidates\n'); continue }

    // 4. RE-RANK
    const scored: { c: Cand; satisfies: number; reply: number }[] = []
    for (const c of cands.slice(0, 8)) {
      const ans = await ask(
        {
          buyer_request: post,
          candidate_listing: c.title,
          listing_price_vnd: c.price,
          // ⚠️ 79,292 of 79,629 live rows have a NULL district, so location is usually
          // unknowable. Saying "unknown" stops jev scoring the gap as a mismatch.
          listing_district: c.district ?? 'unknown (seller did not state one)',
          city: 'Ho Chi Minh City (both)',
        },
        {
          satisfies: { type: 'noul', instructions: "Would this listing genuinely satisfy the buyer's request? Weigh product type first, then budget. Ignore location if the district is unknown." },
          reply: { type: 'score', instructions: 'How confident are you that replying with this listing would be useful to the buyer rather than spam?', criteria: ['do not reply', 'maybe', 'reply'] },
        })
      if (!ans) continue
      scored.push({ c, satisfies: ans.satisfies?.noul ?? 0, reply: (ans.reply?.score ?? 0) / 2 })
    }
    scored.sort((x, y) => y.satisfies - x.satisfies)
    for (const s of scored.slice(0, 4)) {
      console.log(`   ${s.satisfies >= MATCH_FLOOR && s.reply >= REPLY_FLOOR ? 'OK' : '  '} sat=${s.satisfies.toFixed(2)} rep=${s.reply.toFixed(2)}  ${s.c.title.slice(0, 58)}  ${(s.c.price / 1e6).toFixed(1)}tr`)
    }
    console.log()

    const best = scored.filter((s) => s.satisfies >= MATCH_FLOOR && s.reply >= REPLY_FLOOR).slice(0, 3)
    if (best.length) {
      queue.push({
        post, demand, kind, budgetMax: budget.max, district,
        matches: best.map((s) => ({
          listingId: s.c.id, title: s.c.title, price: s.c.price,
          satisfies: s.satisfies, reply: s.reply, draftReply: draft(s.c),
        })),
      })
    }
   } catch (e) {
     // ⚠️ ONE BAD POST MUST NOT COST THE RUN. `ask` retries, but `retrieve` and the JSON parse
     // could still throw, and the queue is only written at the end — so a single failure on post
     // 300 discarded 299 good drafts.
     console.error(`  skipped a post: ${(e as Error).message.slice(0, 100)}`)
   }
  }

  mkdirSync('data', { recursive: true })
  writeFileSync(outPath, JSON.stringify(queue, null, 2))
  console.log(`${queue.length} queued · ${tally.skipped} not demand · ${tally.noInventory} no inventory (property) · ${tally.noCandidates} nothing matched`)
  console.log(`queue -> ${outPath}`)
  console.log('⛔ Nothing was posted. Read the drafts and send them yourself.')
  await db.$disconnect()
}

/**
 * ⚠️ GUARDED, because this module EXPORTS `parseBudgetVnd` and `keywords` for testing and a bare
 * `main()` at module scope ran the entire demo — 20-odd jev calls and a DB connection — the moment
 * anything imported it.
 */
if (process.argv[1]?.includes('demand-engine')) {
  main().catch(async (e) => { console.error(e); await db?.$disconnect(); process.exit(1) })
}
