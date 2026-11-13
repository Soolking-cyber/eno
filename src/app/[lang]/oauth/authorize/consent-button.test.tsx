import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '@/components/ui/button'

/**
 * The consent form has no hidden field: each button carries the sealed ticket as its own name/value (page.tsx). If the
 * Base UI button ever dropped `name` or `value`, Allow would post nothing and every sign-in would read "expired" (review
 * 2026-11-13) — so the real primitive is rendered here and its native attributes checked.
 */
describe('consent buttons', () => {
  it('the ui/button primitive renders a native submit button carrying name and value', () => {
    const label = 'Allow'
    const html = renderToStaticMarkup(<Button type="submit" name="allow" value="sealed.ticket" variant="cta">{label}</Button>)
    expect(html).toMatch(/^<button\b/)
    expect(html).toContain('type="submit"')
    expect(html).toContain('name="allow"')
    expect(html).toContain('value="sealed.ticket"')
  })
})
