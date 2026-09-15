/**
 * Make every active listing TITLE bilingual — English in `title`, Vietnamese in `titleVi` — with the
 * Google Cloud Translation API, across every seller in one pass.
 *
 *   npx tsx scripts/translate-titles-google.ts                  # DRY RUN: counts + cost, no API calls
 *   npx tsx scripts/translate-titles-google.ts --sample 10      # translate 10 of each direction, print, write nothing
 *   npx tsx scripts/translate-titles-google.ts --apply          # do it
 *
 * Owner, 2026-09-15, about "Miếng dán camera iPhone 18 Pro/ iPhone 18 Pro Max Titanshield Mipow
 * IRONBULL BJ18A-RD" still showing in Vietnamese: "use google translate api … to have all in
 * english and vietnamese now".
 *
 * ⛔ WHY THEY WERE STILL VIETNAMESE. import-partners.ts and import-accesstrade.ts write the shop's
 * Vietnamese into BOTH `title` and `titleVi` by design and leave the English slot to
 * translate-imported-listings.ts — which takes one `--seller` at a time and was never run after the
 * 2026-09-13 partner imports. Measured the same day: 1,594 active titles across 17 shops still
 * Vietnamese in the English slot (Tiki 1,194, Thế Giới Di Động 151, …), newest rows from 09-13; and
 * 830 English titles (CellphoneS 816) with no Vietnamese version at all. This script closes both
 * across every seller instead of per shop — but the importers will reopen it on the next run until
 * they translate on write.
 *
 * ⛔ TITLES ONLY, AND THE REASON IS MONEY, NOT OVERSIGHT. Measured: the titles are 166,746 characters
 * (~$3.34 at $20/M). The still-Vietnamese DESCRIPTIONS are 17,552,111 characters, ~$351 — seven
 * times the $50 of credit this was asked to spend. They are deliberately out of scope here.
 *
 * ⛔ EVERY TRANSLATION PASSES gateTranslation BEFORE IT IS WRITTEN. This catalogue has already had
 * MT invent meaning into titles (retranslate-titles-gemini.ts: "Máy lạnh Daikin 1.0HP" shipped as
 * "Daikin 1.0HP refrigerator" — an air conditioner sold as a fridge). The gate rejects a
 * hypothesis that drops a model code or a quantity, echoes the source, or is the wrong length, so
 * "BJ18A-RD" and "256GB" either survive verbatim or the row keeps its Vietnamese and is reported.
 * A rejected row is left EXACTLY as it was — a Vietnamese title is a blemish, a wrong product name
 * is a mislabelled product.
 *
 * ⚠️ `titleVi` IS THE SOURCE OF TRUTH AND IS NEVER OVERWRITTEN WHEN IT HOLDS VIETNAMESE. Every later
 * re-translation reads it; losing the merchant's original would make the next repair impossible.
 * Vietnamese → English writes only `title` (and fills an empty `titleVi` with the original first).
 * A no-diacritic title with an empty `titleVi` gets both slots when Google translates it, or its
 * own name copied into `titleVi` when Google echoes it.
 *
 * ⚠️ AN ENGLISH PRODUCT NAME THAT GOOGLE ECHOES IS STORED AS ITS OWN VIETNAMESE. "iPhone 15 Pro Max
 * 256GB" has no other Vietnamese form; the gate calls that `untranslated`, which for this direction
 * is the correct answer rather than a failure, so the name is copied into `titleVi`. Any OTHER
 * rejection in that direction still skips the row.
 *
 * ⚠️ OPTIMISTIC WRITE. The update matches on the `title`/`titleVi` read at selection, so a
 * re-import that changed the product between read and write leaves the row untouched and counted
 * as `raced` — a translation of yesterday's title on today's product is the mislabelling above.
 *
 * ⚠️ `searchText` IS REBUILT IN THE SAME UPDATE. feed-query matches keyword search against that
 * folded blob, built from BOTH titles; a new English title that is not in it cannot be found by
 * the English word a buyer types — the gap rebuild-search-text.ts exists for. Same recipe here.
 *
 * ⚠️ RESUMABLE BY CONSTRUCTION, BUT NOT FREE TO RE-RUN. Selection asks "is the English slot still Vietnamese"
 * and "is the Vietnamese slot empty", so a killed run continues. A row the gate REJECTS is left unchanged
 * and is therefore selected — and billed — again on every run (measured: ~350 rows, ~$0.70 a run). Pin a
 * row that will never pass in translate-titles-google.skip rather than paying for it indefinitely.
 */
import 'dotenv/config'
import { db } from '../src/lib/db'
import { buildSearchText } from '../src/lib/fold'
import { gateTranslation } from '../src/lib/mt-gate'
import { entitiesSurvive, latinWordsSurvive } from '../src/lib/mt-entity-override'
import { readFileSync } from 'node:fs'
import { applyViSourceTerms, hasKnownMistranslation, repairKnownMistranslation } from '../src/lib/vi-source-terms'

const KEY = process.env.GOOGLE_TRANSLATE_API_KEY
const APPLY = process.argv.includes('--apply')
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const SAMPLE = arg('sample') ? Number(arg('sample')) : 0
/** A hard ceiling on characters sent. The measured job is ~167k; this refuses to spend past 400k
 *  (~$8) however the catalogue has changed since, so a surprise cannot drain the credit. */
const MAX_CHARS = arg('max-chars') ? Number(arg('max-chars')) : 400_000
// A typo must not remove the ceiling: `--max-chars 4oo` is NaN, and every `chars > NaN` is false (external review).
if (!Number.isFinite(MAX_CHARS) || MAX_CHARS < 0) { console.error('--max-chars must be a finite, non-negative number'); process.exit(1) }
/** Re-translate exactly these listing ids (one per line) from titleVi, reverting title to titleVi when
 *  the gate rejects. For repairing a bad pass without re-selecting rows that were never touched. */
const REDO_IDS = arg('redo-ids') ? readFileSync(arg('redo-ids')!, 'utf8').split(/\s+/).filter(Boolean) : null
/** Purge caches even when nothing was written — a previous run that wrote rows and then failed to
 *  purge leaves nothing for a re-run to select, so without this the stale pages would stay. */
const FORCE_PURGE = process.argv.includes('--purge')
/** Run the known-mistranslation repair (vi-source-terms.ts). OFF by default: it is a one-off for rows written
 *  before a term was mapped — the two Lá House toners, both fixed 2026-09-15 — and a routine run must not
 *  keep re-examining translated titles, where a second genuine mention could be "repaired" (external review). */
const REPAIR_TERMS = process.argv.includes('--repair-terms')
/** Put these listing ids (one per line) back to their original title (title := titleVi). For a
 *  translation that passed every automatic check and is still wrong — found by reading, not by rule. */
const RESTORE_IDS = arg('restore-ids') ? readFileSync(arg('restore-ids')!, 'utf8').split(/\s+/).filter(Boolean) : null
if ((SAMPLE || (APPLY && !RESTORE_IDS)) && !KEY) { console.error('GOOGLE_TRANSLATE_API_KEY required'); process.exit(1) }
// Restore and purge need no translation — only a mode that calls Google needs the key (external review).

/** Vietnamese-specific letters — the same test translate-imported-listings.ts and the SQL audit use. */
const VI_RE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i
// NFC first: a decomposed title spells "ồ" as "o" + two combining marks, which the precomposed class misses,
// so the row was never selected at all (external review; the same trap as vi-source-terms.ts).
const isVi = (s: string | null | undefined) => !!s && VI_RE.test(s.normalize('NFC'))

/** Google v2, batched. 50 per call with a pause — measured in translate-imported-listings.ts: larger
 *  unpaced batches trip "User Rate Limit Exceeded" long before the project quota. */
/**
 * ⛔ THE SOURCE IS ALWAYS DECLARED, NEVER AUTO-DETECTED. The first pass let Google detect the language of
 * titles without diacritics, and on short product names it guessed differently row by row. Measured on
 * the 245 titles it rewrote: "Loa" (speaker) became Speaker ×24 but also Get ×11, Receiver ×7, Complete,
 * Very and Total; "Laptop HP Victus" became "HP EliteBook 840 G1" — a different laptop; "Sakos"
 * (brand) became "Bag"; "(Gold)" became "(Meta)". Declaring `source: 'vi'` on the same titles fixed every
 * one, and an already-English name simply echoes. This catalogue is Vietnamese or language-neutral.
 */
async function translate(texts: string[], source: 'vi', target: 'en'): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50)
    for (let attempt = 0; ; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
      const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // format:'text' — 'html' would hand back "&amp;" and "&#39;" inside product names.
        body: JSON.stringify({ q: batch, source, target, format: 'text' }),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) {
        const j = await res.json() as { data: { translations: { translatedText: string }[] } }
        out.push(...j.data.translations.map((t) => t.translatedText))
        break
      }
      if ((res.status === 403 || res.status === 429) && attempt < 5) continue
      throw new Error(`translate ${source}->${target}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    }
    await new Promise((r) => setTimeout(r, 250))
    if ((i / 50) % 10 === 0) console.log(`    ${source}->${target}: ${Math.min(i + 50, texts.length)}/${texts.length}`)
  }
  return out
}

/* entitiesSurvive — the measured, tested override for Google's entity-loss false alarms: src/lib/mt-entity-override.ts */

/** gateTranslation, with the measured override for Google's entity-loss false alarms. */
function gate(src: string, hyp: string, target: 'en' | 'vi', source?: 'en' | 'vi'): string | null {
  const why = gateTranslation(src, hyp, target, source)
  if (why === 'entity-loss' && entitiesSurvive(src, hyp)) return null
  return why
}

/** For a source WITHOUT diacritics: the gate, then every capitalised Latin word must survive
 *  (src/lib/mt-entity-override.ts — the "(Gold)" → "(Meta)" measurement). */
function gateNoDiacritics(src: string, hyp: string): string | null {
  const why = gate(src, hyp, 'en', 'vi')
  if (why) return why
  return latinWordsSurvive(src, hyp) ? null : 'latin-word-lost'
}

/**
 * ⛔ A TITLE CHANGE IS NOT VISIBLE UNTIL TWO CACHES LET GO OF IT. Owner, 2026-09-15, after the first
 * run: the home page kept showing the Vietnamese names for hours. The first version of this script
 * wrote the database and stopped.
 *
 *  1. ORIGIN ISR. Every cached page carries the root tag `_N_T_/layout` (read from next_cache on the
 *     box: home, /c/*, /listings/<id> all list it), so ONE tombstone re-renders them all on their next
 *     visit — a catalogue-wide title change warrants exactly that. Written with the same greatest()
 *     upsert cache-handler.cjs uses, so a replayed purge can never move a tombstone backward.
 *     ⚠️ ONLY WORKS WHERE THE APP READS TOMBSTONES — ENO_ISR_PG=1 (apps.compose.yml). Before that
 *     switch existed this write was a silent no-op on the box, which is how
 *     scripts/purge-isr-listings.mjs "purged" every product page on 2026-09-14 and changed nothing.
 *  2. CLOUDFLARE. `/` and the legal pages are edge-cached for 6h. purge_everything per ZONE, never
 *     by URL: the Cache Rule's `vary: normalize` keys each encoding variant separately, so a
 *     purge-by-file answers success:true and removes nothing (eno-deploy-cache-invisible).
 *     Needs CF_TOKEN; without it the script says so loudly instead of implying the site is updated.
 */
async function purgeCaches() {
  // ⚠️ STAMPED BY THE DATABASE CLOCK, NOT THIS MACHINE'S. greatest() never lowers a stamp, so an
  // operator laptop running fast would mark every page rendered in that gap as stale until real time
  // caught up — no caching, site-wide, since this is the root tag (external review).
  const tag = 'eno:isrtag:_N_T_/layout'
  await db.$executeRaw`
    insert into next_cache_tag (tag, stamp, expires_at)
    values (${tag}, (extract(epoch from clock_timestamp()) * 1000)::bigint, now() + interval '40 days')
    on conflict (tag) do update set
      stamp = greatest(next_cache_tag.stamp, excluded.stamp),
      expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`
  // Says what it did, not what it hopes: the tombstone is only READ by containers running with ENO_ISR_PG=1
  // (apps.compose.yml, live from the first deploy after that change). Before it, this is the silent no-op
  // purge-isr-listings.mjs was (external review).
  console.log('ISR: tombstoned _N_T_/layout — effective only on containers running ENO_ISR_PG=1 (`docker exec eno-vn-app printenv ENO_ISR_PG`)')

  const token = process.env.CF_TOKEN
  if (!token) {
    console.log('⚠️  CLOUDFLARE NOT PURGED (no CF_TOKEN): the home page keeps the old titles for up to 6h.')
    console.log('    Purge eno.vn and eno.forum with purge_everything, or re-run with CF_TOKEN set and --purge.')
    return
  }
  // The same two zones eno-deploy.sh purges.
  for (const [name, zone] of [['eno.vn', '55e558b62f68a44f8177d7d98cb5369e'], ['eno.forum', 'cc81e3ff1d792c0aa5384e8feab21efa']]) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purge_everything: true }),
    })
    const j = await res.json() as { success?: boolean }
    console.log(`Cloudflare ${name}: ${j.success ? 'purged' : `FAILED (HTTP ${res.status})`}`)
    // Non-zero so the operator sees it: the writes are done, the pages are not. Re-run with --purge.
    if (!j.success) process.exitCode = 1
  }
}

/**
 * The optimistic write. Matches on every Listing field the new searchText is built from — not only the
 * titles — so an edit to the description, location, brand, model or category while this runs makes the
 * row `raced` instead of having its search text rebuilt from the values as they were at selection
 * (external review). A category RENAME is not guarded; it would be stale only until that row's next write.
 */
async function writeOne(r: Row, data: { title?: string; titleVi?: string }, opts: { anySeller?: boolean } = {}): Promise<boolean> {
  const title = data.title ?? r.title
  const titleVi = data.titleVi ?? r.titleVi
  const { count } = await db.listing.updateMany({
    where: {
      id: r.id, title: r.title, titleVi: r.titleVi, description: r.description, descriptionVi: r.descriptionVi,
      district: r.district, location: r.location, brandSlug: r.brandSlug, model: r.model, categoryId: r.categoryId,
      // Still live, and — unless restoring — still an IMPORTED shop's: a shop claimed by a person, or a
      // listing hidden, between selection and write is left alone (external review).
      status: 'active', verified: true,
      ...(opts.anySeller ? {} : { seller: { is: { ownerId: null } } }),
    },
    data: {
      ...data,
      searchText: buildSearchText([title, titleVi, r.description, r.descriptionVi,
        r.district, r.location, r.category.name, r.category.nameVi, r.brandSlug, r.model]),
    },
  })
  return count > 0
}

type Row = {
  id: string; title: string; titleVi: string | null; description: string; descriptionVi: string | null
  district: string | null; location: string; brandSlug: string | null; model: string | null
  categoryId: string; category: { name: string; nameVi: string | null }; seller: { ownerId: string | null } | null
}

async function main() {
  // `--purge` ON ITS OWN purges and stops — no key, no selection, no API calls. The no-CF_TOKEN warning tells
  // the operator to re-run with --purge; the first version then fell into the dry run and purged nothing.
  if (FORCE_PURGE && !APPLY && !SAMPLE) { try { await purgeCaches() } finally { await db.$disconnect() } return }

  const rows: Row[] = await db.listing.findMany({
    where: { status: 'active', verified: true },
    select: {
      id: true, title: true, titleVi: true, description: true, descriptionVi: true,
      district: true, location: true, brandSlug: true, model: true, categoryId: true,
      category: { select: { name: true, nameVi: true } },
      seller: { select: { ownerId: true } },
    },
  })
  /**
   * ⛔ IMPORTED SHOPS ONLY (Seller.ownerId null) — the first run covered every seller and rewrote a
   * partner's own title (VietKite's "Visa điện tử Việt Nam…") and a human shop's punctuation
   * (SDC_store). A person's title is theirs; the app already machine-translates it at RENDER through
   * the Translation cache without touching what they wrote. This script exists for importers, which
   * are the ones writing Vietnamese into the English slot by design.
   */
  /** Ids that must never be translated automatically — see scripts/translate-titles-google.skip. */
  const skip = new Set(readFileSync(new URL('./translate-titles-google.skip', import.meta.url), 'utf8')
    .split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean))
  // `r.seller != null` explicitly: a listing with NO seller satisfied `seller?.ownerId == null`, was sent to
  // Google on every run, and could never pass the write guard (`seller: { is: { ownerId: null } }`).
  const imported = rows.filter((r) => r.seller != null && r.seller.ownerId == null && !skip.has(r.id))

  // Vietnamese in the English slot. Translate from titleVi when it holds Vietnamese (the merchant's
  // original), else from the title itself.
  /**
   * ⚠️ "HAS DIACRITICS" IS NOT "IS VIETNAMESE", AND THE FIRST RUN PROVED IT. After it, 539 titles still
   * matched against 376 expected; the other 163 were CORRECT English that keeps accented letters —
   * French titles ("Les Misérables", "Révisions"), brands ("Bụi Leather", "Lá House"), translators'
   * names ("Mai Thị Yên Thi"). Re-sending them would re-bill them on every run. So a row whose title
   * already DIFFERS from its Vietnamese original counts as translated; only a title still equal to
   * titleVi (or with no titleVi at all) is sent.
   */
  const toEn = imported.filter((r) => isVi(r.title) && (!r.titleVi || r.titleVi.trim() === '' || r.title.trim() === r.titleVi.trim()))
  /**
   * A title with no diacritics and no Vietnamese version at all.
   * ⛔ THESE ARE MOSTLY NOT ENGLISH. The 10-title sample sent them en→vi and Google echoed every one —
   * "AppleCare+ cho iPhone 15 Pro" and "Loa Bluetooth Edifier" are Vietnamese without diacritics
   * ("cho" = for, "Loa" = speaker). They go vi→en like everything else (see translate() for why the
   * source is declared): a Vietnamese name comes back translated and its original becomes titleVi; a
   * language-neutral name ("Laptop MSI Cyborg 15 A13VEK-2089VN") echoes and is stored as its own
   * Vietnamese.
   */
  // Also a no-diacritic title copied into BOTH slots that still opens with a measured Vietnamese category
  // word ("Loa JBL …" in title AND titleVi) — measured 64 after the first run. Bounded to those words, so
  // genuinely language-neutral names are not re-sent on every run.
  const CATEGORY_LEAD = /^(loa|tai nghe|tivi|bao da|balo)\b/i
  const toVi = imported.filter((r) => !isVi(r.title) && (
    !(r.titleVi && r.titleVi.trim()) || (r.title === r.titleVi && CATEGORY_LEAD.test(r.title))))
  // ⚠️ THROUGH THE TERM MAP. The source sent to Google has known-bad retail terms rewritten
  // ("nước hoa hồng" → "toner"); the stored titleVi is never touched. See vi-source-terms.ts.
  const srcEn = (r: Row) => applyViSourceTerms(isVi(r.titleVi) ? r.titleVi! : r.title)
  /**
   * ALREADY ENGLISH, BUT KNOWN WRONG — a title whose Vietnamese contains a term in the map and
   * whose English shows that term's known mistranslation. Measured 2026-09-15: two Lá House toners
   * read "Rose water helps brighten skin…". Re-translated from titleVi through the term map.
   * Scoped to measured renderings, so a correct translation is never re-sent.
   */
  // ⚠️ KEYED ON "ALREADY TRANSLATED" (title differs from titleVi), NOT ON "HAS NO DIACRITICS". The
  // first filter used !isVi(title) and found 0 of the 2 measured rows — their English keeps the
  // brand "Lá House", whose á the diacritic test reads as Vietnamese.
  const toFix = REPAIR_TERMS ? imported.filter((r) => r.titleVi && r.title !== r.titleVi && hasKnownMistranslation(r.titleVi, r.title)) : []

  if (RESTORE_IDS) {
    const want = new Set(RESTORE_IDS)
    const back = rows.filter((r) => want.has(r.id) && r.titleVi && r.titleVi.trim() && r.title !== r.titleVi)
    console.log(`RESTORE: ${back.length} of ${RESTORE_IDS.length} ids differ from their original`)
    back.forEach((r) => console.log(`  ${r.title.slice(0, 70)}\n    <- ${r.titleVi!.slice(0, 70)}`))
    if (!APPLY) { console.log('DRY RUN — --apply to write.'); await db.$disconnect(); return }
    // Restore deliberately ignores the owner filter and the skip list: putting a seller's own words back
    // is the safe direction, and a pinned row is exactly what gets restored.
    let n = 0
    try {
      for (const r of back) if (await writeOne(r, { title: r.titleVi! }, { anySeller: true })) n++
      console.log(`RESTORED: ${n}`)
    } finally {
      if (n || FORCE_PURGE) await purgeCaches()
      await db.$disconnect()
    }
    return
  }

  if (REDO_IDS) {
    const want = new Set(REDO_IDS)
    // Through the SAME owner filter and skip list as a normal run — a pasted id list must not be a way to
    // machine-rewrite a human seller's title or undo a pin (external review).
    const redo = imported.filter((r) => want.has(r.id) && r.titleVi && r.titleVi.trim())
    console.log(`REDO: ${redo.length} of ${REDO_IDS.length} ids are active with a titleVi`)
    const chars = redo.reduce((n, r) => n + applyViSourceTerms(r.titleVi!).length, 0)
    console.log(`  ${chars.toLocaleString()} chars -> ~$${(chars / 1e6 * 20).toFixed(2)}`)
    if (chars > MAX_CHARS) { console.error('⛔ exceeds --max-chars'); process.exit(1) }
    if (!APPLY) { console.log('DRY RUN — --apply to write.'); await db.$disconnect(); return }
    const out = await translate(redo.map((r) => applyViSourceTerms(r.titleVi!)), 'vi', 'en')
    let fixed = 0, reverted = 0, unchanged = 0, raced = 0
    try {
    for (let i = 0; i < redo.length; i++) {
      const r = redo[i], src = applyViSourceTerms(r.titleVi!), hyp = out[i]
      const why = isVi(src) ? gate(src, hyp, 'en', 'vi') : gateNoDiacritics(src, hyp)
      // Echo → the name is language-neutral: title = titleVi. Reject → back to the original, which is
      // exactly the state before the bad pass. Pass → the corrected English.
      const next = why === 'untranslated' || why ? r.titleVi! : hyp
      if (next === r.title) { unchanged++; continue }
      const ok = await writeOne(r, { title: next })
      if (!ok) raced++; else if (next === r.titleVi) reverted++; else fixed++
    }
    console.log(`REDO APPLIED: ${fixed} re-translated, ${reverted} restored to the original, ${unchanged} already right, ${raced} raced`)
    } finally {
      if (fixed + reverted || FORCE_PURGE) await purgeCaches()
      await db.$disconnect()
    }
    return
  }

  const chars = toEn.reduce((n, r) => n + srcEn(r).length, 0) + toVi.reduce((n, r) => n + r.title.length, 0)
    + toFix.reduce((n, r) => n + applyViSourceTerms(r.titleVi!).length, 0)
  console.log(`${rows.length.toLocaleString()} active listings`)
  console.log(`  vi -> en (English slot still Vietnamese): ${toEn.length}`)
  console.log(`  no diacritics, no titleVi (vi -> en):     ${toVi.length}`)
  console.log(`  known mistranslation to repair:           ${toFix.length}`)
  console.log(`  ${chars.toLocaleString()} chars -> ~$${(chars / 1e6 * 20).toFixed(2)} at $20/M  (ceiling ${MAX_CHARS.toLocaleString()})`)
  if (chars > MAX_CHARS) {
    console.error(`\n⛔ ${chars.toLocaleString()} chars exceeds --max-chars ${MAX_CHARS.toLocaleString()} — refusing. Re-measure before raising it.`)
    process.exit(1)
  }

  if (SAMPLE) {
    const a = toEn.slice(0, SAMPLE), b = toVi.slice(0, SAMPLE)
    const ea = a.length ? await translate(a.map(srcEn), 'vi', 'en') : []
    const eb = b.length ? await translate(b.map((r) => r.title), 'vi', 'en') : []
    console.log('\n── vi -> en ──')
    a.forEach((r, i) => console.log(`  ${gate(srcEn(r), ea[i], 'en', 'vi') ?? 'ok'}\t${srcEn(r)}\n\t\t-> ${ea[i]}`))
    console.log('\n── no-diacritic, vi -> en ──')
    b.forEach((r, i) => console.log(`  ${gateNoDiacritics(r.title, eb[i]) ?? 'ok'}\t${r.title}\n\t\t-> ${eb[i]}`))
    console.log('\nSAMPLE — nothing written.'); await db.$disconnect(); return
  }
  if (!APPLY) { console.log('\nDRY RUN — no API calls made. --sample N to preview, --apply to write.'); await db.$disconnect(); return }

  const en = toEn.length ? await translate(toEn.map(srcEn), 'vi', 'en') : []
  const vi = toVi.length ? await translate(toVi.map((r) => r.title), 'vi', 'en') : []
  const fix = toFix.length ? await translate(toFix.map((r) => applyViSourceTerms(r.titleVi!)), 'vi', 'en') : []

  /**
   * ⚠️ PURGE IN `finally`, NOT AFTER THE LOOPS. A throw part-way leaves the rows written so far committed;
   * without this they stay behind stale caches, and a re-run selects nothing and so purges nothing
   * (external review). --purge remains the manual escape hatch.
   */
  let written = 0, raced = 0
  try {
  const rejects: Record<string, number> = {}
  const rejectSamples: string[] = []

  const write = async (r: Row, data: { title?: string; titleVi?: string }) => {
    if (await writeOne(r, data)) written++; else raced++
    if ((written + raced) % 250 === 0) console.log(`  written ${written}, raced ${raced}`)
  }

  for (let i = 0; i < toEn.length; i++) {
    const r = toEn[i], src = srcEn(r), hyp = en[i]
    const why = gate(src, hyp, 'en', 'vi')
    if (why) { rejects[`vi->en ${why}`] = (rejects[`vi->en ${why}`] ?? 0) + 1; if (rejectSamples.length < 12) rejectSamples.push(`[${why}] ${src}  ->  ${hyp}`); continue }
    // Fill an empty titleVi with the original BEFORE the English replaces it, or it is lost.
    await write(r, { title: hyp, ...(r.titleVi && r.titleVi.trim() ? {} : { titleVi: r.title }) })
  }
  for (let i = 0; i < toVi.length; i++) {
    const r = toVi[i], hyp = vi[i]
    const why = gateNoDiacritics(r.title, hyp)
    // Echoed: the name has no other form, so it is its own Vietnamese.
    if (why === 'untranslated') { if (!(r.titleVi && r.titleVi.trim())) await write(r, { titleVi: r.title }); continue }
    if (why) { rejects[`nodiac ${why}`] = (rejects[`nodiac ${why}`] ?? 0) + 1; if (rejectSamples.length < 12) rejectSamples.push(`[${why}] ${r.title}  ->  ${hyp}`); continue }
    // Translated: it WAS Vietnamese. The original becomes titleVi, the translation the English slot.
    await write(r, { title: hyp, ...(r.titleVi && r.titleVi.trim() ? {} : { titleVi: r.title }) })
  }

  for (let i = 0; i < toFix.length; i++) {
    const r = toFix[i], src = applyViSourceTerms(r.titleVi!), hyp = fix[i]
    const why = gate(src, hyp, 'en', 'vi')
    if (why) {
      // A rejected repair must not leave the known-wrong English standing — swap just that phrase.
      rejects[`repair ${why} -> phrase swap`] = (rejects[`repair ${why} -> phrase swap`] ?? 0) + 1
      if (rejectSamples.length < 12) rejectSamples.push(`[${why}] ${src}  ->  ${hyp}`)
      const swapped = repairKnownMistranslation(r.titleVi!, r.title)
      if (swapped !== r.title) await write(r, { title: swapped })
      continue
    }
    await write(r, { title: hyp })
  }

  console.log(`\nAPPLIED: ${written} written, ${raced} raced (changed since read, left alone)`)
  console.log('rejected by the gate (left untouched):', Object.keys(rejects).length ? rejects : 'none')
  rejectSamples.forEach((s) => console.log('  ' + s))
  } finally {
    if (written || FORCE_PURGE) await purgeCaches()
    await db.$disconnect()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
