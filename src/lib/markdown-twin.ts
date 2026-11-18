/**
 * A content page's `.md` twin (ora.ai markdown-url-fallback, owner 2026-11-16 "do recommended" / "go next 1 by 1"):
 * `/about.md` is `/about`'s own `<main>`, as markdown, opening with its H1. Built from the page's server-rendered HTML
 * — the same text a signed-out reader gets — so there is no second copy to drift, and no new production dependency:
 * a small token walker for the elements eno's pages use (headings, paragraphs, lists, links, line breaks, table rows).
 * Served by src/app/md/twin/route.ts; the pages it may serve are TWIN_DENY's complement (next.config.ts).
 *
 * ⛔ EVERY PIECE OF PAGE TEXT IS ESCAPED (commit gate, opus): only this walker writes markdown syntax. A seller's
 * "[Pay deposit](https://…)" or "# Verified by eno.vn" stays literal text in the twin, exactly as it reads on the page.
 */

/**
 * Root pages that never get a twin — accounts, sign-in, admin, people, posting, API-like routes, and the browse surfaces
 * that ARE listings (a category, a brand, the teachers directory). An article or index page that quotes a few
 * listings (a guide, the rent index) is content and keeps its twin; any seller text on it is escaped like all page text.
 * ⛔ A STOREFRONT HAS ONE SINCE 2026-11-16 (owner: "resolve my decision with recommended" — ora sampled /sellers/<id>):
 * `/sellers/<id>` exactly, never a teacher's (a person's profile, as the teachers directory is); the route checks both.
 * ⛔ SO DOES A LISTING SINCE 2026-11-18 (owner approved; ora sampled /listings/<id>.md): `/listings/<id>` exactly, only a
 * row the public PDP shows, never a teacher's row or a teacher's shop, never eno's hidden visa desk — the route checks
 * all of it. Read by next.config.ts to build the twin rewrite's allowlist (every OTHER root page of this
 * edition), and inlined into the route as its own check.
 * ⚠️ Limit: a twin is the page's server-rendered <main>. A section that streams in after </main> (a Suspense boundary on a
 * dynamic page) is not in it; the content pages measured (about, the rent index, the guides) render whole.
 */
export const TWIN_DENY: ReadonlySet<string> = new Set([
  'account', 'account-deletion', 'admin', 'api', 'app', 'ask', 'auth', 'brands', 'c', 'classroom', 'concierge', 'dashboard',
  'disputes', 'dispute', 'forum', 'listing-images', 'md', 'messages', 'oauth', 'og', 'onboard', 'post', 'reports',
  'saved', 'search', 'signin', 'signup', 'sitemaps', 'teacher', 'teachers', 'unsubscribe', '_next',
])

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (ENTITIES[e] !== undefined) return ENTITIES[e]
    const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : e.startsWith('#') ? parseInt(e.slice(1), 10) : NaN
    // An out-of-range numeric entity stays as written (commit gate, opus: fromCodePoint would throw).
    if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code)
    return m
  })
}

/** Page text as literal markdown: every character markdown would read as syntax is escaped. */
export function escapeMarkdown(s: string): string {
  return s.replace(/[\\`*_[\]()<>#|!~]/g, '\\$&')
}

/** The first <main>…</main> of a page, or null when it has none. */
export function mainOf(html: string): string | null {
  const start = html.search(/<main[\s>]/i)
  if (start < 0) return null
  const end = html.lastIndexOf('</main>')
  return end > start ? html.slice(start, end + '</main>'.length) : null
}

const DROP = /<(script|style|svg|noscript|template|button|form|select|textarea|iframe|video|audio|picture|figure|dialog)\b[\s\S]*?<\/\1>/gi
const INLINE = new Set(['span', 'strong', 'b', 'em', 'i', 'small', 'code', 'time', 'abbr', 'sup', 'sub', 'mark', 'u', 's', 'bdi', 'wbr', 'img'])
const BLOCK_END = new Set(['p', 'div', 'section', 'article', 'header', 'ul', 'ol', 'table', 'blockquote', 'dl', 'dd', 'dt', 'nav', 'aside'])

/** A link's target, only for a real address (http(s) or a site path), made safe inside markdown's (…). */
function safeHref(href: string | null, origin: string): string | null {
  if (!href) return null
  const abs = /^https?:\/\//i.test(href) ? href : href.startsWith('/') && !href.startsWith('//') ? `${origin}${href}` : null
  return abs ? abs.replace(/[\s()<>]/g, (c) => encodeURIComponent(c)) : null
}

/** <main> HTML → markdown, by walking its tags and text. */
export function htmlToMarkdown(mainHtml: string, origin: string): string {
  const html = mainHtml.replace(/<!--[\s\S]*?-->/g, '').replace(DROP, ' ')
  let buf = ''
  const links: { href: string | null; start: number }[] = []
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g)) {
    const tok = m[0]
    if (!m[2]) {
      // HTML whitespace is not significant: a newline in page text is a space, so text can never start its own line.
      let t = escapeMarkdown(decodeEntities(tok).replace(/\s+/g, ' '))
      // EVERY run's leading list / heading-underline / ordered-list syntax is escaped, wherever the run sits (commit gate,
      // opus, three rounds: guessing which runs start a line kept missing one — a <details>, a whitespace-only <span>).
      // Mid-line it costs a harmless backslash; at a line start it is the only thing that keeps page text literal.
      t = t.replace(/^(\s*)([-+=])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2')
      buf += t
      continue
    }
    const name = m[2].toLowerCase()
    const closing = m[1] === '/'
    if (/^h[1-6]$/.test(name)) buf += closing ? '\n\n' : `\n\n${'#'.repeat(Number(name[1]))} `
    else if (name === 'li') buf += closing ? '\n' : '\n- '
    else if (name === 'br') buf += '\n'
    else if (name === 'tr') { if (!closing) buf += '\n' }
    else if (name === 'td' || name === 'th') { if (closing) buf += ' | ' }
    else if (name === 'a') {
      if (!closing) {
        const href = /\bhref="([^"]*)"/i.exec(tok)?.[1]
        links.push({ href: href ? decodeEntities(href) : null, start: buf.length })
      } else {
        const l = links.pop()
        if (l) {
          const text = buf.slice(l.start).replace(/\s+/g, ' ').trim()
          const url = safeHref(l.href, origin)
          buf = buf.slice(0, l.start) + (url && text ? `[${text}](${url})` : text)
        }
      }
    } else if (BLOCK_END.has(name)) { if (closing) buf += '\n\n' }
    else if (!INLINE.has(name)) buf += ' '
  }
  const out: string[] = []
  for (const raw of buf.split('\n')) {
    const l = raw.replace(/[ \t]+/g, ' ').trim()
    if (l === '' || l === '-' || l === '|') { if (out.length && out[out.length - 1] !== '') out.push(''); continue }
    // Consecutive list items stay one list: no blank line between two "- " lines.
    if (l.startsWith('- ') && out.length >= 2 && out[out.length - 1] === '' && out[out.length - 2].startsWith('- ')) out.pop()
    out.push(l)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The twin: the page's markdown, starting with its top-level heading (ora: "the body should start with a top-level
 * heading"), and a closing line naming the page it is a copy of. null when the page has no <main> or no H1.
 */
export function markdownTwin(html: string, pageUrl: string, origin: string): string | null {
  const main = mainOf(html)
  if (!main) return null
  const md = htmlToMarkdown(main, origin)
  const h1 = md.search(/(?:^|\n)# /)
  if (h1 < 0) return null
  return `${md.slice(h1 === 0 ? 0 : h1 + 1)}\n\n---\n\nThis is the markdown copy of ${pageUrl}.\n`
}
