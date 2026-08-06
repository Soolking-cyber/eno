/**
 * The SERVICES-EDITION half of the API error vocabulary, in one module so it can be aliased away.
 *
 * ⚠️ WHY THIS FILE EXISTS. `src/lib/api/errors.ts` holds `ALL`, a RUNTIME array, in a module
 * `src/lib/api/client.ts` imports — and client.ts exists precisely so the 176 hand-rolled
 * `fetch('/api/…')` call sites can eventually branch on typed codes. That puts `errors.ts` on a
 * path into eno.vn's client chunks, and 33 of its entries were vocabulary for routes a marketplace
 * build never compiles. On the licensed marketplace those strings buy nothing and cost a licensing
 * boundary.
 *
 * ⚠️ A GATE CANNOT UNBUNDLE A STRING — the lesson of `edition-services-copy.ts`, and why
 * `scripts/edition-lint.mjs` RULE C exists. `IS_SERVICES ? … : …` decides what RENDERS; only a
 * module boundary the bundler can replace decides what SHIPS. `next.config.ts` aliases this file to
 * `./errors-services.stub.ts` on a marketplace build. Verified in the artifact, not argued from the
 * source: after a clean marketplace build, none of these appear in `.next/static` or `.next/server`.
 *
 * ⚠️ THE TYPE UNION IN `errors.ts` STAYS WHOLE, DELIBERATELY. Types are erased, so one shared
 * `ApiErrorCode` costs the marketplace bundle nothing and keeps a single vocabulary for the
 * compile-time subset assertions and for every `.svc.ts` handler. Only the runtime array splits,
 * because only the runtime array ships. TypeScript never sees the stub (an alias is a bundler
 * resolution), so the exhaustiveness check in errors.ts reads this list and stays honest.
 *
 * ⚠️ MEMBERSHIP IS DECIDED BY WHETHER A MARKETPLACE ROUTE CAN EMIT THE CODE — not by the name, and
 * NOT by whether the literal appears somewhere in marketplace-compiled source. Those last two are
 * different questions and confusing them cost a round here, so the distinction is worth stating.
 *
 * `visa_encryption_not_configured` and `visa_schema_not_ready` are emitted by
 * `src/lib/visa/{dm-flow,concierge}.ts` — plain `.ts` libraries that `pageExtensions` does NOT
 * exclude, so their strings really are in eno.vn's SERVER bundle, and `api/conversations/route.ts`
 * really does import `startVisaDmFlow`. On that basis they were briefly moved into `ALL`. That was
 * wrong: `conversations/route.ts:75` looks the listing up through `scopedListingWhere`, which
 * excludes the desk's rows on the marketplace edition, so `isVisaProduct` is never true there and
 * the emitting branch is unreachable. eno.vn cannot send these codes, so they belong here.
 *
 * ⚠️ AND MOVING THEM WOULD HAVE MADE THINGS WORSE, WHICH IS THE PART TO REMEMBER. Their presence in
 * the server bundle is pre-existing and comes from those libraries, not from this array — so
 * listing them in `ALL` removes no string, while `ALL` is imported by `lib/api/client.ts` and would
 * carry them into CLIENT chunks the day it gains a production importer. Measured: today they appear
 * in `.next/server` and in **zero** files under `.next/static`. "In the build" is not "in the
 * browser download"; three reviewers caught that conflation independently.
 */
export const SERVICES_ALL = [
  'application_cancelled',
  'application_delete_failed',
  'application_incomplete',
  'application_status_changed',
  'body_too_large',
  'card_superseded',
  'case_changed_reload',
  'checkout_card_refused',
  'checkout_failed',
  'concierge_unavailable',
  'confirm_failed',
  'field_not_in_step',
  'human_help_pending',
  'image_analysis_rate_limited',
  'image_download_failed',
  'invalid_action',
  'invalid_amount',
  'invalid_analysis_request',
  'invalid_fields',
  'invalid_itinerary',
  'invalid_payload',
  'invalid_signature',
  'invalid_trip',
  'invalid_visa_payload',
  'itinerary_limit_reached',
  'itinerary_schema_not_ready',
  'listing_selection_mismatch',
  'no_thread',
  'not_a_participant',
  'not_a_visa_product',
  'not_paid',
  'not_your_card',
  'payload_unreadable',
  'payment_required_first',
  'processing_failed',
  'product_entry_type_mismatch',
  'provider_not_configured',
  'quote_changed',
  'quote_expired',
  'reference_mismatch',
  'request_not_found',
  'step_card_refused',
  'submission_window_closed',
  'too_many',
  'too_many_applications',
  'unsupported_image_type',
  'update_failed',
  'visa_database_unavailable',
  'visa_encryption_not_configured',
  'visa_schema_not_ready',
] as const
