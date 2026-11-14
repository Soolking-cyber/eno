/**
 * OpenAI's domain check for the eno.vn ChatGPT plugin (2026-11-14). platform.openai.com › Plugins › eno.vn › MCPs ›
 * Domain verification asks for this exact token, alone and as plain text, at
 * https://eno.vn/.well-known/openai-apps-challenge (served here by a next.config rewrite).
 * The token is PUBLIC by design: it shows OpenAI that whoever runs the plugin also runs eno.vn, and grants nothing.
 * ⛔ Keep it while the plugin is listed; a new token from the portal replaces this one.
 */
export const runtime = 'nodejs'

const OPENAI_APPS_CHALLENGE = 'gcgUUJR1ts4EcPNBG7j_hby4gX4Ll0LmJp9S7artM5g'

export function GET() {
  return new Response(OPENAI_APPS_CHALLENGE, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
}
