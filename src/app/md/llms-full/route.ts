import { fullLlms } from '@/lib/llms-txt'

// Matches sitemap.xml: rebuilt daily, not per request. Nothing here is per-visitor.
export const revalidate = 86400

/** /llms-full.txt (rewritten here from that path, next.config.ts) — /llms.txt with every guide inline (the root stays a < 30,000-character index; see its builder). */
export function GET() {
  return fullLlms()
}
