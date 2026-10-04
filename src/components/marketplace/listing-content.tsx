'use client'

import { useEffect, useId, useState } from 'react'
import { RelativeTime } from './relative-time'
import { useLanguage, useTr } from '@/context/language-context'
import { VI_PASSAGE_LABEL, detectContentLang, looksVietnamese, mayBeVietnamese, readsAsVietnamese } from '@/lib/detect-lang'
import { trCache, translateText } from '@/lib/i18n/mt-client'
import { formatRichText } from '@/components/marketplace/rich-text'
import { Button } from '@/components/ui/button'

/**
 * Client-side localized listing title — mirrors the card: Vietnamese uses the
 * hand-authored titleVi, every other language machine-translates the source title
 * (from the warm cache). Lets the listing page be statically/ISR-rendered (no
 * per-request server translation) while still showing in-language content.
 */
/**
 * Localized listing content (title/description/location). Prefers an EMBEDDED translation
 * (`i18n[lang]`, pre-warmed + baked into the ISR page) so it renders the visitor's language
 * SYNCHRONOUSLY with no flash and no network call. Falls back to the client machine-translate
 * (useTr) only when the embed is missing — so it's always at least as good as before.
 */
/** The localized STRING: embedded translation first (synchronous), else client machine-
 *  translate. Use when you need the text value (e.g. an alt attribute), not a node.
 *
 * ⛔ THE AUTHORED VIETNAMESE COLUMN ALWAYS WINS FOR A VIETNAMESE READER. This used to ask "is the
 * source already Vietnamese?" FIRST, with detectContentLang — which names a text Vietnamese on ONE
 * exclusive letter. So an English import title that names its ward ("Office / shopfront · 65 m² for
 * rent — Tây Thạnh Ward", ạ) counted as Vietnamese and beat the titleVi the importer had written
 * beside it ("Cho thuê Mặt bằng kinh doanh 65m² — Phường Tây Thạnh"): 22 of the 48 cards on vi
 * /c/rentals rendered English, and the rental PDP's description read "Listed on Muaban.net …" under
 * "Mô tả" although its descriptionVi existed (measured 2026-09-29). A `vi` is only ever written by an
 * importer, backfill-bilingual or an admin, and an edit of the source nulls it
 * (core/listings.ts), so it cannot be stale Vietnamese for a newer text.
 *
 * EN is a translation TARGET too (user decision 2026-07-14): a Vietnamese-authored text must
 * render in English under the EN UI. Script detection gates it so English source text never
 * round-trips — and a TITLE that sits beside a DIFFERENT titleVi is the English slot of a bilingual
 * row (translate.ts sourceLangFor: `title` is the English column, `titleVi` the Vietnamese one) even
 * when it names "Tây Thạnh Ward". Those were sent to English→English machine translation, one
 * request per card (22 on en /c/rentals).
 * ⛔ THAT RULE IS THE SCHEMA'S, NOT A GUESS AT THE TEXT — and it is measured: of the 15,648 active rows
 * whose title carries a Vietnamese-exclusive letter beside a different titleVi, EVERY ONE is English
 * (rental importers, Tiki's English names; read-only sample, 2026-09-29). A shape test stacked on top
 * ("the title must not also LOOK Vietnamese") caught no Vietnamese title there and 2,684 English ones
 * — "300 m² for rent — Tân Định Ward (new), District 1" runs only 3 unmarked words — and sent those
 * straight back to English→English translation, so it was removed.
 * ⛔ A DESCRIPTION GETS THE SAME RULE, WITH THREE GUARDS (2026-10-02). 16,418 English rental descriptions
 * ("Ward: Phú Thuận Ward") sat beside a proper descriptionVi and were still sent to vi→en translation,
 * one paid request per first English view, and 1,650 had been paid for as English→English. A
 * description beside a different descriptionVi is the English slot unless one of these holds:
 *  · it looks Vietnamese by shape (looksVietnamese);
 *  · it shares ≥70% of its words with the column beside it. One computer shop's spec sheets hold the
 *    scraped Vietnamese original ("Hãng sản xuất: Dell · Model: P2723D · Kích thước màn hình …") in
 *    `description` and a re-labelled copy in descriptionVi. A copy shares about 90% of its words; the
 *    English slots share at most 60%;
 *  · it carries an importer's "(Vietnamese):" label (detect-lang VI_PASSAGE_LABEL). Mioto and BonbonCar
 *    embed the owner's Vietnamese text that way when no English for it is cached.
 * Measured on the 77,990 live descriptions shown on a PDP: English sent to translation for an English
 * reader fell from 20,503 to 2,606, and 2,322 of those carry the label. No rental that stopped
 * translating is anything but English. Vietnamese shown raw to an English reader fell from 210 to 23,
 * with the broader mayBeVietnamese entry below.
 *
 * ⛔ `'english'` — A TEXT THE SCHEMA SAYS IS ENGLISH-AUTHORED, SO NO LETTER IN IT IS EVIDENCE. An official
 * help answer: sync-help-center.ts writes the English seed as the post and caches its authored
 * Vietnamese twin in the Translation cache. 10 of the 40 seeded bodies carry a letter the detector
 * reads as foreign ("12.000.000 đ", "Cảm ơn: thank you", "한국어" in the language list), and under the
 * per-letter rule each one was sent to /api/translate target=en tagged vi or ko — fluent, wrong
 * English swapped in after hydration (translate.ts sourceLangFor) — while a Vietnamese reader was
 * shown the English body AS the Vietnamese one, over the curated twin in the embed (review,
 * 2026-09-29). So: the English reader gets the text, every other reader the embed, else useTr.
 */
export type LocalizedColumn = 'title' | 'description' | 'english'

/**
 * useLocalized's decision, pure so it can be asserted on without rendering (listing-content.test.tsx).
 * `en` is the ONLY text that reaches /api/translate with target=en (useMachineEn); `tr` goes to useTr,
 * which never targets English. '' means no request.
 */
export function localizedPlan(
  text: string,
  vi: string | null | undefined,
  i18n: Record<string, string> | null | undefined,
  lang: string,
  column: LocalizedColumn = 'title',
): { embedded: string | null; tr: string; en: string } {
  let embedded: string | null
  if (column === 'english') {
    embedded = lang === 'en' ? text : lang === 'vi' ? (vi || i18n?.vi || null) : (i18n?.[lang] || null)
  } else if (column === 'description') {
    const srcLang = detectContentLang(text)
    // A Hangul, Han or Cyrillic text really is in that script, whatever sits beside it.
    const otherScript = !!srcLang && srcLang !== 'vi'
    const englishSlot =
      !!vi && sameText(vi) !== sameText(text) && !looksVietnamese(text) && !text.includes(VI_PASSAGE_LABEL) && sharedWordShare(text, vi) < 0.7
    embedded =
      lang === 'en'
        ? (otherScript || (mayBeVietnamese(text) && !englishSlot) ? (i18n?.en || null) : text)
        : lang === 'vi'
          // Already Vietnamese by the dominance test, not by one letter (detect-lang readsAsVietnamese).
          ? (vi || (readsAsVietnamese(text) ? text : i18n?.vi || null))
          : (i18n?.[lang] || null)
  } else {
    const srcLang = detectContentLang(text)
    // Only the Vietnamese answer can be a false positive (one letter decides it); a Hangul, Han or
    // Cyrillic text really is in that script, so it keeps the translate path whatever sits beside it.
    const englishSlot = srcLang === 'vi' && !!vi && sameText(vi) !== sameText(text)
    embedded =
      lang === 'en'
        ? (srcLang && !englishSlot ? (i18n?.en || null) : text)
        : lang === 'vi'
          ? (vi || (srcLang === 'vi' ? text : i18n?.vi || null))
          : (i18n?.[lang] || null)
  }
  return {
    embedded,
    tr: embedded || lang === 'en' ? '' : lang === 'vi' ? vi || text : text,
    en: !embedded && lang === 'en' ? text : '',
  }
}

export function useLocalized(
  text: string,
  vi?: string | null,
  i18n?: Record<string, string> | null,
  column: LocalizedColumn = 'title',
): string {
  return useLocalizedSource(text, vi, i18n, column).out
}

/**
 * useLocalized, plus WHETHER what it returned is a machine translation (pdp-05): an embedded `i18n`
 * value or a useTr / useMachineEn answer, rather than the author's own text or the authored `vi`
 * column. That is the reader's cue to see the original — Facebook, Shopee and Airbnb all say so.
 * ⚠️ "Different from both columns" is the test, not "came from the embed": the embed for a reader
 * whose language the text is already in IS the text, and a translation that came back unchanged is
 * not one.
 */
export function useLocalizedSource(
  text: string,
  vi?: string | null,
  i18n?: Record<string, string> | null,
  column: LocalizedColumn = 'title',
): { out: string; machine: boolean; asked: string } {
  const { lang } = useLanguage()
  const plan = localizedPlan(text, vi, i18n, lang, column)
  // useTr is a hook → always called; '' is a no-op, so we skip translation when embedded.
  const translated = useTr(plan.tr)
  const mtEn = useMachineEn(plan.en)
  const served = plan.embedded || (lang === 'en' ? mtEn : translated)
  // `asked`: the text a CLIENT translation was requested for ('' when none) — what useNoteReserve waits on.
  return { out: served || text, machine: !!served && served !== text && served !== vi, asked: lang === 'en' ? plan.en : plan.tr }
}

/**
 * Should the note's line be HELD (MachineTranslationReserve)? While the client translation of `asked` is
 * out, the note may still arrive. Only the PDP's H1 and description ask — never a card or a location
 * (useLocalized), which show no note.
 * ⚠️ Not for a Vietnamese-looking text and a Vietnamese reader: translateText answers that one with itself
 * at once, so no note can follow.
 */
function useNoteReserve(asked: string, machine: boolean): boolean {
  const { lang } = useLanguage()
  const awaiting = useAwaitingTranslation(asked && !(lang === 'vi' && looksVietnamese(asked)) ? asked : '', lang)
  return !machine && awaiting
}

/**
 * Is a client translation of `text` still out? True from the server render until the batch that carries
 * it answers (or fails).
 * ⚠️ It rides the SAME batcher call useTr / useMachineEn make, in the same 60ms window, so the request
 * carries the text once (mt-client flush dedupes); a cached answer is no request at all. Both answers land
 * from one flush, so React renders the note and drops the reserve in ONE commit — no frame without either.
 */
function useAwaitingTranslation(text: string, lang: Parameters<typeof translateText>[1]): boolean {
  const key = `${lang} ${text}`
  const [answered, setAnswered] = useState<string | null>(null)
  useEffect(() => {
    if (!text || trCache.get(key) != null) { setAnswered(key); return }
    let off = false
    translateText(text, lang).then(() => { if (!off) setAnswered(key) })
    return () => { off = true }
  }, [text, lang, key])
  return !!text && answered !== key
}

/** The language an ORIGINAL is in, for its `lang` attribute: what the script says, else English when the
 *  reader's language is not (an unmarked Latin text a non-English reader got translated is English). */
function originalLang(text: string, lang: string): string | undefined {
  return detectContentLang(text) ?? (lang === 'en' ? undefined : 'en')
}

/**
 * "Translated · See original" — under a machine-translated H1 and above a machine-translated
 * description (pdp-05 / auth-10 / quality-09), the messenger's pattern (messages/[id]/page.tsx, "Xem
 * bản gốc" under a translated bubble). The toggle is the reader's; nothing is stored.
 * ⚠️ A `ui/button` link, not a bare <button>: Base UI is the house library. `relative tap-44` — the
 * line is 12px text, and tap-44's ::before needs a positioned host (globals.css).
 * ⚠️ NO `aria-pressed`: the LABEL says the state ("See original" ↔ "See translation"), as the
 * messenger's does. A toggle that changes its label AND reports pressed reads "See translation, pressed"
 * — two answers to one question (WAI-ARIA APG: a toggle's label must not change with its state).
 */
export function MachineTranslationNote({ original, onToggle, className }: { original: boolean; onToggle: () => void; className?: string }) {
  const { tr } = useLanguage()
  return (
    <p className={`text-xs text-muted-foreground${className ? ` ${className}` : ''}`}>
      {tr('Translated', 'Đã dịch tự động')}
      {' · '}
      <Button variant="link" size="none" onClick={onToggle} className="relative tap-44 text-xs font-semibold text-accent-foreground">
        {original ? tr('See translation', 'Xem bản dịch') : tr('See original', 'Xem bản gốc')}
      </Button>
    </p>
  )
}

/**
 * ⛔ THE NOTE'S LINE IS HELD WHILE A CLIENT TRANSLATION IS OUT (review, 2026-10-04). With no embedded
 * translation the note can only appear once /api/translate answers — after hydration — and arriving it
 * pushed the first screen down ~24px under a reader already looking at it. This is the same text-xs line,
 * invisible and out of the accessibility tree, in the server HTML too; the note takes its place. If the
 * answer comes back unchanged (nothing was translated) the line goes, as the note would never have come.
 */
function MachineTranslationReserve() {
  return <p aria-hidden data-mt-reserve="" className="invisible text-xs">{'\u00a0'}</p>
}

/**
 * The PDP's single H1, localized, with the "Translated · See original" line under it when the title on
 * screen is a machine translation. The original is marked with its own `lang`.
 * `data-fab-avoid`: the support bubble yields over the end of the title (si-11; back-to-top.tsx).
 */
export function LocalizedTitleHeading({ title, titleVi, i18n, className }: { title: string; titleVi: string | null; i18n?: Record<string, string> | null; className?: string }) {
  const { lang } = useLanguage()
  const { out, machine, asked } = useLocalizedSource(title, titleVi, i18n)
  const reserve = useNoteReserve(asked, machine)
  const [original, setOriginal] = useState(false)
  const showOriginal = machine && original
  const shown = showOriginal ? title : out
  const cl = showOriginal ? originalLang(title, lang) : detectContentLang(shown)
  return (
    <>
      <h1 data-fab-avoid className={className}>{cl && cl !== lang ? <span lang={cl}>{shown}</span> : shown}</h1>
      {machine ? <MachineTranslationNote original={original} onToggle={() => setOriginal((o) => !o)} /> : reserve ? <MachineTranslationReserve /> : null}
    </>
  )
}

// Client translate INTO English for cache-miss non-EN content (the embed covers warmed content;
// this is the same fallback role useTr plays for other languages, which by design never targets EN).
// ⚠️ THROUGH THE SHARED BATCHER (mt-client translateText), NOT A FETCH PER TEXT: every card on a
// feed page used to post its own single-text request (5 on en home, 22 on en /c/rentals,
// 2026-09-29). The batcher sends one request per 60ms window with each text once, and its trCache
// (`en <text>`) shares a result across every card that shows the same text.
function useMachineEn(text: string): string {
  const [val, setVal] = useState('')
  useEffect(() => {
    if (!text) { setVal(''); return }
    const hit = trCache.get(`en ${text}`)
    if (hit) { setVal(hit); return }
    let off = false
    translateText(text, 'en').then((out) => { if (!off && out) setVal(out) })
    return () => { off = true }
  }, [text])
  return val
}

export function LocalizedText({ text, vi, i18n }: { text: string; vi?: string | null; i18n?: Record<string, string> | null }) {
  const { lang } = useLanguage()
  const out = useLocalized(text, vi, i18n)
  const cl = detectContentLang(out)
  return cl && cl !== lang ? <span lang={cl}>{out}</span> : <>{out}</>
}

export function LocalizedTitle({ title, titleVi, i18n }: { title: string; titleVi: string | null; i18n?: Record<string, string> | null }) {
  return <LocalizedText text={title} vi={titleVi} i18n={i18n} />
}

/**
 * The same light-markdown rendering as a listing description, for any OTHER piece of
 * user-authored prose — today the storefront bio.
 *
 * ⚠️ IT EXISTS BECAUSE THE FORMATTER WAS PRIVATE TO ONE CALL SITE AND THE PROBLEM WAS NOT.
 * Sellers write bios in exactly the register they write descriptions in: blank-line paragraphs,
 * "✓"/"-" lines, **bold** on the thing that matters. The storefront rendered that through a bare
 * `<p>`, where HTML collapses every newline and the asterisks show as literal characters — so a
 * bio authored as seven lines with two bold phrases arrived as one grey block containing "**".
 * Measured on the live data: 1 of 3 seller bios carries `**` and newlines, and 14 of 15 active
 * listing descriptions carry bullet lines, which is why the listing side grew this formatter first.
 *
 * ⚠️ BLOCK ELEMENTS, SO THE CALLER MUST NOT BE A <p>. formatRichText emits <p>/<ul>/<ol>, and a
 * <div> inside a <p> is invalid HTML that React hydrates into a different tree than the server
 * rendered — the caller was a <p> and had to become a <div>.
 *
 * ⚠️ TRANSLATE FIRST, FORMAT SECOND. useTr returns the translated STRING, and the markers survive
 * translation, so the structure is parsed from whatever language the reader is actually seeing —
 * formatting first would hand the translator a React tree it cannot take.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const { lang } = useLanguage()
  const out = useTr(text) || text
  const cl = detectContentLang(out)
  return (
    <div lang={cl && cl !== lang ? cl : undefined} className={`allow-select${className ? ` ${className}` : ''}`}>
      {formatRichText(out)}
    </div>
  )
}

/**
 * The description's Vietnamese column, or null when it is not a Vietnamese description at all.
 *
 * ⚠️ A FEED WITH ONE TEXT WRITES IT INTO BOTH COLUMNS (import-accesstrade / import-partners store the
 * feed description as both; import-supersports falls back `descriptionVi = viBody || enBody`). Where
 * that text is English — 1,922 stored descriptions on 2026-09-24 — useLocalized, which prefers `vi`
 * over the translation cache for a Vietnamese reader, showed that reader the English text and never
 * asked for a translation. So a `vi` that is the source text itself, when the source is not
 * Vietnamese, is treated as absent: the reader gets the cached (else client machine)
 * Vietnamese translation, exactly as for a listing with no descriptionVi. A Vietnamese source keeps
 * it — there the copy IS the Vietnamese text.
 *
 * ⚠️ "Not Vietnamese" is readsAsVietnamese's answer (detect-lang.ts), not detectContentLang's: one letter
 * made "…beans from Đắk Lắk" Vietnamese, so a copy of it in both columns showed a Vietnamese reader the
 * English (2026-10-02). ⚠️ THE KNOWN COST, CHOSEN: Vietnamese typed WITHOUT marks ("Giay chay bo nhe") has
 * nothing that detector can see, so an identical copy of it takes the translation path too: the
 * reader gets a Vietnamese→Vietnamese translation of the seller's text instead of the text itself. A
 * narrower "is it English?" test was tried in review (2026-09-24) and every version of it either
 * missed plain English ("Brand new. Never used.") or dropped Vietnamese that carried two English
 * words ("Cap sac for iPhone and Samsung"): a new edge each round, so the simple rule stands.
 *
 * ⛔ DESCRIPTIONS ONLY. A titleVi equal to the title is usually deliberate — an English book or
 * product name the Vietnamese shelf lists as-is — so LocalizedTitle keeps today's behaviour.
 */
export function ownDescriptionVi(text: string, vi: string | null | undefined): string | null {
  if (!vi || !text) return vi || null
  const src = sameText(text)
  const same = vi === text || sameText(vi) === src
  // Detected on the NFC form: the detector knows Vietnamese by its PRECOMPOSED letters (ơ, ư, đ …),
  // and a column stored NFD would otherwise read as plain Latin (opus, review round 2).
  return same && !readsAsVietnamese(src) ? null : vi
}
/** The same text whatever the column's Unicode form, line endings or outer whitespace. */
const sameText = (s: string) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim()

const words = (s: string) => s.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
/** The share of `text`'s words that also occur in `other`: about 0.9 for a re-labelled copy, at most
 *  0.6 for a translation (the shared part is numbers and place names). */
function sharedWordShare(text: string, other: string): number {
  const mine = words(text)
  if (!mine.length) return 0
  const theirs = new Set(words(other))
  return mine.filter((w) => theirs.has(w)).length / mine.length
}

/** Localized listing description rendered with light markdown (bullets / bold / paragraphs). */
export function ListingDescription({ text, vi, i18n, className }: { text: string; vi?: string | null; i18n?: Record<string, string> | null; className?: string }) {
  const { lang, tr } = useLanguage()
  // ⚠️ `vi` WAS HARDCODED null HERE while the heading passed titleVi through the same hook — so a
  // listing stored in two languages showed its title correctly and its description always in the
  // primary one. The slot existed; nothing was filling it.
  const { out, machine, asked } = useLocalizedSource(text, ownDescriptionVi(text, vi), i18n, 'description')
  const reserve = useNoteReserve(asked, machine)
  const [original, setOriginal] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const showOriginal = machine && original
  const shown = showOriginal ? text : out
  const cl = showOriginal ? originalLang(text, lang) : detectContentLang(shown)
  /**
   * ⛔ A LONG DESCRIPTION IS CLAMPED TO 8 LINES BELOW md, WITH "See more" (pdp-04 part A). A 2,000-character
   * import pushed Details, the seller and the map a dozen screens down on a phone. The full text stays in
   * the SSR DOM — clamped by CSS only, so crawlers, find-in-page and screen readers still get all of it —
   * and from md up nothing is clamped and the button does not exist (`md:hidden`, `max-md:` clamp).
   * ⚠️ HAND-ROLLED, NOT Base UI Collapsible: its Panel HIDES the closed content outright, and a clamp has
   * to SHOW the first eight lines. The trigger is still a ui/button with aria-expanded + aria-controls.
   */
  // Long by characters, OR by lines: twenty short lines under 600 characters still run far past 8 on a phone.
  const clampable = shown.length > DESCRIPTION_CLAMP_CHARS || shown.split('\n').length > DESCRIPTION_CLAMP_LINES
  // `allow-select`: keep the description selectable/copyable in the native app, where chrome
  // selection is disabled (globals.css html.native). Content text is the exception users need.
  return (
    <>
      {machine ? <MachineTranslationNote original={original} onToggle={() => setOriginal((o) => !o)} /> : reserve ? <MachineTranslationReserve /> : null}
      <div id={id} lang={cl && cl !== lang ? cl : undefined} className={`allow-select${className ? ` ${className}` : ''}${clampable && !expanded ? ' max-md:line-clamp-8' : ''}`}>{formatRichText(shown)}</div>
      {clampable && (
        <Button variant="link" size="none" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((e) => !e)} className="relative tap-44 w-fit text-sm font-semibold text-accent-foreground md:hidden">
          {expanded ? tr('See less', 'Thu gọn') : tr('See more', 'Xem thêm')}
        </Button>
      )}
    </>
  )
}

/** Past this many characters a description is clamped below md (~8 lines at the phone measure). */
export const DESCRIPTION_CLAMP_CHARS = 600
/** …or past this many written lines, whatever their length (the clamp itself is 8 rendered lines). */
export const DESCRIPTION_CLAMP_LINES = 8

/** Relative "x ago" in the active language (client — keeps the page cacheable).
 *  Hydration-stable: see RelativeTime — the clock is never read before mount. */
export function PostedAgo({ iso }: { iso: string }) {
  return <RelativeTime iso={iso} />
}
