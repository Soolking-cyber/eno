import 'server-only'

/**
 * Client for the self-hosted translation server (infra/vn-node/mt-server, m2m100_418M/MIT).
 *
 * ⛔ WHY A GATE AND NOT JUST A FETCH. Measured on the box against 300 real listing pairs:
 * m2m100_418M keeps 99.6% of model codes on vi→en and 98.5% on en→vi. The remaining fraction
 * matters because the Translation table has NO EXPIRY — a bad row is permanent — and because
 * entity loss is the cheapest available SIGNAL that a whole string went wrong. That link was
 * unmistakable in the model this server was first built on (NLLB-600M, since rejected for its
 * non-commercial licence), where a dropped model code reliably meant invented text:
 *   "Máy lạnh Daikin 1.0HP 2025 (FTKB25ZVMV/RKB25ZVMV)"
 *     → "The cooling system is designed to be used in the manufacture of refrigeration..."
 * m2m100 renders that one correctly, so the gate now fires rarely — which is the point. It
 * costs nothing when the model is right and it stops a permanent bad row when it is not.
 *
 * ⚠️ THE GATE IS DELIBERATELY CONSERVATIVE — it rejects, it never repairs. A "fix" that
 * spliced the missing model code back into the translated string would produce a sentence
 * that reads fluently and still describes the wrong product, which is strictly worse than
 * admitting failure: the caller can pay for a good translation, but it cannot detect a
 * plausible-looking lie.
 */

const MT_URL = process.env.MT_LOCAL_URL

/**
 * How long a BACKGROUND caller waits for the box model.
 *
 * ⚠️ SIZED TO THE REAL WORST CASE, NOT TO A COMFORTABLE NUMBER. A chunk is capped upstream at
 * 100 items / 28,000 characters; at the measured ~250-350 ch/s that is ~112s at idle, and behind
 * a concurrent import batch on the fair lock it goes well past three minutes. A 180s timeout
 * therefore made the LARGEST batches deterministically abort, pay Google for all of them, and
 * leave the box still grinding on work nobody would read. Aborting does not cancel the server,
 * so this must be long enough that reaching it means something is genuinely wrong.
 */
const LONG_TIMEOUT_MS = 600_000

/**
 * How long an INTERACTIVE caller waits before giving up and paying.
 *
 * ⛔ A RENDER CANNOT WAIT TEN MINUTES. Cloudflare cuts a request at ~100s, so a PDP first-view
 * translation queued behind import chunks would be killed at the edge long before the local
 * fetch gave up — the visitor gets a 5xx instead of the paid translation that was one fallback
 * away (opus, reviewing this diff). Interactive callers also ask the paid provider FIRST; this
 * bound is the second line of defence, for when no paid provider answered either.
 */
export const INTERACTIVE_TIMEOUT_MS = 15_000

export function localMtConfigured(): boolean {
  return !!MT_URL
}

/**
 * Tokens a translation MUST carry through untouched: model codes (VX2779-HD-PRO, FTKB25ZVMV),
 * mixed alphanumerics (12MXH100), and any run of 3+ digits (capacities, years, wattages).
 *
 * ⛔ A MODEL CODE CARRIES BOTH A LETTER AND A DIGIT — that lookahead pair is the whole rule, and
 * the earlier `[A-Z0-9]{2,}` version was wrong in three separate ways at once, all found in
 * review and all reproduced before changing anything:
 *  · IT MADE ORDINARY CAPITALISED WORDS MANDATORY. "BLACK TABLE" and the Vietnamese "THUN"
 *    became required tokens, so a perfectly good translation ("Bàn đen", "t-shirt") was
 *    REJECTED and sent to the paid provider — the gate spending money to punish correct work.
 *  · IT TRUNCATED REAL CODES. Allowing a single `-` captured only "VX2779-HD" of
 *    "VX2779-HD-PRO", so a hallucinated "VX2779-HD-FAKE" satisfied it.
 *  · IT MISSED LOWERCASE ENTIRELY. "ftkb25zvmv" extracted nothing, so dropping it passed.
 *
 * ⛔ A DECIMAL SPEC IS ONE ENTITY, AND IT MUST BE MATCHED FIRST. Without the leading
 * alternative, `\b` fires between the "." and the "0" of "1.0HP", so the mandatory token was
 * "0HP" — which "2.0HP" also contains. The gate happily accepted a translation that DOUBLED the
 * advertised capacity of an air conditioner (astra, reviewing this diff). Decimal specs are
 * exactly the numbers a buyer decides on.
 *
 * ⚠️ `-` CONTINUES A CODE, `/` DOES NOT. "VX2779-HD-PRO" is one token, but "1GB/Ngày" is
 * "1GB per day" — treating `/` as a joiner glued the translatable word "Ngày" onto the code and
 * then demanded the English output contain it, rejecting a correct translation.
 *
 * ⚠️ 2+ DIGITS FOR THE PURE-NUMBER CASE. This was 3+ for a while because gating two-digit
 * numbers rejected good translations — but that was the BOUNDARY's fault, not the threshold's:
 * "27 inch" → "27-inch" failed a hyphen-excluding boundary. Numbers now use a NON-DIGIT
 * boundary (see keepsEntity), so "27-inch" passes and "32-inch" does not. That closes a real
 * hole reviewers were right to keep pressing on: with two-digit numbers ungated,
 * "Màn hình 27 inch" → "32-inch monitor" carried no required entity, had a plausible ratio, and
 * passed every check — publishing the wrong screen size, permanently.
 */
const ENTITY =
  /\b\d+(?:[.,]\d+)+[A-Za-z]+\b|\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{3,}(?:-[A-Za-z0-9]+)*\b|\b\d{2,}\b/g

/**
 * Fluent boilerplate a seq2seq model falls into when it loses the input. These are VERBATIM
 * openings observed in the benchmark, not guesses — each appeared on a title whose meaning was
 * entirely invented. They were produced by NLLB-600M (rejected on licence, see the server
 * header); they are kept because the failure mode is generic to the architecture, cheap to
 * test for, and impossible to detect once cached.
 */
const BOILERPLATE =
  /(is designed to be used|the following is (a|the) list|for the manufacture of|in accordance with the provisions of)/i

/** Why a translation was refused — surfaced in logs so the reject rate stays observable. */
export type MtReject = 'entity-loss' | 'length-ratio' | 'boilerplate' | 'repetition' | 'empty'

/**
 * Relative character density per language — how many characters that language needs to say the
 * same thing, with Latin script as 1.0.
 *
 * ⛔ A FIXED RATIO BAND CANNOT WORK ACROSS THESE SCRIPTS, IN EITHER DIRECTION. Measured on the
 * box over 60 real listing strings, the share of GOOD vi→X translations falling under a flat
 * 0.45 floor: zh-Hans 50% · ko 27% · ja 20% · ru 2% · th 0% · en 0%. Four of the five
 * EAGER_WARM_LANGS are CJK-adjacent, so a shared floor rejected roughly half of all Chinese
 * output as "collapsed" and paid Google for it — the exact spend this module exists to remove.
 *
 * ⛔ AND THE CEILING HAS THE MIRROR BUG, which a target-only table would have missed: a
 * faithful zh→en translation EXPANDS 3-5x, so a shared 2.5 ceiling rejects every Chinese- or
 * Japanese-SOURCE translation (found by agy). The band therefore has to be computed from the
 * pair — expected ratio ≈ density(target) / density(source) — not from the target alone.
 *
 * ⚠️ THE BAND IS WIDE ON PURPOSE. This is a smoke alarm for collapse and runaway repetition,
 * not a quality metric; a translation can be entirely wrong at a perfect 1.0 ratio, which is
 * why the entity and boilerplate checks carry the real load. Do not tighten it to "catch more"
 * — a false reject costs a paid call on a translation that was already good.
 */
const DENSITY: Record<string, number> = {
  'zh-Hans': 0.25,
  ja: 0.35,
  ko: 0.45,
  km: 0.6,
  th: 0.7,
}
const LATIN_DENSITY = 1.0
const density = (lang?: string) => (lang ? DENSITY[lang] : undefined) ?? LATIN_DENSITY
/** How far either side of the expected ratio still counts as plausible. */
const BAND_LOW = 0.45
const BAND_HIGH = 2.5

/**
 * Does `hyp` still contain `entity`, as a WHOLE token?
 *
 * ⛔ A BARE `includes` IS NOT ENOUGH: it accepts "VX27790" as proof that "VX2779" survived, and
 * those are different products.
 *
 * ⛔ AND THE BOUNDARY MUST EXCLUDE `-`, NOT JUST ALPHANUMERICS. A hyphen is a non-alphanumeric,
 * so a boundary of `[^A-Za-z0-9]` accepted "VX2779-HD-PRO-FAKE" as proof that "VX2779-HD-PRO"
 * survived — a different model, passing the one check that exists to catch exactly that. Since
 * `-` also CONTINUES a code inside ENTITY, it cannot simultaneously terminate one here (both
 * found by astra, reviewing this diff).
 */
function keepsEntity(hyp: string, entity: string): boolean {
  const escaped = entity.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
  // ⚠️ TWO BOUNDARY RULES, because the two kinds of entity abut different things. A pure NUMBER
  // is legitimately followed by a hyphen when a translator compounds it ("27 inch" → "27-inch"),
  // so only a DIGIT may not follow it — that is what lets two-digit specs be gated at all. A
  // model CODE is the opposite: a hyphen continues it, so "VX2779-HD-PRO-FAKE" must not satisfy
  // "VX2779-HD-PRO".
  const boundary = /^\d+$/.test(entity) ? '[^0-9]' : '[^A-Za-z0-9-]'
  return new RegExp(`(^|${boundary})${escaped}(${boundary}|$)`, 'i').test(hyp)
}

export function gateTranslation(src: string, hyp: string, target?: string, source?: string): MtReject | null {
  if (!hyp || !hyp.trim()) return 'empty'

  // ⚠️ Case-INSENSITIVE (via keepsEntity). Measured impact on the real corpus was zero — the
  // case-sensitive and case-insensitive checks flagged the same 2/60 strings — so this is
  // insurance: a model code the translator title-cased is still preserved, and rejecting it
  // would hand a perfectly good translation to the paid provider for nothing.
  const entities = src.match(ENTITY)
  if (entities && entities.some((e) => !keepsEntity(hyp, e))) return 'entity-loss'

  const expected = density(target) / density(source)
  const ratio = hyp.length / Math.max(src.length, 1)
  if (ratio < expected * BAND_LOW || ratio > expected * BAND_HIGH) return 'length-ratio'

  if (BOILERPLATE.test(hyp)) return 'boilerplate'

  // Degenerate repetition: the decoder looping on one phrase. Only meaningful once there are
  // enough words for the ratio to mean something.
  const words = hyp.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length > 8 && new Set(words).size / words.length < 0.5) return 'repetition'

  return null
}

export type LocalMtResult = {
  /** Translated text, or null where the gate refused / the server had no answer. */
  values: (string | null)[]
  rejects: Partial<Record<MtReject, number>>
}

/**
 * Translate a chunk locally. Returns `null` for the WHOLE chunk only when the server itself
 * is unreachable, too slow for this caller, or misbehaving; individual strings come back null when the gate refuses them,
 * so the caller can pay for exactly those and keep the rest free.
 */
export async function localTranslate(
  texts: string[],
  source: string,
  target: string,
  timeoutMs = LONG_TIMEOUT_MS,
): Promise<LocalMtResult | null> {
  if (!MT_URL || texts.length === 0) return null
  try {
    const res = await fetch(`${MT_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, source, target }),
      // ⚠️ SIZED TO THE REAL WORST CASE, NOT TO A COMFORTABLE NUMBER. A chunk is capped upstream
      // at 100 items / 28,000 characters; at the measured ~250 ch/s that is ~112s at idle, and
      // behind a concurrent import batch on the fair lock it exceeds 180s — so a 180s timeout
      // made the LARGEST batches deterministically abort, pay Google for all of them, AND leave
      // the box still grinding on work nobody would read, stalling everything behind it (opus,
      // reviewing this diff). Aborting does not cancel the server, so the timeout must be long
      // enough that reaching it means something is actually wrong. Chat does not wait on this:
      // it asks the paid provider first.
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      console.error('[mt-local] HTTP', res.status)
      return null
    }
    const json = (await res.json()) as { translations?: unknown }
    const out = json?.translations
    // ⛔ A misaligned array must never be paired positionally — that caches wrong translations
    // permanently. The server refuses to send one; this refuses to trust it anyway.
    if (!Array.isArray(out) || out.length !== texts.length) {
      console.error('[mt-local] misaligned response', Array.isArray(out) ? out.length : typeof out, '!=', texts.length)
      return null
    }
    const rejects: Partial<Record<MtReject, number>> = {}
    const values = texts.map((src, i) => {
      const hyp = typeof out[i] === 'string' ? (out[i] as string) : ''
      const reject = gateTranslation(src, hyp, target, source)
      if (reject) {
        rejects[reject] = (rejects[reject] ?? 0) + 1
        return null
      }
      return hyp
    })
    return { values, rejects }
  } catch (err) {
    console.error('[mt-local] request failed', err)
    return null
  }
}
