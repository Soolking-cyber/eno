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
