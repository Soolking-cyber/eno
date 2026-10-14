/**
 * THE LICENCE CHECK'S REFUSALS, IN WORDS (owner, 2026-10-14) — for the clients that do not word a code themselves.
 *
 * e-Visa and Legal & permits listings from anyone but eno's own desk go live only after eno's team has checked the
 * provider's licence (taxonomy.ts licenceCheckHold, src/lib/licence-stamp.ts). The seller's own doors answer three
 * refusals from it, and each carries a sentence here:
 *   · `licence_check_required` (409) — a relist, a "still available" confirm or a sync row that would put a listing eno
 *     has not checked back on sale (core/listings.ts setStatusCore / confirmCore, R1 of the plan review):
 *     LICENCE_CHECK_REQUIRED_COPY;
 *   · `listing_changed` (409) — an edit of such a listing whose licence facts (approval, values, aisle) changed while the
 *     seller was editing: an admin's approval or revoke, or another save (core/listings.ts updateListingCore, R2):
 *     LISTING_CHANGED_COPY;
 *   · `provider_licence_required` / `provider_licence_invalid` — the native apps' bilingual sentence is
 *     provider-licence.ts PROVIDER_LICENCE_REFUSAL; the partner API's English, naming the field and the reason, is
 *     providerLicenceApiMessage below.
 * The session routes (POST /api/listings/[id]/status and /confirm, PATCH /api/listings/[id]) send a pair as
 * `message: { en, vi }` for the native iOS and Android dashboards, which call those same routes; /api/v1 and the MCP
 * tools send the English half. ⚠️ A web client that shows one of these words it with a LITERAL tr() pair carrying the
 * same sentences — scripts/gen-ui-strings.mjs harvests literals for the machine-translated languages.
 *
 * A plain module (no server-only): nothing here is secret, and a route's test reads it without the core.
 */
import { PROVIDER_LEGAL_NAME, PROVIDER_LICENCE_LIMITS, PROVIDER_LICENCE_NO, type ProviderLicenceReason } from './provider-licence'

/** A status change back to active refused for a licence-aisle listing eno has not checked (409). */
export const LICENCE_CHECK_REQUIRED_COPY = {
  en: 'This listing is waiting for eno’s licence check, so it can’t be put back on sale yet. It goes live once eno’s team has checked the provider’s licence.',
  vi: 'Tin này đang chờ eno kiểm tra giấy phép nên chưa thể mở bán lại. Tin sẽ được hiển thị sau khi đội ngũ eno kiểm tra giấy phép của nhà cung cấp.',
} as const

/** An edit refused because the listing's licence facts changed after the editor read it (409) — retrying is safe. */
export const LISTING_CHANGED_COPY = {
  en: 'This listing changed while you were editing it — reload it and try again.',
  vi: 'Tin này đã thay đổi trong lúc bạn chỉnh sửa — hãy tải lại rồi thử lại.',
} as const

/** What each provider-licence reason (provider-licence.ts providerLicenceProblems) means, for a partner reading a 422. */
const REASON_TEXT: Record<ProviderLicenceReason, string> = {
  missing: 'it is empty',
  too_long: `it is too long — the registered name takes at most ${PROVIDER_LICENCE_LIMITS.legalName} characters and the licence number ${PROVIDER_LICENCE_LIMITS.licenceNo}, and neither is ever cut`,
  no_letter: 'a registered business name needs letters',
  no_digit: 'a licence number needs digits',
  format: 'it is not written as a licence number — letters, digits, spaces, dots, slashes and hyphens only; an e-Visa licence number always carries letters, and a bare number is accepted only as the 10-digit enterprise code (10-3 for a branch) in Legal & permits',
  personal_id: 'it reads as a personal ID number (CCCD / CMND), which is never accepted',
  contact: 'it contains a phone number or other contact details',
  banned: 'it contains a disallowed word',
}

const FIELDS: readonly string[] = [PROVIDER_LEGAL_NAME, PROVIDER_LICENCE_NO]

/**
 * The partner API's English for the two provider-licence refusals (POST and PATCH /api/v1/listings). `detail` is the
 * '<field>:<reason>' a `provider_licence_invalid` carries; anything else falls back to a sentence naming both fields.
 */
export function providerLicenceApiMessage(code: 'provider_licence_required' | 'provider_licence_invalid', detail?: string | null): string {
  if (code === 'provider_licence_required') {
    return 'Listings in services/visa-legal (e-Visa) and services/legal-permits need attributes.providerLegalName (the provider’s registered business name, ≤160 characters) and attributes.providerLicenceNo (its licence or registration number, ≤60) — including a listing its own title or description files there when no subcategorySlug is sent, a move into either one, and any edit that sends attributes to such a listing. Send both; the listing is then stored unpublished until eno has checked them against the licence.'
  }
  const [field, reason] = String(detail ?? '').split(':')
  if (FIELDS.includes(field) && Object.hasOwn(REASON_TEXT, reason)) {
    return `attributes.${field} cannot be accepted (${reason}): ${REASON_TEXT[reason as ProviderLicenceReason]}.`
  }
  return 'attributes.providerLegalName or attributes.providerLicenceNo cannot be accepted as written.'
}
