'use client'

/**
 * MARKETPLACE-EDITION STUB for visa-cards.tsx.
 *
 * eno.vn is a licensed sàn TMĐT and may not offer e-visa services. `next.config.ts` aliases the real
 * 2,523-line module to this file on a marketplace build, so the e-Visa vocabulary — "Pay with
 * PayPal", "hộ chiếu", the whole passport wizard — is never emitted into a client chunk. Nothing
 * here renders, and nothing here is reachable: `resolveThreadKind` already answers 'listing'
 * unconditionally off the services edition and the desk's threads 404, so these exports exist only
 * so the shared chat page still resolves its imports.
 *
 * ⚠️ STUBBED AT THE MODULE BOUNDARY RATHER THAN BY REFACTORING THE CHAT PAGE. The plan proposed
 * extracting the card dispatch out of src/app/messages/[id]/page.tsx; that file is 1,857 lines and
 * carries the ChatSendButton onMouseDown+preventDefault invariant, and it is the most-used surface
 * in the app. Aliasing the module touches none of it. The 21 imported symbols are few enough that a
 * stub is honest work rather than a rot risk — and visa-cards.stub.test.ts fails the build if the
 * two export surfaces ever diverge, which is the part that keeps it honest.
 *
 * ⚠️ TYPESCRIPT CHECKS AGAINST THE REAL MODULE, NOT THIS ONE. The alias is a bundler resolution, so
 * tsc never sees this file in the import graph. A shape mismatch is therefore a RUNTIME error that
 * no typecheck catches — which is why the return shapes below are matched by hand and pinned by the
 * companion test. Change the real module's public surface and you must change this one.
 */

import type { ComponentType } from 'react'

/** Renders nothing. Every card in this module is unreachable on the marketplace edition. */
const Nothing: ComponentType<Record<string, unknown>> = () => null

export const VisaCheckoutCard = Nothing
export const VisaPickerCard = Nothing
export const VisaResendChip = Nothing
export const VisaResultCard = Nothing
export const VisaStepCard = Nothing
export const VisaThreadStrip = Nothing

/**
 * The parsers answer "this message is not one of my cards" — the same answer the real module gives
 * for any ordinary message, which is what every call site already handles.
 */
export const parseVisaCheckoutMeta = (): null => null
export const parseVisaPickerMeta = (): null => null
export const parseVisaResultMeta = (): null => null
export const parseVisaStepMeta = (): null => null
export const parseVisaThreadInfo = (): null => null

/** ⚠️ Shape-matched to the real hook's `{ kase, loading, unavailable, reload }`. The chat page
 *  destructures three of those unconditionally at module top level, so a narrower object would be a
 *  runtime TypeError on a page that has nothing to do with visas. */
export const useVisaCase = () => ({
  kase: null,
  loading: false,
  unavailable: null as string | null,
  reload: async () => {},
})

/** Never called — the code paths that report visa errors are unreachable — but it must return a
 *  string, because the one caller passes the result straight to toast.error(). */
export const visaErrorCopy = (): string => ''
export const visaTypeWords = (): string => ''
export const prepareVisaImage = async (file: File): Promise<File> => file

/** A Set, matching the real export: the one call site does `.has(...)` on it. */
export const EDITABLE_VISA_STATUSES: ReadonlySet<string> = new Set<string>()

export type VisaQuoteWire = never
