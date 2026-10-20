/**
 * TAPPABLE LINKS IN A JOBS-DESK THREAD (teacher job DMs, owner 2026-10-20). Every job in a desk message ends on its link —
 * the eno.vn listing, the LinkedIn job or the Facebook post — and a chat bubble renders plain text, so on a phone those
 * were copy-only. This splits a message into text and links; MessageBubble (chat-parts.tsx) draws the links.
 *
 * ⛔ PLAIN TEXT IS THE DEFAULT, AND EVERYTHING HERE IS A REASON TO STAY PLAIN. A link is drawn only when ALL of these hold:
 *   · the thread is the jobs desk's and the message is the desk OPERATOR's (the thread's sellerProfileId), shown as
 *     written — never a translation (the thread page decides those, from the server's `desk` / `fromDesk`);
 *   · the URL is `https://` — never http:, javascript:, data: or a scheme-less "www.…";
 *   · its host is EXACTLY one of JOBS_DESK_LINK_HOSTS — a lookalike (facebook.com.evil.io, eno.vn.evil.io), a
 *     subdomain not listed (l.facebook.com, lnkd.in), userinfo (https://eno.vn@evil.io) or an explicit port is plain;
 *   · its PATH has one of the shapes the composer writes (LINK_SHAPES — an eno.vn listing or the job-messages page, a
 *     Facebook group post, a LinkedIn job), with no query and no fragment: an allow-list of shapes, not a list of the
 *     hosts' redirectors — a denylist always misses one (/dialog/feed?redirect_uri=, /slink?code= — opus, gate 4a).
 * Linkifying arbitrary chat text is a phishing vector (understand/result4.txt RISKS), which is why the hosts are a short
 * fixed list and nobody else's messages are ever scanned.
 *
 * ⚠️ THE HREF IS THE PARSED URL, THE LABEL IS THE TEXT AS WRITTEN. `new URL()` decides the host and the path (case,
 * percent-escapes, dot segments — the browser's own reading), and the href is its output, so the check and the
 * navigation cannot disagree; the label is never rewritten.
 * Pure and import-free: the thread page (a client component) and its tests read it.
 */

/** The hosts a desk message may link to — exactly these, compared with the parsed (lower-cased) hostname. */
export const JOBS_DESK_LINK_HOSTS: ReadonlySet<string> = new Set([
  'eno.vn', 'www.eno.vn',
  'facebook.com', 'www.facebook.com', 'm.facebook.com',
  'linkedin.com', 'www.linkedin.com',
])

/**
 * Paths on an allowed host that forward to ANY address: Facebook's link shim (/l.php, /flx/warn/) and LinkedIn's
 * redirect and "leaving LinkedIn" pages (/redir/…, /safety/go). A desk job link is never one of them — the composer
 * links an eno.vn listing, a canonical linkedin.com/jobs/view/<id> or a Facebook post — so refusing them costs no
 * real link. Lower-cased path prefixes.
 */
const LINK_SHAPES: ReadonlyMap<string, RegExp> = new Map([
  ['eno.vn', /^\/(listings\/[a-z0-9_-]+|teachers\/job-messages)\/?$/i],
  ['facebook.com', /^\/groups\/[\w.-]+\/(posts|permalink)\/\d+\/?$/],
  ['linkedin.com', /^\/jobs\/view\/\d+\/?$/],
])

/** One run of a message: text, or a link (`href` = the parsed URL; `text` = the characters as written). */
export type TextSegment = { text: string; href?: undefined } | { text: string; href: string }

/**
 * A URL candidate: a scheme, "://", then the characters a URL can carry in running text — RFC 3986's unreserved and
 * reserved sets plus '%', minus `'` `[` `]` (a quote or a bracket around a link ends it). The scheme is matched in full
 * ("xhttps://…", "http://…", "javascript://…" are one candidate each, and only https is ever drawn), so an allowed URL
 * hidden inside another one ("http://evil.io/?u=https://eno.vn") stays inside that candidate, plain.
 * Anything else — whitespace, a non-ASCII letter, `<>"{}|\^` and backtick — ends it. Linear: no nested quantifiers.
 */
const CANDIDATE = /[a-z][a-z0-9+.-]*:\/\/[a-z0-9\-._~:/?#@!$&()*+,;=%]*/gi

/** Punctuation that closes a sentence, never a link: "See https://eno.vn/x." links …/x. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', '*'])

/** The candidate minus trailing punctuation — and a ")" only when it closes nothing inside the URL ("(see https://…)"). */
function trimTrailing(raw: string): string {
  let s = raw
  for (;;) {
    // Index, not `.at(-1)`: this ships to the browser, and older iOS Safari has no Array/String `at`.
    const last = s[s.length - 1]
    if (last && TRAILING.has(last)) { s = s.slice(0, -1); continue }
    if (last === ')' && s.split(')').length > s.split('(').length) { s = s.slice(0, -1); continue }
    return s
  }
}

/** The href a candidate may link to, or null. */
export function deskLinkHref(candidate: string): string | null {
  let u: URL
  try { u = new URL(candidate) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (!JOBS_DESK_LINK_HOSTS.has(u.hostname)) return null
  if (u.search || u.hash) return null
  const shape = LINK_SHAPES.get(u.hostname.replace(/^(www|m)\./, ''))
  return shape && shape.test(u.pathname) ? u.href : null
}

/**
 * A jobs-desk message as text and links. Adjacent text is never split (one segment between two links), and a message
 * with no link comes back as ONE text segment equal to the input.
 */
export function jobsDeskLinks(text: string): TextSegment[] {
  const out: TextSegment[] = []
  let plain = ''
  let at = 0
  for (const m of text.matchAll(CANDIDATE)) {
    const start = m.index ?? 0
    const url = trimTrailing(m[0])
    const href = deskLinkHref(url)
    if (!href) continue // stays inside the surrounding text
    plain += text.slice(at, start)
    if (plain) out.push({ text: plain })
    plain = ''
    out.push({ text: url, href })
    at = start + url.length
  }
  plain += text.slice(at)
  if (plain || !out.length) out.push({ text: plain })
  return out
}
