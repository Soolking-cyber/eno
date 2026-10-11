import { formatMoneyFull } from '@/lib/vnd'

/**
 * THE INLINE GRAMMAR OF A TEACH GUIDE — three constructs and plain text, nothing else.
 *
 *   **bold text**                         → <strong>
 *   [link text](/internal/path)           → an in-site link (HereLink)
 *   [link text](https://example.org/x)    → an outbound link (OfficialLink: noopener nofollow)
 *   {{vnd:25000000}}                      → "25,000,000 đ"            (formatMoneyFull, English grouping)
 *   {{vnd:25000000-35000000}}             → "25,000,000–35,000,000 đ"
 *
 * ⛔ STRICT, AND IT THROWS. An unclosed `**`, a `[` with no `](…)`, an unknown `{{token}}` or a money
 * token that is not a whole number of đồng all throw — and the schema runs this parser over every inline
 * field (schema.ts `forEachInline`), which content.ts applies to every guide at module load, so a
 * malformed guide fails `next build` instead of shipping literal asterisks to a reader. The
 * guides are generated text; a lenient parser is how "**Note" ends up on a live page.
 *
 * ⚠️ MONEY IS A TOKEN, NEVER TYPED. English pages print đồng with English grouping through vnd.ts
 * (article-money-format.test.ts explains the incident behind that rule); a token is the only way a
 * figure in a guide can be guaranteed to go through it. teach-guides.test.ts refuses a hand-typed
 * đồng amount anywhere in the content.
 */

export type InlineToken =
  | { t: 'text'; v: string }
  | { t: 'bold'; children: InlineToken[] }
  | { t: 'link'; href: string; label: string; external: boolean }
  | { t: 'money'; text: string }

const MONEY = /^vnd:(\d{1,12})(?:-(\d{1,12}))?$/

export function moneyText(a: number, b?: number): string {
  if (b === undefined) return formatMoneyFull(a, '₫', 'en')
  if (!(b > a)) throw new Error(`teach-guides inline: money range ${a}-${b} is not increasing`)
  // "25,000,000–35,000,000 đ": one currency mark, at the end, as a range is read aloud.
  return `${formatMoneyFull(a, '₫', 'en').replace(/ đ$/, '')}–${formatMoneyFull(b, '₫', 'en')}`
}

function fail(src: string, msg: string): never {
  throw new Error(`teach-guides inline: ${msg} in: ${JSON.stringify(src.length > 160 ? `${src.slice(0, 160)}…` : src)}`)
}

/**
 * ⛔ INTERNAL = A PLAIN ROOT PATH: lowercase letters, digits, "-" and "/", and an optional #fragment.
 * Nothing a browser could resolve to ANOTHER origin — `//host` and `/\host` both do (the second is a
 * WHATWG-URL quirk: a backslash is a slash), and so might an encoded variant — so no backslash, no "%",
 * no query string, no trailing slash. Every page a guide links is a plain path; the shape is the whole
 * check, not a denylist of tricks (plan review, 2026-10-11).
 */
const INTERNAL_HREF = /^\/(?:[a-z0-9]+(?:[-/][a-z0-9]+)*)?(?:#[a-z0-9]+(?:-[a-z0-9]+)*)?$/
/**
 * External: https, a plain host (no userinfo, no port), then no whitespace, backslash or parenthesis
 * anywhere — the link grammar ends a URL at the first ")", so a URL with one would be cut short silently.
 */
const EXTERNAL_HREF = /^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}(?:[/?#][^\s\\()]*)?$/i
/**
 * ⛔ eno.vn IS LINKED AS A PATH, NEVER AS https://eno.vn/… — an absolute URL to the site would skip the
 * release gate (`isLiveHref` sees only paths, so an unreleased guide would render as a live link). And no
 * host under eno.forum at all: it is the other edition, which the marketplace must never point at — any
 * subdomain of it included (a `visa.eno.forum` link is the leak this exists to stop).
 * The ONE other eno.vn host a guide may link is the teacher app, by exact name: an arbitrary subdomain
 * could serve a guide path and skip the release gate the same way the apex would.
 */
const ENO_FORUM_HOST = /^https:\/\/(?:[a-z0-9-]+\.)*eno\.forum(?:[/?#:]|$)/i
const ENO_VN_HOST = /^https:\/\/(?:[a-z0-9-]+\.)*eno\.vn(?:[/?#:]|$)/i
export const TEACHER_APP_ORIGIN = 'https://teacher.eno.vn'
const isTeacherApp = (url: string) => url === TEACHER_APP_ORIGIN || url.startsWith(`${TEACHER_APP_ORIGIN}/`)
/** eno.vn's own pages a guide may cite as a SOURCE (apex or www, never a subdomain other than the teacher app). */
const ENO_VN_SITE = /^https:\/\/(?:www\.)?eno\.vn(?:[/?#]|$)/i

/**
 * A guide's SOURCE URL (the closing "Sources" list): the external rule, except that eno.vn's own data pages
 * may be cited — the Rent Index, the school directory — because they ARE the source of a figure.
 * ⛔ Never a teach guide (the sources list does not go through the release gate) and never eno.forum (the
 * other edition). teach-guides.test.ts pins which eno.vn pages may appear.
 */
export function checkSourceUrl(url: string): void {
  if (!EXTERNAL_HREF.test(url)) throw new Error(`teach-guides source: must be https://host/… with no port, userinfo, spaces, backslashes or parentheses: "${url}"`)
  if (ENO_FORUM_HOST.test(url)) throw new Error(`teach-guides source: eno.forum is the other edition: "${url}"`)
  if (ENO_VN_HOST.test(url) && !ENO_VN_SITE.test(url) && !isTeacherApp(url)) throw new Error(`teach-guides source: an eno.vn subdomain other than the teacher app: "${url}"`)
  if (/^https:\/\/(?:www\.)?eno\.vn\/teach-in-vietnam(?:[/?#]|$)/i.test(url)) throw new Error(`teach-guides source: a guide cannot be a source (it may not be released): "${url}"`)
}

/** Validate an href from guide content. Internal = a plain root path; external = https only. */
export function checkHref(href: string, src: string): { href: string; external: boolean } {
  if (href.startsWith('/')) {
    if (!INTERNAL_HREF.test(href)) fail(src, `bad internal href "${href}" (a /path of a-z, 0-9, "-" and "/", optional #fragment)`)
    return { href, external: false }
  }
  if (!EXTERNAL_HREF.test(href)) fail(src, `href must be "/path" or "https://host/…": "${href}"`)
  if (ENO_FORUM_HOST.test(href)) fail(src, `never link eno.forum (the other edition): "${href}"`)
  if (ENO_VN_HOST.test(href) && !isTeacherApp(href)) fail(src, `link eno.vn's own pages as a path ("/schools"), not "${href}"`)
  return { href, external: true }
}

export function parseInline(src: string): InlineToken[] {
  const out: InlineToken[] = []
  let i = 0
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  while (i < src.length) {
    if (src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2)
      if (end < 0) fail(src, 'unclosed **bold**')
      const inner = src.slice(i + 2, end)
      if (!inner.trim()) fail(src, 'empty **bold**')
      flush()
      // Bold may hold money and plain text, never a link or another bold (nothing in a guide needs it).
      const children = parseInline(inner)
      if (children.some((c) => c.t === 'link' || c.t === 'bold')) fail(src, 'a link or bold inside **bold**')
      out.push({ t: 'bold', children })
      i = end + 2
      continue
    }
    if (src[i] === '[') {
      const close = src.indexOf('](', i + 1)
      const end = close < 0 ? -1 : src.indexOf(')', close + 2)
      if (close < 0 || end < 0) fail(src, 'a "[" that is not a [text](href) link')
      const label = src.slice(i + 1, close)
      if (!label.trim() || /[[\]*{}]/.test(label)) fail(src, `bad link text "${label}"`)
      const { href, external } = checkHref(src.slice(close + 2, end), src)
      flush()
      out.push({ t: 'link', href, label, external })
      i = end + 1
      continue
    }
    if (src.startsWith('{{', i)) {
      const end = src.indexOf('}}', i + 2)
      if (end < 0) fail(src, 'unclosed {{token}}')
      const m = MONEY.exec(src.slice(i + 2, end))
      if (!m) fail(src, `unknown token {{${src.slice(i + 2, end)}}}`)
      flush()
      out.push({ t: 'money', text: moneyText(Number(m[1]), m[2] === undefined ? undefined : Number(m[2])) })
      i = end + 2
      continue
    }
    if (src[i] === ']' || src.startsWith('}}', i)) fail(src, `stray "${src[i]}"`)
    text += src[i]
    i += 1
  }
  flush()
  return out
}

/** The plain text a reader sees — for JSON-LD, meta tags and the word-level tests. */
export function inlineText(src: string): string {
  const walk = (ts: InlineToken[]): string =>
    ts.map((t) => (t.t === 'text' ? t.v : t.t === 'money' ? t.text : t.t === 'link' ? t.label : walk(t.children))).join('')
  return walk(parseInline(src))
}

/** Every href in an inline string, for the link-integrity test. */
export function inlineHrefs(src: string): { href: string; external: boolean }[] {
  const out: { href: string; external: boolean }[] = []
  const walk = (ts: InlineToken[]) => {
    for (const t of ts) {
      if (t.t === 'link') out.push({ href: t.href, external: t.external })
      if (t.t === 'bold') walk(t.children)
    }
  }
  walk(parseInline(src))
  return out
}
