import type { PublishBlockCode } from '@/lib/publish-guard'
import { JOB_TEXT_REFUSAL } from '@/lib/job-listing'
import { TEACHER_PROFILE_REFUSAL } from '@/lib/taxonomy'
import { RELEASED_CHARGE_CAP_MESSAGE } from '@/lib/released-charge-copy'
import { providerLicenceApiMessage } from '@/lib/licence-check-copy'
import { publishBlockedBody } from '@/lib/compliance/publish-block-response'

/**
 * The English sentence a PARTNER gets for a publish refusal (PublishBlockedError) — REST /api/v1 and the MCP server
 * answer with the same code and the same words (2026-11-14: MCP used to answer every content refusal with a bare
 * `internal_error`, so ChatGPT told a seller "the connection returned an internal error" for a listing with no photo).
 * ⛔ EXHAUSTIVE ON PURPOSE: every code is named, and a new PublishBlockCode fails to compile here until it has its own
 * sentence — a catch-all would tell a seller to "remove phone numbers" when their text is not the problem.
 * Identity codes keep their legal copy (both callers answer them before reaching here; named for exhaustiveness).
 */
export function publishBlockedApiMessage(code: PublishBlockCode, detail?: string): string {
  switch (code) {
    case 'identity_unverified':
    case 'identity_pending':
    case 'identity_expired':
    case 'identity_suspended':
    case 'identity_sign_in_required':
      return publishBlockedBody(code).message.en
    case 'account_restricted': return 'Shop is restricted (low trust) — cannot publish until its score recovers.'
    case 'released_charge_listing_cap': return RELEASED_CHARGE_CAP_MESSAGE
    case 'photo_required': return 'At least one image is required.'
    case 'photos_min': return 'At least 3 images from different angles are required (the same photo repeated counts as one).'
    case 'banned_words': return 'The title or description contains a disallowed word.'
    case 'contact_in_text': return 'Remove phone numbers, contact info or addresses from the title/description.'
    case 'contact_in_name': return 'The shop’s public name contains a phone number or other contact details; change the name, then post again.'
    case 'duplicate_listing': return 'Duplicate of a live listing on this shop (see detail for its id) — update or bump the existing listing instead of re-posting it.'
    case 'location_required': return 'A location is required: give the district or area where the item is.'
    case 'category_not_postable': return 'This category does not take new listings; choose another category.'
    // A teacher's job-seeker post (Jobs › Teaching + wanted) is a teacher profile (2026-10-12).
    case 'teacher_profile_instead': return TEACHER_PROFILE_REFUSAL.en
    // e-Visa / Legal & permits (2026-10-14): which attribute keys to send — or which value cannot be accepted, and why.
    case 'provider_licence_required':
    case 'provider_licence_invalid':
      return providerLicenceApiMessage(code, detail)
    // A hiring post the job-text screen refused (job-listing.ts jobTextProblem, 2026-10-18): its rule's sentence.
    case 'job_residence_wording':
    case 'job_discrimination':
    case 'job_candidate_fee':
    case 'job_adult_venue':
      return JOB_TEXT_REFUSAL[code].en
    default: {
      const unhandled: never = code
      return unhandled
    }
  }
}
