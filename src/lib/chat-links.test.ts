import { describe, expect, it } from 'vitest'
import { JOBS_DESK_LINK_HOSTS, deskLinkHref, jobsDeskLinks } from './chat-links'

/**
 * THE JOBS DESK'S TAPPABLE LINKS (src/lib/chat-links.ts). Plain text is the default and every rule is a reason to stay
 * plain: https only, the seven hosts exactly, no userinfo or port, no open-redirect path — and the text around a link,
 * including the punctuation that ends a sentence, is never swallowed into it.
 */

const links = (text: string) => jobsDeskLinks(text).filter((s) => s.href).map((s) => s.href)
/** The segments put back together are always the input, character for character. */
const joined = (text: string) => jobsDeskLinks(text).map((s) => s.text).join('')

describe('jobsDeskLinks — the allowed hosts', () => {
  it.each([
    'https://eno.vn/listings/cmabc123',
    'https://www.eno.vn/listings/cmabc123',
    'https://facebook.com/groups/123/posts/456/',
    'https://www.facebook.com/groups/123/posts/456/',
    'https://m.facebook.com/groups/123/permalink/456/',
    'https://eno.vn/teachers/job-messages',
    'https://linkedin.com/jobs/view/4012345678',
    'https://www.linkedin.com/jobs/view/4012345678',
  ])('links %s', (url) => {
    expect(jobsDeskLinks(url)).toEqual([{ text: url, href: url }])
  })

  it('is exactly the seven hosts the owner named', () => {
    expect([...JOBS_DESK_LINK_HOSTS].sort()).toEqual(
      ['eno.vn', 'facebook.com', 'linkedin.com', 'm.facebook.com', 'www.eno.vn', 'www.facebook.com', 'www.linkedin.com'],
    )
  })

  it('compares the PARSED host, so case does not matter — the label keeps what was written', () => {
    expect(jobsDeskLinks('HTTPS://WWW.ENO.VN/Listings/X')).toEqual([{ text: 'HTTPS://WWW.ENO.VN/Listings/X', href: 'https://www.eno.vn/Listings/X' }])
  })

  it('only the shapes the composer writes — a host root, another path, a query or a fragment stays plain (opus, gate 4a)', () => {
    for (const u of ['https://eno.vn', 'https://eno.vn/about', 'https://m.facebook.com/story.php?story_fbid=1&id=2', 'https://www.facebook.com/dialog/feed?redirect_uri=https://evil.io',
      'https://www.linkedin.com/slink?code=abc', 'https://eno.vn/listings/x?next=https://evil.io', 'https://www.linkedin.com/jobs/view/1/#apply']) expect(links(u), u).toEqual([])
  })
})

describe('jobsDeskLinks — everything else stays plain text', () => {
  it.each([
    ['a lookalike host', 'https://facebook.com.evil.io/groups/1'],
    ['a lookalike host (eno.vn)', 'https://eno.vn.evil.io/listings/1'],
    ['a look-alike spelling', 'https://faceb00k.com/groups/1'],
    ['a subdomain not listed', 'https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.io'],
    ['another subdomain not listed', 'https://business.facebook.com/x'],
    ['a short link host', 'https://lnkd.in/abc'],
    ['a trailing-dot host', 'https://facebook.com./groups/1'],
    ['userinfo before an allowed host', 'https://user:pw@eno.vn/x'],
    ['an allowed host as userinfo', 'https://eno.vn@evil.io/x'],
    ['an encoded @ in the host', 'https://facebook.com%40evil.io/x'],
    ['an explicit port', 'https://eno.vn:8443/listings/1'],
    ['http:', 'http://eno.vn/listings/1'],
    ['http: www', 'http://www.facebook.com/groups/1'],
    ['javascript:', 'javascript:alert(document.cookie)'],
    ['javascript: dressed as a URL', 'javascript://eno.vn/%0Aalert(1)'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['a scheme-less host', 'www.facebook.com/groups/1'],
    ['a scheme glued to a word', 'xhttps://eno.vn/listings/1'],
    ['an unrelated host', 'https://evil.io/eno.vn'],
    ['an allowed URL inside another URL', 'http://evil.io/?next=https://eno.vn/listings/1'],
    ['an allowed URL inside an unrelated https URL', 'https://evil.io/r?u=https://www.facebook.com/x'],
    ['Facebook\'s link shim', 'https://www.facebook.com/l.php?u=https%3A%2F%2Fevil.io'],
    ['Facebook\'s link shim (m., upper-case)', 'https://m.facebook.com/L.PHP?u=https%3A%2F%2Fevil.io'],
    ['Facebook\'s link shim behind a doubled slash', 'https://www.facebook.com//l.php?u=https%3A%2F%2Fevil.io'],
    ['Facebook\'s link shim behind a dot segment', 'https://www.facebook.com/groups/%2e%2e/l.php?u=https%3A%2F%2Fevil.io'],
    ['Facebook\'s warning redirect', 'https://www.facebook.com/flx/warn/?u=https%3A%2F%2Fevil.io'],
    ['LinkedIn\'s redirect', 'https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fevil.io'],
    ['LinkedIn\'s "leaving LinkedIn" page', 'https://www.linkedin.com/safety/go?url=https%3A%2F%2Fevil.io'],
    ['a scheme with nothing after it', 'https://'],
  ])('%s: %s', (_, text) => {
    expect(jobsDeskLinks(text)).toEqual([{ text }])
  })

  it('a non-ASCII letter ends the URL, so a homograph host is never read past it', () => {
    // "fаcebook" with a Cyrillic а: the candidate stops at "https://f", which is no allowed host.
    expect(links('https://fаcebook.com/groups/1')).toEqual([])
  })

  it('a backslash ends the URL — the browser would read it as a slash, and the link is only what came before it', () => {
    const segs = jobsDeskLinks('https://eno.vn/listings/x\\@evil.io/x')
    expect(segs[0]).toEqual({ text: 'https://eno.vn/listings/x', href: 'https://eno.vn/listings/x' })
    expect(segs.slice(1)).toEqual([{ text: '\\@evil.io/x' }])
  })

  it('a message with no link comes back as one text segment equal to the input', () => {
    const text = 'Hi Anna, this is Alex from eno.vn.\n\nReply STOP to stop these messages.'
    expect(jobsDeskLinks(text)).toEqual([{ text }])
    expect(jobsDeskLinks('')).toEqual([{ text: '' }])
  })
})

describe('jobsDeskLinks — the text around a link', () => {
  it.each([
    ['a full stop', 'See https://eno.vn/listings/1.', 'https://eno.vn/listings/1', '.'],
    ['a comma', 'https://eno.vn/listings/1, then apply', 'https://eno.vn/listings/1', ', then apply'],
    ['a question mark', 'Seen https://eno.vn/listings/1?', 'https://eno.vn/listings/1', '?'],
    ['an exclamation mark', 'Apply here https://eno.vn/listings/1!', 'https://eno.vn/listings/1', '!'],
    ['a colon and a semicolon', 'https://eno.vn/listings/1:; next', 'https://eno.vn/listings/1', ':; next'],
    ['several marks', 'https://eno.vn/listings/1...', 'https://eno.vn/listings/1', '...'],
    ['a closing parenthesis that opens nothing', '(https://eno.vn/listings/1)', 'https://eno.vn/listings/1', ')'],
    ['a parenthesis and a full stop', '(see https://eno.vn/listings/1).', 'https://eno.vn/listings/1', ').'],
    ['square brackets', '[https://eno.vn/listings/1]', 'https://eno.vn/listings/1', ']'],
    ['quotes', '"https://eno.vn/listings/1"', 'https://eno.vn/listings/1', '"'],
    ['an apostrophe', "'https://eno.vn/listings/1'", 'https://eno.vn/listings/1', "'"],
    ['markdown bold', '**https://eno.vn/listings/1**', 'https://eno.vn/listings/1', '**'],
    ['an ellipsis character', 'https://eno.vn/listings/1… more', 'https://eno.vn/listings/1', '… more'],
  ])('%s', (_, text, url, after) => {
    const segs = jobsDeskLinks(text)
    const i = segs.findIndex((s) => s.href)
    expect(segs[i]).toEqual({ text: url, href: url })
    expect(segs.slice(i + 1).map((s) => s.text).join('')).toBe(after)
    expect(joined(text)).toBe(text)
  })

  it('a closing parenthesis around a link is not part of it', () => {
    expect(links('(see https://eno.vn/listings/abc)')).toEqual(['https://eno.vn/listings/abc'])
  })

  it('reads a link glued to a label ("Apply:https://…")', () => {
    expect(jobsDeskLinks('Apply:https://eno.vn/listings/1')).toEqual([{ text: 'Apply:' }, { text: 'https://eno.vn/listings/1', href: 'https://eno.vn/listings/1' }])
  })

  it('stops at whitespace, a tab and a newline', () => {
    expect(links('https://eno.vn/listings/a\thttps://eno.vn/listings/b\nhttps://eno.vn/listings/c d')).toEqual(['https://eno.vn/listings/a', 'https://eno.vn/listings/b', 'https://eno.vn/listings/c'])
  })
})

describe('jobsDeskLinks — a whole desk message', () => {
  const dm = [
    'Hi Anna, this is Alex from eno.vn.',
    '',
    "We've found these jobs that match your profile:",
    '',
    '1. Part-time teaching job · kids — Binh Thanh, Ho Chi Minh City',
    '   400,000 đ / hour',
    '   Listed on eno.vn',
    '   https://eno.vn/listings/cmjob1',
    '',
    '2. Cover lesson · kids · phonics — District 7, Ho Chi Minh City',
    '   Posted in the Facebook group "HCMC English Teachers"',
    '   https://www.facebook.com/groups/1234/posts/5678/',
    '',
    '3. Full-time teaching job — Hanoi',
    '   Posted on LinkedIn',
    '   https://www.linkedin.com/jobs/view/4012345678',
    '',
    '4. Online teaching job',
    '   Shared with us by the eno.vn team',
    '   How to apply: send your CV via https://forms.gle/abc or http://eno.vn/x',
    '   https://m.facebook.com/groups/99/permalink/100/',
    '',
    '5. Part-time teaching job — Da Nang',
    '   https://www.facebook.com/l.php?u=https%3A%2F%2Fevil.io',
    '',
    'Try applying for those — best of luck!',
    'Matched automatically from your eno.vn profile. Reply STOP to stop these messages.',
  ].join('\n')

  it('links every allowed URL, in order, and nothing else', () => {
    expect(links(dm)).toEqual([
      'https://eno.vn/listings/cmjob1',
      'https://www.facebook.com/groups/1234/posts/5678/',
      'https://www.linkedin.com/jobs/view/4012345678',
      'https://m.facebook.com/groups/99/permalink/100/',
    ])
  })

  it('loses no character of the message, and never puts two text runs side by side', () => {
    const segs = jobsDeskLinks(dm)
    expect(segs.map((s) => s.text).join('')).toBe(dm)
    for (let i = 1; i < segs.length; i++) expect(!segs[i].href && !segs[i - 1].href).toBe(false)
  })

  it('handles many links in one message', () => {
    const many = Array.from({ length: 40 }, (_, i) => `https://eno.vn/listings/${i}`).join(' ')
    expect(links(many)).toHaveLength(40)
    expect(joined(many)).toBe(many)
  })
})

describe('deskLinkHref', () => {
  it('answers the parsed URL for an allowed one and null for the rest', () => {
    expect(deskLinkHref('https://www.eno.vn/listings/1')).toBe('https://www.eno.vn/listings/1')
    expect(deskLinkHref('https://eno.vn:443/listings/x')).toBe('https://eno.vn/listings/x')
    expect(deskLinkHref('not a url')).toBeNull()
    expect(deskLinkHref('ftp://eno.vn/x')).toBeNull()
  })
})
