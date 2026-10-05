/**
 * `{placeholder}` safety for machine translation — isomorphic (the server's translate.ts and the client's
 * tr() both use it).
 *
 * ⛔ MT ENGINES TRANSLATE A NAMED PLACEHOLDER AS IF IT WERE A WORD. Measured 2026-10-05 on the cached UI
 * strings: of the 53 templates with placeholders, 2–16 per language came back with `{price}` turned into
 * `{цена}` / `{कीमत}` / `{가격}`, or dropped. Every such line fell back to English where a caller checked,
 * and printed the raw token where a caller just did `.replace('{n}', …)`. A NUMBERED placeholder is not a
 * word: `{0}` survived in 27/27 probes across the nine languages. So the server numbers placeholders on
 * the way to the engine and names them back on the way out, and the client refuses a template whose
 * placeholders still do not match.
 *
 * A placeholder is an ASCII identifier in braces (`{price}`, `{v1}`) — every template in the UI catalogue
 * has that shape. Anything else in braces is TEXT (a seller's "{size M, màu đỏ}") and is translated with
 * the sentence, never frozen. Measured 2026-10-05: 0 of 125,528 listings carry an `{identifier}` in their
 * title or description (2 carry any brace at all), so freezing one in seller text is a theoretical cost.
 */

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g
// Full-width braces too: a CJK engine may hand `{0}` back as `｛0｝`.
const NUMBERED = /[{｛]\s*(\d+)\s*[}｝]/g

/** `"Offer {price}, cash"` → `{ text: "Offer {0}, cash", names: ["price"] }`. No placeholders → unchanged.
 *  A text that already contains a `{0}` of its own is sent as is: numbering it would make the way back
 *  ambiguous. */
export function numberPlaceholders(text: string): { text: string; names: string[] } {
  const names: string[] = []
  if (!text.includes('{') || /\{\s*\d+\s*\}/.test(text)) return { text, names }
  const out = text.replace(PLACEHOLDER, (_m, k: string) => {
    names.push(k)
    return `{${names.length - 1}}`
  })
  return { text: out, names }
}

/** The inverse of numberPlaceholders, tolerant of the spacing (`{ 0 }`) or full-width braces (`｛0｝`) an
 *  engine may add. */
export function restorePlaceholders(text: string, names: string[]): string {
  if (names.length === 0) return text
  return text.replace(NUMBERED, (m, i: string) => (names[Number(i)] != null ? `{${names[Number(i)]}}` : m))
}

const placeholdersOf = (x: string) => x.match(PLACEHOLDER) ?? []
// On the TRANSLATED side anything in braces counts: a renamed placeholder (`{цена}`) is not an identifier.
const bracesOf = (x: string) => x.match(/\{[^{}]*\}/g) ?? []
const key = (list: string[]) => [...list].sort().join('\u0000')

/**
 * Does a stored translation still carry exactly its source's placeholders? A source that is not a template
 * always does: no braces, no identifier placeholder, or literal braces of its own beside them (a translated
 * "{size M}" cannot be told from a renamed placeholder, so such a string is never judged — no UI template
 * has that shape).
 */
export function templateIntact(translated: string, src: string): boolean {
  if (!src.includes('{')) return true // the common case, on every tr() cache hit: no regex at all
  const want = placeholdersOf(src)
  if (want.length === 0 || bracesOf(src).length !== want.length) return true
  return typeof translated === 'string' && key(bracesOf(translated)) === key(want)
}

/**
 * A translated template the caller can fill safely, or the English when it cannot be made safe.
 *  · the English has no placeholders → the translation, untouched;
 *  · same placeholders as the English → as is;
 *  · the English uses ONE placeholder name (however many times) and the translation has the same number
 *    of brace groups under other names (`{цена}`) → renamed back. With several DIFFERENT names the order
 *    may have changed in translation, so nothing is guessed;
 *  · anything else → the English template.
 */
export function safeTemplate(translated: string, en: string): string {
  if (typeof translated !== 'string') return en // a cache can hand back null; never render it
  if (templateIntact(translated, en)) return translated
  const want = placeholdersOf(en)
  const got = bracesOf(translated)
  const names = new Set(want)
  const only = want[0]
  if (only && names.size === 1 && got.length === want.length) return translated.replace(/\{[^{}]*\}/g, only)
  return en
}

/**
 * Fill a translated `{key}` template — the one rule every caller uses (tr() results, <Bilingual>, server
 * copy): the template is made safe first (safeTemplate), then each placeholder is filled in ONE pass, so a
 * value that itself contains "{n}" is printed as typed and never re-filled. A key with no value stays as is.
 */
export function fillTemplate(translated: string, en: string, values: Record<string, string>): string {
  return safeTemplate(translated, en).replace(/\{([^{}]+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : m))
}
