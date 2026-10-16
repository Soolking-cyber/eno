/**
 * HTML ENTITIES IN MERCHANT FEED TEXT (translation audit 2026-10-02, F9).
 *
 * The AccessTrade datafeeds hand over product names and descriptions with their HTML entities still
 * encoded, so 1,576 live listings, all but one from Tiki, read "Fun for Movers SB w Home Fun &amp;
 * Online" or "Độ sạch &gt; 98". React escapes text, so the entity is printed literally. Measured on
 * the live rows: descriptionVi 1,309, description 1,271, titleVi 804 and title 31.
 *
 * ⚠️ DECODE, NEVER RE-STRIP. A tag strip run after decoding would treat "Độ ẩm < 10 … > 85" as a tag
 * and delete the text between. The decoded text only ever reaches React text nodes, which escape it.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', deg: '°', times: '×',
  sup2: '²', sup3: '³', frac12: '½', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
  pound: '£', euro: '€', yen: '¥', cent: '¢',
  // Vietnamese shop pages (merchant-specs.ts has the same set): "Ti&ecirc;u chuẩn", "Th&aacute;ng".
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', egrave: 'è', eacute: 'é', ecirc: 'ê',
  igrave: 'ì', iacute: 'í', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', yacute: 'ý', dstrok: 'đ', abreve: 'ă', Abreve: 'Ă',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê',
  Igrave: 'Ì', Iacute: 'Í', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ',
  Ugrave: 'Ù', Uacute: 'Ú', Yacute: 'Ý', Dstrok: 'Đ',
  // The accented letters with no base-plus-mark name (ACCENTED below builds the rest).
  aelig: 'æ', AElig: 'Æ', oelig: 'œ', OElig: 'Œ', oslash: 'ø', Oslash: 'Ø', szlig: 'ß', eth: 'ð', ETH: 'Ð',
  thorn: 'þ', THORN: 'Þ', lstrok: 'ł', Lstrok: 'Ł', hstrok: 'ħ', Hstrok: 'Ħ', tstrok: 'ŧ', Tstrok: 'Ŧ', imath: 'ı',
}

/**
 * ANY OTHER ACCENTED LETTER — HTML names them as the letter plus the mark ("ccedil" ç, "uuml" ü, "ntilde" ñ, "scaron"
 * š, "gbreve" ğ, "aogon" ą, "Idot" İ): a teacher's CV read by a model came back "Institut fran&ccedil;ais" (eval,
 * 2026-10-16). Built from the mark and the letter instead of a two-hundred-line table — but ONLY for the letters HTML
 * itself names with that mark, matched case for case: "&sdot;" (⋅), "&odot;" (⊙) and "&eDot;" (≑) are real names for
 * other characters, never ṡ, ȯ or ė (gate review, 2026-10-16), and a name HTML does not have ("&wacute;") stays as it is.
 */
const MARKED: Record<string, readonly [mark: string, letters: string]> = {
  grave: ['̀', 'AaEeIiOoUu'],
  acute: ['́', 'AaCcEegIiLlNnOoRrSsUuYyZz'],
  circ: ['̂', 'AaCcEeGgHhIiJjOoSsUuWwYy'],
  tilde: ['̃', 'AaIiNnOoUu'],
  macr: ['̄', 'AaEeIiOoUu'],
  breve: ['̆', 'AaGgUu'],
  dot: ['̇', 'CcEeGgIZz'],
  uml: ['̈', 'AaEeIiOoUuYy'],
  ring: ['̊', 'AaUu'],
  dblac: ['̋', 'OoUu'],
  caron: ['̌', 'CcDdEeLlNnRrSsTtZz'],
  cedil: ['̧', 'CcGKkLlNnRrSsTt'],
  ogon: ['̨', 'AaEeIiUu'],
}
const ACCENTED = /^([A-Za-z])(grave|acute|circ|tilde|macr|breve|dot|uml|ring|dblac|caron|cedil|ogon)$/
function accented(name: string): string | undefined {
  const m = ACCENTED.exec(name)
  if (!m) return undefined
  const [mark, letters] = MARKED[m[2]]
  if (!letters.includes(m[1])) return undefined
  const letter = (m[1] + mark).normalize('NFC')
  return letter.length === 1 ? letter : undefined
}

const ENTITY = /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,7});/gi

/**
 * Decoded to a FIXED POINT, so decoding a decoded text changes nothing. A refresh
 * decodes the STORED columns every run, and a one-layer decoder would peel one more layer of a
 * double-encoded "&amp;lt;b&amp;gt;" each week (review). An unknown name is left as it is. Case matters
 * for names (Aacute vs aacute); a name known only in the other case falls back to the lower-case entry.
 */
export function decodeEntities(s: string): string {
  let out = s
  // Each pass shortens the text, so this ends; the bound is only a backstop.
  for (let i = 0; i < 64; i++) {
    const next = decodeOnce(out)
    if (next === out) break
    out = next
  }
  return out
}

function decodeOnce(s: string): string {
  return s.replace(ENTITY, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : m
    }
    return NAMED[e] ?? accented(e) ?? NAMED[e.toLowerCase()] ?? m
  })
}

/** The first `max` UTF-16 units, never ending on half of a surrogate pair (a decoded "&#x1F600;" can sit on the cut). */
export function cutText(s: string, max: number): string {
  const out = s.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(out) ? out.slice(0, -1) : out
}

/** A feed description as stored: tags out, entities decoded, whitespace (incl. a decoded &nbsp;) collapsed. */
export function feedDescription(raw: string, max = 1800): string {
  return cutText(decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(), max)
}

export type TextColumns = { title: string; titleVi: string | null; description: string; descriptionVi: string | null }

/**
 * The stored text columns that still carry an entity, each with its decoded form. A refresh writes
 * these even where a column is otherwise create-only. Decoding changes no words a human or a
 * translator chose; it only stops printing "&amp;".
 */
export function entityRepairs(row: TextColumns): Partial<Record<keyof TextColumns, { from: string; to: string }>> {
  const out: Partial<Record<keyof TextColumns, { from: string; to: string }>> = {}
  for (const k of ['title', 'titleVi', 'description', 'descriptionVi'] as const) {
    const from = row[k]
    if (!from) continue
    const to = decodeEntities(from)
    if (to !== from) out[k] = { from, to }
  }
  return out
}
