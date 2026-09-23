// @vitest-environment node
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The SERVER half of the Vietnamese dictionary's failure path (audit #1 review). On the client a
 * failed chunk must degrade the page to English; on the SERVER the same failure must FAIL THE
 * RENDER — otherwise English HTML is written at a Vietnamese URL and kept for hours by ISR and
 * Cloudflare. Node environment, so `window` is undefined exactly as it is in SSR.
 */
vi.mock('@/generated/vi-overrides', async () => {
  await new Promise((r) => setTimeout(r, 10))
  throw new Error('simulated dictionary load failure')
})

describe('the vi dictionary on the server', () => {
  it('a dictionary that fails to load FAILS the render — never English cached at a vi URL', async () => {
    const { LanguageProvider, Tr } = await import('@/context/language-context')
    const { renderToReadableStream } = await import('react-dom/server')
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const render = async () => {
      const stream = await renderToReadableStream(<LanguageProvider initialLang="vi"><p><Tr text="Latest listings" /></p></LanguageProvider>)
      await stream.allReady
      return new Response(stream).text()
    }
    // The SPECIFIC error, anywhere in its cause chain (Vitest wraps a failing mock factory): a bare
    // `toThrow()` would also pass on an unrelated TypeError and prove nothing.
    const err: unknown = await render().then(() => null, (e: unknown) => e)
    const chain: string[] = []
    for (let e = err as { message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) chain.push(String(e.message ?? e))
    expect(chain.join(' | ')).toMatch(/simulated dictionary load failure/)
    quiet.mockRestore()
  })

  /**
   * ⛔ THE GATE STAYS HOOKLESS. React #467 ("Update hook called on initial render") broke the first
   * cut in the production build only — `use()` placed before hooks in a component that suspends on
   * its first mount — and neither jsdom nor this file's SSR reproduces it. So the invariant is pinned
   * structurally: ViDictGate may call `use()`, and no other hook.
   */
  it('ViDictGate calls no hook but use()', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./language-context.tsx', import.meta.url), 'utf8')
    const start = src.indexOf('function ViDictGate(')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('\n}\n', start))
    const hooks = [...body.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1])
    expect(hooks).toEqual([])
    expect(body).toMatch(/\buse\(/)
  })
})
