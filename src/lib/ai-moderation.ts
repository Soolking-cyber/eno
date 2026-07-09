import 'server-only'
import sharp from 'sharp'
import { Type } from '@google/genai'
import { Prisma } from '@/generated/prisma/client'
import { getGemini, GEMINI_MODEL } from '@/lib/gemini'
import { db } from '@/lib/db'

// ── AI illegal-content moderation (Tier 2, async post-publish) ─────────────────────────
// The inline word-scan (publish-guard) blocks CLEAR prohibited text at publish time. This
// adds a Gemini VISION+TEXT pass that runs AFTER publish (via after()) and catches what the
// word list can't: obfuscated/synonymed text, and — crucially — IMAGES (a firearm photo
// with innocuous text). On a high-confidence hit it auto-HIDES the listing, files an admin
// report, and notifies the seller. It NEVER penalises trust directly — only admin-confirmed
// reports move scores (per the trust design); this just surfaces the case.
//
// COST/SAFETY BALANCE: the paid vision call runs only for the risky population — sellers who
// have NOT yet earned Trusted (standard/restricted) — plus a small random sample of trusted
// accounts to catch one that's been compromised. Proven Trusted/Exceptional sellers skip it.

// The prohibited categories, aligned to the published /prohibited policy + VN law
// (Weapons Law 42/2024, Resolution 173/2024 e-cigarette ban, Pharmacy Law P2P-medicine ban,
// CITES, PDPL data-trading ban, Decree 98/2020 prohibited goods, anti-MLM/gambling rules).
const PROHIBITED_CATEGORIES = `
- drugs: narcotics, cannabis, precursor chemicals, recreational pills
- weapons: firearms, ammunition, explosives, fireworks, military/police support tools (tasers, batons, knuckle-dusters, combat knives), realistic replica guns
- sexual: prostitution/escort services, pornography
- wildlife: CITES-protected animal parts (ivory, rhino horn, tiger bone, pangolin, bear bile, shark fin) and live protected wildlife
- tobacco_vape: e-cigarettes, vapes, pods, e-liquid, heated tobacco, shisha (banned in VN since 1 Jan 2025)
- medicine: prescription/Rx medicines, antibiotics, sedatives, weight-loss or sexual-enhancement drugs (no lawful peer-to-peer sale route)
- fraud: counterfeit money, forged documents (fake IDs/passports/licenses/diplomas), stolen cards, red/VAT invoices, money-laundering or loan-sharking/debt-collection services
- data_sim: pre-activated/junk SIM cards, bulk personal-data / customer lists
- surveillance: covert/spy cameras, hidden listening devices, GPS/signal jammers
- counterfeit: fake branded goods (replica/AAA/1:1 designer items)
- other_illegal: MLM schemes, police/military uniforms & insignia, gambling machines/services, human/organ trade
`.trim()

export type ModerationResult = { prohibited: boolean; category: string; confidence: number; reason: string }

/** Should the (paid) AI vision pass run for this seller? Skips proven-Trusted sellers to save
 *  cost, with a ~5% random sample to still catch a turned account. Everyone unproven runs. */
export function shouldAiModerate(seller: { trustTier: string }): boolean {
  if (seller.trustTier === 'trusted' || seller.trustTier === 'exceptional') return Math.random() < 0.05
  return true // standard (unproven) + restricted → always moderate
}

/** Classify a listing (text + up to 4 photos) against the VN prohibited categories via Gemini.
 *  FAIL-OPEN: returns null on any failure (AI unavailable / decode / parse) — never blocks. */
export async function moderateListing(input: { title: string; description: string; imageUrls: string[] }): Promise<ModerationResult | null> {
  const ai = getGemini()
  if (!ai) return null

  // Fetch + downscale the images the buyer would see (public URLs). Cap at 4 to bound cost.
  const parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] = []
  for (const url of input.imageUrls.slice(0, 4)) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const buf = await sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: 50_000_000 })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } })
    } catch { /* skip an unreadable image */ }
  }

  const prompt = `You are the content-safety reviewer for eno.vn, a marketplace for expats in Vietnam. Decide whether THIS listing offers a PROHIBITED item or service under Vietnamese law.

Prohibited categories (return the matching key in "category"):
${PROHIBITED_CATEGORIES}

Judge the TITLE, DESCRIPTION and PHOTOS together. Be PRECISE and CONSERVATIVE — a normal, legal listing must NEVER be flagged. Do not flag an item merely because a word could be misread: a "gun" that is a glue/nail/heat gun, "weed" that is a weed killer, a toy/airsoft clearly sold as a toy, a wine fridge, a legal supplement, or a used phone/SIM tray are all FINE. Only flag when you are genuinely confident the item itself is prohibited.

Return JSON: { "prohibited": boolean, "category": one of the keys above or "", "confidence": 0..1 (your certainty it is prohibited), "reason": one short sentence citing what in the text/photo makes it prohibited }.

Listing title: ${JSON.stringify(input.title)}
Listing description: ${JSON.stringify(input.description).slice(0, 2000)}`
  parts.push({ text: prompt })

  try {
    const r = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            prohibited: { type: Type.BOOLEAN },
            category: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            reason: { type: Type.STRING },
          },
          required: ['prohibited', 'category', 'confidence', 'reason'],
        },
      },
    })
    const p = JSON.parse(r.text ?? '{}') as Partial<ModerationResult>
    return {
      prohibited: !!p.prohibited,
      category: String(p.category ?? ''),
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
      reason: String(p.reason ?? '').slice(0, 300),
    }
  } catch (e) {
    console.error('[ai-moderation] classify failed (fail-open)', e)
    return null
  }
}

// Auto-hold only on a HIGH-confidence hit — the bar is deliberately high so a legit listing
// is never auto-hidden; anything softer is left to the word-scan + user reports.
const HOLD_CONFIDENCE = 0.85

/** Listing.images is a JSON string of URLs; parse defensively (never throw). */
function parseImages(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Post-publish moderation by id: re-reads the CURRENT listing (so it re-scans edits, not
 *  just the original), gates on trust, classifies, and on a high-confidence prohibited hit
 *  HIDES the listing + files an admin report + notifies the seller. Called via after() from
 *  EVERY publish path (create, edit, bulk/sync) so there's no ingestion gap. Runs off the
 *  response path; fully self-contained + fail-open (any error logged, never rethrown). */
export async function moderateListingById(listingId: string): Promise<void> {
  try {
    const l = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true, title: true, description: true, images: true, status: true,
        seller: { select: { trustTier: true, ownerId: true } },
      },
    })
    // Skip if it's gone or already not-live (deleted / hidden between publish and this run).
    if (!l || l.status !== 'active' || !l.seller) return
    if (!shouldAiModerate({ trustTier: l.seller.trustTier })) return

    const result = await moderateListing({ title: l.title, description: l.description, imageUrls: parseImages(l.images) })
    if (!result || !result.prohibited || result.confidence < HOLD_CONFIDENCE) return

    // Hide + admin report + seller notice, ATOMICALLY — a $transaction so we never leave a
    // listing hidden without an audit card / seller notice if one write fails (it rolls back
    // and stays live, fail-open). Feed requires verified=true AND status='active'. The admin
    // confirming the report is what moves trust — the AI never penalises directly.
    const writes: Prisma.PrismaPromise<unknown>[] = [
      db.listing.update({ where: { id: l.id }, data: { status: 'hidden', verified: false } }),
      db.report.create({
        data: {
          listingId: l.id,
          reason: 'prohibited',
          detail: `AI moderation: ${result.category || 'prohibited'} — ${result.reason}`,
          status: 'open',
          internalNote: `Auto-hidden by AI content-safety (confidence ${result.confidence.toFixed(2)}). Confirm to penalise, or dismiss + un-hide if a false positive.`,
        },
      }),
    ]
    if (l.seller.ownerId) {
      writes.push(db.notification.create({
        data: {
          recipientId: l.seller.ownerId,
          type: 'system',
          title: 'Listing held for review',
          body: 'Your listing was hidden pending a safety review because it may show a prohibited item. If this is a mistake, our team will restore it.',
          url: `/listings/${l.id}`,
        },
      }))
    }
    await db.$transaction(writes)
    console.warn(`[ai-moderation] auto-held ${l.id} (${result.category}, ${result.confidence.toFixed(2)})`)
  } catch (e) {
    console.error('[ai-moderation] moderateListingById failed', e)
  }
}
