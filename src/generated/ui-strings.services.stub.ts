// MARKETPLACE-EDITION STUB for ui-strings.services.ts.
//
// eno.vn is a licensed sàn TMĐT and may not surface visa or itinerary services. next.config.ts
// aliases the real services catalogue to this file on a marketplace build, so its ~337 strings —
// including the e-Visa and passport vocabulary — are never emitted into a client chunk.
//
// ⚠️ THE ALIAS IS WHAT DOES THE WORK, NOT A RUNTIME CHECK. `IS_SERVICES` is not
// dead-code-eliminated across module boundaries (measured — see src/lib/edition.ts), so gating the
// import would have hidden the strings while still shipping them.
export const UI_STRINGS_SERVICES: string[] = []
