import 'server-only'
import { db } from '@/lib/db'
import type { CallRole } from '../types'
import { CallTelemetrySummary, containsIpLikeString } from '../telemetry'

/**
 * In-app calls — storing one telemetry summary (DESIGN.md v3 §3.6), exactly as telemetry.ts's header prescribes:
 * parse with the SAME CallTelemetrySummary the phone built it with (strict at every level, plus the "__proto__"
 * check zod skips), re-check the PARSED output for anything IP-shaped, confirm it speaks for this call and this
 * person's side, then store the parsed output — never the raw body — once per (call, role, seq).
 * Returns false when it was refused (the route answers 400) — the phone does not retry a refused summary.
 */
export async function storeTelemetry(callId: string, role: CallRole, input: unknown): Promise<boolean> {
  const parsed = CallTelemetrySummary.safeParse(input)
  if (!parsed.success) return false
  const s = parsed.data
  if (s.callId !== callId || s.role !== role) return false
  if (containsIpLikeString(s)) return false
  await db.$executeRaw`
    INSERT INTO public.call_telemetry (call_id, role, seq, payload)
    VALUES (${callId}::uuid, ${role}, ${s.seq}, ${JSON.stringify(s)}::jsonb)
    ON CONFLICT (call_id, role, seq) DO NOTHING`
  return true
}
