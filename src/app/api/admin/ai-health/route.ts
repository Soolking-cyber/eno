import { ThinkingLevel } from '@google/genai'
import { aiErrorStatus } from '@/lib/ai-retry'
import {
  GEMINI_ITINERARY_MODEL,
  GEMINI_VISA_MODEL,
  geminiDiag,
  getGemini,
} from '@/lib/gemini'
import { getVisaAdmin } from '@/lib/visa/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  const admin = await getVisaAdmin()
  if (!admin) return Response.json({ error: 'admin_required' }, { status: 403 })

  const config = geminiDiag()
  const shouldProbe = new URL(request.url).searchParams.get('probe') === '1'
  if (!shouldProbe) {
    return Response.json({ config }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const ai = getGemini()
  if (!ai) {
    return Response.json({ config, probes: [], error: 'ai_unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const targets = [
    ['itinerary', GEMINI_ITINERARY_MODEL],
    ['visa', GEMINI_VISA_MODEL],
  ] as const
  const probes = await Promise.all(targets.map(async ([workload, model]) => {
    const started = Date.now()
    try {
      const response = await ai.models.generateContent({
        model,
        contents: 'Return only the word OK.',
        config: {
          maxOutputTokens: 16,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          httpOptions: { timeout: 10_000, retryOptions: { attempts: 1 } },
        },
      })
      return {
        workload,
        model,
        ok: response.text?.trim().toUpperCase().includes('OK') === true,
        durationMs: Date.now() - started,
      }
    } catch (error) {
      return {
        workload,
        model,
        ok: false,
        durationMs: Date.now() - started,
        providerStatus: aiErrorStatus(error),
        message: error instanceof Error ? error.message.slice(0, 240) : 'unknown_error',
      }
    }
  }))

  return Response.json({ config, probes }, {
    status: probes.every((probe) => probe.ok) ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
