/**
 * ⛔ ONE-CLICK CONNECT FOR CHAT APPS (owner 2026-11-17: "direct connect button for major ai providers from the developers page like
 * 1 click connect to claude", then "need chat apps like claude chatgpt etc"). A chat app gets a button ONLY where one click really
 * connects: the app's own directory page for eno.vn, live, whose Connect runs "Sign in with eno.vn". Measured 2026-11-17:
 *   · Claude — claude.ai/directory/eno-vn, live since 2026-11-14.
 *   · ChatGPT — in review (estimate 2026-12-04): add its chatgpt.com/apps page here when approved.
 *   · Meta (Muse) — in review: the same, when approved.
 *   · Grok, Perplexity, Le Chat, Gemini — a custom connector by URL only, on paid plans (Le Chat signs in by Dynamic Client
 *     Registration, which eno does not offer): the MCP page's own steps cover them, no button.
 *   · Code editors (Cursor, VS Code) are not chat apps; Cursor also cannot sign in yet (no CIMD — owner: no button until it can).
 * eno.vn's listings, with no edition branch: eno.forum is gone (owner 2026-11-15 — no edition-aware wording or branches for MCP or
 * new eno.vn work). English, like the rest of the developer docs, which are not translated.
 */
export const CHAT_APP_CONNECTS: ReadonlyArray<{ app: string; href: string }> = [
  { app: 'Claude', href: 'https://claude.ai/directory/eno-vn' },
]
