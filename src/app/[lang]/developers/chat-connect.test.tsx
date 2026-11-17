// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatAppConnect } from './chat-connect'
import { CHAT_APP_CONNECTS } from '@/lib/ai-chat-connect'

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('one-click connect for chat apps (owner 2026-11-17)', () => {
  it('"Add to Claude" opens Claude\'s own eno.vn listing in a new tab', () => {
    const html = renderToStaticMarkup(<ChatAppConnect />)
    expect(html).toContain('href="https://claude.ai/directory/eno-vn"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toMatch(/Add to (<!-- -->)?Claude/)
    expect(html).toContain('(opens in a new tab)')
  })

  it('only https directory pages — a pending app (ChatGPT, Muse) is added when approved, never as a dead button', () => {
    for (const { href } of CHAT_APP_CONNECTS) expect(href).toMatch(/^https:\/\//)
  })

  it('on both developer pages, and no client <Button> (they ship no client script)', () => {
    expect(src('./page.tsx')).toContain('<ChatAppConnect className="mt-4" />')
    expect(src('./mcp/page.tsx')).toContain('<ChatAppConnect className="mt-4" />')
    expect(src('./chat-connect.tsx')).not.toMatch(/import \{[^}]*\bButton\b[^}]*\} from '@\/components\/ui\/button'/)
  })

  it('⛔ server-safe: the modules it calls into during a server render are not client modules (a client reference would throw)', () => {
    for (const rel of ['../../../components/ui/button.tsx', '../../../components/ui/icons.tsx', '../../../lib/utils.ts']) {
      expect(src(rel)).not.toMatch(/^\s*['"]use client['"]/m)
    }
  })
})
