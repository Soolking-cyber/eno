/**
 * IslandGuard on the server: it must not change a byte of the HTML (R22). A class boundary adds no DOM and no Suspense,
 * and the server renderer does not use error boundaries; next/dynamic's ssr:false bail-out is taken by next/dynamic's own
 * Suspense, inside the guard, exactly as before. (Node environment: `window` is undefined, as on the server.)
 */
import React from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IslandGuard } from './island-guard'

afterEach(() => { vi.restoreAllMocks() })
// Fixture copy as consts: `react/jsx-no-literals` lints tests too.
const [CLIP, PHOTO, CLIENT_ONLY] = ['clip', 'photo', 'never on the server']

describe('IslandGuard — server HTML', () => {
  it('plain markup renders the same with or without it', () => {
    const island = <span className="absolute inset-0" aria-hidden="true">{CLIP}</span>
    expect(renderToString(<div>{island}</div>)).toBe(renderToString(<div><IslandGuard>{island}</IslandGuard></div>))
  })

  it('a next/dynamic ssr:false island bails out to the client the same way with or without it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const appDynamic = (await import('next/dist/shared/lib/app-dynamic')) as unknown as { default?: unknown }
    const dynamic = (appDynamic.default ?? appDynamic) as (load: () => Promise<React.ComponentType>, o: { ssr: boolean }) => React.ComponentType
    const Island = dynamic(() => Promise.resolve(() => <i>{CLIENT_ONLY}</i>), { ssr: false })
    // ⚠️ React's DEVELOPMENT server build (what vitest loads) writes the bail-out's component stack into the boundary's
    // <template data-cstck>, and that stack names every component above it, the guard included. The production build
    // writes at most `data-dgst` (react-dom-server.node.production.js never emits data-msg/stck/cstck), so the stack is
    // dropped before comparing; everything else must match byte for byte.
    const html = (el: React.ReactElement) => renderToString(el).replace(/ data-cstck="[^"]*"/g, '')
    const bare = html(<p>{PHOTO}<Island /></p>)
    const guarded = html(<p>{PHOTO}<IslandGuard><Island /></IslandGuard></p>)
    expect(guarded).toBe(bare)
    expect(bare).toContain('<p>photo<!--$!--><template') // next/dynamic's own boundary, rendered on the client
    expect(bare).not.toContain(CLIENT_ONLY)
  })
})
