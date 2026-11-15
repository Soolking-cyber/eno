import { llmsIndexResponse } from '@/lib/llms-txt'

// Matches sitemap.xml: rebuilt daily, not per request. Nothing here is per-visitor.
export const revalidate = 86400

/**
 * /llms.txt — the site's navigation index for agents. Built in src/lib/llms-txt.ts, which also builds /llms-full.txt
 * and the section files (/guides/llms.txt, /teach-in-vietnam/llms.txt): a route module may export only its handlers.
 */
export function GET() {
  return llmsIndexResponse()
}
