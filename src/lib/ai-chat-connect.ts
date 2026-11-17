/**
 * ⛔ CONNECT AN AI CHAT APP, FROM THE SELLER'S OWN SETTINGS (owner 2026-11-17: "1 click connect to claude"; "need chat apps like
 * claude chatgpt etc"; then "it should be easy connect button [dashboard/settings?tab=developers] here, remove from there [the public
 * /developers pages] — 1 click connect with claude chatgpt grok etc"). Each app connects the way it really can, measured 2026-11-17:
 *   · Claude — ONE CLICK: its directory page for eno.vn (live since 2026-11-14), whose Connect runs "Sign in with eno.vn".
 *   · ChatGPT — "soon": the app is in OpenAI's review (platform.openai.com/plugins: 1.0.3, estimate 2026-11-29). When approved,
 *     make it a `link` to its chatgpt.com/apps page. (Developer mode is beta and plan-gated: not offered to sellers.)
 *   · Grok — no one-click exists: grok.com/connectors → New connector → Custom takes a URL and a Client ID, which eno publishes
 *     for Grok (src/lib/api/oauth-hosted-clients.ts). So the button shows both, each with Copy.
 *   · Perplexity, Le Chat, Gemini — custom connectors by URL on paid plans (Le Chat signs in by Dynamic Client Registration, which
 *     eno does not offer); not offered here. Code editors (Cursor, VS Code) are not chat apps.
 * Client code: these two addresses are literals because their server constants (MCP_RESOURCE, GROK_CLIENT_ID) live in
 * server-only modules; ai-chat-connect.test.ts holds them equal.
 */
export const ENO_MCP_URL = 'https://eno.vn/api/mcp'
export const ENO_GROK_CLIENT_ID = 'https://eno.vn/api/mcp/clients/grok'

export type ChatAppConnect =
  | { app: string; how: 'link'; href: string }
  | { app: string; how: 'soon' }
  /** `values`: what the app's own form asks for, in its own field names. */
  | { app: string; how: 'paste'; open: string; values: ReadonlyArray<{ label: string; value: string }> }

export const CHAT_APPS: ReadonlyArray<ChatAppConnect> = [
  { app: 'Claude', how: 'link', href: 'https://claude.ai/directory/eno-vn' },
  { app: 'ChatGPT', how: 'soon' },
  { app: 'Grok', how: 'paste', open: 'https://grok.com/connectors', values: [{ label: 'URL', value: ENO_MCP_URL }, { label: 'Client ID', value: ENO_GROK_CLIENT_ID }] },
]
