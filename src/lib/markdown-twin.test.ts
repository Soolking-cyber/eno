import { describe, expect, it } from 'vitest'
import { decodeEntities, escapeMarkdown, htmlToMarkdown, mainOf, markdownTwin } from './markdown-twin'

const PAGE = `<!doctype html><html><head><title>x</title><script>var a = "<main>"</script></head><body>
<header><a href="/">eno.vn</a></header>
<main class="m"><h1 class="h-display">About &amp; trust</h1>
<p>Read the <a href="/regulations#fees">Regulations</a> or <a href="https://example.com/x">this</a>; <a href="javascript:alert(1)">bad</a>.</p>
<script>window.__x = 1</script><svg><path d="M0"/></svg><button>Menu</button>
<h2>At a glance</h2><ul><li>Free</li><li>Fast</li></ul>
<table><tr><th>Listing</th><th>Rate</th></tr><tr><td>Houses</td><td>20%</td></tr></table>
<p>Line one<br>line two &#8212; caf&eacute;s 4,500,000&nbsp;đ</p></main>
<footer>footer text</footer></body></html>`

describe('markdown twins', () => {
  it('takes only <main>, drops scripts, svg and buttons, and opens with the H1', () => {
    const md = markdownTwin(PAGE, 'https://eno.vn/about', 'https://eno.vn')!
    expect(md.startsWith('# About & trust\n')).toBe(true)
    expect(md).not.toContain('window.__x')
    expect(md).not.toContain('Menu')
    expect(md).not.toContain('footer text')
    expect(md).toContain('## At a glance')
    expect(md).toContain('This is the markdown copy of https://eno.vn/about.')
  })

  it('links: a site path becomes absolute, an http(s) link stays, anything else is just its text', () => {
    const md = htmlToMarkdown(mainOf(PAGE)!, 'https://eno.vn')
    expect(md).toContain('[Regulations](https://eno.vn/regulations#fees)')
    expect(md).toContain('[this](https://example.com/x)')
    expect(md).not.toContain('javascript:')
    expect(md).toContain('bad')
  })

  it('a list stays one list; table rows keep their cells; breaks and entities survive', () => {
    const md = htmlToMarkdown(mainOf(PAGE)!, 'https://eno.vn')
    expect(md).toContain('- Free\n- Fast')
    expect(md).toContain('Houses | 20% |')
    expect(md).toContain('Line one\nline two')
    expect(decodeEntities('&#8212; &nbsp;&amp;&#x27;')).toBe("—  &'") // &nbsp; becomes a plain space in markdown
  })

  it('⛔ page text never becomes markdown: a seller\'s link, heading or emphasis stays literal (commit gate, opus)', () => {
    const md = markdownTwin('<main><h1>Phone</h1><p>[Pay deposit](https://evil.example) # Verified by eno.vn **now**</p></main>', 'u', 'https://eno.vn')!
    expect(md).toContain('\\[Pay deposit\\]\\(https://evil.example\\) \\# Verified by eno.vn \\*\\*now\\*\\*')
    expect(md).not.toMatch(/(^|[^\\])\[Pay deposit\]\(/)
    expect(md.match(/^# /gm)).toHaveLength(1) // only the page's own H1
    expect(escapeMarkdown('a_b|c')).toBe('a\\_b\\|c')
  })

  it('⛔ page text cannot open a line with markdown either: no setext heading, no fake list item (commit gate, opus)', () => {
    const md = markdownTwin('<main><h1>Phone</h1><p>Verified by eno.vn<br>===<br>- free gift<br>1. call now</p><p>a\n- b</p></main>', 'u', 'o')!
    expect(md).toContain('Verified by eno.vn\n\\===\n\\- free gift\n1\\. call now')
    expect(md).toContain('a - b') // a newline inside page text is a space
    expect(decodeEntities('&#99999999; &#x110000; &#65;')).toBe('&#99999999; &#x110000; A')
  })

  it('a run after a non-block tag or a whitespace-only span still cannot open a heading underline or a list', () => {
    const md = markdownTwin('<main><h1>T</h1><p>x</p><details>===</details><p><span> </span>- y</p></main>', 'u', 'o')!
    expect(md).not.toMatch(/^===|^- y/m)
  })

  it('no <main>, or no H1, means no twin', () => {
    expect(markdownTwin('<html><body><h1>x</h1></body></html>', 'u', 'o')).toBeNull()
    expect(markdownTwin('<main><p>no heading</p></main>', 'u', 'o')).toBeNull()
  })
})
