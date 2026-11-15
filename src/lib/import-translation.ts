/**
 * THE RULES OF scripts/translate-imports-haiku.ts — pure, no I/O, tested in import-translation.test.ts (commit gate round 15,
 * opus: "200 lines of new rules that decide what a buyer reads about a used item, and nothing tests it").
 *
 * ⛔ THE MODEL TRANSLATES ONLY WHAT CODE CANNOT WRITE. The facts a buyer relies on — badges, warranty, store — are written
 * by code from a table; the model sees the rest (for Hoàng Hà: the spec line) and the title without its "TBH" token, and
 * its answer is judged line by line. What no check can prove is the WORDING of the model's own lines (it may still render
 * "Máy trần" as something other than "Phone only") — the residual of any machine translation, shown with the original a
 * tap away; the rules make sure it can never speak of a warranty, drop a negation, move a number or claim new goods.
 */
export const VI_RE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i
export const NEW_CLAIM = /\bbrand[\s-]*new\b|\b(?:factory[\s-]*)?sealed\b|\bunopened\b|\bnew\s+in\s+box\b|\bfactory[\s-]*new\b/i
/** "New" on its own is a new-goods claim too ("New iPhone 13" — commit gate, codex); only the condition "like-new" may say it. */
export const saysNew = (s: string) => NEW_CLAIM.test(s) || /\bnew\b/i.test(s.replace(/\blike[\s-]+new\b/gi, ''))
/** NFC first: VI_RE lists precomposed letters, so a decomposed (NFD) Vietnamese answer would otherwise pass as English. */
export const isVietnamese = (s: string | null | undefined) => !!s && VI_RE.test(s.normalize('NFC'))
/** The non-empty lines of a text, trimmed — one fact each in a crawl description. */
export const factLines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
export const numList = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'))
/** The numbers of a text as a set (a title may reorder its words) … */
export const nums = (s: string) => numList(s).sort().join(' ')
/** … and IN ORDER within one line (commit gate round 14, codex: "8GB RAM · 256GB" may not become "256GB RAM · 8GB"). */
export const numSeq = (s: string) => numList(s).join(' ')
/** A negation on a model line must survive, and none may appear (round 14, codex: "KHÔNG" → "Accessories included"). */
// Negations AND defect words (round 18, codex + opus: "Mất Face ID" / "Lỗi loa" dropped with no negation word at all; round
// 19: "Vỡ màn", "trầy xước"). "không dây" = wireless, not a negation.
export const VI_NEG = /(?<![\p{L}])(?:không(?!\s+dây(?!\s+(?:sạc|cáp)))|ko|chưa|hết|mất|lỗi|thiếu|hư|hỏng|chẳng|vỡ|bể|nứt|móp|trầy|xước|cấn|sọc|ám|rạn|bong|ố)(?![\p{L}])/iu
/** …and their English: negations, contractions ("isn't" — round 19: `\bn't\b` never matched one) and defects. */
export const EN_NEG = /\b(?:no|not|none|without|missing|excluded|lacks?|lost|faulty|broken|defect\w*|damag\w*|dead|cracked|crack|chipped|dent(?:s|ed)?|scratch\w*|scuff\w*|stain(?:s|ed)?|peel\w*|worn|burn-?in|shattered|\w+n't)\b/i
/** Each amount with ITS currency, in order (round 18, codex: two amounts in one item could swap currencies). */
export const currencies = (s: string) => [...s.matchAll(/(\d[\d.,]*)\s*(đ|vnđ|vnd|usd|\$)(?![\p{L}])/giu)]
  .map((m) => `${m[1].replace(/[.,]/g, '')}${/^(?:đ|vnđ|vnd)$/iu.test(m[2]) ? 'VND' : 'USD'}`).join(' ')
/** The parts of an item ("Không sạc, có cáp"): a negation or defect stays on ITS part (round 19, codex + opus: counting per item
 * let "no charger, has cable" become "charger, no cable"). A comma inside a number ("1,5") is not a break. */
const parts = (s: string) => s.normalize('NFC').split(/,\s+|;\s*/)
/** A source may carry English words of its own ("no box") — they negate too ("Stainless" does not — round 21). */
const viNegated = (s: string) => VI_NEG.test(s.normalize('NFC')) || EN_NEG.test(s)
/** Negated (or defective) on both sides or on neither: part by part when the parts line up, else for the whole item — comma
 * counts differ between the languages ("Hộp, Sạc,Cáp" / "Box, charger, cable"), and refusing those refused correct English. */
export const sameNegations = (vi: string, en: string) => {
  const v = parts(vi), e = parts(en)
  if (v.length === e.length) return v.every((p, k) => viNegated(p) === EN_NEG.test(e[k]))
  // Parts that do not line up cannot show WHERE a negation went (round 22, codex + opus: "Không sạc, có cáp" → "Charger and
  // no cable"): refused when the source has several parts and any is negated; otherwise compared for the whole item.
  if (v.length > 1 && v.some(viNegated)) return false
  return viNegated(vi) === EN_NEG.test(en)
}
/**
 * ⛔ THE MODEL TRANSLATES ONLY WHAT CODE CANNOT WRITE (commit gate rounds 8–13, codex + opus). A crawl description is one fact
 * per line, and the facts a buyer relies on are written by CODE:
 *   · a line made only of known " · " segments — the badges and the warranty forms (SEGMENTS; Hoàng Hà, measured 11-15: 57
 *     warranty shapes, ~95 % of lines covered) — is rendered from the table;
 *   · the store line is "Store: " + the address without diacritics (no Vietnamese letters, never translated into other words);
 *   · any OTHER line that speaks of a warranty refuses the row before the model is asked (it stays Vietnamese — true — and is
 *     listed for a human).
 * The model sees only the remaining lines (for Hoàng Hà: the spec line) and the title without its "TBH" token; its answer must
 * have the same number of lines with the same numbers each, name no warranty (any guard over its English — "no accessories ·
 * 6-month warranty" vs "no 6-month warranty", "not yet activated" vs "no warranty" — had a new hole every round), and be
 * English with no new-goods wording. The script assembles the result in the source's order with the source's breaks.
 */
export const HH = '(?:hoàng hà(?: mobile)?|hoanghamobile)'
export const months = (n: string) => `${n} ${n === '1' ? 'month' : 'months'}`
export const SEGMENTS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^hàng cũ$/iu, () => 'Used'],
  [/^mới (\d{1,3})%$/iu, (m) => `${m[1]}% like-new`],
  [/^trôi (?:bảo hành|bh)$/iu, () => 'Warranty already started'],
  [/^còn bảo hành$/iu, () => 'Still under warranty'],
  [/^không bảo hành$/iu, () => 'No warranty'],
  [/^không bảo hành pin$/iu, () => 'No battery warranty'],
  [/^(?:bảo hành )?(\d{1,2}) tháng$/iu, (m) => `Warranty ${months(m[1])}`],
  [new RegExp(`^(?:bảo hành )?(\\d{1,2}) tháng (?:tại )?${HH}$`, 'iu'), (m) => `Warranty ${months(m[1])} at Hoang Ha Mobile`],
  [new RegExp(`^bảo hành ${HH} (\\d{1,2}) tháng$`, 'iu'), (m) => `Warranty ${months(m[1])} at Hoang Ha Mobile`],
  [/^bảo hành đến (\d{2}\/\d{2}\/\d{4})$/iu, (m) => `Warranty until ${m[1]}`],
  [new RegExp(`^bh ${HH}$`, 'iu'), () => 'Warranty: Hoang Ha Mobile'],
]
/** A line that speaks of a warranty: "bảo hành", "BH"/"TBH"/"trôi", or a number of months ("6 tháng" — not "tháng 3/2024"). */
export const NAMES_WARRANTY = /bảo hành|(?:^|[^\p{L}])(?:bh|tbh|trôi)(?![\p{L}])|\d\s*tháng/iu
/** Vietnamese letters to their plain Latin base ("Đống Đa" → "Dong Da"), the usual English spelling of a place. */
export const latin = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFC')
export const STORE_LINE = /^\s*cửa hàng\s*:\s*(.+)$/iu
/** A store line's text must be a street ADDRESS — a house number first, no warranty word (round 14, opus: "Cửa hàng: Bảo hành
 * chính hãng 24 tháng" would have shipped as "Store: Bao hanh chinh hang 24 thang"); anything else refuses the row. */
export const ADDRESS = /^(?:số\s+)?\d[^\n]{0,59}$/iu
/** Condition, warranty and goods words, in Vietnamese (round 15, opus: "48 Đống Đa máy mới nguyên hộp")… */
export const ADDRESS_NOT = /bảo hành|(?:^|[^\p{L}])(?:bh|tbh|trôi|mới|cũ|seal|hộp|máy|fullbox)(?![\p{L}])|%/iu
/** …and written without diacritics — phrases only: single plain words collide with names ("Hợp" → "Hop", "hộp" → "hop"). */
export const ADDRESS_NOT_LATIN = /bao hanh|nguyen (?:hop|seal)|(?:^|[^\p{L}])seal(?![\p{L}])|full ?box/iu
export const isAddress = (a: string) => ADDRESS.test(a.trim()) && !ADDRESS_NOT.test(a.normalize('NFC')) && !ADDRESS_NOT_LATIN.test(latin(a)) && a.trim().split(/\s+/).length <= 9
export const speaksOfWarranty = (vi: string) => { const v = vi.normalize('NFC'); return !STORE_LINE.test(v) && NAMES_WARRANTY.test(v) }
/** "TBH" / "Trôi bảo hành" in a TITLE — the one warranty token a title may carry (284 Hoàng Hà titles, measured 11-15). */
// A lookBEHIND, so taking the token out never takes the character before it (round 17, codex: "iPhone 13TBH" → "iPhone 1");
// letters AND digits are boundaries ("13TBH" carries no token — and its "TBH" refuses the row as other warranty wording).
export const TBH_TOKEN = /(?<![\p{L}\p{N}])(?:tbh|trôi (?:bảo hành|bh))(?![\p{L}\p{N}])/iu
/** The source line rendered by code, or null when any of its segments is not in the table. */
export function renderKnown(vi: string): string | null {
  const out: string[] = []
  for (const seg of vi.normalize('NFC').split(/\s+·\s+/)) {
    const hit = SEGMENTS.map(([re, f]) => { const m = seg.trim().match(re); return m ? f(m) : null }).find((x) => x != null)
    if (hit == null) return null
    out.push(hit)
  }
  return out.join(' · ')
}
export const storeLine = (address: string) => `Store: ${latin(address.normalize('NFC').trim().replace(/^số\s+(?=\d)/iu, 'No. '))}`
export const EN_WARRANTY = /warrant|guarantee|coverage|covered|insur/i

/** How a source description is written: each line by code or by the model, the source's break before each line, or why not. */
export type Plan = { lines: ({ code: string } | { vi: string })[]; refuse: string | null }
export function planOf(source: string): Plan {
  const lines: Plan['lines'] = []
  let refuse: string | null = null
  for (const vi of factLines(source.normalize('NFC'))) {
    const known = renderKnown(vi)
    const store = STORE_LINE.exec(vi)
    if (known != null) lines.push({ code: known })
    else if (store) {
      if (!isAddress(store[1])) refuse ??= 'store line is not an address'
      lines.push({ code: storeLine(store[1]) })
    } else if (speaksOfWarranty(vi)) { refuse ??= 'warranty line not in the table'; lines.push({ vi }) }
    else lines.push({ vi })
  }
  // Lines the model translates must be told apart by their numbers, or their order cannot be verified (round 13, codex) — a
  // property of the SOURCE, so the row goes to a human before the model is asked (round 14, opus).
  const model = lines.flatMap((l) => ('vi' in l ? [numSeq(l.vi)] : []))
  if (new Set(model).size !== model.length) refuse ??= 'line order not verifiable'
  return { lines, refuse }
}
/** The lines the model translates, one per line. */
export const modelText = (p: Plan) => p.lines.flatMap((l) => ('vi' in l ? [l.vi] : [])).join('\n')
/** The description as written: code's lines and the model's in the source's order, EACH FACT ITS OWN PARAGRAPH (round 14,
 * codex: the page joins the lines of one paragraph with a space — "No accessories Warranty 6 months"). */
export function assemble(p: Plan, en: string[]): string {
  let k = 0
  return p.lines.map((l) => ('code' in l ? l.code : en[k++])).join('\n\n')
}

/** The title the model sees: the "TBH" token taken out (and the separator it leaves). */
export function titleForModel(viTitle: string): string {
  return viTitle.normalize('NFC').replace(new RegExp(TBH_TOKEN.source, 'giu'), ' ')
    .replace(/(?:\s*[-–|·,]\s*){2,}/g, ' - ').replace(/^[\s\-–|·,]+|[\s\-–|·,]+$/g, '').replace(/\s+/g, ' ').trim()
}
/** The English title as written: the model's (warranty-free) title, plus "Warranty already started" when the source said "TBH". */
export const finalTitle = (viTitle: string, answer: string) => (TBH_TOKEN.test(viTitle.normalize('NFC')) ? `${answer} · Warranty already started` : answer)
export type Row = { id: string; title: string; description: string; titleVi: string | null; descriptionVi: string | null }
/** The Vietnamese ORIGINAL a row is translated from (commit gate round 11, codex) — never its own English slot. */
// An EMPTY original is a missing one, here as in the write (round 17, codex: `??` kept '' while the write treated it as absent).
export const viOf = (r: Row) => ({ title: r.titleVi || r.title, description: r.descriptionVi || r.description })
/** Why a row cannot be translated whatever the model answers (its source wording is not in the table), or null. */
export function sourceRefusal(vi: { title: string; description: string }): string | null {
  if (speaksOfWarranty(titleForModel(vi.title))) return 'title warranty wording not in the table'
  return planOf(vi.description).refuse
}

/**
 * The English to write for a row and the model's answer (title, and one line per model line), or why it is refused.
 * Every check runs on what the MODEL wrote; code's lines come from the table. The assembled text is checked once more.
 */
export function judge(vi: { title: string; description: string }, ans: { title?: unknown; description?: unknown }): { why: string } | { title: string; description: string } {
  const src = sourceRefusal(vi)
  if (src) return { why: src }
  if (typeof ans.title !== 'string' || typeof ans.description !== 'string') return { why: 'not strings' }
  const t = ans.title.trim()
  const sentTitle = titleForModel(vi.title)
  // Room for the phrase finalTitle appends (round 16, opus: a 190-char answer + " · Warranty already started" = 217).
  if (t.length < 3 || t.length > (TBH_TOKEN.test(vi.title.normalize('NFC')) ? 172 : 200)) return { why: 'title length' }
  if (!sameNegations(sentTitle, t)) return { why: 'title negation changed' }
  if (currencies(sentTitle) !== currencies(t)) return { why: 'currency changed' }
  // ⛔ FACTS SURVIVE (commit gate, codex, rounds 7–8): the title's numbers exactly (model, capacity, size).
  // In ORDER (round 20, codex: "iPhone 13 128GB" → "iPhone 128 13GB" kept the same sorted set).
  if (numSeq(t) !== numSeq(sentTitle)) return { why: 'title numbers changed' }
  const plan = planOf(vi.description)
  const want = factLines(modelText(plan))
  const en = factLines(ans.description)
  // One answer line per model line, the same numbers LINE BY LINE (commit gate rounds 7 + 12), and — since lines without
  // numbers cannot be told apart — two model lines with the same numbers make the order unverifiable (round 13, codex).
  if (en.length !== want.length) return { why: 'lines merged or split' }
  if (en.some((l, i) => numSeq(l) !== numSeq(want[i]))) return { why: 'line numbers changed' }
  // Per " · " ITEM, not per line (round 16, opus: "Có sạc · Không tai nghe" → "No charger · Earphones included" kept one
  // negation per line): the same items, each with its own numbers and its own negation.
  for (let i = 0; i < en.length; i++) {
    const vs = want[i].split(/\s+·\s+/), es = en[i].split(/\s+·\s+/)
    if (vs.length !== es.length) return { why: 'items merged or split' }
    if (vs.some((v, k) => numSeq(v) !== numSeq(es[k]) || !sameNegations(v, es[k]))) return { why: 'negation changed' }
    // An amount keeps its currency, ITEM BY ITEM (rounds 16–17, codex: "5.000.000đ" → "5,000,000 USD", or the two swapped).
    if (vs.some((v, k) => currencies(v) !== currencies(es[k]))) return { why: 'currency changed' }
  }
  if (en.some((l, i) => l.length > Math.max(400, want[i].length * 3))) return { why: 'line length' }
  // The model's words name no warranty, carry no Vietnamese, claim no new goods — title and every line.
  for (const s of [t, ...en]) {
    if (EN_WARRANTY.test(s)) return { why: 'names a warranty' }
    if (isVietnamese(s)) return { why: 'still Vietnamese' }
    if (saysNew(s)) return { why: 'new-goods wording' }
  }
  const out = { title: finalTitle(vi.title, t), description: assemble(plan, en) }
  if (isVietnamese(out.title) || isVietnamese(out.description) || saysNew(out.title) || saysNew(out.description)) return { why: 'assembled text check' }
  return out
}

