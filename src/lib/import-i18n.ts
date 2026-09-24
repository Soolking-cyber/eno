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
 * applies the same function once to rows already stored.
 *
 * THE DICTIONARY (src/data/import-segment-translations.json) is a REVIEWED list, not machine output
 * at run time: every mixed-language segment found in the stored rows on 2026-09-24, translated by
 * ten translators and validated (every number preserved, no cross-chunk disagreement). Keys are NFC.
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
 *    translation is a street entry, and the 9 street entries that are not street-shaped ("Cầu Him
 *    Lam" → "Him Lam Bridge", "khu Tên Lửa" → "Tên Lửa Area") name their own kind in the source.
 * The same holds for compass directions: an entry translating to "North" … "Southwest" is used on the
 * Facing line only. The remaining families are interchangeable where they can meet — every ward,
 * district and location entry names an administrative unit (measured on 6,201 staged rows: each
 * cross-label hit was one, e.g. "District: Quận 4" via a title entry), building entries are
 * identities, and the 8 Type entries are property kinds.
 * A new label needs its segments reviewed and its name added here.
 *
 * PURE — no I/O, no env. Imported by the three mappers and by the one-off, never by the app.
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

type Dict = { byKey: ReadonlyMap<string, string>; translations: ReadonlySet<string>; streetOnly: ReadonlySet<string>; facingOnly: ReadonlySet<string> }
/** A Map, not the parsed object: a plain-object lookup of "constructor" would return a function. */
function load(o: Record<string, string>, target: ImportTextTarget): Dict {
  const byKey = new Map<string, string>()
  for (const [k, v] of Object.entries(o)) byKey.set(canon(k), v.normalize('NFC'))
  const streetOnly = new Set([...byKey].filter(([, v]) => STREET_SHAPED[target].test(v)).map(([k]) => k))
  const facingOnly = new Set([...byKey].filter(([, v]) => target === 'en' && FACING_SHAPED.test(v)).map(([k]) => k))
  return { byKey, translations: new Set(byKey.values()), streetOnly, facingOnly }
}
const DICTS: Record<ImportTextTarget, Dict> = { en: load(segments.en, 'en'), vi: load(segments.vi, 'vi') }

/**
 * The reviewed translation of one whole segment, or undefined. The lookup is on the NFC form.
 * `slot` is where the segment sits — a fact label, or 'title' for a title's location. A street-shaped
 * entry is refused anywhere but the street line, a compass entry anywhere but Facing. Without a slot
 * it is the raw dictionary lookup.
 */
export function translateSegment(target: ImportTextTarget, segment: string, slot?: string): string | undefined {
  const d = DICTS[target], key = canon(segment)
  if (slot !== undefined && slot !== STREET_LABEL[target] && d.streetOnly.has(key)) return undefined
  if (slot !== undefined && slot !== 'Facing' && d.facingOnly.has(key)) return undefined
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

function localizeFacts(text: string, target: ImportTextTarget, missing: Missing): string {
  const labels = target === 'en' ? EN_LABELS : VI_LABELS
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
      } else if (value && !isTranslation(target, value) && looksUntranslated(target, value, EN_STREET_WORD)) {
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
