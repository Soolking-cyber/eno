// ── A FURNITURE LISTING'S MATERIAL, READ FROM ITS TITLE ─────────────────────────────────────────
//
// The `material` facet (taxonomy.ts, furniture-appliances: sofa-seating, tables-desks, beds-mattresses,
// storage) drives the furniture chips in the Filter panel AND the key of the furniture fallback price
// band (price-fallback.ts FALLBACK_FACET). Human posts carry it — the wizard requires it — but the
// imported stock did not: measured 2026-10-05, 3,111 of the 3,202 live used furniture rows were ONE
// import shop's (Bàn Ghế Thanh Lý, scripts/import-partners.ts), which writes no attributes, so
// `material` was set on 1 row. Their titles already name it — "Giường Gỗ…", "Ghế Sofa Bọc Nỉ…",
// "Kệ Sắt…". Owner, 2026-10-05: read the material from furniture titles (and keep the band's
// 3-seller rule, which is price-fallback.ts's business, not this module's).
//
// ⛔ A WRONG MATERIAL IS WORSE THAN NONE. It files a sofa under the wrong chip and prices it against
// the wrong kind of furniture, while a missing one only leaves the listing where it already was. So
// every rule here errs towards null:
//   · ONLY THE TAXONOMY'S OWN VALUES come out (facetsFor('furniture-appliances', shelf)), never an
//     invented one, and only on a shelf that offers the facet.
//   · ONLY A MATERIAL THE TITLE NAMES — never one inferred from the kind of item ("a sofa is fabric").
//     "Bọc nệm" / "upholstered" names a padding, not a cover material, and reads as nothing.
//   · TWO DIFFERENT MATERIALS → null ("Bàn Mặt Gỗ Chân Sắt", "Tủ Nhôm Kính"): the taxonomy has no
//     combined option, and which part "is" the item is a guess. A material OUTSIDE the taxonomy
//     (plastic, stone, mesh, latex…) counts as a second material — "Ghế Nhựa Chân Sắt" is a plastic
//     chair, and calling it metal would be wrong.
//   · A material word used for something else is NOT a mention — wood GRAIN ("vân gỗ", 252 rows: a
//     print on MDF or a painted steel cabinet), a DIAMETER ("đường kính"), a CLOUD pattern ("vân mây",
//     "đám mây"), an imitation ("giả gỗ"), a skin COLOUR ("màu da"). The longest phrase wins, so
//     "gỗ cao su" (rubberwood) beats "cao su" (latex), "hương đá" (a rosewood) beats "đá" (stone),
//     "giả da" (faux leather, still Fabric/Leather) beats "da".
//   · WHOLE WORDS WITH THEIR DIACRITICS. Vietnamese words are syllables, and the marks are the word:
//     "mây" is rattan and "máy" a machine ("bàn máy tính" is a computer desk), "tre" is bamboo and
//     "trẻ" a child ("giường tầng trẻ em"), "da" is leather and "đa" many ("tủ đa năng"), "kính" glass
//     and "kinh" business. Nothing is folded: an unaccented "ban go" names no material at all.
//   · THREE SYLLABLES ARE TRUSTED ONLY IN ACCENTED VIETNAMESE: "da", "tre", "nhung" carry no mark, so
//     in a title typed without diacritics they are just as likely "đã" ("ban go da qua su dung" — used),
//     "trẻ" or "những". They count only when the title carries Vietnamese diacritics elsewhere.
//   · A PART'S OR AN ACCESSORY'S MATERIAL IS NOT THE ITEM'S (see PARTS AND ACCESSORIES below): iron legs
//     under an unnamed top, glass doors on a filing cabinet, the glass table sold with a sofa.
//   · A COLOUR NAMED AFTER WOOD IS NOT WOOD: "màu nâu gỗ" is wood-brown; "gỗ nâu" is brown wood.
//
// MEASURED on the 3,236 live (active|sold) verified imported rows of the four shelves, 2026-10-05, every
// outcome read by hand in samples and a 220-row sample refuted by an independent reviewer (its 13 catches —
// colour names, glass shelves, tops and seats, cast bases, a set's upholstery — are the rules above and
// below): 1,311 get a material (wood 824, fabric 293, metal 157, glass 35, rattan-bamboo 2) and the rest stay
// empty — 1,158 name none, 377 name two, 158 name one outside the taxonomy, 232 name only a part's.
// scripts/backfill-furniture-material.ts prints the per-shelf table.
//
// Pure and import-light (taxonomy + the importer's live-row rule): the partner importer, the backfill and
// their tests share it.

import { liveRowsOnly } from './partner-import-rules'
import { facetsFor } from './taxonomy'

/** The category whose shelves carry the `material` facet. */
export const MATERIAL_CATEGORY = 'furniture-appliances'
/** The facet key, as the taxonomy, the feed's `attr_material` filter and the fallback band name it. */
export const MATERIAL_FACET = 'material'

/** A phrase naming a material the taxonomy has no option for — it makes a title's answer null. */
const OTHER = '#other'
/** A phrase that USES a material word for something else (a grain, a colour, a diameter) — not a mention. */
const NOT_MATERIAL = '#not-material'

/** English names a LOOK with a material word in front: "oak colour", "wood grain", "marble effect",
 *  "chrome finish" — a print, a paint or a plating, not what the piece is made of. Every pair is a
 *  NOT_MATERIAL phrase. */
const EN_LOOK_MATERIALS = ['wood', 'wooden', 'oak', 'walnut', 'teak', 'pine', 'mahogany', 'rosewood', 'acacia', 'beech', 'birch',
  'marble', 'stone', 'leather', 'rattan', 'bamboo', 'metal', 'steel', 'iron', 'chrome', 'brass', 'glass']
const EN_LOOK_WORDS = ['grain', 'grained', 'color', 'colour', 'colored', 'coloured', 'look', 'effect', 'pattern', 'print',
  'tone', 'toned', 'finish', 'style', 'texture']
const EN_LOOKS = EN_LOOK_MATERIALS.flatMap((m) => EN_LOOK_WORDS.map((w) => `${m} ${w}`))

/**
 * What each phrase says. Lower-case, NFC, words separated by one space — the shape `words()` reduces a
 * title to, so a phrase matches only as whole words, in order, with its diacritics.
 * Keys other than OTHER and NOT_MATERIAL MUST be values of the taxonomy's material facet (the test holds it).
 */
const LEXICON: Readonly<Record<string, readonly string[]>> = {
  wood: [
    'gỗ', 'ván ép', 'mdf', 'mfc', 'hdf',
    'gỗ cao su', // rubberwood — the longer phrase beats 'cao su' (latex) below
    'hương đá', // "gỗ hương đá", a rosewood — beats 'đá' (stone)
    'wood', 'wooden', 'solid wood', 'hardwood', 'plywood', 'rubberwood', 'rubber wood', 'particleboard', 'chipboard',
    'oak', 'walnut', 'teak', 'pine', 'mahogany', 'rosewood', 'acacia', 'beech', 'birch',
  ],
  // The option is "Fabric/Leather" (Vải / Da): leather and leatherette are this value, not another.
  fabric: [
    'vải', 'nỉ', 'da', 'nhung', 'simili', 'giả da', 'lụa',
    'fabric', 'cloth', 'leather', 'leatherette', 'faux leather', 'imitation leather', 'artificial leather', 'pu leather',
    'velvet', 'suede', 'felt', 'linen', 'cotton', 'canvas', 'microfiber', 'microfibre', 'chenille', 'boucle', 'bouclé',
  ],
  metal: [
    'sắt', 'thép', 'inox', 'nhôm', 'kim loại', 'hợp kim', 'gang', // gang: cast iron ("đế gang")
    'metal', 'iron', 'steel', 'stainless', 'stainless steel', 'aluminium', 'aluminum', 'alloy', 'chrome', 'chromed', 'brass',
  ],
  glass: ['kính', 'thủy tinh', 'thuỷ tinh', 'glass'],
  'rattan-bamboo': ['mây', 'tre', 'trúc', 'rattan', 'bamboo'],
  [OTHER]: [
    'nhựa', 'đá', 'đá mây', 'cẩm thạch', 'hoa cương', 'gốm', 'sứ', 'composite', 'mica', 'acrylic', 'pvc',
    'xi măng', 'bê tông', 'cao su', 'lưới', 'mút', 'lò xo', 'cói', 'lục bình',
    'đúc', // cast — iron, aluminium or moulded plastic ("chân đúc", "nhựa đúc"): a second material, never an answer
    'gỗ nhựa', // wood-plastic composite
    'mây nhựa', 'giả mây', 'mây giả', 'giả đá', // synthetic rattan, faux stone — plastic, whatever they imitate
    'sợi thủy tinh', 'sợi thuỷ tinh', // fibreglass
    'plastic', 'stone', 'marble', 'granite', 'ceramic', 'porcelain', 'resin', 'mesh', 'foam', 'latex', 'rubber',
    'concrete', 'cement', 'quartz', 'terrazzo', 'fiberglass', 'fibreglass', 'fiber glass', 'fibre glass',
    'plexiglass', 'plexiglas', 'wpc', 'synthetic rattan', 'plastic rattan', 'faux rattan', 'imitation rattan',
    'pe rattan', 'poly rattan', 'resin rattan', 'faux stone', 'faux marble', 'imitation marble',
  ],
  [NOT_MATERIAL]: [
    'vân gỗ', 'vâ gỗ', 'màu gỗ', 'giả gỗ', // a wood GRAIN (and its measured typo), a wood COLOUR, an imitation — the item may be MDF, plastic or steel
    'vân đá', 'vân đá mây', 'đính đá', // a stone pattern (a cloud-veined one), studded rhinestones
    'vân mây', 'đám mây', 'dáng mây', // "mây" is also a cloud: a cloud-veined marble, a cloud shape
    'đường kính', 'mắt kính', 'kính mát', 'kính râm', // a diameter; eyeglasses and sunglasses (what a display case holds)
    'màu da', 'màu kim loại', 'hoa sứ', // skin colour, metallic colour, a frangipani print
    'kiến trúc', 'cấu trúc', // architecture, structure — not bamboo
    ...EN_LOOKS, 'woodgrain', 'faux wood', 'imitation wood', 'fake wood', 'artificial wood',
    'skin color', 'skin colour', 'iron grey', 'iron gray', 'steel grey', 'steel gray', 'steel blue',
  ],
}

/** Unmarked syllables that are also other Vietnamese words once the diacritics are dropped (see the header):
 *  unaccented "gang" is as likely "găng" (a glove) or a hand-span. */
const ACCENTED_ONLY: ReadonlySet<string> = new Set(['da', 'tre', 'nhung', 'gang'])

/** A letter only Vietnamese spelling carries — the title is written WITH its diacritics. */
const VI_MARKED = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/u

// ── PARTS AND ACCESSORIES ────────────────────────────────────────────────────────────────────────
// A material named for a PART of the item, or for something sold WITH it, is not the item's material:
// measured on the 2026-10-05 rows, "Bộ Sofa Cũ Kèm Đôn Và Bàn Kính" (a sofa set WITH a glass table),
// "Tủ Locker 2 Cánh Kính" (a steel locker with glass doors), "Bàn Làm Việc Chân Sắt" (a desk on iron
// legs — its top unnamed), "Ghế Nail … Có Hộc Tủ Gỗ" (a nail chair with a wooden cabinet) each read as
// the part's material. Such a mention still COUNTS as a second material (a wooden wardrobe with glass
// doors is two materials, so null), but it can never be the answer on its own.

/** After one of these, the title describes what comes WITH the item or what it HAS — every material from
 *  here on is a part's. '+' and '&' are kept as words by `words()` for this ('+' after a number is "or
 *  more": "20+ mẫu"). Not English "and": it joins adjectives far more often than items ("Durable and
 *  Beautiful Wooden Bed"). */
const ACCESSORY_MARKERS: ReadonlySet<string> = new Set(['kèm', 'có', 'và', 'với', 'cùng', 'gồm', 'tặng', 'with', 'plus', 'including', '+', '&'])
/** …except where the title names the item's OWN make after one: "giường với CHẤT LIỆU gỗ" (a bed made of
 *  wood), and in English "bed with a wooden FRAME", "chair with leather UPHOLSTERY", "table with a glass TOP". */
const EN_OWN_NOUNS: ReadonlySet<string> = new Set(['frame', 'frames', 'upholstery', 'upholstered', 'top', 'tops', 'body', 'construction', 'structure'])

/** Vietnamese names the part BEFORE its material: "chân sắt" (iron legs), "tay vịn gỗ", "đệm da". Measured
 *  against the rows, and kept OUT: `khung` (a bed's frame is the bed), `ngăn` ("tủ locker 18 ngăn sắt" is a
 *  steel locker), `nan` ("giường nan gỗ" is a wooden bed), `lưng` ("ngả lưng" is to recline: "ghế thư giãn
 *  ngả lưng bọc nỉ"). `mặt` (a top, a seat, a face) has its own rule — see namesAPart. */
const VI_PART_NOUNS: ReadonlySet<string> = new Set(['chân', 'vách', 'tay', 'vịn', 'nắm', 'đệm', 'nệm', 'viền'])
/** Doors and compartments are a part only when they are GLASS: "tủ 3 cánh gỗ" is a three-door WOODEN
 *  wardrobe, while "tủ hồ sơ 2 cánh kính" is a filing cabinet (or a steel locker) with glass doors and
 *  "tủ trưng bày … ngăn kính" a display cabinet with glass shelves — its body unnamed. */
const VI_GLASS_PART_NOUNS: ReadonlySet<string> = new Set(['cánh', 'cửa', 'ngăn'])
/** Two-word parts, keyed by their pair: a headboard, wheels, a partition. ("giường" alone is the bed.) */
const VI_PART_PAIRS: ReadonlySet<string> = new Set(['đầu giường', 'bánh xe', 'vách ngăn'])
/** "tủ / kệ / bàn / hộc đầu giường" is a nightstand — a whole piece, not a bed's headboard. */
const VI_BEDSIDE_PIECES: ReadonlySet<string> = new Set(['tủ', 'kệ', 'bàn', 'hộc'])
/** Words that may stand between a part and its material: "đầu giường BỌC da", "cửa BẰNG kính", "cửa LÙA kính",
 *  "mặt NAN gỗ" (a slatted face). Only ever skipped on the way back to a part noun or to `mặt`. */
const VI_PART_LINKS: ReadonlySet<string> = new Set(['bọc', 'bằng', 'lùa', 'nan'])
/** The nouns a title names its item with; the FIRST one is the item ("Bộ Sofa … Kèm Bàn Kính" is a sofa).
 *  Not "giá" (a rack, but far more often a price: "giá rẻ"). */
const VI_ITEM_NOUNS: ReadonlySet<string> = new Set(['bàn', 'ghế', 'sofa', 'salon', 'đôn', 'băng', 'tủ', 'kệ', 'quầy', 'giường', 'nệm', 'đệm', 'phản', 'sập', 'xe'])
/** Counts that introduce a dining set's chairs: "bộ bàn ăn 4 ghế bọc da" (see chairsOfATable). */
const VI_COUNT_WORDS: ReadonlySet<string> = new Set(['hai', 'ba', 'bốn', 'sáu', 'tám', 'mười'])
/** A colour word in front of "gỗ" makes a COLOUR NAME — "màu nâu gỗ" is wood-brown, "vàng gỗ" wood-yellow —
 *  where "gỗ nâu" (wood, brown) names the material: the head of a Vietnamese phrase comes first. */
const VI_COLOUR_WORDS: ReadonlySet<string> = new Set(['nâu', 'vàng', 'đỏ', 'trắng', 'đen', 'xám', 'kem', 'hồng', 'xanh', 'cam', 'tím', 'be', 'bạc', 'ghi', 'đậm', 'nhạt', 'sẫm'])
/** …unless what follows "gỗ" says which wood: "màu trắng gỗ công nghiệp", "màu nâu gỗ xoan đào" name it. */
const VI_WOOD_QUALIFIERS: ReadonlySet<string> = new Set([
  'công', 'tự', 'thật', 'nguyên', 'mộc', 'ép', 'ghép', 'mdf', 'mfc', 'hdf', 'xoan', 'xoăn', 'sồi', 'tràm', 'thông', 'hương', 'gõ',
  'óc', 'căm', 'cẩm', 'lim', 'me', 'keo', 'sưa', 'trắc', 'mun', 'dầu', 'tre',
])
/** English names the part AFTER its material: "metal legs", "glass doors", "leather cushion". (Not
 *  "shelf": a "steel shelf" is the item.) */
const EN_PART_NOUNS: ReadonlySet<string> = new Set([
  'leg', 'legs', 'foot', 'feet', 'base', 'door', 'doors', 'arm', 'arms', 'armrest', 'armrests', 'handle', 'handles',
  'cushion', 'cushions', 'pad', 'pads', 'headboard', 'backrest', 'partition', 'trim', 'wheel', 'wheels',
])

type Entry = { words: readonly string[]; reading: string; accentedOnly: boolean }

/** Longest first — by words, then by letters — so the most specific phrase claims its words before
 *  a shorter one inside it can ("giả da" before "da", "gỗ cao su" before "cao su"). */
const ENTRIES: readonly Entry[] = Object.entries(LEXICON)
  .flatMap(([reading, phrases]) => phrases.map((p) => ({ words: p.split(' '), reading, accentedOnly: ACCENTED_ONLY.has(p) })))
  .sort((a, b) => b.words.length - a.words.length || b.words.join(' ').length - a.words.join(' ').length)

/** The title as whole words: NFC (decomposed Vietnamese composes), lower-case, split on anything that is
 *  not a letter, a combining mark or a digit — so "Gỗ/Sắt", "wood-grain" and "Gỗ," all split cleanly —
 *  except '+' and '&', which are kept as words (ACCESSORY_MARKERS). */
function words(text: string): string[] {
  return (
    text
      .normalize('NFC')
      .toLowerCase()
      // The Icelandic eth (Ð/ð) stands in for đ in some keyboard layouts.
      .replace(/ð/g, 'đ')
      .match(/[\p{L}\p{M}\p{N}]+|[+&]/gu) ?? []
  )
}

/**
 * Where a table listing's CHAIRS begin, or -1 — for UPHOLSTERY only. A table is not upholstered: in "Bộ
 * Bàn Ăn 1M4 Cũ 4 Ghế Bọc Da" the leather is the chairs', and in "Bộ Bàn Ghế Cà Phê Bọc Nỉ" the felt is,
 * while the table's own material is unnamed. So a fabric named after a "ghế" that follows a "bàn" is a
 * part. Wood, metal or glass there is left alone: "Bộ Bàn Ăn 6 Ghế Gỗ Tràm" is an acacia dining SET, and
 * measured, treating it as the chairs' cost 17 such sets for nothing.
 */
function chairsOfATable(ws: readonly string[]): number {
  const table = ws.indexOf('bàn')
  if (table < 0) return -1
  for (let g = table + 1; g < ws.length; g++) {
    if (ws[g] !== 'ghế') continue
    const before = ws[g - 1]
    return /^\d+$/.test(before) || VI_COUNT_WORDS.has(before) ? g - 1 : g
  }
  return -1
}

/** What a title's own structure says about its parts — computed once per title (see namesAPart). */
type TitleShape = {
  ws: readonly string[]
  /** Where the accessories begin (ACCESSORY_MARKERS), or the title's length. */
  accessoryFrom: number
  /** Where a table's chairs begin, or -1 (chairsOfATable). */
  chairsFrom: number
  /** The first VI_ITEM_NOUNS word — what the title is selling. */
  item: string | null
  /** A TABLE described as a top plus a support ("bàn … mặt gỗ … chân chữ U", "bàn … mặt vân gỗ … khung sắt"). */
  twoPartTable: boolean
}

function titleShape(ws: readonly string[]): TitleShape {
  const marker = ws.findIndex((w, k) => ACCESSORY_MARKERS.has(w) && !(w === '+' && /^\d+$/.test(ws[k - 1] ?? '')))
  const item = ws.find((w) => VI_ITEM_NOUNS.has(w)) ?? null
  return {
    ws,
    accessoryFrom: marker < 0 ? ws.length : marker,
    chairsFrom: chairsOfATable(ws),
    item,
    twoPartTable: item === 'bàn' && ws.includes('mặt') && (ws.includes('chân') || ws.includes('khung')),
  }
}

/** Whether the material phrase at words [i, i+n), reading `reading`, belongs to a part — see PARTS AND
 *  ACCESSORIES above. */
function namesAPart(t: TitleShape, i: number, n: number, reading: string): boolean {
  const { ws } = t
  if (i >= t.accessoryFrom) return !(EN_OWN_NOUNS.has(ws[i + n] ?? '') || (ws[i - 2] === 'chất' && ws[i - 1] === 'liệu'))
  if (reading === 'fabric' && t.chairsFrom >= 0 && i >= t.chairsFrom) return true
  let j = i - 1
  while (j >= 0 && VI_PART_LINKS.has(ws[j])) j--
  /**
   * `mặt` — a top, a seat, a face. A TABLE's top is the table ("bàn sofa mặt kính" is a glass coffee table),
   * unless the title also describes the table's support, which leaves the support's material unnamed ("bàn
   * làm việc mặt gỗ chân chữ U": a wood top on a U-frame). On anything else it is a part: a stool's seat
   * ("ghế đôn mặt gỗ"), a counter's or a TV stand's top ("quầy … mặt kính"), a glass-faced door ("cánh mặt kính").
   */
  if (j >= 0 && ws[j] === 'mặt') {
    if (j >= 1 && VI_GLASS_PART_NOUNS.has(ws[j - 1])) return reading === 'glass'
    return t.item !== 'bàn' || t.twoPartTable
  }
  // A table's frame, when the title also describes its top: "bàn họp mặt vân gỗ … khung sắt" (a wood-grain top
  // on an iron frame) is two parts, and only one of them is named.
  if (j >= 0 && ws[j] === 'khung') return t.twoPartTable
  if (j >= 0 && VI_PART_NOUNS.has(ws[j])) {
    // "bọc nệm da" / "bọc đệm da" is the item's own upholstery (padded leather), not a cushion on it.
    return !((ws[j] === 'nệm' || ws[j] === 'đệm') && ws[j - 1] === 'bọc')
  }
  // Metal legs keep their shape word: "chân TRỤ inox" (a pedestal), "chân TRÒN sắt". Metal only, and only
  // right after it: in "ghế chân quỳ bọc da" (a sled-base chair) the leather is the chair's.
  if (reading === 'metal' && j === i - 1 && j >= 1 && ws[j - 1] === 'chân') return true
  if (j >= 0 && VI_GLASS_PART_NOUNS.has(ws[j])) return reading === 'glass'
  if (j >= 1 && VI_PART_PAIRS.has(`${ws[j - 1]} ${ws[j]}`)) {
    // …except a whole piece NAMED for where it stands: "tủ đầu giường" is a nightstand, and its wood is its own.
    return !(ws[j] === 'giường' && VI_BEDSIDE_PIECES.has(ws[j - 2]))
  }
  return i + n < ws.length && EN_PART_NOUNS.has(ws[i + n])
}

/** "nâu gỗ", "vàng gỗ" — a colour named after wood, not wood (VI_COLOUR_WORDS). Only the bare "gỗ": a
 *  longer wood phrase ("gỗ cao su") or a qualifier after it ("gỗ công nghiệp") names the material. */
function isWoodColourName(ws: readonly string[], i: number, phrase: string): boolean {
  return phrase === 'gỗ' && i >= 1 && VI_COLOUR_WORDS.has(ws[i - 1]) && !VI_WOOD_QUALIFIERS.has(ws[i + 1] ?? '')
}

/** One material phrase in a title: what it says, and whether it names the item or only a part of it. */
export type MaterialMention = { phrase: string; reading: string; part: boolean }

/** Every material phrase the title names, in title order, after the longer phrases have claimed their
 *  words. NOT_MATERIAL phrases are consumed and left out. */
export function materialMentions(title: string | null | undefined): MaterialMention[] {
  const ws = words(title ?? '')
  if (!ws.length) return []
  const accented = VI_MARKED.test(ws.join(' '))
  const shape = titleShape(ws)
  const taken: boolean[] = ws.map(() => false)
  const found: (MaterialMention & { at: number })[] = []
  for (const e of ENTRIES) {
    if (e.accentedOnly && !accented) continue
    const n = e.words.length
    for (let i = 0; i + n <= ws.length; i++) {
      let hit = true
      for (let j = 0; j < n && hit; j++) hit = !taken[i + j] && ws[i + j] === e.words[j]
      if (!hit) continue
      for (let j = 0; j < n; j++) taken[i + j] = true
      const phrase = e.words.join(' ')
      if (e.reading !== NOT_MATERIAL && !isWoodColourName(ws, i, phrase)) {
        found.push({ at: i, phrase, reading: e.reading, part: namesAPart(shape, i, n, e.reading) })
      }
      i += n - 1
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ phrase, reading, part }) => ({ phrase, reading, part }))
}

/** The taxonomy's material values on this furniture shelf — empty when the shelf has no material facet. */
export function materialOptions(subcategorySlug: string | null | undefined): readonly string[] {
  const sub = (subcategorySlug ?? '').trim()
  if (!sub) return []
  const facet = facetsFor(MATERIAL_CATEGORY, sub).find((f) => f.key === MATERIAL_FACET)
  return facet ? facet.options.map((o) => o.value) : []
}

/** Why a title has the material it has — or why it has none. */
export type MaterialReading =
  | { value: string; why: 'named' }
  | { value: null; why: 'none-named' | 'two-materials' | 'outside-taxonomy' | 'only-a-part' | 'not-offered' }

/** materialFromTitle with its reason, for a report that has to say why a row stayed empty. */
export function readMaterial(title: string | null | undefined, subcategorySlug: string | null | undefined): MaterialReading {
  const mentions = materialMentions(title)
  const named = new Set(mentions.map((m) => m.reading))
  if (!named.size) return { value: null, why: 'none-named' }
  // Parts count here: a wooden wardrobe with glass doors names two materials.
  if (named.size > 1) return { value: null, why: 'two-materials' }
  const [only] = named
  if (only === OTHER) return { value: null, why: 'outside-taxonomy' }
  // …but a part alone never names the item: a desk on iron legs has a top of something unnamed.
  if (mentions.every((m) => m.part)) return { value: null, why: 'only-a-part' }
  return materialOptions(subcategorySlug).includes(only) ? { value: only, why: 'named' } : { value: null, why: 'not-offered' }
}

/**
 * The material a FURNITURE title names — one of the taxonomy's own `material` values for that
 * furniture-appliances shelf — or null when it names none, names two, names one the taxonomy has no
 * option for, or the shelf has no material facet. `subcategory` is a furniture-appliances slug: the
 * caller checks the category (electronics has a `storage` shelf too).
 */
export function materialFromTitle(title: string | null | undefined, subcategory: string | null | undefined): string | null {
  return readMaterial(title, subcategory).value
}

/**
 * The title that is the seller's or merchant's OWN WORDS. An imported row keeps the merchant's original
 * in `titleVi` and an English translation in `title` (schema.prisma, Listing.descriptionVi); a human post
 * has `title` only. The translation is never read: it is derived from the same words and adds only its
 * errors — measured, the MT turned "Bàn Phòng Ăn Vân Mây" (a cloud-veined table) into "Rattan Dining Table".
 */
export function ownWordsTitle(row: { title: string | null | undefined; titleVi?: string | null }): string {
  const vi = (row.titleVi ?? '').trim()
  return vi || (row.title ?? '')
}

/** What a listing's attributes become once its title's material is read. */
export type TitleMaterialDecision =
  | { write: true; material: string; attributes: string }
  | { write: false; why: 'not-a-material-shelf' | 'has-material' | 'unreadable-attributes' | Exclude<MaterialReading['why'], 'named'> }

/**
 * ⛔ FILLS, NEVER OVERWRITES. The decision for one listing:
 *  · only a furniture-appliances shelf that offers the material facet;
 *  · a row whose attributes already carry a `material` key keeps it, whatever it says — a seller's own
 *    answer (or a moderator's) outranks a reading of the title;
 *  · stored attributes that are not a JSON object are not ours to repair, and are left alone;
 *  · otherwise the title's material, added beside the attributes already there.
 * The result is JSON.stringify'd, so it stores `"material":"wood"` — the exact needle the feed's
 * `attr_material` filter and chip counts match (attr-match.ts) and the fallback band's pattern reads
 * (price-fallback.ts facetValuePattern).
 */
export function decideTitleMaterial(input: {
  categorySlug: string | null | undefined
  subcategorySlug: string | null | undefined
  /** `Listing.attributes` as stored — the JSON text, or null. */
  attributes: string | null | undefined
  /** The seller's own words — see ownWordsTitle(). */
  title: string | null | undefined
}): TitleMaterialDecision {
  if ((input.categorySlug ?? '').trim() !== MATERIAL_CATEGORY || !materialOptions(input.subcategorySlug).length) {
    return { write: false, why: 'not-a-material-shelf' }
  }
  let bag: Record<string, unknown> = {}
  const raw = (input.attributes ?? '').trim()
  if (raw) {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return { write: false, why: 'unreadable-attributes' } }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { write: false, why: 'unreadable-attributes' }
    bag = parsed as Record<string, unknown>
  }
  if (Object.prototype.hasOwnProperty.call(bag, MATERIAL_FACET)) return { write: false, why: 'has-material' }
  const reading = readMaterial(input.title, input.subcategorySlug)
  if (reading.value === null) return { write: false, why: reading.why }
  return { write: true, material: reading.value, attributes: JSON.stringify({ ...bag, [MATERIAL_FACET]: reading.value }) }
}

/** decideTitleMaterial's new attributes JSON, or null when nothing is to be written. */
export function attributesWithTitleMaterial(input: Parameters<typeof decideTitleMaterial>[0]): string | null {
  const d = decideTitleMaterial(input)
  return d.write ? d.attributes : null
}

/**
 * THE IMPORTER'S REFRESH-SIDE WRITE — the material and the `updateMany` arguments that fill it, or null
 * when there is nothing to fill. A compare-and-set: it lands only while the row is still live
 * (active|sold, the refresh's own rule — partner-import-rules.ts) AND its attributes are still exactly
 * what the importer read, so a material a seller, a moderator or another pass wrote in between is never
 * overwritten, and a row hidden in between is not touched.
 */
export function titleMaterialFill(
  row: { id: string; attributes: string | null; categorySlug: string | null | undefined; subcategorySlug: string | null | undefined },
  title: string | null | undefined,
): { material: string; update: { where: { id: string; status: { in: string[] }; subcategorySlug: string; attributes: string | null }; data: { attributes: string } } } | null {
  const d = decideTitleMaterial({ categorySlug: row.categorySlug, subcategorySlug: row.subcategorySlug, attributes: row.attributes, title })
  if (!d.write || !row.subcategorySlug) return null
  // The shelf too: the material was decided for it, and a row re-filed in between is not this decision's.
  return { material: d.material, update: { where: { id: row.id, ...liveRowsOnly(), subcategorySlug: row.subcategorySlug, attributes: row.attributes }, data: { attributes: d.attributes } } }
}

/** For the tests that hold the lexicon to the taxonomy (every value one of its options) and to itself
 *  (no phrase under two readings). */
export const LEXICON_VALUES: readonly string[] = Object.keys(LEXICON).filter((k) => k !== OTHER && k !== NOT_MATERIAL)
export const LEXICON_PHRASES: readonly string[] = Object.values(LEXICON).flat()
