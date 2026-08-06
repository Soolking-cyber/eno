/**
 * MARKETPLACE-EDITION STUB for errors-services.ts.
 *
 * eno.vn is a licensed sàn TMĐT and may not mention the visa or itinerary surfaces at all.
 * `next.config.ts` aliases the real module here so its eight code strings — `visa_database_
 * unavailable`, `itinerary_limit_reached`, `not_a_visa_product` and the rest — never reach a
 * marketplace chunk. Every one is emitted only by a `route.svc.ts` handler, which a marketplace
 * build does not compile, so an empty list here loses nothing: `apiErrorCode()` simply never has to
 * recognise a code no route on this edition can send.
 *
 * ⚠️ TYPESCRIPT NEVER SEES THIS FILE. An alias is a bundler resolution, so `tsc` reads the real
 * module and the exhaustiveness assertion in errors.ts checks the full eight. That is deliberate:
 * the TYPE stays whole (types are erased and cost the bundle nothing) while only the RUNTIME array
 * splits. Do not "fix" the apparent asymmetry by trimming the type.
 *
 * ⚠️ TYPED `readonly string[]`, NOT `as const`. The real module's `as const` gives a literal-union
 * element type; if this stub did the same it would infer `never[]`, and any code comparing against
 * `SERVICES_ALL` would narrow differently under the alias than under tsc — a divergence that only
 * appears in a production build. The widened type keeps both resolutions interchangeable.
 */
export const SERVICES_ALL: readonly string[] = []
