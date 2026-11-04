import { copyCodePage } from '@/lib/emails/copy-code-page'

export const dynamic = 'force-dynamic'

// The page behind an email's "Copy code" button (src/lib/emails/copy-code-page.ts). No auth, no cookies, nothing about the visitor: the code stays in the
// fragment, which never reaches here. `?l=vi` picks the language and nothing else from the request is read.
export function GET(request: Request): Response {
  const lang = new URL(request.url).searchParams.get('l') === 'vi' ? 'vi' : 'en'
  return new Response(copyCodePage(lang), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' },
  })
}
