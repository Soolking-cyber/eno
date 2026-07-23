import 'server-only'
import { fold } from '@/lib/fold'

// VietQR/GDT tax-code soft check (owner "go" 2026-07-23; researched + probed live on
// row-103): https://api.vietqr.io/v2/business/{mst} — free, no key, GDT-sourced
// (~1-month snapshot per its own disclaimer), 429-rate-limited. NEVER a gate: the
// identity save proceeds identically whatever this returns; the lookup only writes
// FACTS (registered name + active status) that the read side turns into a badge.
//
// Three-state outcome, deliberately (dual plan review — "not found" must never be
// conflated with "could not look"):
//   { found: true, ... }   — the registry knows the code (facts to store)
//   { found: false }       — the registry POSITIVELY does not (a fact: taxActive=false)
//   null                   — timeout / 429 / network / malformed answer (store NOTHING;
//                            taxCheckedAt stays null so the next save self-heals)

export type TaxLookup = { found: true; registeredName: string | null; active: boolean } | { found: false } | null

const ACTIVE_STATUS = 'NNT đang hoạt động'

export async function lookupTaxCode(mst: string): Promise<TaxLookup> {
  // Only ever called with the ALREADY-validated normalized code (\d{10}(-\d{3})?), so
  // encodeURIComponent is belt-and-suspenders, not an escape hatch for junk.
  try {
    const res = await fetch(`https://api.vietqr.io/v2/business/${encodeURIComponent(mst)}`, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null // 429/5xx = could not look, not "unknown code"
    const body = (await res.json()) as { code?: unknown; data?: { name?: string | null; status?: string | null } | null }
    // Shape-validate BEFORE classifying (diff review): a malformed 200 (proxy error
    // page, API drift) must read as "could not look" (null), never as the registry
    // POSITIVELY not knowing the code. A structured non-'00' answer IS that refusal.
    if (typeof body?.code !== 'string') return null
    if (body.code !== '00' || !body.data) return { found: false }
    return { found: true, registeredName: body.data.name ?? null, active: body.data.status === ACTIVE_STATUS }
  } catch {
    return null
  }
}

/** Facts the derived verdict reads (a Seller row subset). */
export type TaxFacts = {
  taxCode: string | null
  taxCheckedAt: Date | string | null
  taxRegisteredName: string | null
  taxActive: boolean | null
  legalName: string | null
  name: string
}

/**
 * The DERIVED verdict — computed at read time so it can never go stale against a
 * later legalName/name edit. Verified = the registry knew the code, the taxpayer is
 * active, and the registered name matches the seller's legal name (or storefront
 * name) with minimum strength: diacritic-folded equality, or containment where the
 * shorter side is >=8 chars (review catch: bare `contains` false-positives on short
 * generic names).
 */
/** Facts older than this read as unchecked — the registry drifts (renames,
 *  deactivations) and a years-old snapshot must not keep a badge alive. The save
 *  path uses the same TTL to re-check, so a stale row self-heals on the next
 *  identity save (diff review, 2026-07-23). */
export const TAX_FACTS_TTL_MS = 180 * 24 * 60 * 60 * 1000

export function taxVerdict(s: TaxFacts): 'verified' | 'mismatch' | 'inactive' | 'not_found' | 'unchecked' {
  if (!s.taxCode || !s.taxCheckedAt) return 'unchecked'
  if (Date.now() - new Date(s.taxCheckedAt).getTime() > TAX_FACTS_TTL_MS) return 'unchecked'
  if (s.taxActive === false && !s.taxRegisteredName) return 'not_found'
  if (!s.taxActive) return 'inactive'
  const registered = fold(s.taxRegisteredName ?? '').trim()
  const claimed = fold(s.legalName || s.name || '').trim()
  if (!registered || !claimed) return 'mismatch'
  const match =
    registered === claimed ||
    ((registered.includes(claimed) || claimed.includes(registered)) && Math.min(registered.length, claimed.length) >= 8)
  return match ? 'verified' : 'mismatch'
}
