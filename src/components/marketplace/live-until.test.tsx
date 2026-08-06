// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LiveUntil } from './live-until'

/**
 * <LiveUntil> gates the PDP's price-drop badge and "Bán gấp" flag on a live clock, because the page
 * is ISR-cached for 30 days and both claims were resolved at generation time.
 *
 * ⚠️ THE RISK RUNS BOTH WAYS, which is why "still shows" is the first test. Wrong in the permissive
 * direction advertises an expired discount; wrong in the strict direction HIDES a real one from
 * every buyer. A live preview could not exercise either path — no listing in the seeded catalogue
 * had an active drop — so this file is the only thing holding it.
 */
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

afterEach(cleanup)

describe('LiveUntil', () => {
  it('SHOWS children while the window is still open', async () => {
    render(<LiveUntil until={inHours(48)}><span>−25%</span></LiveUntil>)
    expect(screen.getByText('−25%')).toBeTruthy()
    // Still there after the mount effect has run — the effect must not retract a live badge.
    await waitFor(() => expect(screen.queryByText('−25%')).toBeTruthy())
  })

  it('retracts children once the window has closed', async () => {
    render(<LiveUntil until={inHours(-1)}><span>−25%</span></LiveUntil>)
    await waitFor(() => expect(screen.queryByText('−25%')).toBeNull())
  })

  it('renders nothing when there is no window at all', () => {
    const { container } = render(<LiveUntil until={null}><span>−25%</span></LiveUntil>)
    expect(container.textContent).toBe('')
  })

  it('does not retract on an unparseable timestamp — it fails toward SHOWING', async () => {
    // A bad value must never silently hide a discount the server said was live.
    render(<LiveUntil until={'not-a-date'}><span>−25%</span></LiveUntil>)
    await waitFor(() => expect(screen.queryByText('−25%')).toBeTruthy())
  })

  /**
   * ⚠️ THE ANTI-MISMATCH CONTRACT, and it has to be checked on the SERVER renderer.
   * Testing Library flushes effects inside render(), so the client can never observe the first
   * pass — the only place the pre-effect output is visible is renderToString, which is exactly
   * what Next emits into the cached HTML. If this ever returns empty markup for a lapsed window,
   * the component has started reading the clock during render and every cached PDP will hydrate
   * with a mismatch.
   */
  it('the SERVER pass renders children even for a lapsed window', () => {
    const html = renderToString(<LiveUntil until={inHours(-100)}><span>−25%</span></LiveUntil>)
    expect(html).toContain('−25%')
  })

  it('the server pass renders nothing when there is no window', () => {
    expect(renderToString(<LiveUntil until={null}><span>−25%</span></LiveUntil>)).toBe('')
  })
})
