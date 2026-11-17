import { describe, expect, it } from 'vitest'
import { CHAT_APPS, ENO_GROK_CLIENT_ID, ENO_MCP_URL } from './ai-chat-connect'
import { MCP_RESOURCE } from '@/lib/api/oauth-grant'
import { GROK_CLIENT_ID } from '@/lib/api/oauth-hosted-clients'

describe('connect an AI chat app (Settings › Developers)', () => {
  it('⛔ the addresses the seller copies are the server\'s own on eno.vn (client code cannot import them)', () => {
    // Same paths as the server's constants (whose origin is this test run's edition), on eno.vn's origin.
    expect(new URL(ENO_MCP_URL).pathname).toBe(new URL(MCP_RESOURCE).pathname)
    expect(new URL(ENO_GROK_CLIENT_ID).pathname).toBe(new URL(GROK_CLIENT_ID).pathname)
    expect(new URL(ENO_MCP_URL).origin).toBe('https://eno.vn')
    expect(new URL(ENO_GROK_CLIENT_ID).origin).toBe('https://eno.vn')
  })
  it('Claude one click into its eno.vn listing; ChatGPT soon (in review); Grok by pasting', () => {
    expect(CHAT_APPS).toEqual([
      { app: 'Claude', how: 'link', href: 'https://claude.ai/directory/eno-vn' },
      { app: 'ChatGPT', how: 'soon' },
      { app: 'Grok', how: 'paste', open: 'https://grok.com/connectors', values: [{ label: 'URL', value: ENO_MCP_URL }, { label: 'Client ID', value: ENO_GROK_CLIENT_ID }] },
    ])
  })
})
