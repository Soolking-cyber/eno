/**
 * Muse's domain check for the eno.vn connector (2026-11-14). platform.muse.ai › Submissions › eno.vn › Technical details ›
 * Verify server fetches https://eno.vn/.well-known/muse-challenge/<token> (served here by a next.config rewrite of that
 * exact path) and needs HTTP 200 with only "muse-challenge=<token>" as plain text. Public by design: it proves whoever
 * submitted the connector runs eno.vn, and grants nothing. A new challenge from the portal replaces both this line and
 * the rewrite; this one expires 2026-11-21 once verified.
 */
export const runtime = 'nodejs'

export function GET() {
  return new Response('muse-challenge=bdbd554b70789a33184fa5931210498ed27535f6a3524a4c77fff7d4df019627', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
}
