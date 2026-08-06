/**
 * The SERVICES-EDITION half of the API error vocabulary, in one module so it can be aliased away.
 *
 * ⚠️ WHY THIS FILE EXISTS. `src/lib/api/errors.ts` holds `ALL`, a RUNTIME array, and it is a shared
 * module — `src/lib/api/client.ts` imports it precisely so the 176 hand-rolled `fetch('/api/…')`
 * call sites can eventually branch on typed codes instead of raw strings. Eight of those codes name
 * a surface the licensed marketplace may not mention:
 *
 *   invalid_itinerary · invalid_visa_payload · itinerary_limit_reached ·
 *   itinerary_schema_not_ready · not_a_visa_product · visa_database_unavailable ·
 *   visa_encryption_not_configured · visa_schema_not_ready
 *
 * Every one is emitted ONLY by a `route.svc.ts` handler (measured 2026-08-06: 20 emission sites,
 * zero of them in a marketplace `route.ts`), so on eno.vn they are vocabulary for routes that do not
 * exist. They were nonetheless sitting in the shared array, which meant the day the first eno.vn
 * component adopted `client.ts`, `grep visa` over the marketplace bundle would have hit.
 *
 * ⚠️ A GATE CANNOT UNBUNDLE A STRING — that is the whole lesson of `edition-services-copy.ts`, and
 * `scripts/edition-lint.mjs` RULE C exists because of it. `IS_SERVICES ? … : …` decides what RENDERS;
 * only a module boundary the bundler can replace decides what SHIPS. So this file is aliased to
 * `./errors-services.stub.ts` on a marketplace build (see `next.config.ts`), and the marketplace
 * artifact contains none of these strings.
 *
 * ⚠️ THE TYPE UNION IN `errors.ts` STAYS COMPLETE, DELIBERATELY. Types are erased, so a shared
 * `ApiErrorCode` costs the marketplace bundle nothing, and keeping it whole means the compile-time
 * subset assertions (`PublishBlockCode`, `ListingUpdateErrorCode`) and every `.svc.ts` handler still
 * typecheck against one vocabulary. Only the runtime array is edition-split, because only the
 * runtime array ships.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THE STUB (an alias is a bundler resolution, not a compiler one), so the
 * exhaustiveness check at the bottom of `errors.ts` reads THIS list and stays honest.
 *
 * To add a code here: it must be emitted only by `.svc.ts` routes. `errors.test.ts` asserts both
 * halves of that boundary — nothing services-shaped in `ALL`, and nothing here absent from the type.
 *
 * ⚠️ MEASURED IN THE ARTIFACT, NOT ARGUED FROM THE SOURCE, because on this repo an edition leak
 * passes tsc, lint and the whole suite and only a `rm -rf .next` + grep settles it. After a clean
 * marketplace build (2026-08-06): **zero** of the eight appear in `.next/static`, i.e. nothing a
 * browser downloads. Six vanish from the build entirely.
 *
 * ⚠️ TWO SURVIVE IN SERVER CHUNKS AND THIS FILE DOES NOT FIX THEM, because they do not come from
 * here. `visa_encryption_not_configured` and `visa_schema_not_ready` are also emitted by
 * `src/lib/visa/dm-flow.ts` and `src/lib/visa/concierge.ts` — plain `.ts` libraries, so
 * `pageExtensions` does not exclude them — and their copy lives in
 * `src/components/marketplace/visa-cards.tsx`, which BOTH editions render on purpose: the two apps
 * share one database, so an eno.vn thread can already contain visa cards written on eno.forum and
 * must degrade rather than crash. That is a pre-existing, deliberate presence in the server bundle
 * and a separate question from this array; conflating the two would have made this change look
 * bigger than it is. What the split actually closes is the path from a SHARED module into client
 * chunks the day `lib/api/client.ts` gains its first production importer.
 */
export const SERVICES_ALL = [
  'invalid_itinerary',
  'invalid_visa_payload',
  'itinerary_limit_reached',
  'itinerary_schema_not_ready',
  'not_a_visa_product',
  'visa_database_unavailable',
  'visa_encryption_not_configured',
  'visa_schema_not_ready',
] as const
