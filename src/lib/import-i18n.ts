/**
 * THE ENGLISH TEXT OF AN IMPORTED LISTING IS ENGLISH, AND THE VIETNAMESE TEXT IS VIETNAMESE.
 *
 * The property importers (nhatot-listing.ts, honeycomb-listing.ts, scripts/muaban-net-map.ts) compose
 * both languages from templates, and each template drops a SOURCE value into the other language's
 * text: the English title ends "— P. Tân Hòa mới, Quận Tân Bình", the English facts say
 * "Ward: Phường Tân Hòa" and "Location: Phường 22, Quận Bình Thạnh, Hồ Chí Minh", muaban's English
 * rent reads "2.500.000 đ/month", and Honeycomb's Vietnamese block says "Đường: Song Hanh Street".
 * English is a translation TARGET on this site (CLAUDE.md, i18n), not the source language.
 *
 * ⛔ THIS RUNS INSIDE EACH IMPORTER'S COMPOSE STEP, NOT AS A DATABASE REWRITE ALONE. All three
 * importers treat title / titleVi / description / descriptionVi as REFRESHABLE (nhatot MUTABLE_KEYS,
 * honeycomb mutableOf, muaban sameMutable), so a row fixed only in the database would be reverted by
 * the next refresh. The mappers call `localizeImportText` on what they compose, before the
 * unchanged-row comparison and before `searchText` is folded; scripts/localize-import-listings.ts
 * applies the same function once to rows already stored. The Batdongsan and Rever importers refresh
 * their text too (`update: mutable`), with a template of their own: `localizeReferenceImportText`
 * (below) runs inside their compose(), and the one-off picks it for those two sellers.
 *
 * THE DICTIONARY (src/data/import-segment-translations.json) is a REVIEWED list, not machine output
 * at run time: every mixed-language segment found in the stored rows on 2026-09-24, translated by
 * ten translators and validated (every number preserved, no cross-chunk disagreement). Keys are NFC.
 * Extended on 2026-09-24 (part 3) with the Batdongsan / Rever segments, ADD-ONLY: no committed value
 * was replaced. ⚠️ ONE ENTRY IS NOT FROM THE REVIEWED LIST: "Nam" → "South". The extraction found
 * mixed-language segments by their diacritics, and "Nam" is plain ASCII, so the one compass point
 * without a mark was never extracted while its seven siblings were; it is a compass entry, so it
 * applies on a Facing / Direction line only.
 *
 * THE CONTRACT
 *  - Only a segment the dictionary has is replaced, WHOLE: the part of a title after " — ", or the
 *    value of a "Label: value" fact line whose label is one the dictionary was built from
 *    (EN_FACT_LABELS / VI_FACT_LABELS). Nothing is translated word by word and nothing is guessed.
 *  - The one rule that is not a lookup: an English "Rent:" line's Vietnamese-grouped number
 *    ("2.500.000 đ/month") gets English commas ("2,500,000 đ/month"). Nothing else on it changes.
 *  - A line or title with no dictionary entry is returned byte for byte, NFD included.
 *  - Idempotent: a translation is never itself a key with a different translation (the unit test
 *    checks the whole file), so a second pass changes nothing.
 *  - A segment that still looks like the other language and has no entry is RETURNED in `missing`,
 *    in the dictionary's own item shape ({target, kind, src}), so an operator can see coverage and
 *    hand the list to a translator. It is a report, never a reason to drop a row.
 *
 * ⚠️ WHY THE LABELS ARE AN ALLOWLIST, AND STREETS ARE SCOPED. The runtime file carries no `kind`, so
 * a key is not tied to the line it came from. 115 street keys are BARE names ("An Phú" → "An Phú
 * Street"), and six of them are also ward names (An Phú, Phú Hữu, Bình Hưng, Hòa Bình, Tân Hưng, Tân
 * Sơn Nhì) — so, unscoped, "Ward: An Phú", "Building: Hòa Bình" or a title "— An Phú" would gain a
 * " Street" (all three review seats, 2026-09-24). Two rules close it, both derived from the data:
 *  - only the labels the reviewed segments were cut from are looked up (EN_FACT_LABELS /
 *    VI_FACT_LABELS), so "Project: An Phú" and "Listing code: …" are never touched;
 *  - an entry whose TRANSLATION is street-shaped ("… Street", "… Road", "Street No. 12", "National
 *    Route 13"; Vietnamese "Đường …") applies ONLY on the street line (Street / Đường), never on a
 *    ward, district, building, location or title. Measured on the reviewed set: every street-shaped
 *    translation is a street entry, and the street entries that are not street-shaped ("Cầu Him
 *    Lam" → "Him Lam Bridge", "khu Tên Lửa" → "Tên Lửa Area") name their own kind in the source.
 *    ⚠️ "Street-shaped" means ONE part: a translation with a comma is a whole address (two Rever
 *    Address entries start "Street No. …, Thảo Điền, …") and no street entry has one (isStreetEntry).
 * The same holds for compass directions: an entry translating to "North" … "Southwest" is used on the
 * Facing / Direction line only. The remaining families are interchangeable where they can meet —
 * every ward, district, location and address entry names an administrative unit (measured on 6,201
 * staged rows: each cross-label hit was one, e.g. "District: Quận 4" via a title entry), building
 * entries are identities, and the Type entries (8, then 7 more for Batdongsan / Rever) are property
 * kinds.
 * A new label needs its segments reviewed and its name added here.
 *
 * PURE — no I/O, no env. Imported by the three mappers, the Batdongsan and Rever importers and the
 * one-off, never by the app.
 */
import segments from '../data/import-segment-translations.json'
import { fold } from './fold'

export type ImportTextTarget = 'en' | 'vi'
/** One untranslated segment, shaped like a dictionary item so it can be sent for review as-is. */
export type MissingSegment = { target: ImportTextTarget; kind: string; src: string }
export type ImportTexts<V extends string | null = string> = { title: string; titleVi: V; description: string; descriptionVi: V }
export type LocalizedImportTexts<V extends string | null = string> = ImportTexts<V> & { missing: MissingSegment[] }

/** The fact labels the reviewed segments were cut from (the `desc:<Label>` / `descVi:<Label>` kinds). */
export const EN_FACT_LABELS: readonly string[] = ['Type', 'Facing', 'Street', 'Ward', 'Former ward', 'District', 'Building', 'Location']
export const VI_FACT_LABELS: readonly string[] = ['Đường']
const EN_LABELS = new Set(EN_FACT_LABELS)
const VI_LABELS = new Set(VI_FACT_LABELS)

/**
 * The separator every importer puts between its own title head and the source's location. Split at
 * the FIRST one on purpose: the head is ours (type, beds, baths, area — constants and numbers) and
 * never contains it, while the location is source text that might.
 */
const TITLE_CUT = ' — '

/** The one fact label per language whose values are streets. */
export const STREET_LABEL: Record<ImportTextTarget, string> = { en: 'Street', vi: 'Đường' }
/** A translation that is a compass direction — used on the Facing line only ('Đông Nam' could be a
 *  building's name; it is only "Southeast" when it is a facing) (opus, 2026-09-24). */
const FACING_SHAPED = /^(?:North|South|East|West)(?:east|west)?$/
/** A translation that names a street — see the header: such an entry is used on the street line only. */
const STREET_SHAPED: Record<ImportTextTarget, RegExp> = {
  en: /(?:^Street\s|\s(?:Street|Road|Avenue|Boulevard|Highway|Alley|Lane)$|^(?:National Route|Provincial Road|Provincial Route)\s)/,
  vi: /^Đường\s/,
}

/**
 * The form every key and every looked-up segment is compared in: NFC, with the Icelandic Eth Ð
 * (U+00D0) read as the Vietnamese Đ (U+0110). Some posters' keyboards type the look-alike, so the
 * reviewed keys hold both ('Đường Ðề Thám'); either spelling now finds the one entry (agy, 2026-09-24).
 * Vietnamese has no Eth, so nothing else can collide.
 */
const canon = (s: string) => s.normalize('NFC').replace(/\u00D0/g, '\u0110')

/**
 * Is this translation a STREET (so the entry is kept to the street line)? Street-shaped and a single
 * part. ⚠️ A translation with a comma is a whole ADDRESS, not a street: Rever's "Address:" line reads
 * "Số 11, Thảo Điền, Quận 2, Hồ Chí Minh" → "Street No. 11, Thảo Điền, District 2, Ho Chi Minh City",
 * which starts like a numbered street and would otherwise be refused on the very line it was reviewed
 * for. Measured on the reviewed set (2026-09-24): 0 of the 765 street entries has a comma; the 2
 * comma-carrying street-shaped translations are both Address entries.
 */
const isStreetEntry = (target: ImportTextTarget, v: string) => STREET_SHAPED[target].test(v) && !v.includes(',')

type Dict = { byKey: ReadonlyMap<string, string>; translations: ReadonlySet<string>; streetOnly: ReadonlySet<string>; facingOnly: ReadonlySet<string> }
/** A Map, not the parsed object: a plain-object lookup of "constructor" would return a function. */
function load(o: Record<string, string>, target: ImportTextTarget): Dict {
  const byKey = new Map<string, string>()
  for (const [k, v] of Object.entries(o)) byKey.set(canon(k), v.normalize('NFC'))
  const streetOnly = new Set([...byKey].filter(([, v]) => isStreetEntry(target, v)).map(([k]) => k))
  const facingOnly = new Set([...byKey].filter(([, v]) => target === 'en' && FACING_SHAPED.test(v)).map(([k]) => k))
  return { byKey, translations: new Set(byKey.values()), streetOnly, facingOnly }
}
const DICTS: Record<ImportTextTarget, Dict> = { en: load(segments.en, 'en'), vi: load(segments.vi, 'vi') }

/**
 * The fact labels whose value is a compass direction: the property importers' "Facing", and the
 * reference template's "Direction" (Rever — the same "Hướng", eight values: Đông Nam, Tây Bắc, …).
 */
const COMPASS_LABELS: ReadonlySet<string> = new Set(['Facing', 'Direction'])

/**
 * The reviewed translation of one whole segment, or undefined. The lookup is on the NFC form.
 * `slot` is where the segment sits — a fact label, or 'title' for a title's location. A street-shaped
 * entry is refused anywhere but the street line, a compass entry anywhere but a compass line. Without
 * a slot it is the raw dictionary lookup.
 * ⚠️ "Direction" TAKES COMPASS ENTRIES ONLY. No segment was reviewed under that label; the compass
 * entries were (on muaban's Facing line) and they are the only ones known to be right there.
 */
export function translateSegment(target: ImportTextTarget, segment: string, slot?: string): string | undefined {
  const d = DICTS[target], key = canon(segment)
  if (slot !== undefined && slot !== STREET_LABEL[target] && d.streetOnly.has(key)) return undefined
  if (slot !== undefined && !COMPASS_LABELS.has(slot) && d.facingOnly.has(key)) return undefined
  if (slot === 'Direction' && !d.facingOnly.has(key)) return undefined
  return d.byKey.get(key)
}

/**
 * Still in the other language? Only asked of a segment the dictionary does not have and that is not
 * already one of its translations.
 *  - English text: any letter outside ASCII — a Vietnamese diacritic ("Phường", "Đất Thánh"). A proper
 *    name kept in Vietnamese inside an English translation ("Bình Chánh District") is a translation,
 *    so it is recognised above and never gets here.
 *  - Vietnamese text: an English street or administrative word ("Song Hanh Street", "An Phu Ward").
 */
/** A letter OR a combining mark outside ASCII: NFD 'Chưa' is ASCII letters plus U+031B, a mark. */
const NON_ASCII_LETTER = /(?=[\p{L}\p{M}])[^\u0000-\u007F]/u
/** …or Vietnamese typed without marks: an administrative or street prefix opening a comma part
 *  ("Phuong 22, Quan Binh Thanh", "P. Tan Hoa", "Duong so 12") (agy, 2026-09-24). */
const UNMARKED_VI_PREFIX = /(?:^|,\s*)(?:phuong|quan|huyen|xa|thi tran|thanh pho|duong|p\.|q\.|tp\.)\s/i
const EN_STREET_WORD = /\b(?:street|road|avenue|boulevard|highway|lane|alley)\b/i
const EN_PLACE_WORD = /\b(?:ward|district|commune|street|road)\b/i
const looksUntranslated = (target: ImportTextTarget, segment: string, re: RegExp) =>
  target === 'en' ? NON_ASCII_LETTER.test(segment.normalize('NFC')) || UNMARKED_VI_PREFIX.test(segment) : re.test(segment)

class Missing {
  private seen = new Map<string, MissingSegment>()
  /** Keyed on the NFC form, so the same segment typed NFC and NFD is ONE entry (codex, 2026-09-24). */
  add(target: ImportTextTarget, kind: string, raw: string) {
    const src = raw.normalize('NFC')
    const key = `${target}\u0000${kind}\u0000${src}`
    if (!this.seen.has(key)) this.seen.set(key, { target, kind, src })
  }
  list() { return [...this.seen.values()] }
}

/** Is this segment one the dictionary already produced (so nothing is missing)? */
const isTranslation = (target: ImportTextTarget, segment: string) => DICTS[target].translations.has(segment.normalize('NFC'))

function localizeTitle(title: string, target: ImportTextTarget, missing: Missing): string {
  const cut = title.indexOf(TITLE_CUT)
  if (cut < 0) return title
  const where = title.slice(cut + TITLE_CUT.length)
  const hit = translateSegment(target, where, 'title')
  if (hit !== undefined) return hit === where ? title : `${title.slice(0, cut)}${TITLE_CUT}${hit}`
  if (where && !isTranslation(target, where) && looksUntranslated(target, where, EN_PLACE_WORD)) {
    missing.add(target, target === 'en' ? 'title-location' : 'titleVi-location', where)
  }
  return title
}

/**
 * "2.500.000 đ/month" → "2,500,000 đ/month": a run of Vietnamese thousands groups (1–3 digits, then
 * one or more ".ddd") with no digit, dot or comma on either side. So "US$2,692/month", "44.5" and a
 * Vietnamese decimal "2.500.000,5" are not matched. Idempotent: the output has no dotted group.
 */
const VI_GROUPED = /(?<![\d.,])\d{1,3}(?:\.\d{3})+(?![\d.,])/g
export const englishRentValue = (value: string) => value.replace(VI_GROUPED, (m) => m.replaceAll('.', ','))

function localizeFacts(text: string, target: ImportTextTarget, missing: Missing, labels: ReadonlySet<string> = target === 'en' ? EN_LABELS : VI_LABELS): string {
  const lines = text.split('\n')
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cut = line.indexOf(': ')
    if (cut <= 0) continue
    const label = line.slice(0, cut).normalize('NFC')
    const value = line.slice(cut + 2)
    let next: string | undefined
    if (target === 'en' && label === 'Rent') {
      const v = englishRentValue(value)
      if (v !== value) next = `${label}: ${v}`
    } else if (labels.has(label)) {
      const hit = translateSegment(target, value, label)
      if (hit !== undefined) {
        if (hit !== value) next = `${label}: ${hit}`
      } else if (value && !isTranslation(target, value)
        /** A Direction is a compass point or it is untranslated — "Nam" is plain ASCII and the
         *  diacritic test alone would never report it. */
        && (label === 'Direction' ? !FACING_SHAPED.test(value) : looksUntranslated(target, value, EN_STREET_WORD))) {
        missing.add(target, `${target === 'en' ? 'desc' : 'descVi'}:${label}`, value)
      }
    }
    if (next !== undefined) { lines[i] = next; changed = true }
  }
  return changed ? lines.join('\n') : text
}

/**
 * The importer's composed text with every mixed-language segment the dictionary knows replaced.
 * EN title/description are looked up in the English dictionary, VI titleVi/descriptionVi in the
 * Vietnamese one; a null Vietnamese field (a stored row) stays null.
 */
export function localizeImportText<V extends string | null>(t: ImportTexts<V>): LocalizedImportTexts<V> {
  const missing = new Missing()
  const title = localizeTitle(t.title, 'en', missing)
  const description = localizeFacts(t.description, 'en', missing)
  const titleVi = (t.titleVi === null ? null : localizeTitle(t.titleVi, 'vi', missing)) as V
  const descriptionVi = (t.descriptionVi === null ? null : localizeFacts(t.descriptionVi, 'vi', missing)) as V
  return { title, titleVi, description, descriptionVi, missing: missing.list() }
}

/**
 * THE REFERENCE-LISTING TEMPLATE — scripts/import-batdongsan-rentals.ts and scripts/import-rever-rentals.ts.
 * Their compose() writes ONE fact block, with the SAME English labels, into BOTH descriptions:
 *   Type: Nhà trọ / Phòng trọ · Area: 24 m² · Bedrooms · Bathrooms · Location: Quận 11 (P. Hòa Bình mới)
 *   (Batdongsan) · Direction: Đông Nam · Address: Đồng Văn Cống, Thạnh Mỹ Lợi, Quận 2, Hồ Chí Minh (Rever)
 *   · Rent: 6.300.000 đ/month
 * So the English text carries Vietnamese values, and the Vietnamese text carries English labels.
 *  - ENGLISH: the same contract as localizeImportText — the title location and the values of the
 *    labels below, looked up whole in the reviewed dictionary, and the Rent number gets English commas.
 *    "Address" is these templates' own label (its segments were reviewed as `desc:Address`); on
 *    "Direction" only a compass entry applies (translateSegment).
 *  - VIETNAMESE: a FIXED label map (REFERENCE_VI_LABELS — muaban's Vietnamese labels, plus Địa chỉ for
 *    Address) and "đ/month" → "đ/tháng" on the Rent line. The VALUES are left exactly as they are: they
 *    are the source's Vietnamese already.
 * Idempotent: a mapped label is Vietnamese and never maps again; a translation is never a key with a
 * different translation (the dictionary test).
 */
export const REFERENCE_EN_FACT_LABELS: readonly string[] = ['Type', 'Location', 'Address', 'Direction']
const REFERENCE_EN_LABELS: ReadonlySet<string> = new Set(REFERENCE_EN_FACT_LABELS)
export const REFERENCE_VI_LABELS: Readonly<Record<string, string>> = {
  Type: 'Loại hình', Area: 'Diện tích', Bedrooms: 'Phòng ngủ', Bathrooms: 'Phòng vệ sinh',
  Location: 'Khu vực', Address: 'Địa chỉ', Rent: 'Giá thuê', Direction: 'Hướng',
}
/** Own-property lookup: a label of "constructor" must not find Object.prototype's. */
const referenceViLabel = (label: string) => (Object.hasOwn(REFERENCE_VI_LABELS, label) ? REFERENCE_VI_LABELS[label] : undefined)

function vietnameseReferenceFacts(text: string): string {
  const lines = text.split('\n')
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cut = line.indexOf(': ')
    if (cut <= 0) continue
    const label = line.slice(0, cut)
    const vi = referenceViLabel(label)
    if (vi === undefined) continue
    const value = line.slice(cut + 2)
    lines[i] = `${vi}: ${label === 'Rent' ? value.replace(/đ\/month$/, 'đ/tháng') : value}`
    changed = true
  }
  return changed ? lines.join('\n') : text
}

/** localizeImportText for the Batdongsan / Rever template — see the block above. */
export function localizeReferenceImportText<V extends string | null>(t: ImportTexts<V>): LocalizedImportTexts<V> {
  const missing = new Missing()
  const title = localizeTitle(t.title, 'en', missing)
  const description = localizeFacts(t.description, 'en', missing, REFERENCE_EN_LABELS)
  const titleVi = (t.titleVi === null ? null : localizeTitle(t.titleVi, 'vi', missing)) as V
  const descriptionVi = (t.descriptionVi === null ? null : vietnameseReferenceFacts(t.descriptionVi)) as V
  return { title, titleVi, description, descriptionVi, missing: missing.list() }
}

/** The location part of a composed title (after " — "), or null. */
export function titleLocation(title: string): string | null {
  const cut = title.indexOf(TITLE_CUT)
  return cut < 0 ? null : title.slice(cut + TITLE_CUT.length) || null
}

/**
 * The searchText a stored row should carry once its titles are localized.
 * ⚠️ ALL THREE MAPPERS FOLD `title` AND `titleVi` FIRST (buildSearchText([title, titleVi, …])), and
 * fold() of a space-joined list is the space-joined folds — so a stored searchText that starts with
 * fold(old title + ' ' + old titleVi) has exactly that head swapped for the new one, which is the
 * searchText the importer itself would now compose (the unit test pins the "title first" order in
 * each mapper). A searchText composed some other way keeps everything it has and gains the folded
 * English title location at the end, once — so "district 7" finds a row whose English title now says
 * "District 7". Idempotent either way.
 */
export function rebaseSearchText(
  searchText: string,
  before: { title: string; titleVi: string | null },
  after: { title: string; titleVi: string | null },
): string {
  const head = (t: { title: string; titleVi: string | null }) => fold([t.title, t.titleVi].filter(Boolean).join(' '))
  const oldHead = head(before), newHead = head(after)
  if (oldHead === newHead) return searchText
  if (searchText === oldHead || searchText.startsWith(`${oldHead} `)) return `${newHead}${searchText.slice(oldHead.length)}`
  const extra = fold(titleLocation(after.title) ?? '')
  if (!extra || ` ${searchText} `.includes(` ${extra} `)) return searchText
  return searchText ? `${searchText} ${extra}` : extra
}

/**
 * A one-line coverage report for an importer's dry run: how many distinct untranslated segments the
 * batch carries, by kind, with a few examples. Empty string when there are none.
 */
export function untranslatedSummary(missing: readonly MissingSegment[], examples = 3): string {
  const byKey = new Map<string, MissingSegment & { n: number }>()
  for (const m of missing) {
    const k = `${m.target}\u0000${m.kind}\u0000${m.src}`
    const e = byKey.get(k)
    if (e) e.n++
    else byKey.set(k, { ...m, n: 1 })
  }
  if (!byKey.size) return ''
  const byKind = new Map<string, number>()
  for (const m of byKey.values()) byKind.set(`${m.target} ${m.kind}`, (byKind.get(`${m.target} ${m.kind}`) ?? 0) + 1)
  const top = [...byKey.values()].sort((a, b) => b.n - a.n).slice(0, examples).map((m) => `"${m.src}" ×${m.n}`)
  return `${byKey.size} distinct (${[...byKind].map(([k, n]) => `${k} ${n}`).join(', ')}) e.g. ${top.join(', ')} — add reviewed entries to src/data/import-segment-translations.json`
}
