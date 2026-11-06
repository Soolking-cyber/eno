import { copyCodePage } from '@/lib/emails/copy-code-page'

export const dynamic = 'force-dynamic'

// The page behind the "Copy code" button of emails sent before 2026-11-06, when the button was removed (layout.ts emailCopyHintRow). Kept so those links
// don't 404 (commit gate, codex); new emails link nowhere. Safe to delete once no such email can hold a live code. (src/lib/emails/copy-code-page.ts). No auth, no cookies, nothing about the visitor: the code stays in the
// fragment, which never reaches here. `?l=vi` picks the language and nothing else from the request is read.
export function GET(request: Request): Response {
  const lang = new URL(request.url).searchParams.get('l') === 'vi' ? 'vi' : 'en'
  return new Response(copyCodePage(lang), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' },
  })
}
