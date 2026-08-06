import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { Type } from '@google/genai'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { getGemini, GEMINI_MODEL, GEMINI_MODEL_FALLBACK } from '@/lib/gemini'
import { getSupabaseAdmin, EVIDENCE_BUCKET } from '@/lib/supabase-admin'
import { safeFetch } from '@/lib/ssrf'
import { rateLimit } from '@/lib/ratelimit'
import { reportContext } from '@/lib/admin-reports'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// AI-assisted dispute review: Gemini reads the ACTUAL evidence for one report —
// complaint, listing (+ up to 2 photos), the linked chat transcript, the seller's
// formal reply, both parties' trust history, any appeal — and returns a suggested
// outcome with cited reasoning. STRICTLY ADVISORY: nothing here mutates the case;
// the admin always makes the final call in the moderation queue.
//
// Privacy: display names only — never phone/email. Budget: one GLOBAL daily cap
// (strict — Redis down means no paid calls, matching the other Gemini routes).

const MAX_IMAGES = 4 // dispute-evidence photos are primary; listing/appeal fill the rest
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const DAILY_BUDGET = 200

const OUTCOMES = ['confirm', 'dismiss', 'abusive'] as const
const SEVS = ['minor', 'moderate', 'severe'] as const
const SOURCES = ['conversation', 'listing', 'images', 'report', 'seller_response', 'dispute_thread'] as const

const vnd = (n: number) => `${Math.round(n).toLocaleString('en-US')} VND`
const ageStr = (d: Date) => {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  return days < 1 ? 'under a day' : days < 60 ? `${days} days` : `${Math.floor(days / 30)} months`
}
const parseImages = (raw: string | null | undefined): string[] => {
  try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}

// Fetch one evidence image server-side → downscaled JPEG base64 for inlineData
// (classify's pattern). Skips >4MB / non-image / undecodable — an image can never
// fail the whole review.
async function fetchInline(url: string): Promise<string | null> {
  try {
    // safeFetch enforces https-only + blocks internal/metadata addresses (revalidated
    // per redirect hop). Evidence URLs are already write-time-pinned to our Supabase
    // bucket, but routing through the SSRF guard means a future unfiltered image-write
    // path can't silently turn this admin endpoint into an SSRF proxy (2026-07-06).
    const res = await safeFetch(url, { timeoutMs: 8000 })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null
    return downscale(buf)
  } catch {
    return null
  }
}

// Dispute evidence lives in the PRIVATE bucket as storage paths — read the bytes
// directly with the service client (no HTTP hop, no signed-URL detour).
async function downloadInline(path: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin().storage.from(EVIDENCE_BUCKET).download(path)
    if (error || !data) return null
    const buf = Buffer.from(await data.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null
    return downscale(buf)
  } catch {
    return null
  }
}

async function downscale(buf: Buffer): Promise<string | null> {
  try {
    const jpeg = await sharp(buf, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    return jpeg.toString('base64')
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ai = getGemini()
  if (!ai) return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })

  let body: { reportId?: string; force?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const reportId = String(body.reportId || '').trim()
  if (!reportId) return NextResponse.json({ error: 'missing_report_id' }, { status: 400 })

  const report = await db.report.findUnique({
    where: { id: reportId },
    select: {
      id: true, reason: true, detail: true, severity: true, status: true, createdAt: true,
      listingId: true, conversationId: true, reporterProfileId: true, targetProfileId: true, targetSellerId: true,
      sellerResponse: true, sellerRespondedAt: true, appealNote: true, appealImages: true, appealedAt: true,
      aiAnalysis: true, aiAnalyzedAt: true, lastMessageAt: true,
    },
  })
  if (!report) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Cached analysis (free) unless forced or the thread moved since it was produced —
  // re-opening a case doesn't silently re-spend the daily budget.
  if (!body.force && report.aiAnalysis && report.aiAnalyzedAt) {
    const stale = report.lastMessageAt && report.lastMessageAt > report.aiAnalyzedAt
    if (!stale) {
      try {
        return NextResponse.json({ ...JSON.parse(report.aiAnalysis), cached: true, analyzedAt: report.aiAnalyzedAt.toISOString() })
      } catch { /* corrupt cache → fall through to a fresh run */ }
    }
  }

  // Global daily budget breaker — admin-only surface, so one shared bucket.
  const gate = await rateLimit('admin-ai-review', 'global', DAILY_BUDGET, '1 d', { strict: true })
  if (!gate.success) return NextResponse.json({ error: 'budget_exhausted', message: `Daily AI review budget (${DAILY_BUDGET}) is used up — it resets tomorrow.` }, { status: 429 })

  // ── Evidence gathering (all server-side, display names only — no phone/email) ──
  // Wave 1: everything that depends only on the report row, in parallel.
  const [listing, { convoByReportId }, reporter, thread] = await Promise.all([
    report.listingId
      ? db.listing.findUnique({
          where: { id: report.listingId },
          select: {
            id: true, title: true, description: true, price: true, condition: true, images: true,
            category: { select: { name: true } },
            seller: { select: { id: true, ownerId: true, name: true, trustScore: true, trustTier: true, memberSince: true } },
          },
        })
      : null,
    // Conversation: linked directly (chat report) or derived reporter↔seller thread —
    // same derivation the queue uses (reportContext).
    reportContext([{
      id: report.id, reporterProfileId: report.reporterProfileId, listingId: report.listingId,
      conversationId: report.conversationId, targetSellerId: report.targetSellerId, targetProfileId: report.targetProfileId,
    }]),
    report.reporterProfileId
      ? db.profile.findUnique({ where: { id: report.reporterProfileId }, select: { displayName: true, trustScore: true, falseReportStrikes: true, createdAt: true } })
      : null,
    // Dispute-case thread: both parties' statements + admin mediation, in order.
    db.disputeMessage.findMany({
      where: { reportId: report.id },
      orderBy: { createdAt: 'asc' },
      take: 60,
      select: { senderRole: true, body: true, images: true, createdAt: true },
    }),
  ])

  // Wave 2: needs the derived convo id / target ids from wave 1.
  const convoId = convoByReportId.get(report.id) ?? null
  // Target account context: the reported profile, else the listing's seller / storefront.
  const targetProfileId = report.targetProfileId ?? listing?.seller.ownerId ?? null
  const targetSellerId = report.targetSellerId ?? listing?.seller.id ?? null
  const targetOr = [
    targetProfileId ? { targetProfileId } : null,
    targetSellerId ? { targetSellerId } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null)
  const [convo, targetProfile, priorConfirmed] = await Promise.all([
    convoId
      ? db.conversation.findUnique({
          where: { id: convoId },
          select: {
            buyerProfileId: true,
            messages: { orderBy: { createdAt: 'desc' }, take: 40, select: { senderProfileId: true, body: true, kind: true, offerAmount: true, offerStatus: true } },
          },
        })
      : null,
    targetProfileId
      ? db.profile.findUnique({ where: { id: targetProfileId }, select: { displayName: true, trustScore: true, trustTier: true, createdAt: true } })
      : null,
    targetOr.length
      ? db.report.count({ where: { status: 'confirmed', id: { not: report.id }, OR: targetOr } })
      : 0,
  ])
  // Storefront fallback only when the profile lookup came back empty (and no listing
  // already carries the seller) — genuinely sequential.
  const targetSeller = !targetProfile && targetSellerId && !listing
    ? await db.seller.findUnique({ where: { id: targetSellerId }, select: { name: true, trustScore: true, trustTier: true, memberSince: true } })
    : null

  // ── Images: up to MAX_IMAGES as inlineData. Dispute evidence is primary (that's
  // what the parties submitted to be judged), then appeal proof, then listing photos.
  const listingImages = parseImages(listing?.images)
  const appealImages = parseImages(report.appealImages)
  const evidencePaths = thread.flatMap((m) => parseImages(m.images)).filter((p) => !p.startsWith('http'))
  const candidates = report.appealedAt ? [...appealImages, ...listingImages] : [...listingImages, ...appealImages]
  // Fetch in parallel (each fetch keeps its own 8s timeout and swallows its own
  // failure — one bad image can never sink the review), then keep the first
  // MAX_IMAGES successes in priority order. The batch is bounded at 2× the cap so
  // a long thread doesn't fan out into dozens of downloads just to fill 4 slots.
  const imageFetches: Array<Promise<string | null>> = [
    ...evidencePaths.map((path) => downloadInline(path)),
    ...candidates.map((url) => fetchInline(url)),
  ].slice(0, MAX_IMAGES * 2)
  const inlineImages = (await Promise.allSettled(imageFetches))
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((b): b is string => !!b)
    .slice(0, MAX_IMAGES)

  // ── Evidence dossier (plain text — the model quotes verbatim from this) ──
  const targetName = targetProfile?.displayName || listing?.seller.name || targetSeller?.name || 'Unknown'
  const targetTrust = targetProfile
    ? `trust ${targetProfile.trustScore} (${targetProfile.trustTier}), account age ${ageStr(targetProfile.createdAt)}`
    : listing
      ? `trust ${listing.seller.trustScore} (${listing.seller.trustTier}), storefront age ${ageStr(listing.seller.memberSince)}${listing.seller.ownerId ? '' : ', GUEST storefront (unclaimed account)'}`
      : targetSeller
        ? `trust ${targetSeller.trustScore} (${targetSeller.trustTier}), storefront age ${ageStr(targetSeller.memberSince)}`
        : 'unknown'

  const sections: string[] = []
  sections.push([
    'REPORT',
    `- Reason: ${report.reason}`,
    `- Filed: ${report.createdAt.toISOString().slice(0, 10)} (${ageStr(report.createdAt)} ago)`,
    `- Severity preset in queue: ${report.severity || 'not set'}`,
    `- Reporter's complaint: ${report.detail ? `"${report.detail}"` : 'none provided'}`,
  ].join('\n'))

  sections.push([
    'REPORTER CONTEXT',
    reporter
      ? `- "${reporter.displayName || 'Reporter'}": trust ${reporter.trustScore}, false-report strikes ${reporter.falseReportStrikes}, account age ${ageStr(reporter.createdAt)}`
      : '- Reporter account removed / unknown.',
  ].join('\n'))

  sections.push([
    'REPORTED PARTY CONTEXT',
    `- "${targetName}": ${targetTrust}`,
    `- Prior CONFIRMED reports against them: ${priorConfirmed}`,
  ].join('\n'))

  if (listing) {
    sections.push([
      'REPORTED LISTING',
      `- Title: ${listing.title}`,
      `- Price: ${vnd(listing.price)}`,
      `- Category: ${listing.category.name}`,
      `- Condition: ${listing.condition || 'not stated'}`,
      `- Description: ${listing.description.slice(0, 1500)}`,
    ].join('\n'))
  }

  sections.push([
    "SELLER'S FORMAL REPLY TO THIS REPORT",
    report.sellerResponse
      ? `"${report.sellerResponse}"`
      // The one-shot dispute flow records the respondent's statement as a thread
      // message (see DISPUTE-CASE THREAD below) and only stamps sellerRespondedAt —
      // so a set timestamp means they DID reply, in the thread, not "not provided".
      : report.sellerRespondedAt
        ? 'Provided as their statement in the dispute-case thread below.'
        : `Not provided (asked ${ageStr(report.createdAt)} ago).`,
  ].join('\n'))

  if (report.appealedAt) {
    sections.push([
      'APPEAL (the reported party contests the decision)',
      `- Filed: ${report.appealedAt.toISOString().slice(0, 10)}`,
      `- Statement: ${report.appealNote ? `"${report.appealNote}"` : 'none'}`,
      `- Proof photos submitted: ${appealImages.length}`,
    ].join('\n'))
  }

  if (thread.length) {
    const roleLabel: Record<string, string> = { reporter: 'Reporter', respondent: 'Reported party', admin: 'eno.vn moderator', system: 'System' }
    const lines = thread.map((m) => {
      const imgs = parseImages(m.images).length
      return `${roleLabel[m.senderRole] || 'System'} (${m.createdAt.toISOString().slice(0, 10)}): ${m.body.slice(0, 600)}${imgs ? ` [+${imgs} evidence photo(s)]` : ''}`
    })
    sections.push(`DISPUTE CASE THREAD (statements + evidence both parties submitted for judgment, oldest first)\n${lines.join('\n')}`)
  }

  if (convo && convo.messages.length) {
    const lines = [...convo.messages].reverse().map((m) => {
      const who = m.senderProfileId === convo.buyerProfileId ? 'Buyer' : 'Seller'
      if (m.kind === 'offer') {
        const note = m.body && !m.body.startsWith('💰') ? ` ${m.body.slice(0, 300)}` : ''
        return `${who}: [OFFER ${vnd(m.offerAmount || 0)} — ${m.offerStatus || 'pending'}]${note}`
      }
      return `${who}: ${m.body.slice(0, 500)}`
    })
    sections.push(`CONVERSATION BETWEEN THE PARTIES (last ${lines.length} messages, oldest first)\n${lines.join('\n')}`)
  } else {
    sections.push('CONVERSATION\nNo conversation between the parties is on record.')
  }

  sections.push(`ATTACHED IMAGES\n${inlineImages.length ? `${inlineImages.length} photo(s) attached (${evidencePaths.length ? 'dispute evidence first, then ' : ''}${report.appealedAt && appealImages.length ? 'appeal proof, then listing' : 'listing'} photos).` : 'None available.'}`)

  const prompt = `You are a neutral trust-&-safety adjudicator for eno.vn, a classifieds marketplace in Vietnam. Content may be English or Vietnamese — quote evidence in its ORIGINAL language.

A report was filed and a human moderator must resolve it. Review ONLY the evidence below and suggest an outcome. You are ADVISORY — the human makes the final call.

Outcomes:
- "confirm": the report is substantiated — the reported party violated policy. Also pick "severity": "minor" (small/inaccurate-info issue), "moderate" (clear violation), or "severe" (scam/fraud/serious harm).
- "dismiss": the evidence does not substantiate the report. severity null.
- "abusive": the REPORT itself is false or bad-faith (penalizes the reporter). severity null.

Watch for BOTH directions:
- Scam patterns: too-good-to-be-true pricing, pushing deposits/payment off-platform before meeting, stock/watermarked photos, evasive or contradictory replies, urgency pressure, brand-new account with prior confirmed reports.
- Report abuse: competitor sabotage, retaliation right after a declined offer or dispute, demands to get something in exchange for withdrawing, a reporter with false-report strikes, no concrete claim.

Rules: weigh ONLY the provided evidence; never invent facts; every "quote" in keyEvidence must be VERBATIM from the material above (or describe exactly what an attached image shows, source "images"); explicitly list what is MISSING that would firm up the call; set confidence low when evidence is thin or one-sided.

Return ONLY JSON:
{"outcome":"confirm"|"dismiss"|"abusive","severity":"minor"|"moderate"|"severe"|null,"confidence":0..1,"reasoning":[up to 5 short bullets],"keyEvidence":[{"source":"conversation"|"listing"|"images"|"report"|"seller_response"|"dispute_thread","quote":"..."}],"counterpoints":[up to 3 bullets for the opposite reading],"missing":[what would firm this up]}

EVIDENCE:

${sections.join('\n\n')}`

  type Parsed = { outcome?: string; severity?: string | null; confidence?: number; reasoning?: unknown; keyEvidence?: unknown; counterpoints?: unknown; missing?: unknown }
  const contents = [{
    role: 'user',
    parts: [
      ...inlineImages.map((data) => ({ inlineData: { mimeType: 'image/jpeg', data } })),
      { text: prompt },
    ],
  }]
  // Adjudication gets dynamic thinking + a generous token cap (thoughts bill as
  // output); if the model fails, fall back to the previous flash so the button
  // degrades instead of erroring.
  const attempts = [
    { model: GEMINI_MODEL, config: { maxOutputTokens: 4096 } },
    { model: GEMINI_MODEL_FALLBACK, config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 768 } },
  ]
  let parsed: Parsed = {}
  let ok = false
  for (const attempt of attempts) {
    try {
      const res = await ai.models.generateContent({
        model: attempt.model,
        contents,
        config: {
          temperature: 0.2,
          ...attempt.config,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              outcome: { type: Type.STRING },
              severity: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              reasoning: { type: Type.ARRAY, items: { type: Type.STRING } },
              keyEvidence: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { source: { type: Type.STRING }, quote: { type: Type.STRING } }, required: ['source', 'quote'] } },
              counterpoints: { type: Type.ARRAY, items: { type: Type.STRING } },
              missing: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['outcome', 'confidence', 'reasoning'],
          },
        },
      })
      let txt = (res.text || '').trim()
      if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
      parsed = JSON.parse(txt || '{}')
      ok = true
      break
    } catch (e) {
      console.error(`[admin/ai-review] ${attempt.model}`, e)
    }
  }
  if (!ok) return NextResponse.json({ error: 'ai_failed' }, { status: 502 })

  // Validate — never trust the model's fields blindly.
  const outcome = OUTCOMES.find((o) => o === parsed.outcome)
  if (!outcome) return NextResponse.json({ error: 'ai_failed' }, { status: 502 })
  const severity = outcome === 'confirm' ? (SEVS.find((s) => s === parsed.severity) ?? null) : null
  const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0))
  const strList = (v: unknown, max: number, len = 300): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, len)).slice(0, max) : []
  const keyEvidence = (Array.isArray(parsed.keyEvidence) ? parsed.keyEvidence : [])
    .filter((e): e is { source: string; quote: string } => !!e && typeof e === 'object' && typeof (e as { quote?: unknown }).quote === 'string' && !!String((e as { quote?: unknown }).quote).trim())
    .map((e) => ({ source: SOURCES.find((s) => s === e.source) ?? 'report', quote: e.quote.trim().slice(0, 300) }))
    .slice(0, 5)

  const result = {
    outcome,
    severity,
    confidence,
    reasoning: strList(parsed.reasoning, 5),
    keyEvidence,
    counterpoints: strList(parsed.counterpoints, 3),
    missing: strList(parsed.missing, 4, 200),
  }

  // Cache on the case — reopening the room shows the analysis for free; a moved
  // thread (lastMessageAt newer) invalidates it on the next request. Best-effort.
  await db.report.update({
    where: { id: reportId },
    data: { aiAnalysis: JSON.stringify(result), aiAnalyzedAt: new Date() },
  }).catch((e) => logError(e, { op: 'ai-review.call' }))

  return NextResponse.json(result)
}
