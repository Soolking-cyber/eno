import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Collector for CSP violation reports — both shapes: legacy `report-uri`
// ({ "csp-report": {...} }, content-type application/csp-report) and the Reporting
// API `report-to` ([{ type, body }], application/reports+json). Logs ONE concise line
// per violation to the server logs (Vercel) so we can confirm the policy is clean from
// REAL traffic before promoting CSP from Report-Only to enforcing. Never echoes the
// payload back; body is size-capped and rate-limited (report endpoints are a known
// flood vector). Always 204 — a report sink must give a prober no feedback.
const MAX_BODY = 16 * 1024

// ⚠️ WS6 — NOT MIGRATED. EVERY branch of this route is a BODYLESS 204, and the wrapper cannot emit
// one: a handler's plain-object return always becomes `NextResponse.json(...)`, and `apiFail()`
// always writes `{"error":"<code>"}`. Specifically (WS6 audit, 2026-08-06):
//   · THE THROTTLED ANSWER IS A 204, NOT A 429. `rateLimit:` would answer
//     `{"error":"rate_limited"}` 429, which tells a prober that its reports are landing and that it
//     has found the cap. "Always 204" is the contract stated in the comment above: a report sink
//     gives a prober no feedback at all, and the limiter is deliberately fail-OPEN besides.
//   · THE OVERSIZE AND MALFORMED BRANCHES ARE ALSO 204s, so `body:` / `invalidBodyCode` (a 400)
//     would change both. The cap is checked on `req.text()` BEFORE JSON.parse; `body:` calls
//     `req.json()`, which parses first and never sees a length.
//   · THE PAYLOAD IS NOT `application/json`. Browsers send `application/csp-report` (report-uri) or
//     `application/reports+json` (Reporting API), and the two carry different shapes — one object
//     under a `csp-report` key, or a batch array of `{type, body}`. That is what the reader below
//     normalises; a single zod schema is the wrong tool for it.
// Auth stays public by necessity: the reporter is a browser with no session.
export async function POST(req: NextRequest) {
  // Fail OPEN: telemetry must never throttle real users; the cap only blunts floods.
  const rl = await rateLimit('csp-report', clientIp(req), 60, '1 m')
  if (!rl.success) return new NextResponse(null, { status: 204 })
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY) return new NextResponse(null, { status: 204 })
    const data = JSON.parse(raw)
    const reports = Array.isArray(data)
      ? data.map((r) => r?.body ?? r) // Reporting API batch
      : [data?.['csp-report'] ?? data] // single report-uri payload
    for (const r of reports) {
      if (!r || typeof r !== 'object') continue
      const directive = r['violated-directive'] || r['effectiveDirective'] || r['effective-directive'] || 'unknown'
      const blocked = r['blocked-uri'] || r['blockedURL'] || r['blocked-url'] || 'unknown'
      const doc = r['document-uri'] || r['documentURL'] || ''
      console.warn(`[csp] ${directive} blocked=${String(blocked).slice(0, 200)} doc=${String(doc).slice(0, 200)}`)
    }
  } catch {
    /* ignore malformed reports */
  }
  return new NextResponse(null, { status: 204 })
}
