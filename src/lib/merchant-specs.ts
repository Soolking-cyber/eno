/**
 * SPECS LIFTED FROM A MERCHANT PRODUCT PAGE, AND A DESCRIPTION COMPOSED FROM THEM.
 *
 * ⛔ FACTS ONLY — THIS DELIBERATELY DOES NOT REUSE THE MERCHANT'S PROSE. A product page carries two
 * very different things: an attribute table (brand, capacity, dimensions, weight — measurements,
 * which are facts) and marketing copy (which is the merchant's own writing). Only the first is read
 * here, and the sentences below are assembled by us from those values. Copying the second would be
 * republishing someone else's text, and it also reads worse: their copy sells THEIR shop.
 *
 * ⚠️ THE KEYS ARE VIETNAMESE AND THE VALUES USUALLY ARE NOT. Measured across sampled BỀN pages:
 * labels are Vietnamese ("Dung lượng", "Thương hiệu"), values are model numbers, units and proper
 * nouns ("1TB", "SATA III", "Lenovo", "Black") that are already language-neutral. So the bilingual
 * output translates the LABEL vocabulary from a fixed dictionary and passes values through
 * untouched — no machine translation of a spec sheet, which is where units and part numbers get
 * mangled.
 */

export type Spec = { key: string; value: string }

/**
 * ⚠️ Product pages arrive with entities un-decoded ("Ti&ecirc;u chuẩn"), and Vietnamese is mostly
 * what suffers. Numeric forms cover the rest.
 */
const ENTITIES: Record<string, string> = {
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', egrave: 'è', eacute: 'é', ecirc: 'ê',
  igrave: 'ì', iacute: 'í', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', yacute: 'ý', dstrok: 'đ', eth: 'đ',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê',
  Igrave: 'Ì', Iacute: 'Í', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô',
  Ugrave: 'Ù', Uacute: 'Ú', Yacute: 'Ý',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([A-Za-z]+);/g, (m, name) => ENTITIES[name] ?? m)
}

/**
 * ⛔ EVERY SAMPLED PAGE CARRIES A "Họ tên / Số điện thoại" ROW, AND IT IS A CONTACT FORM — the
 * name and phone fields of the "ask about this product" box, which sit in a <table> like everything
 * else. Five pages out of five. Without this it would have been written into every description as
 * though it were a specification.
 * ⚠️ The other exclusions are table headers ("Thông số / Chi tiết" = "Spec / Detail"), which label
 * the table rather than describing the product.
 */
const NOT_A_SPEC = /^(họ tên|số điện thoại|thông số|chi tiết|email|nội dung|tiêu đề)$/i

/** Rows whose value is a placeholder rather than a measurement. */
const EMPTY_VALUE = /^(-|--|n\/a|na|đang cập nhật|updating|\.|\s*)$/i

export function parseSpecs(html: string, limit = 12): Spec[] {
  const out: Spec[] = []
  const seen = new Set<string>()
  // ⚠️ `[\s\S]` RATHER THAN THE `s` FLAG — this repo's TS target predates dotAll, and `gis` fails
  // to compile (TS1501). The character class is the portable spelling of the same thing.
  const rows = html.matchAll(/<tr[^>]*>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)
  for (const m of rows) {
    const key = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    const value = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (!key || !value) continue
    if (key.length > 40 || value.length > 120) continue
    if (NOT_A_SPEC.test(key) || EMPTY_VALUE.test(value)) continue
    // ⚠️ CANONICAL, NOT RAW — see LABELS: a page listing both "Thương hiệu" and "Brand" states one
    // fact twice, and de-duplicating on the raw key kept both.
    const dedupe = canonicalKey(key)
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push({ key, value })
    if (out.length >= limit) break
  }
  return out
}

/** Gallery images, in page order, de-duplicated. */
export function parseGallery(html: string, host = 'cdn.ben.com.vn'): string[] {
  const re = new RegExp(`https://${host.replace(/\./g, '\\.')}/Content/Images/Products/[A-Za-z0-9._/-]+\\.(?:jpg|jpeg|png|webp)`, 'gi')
  return [...new Set(html.match(re) ?? [])]
}

/**
 * ONE CANONICAL LABEL PER FACT, WITH BOTH LANGUAGES AND THE SPELLINGS PAGES ACTUALLY USE.
 *
 * ⛔ A PAGE OFTEN CARRIES THE SAME FACT TWICE, ONCE PER LANGUAGE. The Lenovo backpack lists both
 * "Thương hiệu: Lenovo" and "Brand: Lenovo", so de-duplicating on the raw key kept both and the
 * description read "Brand: Lenovo · … · Brand: Lenovo". Collapsing to a canonical id is what makes
 * a fact appear once regardless of which spelling the merchant used.
 *
 * ⛔ AND THE LABELS ARE NOT ALL VIETNAMESE. The same page mixes "Màu sắc" with "Color", "Weight"
 * and "Packed Weight" — so a Vietnamese description built by passing keys through unchanged came
 * out half in English, which is not the second language anyone asked for. Both directions are
 * needed, which is why this is a table rather than a one-way dictionary.
 *
 * ⚠️ Values are still never translated: a part number or a unit run through a translator stops
 * being a part number.
 */
const LABELS: { en: string; vi: string; aliases: string[] }[] = [
  { en: 'Brand', vi: 'Thương hiệu', aliases: ['thương hiệu', 'hãng', 'brand'] },
  { en: 'Model', vi: 'Mẫu', aliases: ['model', 'mẫu', 'mã sản phẩm'] },
  { en: 'Capacity', vi: 'Dung lượng', aliases: ['dung lượng', 'capacity'] },
  { en: 'Memory', vi: 'Bộ nhớ', aliases: ['bộ nhớ', 'memory'] },
  { en: 'Storage', vi: 'Ổ cứng', aliases: ['ổ cứng', 'storage'] },
  { en: 'Drive type', vi: 'Loại ổ cứng', aliases: ['loại ổ cứng', 'drive type'] },
  { en: 'Colour', vi: 'Màu sắc', aliases: ['màu sắc', 'màu', 'color', 'colour'] },
  { en: 'Weight', vi: 'Trọng lượng', aliases: ['trọng lượng', 'weight'] },
  { en: 'Packed weight', vi: 'Trọng lượng đóng gói', aliases: ['packed weight', 'trọng lượng đóng gói'] },
  { en: 'Dimensions', vi: 'Kích thước', aliases: ['kích thước', 'dimensions', 'size', 'fits up to (l x d x h)'] },
  { en: 'Warranty', vi: 'Bảo hành', aliases: ['bảo hành', 'warranty', 'warranty type'] },
  { en: 'Interface', vi: 'Chuẩn cắm', aliases: ['chuẩn cắm', 'interface'] },
  { en: 'Spindle speed', vi: 'Tốc độ vòng quay', aliases: ['tốc độ vòng quay', 'spindle speed'] },
  { en: 'Technology', vi: 'Công nghệ', aliases: ['công nghệ', 'technology'] },
  { en: 'Battery', vi: 'Ắc quy', aliases: ['ắc quy', 'battery'] },
  { en: 'Quantity', vi: 'Số lượng', aliases: ['số lượng', 'quantity'] },
  { en: 'Operating system', vi: 'Hệ điều hành', aliases: ['hệ điều hành', 'operating system', 'os'] },
  { en: 'Compatible with', vi: 'Dùng cho', aliases: ['dùng cho', 'compatible with'] },
  { en: 'Origin', vi: 'Xuất xứ', aliases: ['xuất xứ', 'origin'] },
  { en: 'Material', vi: 'Chất liệu', aliases: ['chất liệu', 'material'] },
  { en: 'Controller', vi: 'Bộ điều khiển', aliases: ['bộ điều khiển', 'controller'] },
  { en: 'Part number', vi: 'Mã linh kiện', aliases: ['part number', 'p/n', 'mã linh kiện'] },
  { en: 'CPU', vi: 'CPU', aliases: ['cpu'] },
  { en: 'RAM', vi: 'RAM', aliases: ['ram'] },
  { en: 'Screen', vi: 'Màn hình', aliases: ['màn hình', 'screen', 'display'] },
]

const BY_ALIAS = new Map<string, { en: string; vi: string }>()
for (const l of LABELS) for (const a of l.aliases) BY_ALIAS.set(a, { en: l.en, vi: l.vi })

/**
 * A stable id for a fact, so the same fact written two ways collapses to one.
 * ⚠️ An unmapped label is its own id, and keeps its original wording in BOTH languages — honest,
 * because a spec we cannot name in the other language is better shown as the merchant wrote it than
 * dropped or guessed at.
 */
export function canonicalKey(key: string): string {
  return BY_ALIAS.get(key.trim().toLowerCase())?.en ?? key.trim().toLowerCase()
}

const label = (key: string, lang: 'en' | 'vi') => {
  const hit = BY_ALIAS.get(key.trim().toLowerCase())
  return hit ? hit[lang] : key
}

/**
 * A short factual description, in our own words, from the specs.
 *
 * ⚠️ THE SHAPE IS DELIBERATELY PLAIN: what it is, then the measurements, then who supplies it.
 * A listing description competes with the title directly above it, so anything that restates the
 * title is noise — the value here is the attributes a shopper would otherwise have to leave for.
 * ⚠️ It returns null rather than a stub when there is nothing factual to say. An invented sentence
 * is worse than the title alone, and the caller keeps whatever it already had.
 */
export function composeDescription(
  specs: Spec[],
  opts: { merchant: string; lang: 'en' | 'vi'; max?: number },
): string | null {
  const useful = specs.filter((s) => !/^(tên sản phẩm|product)$/i.test(s.key))
  if (useful.length === 0) return null
  const max = opts.max ?? 6
  const body = useful.slice(0, max).map((s) => `${label(s.key, opts.lang)}: ${s.value}`).join(' · ')
  const tail = opts.lang === 'vi'
    ? `Hàng mới, phân phối bởi ${opts.merchant}.`
    : `New, supplied by ${opts.merchant}.`
  return `${body}. ${tail}`
}
