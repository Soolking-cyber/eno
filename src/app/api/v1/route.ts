import type { NextRequest } from 'next/server'
import { GET as statusGET } from './status/route'
import { DELETE, OPTIONS, PATCH, POST, PUT } from '../[[...path]]/route'

/**
 * GET /api/v1 — THE API ROOT ANSWERS WITH THE SERVICE DOCUMENT (2026-11-11).
 *
 * It was a JSON 404 (src/app/api/[[...path]]/route.ts, "No API route matches GET /api/v1"), yet it is the URL the OpenAPI
 * document names as `servers[0].url` and the RFC 9727 catalogue lists as the API: the first thing a client that reads
 * either one fetches, and a 404 there reads as "no API". Now it is GET /status's document — same handler, same per-IP
 * discovery bucket, same `Cache-Control: no-store` and headers — so the root and /status can never disagree.
 * ⛔ EVERY OTHER METHOD IS RE-EXPORTED FROM THE CATCH-ALL (src/app/api/[[...path]]/route.ts), unchanged. Once this file
 * exists Next routes every /api/v1 request here, and a method it does not export answers Next's own 405 with an EMPTY
 * body — the contentless failure that catch-all exists to prevent. So POST/PUT/PATCH/DELETE/OPTIONS keep the JSON
 * `not_found` envelope they got before (both reviewers caught the first cut, which exported GET alone). HEAD follows GET.
 * ⚠️ NOT A PATH IN THE OPENAPI DOCUMENT, on purpose: OpenAPI joins `servers[0].url` and `/` into `…/api/v1/`, and with
 * trailingSlash off that URL 308s here (measured on /api/v1/status/), so a documented `/` would promise a 200 it gives as
 * a redirect. The root is the server URL itself; GET /status stays the documented operation.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  return statusGET(req)
}

export { DELETE, OPTIONS, PATCH, POST, PUT }
