import { describe, expect, it } from 'vitest'
import { searchToolDescriptors } from './tools'

// Chrome's WebMCP guidance caps a parameter description at 150 characters; /webmcp.js registers these schemas as the server
// publishes them (src/lib/webmcp-script.ts parity test), and ora's "WebMCP schema detail" row reads them (2026-11-24).
describe('search tools: parameter descriptions fit WebMCP', () => {
  it('every input parameter description is 150 characters or fewer', () => {
    for (const t of searchToolDescriptors()) {
      const props = ((t.inputSchema as { properties?: Record<string, { description?: string }> }).properties) ?? {}
      for (const [k, v] of Object.entries(props)) expect((v.description ?? '').length, `${t.name}.${k}`).toBeLessThanOrEqual(150)
    }
  })
})
