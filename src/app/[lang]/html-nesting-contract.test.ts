import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ NO BLOCK ELEMENT INSIDE A <p> — THE HTML PARSER DOES NOT NEST IT, IT CLOSES THE PARAGRAPH.
 *
 * When the server sends `<p>…<p>…</p></p>` or `<p>…<pre>…</pre>…</p>`, the browser ends the outer <p> at
 * the inner block, so the DOM it builds is not the tree React rendered. Hydration then fails with React
 * #418 (production) / "Hydration failed…" (dev), React re-renders the root on the client, and the layout's
 * JSON-LD is emitted a second time. Measured on production 2026-09-29: 2 of 2 cold loads of /partners and
 * /developers threw #418 and carried Organization + WebSite twice (C-HYDRATION). Neither page emits
 * JSON-LD itself — the duplication was a symptom, the nesting the cause:
 *
 *   · /partners passed `intro={<p …>…</p>}`, and ContentPage renders `intro` INSIDE a <p>;
 *   · /developers put `<Code>` — which renders a <pre> — in the middle of a sentence's <p>.
 *
 * Both shapes are invisible to tsc, eslint and a screenshot, so they are pinned here.
 */
const ROOT = 'src/app/[lang]'

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) yield p
  }
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1')

const sources = [...files(ROOT)].map((file) => ({ file, src: stripComments(readFileSync(file, 'utf8')) }))

describe('no block content inside a <p> (React #418)', () => {
  it('scans the route tree (the scan is not vacuous)', () => {
    expect(sources.length).toBeGreaterThan(50)
    expect(sources.some(({ src }) => /\bintro=\{/.test(src))).toBe(true)
  })

  it('never passes a block element as ContentPage `intro` (it renders inside a <p>)', () => {
    const offenders = sources
      .filter(({ src }) => /\bintro=\{\s*<(p|div|ul|ol|section|h[1-6]|pre|table)\b/.test(src))
      .map(({ file }) => file)
    expect(offenders, 'ContentPage wraps `intro` in a <p>: pass phrasing content (text, <span>, <Tr>, <Bilingual>)').toEqual([])
  })

  it('never renders a <pre>-rendering <Code> inside a <p>', () => {
    const offenders: string[] = []
    for (const { file, src } of sources) {
      // Only files whose own `Code` renders a <pre> (developers/page.tsx today).
      const def = src.match(/function Code\([\s\S]*?\n\}/)
      if (!def || !/<pre\b/.test(def[0])) continue
      for (const open of src.matchAll(/<p\b[^>]*>/g)) {
        const from = (open.index ?? 0) + open[0].length
        const close = src.indexOf('</p>', from)
        const inside = src.slice(from, close === -1 ? undefined : close)
        if (/<Code\b/.test(inside)) offenders.push(`${file}: ${inside.trim().slice(0, 80)}`)
      }
    }
    expect(offenders, '<Code> renders a <pre>: use an inline <code> inside a paragraph').toEqual([])
  })
})
