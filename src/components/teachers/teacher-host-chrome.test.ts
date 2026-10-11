import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// teacher.<base> serves the sign-up form and nothing else (owner, 2026-10-11): no tab bar there — every tab led off the
// host and its Account tab opened a sign-in that returned to eno.vn's HOME page. Decided on the server (the page reads the
// Host header), so the first paint is right: the page marks <main data-teacher-host> and an unlayered rule hides the bar.
describe('the teacher host has no tab bar', () => {
  it('the join page marks <main> only on the teacher host', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/[lang]/teachers/join/page.tsx'), 'utf8')
    expect(page).toContain("data-teacher-host={draftHost ? '' : undefined}")
  })
  it('globals.css hides .mobile-nav and its spacer under it, and drops the form bar\'s clearance — all unlayered', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toContain('body:has([data-teacher-host]) .mobile-nav,\nbody:has([data-teacher-host]) .bottom-nav-spacer {\n  display: none;\n}')
    expect(css).toContain('body:has([data-teacher-host]) {\n  --teacher-tabbar-offset: 0px;\n}')
    // …and the form reads it, falling back to the tab bar's 4.5rem wherever the rule does not apply
    const form = readFileSync(join(process.cwd(), 'src/components/teachers/teacher-form.tsx'), 'utf8')
    expect(form).toContain('offsetBottom="var(--teacher-tabbar-offset, 4.5rem)"')
    const at = css.indexOf('body:has([data-teacher-host]) .mobile-nav')
    const layerOpen = css.lastIndexOf('@layer', at)
    const layerClose = layerOpen === -1 ? -1 : css.indexOf('\n}', layerOpen)
    expect(layerOpen === -1 || layerClose < at).toBe(true)
  })
})
