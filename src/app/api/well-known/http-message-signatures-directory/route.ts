import { NextRequest } from 'next/server'
import { directoryHeaders, keyDirectory } from '@/lib/web-bot-auth'

export const runtime = 'nodejs'

/** /.well-known/http-message-signatures-directory (rewritten here by next.config.ts) — src/lib/web-bot-auth.ts says what and why. */
export async function GET(req: NextRequest) {
  return new Response(JSON.stringify(keyDirectory()), { headers: directoryHeaders(req.headers.get('host')) })
}
