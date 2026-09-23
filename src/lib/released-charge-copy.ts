import { ENFORCEMENT } from './enforcement-machine'

/**
 * THE RELEASED-CHARGE LISTING CAP, IN WORDS (src/lib/released-charge-gate.ts decides it).
 *
 * A plain module (no server-only): the partner API routes and the MCP tools read the English sentence,
 * and tests read it without the server core. The web dashboard and the post wizard word the same
 * refusal themselves with literal tr()/t() calls (so scripts/gen-ui-strings.mjs harvests them), with
 * the number from the same constant — never retyped.
 */
export const RELEASED_CHARGE_LISTING_CAP_CODE = 'released_charge_listing_cap' as const

export const RELEASED_CHARGE_MAX_ACTIVE = ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS

/** For /api/v1 and MCP: the limit, and why. */
export const RELEASED_CHARGE_CAP_MESSAGE =
  `This shop's scam hold was released, but the confirmed report stays on its record, so it can keep at most ${RELEASED_CHARGE_MAX_ACTIVE} active listings while that report stands. Mark one sold or hide one before adding or relisting another.`
